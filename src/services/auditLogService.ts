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
} from "firebase/firestore";
import { firestore, auth } from "../firebase";
import { ensureUserScope } from "../utils/userScopeCache";

const CRITICAL_ACTIONS = new Set([
  "promotion",
  "session_switch",
  "term_switch",
  "settings_update",
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const NORMAL_RETENTION_MS = 90 * DAY_MS;
const CRITICAL_RETENTION_MS = 365 * DAY_MS;
const CLEANUP_INTERVAL_MS = 24 * DAY_MS;
const CLEANUP_BATCH_SIZE = 100;

const toMillis = (value: any): number => {
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

const normalizeObject = (value: any) => {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value).reduce((acc, [key, fieldValue]) => {
    if (fieldValue === undefined) return acc;
    acc[key] = fieldValue;
    return acc;
  }, {} as Record<string, any>);
};

const resolveActorUid = (actorUid?: string) => {
  const explicit = String(actorUid || "").trim();
  if (explicit) return explicit;
  const currentAuthUid = String(auth?.currentUser?.uid || "").trim();
  if (currentAuthUid) return currentAuthUid;
  try {
    const cachedUserId = String(localStorage.getItem("userId") || "").trim();
    if (cachedUserId) return cachedUserId;
  } catch {
    // Ignore storage access errors.
  }
  return "unknown";
};

const resolveActorRole = async (actorUid: string, actorRole?: string) => {
  const explicit = String(actorRole || "").trim();
  if (explicit) return explicit;

  try {
    const userScope = await ensureUserScope(actorUid, {
      screen: "AuditLog",
      action: "resolve_actor_role",
    });
    if (userScope) {
      return String(userScope?.role || "").trim() || "staff";
    }
  } catch {
    // Fall through to platform user lookup.
  }

  try {
    const platformSnap = await getDoc(doc(firestore, "platformUsers", actorUid));
    if (platformSnap.exists()) {
      return String(platformSnap.data()?.role || "").trim() || "super_admin";
    }
  } catch {
    // Use safe fallback when lookups fail.
  }
  return "staff";
};

const normalizeScope = (scope: any = {}) => {
  const acceptedKeys = [
    "sessionId",
    "termId",
    "classId",
    "studentId",
    "subjectId",
    "enrollmentId",
  ];
  return acceptedKeys.reduce((acc, key) => {
    const value = String(scope?.[key] || "").trim();
    if (value) acc[key] = value;
    return acc;
  }, {} as Record<string, string>);
};

const buildDelta = (before?: Record<string, any>, after?: Record<string, any>) => {
  const normalizedBefore = normalizeObject(before);
  const normalizedAfter = normalizeObject(after);
  const delta: Record<string, any> = {};
  if (Object.keys(normalizedBefore).length > 0) {
    delta.before = normalizedBefore;
  }
  if (Object.keys(normalizedAfter).length > 0) {
    delta.after = normalizedAfter;
  }
  return delta;
};

const getAuditCollection = (schoolId: string) =>
  collection(firestore, "schools", schoolId, "auditLogs");

export async function logAuditEvent({
  schoolId,
  action,
  entityType,
  entityId,
  actorUid,
  actorRole,
  scope = {},
  before,
  after,
}: {
  schoolId: string;
  action: string;
  entityType: string;
  entityId?: string;
  actorUid?: string;
  actorRole?: string;
  scope?: Record<string, any>;
  before?: Record<string, any>;
  after?: Record<string, any>;
}) {
  const resolvedSchoolId = String(schoolId || "").trim();
  const resolvedAction = String(action || "").trim();
  const resolvedEntityType = String(entityType || "").trim();
  if (!resolvedSchoolId || !resolvedAction || !resolvedEntityType) {
    return;
  }

  const resolvedActorUid = resolveActorUid(actorUid);
  const resolvedActorRole = await resolveActorRole(resolvedActorUid, actorRole);
  const resolvedEntityId = String(entityId || "").trim();
  const normalizedDelta = buildDelta(before, after);
  const normalizedScope = normalizeScope(scope);
  const critical = CRITICAL_ACTIONS.has(resolvedAction);

  await addDoc(getAuditCollection(resolvedSchoolId), {
    schoolId: resolvedSchoolId,
    createdAt: serverTimestamp(),
    action: resolvedAction,
    entityType: resolvedEntityType,
    entityId: resolvedEntityId || "",
    actorUid: resolvedActorUid,
    actorRole: resolvedActorRole,
    scope: normalizedScope,
    delta: normalizedDelta,
    critical,
    meta: {
      source: "client",
      version: 1,
    },
  });
}

async function deleteExpiredLogs({
  schoolId,
  normalCutoff,
  criticalCutoff,
}: {
  schoolId: string;
  normalCutoff: Date;
  criticalCutoff: Date;
}) {
  let deletedNormal = 0;
  let deletedCritical = 0;

  while (true) {
    const oldLogsQuery = query(
      getAuditCollection(schoolId),
      where("createdAt", "<", normalCutoff),
      orderBy("createdAt", "asc"),
      limit(CLEANUP_BATCH_SIZE)
    );
    const oldLogsSnap = await getDocs(oldLogsQuery);
    if (oldLogsSnap.empty) break;

    const deletableDocs = oldLogsSnap.docs.filter((row) => {
      const rowData = row.data() || {};
      const createdAtMs = toMillis(rowData?.createdAt);
      const isCritical = rowData?.critical === true;
      if (!createdAtMs) return false;
      if (!isCritical) return createdAtMs < normalCutoff.getTime();
      return createdAtMs < criticalCutoff.getTime();
    });

    if (deletableDocs.length === 0) break;

    try {
      await Promise.all(deletableDocs.map((row) => deleteDoc(row.ref)));
      deletableDocs.forEach((row) => {
        const isCritical = row.data()?.critical === true;
        if (isCritical) deletedCritical += 1;
        else deletedNormal += 1;
      });
    } catch (error: any) {
      const code = String(error?.code || "");
      if (code.includes("permission-denied")) {
        break;
      }
      throw error;
    }

    if (oldLogsSnap.size < CLEANUP_BATCH_SIZE) break;
  }

  return { deletedNormal, deletedCritical };
}

export async function cleanupAuditLogs({
  schoolId,
}: {
  schoolId: string;
}) {
  const resolvedSchoolId = String(schoolId || "").trim();
  if (!resolvedSchoolId) {
    return { ran: false, deleted: 0 };
  }

  const settingsRef = doc(firestore, "settings", resolvedSchoolId);
  const settingsSnap = await getDoc(settingsRef);
  const settings = settingsSnap.exists() ? settingsSnap.data() || {} : {};
  const lastCleanupMs = toMillis(settings?.auditLastCleanupAt);
  const now = Date.now();

  if (lastCleanupMs && now - lastCleanupMs < CLEANUP_INTERVAL_MS) {
    return {
      ran: false,
      deleted: 0,
      nextRunAt: lastCleanupMs + CLEANUP_INTERVAL_MS,
    };
  }

  const normalCutoff = new Date(now - NORMAL_RETENTION_MS);
  const criticalCutoff = new Date(now - CRITICAL_RETENTION_MS);

  const { deletedNormal, deletedCritical } = await deleteExpiredLogs({
    schoolId: resolvedSchoolId,
    normalCutoff,
    criticalCutoff,
  });

  await setDoc(
    settingsRef,
    {
      schoolId: resolvedSchoolId,
      auditLastCleanupAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return {
    ran: true,
    deleted: deletedNormal + deletedCritical,
    deletedNormal,
    deletedCritical,
  };
}

export async function getRecentAuditLogs({
  schoolId,
  max = 50,
}: {
  schoolId: string;
  max?: number;
}) {
  const resolvedSchoolId = String(schoolId || "").trim();
  if (!resolvedSchoolId) return [];
  const safeLimit = Math.max(1, Math.min(100, Number(max) || 50));
  try {
    const logsQuery = query(
      getAuditCollection(resolvedSchoolId),
      orderBy("createdAt", "desc"),
      limit(safeLimit)
    );
    const logsSnap = await getDocs(logsQuery);
    return logsSnap.docs.map((row) => ({ id: row.id, ...row.data() }));
  } catch {
    const fallbackSnap = await getDocs(
      query(getAuditCollection(resolvedSchoolId), limit(safeLimit))
    );
    const fallbackRows = fallbackSnap.docs.map((row) => ({ id: row.id, ...row.data() }));
    return fallbackRows.sort(
      (a: any, b: any) => toMillis(b?.createdAt) - toMillis(a?.createdAt)
    );
  }
}
