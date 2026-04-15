import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as signOutAuth,
  deleteUser,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { auth, firestore } from "../firebase";
import { recomputeSchoolCounts } from "./schoolDirectoryService";
import { setCachedUserScope } from "./userScopeCache";

const TEACHER_ROLES = ["class_teacher", "subject_teacher", "class_subject_teacher"];
const CREDENTIALS_COLLECTION = "teacherCredentials";

const normalizeSchoolId = (value) => String(value || "").trim().toLowerCase();

const normalizeStaffId = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-");

const normalizeAssignments = (items) => {
  if (!Array.isArray(items)) return [];
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
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

const expandAssignedSubjects = (items) => {
  const normalized = normalizeAssignments(items);
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

export const collapseAssignedSubjects = (items = []) => {
  const normalized = normalizeAssignments(items);
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

const buildAssignedSubjectTokens = (items) =>
  [...new Set(expandAssignedSubjects(items).map((item) => normalizeSubjectAccessToken(item)).filter(Boolean))];

const buildAssignedSubjectKeys = (schoolId, items) => {
  const expandedSubjects = expandAssignedSubjects(items);
  const exactValues = normalizeAssignments(expandedSubjects);
  const docIds = exactValues.flatMap((subject) => {
    const juniorId = buildSubjectCatalogDocId(schoolId, "junior", subject);
    const seniorId = buildSubjectCatalogDocId(schoolId, "senior", subject);
    return [juniorId, seniorId].filter(Boolean);
  });
  return [...new Set([...exactValues, ...docIds])];
};

const buildAssignedClassTokens = (items) =>
  [
    ...new Set(
      normalizeAssignments(items)
        .map((item) => normalizeClassAccessToken(item))
        .filter(Boolean)
    ),
  ];

const roleSupportsClassTeacher = (role) => {
  const normalizedRole = normalizeTeacherRole(role);
  return normalizedRole === "class_teacher" || normalizedRole === "class_subject_teacher";
};

const roleSupportsSubjectTeaching = (role) => {
  const normalizedRole = normalizeTeacherRole(role);
  return normalizedRole === "subject_teacher" || normalizedRole === "class_subject_teacher";
};

export const buildLegacySubjectAssignments = ({
  assignedClasses = [],
  assignedSubjects = [],
} = {}) => {
  const classIds = normalizeAssignments(assignedClasses);
  const subjectIds = collapseAssignedSubjects(assignedSubjects);
  if (classIds.length === 0 || subjectIds.length === 0) {
    return [];
  }
  return subjectIds.map((subjectId) => ({
    subjectId,
    classIds: [...classIds],
  }));
};

export const normalizeSubjectAssignments = (items = []) => {
  if (!Array.isArray(items)) return [];

  const grouped = new Map();

  items.forEach((item) => {
    const rawSubjectId =
      typeof item === "string"
        ? item
        : String(item?.subjectId || item?.subject || "").trim();
    const canonicalSubjectId = collapseAssignedSubjects([rawSubjectId])[0] || "";
    if (!canonicalSubjectId) return;

    const classIds = normalizeAssignments(
      typeof item === "string" ? [] : item?.classIds || item?.classes
    );
    if (classIds.length === 0) return;

    const subjectToken = normalizeSubjectAccessToken(canonicalSubjectId) || canonicalSubjectId;
    const current = grouped.get(subjectToken) || {
      subjectId: canonicalSubjectId,
      classIds: [],
    };

    current.subjectId =
      collapseAssignedSubjects([current.subjectId, canonicalSubjectId])[0] ||
      current.subjectId ||
      canonicalSubjectId;
    current.classIds = normalizeAssignments([...(current.classIds || []), ...classIds]);
    grouped.set(subjectToken, current);
  });

  return [...grouped.values()]
    .filter((item) => item.subjectId && item.classIds.length > 0)
    .sort((left, right) => String(left.subjectId || "").localeCompare(String(right.subjectId || "")));
};

export const buildAssignedSubjectClassKeys = (subjectAssignments = []) => {
  const normalizedAssignments = normalizeSubjectAssignments(subjectAssignments);
  const keys = [];

  normalizedAssignments.forEach(({ subjectId, classIds = [] }) => {
    const subjectValues = normalizeAssignments(expandAssignedSubjects([subjectId]));
    const subjectTokens = buildAssignedSubjectTokens([subjectId]);
    const exactClassIds = normalizeAssignments(classIds);
    const classTokens = buildAssignedClassTokens(exactClassIds);

    exactClassIds.forEach((classId) => {
      subjectValues.forEach((subjectValue) => {
        keys.push(`${classId}__${subjectValue}`);
        classTokens.forEach((classToken) => {
          keys.push(`${classToken}__${subjectValue}`);
        });
      });

      subjectTokens.forEach((subjectToken) => {
        keys.push(`${classId}__${subjectToken}`);
        classTokens.forEach((classToken) => {
          keys.push(`${classToken}__${subjectToken}`);
        });
      });
    });
  });

  return [...new Set(keys)].sort();
};

export const buildTeacherAssignmentPayload = ({
  schoolId,
  role,
  classTeacherClasses = [],
  subjectAssignments = [],
  assignedClasses = [],
  assignedSubjects = [],
} = {}) => {
  const resolvedRole = normalizeTeacherRole(role);
  const resolvedSchoolId = normalizeSchoolId(schoolId);
  const legacyAssignedClasses = normalizeAssignments(assignedClasses);
  const legacyAssignedSubjects = collapseAssignedSubjects(assignedSubjects);

  const explicitClassTeacherClasses = normalizeAssignments(classTeacherClasses);
  const explicitSubjectAssignments = normalizeSubjectAssignments(subjectAssignments);

  const normalizedClassTeacherClasses = roleSupportsClassTeacher(resolvedRole)
    ? explicitClassTeacherClasses.length > 0
      ? explicitClassTeacherClasses
      : legacyAssignedClasses
    : [];

  const normalizedSubjectAssignments = roleSupportsSubjectTeaching(resolvedRole)
    ? explicitSubjectAssignments.length > 0
      ? explicitSubjectAssignments
      : buildLegacySubjectAssignments({
          assignedClasses: legacyAssignedClasses,
          assignedSubjects: legacyAssignedSubjects,
        })
    : [];

  const recordClassIds = normalizeAssignments(
    normalizedSubjectAssignments.flatMap((assignment) => assignment.classIds || [])
  );
  const aggregateAssignedClasses = normalizeAssignments([
    ...normalizedClassTeacherClasses,
    ...recordClassIds,
  ]);
  const aggregateAssignedSubjects = collapseAssignedSubjects(
    normalizedSubjectAssignments.map((assignment) => assignment.subjectId)
  );

  return {
    classTeacherClasses: normalizedClassTeacherClasses,
    classTeacherClassTokens: buildAssignedClassTokens(normalizedClassTeacherClasses),
    subjectAssignments: normalizedSubjectAssignments,
    assignedClasses: aggregateAssignedClasses,
    assignedClassTokens: buildAssignedClassTokens(aggregateAssignedClasses),
    assignedSubjects: aggregateAssignedSubjects,
    assignedSubjectTokens: buildAssignedSubjectTokens(aggregateAssignedSubjects),
    assignedSubjectKeys: buildAssignedSubjectKeys(resolvedSchoolId, aggregateAssignedSubjects),
    assignedSubjectClassKeys: buildAssignedSubjectClassKeys(normalizedSubjectAssignments),
  };
};

const arraysMatch = (left = [], right = []) => {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
};

const normalizeTeacherRole = (role) => {
  const token = String(role || "").trim().toLowerCase();
  if (token === "teacher") return "class_subject_teacher";
  if (TEACHER_ROLES.includes(token)) return token;
  return null;
};

const ensurePin = (value) => {
  const pin = String(value || "").trim();
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("PIN must be exactly 4 digits.");
  }
  return pin;
};

// Firebase Auth requires password length >= 6.
// Teachers still use a 4-digit PIN in UI; we deterministically derive
// an internal auth password from school + staff + PIN.
const buildTeacherAuthPassword = (schoolId, staffId, pin) => {
  const schoolToken = normalizeSchoolId(schoolId).replace(/[^a-z0-9]/g, "");
  const staffToken = normalizeStaffId(staffId).toLowerCase().replace(/[^a-z0-9]/g, "");
  const compactSchool = (schoolToken || "school").slice(0, 20);
  const compactStaff = (staffToken || "staff").slice(0, 20);
  return `sc-${compactSchool}-${compactStaff}-${pin}!`;
};

const buildCredentialDocId = (schoolId, staffId) =>
  `${normalizeSchoolId(schoolId)}__${normalizeStaffId(staffId)}`;

const buildEmailToken = (schoolId, staffId, version = 1) => {
  const schoolToken = normalizeSchoolId(schoolId).replace(/[^a-z0-9]/g, "");
  const staffToken = normalizeStaffId(staffId).toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeSchool = schoolToken || "school";
  const safeStaff = staffToken || "staff";
  return `t_${safeSchool}_${safeStaff}_v${version}`;
};

const buildTeacherEmail = (schoolId, staffId, version = 1) =>
  `${buildEmailToken(schoolId, staffId, version)}@teachers.scoorla.app`;

const createSecondaryAuth = () => {
  const uniqueName = `teacher-provision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const app = initializeApp(auth.app.options, uniqueName);
  const secondaryAuth = getAuth(app);
  const cleanup = async () => {
    try {
      await deleteApp(app);
    } catch {
      // no-op
    }
  };
  return { secondaryAuth, cleanup };
};

const generateRandomDigits = (length) =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");

export const generateTeacherStaffId = (prefix = "STF") => {
  const safePrefix = String(prefix || "STF")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return `${safePrefix || "STF"}-${generateRandomDigits(4)}`;
};

export const generateTeacherPin = () => generateRandomDigits(4);

const ensureTeacherProfile = (userData, schoolId) => {
  if (!userData) {
    throw new Error("Teacher profile not found.");
  }
  if (String(userData.schoolId || "").trim().toLowerCase() !== normalizeSchoolId(schoolId)) {
    throw new Error("Teacher does not belong to this school.");
  }
  return userData;
};

export const listTeachers = async (schoolId, options = {}) => {
  const resolvedSchoolId = normalizeSchoolId(schoolId);
  if (!resolvedSchoolId) throw new Error("schoolId is required");

  const includeInactive = !!options?.includeInactive;
  const q = query(collection(firestore, "users"), where("schoolId", "==", resolvedSchoolId));
  const snapshot = await getDocs(q);

  const teachers = snapshot.docs
    .map((item) => {
      const data = item.data() || {};
      const assignmentPayload = buildTeacherAssignmentPayload({
        schoolId: resolvedSchoolId,
        role: data?.role,
        classTeacherClasses: data?.classTeacherClasses,
        subjectAssignments: data?.subjectAssignments,
        assignedClasses: data?.assignedClasses,
        assignedSubjects: data?.assignedSubjects,
      });
      return {
        id: item.id,
        ...data,
        ...assignmentPayload,
      };
    })
    .filter((item) => TEACHER_ROLES.includes(String(item?.role || "").trim().toLowerCase()))
    .filter((item) => includeInactive || item?.isActive !== false)
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));

  return teachers;
};

export const createTeacher = async ({
  schoolId,
  name,
  staffId,
  pin,
  role,
  classTeacherClasses = [],
  subjectAssignments = [],
  assignedClasses = [],
  assignedSubjects = [],
} = {}) => {
  const resolvedSchoolId = normalizeSchoolId(schoolId);
  if (!resolvedSchoolId) throw new Error("schoolId is required");

  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("Teacher name is required.");

  const resolvedStaffId = normalizeStaffId(staffId || generateTeacherStaffId());
  if (!resolvedStaffId) throw new Error("staffId is required");

  const resolvedRole = normalizeTeacherRole(role);
  if (!resolvedRole) throw new Error("Invalid teacher role.");

  const resolvedPin = ensurePin(pin || generateTeacherPin());
  const resolvedAuthPassword = buildTeacherAuthPassword(
    resolvedSchoolId,
    resolvedStaffId,
    resolvedPin
  );
  const credentialId = buildCredentialDocId(resolvedSchoolId, resolvedStaffId);
  const credentialRef = doc(firestore, CREDENTIALS_COLLECTION, credentialId);
  const existingCredential = await getDoc(credentialRef);
  if (existingCredential.exists() && existingCredential.data()?.isActive !== false) {
    throw new Error("A teacher with this Staff ID already exists.");
  }

  const startVersion = Number(existingCredential.data()?.version || 0) + 1;
  const { secondaryAuth, cleanup } = createSecondaryAuth();
  let createdUser = null;

  try {
    let email = "";
    let version = startVersion;
    let userCredential = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      version = startVersion + attempt;
      email = buildTeacherEmail(resolvedSchoolId, resolvedStaffId, version);
      try {
        userCredential = await createUserWithEmailAndPassword(
          secondaryAuth,
          email,
          resolvedAuthPassword
        );
        break;
      } catch (error) {
        if (error?.code === "auth/email-already-in-use") {
          continue;
        }
        throw error;
      }
    }
    if (!userCredential) {
      throw new Error("Unable to allocate teacher auth identity. Please retry.");
    }
    createdUser = userCredential.user;

    const batch = writeBatch(firestore);
    const userRef = doc(firestore, "users", createdUser.uid);
    const assignmentPayload = buildTeacherAssignmentPayload({
      schoolId: resolvedSchoolId,
      role: resolvedRole,
      classTeacherClasses,
      subjectAssignments,
      assignedClasses,
      assignedSubjects,
    });
    batch.set(userRef, {
      uid: createdUser.uid,
      email,
      name: trimmedName,
      schoolId: resolvedSchoolId,
      staffId: resolvedStaffId,
      role: resolvedRole,
      ...assignmentPayload,
      isActive: true,
      authType: "teacher_staff_pin",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(
      credentialRef,
      {
        credentialId,
        schoolId: resolvedSchoolId,
        staffId: resolvedStaffId,
        uid: createdUser.uid,
        email,
        role: resolvedRole,
        name: trimmedName,
        version,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await batch.commit();
    try {
      await recomputeSchoolCounts(resolvedSchoolId);
    } catch (countError) {
      console.warn("Teacher count refresh failed:", countError?.message || countError);
    }

    return {
      uid: createdUser.uid,
      schoolId: resolvedSchoolId,
      staffId: resolvedStaffId,
      pin: resolvedPin,
      role: resolvedRole,
      email,
    };
  } catch (error) {
    if (createdUser) {
      try {
        await deleteUser(createdUser);
      } catch {
        // no-op cleanup
      }
    }
    throw error;
  } finally {
    try {
      await signOutAuth(secondaryAuth);
    } catch {
      // no-op
    }
    await cleanup();
  }
};

export const updateTeacher = async ({
  schoolId,
  teacherUserId,
  name,
  role,
  classTeacherClasses = [],
  subjectAssignments = [],
  assignedClasses = [],
  assignedSubjects = [],
  isActive = true,
} = {}) => {
  const resolvedSchoolId = normalizeSchoolId(schoolId);
  if (!resolvedSchoolId) throw new Error("schoolId is required");
  if (!teacherUserId) throw new Error("teacherUserId is required");

  const userRef = doc(firestore, "users", teacherUserId);
  const userSnap = await getDoc(userRef);
  const userData = ensureTeacherProfile(userSnap.data(), resolvedSchoolId);

  const nextRole = normalizeTeacherRole(role || userData.role);
  if (!nextRole) throw new Error("Invalid teacher role.");

  const trimmedName = String(name || userData.name || "").trim();
  if (!trimmedName) throw new Error("Teacher name is required.");

  const credentialId = buildCredentialDocId(resolvedSchoolId, userData.staffId);
  const credentialRef = doc(firestore, CREDENTIALS_COLLECTION, credentialId);

  const batch = writeBatch(firestore);
  const assignmentPayload = buildTeacherAssignmentPayload({
    schoolId: resolvedSchoolId,
    role: nextRole,
    classTeacherClasses,
    subjectAssignments,
    assignedClasses,
    assignedSubjects,
  });
  batch.update(userRef, {
    name: trimmedName,
    role: nextRole,
    ...assignmentPayload,
    isActive: !!isActive,
    updatedAt: serverTimestamp(),
  });
  batch.set(
    credentialRef,
    {
      name: trimmedName,
      role: nextRole,
      isActive: !!isActive,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await batch.commit();
  try {
    await recomputeSchoolCounts(resolvedSchoolId);
  } catch (countError) {
    console.warn("Teacher count refresh failed:", countError?.message || countError);
  }
};

export const resetTeacherPin = async ({
  schoolId,
  teacherUserId,
  newPin,
} = {}) => {
  const resolvedSchoolId = normalizeSchoolId(schoolId);
  if (!resolvedSchoolId) throw new Error("schoolId is required");
  if (!teacherUserId) throw new Error("teacherUserId is required");

  const userRef = doc(firestore, "users", teacherUserId);
  const userSnap = await getDoc(userRef);
  const userData = ensureTeacherProfile(userSnap.data(), resolvedSchoolId);
  if (userData.isActive === false) {
    throw new Error("Teacher account is inactive.");
  }

  const resolvedPin = ensurePin(newPin || generateTeacherPin());
  const resolvedAuthPassword = buildTeacherAuthPassword(
    resolvedSchoolId,
    userData.staffId,
    resolvedPin
  );
  const credentialId = buildCredentialDocId(resolvedSchoolId, userData.staffId);
  const credentialRef = doc(firestore, CREDENTIALS_COLLECTION, credentialId);
  const credentialSnap = await getDoc(credentialRef);
  const currentVersion = Number(credentialSnap.data()?.version || 0);
  const nextVersion = currentVersion + 1;

  const { secondaryAuth, cleanup } = createSecondaryAuth();
  let createdUser = null;

  try {
    let email = "";
    let version = nextVersion;
    let userCredential = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      version = nextVersion + attempt;
      email = buildTeacherEmail(resolvedSchoolId, userData.staffId, version);
      try {
        userCredential = await createUserWithEmailAndPassword(
          secondaryAuth,
          email,
          resolvedAuthPassword
        );
        break;
      } catch (error) {
        if (error?.code === "auth/email-already-in-use") {
          continue;
        }
        throw error;
      }
    }
    if (!userCredential) {
      throw new Error("Unable to reset PIN due to credential version conflict. Retry.");
    }
    createdUser = userCredential.user;

    const newUserRef = doc(firestore, "users", createdUser.uid);
    const batch = writeBatch(firestore);
    batch.set(newUserRef, {
      ...userData,
      uid: createdUser.uid,
      email,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      replacedUserId: teacherUserId,
    });
    batch.update(userRef, {
      isActive: false,
      replacedByUserId: createdUser.uid,
      updatedAt: serverTimestamp(),
    });
    batch.set(
      credentialRef,
      {
        uid: createdUser.uid,
        email,
        version,
        isActive: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await batch.commit();

    return {
      teacherUserId: createdUser.uid,
      schoolId: resolvedSchoolId,
      pin: resolvedPin,
    };
  } catch (error) {
    if (createdUser) {
      try {
        await deleteUser(createdUser);
      } catch {
        // no-op cleanup
      }
    }
    throw error;
  } finally {
    try {
      await signOutAuth(secondaryAuth);
    } catch {
      // no-op
    }
    await cleanup();
  }
};

export const deleteTeacher = async ({ schoolId, teacherUserId } = {}) => {
  const resolvedSchoolId = normalizeSchoolId(schoolId);
  if (!resolvedSchoolId) throw new Error("schoolId is required");
  if (!teacherUserId) throw new Error("teacherUserId is required");

  const userRef = doc(firestore, "users", teacherUserId);
  const userSnap = await getDoc(userRef);
  const userData = ensureTeacherProfile(userSnap.data(), resolvedSchoolId);
  const credentialId = buildCredentialDocId(resolvedSchoolId, userData.staffId);
  const credentialRef = doc(firestore, CREDENTIALS_COLLECTION, credentialId);

  const batch = writeBatch(firestore);
  batch.update(userRef, {
    isActive: false,
    classTeacherClasses: [],
    classTeacherClassTokens: [],
    subjectAssignments: [],
    assignedClasses: [],
    assignedClassTokens: [],
    assignedSubjects: [],
    assignedSubjectTokens: [],
    assignedSubjectKeys: [],
    assignedSubjectClassKeys: [],
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(
    credentialRef,
    {
      isActive: false,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await batch.commit();
  try {
    await recomputeSchoolCounts(resolvedSchoolId);
  } catch (countError) {
    console.warn("Teacher count refresh failed:", countError?.message || countError);
  }
};

export const loginTeacherWithStaffCredentials = async ({
  schoolId,
  staffId,
  pin,
} = {}) => {
  const resolvedSchoolId = normalizeSchoolId(schoolId);
  const resolvedStaffId = normalizeStaffId(staffId);
  const resolvedPin = ensurePin(pin);

  if (!resolvedSchoolId || !resolvedStaffId) {
    throw new Error("School ID and Staff ID are required.");
  }

  const credentialId = buildCredentialDocId(resolvedSchoolId, resolvedStaffId);
  const credentialRef = doc(firestore, CREDENTIALS_COLLECTION, credentialId);
  const credentialSnap = await getDoc(credentialRef);
  if (!credentialSnap.exists()) {
    throw new Error("Teacher credentials not found.");
  }
  const credential = credentialSnap.data();
  if (credential.isActive === false) {
    throw new Error("Teacher account is inactive.");
  }

  const teacherEmail = String(credential.email || "").trim();
  if (!teacherEmail) {
    throw new Error("Teacher credential mapping is incomplete.");
  }
  const credentialStaffId = String(credential.staffId || resolvedStaffId);
  const resolvedAuthPassword = buildTeacherAuthPassword(
    resolvedSchoolId,
    credentialStaffId,
    resolvedPin
  );

  const authCredential = await signInWithEmailAndPassword(
    auth,
    teacherEmail,
    resolvedAuthPassword
  );
  const signedInUid = authCredential.user?.uid;
  const mappedUid = String(credential.uid || "").trim();
  if (!signedInUid || !mappedUid || signedInUid !== mappedUid) {
    await signOutAuth(auth);
    throw new Error("Credential mapping mismatch. Contact your administrator.");
  }

  const userSnap = await getDoc(doc(firestore, "users", signedInUid));
  if (!userSnap.exists()) {
    await signOutAuth(auth);
    throw new Error("Teacher profile not found.");
  }
  let userData = userSnap.data() || {};
  if (
    String(userData.schoolId || "").trim().toLowerCase() !== resolvedSchoolId ||
    userData.isActive === false
  ) {
    await signOutAuth(auth);
    throw new Error("Teacher account is not active for this school.");
  }
  const assignmentPayload = buildTeacherAssignmentPayload({
    schoolId: userData.schoolId || resolvedSchoolId,
    role: userData.role,
    classTeacherClasses: userData.classTeacherClasses,
    subjectAssignments: userData.subjectAssignments,
    assignedClasses: userData.assignedClasses,
    assignedSubjects: userData.assignedSubjects,
  });
  const currentManagedClasses = normalizeAssignments(userData.classTeacherClasses).sort();
  const currentManagedClassTokens = normalizeAssignments(userData.classTeacherClassTokens)
    .map((item) => normalizeClassAccessToken(item))
    .filter(Boolean)
    .sort();
  const currentAssignedClassTokens = normalizeAssignments(userData.assignedClassTokens)
    .map((item) => normalizeClassAccessToken(item))
    .filter(Boolean)
    .sort();
  const currentAssignedSubjects = normalizeAssignments(userData.assignedSubjects).sort();
  const currentAssignedSubjectTokens = normalizeAssignments(userData.assignedSubjectTokens)
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean)
    .sort();
  const currentAssignedSubjectKeys = normalizeAssignments(userData.assignedSubjectKeys).sort();
  const currentAssignedSubjectClassKeys = normalizeAssignments(userData.assignedSubjectClassKeys).sort();
  const currentSubjectAssignments = normalizeSubjectAssignments(userData.subjectAssignments)
    .map((item) => JSON.stringify(item))
    .sort();
  const nextManagedClasses = [...assignmentPayload.classTeacherClasses].sort();
  const nextManagedClassTokens = [...assignmentPayload.classTeacherClassTokens].sort();
  const nextAssignedSubjects = [...assignmentPayload.assignedSubjects].sort();
  const nextAssignedClassTokens = [...assignmentPayload.assignedClassTokens].sort();
  const nextAssignedSubjectTokens = [...assignmentPayload.assignedSubjectTokens].sort();
  const nextAssignedSubjectKeys = [...assignmentPayload.assignedSubjectKeys].sort();
  const nextAssignedSubjectClassKeys = [...assignmentPayload.assignedSubjectClassKeys].sort();
  const nextSubjectAssignments = normalizeSubjectAssignments(assignmentPayload.subjectAssignments)
    .map((item) => JSON.stringify(item))
    .sort();

  if (
    !arraysMatch(currentManagedClasses, nextManagedClasses) ||
    !arraysMatch(currentManagedClassTokens, nextManagedClassTokens) ||
    !arraysMatch(currentAssignedClassTokens, nextAssignedClassTokens) ||
    !arraysMatch(currentAssignedSubjects, nextAssignedSubjects) ||
    !arraysMatch(currentAssignedSubjectTokens, nextAssignedSubjectTokens) ||
    !arraysMatch(currentAssignedSubjectKeys, nextAssignedSubjectKeys) ||
    !arraysMatch(currentAssignedSubjectClassKeys, nextAssignedSubjectClassKeys) ||
    !arraysMatch(currentSubjectAssignments, nextSubjectAssignments)
  ) {
    await setDoc(
      doc(firestore, "users", signedInUid),
      {
        classTeacherClasses: assignmentPayload.classTeacherClasses,
        classTeacherClassTokens: assignmentPayload.classTeacherClassTokens,
        subjectAssignments: assignmentPayload.subjectAssignments,
        assignedClasses: assignmentPayload.assignedClasses,
        assignedClassTokens: nextAssignedClassTokens,
        assignedSubjects: nextAssignedSubjects,
        assignedSubjectTokens: nextAssignedSubjectTokens,
        assignedSubjectKeys: nextAssignedSubjectKeys,
        assignedSubjectClassKeys: nextAssignedSubjectClassKeys,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    userData = {
      ...userData,
      classTeacherClasses: assignmentPayload.classTeacherClasses,
      classTeacherClassTokens: assignmentPayload.classTeacherClassTokens,
      subjectAssignments: assignmentPayload.subjectAssignments,
      assignedClasses: assignmentPayload.assignedClasses,
      assignedClassTokens: nextAssignedClassTokens,
      assignedSubjects: nextAssignedSubjects,
      assignedSubjectTokens: nextAssignedSubjectTokens,
      assignedSubjectKeys: nextAssignedSubjectKeys,
      assignedSubjectClassKeys: nextAssignedSubjectClassKeys,
    };
  }

  setCachedUserScope(signedInUid, userData);
  if (!TEACHER_ROLES.includes(String(userData.role || "").trim().toLowerCase())) {
    await signOutAuth(auth);
    throw new Error("Teacher role is not configured.");
  }

  // Keep account status and online telemetry separate.
  await setDoc(
    doc(firestore, "users", signedInUid),
    {
      isOnline: true,
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return {
    uid: signedInUid,
    role: userData.role,
    schoolId: userData.schoolId,
    staffId: userData.staffId || resolvedStaffId,
    name: userData.name || "",
  };
};


