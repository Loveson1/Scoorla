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
import {
  buildTeacherAssignmentPayload,
  normalizeSubjectAssignments,
} from "../utils/teacherAuthService";

// Context to provide authentication and authorization state throughout the app 
const AuthContext = createContext(null);

// Helper functions to normalize and compare role and assignment data for consistent access control logic
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

const arraysMatch = (left = [], right = []) => {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
};

const buildSubjectClassMatchKeys = (classId, subjectId) => {
  const rawClassId = String(classId || "").trim();
  const rawSubjectId = String(subjectId || "").trim();
  const classToken = normalizeClassAccessToken(rawClassId);
  const subjectToken = normalizeSubjectAccessToken(rawSubjectId);

  return [...new Set([
    rawClassId && rawSubjectId ? `${rawClassId}__${rawSubjectId}` : "",
    rawClassId && subjectToken ? `${rawClassId}__${subjectToken}` : "",
    classToken && rawSubjectId ? `${classToken}__${rawSubjectId}` : "",
    classToken && subjectToken ? `${classToken}__${subjectToken}` : "",
  ].filter(Boolean))];
};

export function AuthProvider({ children }) {
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [platformRecord, setPlatformRecord] = useState(null);
  const [schoolRecord, setSchoolRecord] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const previousAuthUidRef = useRef(null);


// THE CLEANER & LIVE-SYNCER & GATEKEEPER: 
// We need a central listener so the app can instantly react to login/logout events.
// We need to check if user exist
// WHY: We wipe the cache on user-switch to prevent data leaks between accounts. 
// We use a live "onSnapshot" connection so that if an Admin changes a role, 
// the app "heals" the UI instantly without the user needing to refresh.


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

// Stop listening when this component is destroyed
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

    const role = normalizeRole(profile?.role);
    const isTeacherRole =
      role === "class_teacher" ||
      role === "subject_teacher" ||
      role === "class_subject_teacher";
    if (!isTeacherRole) {
      return;
    }

    const assignmentPayload = buildTeacherAssignmentPayload({
      schoolId: profile?.schoolId,
      role,
      classTeacherClasses: profile?.classTeacherClasses,
      subjectAssignments: profile?.subjectAssignments,
      assignedClasses: profile?.assignedClasses,
      assignedSubjects: profile?.assignedSubjects,
    });

    const nextClassTeacherClasses = [...assignmentPayload.classTeacherClasses].sort();
    const currentClassTeacherClasses = normalizeAssignments(profile?.classTeacherClasses).sort();
    const nextClassTeacherClassTokens = [...assignmentPayload.classTeacherClassTokens].sort();
    const currentClassTeacherClassTokens = normalizeAssignments(profile?.classTeacherClassTokens)
      .map((item) => normalizeClassAccessToken(item))
      .filter(Boolean)
      .sort();
    const nextAssignedClasses = [...assignmentPayload.assignedClasses].sort();
    const currentAssignedClasses = normalizeAssignments(profile?.assignedClasses).sort();
    const nextClassTokens = [...assignmentPayload.assignedClassTokens].sort();
    const currentClassTokens = normalizeAssignments(profile?.assignedClassTokens)
      .map((item) => normalizeClassAccessToken(item))
      .filter(Boolean)
      .sort();
    const nextAssignedSubjects = [...assignmentPayload.assignedSubjects].sort();
    const nextSubjectTokens = [...assignmentPayload.assignedSubjectTokens].sort();
    const nextSubjectKeys = [...assignmentPayload.assignedSubjectKeys].sort();
    const nextSubjectClassKeys = [...assignmentPayload.assignedSubjectClassKeys].sort();
    const currentSubjectTokens = normalizeAssignments(profile?.assignedSubjectTokens)
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
      .sort();
    const currentSubjectKeys = normalizeAssignments(profile?.assignedSubjectKeys).sort();
    const currentAssignedSubjects = normalizeAssignments(profile?.assignedSubjects).sort();
    const currentAssignedSubjectClassKeys = normalizeAssignments(profile?.assignedSubjectClassKeys).sort();
    const nextSubjectAssignments = normalizeSubjectAssignments(assignmentPayload.subjectAssignments)
      .map((item) => JSON.stringify(item))
      .sort();
    const currentSubjectAssignments = normalizeSubjectAssignments(profile?.subjectAssignments)
      .map((item) => JSON.stringify(item))
      .sort();

    if (
      arraysMatch(currentClassTeacherClasses, nextClassTeacherClasses) &&
      arraysMatch(currentClassTeacherClassTokens, nextClassTeacherClassTokens) &&
      arraysMatch(currentAssignedClasses, nextAssignedClasses) &&
      arraysMatch(currentClassTokens, nextClassTokens) &&
      arraysMatch(currentSubjectTokens, nextSubjectTokens) &&
      arraysMatch(currentAssignedSubjects, nextAssignedSubjects) &&
      arraysMatch(currentSubjectKeys, nextSubjectKeys) &&
      arraysMatch(currentAssignedSubjectClassKeys, nextSubjectClassKeys) &&
      arraysMatch(currentSubjectAssignments, nextSubjectAssignments)
    ) {
      return;
    }

    updateDoc(doc(firestore, "users", authUser.uid), {
      classTeacherClasses: nextClassTeacherClasses,
      classTeacherClassTokens: nextClassTeacherClassTokens,
      subjectAssignments: assignmentPayload.subjectAssignments,
      assignedClasses: nextAssignedClasses,
      assignedClassTokens: nextClassTokens,
      assignedSubjects: nextAssignedSubjects,
      assignedSubjectTokens: nextSubjectTokens,
      assignedSubjectKeys: nextSubjectKeys,
      assignedSubjectClassKeys: nextSubjectClassKeys,
    }).catch((tokenError) => {
      console.warn(
        "Unable to self-heal teacher assignment tokens:",
        tokenError?.message || tokenError
      );
    });
  }, [
    authUser?.uid,
    profile?.schoolId,
    profile?.role,
    profile?.classTeacherClasses,
    profile?.classTeacherClassTokens,
    profile?.subjectAssignments,
    profile?.assignedClasses,
    profile?.assignedClassTokens,
    profile?.assignedSubjects,
    profile?.assignedSubjectTokens,
    profile?.assignedSubjectKeys,
    profile?.assignedSubjectClassKeys,
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
    const assignmentPayload = buildTeacherAssignmentPayload({
      schoolId,
      role,
      classTeacherClasses: profile?.classTeacherClasses,
      subjectAssignments: profile?.subjectAssignments,
      assignedClasses: profile?.assignedClasses,
      assignedSubjects: profile?.assignedSubjects,
    });
    const classTeacherClasses = assignmentPayload.classTeacherClasses;
    const subjectAssignments = assignmentPayload.subjectAssignments;
    const assignedClasses = assignmentPayload.assignedClasses;
    const assignedSubjects = assignmentPayload.assignedSubjects;
    const normalizedManagedClasses = [...assignmentPayload.classTeacherClassTokens];
    const normalizedAssignedClasses = [...assignmentPayload.assignedClassTokens];
    const normalizedAssignedSubjects = [...assignmentPayload.assignedSubjectTokens];
    const normalizedSubjectClassKeys = normalizeAssignments(profile?.assignedSubjectClassKeys).length
      ? normalizeAssignments(profile?.assignedSubjectClassKeys).sort()
      : [...assignmentPayload.assignedSubjectClassKeys].sort();
    const recordClassIds = normalizeAssignments(
      subjectAssignments.flatMap((assignment) => assignment.classIds || [])
    );
    const isAdmin = role === "admin";
    const isTeacher =
      role === "class_teacher" ||
      role === "subject_teacher" ||
      role === "class_subject_teacher";

    const canManageClass = (classId) => {
      if (isAdmin) return true;
      if (!isTeacher) return false;
      const normalizedClassId = normalizeClassAccessToken(classId);
      return normalizedManagedClasses.includes(normalizedClassId);
    };

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

    const canRecordClassSubject = (classId, subjectId) => {
      if (isAdmin) return true;
      if (!isTeacher) return false;
      const candidateKeys = buildSubjectClassMatchKeys(classId, subjectId);
      if (candidateKeys.length > 0) {
        return candidateKeys.some((key) => normalizedSubjectClassKeys.includes(key));
      }
      return canAccessClass(classId) && canAccessSubject(subjectId);
    };

    const getRecordClassIds = () => {
      if (isAdmin) return [];
      return recordClassIds.length > 0 ? [...recordClassIds] : [...assignedClasses];
    };

    const getRecordSubjectsForClass = (classId) => {
      if (isAdmin) return [];
      const normalizedClassId = normalizeClassAccessToken(classId);
      const subjectsForClass = [...new Set(
        subjectAssignments
          .filter((assignment) =>
            (assignment.classIds || []).some(
              (item) => normalizeClassAccessToken(item) === normalizedClassId
            )
          )
          .map((assignment) => assignment.subjectId)
      )];
      return subjectsForClass.length > 0 ? subjectsForClass : [...assignedSubjects];
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
      classTeacherClasses,
      subjectAssignments,
      isAdmin,
      isTeacher,
      isLoading,
      error,
      canManageClass,
      canAccessClass,
      canAccessSubject,
      canRecordClassSubject,
      getRecordClassIds,
      getRecordSubjectsForClass,
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


