import { doc, getDoc } from "firebase/firestore";
import { auth, firestore } from "../firebase";
import { instrumentFirestoreRead } from "../services/firestoreInstrumentation";

const normalizeAssignments = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
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
  assignedClasses: normalizeAssignments(data?.assignedClasses),
  assignedSubjects: normalizeAssignments(data?.assignedSubjects),
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
    assignedClasses: sameSchool ? [...scope.assignedClasses] : [],
    assignedSubjects: sameSchool ? [...scope.assignedSubjects] : [],
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
