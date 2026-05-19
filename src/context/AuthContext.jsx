/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { auth, firestore } from "../firebase";
import {
  clearCachedUserScope,
  setCachedUserScope,
} from "../utils/userScopeCache";
import { clearAllBrowserIdentityState } from "../utils/userSession";
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

const resetIdentityState = () => {
  clearCachedUserScope();
  clearDataCache();
  clearAllBrowserIdentityState();
};

export function AuthProvider({ children }) {
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [confirmedProfile, setConfirmedProfile] = useState(null);
  const [profileHasPendingWrites, setProfileHasPendingWrites] = useState(false);
  const [platformRecord, setPlatformRecord] = useState(null);
  const [schoolRecord, setSchoolRecord] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const previousAuthUidRef = useRef(null);
  const authUserId = String(authUser?.uid || "").trim();
  const profileUserId = String(profile?.uid || "").trim();
  const isProfileSynced = !!authUserId && !!profile && profileUserId === authUserId;
  const authoritativeProfile = useMemo(() => {
    if (!authUserId || !profile || profileUserId !== authUserId) {
      return null;
    }
    if (profileHasPendingWrites) {
      return null;
    }
    return profile;
  }, [authUserId, profile, profileHasPendingWrites, profileUserId]);


// THE CLEANER & LIVE-SYNCER & GATEKEEPER: 
// We need a central listener so the app can instantly react to login/logout events.
// We need to check if user exist
// WHY: We wipe the cache on user-switch to prevent data leaks between accounts. 
// We use a live "onSnapshot" connection so that if an Admin changes a role, 
// The app "heals" the UI instantly without the user needing to refresh.


  useEffect(() => {
    let unsubscribeProfile = null;

    const unsubscribeAuth = onAuthStateChanged(
      auth,
      (user) => {
        const nextUid = String(user?.uid || "").trim() || null;
        if (previousAuthUidRef.current !== nextUid) {
          resetIdentityState();
          setProfile(null);
          setConfirmedProfile(null);
          setProfileHasPendingWrites(false);
          setPlatformRecord(null);
          setSchoolRecord(null);
        }
        previousAuthUidRef.current = nextUid;

        if (unsubscribeProfile) {
          unsubscribeProfile();
          unsubscribeProfile = null;
        }

        if (!user) {
          resetIdentityState();
          setAuthUser(null);
          setProfile(null);
          setConfirmedProfile(null);
          setProfileHasPendingWrites(false);
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
            const currentAuthUid = String(auth.currentUser?.uid || "").trim();
            if (currentAuthUid !== String(user.uid || "").trim()) {
              return;
            }
            const nextProfile = snapshot.exists() ? snapshot.data() : null;
            const hasPendingWrites = snapshot.metadata.hasPendingWrites === true;
            const nextProfileUid = String(nextProfile?.uid || "").trim();
            const profileMatchesAuth = !!nextProfile && nextProfileUid === String(user.uid || "").trim();
            setProfile(profileMatchesAuth ? nextProfile : null);
            setProfileHasPendingWrites(hasPendingWrites);
            if (!hasPendingWrites) {
              setConfirmedProfile(profileMatchesAuth ? nextProfile : null);
              if (profileMatchesAuth) {
                setCachedUserScope(user.uid, nextProfile);
              } else {
                clearCachedUserScope();
              }
            }
            setIsLoading(false);
          },
          (snapshotError) => {
            const currentAuthUid = String(auth.currentUser?.uid || "").trim();
            if (currentAuthUid !== String(user.uid || "").trim()) {
              return;
            }
            setProfile(null);
            setConfirmedProfile(null);
            setProfileHasPendingWrites(false);
            clearCachedUserScope();
            setError(snapshotError);
            setIsLoading(false);
          }
        );
      },
      (authError) => {
        resetIdentityState();
        setAuthUser(null);
        setProfile(null);
        setConfirmedProfile(null);
        setProfileHasPendingWrites(false);
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
    console.debug("[AuthContext] auth/profile sync", {
      authUserUid: authUserId || null,
      profileUid: profileUserId || null,
      confirmedProfileUid: String(confirmedProfile?.uid || "").trim() || null,
      profileRole: normalizeRole(profile?.role),
      profileSchoolId: String(profile?.schoolId || "").trim() || null,
      authoritativeRole: normalizeRole(authoritativeProfile?.role),
      authoritativeSchoolId: String(authoritativeProfile?.schoolId || "").trim() || null,
      isProfileSynced,
      profileHasPendingWrites,
    });
  }, [
    authUserId,
    authoritativeProfile?.role,
    authoritativeProfile?.schoolId,
    confirmedProfile?.uid,
    isProfileSynced,
    profile?.role,
    profile?.schoolId,
    profileHasPendingWrites,
    profileUserId,
  ]);


/*
- We need this listener to check if platform user exist this mount or not, 
if not we will treat the user as non-admin by setting platformRecord to null.
- We use live snapshot so when scoorla admin changes a user's role or school, 
the app updates immediately without needing a refresh.
*/


  useEffect(() => {
    if (!authUser?.uid) {
      setPlatformRecord(null);
      return;
    }

    const platformRef = doc(firestore, "platformUsers", authUser.uid);
    const unsubscribePlatform = onSnapshot(
      platformRef,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() || {} : null;
        const recordUid = String(data?.uid || snapshot.id || "").trim();
        setPlatformRecord(
          data && recordUid === String(authUser.uid || "").trim()
            ? { id: snapshot.id, ...data }
            : null
        );
      },
      (snapshotError) => {
        console.error("Error reading platform user record:", snapshotError);
        setPlatformRecord(null);
      }
    );

    return () => unsubscribePlatform();
  }, [authUser?.uid]);



  /*
  - this listener will work if user has schoolid  hence is for staff
  - We use live snapshot so when scoorla admin changes a school's status,
  the app updates immediately without needing a refresh.
  */
  useEffect(() => {
    const resolvedSchoolId = String(authoritativeProfile?.schoolId || "").trim();

    if (!resolvedSchoolId) {
      setSchoolRecord(null);
      return;
    }

    const schoolRef = doc(firestore, "schools", resolvedSchoolId);
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
  }, [authUser?.uid, authoritativeProfile?.schoolId]);


  /*
  - this listener is used by teachers it listens to know what the teachers have been assigned , 
  what they are allowed to do or not, it the authenticator. 
  - it mount based on the authUser uid and profile schoolid and role
  - iit also has a self-healing mechanism, if the teacher's 
  assignment tokens are out of sync with their actual assignments, 
  it will update the user record to fix the tokens. 
  
  */
  useEffect(() => {
    if (!authUser?.uid || !authoritativeProfile?.schoolId) {
      return;
    }

    const role = normalizeRole(authoritativeProfile?.role);
    const isTeacherRole =
      role === "class_teacher" ||
      role === "subject_teacher" ||
      role === "class_subject_teacher";
    if (!isTeacherRole) {
      return;
    }

    const assignmentPayload = buildTeacherAssignmentPayload({
      schoolId: authoritativeProfile?.schoolId,
      role,
      classTeacherClasses: authoritativeProfile?.classTeacherClasses,
      subjectAssignments: authoritativeProfile?.subjectAssignments,
      assignedClasses: authoritativeProfile?.assignedClasses,
      assignedSubjects: authoritativeProfile?.assignedSubjects,
    });

    const nextClassTeacherClasses = [...assignmentPayload.classTeacherClasses].sort();
    const currentClassTeacherClasses = normalizeAssignments(authoritativeProfile?.classTeacherClasses).sort();
    const nextClassTeacherClassTokens = [...assignmentPayload.classTeacherClassTokens].sort();
    const currentClassTeacherClassTokens = normalizeAssignments(authoritativeProfile?.classTeacherClassTokens)
      .map((item) => normalizeClassAccessToken(item))
      .filter(Boolean)
      .sort();
    const nextAssignedClasses = [...assignmentPayload.assignedClasses].sort();
    const currentAssignedClasses = normalizeAssignments(authoritativeProfile?.assignedClasses).sort();
    const nextClassTokens = [...assignmentPayload.assignedClassTokens].sort();
    const currentClassTokens = normalizeAssignments(authoritativeProfile?.assignedClassTokens)
      .map((item) => normalizeClassAccessToken(item))
      .filter(Boolean)
      .sort();
    const nextAssignedSubjects = [...assignmentPayload.assignedSubjects].sort();
    const nextSubjectTokens = [...assignmentPayload.assignedSubjectTokens].sort();
    const nextSubjectKeys = [...assignmentPayload.assignedSubjectKeys].sort();
    const nextSubjectClassKeys = [...assignmentPayload.assignedSubjectClassKeys].sort();
    const currentSubjectTokens = normalizeAssignments(authoritativeProfile?.assignedSubjectTokens)
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
      .sort();
    const currentSubjectKeys = normalizeAssignments(authoritativeProfile?.assignedSubjectKeys).sort();
    const currentAssignedSubjects = normalizeAssignments(authoritativeProfile?.assignedSubjects).sort();
    const currentAssignedSubjectClassKeys = normalizeAssignments(authoritativeProfile?.assignedSubjectClassKeys).sort();
    const nextSubjectAssignments = normalizeSubjectAssignments(assignmentPayload.subjectAssignments)
      .map((item) => JSON.stringify(item))
      .sort();
    const currentSubjectAssignments = normalizeSubjectAssignments(authoritativeProfile?.subjectAssignments)
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
    authoritativeProfile?.schoolId,
    authoritativeProfile?.role,
    authoritativeProfile?.classTeacherClasses,
    authoritativeProfile?.classTeacherClassTokens,
    authoritativeProfile?.subjectAssignments,
    authoritativeProfile?.assignedClasses,
    authoritativeProfile?.assignedClassTokens,
    authoritativeProfile?.assignedSubjects,
    authoritativeProfile?.assignedSubjectTokens,
    authoritativeProfile?.assignedSubjectKeys,
    authoritativeProfile?.assignedSubjectClassKeys,
  ]);

// we need this listener to update the school's last active timestamp when an admin is active,

  useEffect(() => {
    const resolvedSchoolId = String(authoritativeProfile?.schoolId || "").trim();

    if (!authUser?.uid || !resolvedSchoolId || String(authoritativeProfile?.role || "").toLowerCase() !== "admin") {
      return;
    }

    touchSchoolLastActive(resolvedSchoolId).catch((touchError) => {
      console.warn("Unable to touch school activity:", touchError?.message || touchError);
    });
  }, [authUser?.uid, authoritativeProfile?.schoolId, authoritativeProfile?.role]);


// we need this useMemo to Takes raw data from external data base and   
// and turn them into objects and functions that the app can use 
// to determine what the user can see and do, this is the core of the 
// gatekeeping logic.

  const value = useMemo(() => {
    const accountActive = !!authoritativeProfile && authoritativeProfile?.isActive !== false;
    const role = accountActive ? normalizeRole(authoritativeProfile?.role) : null;
    const schoolId = String(authoritativeProfile?.schoolId || "").trim() || null;
    const platformRole = String(platformRecord?.role || "")
      .trim()
      .toLowerCase();
    const isPlatformSuperAdmin = platformRole === "super_admin";
    const schoolStatus = normalizeSchoolStatus(schoolRecord?.status);
    const schoolDisabled = !!schoolId && isSchoolDisabledStatus(schoolStatus);
    const assignmentPayload = buildTeacherAssignmentPayload({
      schoolId,
      role,
      classTeacherClasses: authoritativeProfile?.classTeacherClasses,
      subjectAssignments: authoritativeProfile?.subjectAssignments,
      assignedClasses: authoritativeProfile?.assignedClasses,
      assignedSubjects: authoritativeProfile?.assignedSubjects,
    });
    const classTeacherClasses = assignmentPayload.classTeacherClasses;
    const subjectAssignments = assignmentPayload.subjectAssignments;
    const assignedClasses = assignmentPayload.assignedClasses;
    const assignedSubjects = assignmentPayload.assignedSubjects;
    const normalizedManagedClasses = [...assignmentPayload.classTeacherClassTokens];
    const normalizedAssignedClasses = [...assignmentPayload.assignedClassTokens];
    const normalizedAssignedSubjects = [...assignmentPayload.assignedSubjectTokens];
    const normalizedSubjectClassKeys = normalizeAssignments(authoritativeProfile?.assignedSubjectClassKeys).length
      ? normalizeAssignments(authoritativeProfile?.assignedSubjectClassKeys).sort()
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
      profile: authoritativeProfile,
      accountActive,
      role,
      platformRole,
      isPlatformSuperAdmin,
      schoolId,
      schoolStatus,
      schoolDisabled,
      schoolRecord,
      isProfileSynced,
      profileHasPendingWrites,
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
  }, [
    authUser,
    authoritativeProfile,
    error,
    isLoading,
    isProfileSynced,
    platformRecord,
    profileHasPendingWrites,
    schoolRecord,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }
  return context;
}
