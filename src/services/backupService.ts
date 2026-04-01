import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, firestore } from "../firebase";

const BACKUP_TYPES = new Set(["pre_promotion", "pre_term_switch", "pre_restore"]);
const MAX_BACKUPS_PER_SCHOOL = 6;
const BATCH_WRITE_LIMIT = 400;
const DELETE_PAGE_SIZE = 200;

const normalizeToken = (value: any) => String(value || "").trim();

const normalizeTermAlias = (value: any) => {
  const token = normalizeToken(value)
    .toLowerCase()
    .replace(/\s+/g, "");
  if (["term1", "1", "1stterm", "firstterm"].includes(token)) return "term1";
  if (["term2", "2", "2ndterm", "secondterm"].includes(token)) return "term2";
  if (["term3", "3", "3rdterm", "thirdterm"].includes(token)) return "term3";
  return token || "term1";
};

const sanitizeScoreKey = (value: any) =>
  encodeURIComponent(String(value || ""))
    .replace(/%/g, "_")
    .replace(/\./g, "_");

const buildDeterministicScoreId = (enrollmentId: any, termId: any, subjectId: any) =>
  `${String(enrollmentId || "").trim()}__${normalizeTermAlias(termId)}__${sanitizeScoreKey(
    subjectId
  )}`;

const chunkArray = <T,>(items: T[], size: number) => {
  const chunkSize = Math.max(1, Number(size) || 1);
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const toMillis = (value: any) => {
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

const getBackupCollection = (schoolId: string) =>
  collection(firestore, "schools", schoolId, "backups");

const getPayloadCollection = (schoolId: string, backupId: string) =>
  collection(firestore, "schools", schoolId, "backups", backupId, "payload");

const getEnrollmentsRowsCollection = (schoolId: string, backupId: string) =>
  collection(
    firestore,
    "schools",
    schoolId,
    "backups",
    backupId,
    "payload",
    "enrollments",
    "rows"
  );

const getScoresRowsCollection = (schoolId: string, backupId: string) =>
  collection(firestore, "schools", schoolId, "backups", backupId, "payload", "scores", "rows");

const getRestoreRequestsCollection = (schoolId: string) =>
  collection(firestore, "schools", schoolId, "restoreRequests");

const buildSettingsSnapshot = (settings: Record<string, any>) => ({
  activeSessionId: normalizeToken(settings?.activeSessionId),
  activeTermId: normalizeTermAlias(settings?.activeTermId),
  activeTermDocId: normalizeToken(settings?.activeTermDocId),
  initialSessionName: normalizeToken(settings?.initialSessionName),
  initialTermId: normalizeToken(settings?.initialTermId),
  academicCycleEditLocked: settings?.academicCycleEditLocked === true,
  academicCycleEditLockedAt: settings?.academicCycleEditLockedAt || null,
});

const buildSettingsRestorePayload = (snapshot: Record<string, any>) => ({
  activeSessionId: normalizeToken(snapshot?.activeSessionId) || null,
  activeTermId: normalizeTermAlias(snapshot?.activeTermId || "term1"),
  activeTermDocId: normalizeToken(snapshot?.activeTermDocId) || null,
  initialSessionName: normalizeToken(snapshot?.initialSessionName) || "",
  initialTermId: normalizeToken(snapshot?.initialTermId) || "",
  academicCycleEditLocked: snapshot?.academicCycleEditLocked === true,
  academicCycleEditLockedAt: snapshot?.academicCycleEditLockedAt || null,
});

const safeGetScopedDocs = async ({
  primaryQuery,
  fallbackQuery,
  filter,
}: {
  primaryQuery: any;
  fallbackQuery: any;
  filter: (row: Record<string, any>) => boolean;
}) => {
  try {
    const primarySnap = await getDocs(primaryQuery);
    return primarySnap.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((row) => filter(row));
  } catch (error: any) {
    const code = String(error?.code || "");
    if (!code.includes("failed-precondition")) {
      throw error;
    }
    const fallbackSnap = await getDocs(fallbackQuery);
    return fallbackSnap.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((row) => filter(row));
  }
};

const getScopedEnrollments = async ({
  schoolId,
  sessionId,
  classId,
}: {
  schoolId: string;
  sessionId: string;
  classId?: string | null;
}) => {
  const normalizedSchoolId = normalizeToken(schoolId);
  const normalizedSessionId = normalizeToken(sessionId);
  const normalizedClassId = normalizeToken(classId);
  const primary = normalizedClassId
    ? query(
        collection(firestore, "enrollments"),
        where("schoolId", "==", normalizedSchoolId),
        where("sessionId", "==", normalizedSessionId),
        where("classId", "==", normalizedClassId)
      )
    : query(
        collection(firestore, "enrollments"),
        where("schoolId", "==", normalizedSchoolId),
        where("sessionId", "==", normalizedSessionId)
      );
  const fallback = query(collection(firestore, "enrollments"), where("schoolId", "==", normalizedSchoolId));
  return safeGetScopedDocs({
    primaryQuery: primary,
    fallbackQuery: fallback,
    filter: (row) =>
      normalizeToken(row?.schoolId) === normalizedSchoolId &&
      normalizeToken(row?.sessionId) === normalizedSessionId &&
      (!normalizedClassId || normalizeToken(row?.classId) === normalizedClassId),
  });
};

const getScopedScores = async ({
  schoolId,
  sessionId,
  termId,
  classId,
}: {
  schoolId: string;
  sessionId: string;
  termId: string;
  classId?: string | null;
}) => {
  const normalizedSchoolId = normalizeToken(schoolId);
  const normalizedSessionId = normalizeToken(sessionId);
  const normalizedTermId = normalizeTermAlias(termId);
  const normalizedClassId = normalizeToken(classId);
  const primary = normalizedClassId
    ? query(
        collection(firestore, "scores"),
        where("schoolId", "==", normalizedSchoolId),
        where("sessionId", "==", normalizedSessionId),
        where("termId", "==", normalizedTermId),
        where("classId", "==", normalizedClassId)
      )
    : query(
        collection(firestore, "scores"),
        where("schoolId", "==", normalizedSchoolId),
        where("sessionId", "==", normalizedSessionId),
        where("termId", "==", normalizedTermId)
      );
  const fallback = query(collection(firestore, "scores"), where("schoolId", "==", normalizedSchoolId));
  return safeGetScopedDocs({
    primaryQuery: primary,
    fallbackQuery: fallback,
    filter: (row) =>
      normalizeToken(row?.schoolId) === normalizedSchoolId &&
      normalizeToken(row?.sessionId) === normalizedSessionId &&
      normalizeTermAlias(row?.termId) === normalizedTermId &&
      (!normalizedClassId || normalizeToken(row?.classId) === normalizedClassId),
  });
};

const commitOperations = async (operations: any[]) => {
  if (!Array.isArray(operations) || operations.length === 0) return;
  const chunks = chunkArray(operations, BATCH_WRITE_LIMIT);
  for (const chunk of chunks) {
    const batch = writeBatch(firestore);
    chunk.forEach((operation) => {
      if (operation?.type === "delete") {
        batch.delete(operation.ref);
      } else if (operation?.type === "set") {
        if (operation?.options) {
          batch.set(operation.ref, operation.data || {}, operation.options);
        } else {
          batch.set(operation.ref, operation.data || {});
        }
      }
    });
    await batch.commit();
  }
};

const deleteCollectionDocs = async (collectionRef: any) => {
  while (true) {
    const snap = await getDocs(query(collectionRef, limit(DELETE_PAGE_SIZE)));
    if (snap.empty) break;
    const ops = snap.docs.map((row) => ({ type: "delete", ref: row.ref }));
    await commitOperations(ops);
    if (snap.size < DELETE_PAGE_SIZE) break;
  }
};

const deleteBackupWithPayload = async ({
  schoolId,
  backupId,
}: {
  schoolId: string;
  backupId: string;
}) => {
  const normalizedSchoolId = normalizeToken(schoolId);
  const normalizedBackupId = normalizeToken(backupId);
  if (!normalizedSchoolId || !normalizedBackupId) return;

  await deleteCollectionDocs(getEnrollmentsRowsCollection(normalizedSchoolId, normalizedBackupId));
  await deleteCollectionDocs(getScoresRowsCollection(normalizedSchoolId, normalizedBackupId));

  const payloadSnap = await getDocs(getPayloadCollection(normalizedSchoolId, normalizedBackupId));
  const payloadDeleteOps = payloadSnap.docs.map((row) => ({ type: "delete", ref: row.ref }));
  await commitOperations(payloadDeleteOps);
  await deleteDoc(doc(firestore, "schools", normalizedSchoolId, "backups", normalizedBackupId));
};

export async function enforceRetention({
  schoolId,
  keep = MAX_BACKUPS_PER_SCHOOL,
}: {
  schoolId: string;
  keep?: number;
}) {
  const normalizedSchoolId = normalizeToken(schoolId);
  if (!normalizedSchoolId) return { removed: 0 };
  const keepCount = Math.max(1, Number(keep) || MAX_BACKUPS_PER_SCHOOL);

  const backupsSnap = await getDocs(
    query(getBackupCollection(normalizedSchoolId), orderBy("createdAt", "desc"))
  );
  if (backupsSnap.size <= keepCount) {
    return { removed: 0 };
  }

  const sorted = backupsSnap.docs
    .map((row) => ({ id: row.id, ...row.data() }))
    .sort((a: any, b: any) => toMillis(b?.createdAt) - toMillis(a?.createdAt));
  const toDelete = sorted.slice(keepCount);

  // Cost guard: keep only the newest snapshots per school.
  for (const backupRow of toDelete) {
    await deleteBackupWithPayload({
      schoolId: normalizedSchoolId,
      backupId: String(backupRow?.id || "").trim(),
    });
  }

  return { removed: toDelete.length };
}

export async function createScopedBackup({
  schoolId,
  sessionId,
  termId,
  classId = null,
  type,
}: {
  schoolId: string;
  sessionId: string;
  termId: string;
  classId?: string | null;
  type: "pre_promotion" | "pre_term_switch" | "pre_restore";
}) {
  const normalizedSchoolId = normalizeToken(schoolId);
  const normalizedSessionId = normalizeToken(sessionId);
  const normalizedTermId = normalizeTermAlias(termId);
  const normalizedClassId = normalizeToken(classId) || null;
  const normalizedType = normalizeToken(type) as
    | "pre_promotion"
    | "pre_term_switch"
    | "pre_restore";

  if (!normalizedSchoolId) throw new Error("schoolId is required");
  if (!normalizedSessionId) throw new Error("sessionId is required");
  if (!normalizedTermId) throw new Error("termId is required");
  if (!BACKUP_TYPES.has(normalizedType)) {
    throw new Error("Invalid backup type.");
  }

  const [settingsSnap, sessionSnap, enrollments, scores] = await Promise.all([
    getDoc(doc(firestore, "settings", normalizedSchoolId)),
    getDoc(doc(firestore, "sessions", normalizedSessionId)),
    getScopedEnrollments({
      schoolId: normalizedSchoolId,
      sessionId: normalizedSessionId,
      classId: normalizedClassId,
    }),
    getScopedScores({
      schoolId: normalizedSchoolId,
      sessionId: normalizedSessionId,
      termId: normalizedTermId,
      classId: normalizedClassId,
    }),
  ]);
  const sessionName = sessionSnap.exists()
    ? String((sessionSnap.data() || {})?.name || "").trim()
    : "";

  const backupRef = doc(getBackupCollection(normalizedSchoolId));
  const backupId = backupRef.id;
  const createdBy = normalizeToken(auth?.currentUser?.uid) || "unknown";
  const payloadCollection = getPayloadCollection(normalizedSchoolId, backupId);
  const settingsSnapshot = buildSettingsSnapshot(settingsSnap.exists() ? settingsSnap.data() || {} : {});

  await setDoc(backupRef, {
    backupId,
    schoolId: normalizedSchoolId,
    createdAt: serverTimestamp(),
    createdBy,
    type: normalizedType,
    sessionId: normalizedSessionId,
    sessionName,
    termId: normalizedTermId,
    classId: normalizedClassId,
    counts: {
      enrollmentsOrStudents: Number(enrollments.length || 0),
      scores: Number(scores.length || 0),
    },
    note: "auto-created",
    status: "creating",
  });

  await commitOperations([
    {
      type: "set",
      ref: doc(payloadCollection, "settings"),
      data: {
        schoolId: normalizedSchoolId,
        sessionId: normalizedSessionId,
        termId: normalizedTermId,
        classId: normalizedClassId,
        settings: settingsSnapshot,
        createdAt: serverTimestamp(),
      },
    },
    {
      type: "set",
      ref: doc(payloadCollection, "enrollments"),
      data: {
        totalCount: Number(enrollments.length || 0),
        createdAt: serverTimestamp(),
      },
    },
    {
      type: "set",
      ref: doc(payloadCollection, "scores"),
      data: {
        totalCount: Number(scores.length || 0),
        createdAt: serverTimestamp(),
      },
    },
  ]);

  const enrollmentRowsOps = enrollments.map((row) => {
    const originalId = normalizeToken(row?.enrollmentId) || normalizeToken(row?.id);
    const rowId = originalId || doc(getEnrollmentsRowsCollection(normalizedSchoolId, backupId)).id;
    return {
      type: "set",
      ref: doc(getEnrollmentsRowsCollection(normalizedSchoolId, backupId), rowId),
      data: {
        ...row,
        id: rowId,
        enrollmentId: originalId || rowId,
        schoolId: normalizedSchoolId,
        sessionId: normalizedSessionId,
      },
    };
  });
  const scoreRowsOps = scores.map((row) => {
    const enrollmentId = normalizeToken(row?.enrollmentId);
    const subjectId = normalizeToken(row?.subjectId);
    const deterministicId =
      enrollmentId && subjectId
        ? buildDeterministicScoreId(enrollmentId, normalizedTermId, subjectId)
        : "";
    const originalId = normalizeToken(row?.scoreId) || normalizeToken(row?.id);
    const rowId =
      deterministicId ||
      originalId ||
      doc(getScoresRowsCollection(normalizedSchoolId, backupId)).id;
    return {
      type: "set",
      ref: doc(getScoresRowsCollection(normalizedSchoolId, backupId), rowId),
      data: {
        ...row,
        id: rowId,
        scoreId: rowId,
        schoolId: normalizedSchoolId,
        sessionId: normalizedSessionId,
        termId: normalizedTermId,
      },
    };
  });

  await commitOperations([...enrollmentRowsOps, ...scoreRowsOps]);

  await setDoc(
    backupRef,
    {
      status: "ready",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await enforceRetention({ schoolId: normalizedSchoolId, keep: MAX_BACKUPS_PER_SCHOOL });

  return {
    backupId,
    schoolId: normalizedSchoolId,
    type: normalizedType,
    sessionId: normalizedSessionId,
    sessionName,
    termId: normalizedTermId,
    classId: normalizedClassId,
    counts: {
      enrollmentsOrStudents: Number(enrollments.length || 0),
      scores: Number(scores.length || 0),
    },
  };
}

export async function listRecentBackups({
  schoolId,
  max = MAX_BACKUPS_PER_SCHOOL,
}: {
  schoolId: string;
  max?: number;
}) {
  const normalizedSchoolId = normalizeToken(schoolId);
  if (!normalizedSchoolId) return [];
  const safeMax = Math.max(1, Math.min(MAX_BACKUPS_PER_SCHOOL, Number(max) || MAX_BACKUPS_PER_SCHOOL));
  const backupsSnap = await getDocs(
    query(getBackupCollection(normalizedSchoolId), orderBy("createdAt", "desc"), limit(safeMax))
  );
  return backupsSnap.docs
    .map((row) => ({ id: row.id, ...row.data() }))
    .sort((a: any, b: any) => toMillis(b?.createdAt) - toMillis(a?.createdAt));
}

const readBackupPayload = async ({
  schoolId,
  backupId,
}: {
  schoolId: string;
  backupId: string;
}) => {
  const settingsSnap = await getDoc(
    doc(firestore, "schools", schoolId, "backups", backupId, "payload", "settings")
  );
  const enrollmentsRowsSnap = await getDocs(getEnrollmentsRowsCollection(schoolId, backupId));
  const scoresRowsSnap = await getDocs(getScoresRowsCollection(schoolId, backupId));

  return {
    settings: settingsSnap.exists() ? settingsSnap.data() || {} : {},
    enrollments: enrollmentsRowsSnap.docs.map((row) => ({ id: row.id, ...row.data() })),
    scores: scoresRowsSnap.docs.map((row) => ({ id: row.id, ...row.data() })),
  };
};

export async function restoreFromBackup({
  schoolId,
  backupId,
  options = {},
}: {
  schoolId: string;
  backupId: string;
  options?: {
    allowHistoricalRestore?: boolean;
    writeSettings?: boolean;
  };
}) {
  const normalizedSchoolId = normalizeToken(schoolId);
  const normalizedBackupId = normalizeToken(backupId);
  if (!normalizedSchoolId) throw new Error("schoolId is required");
  if (!normalizedBackupId) throw new Error("backupId is required");

  const backupRef = doc(firestore, "schools", normalizedSchoolId, "backups", normalizedBackupId);
  const backupSnap = await getDoc(backupRef);
  if (!backupSnap.exists()) {
    throw new Error("Selected backup was not found.");
  }
  const backup = backupSnap.data() || {};
  const scopedSessionId = normalizeToken(backup?.sessionId);
  const scopedTermId = normalizeTermAlias(backup?.termId);
  const scopedClassId = normalizeToken(backup?.classId) || null;
  if (!scopedSessionId || !scopedTermId) {
    throw new Error("Backup scope is incomplete.");
  }
  if (String(backup?.status || "").trim() !== "ready") {
    throw new Error("Backup is not ready for restore.");
  }

  const allowHistoricalRestore = options?.allowHistoricalRestore === true;
  const shouldWriteSettings = options?.writeSettings !== false;

  // Mode-B safety: school-admin restore stays on active session+term.
  const settingsRef = doc(firestore, "settings", normalizedSchoolId);
  const settingsSnap = await getDoc(settingsRef);
  const settingsData = settingsSnap.exists() ? settingsSnap.data() || {} : {};
  const activeSessionId = normalizeToken(settingsData?.activeSessionId);
  const activeTermId = normalizeTermAlias(settingsData?.activeTermId || "term1");
  if (
    !allowHistoricalRestore &&
    (activeSessionId !== scopedSessionId || activeTermId !== scopedTermId)
  ) {
    throw new Error(
      "Restore is only allowed for the current active session and term in this deployment."
    );
  }

  const payload = await readBackupPayload({
    schoolId: normalizedSchoolId,
    backupId: normalizedBackupId,
  });

  await createScopedBackup({
    schoolId: normalizedSchoolId,
    sessionId: scopedSessionId,
    termId: scopedTermId,
    classId: scopedClassId,
    type: "pre_restore",
  });

  const [liveEnrollments, liveScores] = await Promise.all([
    getScopedEnrollments({
      schoolId: normalizedSchoolId,
      sessionId: scopedSessionId,
      classId: scopedClassId,
    }),
    getScopedScores({
      schoolId: normalizedSchoolId,
      sessionId: scopedSessionId,
      termId: scopedTermId,
      classId: scopedClassId,
    }),
  ]);

  const deleteOps = [
    ...liveEnrollments.map((row) => ({
      type: "delete",
      ref: doc(firestore, "enrollments", String(row?.id || "")),
    })),
    ...liveScores.map((row) => ({
      type: "delete",
      ref: doc(firestore, "scores", String(row?.id || "")),
    })),
  ];

  const enrollmentRestoreOps = (payload?.enrollments || []).map((row: any) => {
    const enrollmentId =
      normalizeToken(row?.enrollmentId) || normalizeToken(row?.id) || doc(collection(firestore, "enrollments")).id;
    return {
      type: "set",
      ref: doc(firestore, "enrollments", enrollmentId),
      data: {
        ...row,
        id: enrollmentId,
        enrollmentId,
        schoolId: normalizedSchoolId,
        sessionId: scopedSessionId,
      },
    };
  });

  const scoreRestoreOps = (payload?.scores || []).map((row: any) => {
    const enrollmentId = normalizeToken(row?.enrollmentId);
    const subjectId = normalizeToken(row?.subjectId);
    const deterministicId =
      enrollmentId && subjectId ? buildDeterministicScoreId(enrollmentId, scopedTermId, subjectId) : "";
    const scoreId = deterministicId || normalizeToken(row?.scoreId) || normalizeToken(row?.id) || doc(collection(firestore, "scores")).id;
    return {
      type: "set",
      ref: doc(firestore, "scores", scoreId),
      data: {
        ...row,
        id: scoreId,
        scoreId,
        schoolId: normalizedSchoolId,
        sessionId: scopedSessionId,
        termId: scopedTermId,
      },
    };
  });

  const settingsSnapshot = payload?.settings?.settings || {};
  const settingsRestore = buildSettingsRestorePayload(settingsSnapshot);

  const baseOperations: any[] = [
    ...deleteOps,
  ];
  if (shouldWriteSettings) {
    baseOperations.push({
      type: "set",
      ref: settingsRef,
      data: {
        schoolId: normalizedSchoolId,
        ...settingsRestore,
        updatedAt: serverTimestamp(),
      },
      options: { merge: true },
    });
  }

  // Overwrite mode: clear scoped live rows first, then restore deterministic rows.
  await commitOperations([
    ...baseOperations,
    ...enrollmentRestoreOps,
    ...scoreRestoreOps,
  ]);

  return {
    schoolId: normalizedSchoolId,
    backupId: normalizedBackupId,
    restored: {
      enrollments: enrollmentRestoreOps.length,
      scores: scoreRestoreOps.length,
    },
    scope: {
      sessionId: scopedSessionId,
      termId: scopedTermId,
      classId: scopedClassId,
    },
  };
}

export async function requestHistoricalRestore({
  schoolId,
  backupId,
  reason = "",
}: {
  schoolId: string;
  backupId: string;
  reason?: string;
}) {
  const normalizedSchoolId = normalizeToken(schoolId);
  const normalizedBackupId = normalizeToken(backupId);
  if (!normalizedSchoolId) throw new Error("schoolId is required");
  if (!normalizedBackupId) throw new Error("backupId is required");

  const backupRef = doc(firestore, "schools", normalizedSchoolId, "backups", normalizedBackupId);
  const backupSnap = await getDoc(backupRef);
  if (!backupSnap.exists()) {
    throw new Error("Selected backup was not found.");
  }
  const backupData = backupSnap.data() || {};
  if (String(backupData?.status || "").trim() !== "ready") {
    throw new Error("Backup is not ready for restore request.");
  }

  const requesterUid = normalizeToken(auth?.currentUser?.uid) || "unknown";
  const requestPayload = {
    schoolId: normalizedSchoolId,
    backupId: normalizedBackupId,
    backupType: String(backupData?.type || "").trim(),
    sessionId: normalizeToken(backupData?.sessionId),
    sessionName: String(backupData?.sessionName || "").trim(),
    termId: normalizeTermAlias(backupData?.termId),
    classId: normalizeToken(backupData?.classId) || null,
    counts: {
      enrollmentsOrStudents: Number(backupData?.counts?.enrollmentsOrStudents || 0),
      scores: Number(backupData?.counts?.scores || 0),
    },
    requestedBy: requesterUid,
    reason: String(reason || "").trim() || "Historical scope restore requested by school admin.",
    status: "open",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const created = await addDoc(getRestoreRequestsCollection(normalizedSchoolId), requestPayload);
  return {
    requestId: created.id,
    ...requestPayload,
  };
}
