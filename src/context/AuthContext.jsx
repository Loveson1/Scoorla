/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { auth, firestore } from "../firebase";
import {
  clearCachedUserScope,
  setCachedUserScope,
} from "../utils/userScopeCache";
import { clearAllSessionState } from "../utils/userSession";
import { clearDataCache } from "../services/dataCache";
import {
  isSchoolDisabledStatus,
  normalizeSchoolStatus,
  touchSchoolLastActive,
} from "../utils/schoolDirectoryService";

const AuthContext = createContext(null);

const normalizeRole = (rawRole) => {
  const role = String(rawRole || "")
    .trim()
    .toLowerCase();

  if (
    role === "admin" ||
    role === "class_teacher" ||
    role === "subject_teacher" ||
    role === "class_subject_teacher"
  ) {
    return role;
  }

  // Legacy compatibility: treat generic teacher role as combined teacher.
  if (role === "teacher") {
    return "class_subject_teacher";
  }

  return null;
};

const normalizeAssignments = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
};

const normalizeClassAccessToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const sanitizeDocIdToken = (value) =>
  encodeURIComponent(String(value || ""))
    .replace(/%/g, "_")
    .replace(/\./g, "_");

const normalizeSubjectAccessToken = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (normalized === "basic science" || normalized === "basic science and technology") {
    return "basic_science_and_technology";
  }
  return normalized.replace(/\s+/g, "_");
};

const buildSubjectCatalogDocId = (schoolId, level, subject) => {
  const normalizedSchoolId = String(schoolId || "").trim();
  const normalizedLevel = String(level || "").trim().toLowerCase();
  const normalizedToken = normalizeSubjectAccessToken(subject);
  if (!normalizedSchoolId || !normalizedLevel || !normalizedToken) {
    return "";
  }
  return `${normalizedSchoolId}__${normalizedLevel}__${sanitizeDocIdToken(normalizedToken)}`;
};

const expandAssignedSubjects = (values) => {
  const normalized = normalizeAssignments(values);
  const expanded = [...normalized];
  const hasBasicScienceAlias = normalized.some(
    (item) => normalizeSubjectAccessToken(item) === "basic_science_and_technology"
  );

  normalized.forEach((item) => {
    const andVariant = String(item || "").replace(/\s*&\s*/gi, " and ").replace(/\s+/g, " ").trim();
    const ampVariant = String(item || "").replace(/\s+and\s+/gi, " & ").replace(/\s+/g, " ").trim();
    if (andVariant) {
      expanded.push(andVariant);
    }
    if (ampVariant) {
      expanded.push(ampVariant);
    }
  });

  if (hasBasicScienceAlias) {
    if (!expanded.includes("Basic Science")) {
      expanded.push("Basic Science");
    }
    if (!expanded.includes("Basic Science and Technology")) {
      expanded.push("Basic Science and Technology");
    }
    if (!expanded.includes("Basic Science & Technology")) {
      expanded.push("Basic Science & Technology");
    }
  }

  return [...new Set(expanded)];
};

const collapseAssignedSubjects = (values) => {
  const normalized = normalizeAssignments(values);
  const collapsed = [];
  let canonicalBasicScience = "";

  normalized.forEach((item) => {
    const token = normalizeSubjectAccessToken(item);
    if (token === "basic_science_and_technology") {
      if (!canonicalBasicScience) {
        canonicalBasicScience = item;
      }
      return;
    }
    collapsed.push(item);
  });

  if (canonicalBasicScience) {
    collapsed.push(canonicalBasicScience);
  }

  return [...new Set(collapsed)];
};

const buildAssignedSubjectTokens = (values) =>
  [...new Set(
    normalizeAssignments(values).map((item) => {
      return normalizeSubjectAccessToken(item);
    }).filter(Boolean)
  )];

const buildAssignedSubjectKeys = (schoolId, values) => {
  const expandedSubjects = expandAssignedSubjects(values);
  const exactValues = normalizeAssignments(expandedSubjects);
  const docIds = exactValues.flatMap((subject) => {
    const juniorId = buildSubjectCatalogDocId(schoolId, "junior", subject);
    const seniorId = buildSubjectCatalogDocId(schoolId, "senior", subject);
    return [juniorId, seniorId].filter(Boolean);
  });
  return [...new Set([...exactValues, ...docIds])].sort();
};

const arraysMatch = (left = [], right = []) => {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
};

export function AuthProvider({ children }) {
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [platformRecord, setPlatformRecord] = useState(null);
  const [schoolRecord, setSchoolRecord] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const previousAuthUidRef = useRef(null);

  useEffect(() => {
    let unsubscribeProfile = null;

    const unsubscribeAuth = onAuthStateChanged(
      auth,
      (user) => {
        const nextUid = String(user?.uid || "").trim() || null;
        if (previousAuthUidRef.current !== nextUid) {
          clearCachedUserScope();
          clearDataCache();
          clearAllSessionState();
        }
        previousAuthUidRef.current = nextUid;

        if (unsubscribeProfile) {
          unsubscribeProfile();
          unsubscribeProfile = null;
        }

        if (!user) {
          setAuthUser(null);
          setProfile(null);
          setPlatformRecord(null);
          setSchoolRecord(null);
          setError(null);
          setIsLoading(false);
          return;
        }

        setAuthUser(user);
        setError(null);
        setIsLoading(true);

        const userRef = doc(firestore, "users", user.uid);
        unsubscribeProfile = onSnapshot(
          userRef,
          (snapshot) => {
            const nextProfile = snapshot.exists() ? snapshot.data() : null;
            setProfile(nextProfile);
            setCachedUserScope(user.uid, nextProfile || {});
            setIsLoading(false);
          },
          (snapshotError) => {
            setProfile(null);
            clearCachedUserScope();
            setError(snapshotError);
            setIsLoading(false);
          }
        );
      },
      (authError) => {
        setAuthUser(null);
        setProfile(null);
        clearCachedUserScope();
        setError(authError);
        setIsLoading(false);
      }
    );

    return () => {
      if (unsubscribeProfile) unsubscribeProfile();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (!authUser?.uid) {
      setPlatformRecord(null);
      return;
    }

    const platformRef = doc(firestore, "platformUsers", authUser.uid);
    const unsubscribePlatform = onSnapshot(
      platformRef,
      (snapshot) => {
        setPlatformRecord(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      },
      (snapshotError) => {
        console.error("Error reading platform user record:", snapshotError);
        setPlatformRecord(null);
      }
    );

    return () => unsubscribePlatform();
  }, [authUser?.uid]);

  useEffect(() => {
    if (!profile?.schoolId) {
      setSchoolRecord(null);
      return;
    }

    const schoolRef = doc(firestore, "schools", profile.schoolId);
    const unsubscribeSchool = onSnapshot(
      schoolRef,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() || {} : {};
        setSchoolRecord({
          id: snapshot.id,
          ...data,
          status: normalizeSchoolStatus(data?.status),
        });
      },
      (snapshotError) => {
        console.error("Error reading school record:", snapshotError);
        setSchoolRecord((prev) => ({
          ...(prev || {}),
          status: "active",
        }));
      }
    );

    return () => unsubscribeSchool();
  }, [profile?.schoolId]);

  useEffect(() => {
    if (!authUser?.uid || !profile?.schoolId) {
      return;
    }

    const nextClassTokens = normalizeAssignments(profile?.assignedClasses)
      .map((item) => normalizeClassAccessToken(item))
      .filter(Boolean)
      .sort();
    const currentClassTokens = normalizeAssignments(profile?.assignedClassTokens)
      .map((item) => normalizeClassAccessToken(item))
      .filter(Boolean)
      .sort();
    const nextAssignedSubjects = collapseAssignedSubjects(profile?.assignedSubjects);
    const nextSubjectTokens = buildAssignedSubjectTokens(nextAssignedSubjects);
    const nextSubjectKeys = buildAssignedSubjectKeys(profile?.schoolId, nextAssignedSubjects);
    const currentSubjectTokens = normalizeAssignments(profile?.assignedSubjectTokens)
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
      .sort();
    const currentSubjectKeys = normalizeAssignments(profile?.assignedSubjectKeys).sort();
    const currentAssignedSubjects = normalizeAssignments(profile?.assignedSubjects).sort();
    const normalizedNextAssignedSubjects = [...nextAssignedSubjects].sort();
    const normalizedNextTokens = [...nextSubjectTokens].sort();

    if (
      arraysMatch(currentClassTokens, nextClassTokens) &&
      arraysMatch(currentSubjectTokens, normalizedNextTokens) &&
      arraysMatch(currentAssignedSubjects, normalizedNextAssignedSubjects) &&
      arraysMatch(currentSubjectKeys, nextSubjectKeys)
    ) {
      return;
    }

    updateDoc(doc(firestore, "users", authUser.uid), {
      assignedClassTokens: nextClassTokens,
      assignedSubjects: normalizedNextAssignedSubjects,
      assignedSubjectTokens: normalizedNextTokens,
      assignedSubjectKeys: nextSubjectKeys,
    }).catch((tokenError) => {
      console.warn(
        "Unable to self-heal teacher assignment tokens:",
        tokenError?.message || tokenError
      );
    });
  }, [
    authUser?.uid,
    profile?.schoolId,
    profile?.assignedClasses,
    profile?.assignedClassTokens,
    profile?.assignedSubjects,
    profile?.assignedSubjectTokens,
    profile?.assignedSubjectKeys,
  ]);

  useEffect(() => {
    if (!authUser?.uid || !profile?.schoolId || String(profile?.role || "").toLowerCase() !== "admin") {
      return;
    }

    touchSchoolLastActive(profile.schoolId).catch((touchError) => {
      console.warn("Unable to touch school activity:", touchError?.message || touchError);
    });
  }, [authUser?.uid, profile?.schoolId, profile?.role]);

  const value = useMemo(() => {
    const accountActive = profile?.isActive !== false;
    const role = accountActive ? normalizeRole(profile?.role) : null;
    const schoolId = profile?.schoolId || null;
    const platformRole = String(platformRecord?.role || "")
      .trim()
      .toLowerCase();
    const isPlatformSuperAdmin = platformRole === "super_admin";
    const schoolStatus = normalizeSchoolStatus(schoolRecord?.status);
    const schoolDisabled = !!schoolId && isSchoolDisabledStatus(schoolStatus);
    const assignedClasses = normalizeAssignments(profile?.assignedClasses);
    const assignedSubjects = collapseAssignedSubjects(profile?.assignedSubjects);
    const normalizedAssignedClasses = normalizeAssignments(profile?.assignedClassTokens).length
      ? normalizeAssignments(profile?.assignedClassTokens).map((item) =>
          normalizeClassAccessToken(item)
        )
      : assignedClasses.map((item) => normalizeClassAccessToken(item));
    const normalizedAssignedSubjects = buildAssignedSubjectTokens(assignedSubjects);
    const isAdmin = role === "admin";
    const isTeacher =
      role === "class_teacher" ||
      role === "subject_teacher" ||
      role === "class_subject_teacher";

    const canAccessClass = (classId) => {
      if (isAdmin) return true;
      if (!isTeacher) return false;
      const normalizedClassId = normalizeClassAccessToken(classId);
      return normalizedAssignedClasses.includes(normalizedClassId);
    };

    const canAccessSubject = (subjectId) => {
      if (isAdmin) return true;
      if (!isTeacher) return false;
      const normalizedSubjectId = normalizeSubjectAccessToken(subjectId);
      return normalizedAssignedSubjects.includes(normalizedSubjectId);
    };

    const canManageStudents = () =>
      isAdmin || role === "class_teacher" || role === "class_subject_teacher";

    const canRecordScores = () =>
      isAdmin || role === "subject_teacher" || role === "class_subject_teacher";

    return {
      authUser,
      profile,
      accountActive,
      role,
      platformRole,
      isPlatformSuperAdmin,
      schoolId,
      schoolStatus,
      schoolDisabled,
      schoolRecord,
      assignedClasses,
      assignedSubjects,
      isAdmin,
      isTeacher,
      isLoading,
      error,
      canAccessClass,
      canAccessSubject,
      canManageStudents,
      canRecordScores,
    };
  }, [authUser, profile, platformRecord, schoolRecord, isLoading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }
  return context;
}
