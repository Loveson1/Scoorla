import { doc, getDoc } from "firebase/firestore";
import { auth, firestore } from "../firebase";
import { instrumentFirestoreRead } from "../services/firestoreInstrumentation";

const normalizeAssignments = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
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

const normalizeSubjectAssignments = (value) => {
  if (!Array.isArray(value)) return [];

  const grouped = new Map();

  value.forEach((item) => {
    const subjectId = String(item?.subjectId || item?.subject || "").trim();
    const classIds = normalizeAssignments(item?.classIds || item?.classes);
    if (!subjectId || classIds.length === 0) return;

    const subjectToken = normalizeSubjectAccessToken(subjectId) || subjectId;
    const current = grouped.get(subjectToken) || {
      subjectId,
      classIds: [],
    };
    current.subjectId = current.subjectId || subjectId;
    current.classIds = normalizeAssignments([...(current.classIds || []), ...classIds]);
    grouped.set(subjectToken, current);
  });

  return [...grouped.values()].sort((left, right) =>
    String(left?.subjectId || "").localeCompare(String(right?.subjectId || ""))
  );
};

const normalizeRole = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

let currentScope = null;
const pendingScopeLoads = new Map();

export const buildUserScopeRecord = (uid, data = {}) => ({
  uid: String(uid || "").trim(),
  schoolId: String(data?.schoolId || "").trim(),
  role: normalizeRole(data?.role),
  isActive: data?.isActive !== false,
  classTeacherClasses: normalizeAssignments(data?.classTeacherClasses),
  classTeacherClassTokens: normalizeAssignments(data?.classTeacherClassTokens).map(
    normalizeClassAccessToken
  ),
  subjectAssignments: normalizeSubjectAssignments(data?.subjectAssignments),
  assignedClasses: normalizeAssignments(data?.assignedClasses),
  assignedClassTokens: normalizeAssignments(data?.assignedClassTokens).map(
    normalizeClassAccessToken
  ),
  assignedSubjects: normalizeAssignments(data?.assignedSubjects),
  assignedSubjectTokens: normalizeAssignments(data?.assignedSubjectTokens).map(
    normalizeSubjectAccessToken
  ),
  assignedSubjectKeys: normalizeAssignments(data?.assignedSubjectKeys),
  assignedSubjectClassKeys: normalizeAssignments(data?.assignedSubjectClassKeys),
});

export const setCachedUserScope = (uid, data = {}) => {
  const nextScope = buildUserScopeRecord(uid, data);
  if (!nextScope.uid) {
    currentScope = null;
    return null;
  }
  currentScope = nextScope;
  return { ...nextScope };
};

export const clearCachedUserScope = () => {
  currentScope = null;
  pendingScopeLoads.clear();
};

export const getCachedUserScope = (uid = "") => {
  const resolvedUid = String(uid || "").trim();
  if (!currentScope?.uid) return null;
  if (resolvedUid && currentScope.uid !== resolvedUid) return null;
  return { ...currentScope };
};

export const getCachedUserScopeForSchool = (schoolId, uid = "") => {
  const scope = getCachedUserScope(uid);
  if (!scope) return null;
  const resolvedSchoolId = String(schoolId || "").trim();
  const sameSchool =
    !resolvedSchoolId || String(scope.schoolId || "").trim() === resolvedSchoolId;

  return {
    ...scope,
    isAdmin: sameSchool && scope.isActive && scope.role === "admin",
    classTeacherClasses: sameSchool ? [...scope.classTeacherClasses] : [],
    classTeacherClassTokens: sameSchool ? [...scope.classTeacherClassTokens] : [],
    subjectAssignments: sameSchool ? [...scope.subjectAssignments] : [],
    assignedClasses: sameSchool ? [...scope.assignedClasses] : [],
    assignedClassTokens: sameSchool ? [...scope.assignedClassTokens] : [],
    assignedSubjects: sameSchool ? [...scope.assignedSubjects] : [],
    assignedSubjectTokens: sameSchool ? [...scope.assignedSubjectTokens] : [],
    assignedSubjectKeys: sameSchool ? [...scope.assignedSubjectKeys] : [],
    assignedSubjectClassKeys: sameSchool ? [...scope.assignedSubjectClassKeys] : [],
  };
};

export const loadUserScopeFromFirestore = async (uid = "", options = {}) => {
  const resolvedUid = String(uid || "").trim();
  if (!resolvedUid) return null;

  const pendingLoad = pendingScopeLoads.get(resolvedUid);
  if (pendingLoad) {
    return pendingLoad;
  }

  const promise = instrumentFirestoreRead(
    getDoc(doc(firestore, "users", resolvedUid)),
    {
      screen: String(options?.screen || "Shared"),
      action: String(options?.action || "load_user_scope"),
      target: `users/${resolvedUid}`,
    }
  )
    .then((userSnap) => {
      if (!userSnap.exists()) {
        return null;
      }
      const userData = userSnap.data() || {};
      return setCachedUserScope(resolvedUid, userData);
    })
    .finally(() => {
      pendingScopeLoads.delete(resolvedUid);
    });

  pendingScopeLoads.set(resolvedUid, promise);
  return promise;
};

export const ensureUserScope = async (uid = "", options = {}) => {
  const resolvedUid = String(uid || auth?.currentUser?.uid || "").trim();
  if (!resolvedUid) return null;
  const cachedScope = getCachedUserScope(resolvedUid);
  if (cachedScope) {
    return cachedScope;
  }
  return loadUserScopeFromFirestore(resolvedUid, options);
};
