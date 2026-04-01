import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { firestore } from "../firebase";
import { instrumentFirestoreRead, instrumentFirestoreWrite } from "../services/firestoreInstrumentation";
import { invalidateCachePrefix } from "../services/dataCache";

const ACTIVE_SCHOOL_STATUSES = ["active", "disabled", "trial", "archived"];
const TEACHER_ROLES = new Set([
  "class_teacher",
  "subject_teacher",
  "class_subject_teacher",
  "teacher",
]);
const ACTIVITY_TOUCH_PREFIX = "school_activity_touch_";
const ACTIVITY_TOUCH_WINDOW_MS = 5 * 60 * 1000;
const SEARCH_PREFIX_LIMIT = 24;
const SEARCH_TOKEN_LIMIT = 12;

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") {
    const nanos = typeof value?.nanoseconds === "number" ? value.nanoseconds : 0;
    return value.seconds * 1000 + Math.floor(nanos / 1_000_000);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSearchValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const addPrefixes = (target, value, maxLength = SEARCH_PREFIX_LIMIT) => {
  const normalized = normalizeSearchValue(value);
  if (!normalized) return;
  for (let index = 2; index <= Math.min(normalized.length, maxLength); index += 1) {
    target.add(normalized.slice(0, index));
  }
};

const addTokenPrefixes = (target, value) => {
  const normalized = normalizeSearchValue(value);
  if (!normalized) return;
  normalized
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .forEach((token) => {
      for (let index = 2; index <= Math.min(token.length, SEARCH_TOKEN_LIMIT); index += 1) {
        target.add(token.slice(0, index));
      }
    });
};

export const normalizeSchoolSearchTerm = (value) =>
  normalizeSearchValue(value).slice(0, SEARCH_PREFIX_LIMIT);

export const buildSchoolSearchIndex = (schoolData = {}) => {
  const nameLower = normalizeSearchValue(schoolData?.name);
  const schoolCodeLower = normalizeSearchValue(schoolData?.schoolCode || schoolData?.schoolId);
  const emailLower = normalizeSearchValue(schoolData?.email);
  const prefixes = new Set();

  [nameLower, schoolCodeLower, emailLower].forEach((entry) => {
    addPrefixes(prefixes, entry, SEARCH_PREFIX_LIMIT);
    addTokenPrefixes(prefixes, entry);
  });

  return {
    nameLower,
    schoolCodeLower,
    emailLower,
    prefixes: [...prefixes].sort(),
  };
};

export const normalizeSchoolStatus = (value) => {
  const token = String(value || "")
    .trim()
    .toLowerCase();
  return ACTIVE_SCHOOL_STATUSES.includes(token) ? token : "active";
};

export const getDefaultSchoolCounts = () => ({
  students: 0,
  teachers: 0,
  enrollments: 0,
});

export const getDefaultSupportFlags = () => ({
  needsHelp: false,
  onboardingIncomplete: false,
});

export const isSchoolDisabledStatus = (value) => normalizeSchoolStatus(value) === "disabled";

export const normalizeSchoolDirectoryRecord = (schoolId, schoolData = {}, settings = {}) => {
  const resolvedSchoolId = String(
    schoolId || schoolData?.schoolId || settings?.schoolId || ""
  ).trim();
  const counts = {
    ...getDefaultSchoolCounts(),
    ...(schoolData?.counts || {}),
  };
  const supportFlags = {
    ...getDefaultSupportFlags(),
    ...(schoolData?.supportFlags || {}),
  };
  const notes = {
    internal: String(schoolData?.notes?.internal || "").trim(),
  };

  return {
    schoolId: resolvedSchoolId,
    name: String(schoolData?.name || "").trim(),
    schoolCode:
      String(schoolData?.schoolCode || "").trim() ||
      resolvedSchoolId ||
      String(schoolData?.name || "").trim(),
    status: normalizeSchoolStatus(schoolData?.status),
    createdAt: schoolData?.createdAt || null,
    updatedAt: schoolData?.updatedAt || null,
    lastActiveAt: schoolData?.lastActiveAt || null,
    activeSessionId:
      String(
        schoolData?.activeSessionId || settings?.activeSessionId || ""
      ).trim() || null,
    activeTermId:
      String(schoolData?.activeTermId || settings?.activeTermId || "").trim() || "term1",
    activeTermDocId:
      String(
        schoolData?.activeTermDocId || settings?.activeTermDocId || ""
      ).trim() || null,
    counts: {
      students: Number(counts.students) || 0,
      teachers: Number(counts.teachers) || 0,
      enrollments: Number(counts.enrollments) || 0,
    },
    supportFlags: {
      needsHelp: supportFlags.needsHelp === true,
      onboardingIncomplete: supportFlags.onboardingIncomplete === true,
    },
    notes,
    email: String(schoolData?.email || "").trim(),
    phone: String(schoolData?.phone || "").trim(),
    address: String(schoolData?.address || "").trim(),
    logo: String(schoolData?.logo || "").trim(),
    motto: String(schoolData?.motto || "").trim(),
    searchIndex: schoolData?.searchIndex || buildSchoolSearchIndex({
      schoolId: resolvedSchoolId,
      name: schoolData?.name,
      schoolCode: schoolData?.schoolCode || resolvedSchoolId,
      email: schoolData?.email,
    }),
    lastActiveAtMs: toMillis(schoolData?.lastActiveAt),
    createdAtMs: toMillis(schoolData?.createdAt),
  };
};

export async function loadSchoolDirectoryRecord(schoolId) {
  const resolvedSchoolId = String(schoolId || "").trim();
  if (!resolvedSchoolId) {
    return null;
  }

  const [schoolSnap, settingsSnap] = await Promise.all([
    instrumentFirestoreRead(
      getDoc(doc(firestore, "schools", resolvedSchoolId)),
      { screen: "schoolDirectoryService", action: "load_school_doc", target: `schools/${resolvedSchoolId}` }
    ),
    instrumentFirestoreRead(
      getDoc(doc(firestore, "settings", resolvedSchoolId)),
      { screen: "schoolDirectoryService", action: "load_settings_doc", target: `settings/${resolvedSchoolId}` }
    ),
  ]);

  if (!schoolSnap.exists() && !settingsSnap.exists()) {
    return null;
  }

  const schoolData = schoolSnap.exists() ? schoolSnap.data() || {} : {};
  const settings = settingsSnap.exists() ? settingsSnap.data() || {} : {};

  return normalizeSchoolDirectoryRecord(resolvedSchoolId, schoolData, settings);
}

export async function touchSchoolLastActive(schoolId, options = {}) {
  const resolvedSchoolId = String(schoolId || "").trim();
  if (!resolvedSchoolId) return;

  const forceTouch = options?.force === true;
  if (!forceTouch && typeof window !== "undefined") {
    const cacheKey = `${ACTIVITY_TOUCH_PREFIX}${resolvedSchoolId}`;
    try {
      const lastTouched = Number(sessionStorage.getItem(cacheKey) || 0);
      if (lastTouched && Date.now() - lastTouched < ACTIVITY_TOUCH_WINDOW_MS) {
        return;
      }
      sessionStorage.setItem(cacheKey, String(Date.now()));
    } catch {
      // no-op
    }
  }

  const schoolRef = doc(firestore, "schools", resolvedSchoolId);
  const schoolSnap = await instrumentFirestoreRead(
    getDoc(schoolRef),
    { screen: "schoolDirectoryService", action: "touch_school_read", target: `schools/${resolvedSchoolId}` }
  );
  const current = schoolSnap.exists() ? schoolSnap.data() || {} : {};
  const normalized = normalizeSchoolDirectoryRecord(resolvedSchoolId, current);

  await instrumentFirestoreWrite(
    setDoc(
      schoolRef,
      {
        schoolId: resolvedSchoolId,
        schoolCode: normalized.schoolCode,
        name: normalized.name,
        email: normalized.email,
        searchIndex: buildSchoolSearchIndex(normalized),
        status: normalized.status,
        supportFlags: normalized.supportFlags,
        counts: normalized.counts,
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(current?.createdAt ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    ),
    { screen: "schoolDirectoryService", action: "touch_school_write", target: `schools/${resolvedSchoolId}`, count: 1 }
  );
}

export async function applySchoolCountDelta(schoolId, delta = {}) {
  const resolvedSchoolId = String(schoolId || "").trim();
  if (!resolvedSchoolId) return;

  const studentDelta = Number(delta?.students || 0);
  const teacherDelta = Number(delta?.teachers || 0);
  const enrollmentDelta = Number(delta?.enrollments || 0);
  if (!studentDelta && !teacherDelta && !enrollmentDelta) {
    return;
  }

  const schoolRef = doc(firestore, "schools", resolvedSchoolId);
  await instrumentFirestoreWrite(
    setDoc(
      schoolRef,
      {
        schoolId: resolvedSchoolId,
        counts: {
          ...(studentDelta ? { students: increment(studentDelta) } : {}),
          ...(teacherDelta ? { teachers: increment(teacherDelta) } : {}),
          ...(enrollmentDelta ? { enrollments: increment(enrollmentDelta) } : {}),
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ),
    {
      screen: "schoolDirectoryService",
      action: "apply_count_delta",
      target: `schools/${resolvedSchoolId}`,
      count: 1,
    }
  );
  invalidateCachePrefix(`session_dashboard_stats::${resolvedSchoolId}::`);
}

export async function recomputeSchoolCounts(schoolId, options = {}) {
  const resolvedSchoolId = String(schoolId || "").trim();
  if (!resolvedSchoolId) {
    throw new Error("schoolId is required");
  }

  const persist = options?.persist !== false;
  const schoolRef = doc(firestore, "schools", resolvedSchoolId);

  const [schoolSnap, studentsSnap, enrollmentsSnap, usersSnap] = await Promise.all([
    instrumentFirestoreRead(getDoc(schoolRef), {
      screen: "schoolDirectoryService",
      action: "recompute_read_school",
      target: `schools/${resolvedSchoolId}`,
    }),
    instrumentFirestoreRead(
      getDocs(query(collection(firestore, "students"), where("schoolId", "==", resolvedSchoolId))),
      {
        screen: "schoolDirectoryService",
        action: "recompute_read_students",
        target: "students",
      }
    ),
    instrumentFirestoreRead(
      getDocs(
        query(collection(firestore, "enrollments"), where("schoolId", "==", resolvedSchoolId))
      ),
      {
        screen: "schoolDirectoryService",
        action: "recompute_read_enrollments",
        target: "enrollments",
      }
    ),
    instrumentFirestoreRead(
      getDocs(query(collection(firestore, "users"), where("schoolId", "==", resolvedSchoolId))),
      {
        screen: "schoolDirectoryService",
        action: "recompute_read_users",
        target: "users",
      }
    ),
  ]);

  const schoolData = schoolSnap.exists() ? schoolSnap.data() || {} : {};
  const normalizedSchool = normalizeSchoolDirectoryRecord(resolvedSchoolId, schoolData);

  const studentCount = studentsSnap.docs.filter((row) => {
    const data = row.data() || {};
    const status = String(
      data?.status || (data?.isDeleted ? "archived" : "active")
    ).toLowerCase();
    return status !== "archived" && data?.isDeleted !== true;
  }).length;

  const teacherCount = usersSnap.docs.filter((row) => {
    const data = row.data() || {};
    const role = String(data?.role || "")
      .trim()
      .toLowerCase();
    return TEACHER_ROLES.has(role) && data?.isActive !== false;
  }).length;

  const counts = {
    students: studentCount,
    teachers: teacherCount,
    enrollments: enrollmentsSnap.size,
  };

  if (persist) {
    await instrumentFirestoreWrite(
      setDoc(
        schoolRef,
        {
          schoolId: resolvedSchoolId,
          schoolCode: normalizedSchool.schoolCode,
          status: normalizedSchool.status,
          supportFlags: normalizedSchool.supportFlags,
          counts,
          updatedAt: serverTimestamp(),
          ...(schoolData?.createdAt ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true }
      ),
      {
        screen: "schoolDirectoryService",
        action: "recompute_write_counts",
        target: `schools/${resolvedSchoolId}`,
        count: 1,
      }
    );
    invalidateCachePrefix(`session_dashboard_stats::${resolvedSchoolId}::`);
  }

  return counts;
}
