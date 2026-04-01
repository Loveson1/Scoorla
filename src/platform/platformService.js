import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getCountFromServer,
  getDocs,
  limit as limitDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "../firebase";
import { restoreFromBackup } from "../services/backupService";
import { instrumentFirestoreRead } from "../services/firestoreInstrumentation";
import {
  buildSchoolSearchIndex,
  getDefaultSupportFlags,
  loadSchoolDirectoryRecord,
  normalizeSchoolSearchTerm,
  normalizeSchoolDirectoryRecord,
  normalizeSchoolStatus,
  recomputeSchoolCounts,
} from "../utils/schoolDirectoryService";

const TICKET_STATUSES = ["open", "in_progress", "resolved"];
const TICKET_PRIORITIES = ["low", "medium", "high"];
const AUDIT_ACTIONS = new Set([
  "DISABLE_SCHOOL",
  "ENABLE_SCHOOL",
  "SET_SUPPORT_FLAG",
  "RESET_ONBOARDING",
  "RECOMPUTE_COUNTS",
  "SAVE_INTERNAL_NOTE",
  "CREATE_SUPPORT_TICKET",
  "UPDATE_SUPPORT_TICKET_STATUS",
  "UPDATE_RESTORE_REQUEST_STATUS",
  "EXECUTE_RESTORE_REQUEST",
  "BACKFILL_SCHOOL_SEARCH_INDEX",
]);
const RESTORE_REQUEST_STATUSES = ["open", "in_progress", "resolved", "rejected"];
const PLATFORM_DEFAULT_PAGE_SIZE = 20;
const PLATFORM_MAX_PAGE_SIZE = 50;

const chunkArray = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const normalizeRestoreStatus = (value) => {
  const token = String(value || "")
    .trim()
    .toLowerCase();
  return RESTORE_REQUEST_STATUSES.includes(token) ? token : "open";
};

const normalizeTicketStatus = (value) => {
  const token = String(value || "")
    .trim()
    .toLowerCase();
  return TICKET_STATUSES.includes(token) ? token : "open";
};

const normalizeTicketPriority = (value) => {
  const token = String(value || "")
    .trim()
    .toLowerCase();
  return TICKET_PRIORITIES.includes(token) ? token : "medium";
};

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

const normalizePageSize = (value, fallback = PLATFORM_DEFAULT_PAGE_SIZE) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), PLATFORM_MAX_PAGE_SIZE);
};

const buildPageResult = (rows, snapshots, pageSize) => {
  const safePageSize = normalizePageSize(pageSize);
  const hasMore = snapshots.length > safePageSize;
  const visibleRows = hasMore ? rows.slice(0, safePageSize) : rows;
  const visibleDocs = hasMore ? snapshots.slice(0, safePageSize) : snapshots;
  return {
    rows: visibleRows,
    nextCursor: hasMore && visibleDocs.length ? visibleDocs[visibleDocs.length - 1] : null,
    hasMore,
  };
};

const buildPlatformSchoolQueryConstraints = (options = {}) => {
  const constraints = [];
  const normalizedSearchTerm = normalizeSchoolSearchTerm(options?.searchTerm);
  const status = String(options?.status || "all").trim().toLowerCase();
  const flag = String(options?.flag || "all").trim();
  const activity = String(options?.activity || "all").trim().toLowerCase();
  const pageSize = normalizePageSize(options?.pageSize);
  const cursor = options?.cursor || null;

  if (normalizedSearchTerm.length >= 2) {
    constraints.push(where("searchIndex.prefixes", "array-contains", normalizedSearchTerm));
  }
  if (["active", "disabled", "trial", "archived"].includes(status)) {
    constraints.push(where("status", "==", status));
  }
  if (flag === "needsHelp") {
    constraints.push(where("supportFlags.needsHelp", "==", true));
  } else if (flag === "onboardingIncomplete") {
    constraints.push(where("supportFlags.onboardingIncomplete", "==", true));
  }

  if (activity === "active") {
    constraints.push(where("lastActiveAt", ">=", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
    constraints.push(orderBy("lastActiveAt", "desc"));
    constraints.push(orderBy(documentId()));
  } else if (activity === "inactive") {
    constraints.push(where("lastActiveAt", "<", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
    constraints.push(orderBy("lastActiveAt", "desc"));
    constraints.push(orderBy(documentId()));
  } else {
    constraints.push(orderBy(documentId()));
  }

  if (cursor) {
    constraints.push(startAfter(cursor));
  }
  constraints.push(limitDocs(pageSize + 1));

  return constraints;
};

const fetchSettingsBySchoolIds = async (schoolIds = []) => {
  const ids = [...new Set((schoolIds || []).map((item) => String(item || "").trim()).filter(Boolean))];
  if (!ids.length) return {};

  const settingsBySchoolId = {};
  const chunks = chunkArray(ids, 10);
  for (const chunk of chunks) {
    const settingsSnap = await instrumentFirestoreRead(
      getDocs(
        query(collection(firestore, "settings"), where(documentId(), "in", chunk))
      ),
      {
        screen: "Platform",
        action: "platform_settings_page",
        target: "settings",
      }
    );
    settingsSnap.docs.forEach((row) => {
      settingsBySchoolId[row.id] = row.data() || {};
    });
  }
  return settingsBySchoolId;
};

const normalizeSchoolRows = async (schoolDocs = []) => {
  const missingSettingsIds = schoolDocs
    .filter((row) => {
      const data = row.data() || {};
      return !data?.activeSessionId || !data?.activeTermId;
    })
    .map((row) => row.id);
  const settingsBySchoolId = await fetchSettingsBySchoolIds(missingSettingsIds);

  return schoolDocs.map((row) =>
    normalizeSchoolDirectoryRecord(row.id, row.data() || {}, settingsBySchoolId[row.id] || {})
  );
};

const schoolNeedsSearchIndex = (schoolData = {}) =>
  !Array.isArray(schoolData?.searchIndex?.prefixes) ||
  schoolData.searchIndex.prefixes.length === 0;

const SEARCH_INDEX_MAINTENANCE_DOC = "searchIndexBackfill";

const getSearchIndexMaintenanceRef = () =>
  doc(firestore, "platformMeta", SEARCH_INDEX_MAINTENANCE_DOC);

const readSearchIndexMaintenance = async () => {
  const maintenanceSnap = await instrumentFirestoreRead(
    getDoc(getSearchIndexMaintenanceRef()),
    {
      screen: "PlatformDashboard",
      action: "platform_search_index_maintenance",
      target: `platformMeta/${SEARCH_INDEX_MAINTENANCE_DOC}`,
    }
  );
  if (!maintenanceSnap.exists()) {
    return null;
  }
  const data = maintenanceSnap.data() || {};
  return {
    ...data,
    completedAtMs: toMillis(data?.completedAt),
    updatedAtMs: toMillis(data?.updatedAt),
  };
};

export async function getPlatformUserRecord(uid) {
  const resolvedUid = String(uid || "").trim();
  if (!resolvedUid) return null;
  const snap = await getDoc(doc(firestore, "platformUsers", resolvedUid));
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
}

export async function isSuperAdminUser(uid) {
  const record = await getPlatformUserRecord(uid);
  return String(record?.role || "").trim().toLowerCase() === "super_admin";
}

async function assertSuperAdmin(actorUid) {
  const allowed = await isSuperAdminUser(actorUid);
  if (!allowed) {
    throw new Error("Super admin access is required for this action.");
  }
}

export async function createAuditLog({
  actorUid,
  action,
  schoolId = null,
  targetPath,
  before = null,
  after = null,
  meta = {},
} = {}) {
  const normalizedAction = String(action || "").trim();
  if (!AUDIT_ACTIONS.has(normalizedAction)) {
    throw new Error("Invalid audit action.");
  }
  const actorRecord = await getPlatformUserRecord(actorUid);
  if (!actorRecord) {
    throw new Error("Platform actor record not found.");
  }

  await addDoc(collection(firestore, "auditLogs"), {
    actorUid: String(actorUid || "").trim(),
    actorRole: "super_admin",
    action: normalizedAction,
    schoolId: String(schoolId || "").trim() || null,
    targetPath: String(targetPath || "").trim(),
    before: before || null,
    after: after || null,
    meta: meta && typeof meta === "object" ? meta : {},
    createdAt: serverTimestamp(),
  });
}

export async function listPlatformSchools(options = {}) {
  const pageSize = normalizePageSize(options?.pageSize);
  const constraints = buildPlatformSchoolQueryConstraints(options);

  const schoolSnap = await instrumentFirestoreRead(
    getDocs(query(collection(firestore, "schools"), ...constraints)),
    {
      screen: "PlatformSchools",
      action: "platform_schools_page",
      target: "schools",
    }
  );
  const normalizedRows = await normalizeSchoolRows(schoolSnap.docs);
  const page = buildPageResult(normalizedRows, schoolSnap.docs, pageSize);
  return {
    ...page,
    rows: [...page.rows].sort((a, b) =>
      String(a.name || a.schoolCode || a.schoolId).localeCompare(
        String(b.name || b.schoolCode || b.schoolId)
      )
    ),
  };
}

export async function getPlatformSchoolDetail(schoolId) {
  const school = await loadSchoolDirectoryRecord(schoolId);
  if (!school) {
    throw new Error("School not found.");
  }
  return school;
}

export async function backfillSchoolSearchIndexesWithAudit({
  actorUid,
  batchSize = 100,
} = {}) {
  await assertSuperAdmin(actorUid);
  const safeBatchSize = Math.max(10, Math.min(Number(batchSize) || 100, 200));
  let cursor = null;
  let scanned = 0;
  let updated = 0;

  while (true) {
    const constraints = [orderBy(documentId()), limitDocs(safeBatchSize)];
    if (cursor) {
      constraints.push(startAfter(cursor));
    }

    const schoolsSnap = await instrumentFirestoreRead(
      getDocs(query(collection(firestore, "schools"), ...constraints)),
      {
        screen: "PlatformDashboard",
        action: "backfill_school_search_index_scan",
        target: "schools",
      }
    );

    if (schoolsSnap.empty) {
      break;
    }

    const batch = writeBatch(firestore);
    let pendingWrites = 0;
    schoolsSnap.docs.forEach((row) => {
      scanned += 1;
      const schoolData = row.data() || {};
      if (!schoolNeedsSearchIndex(schoolData)) {
        return;
      }
      batch.set(
        doc(firestore, "schools", row.id),
        {
          schoolId: row.id,
          searchIndex: buildSchoolSearchIndex({
            schoolId: row.id,
            name: schoolData?.name,
            schoolCode: schoolData?.schoolCode || row.id,
            email: schoolData?.email,
          }),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      pendingWrites += 1;
      updated += 1;
    });

    if (pendingWrites > 0) {
      await batch.commit();
    }

    cursor = schoolsSnap.docs[schoolsSnap.docs.length - 1];
    if (schoolsSnap.docs.length < safeBatchSize) {
      break;
    }
  }

  await createAuditLog({
    actorUid,
    action: "BACKFILL_SCHOOL_SEARCH_INDEX",
    schoolId: null,
    targetPath: "schools",
    before: null,
    after: {
      scanned,
      updated,
    },
    meta: {
      scanned,
      updated,
      batchSize: safeBatchSize,
    },
  });

  await setDoc(
    getSearchIndexMaintenanceRef(),
    {
      key: SEARCH_INDEX_MAINTENANCE_DOC,
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: String(actorUid || "").trim(),
      scanned,
      updated,
    },
    { merge: true }
  );

  return {
    scanned,
    updated,
  };
}

export async function listSupportTickets(options = {}) {
  const schoolId = String(options?.schoolId || "").trim();
  const pageSize = normalizePageSize(options?.pageSize);
  const cursor = options?.cursor || null;
  const constraints = [];

  if (schoolId) {
    constraints.push(where("schoolId", "==", schoolId));
  } else {
    constraints.push(orderBy("updatedAt", "desc"));
    if (cursor) {
      constraints.push(startAfter(cursor));
    }
  }
  constraints.push(limitDocs(pageSize + 1));

  const snap = await instrumentFirestoreRead(
    getDocs(query(collection(firestore, "supportTickets"), ...constraints)),
    {
      screen: "PlatformSupport",
      action: schoolId ? "platform_school_tickets_page" : "platform_tickets_page",
      target: schoolId ? `supportTickets:${schoolId}` : "supportTickets",
    }
  );
  const tickets = snap.docs
    .map((row) => {
      const data = row.data() || {};
      return {
        id: row.id,
        ...data,
        status: normalizeTicketStatus(data?.status),
        priority: normalizeTicketPriority(data?.priority),
        createdAtMs: toMillis(data?.createdAt),
        updatedAtMs: toMillis(data?.updatedAt),
      };
    })
    .sort((a, b) => (b.updatedAtMs || b.createdAtMs) - (a.updatedAtMs || a.createdAtMs));
  return buildPageResult(tickets, snap.docs, pageSize);
}

export async function listAuditLogs(options = {}) {
  const schoolId = String(options?.schoolId || "").trim();
  const logLimit = normalizePageSize(options?.limit || 25, 25);
  let snap;
  try {
    const preferredConstraints = schoolId
      ? [where("schoolId", "==", schoolId), orderBy("createdAt", "desc"), limitDocs(logLimit)]
      : [orderBy("createdAt", "desc"), limitDocs(logLimit)];
    snap = await instrumentFirestoreRead(
      getDocs(query(collection(firestore, "auditLogs"), ...preferredConstraints)),
      {
        screen: "PlatformSchoolDetail",
        action: schoolId ? "platform_school_audit_logs" : "platform_audit_logs",
        target: schoolId ? `auditLogs:${schoolId}` : "auditLogs",
      }
    );
  } catch (error) {
    if (String(error?.code || "") !== "failed-precondition") {
      throw error;
    }
    const fallbackConstraints = schoolId
      ? [where("schoolId", "==", schoolId), limitDocs(logLimit * 3)]
      : [limitDocs(logLimit)];
    snap = await instrumentFirestoreRead(
      getDocs(query(collection(firestore, "auditLogs"), ...fallbackConstraints)),
      {
        screen: "PlatformSchoolDetail",
        action: schoolId
          ? "platform_school_audit_logs_fallback"
          : "platform_audit_logs_fallback",
        target: schoolId ? `auditLogs:${schoolId}` : "auditLogs",
      }
    );
  }
  const logs = snap.docs.map((row) => {
    const data = row.data() || {};
    return {
      id: row.id,
      ...data,
      createdAtMs: toMillis(data?.createdAt),
    };
  });
  return logs
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, logLimit);
}

export async function getPlatformDashboardSnapshot() {
  const schoolsRef = collection(firestore, "schools");
  const ticketsRef = collection(firestore, "supportTickets");

  const [
    totalSchoolsSnap,
    activeSchoolsSnap,
    disabledSchoolsSnap,
    helpFlagsSnap,
    openTicketsSnap,
    needsHelpRows,
    onboardingRows,
    latestTicketsPage,
    searchIndexMaintenance,
  ] = await Promise.all([
    instrumentFirestoreRead(getCountFromServer(schoolsRef), {
      screen: "PlatformDashboard",
      action: "platform_dashboard_school_count",
      target: "schools",
      countOverride: 1,
    }),
    instrumentFirestoreRead(
      getCountFromServer(query(schoolsRef, where("status", "==", "active"))),
      {
        screen: "PlatformDashboard",
        action: "platform_dashboard_active_school_count",
        target: "schools:active",
        countOverride: 1,
      }
    ),
    instrumentFirestoreRead(
      getCountFromServer(query(schoolsRef, where("status", "==", "disabled"))),
      {
        screen: "PlatformDashboard",
        action: "platform_dashboard_disabled_school_count",
        target: "schools:disabled",
        countOverride: 1,
      }
    ),
    instrumentFirestoreRead(
      getCountFromServer(query(schoolsRef, where("supportFlags.needsHelp", "==", true))),
      {
        screen: "PlatformDashboard",
        action: "platform_dashboard_help_flag_count",
        target: "schools:needsHelp",
        countOverride: 1,
      }
    ),
    instrumentFirestoreRead(
      getCountFromServer(query(ticketsRef, where("status", "in", ["open", "in_progress"]))),
      {
        screen: "PlatformDashboard",
        action: "platform_dashboard_open_ticket_count",
        target: "supportTickets:open",
        countOverride: 1,
      }
    ),
    instrumentFirestoreRead(
      getDocs(query(schoolsRef, where("supportFlags.needsHelp", "==", true), limitDocs(5))),
      {
        screen: "PlatformDashboard",
        action: "platform_dashboard_flagged_help",
        target: "schools:needsHelp",
      }
    ),
    instrumentFirestoreRead(
      getDocs(
        query(schoolsRef, where("supportFlags.onboardingIncomplete", "==", true), limitDocs(5))
      ),
      {
        screen: "PlatformDashboard",
        action: "platform_dashboard_flagged_onboarding",
        target: "schools:onboardingIncomplete",
      }
    ),
    listSupportTickets({ pageSize: 5 }),
    readSearchIndexMaintenance(),
  ]);

  const flaggedDocs = [...needsHelpRows.docs, ...onboardingRows.docs];
  const flaggedRows = [];
  const seenSchoolIds = new Set();
  flaggedDocs.forEach((row) => {
    if (seenSchoolIds.has(row.id) || flaggedRows.length >= 5) return;
    seenSchoolIds.add(row.id);
    flaggedRows.push(normalizeSchoolDirectoryRecord(row.id, row.data() || {}));
  });

  return {
    summary: {
      schools: totalSchoolsSnap.data().count || 0,
      active: activeSchoolsSnap.data().count || 0,
      disabled: disabledSchoolsSnap.data().count || 0,
      openTickets: openTicketsSnap.data().count || 0,
      needsHelp: helpFlagsSnap.data().count || 0,
    },
    flaggedSchools: flaggedRows,
    latestTickets: latestTicketsPage.rows,
    searchIndexMaintenance,
  };
}

const buildSchoolUpdatePayload = (schoolId, currentSchool, patch = {}) => {
  const normalized = normalizeSchoolDirectoryRecord(schoolId, currentSchool);
  return {
    schoolId: normalized.schoolId,
    schoolCode: normalized.schoolCode,
    name: normalized.name,
    email: normalized.email,
    searchIndex: buildSchoolSearchIndex(normalized),
    status: normalizeSchoolStatus(patch?.status ?? normalized.status),
    supportFlags: {
      ...getDefaultSupportFlags(),
      ...normalized.supportFlags,
      ...(patch?.supportFlags || {}),
    },
    notes: {
      internal:
        patch?.notes?.internal !== undefined
          ? String(patch.notes.internal || "")
          : normalized.notes.internal,
    },
    counts: patch?.counts || normalized.counts,
    updatedAt: serverTimestamp(),
    ...(currentSchool?.createdAt ? {} : { createdAt: serverTimestamp() }),
  };
};

export async function setSchoolStatusWithAudit({ actorUid, schoolId, status } = {}) {
  await assertSuperAdmin(actorUid);
  const resolvedSchoolId = String(schoolId || "").trim();
  if (!resolvedSchoolId) {
    throw new Error("schoolId is required");
  }

  const schoolRef = doc(firestore, "schools", resolvedSchoolId);
  const schoolSnap = await getDoc(schoolRef);
  const before = normalizeSchoolDirectoryRecord(
    resolvedSchoolId,
    schoolSnap.exists() ? schoolSnap.data() || {} : {}
  );
  const nextStatus = normalizeSchoolStatus(status);
  const payload = buildSchoolUpdatePayload(resolvedSchoolId, schoolSnap.data() || {}, {
    status: nextStatus,
  });
  await setDoc(schoolRef, payload, { merge: true });
  const after = {
    ...before,
    status: nextStatus,
  };

  await createAuditLog({
    actorUid,
    action: nextStatus === "disabled" ? "DISABLE_SCHOOL" : "ENABLE_SCHOOL",
    schoolId: resolvedSchoolId,
    targetPath: `schools/${resolvedSchoolId}`,
    before,
    after,
    meta: {
      nextStatus,
    },
  });

  return after;
}

export async function setSchoolSupportFlagWithAudit({
  actorUid,
  schoolId,
  flag = "needsHelp",
  value,
} = {}) {
  await assertSuperAdmin(actorUid);
  const resolvedSchoolId = String(schoolId || "").trim();
  const flagKey = flag === "onboardingIncomplete" ? "onboardingIncomplete" : "needsHelp";
  const schoolRef = doc(firestore, "schools", resolvedSchoolId);
  const schoolSnap = await getDoc(schoolRef);
  const current = schoolSnap.exists() ? schoolSnap.data() || {} : {};
  const before = normalizeSchoolDirectoryRecord(resolvedSchoolId, current);
  const nextValue = value === undefined ? !(before.supportFlags?.[flagKey] === true) : value === true;
  const payload = buildSchoolUpdatePayload(resolvedSchoolId, current, {
    supportFlags: {
      [flagKey]: nextValue,
    },
  });
  await setDoc(schoolRef, payload, { merge: true });
  const after = {
    ...before,
    supportFlags: {
      ...before.supportFlags,
      [flagKey]: nextValue,
    },
  };

  await createAuditLog({
    actorUid,
    action: "SET_SUPPORT_FLAG",
    schoolId: resolvedSchoolId,
    targetPath: `schools/${resolvedSchoolId}`,
    before,
    after,
    meta: {
      flag: flagKey,
      value: nextValue,
    },
  });

  return after;
}

export async function resetSchoolOnboardingWithAudit({ actorUid, schoolId } = {}) {
  await assertSuperAdmin(actorUid);
  const resolvedSchoolId = String(schoolId || "").trim();
  const schoolRef = doc(firestore, "schools", resolvedSchoolId);
  const schoolSnap = await getDoc(schoolRef);
  const current = schoolSnap.exists() ? schoolSnap.data() || {} : {};
  const before = normalizeSchoolDirectoryRecord(resolvedSchoolId, current);
  const payload = buildSchoolUpdatePayload(resolvedSchoolId, current, {
    supportFlags: {
      onboardingIncomplete: false,
    },
  });
  await setDoc(schoolRef, payload, { merge: true });
  const after = {
    ...before,
    supportFlags: {
      ...before.supportFlags,
      onboardingIncomplete: false,
    },
  };

  await createAuditLog({
    actorUid,
    action: "RESET_ONBOARDING",
    schoolId: resolvedSchoolId,
    targetPath: `schools/${resolvedSchoolId}`,
    before,
    after,
    meta: {
      resetField: "supportFlags.onboardingIncomplete",
    },
  });

  return after;
}

export async function saveSchoolInternalNoteWithAudit({ actorUid, schoolId, note } = {}) {
  await assertSuperAdmin(actorUid);
  const resolvedSchoolId = String(schoolId || "").trim();
  const schoolRef = doc(firestore, "schools", resolvedSchoolId);
  const schoolSnap = await getDoc(schoolRef);
  const current = schoolSnap.exists() ? schoolSnap.data() || {} : {};
  const before = normalizeSchoolDirectoryRecord(resolvedSchoolId, current);
  const nextNote = String(note || "").trim();
  const payload = buildSchoolUpdatePayload(resolvedSchoolId, current, {
    notes: {
      internal: nextNote,
    },
  });
  await setDoc(schoolRef, payload, { merge: true });
  const after = {
    ...before,
    notes: {
      internal: nextNote,
    },
  };

  await createAuditLog({
    actorUid,
    action: "SAVE_INTERNAL_NOTE",
    schoolId: resolvedSchoolId,
    targetPath: `schools/${resolvedSchoolId}`,
    before,
    after,
    meta: {
      noteLength: nextNote.length,
    },
  });

  return after;
}

export async function recomputeSchoolCountsWithAudit({ actorUid, schoolId } = {}) {
  await assertSuperAdmin(actorUid);
  const resolvedSchoolId = String(schoolId || "").trim();
  const schoolRef = doc(firestore, "schools", resolvedSchoolId);
  const schoolSnap = await getDoc(schoolRef);
  const current = schoolSnap.exists() ? schoolSnap.data() || {} : {};
  const before = normalizeSchoolDirectoryRecord(resolvedSchoolId, current);
  const counts = await recomputeSchoolCounts(resolvedSchoolId, { persist: false });
  const payload = buildSchoolUpdatePayload(resolvedSchoolId, current, {
    counts,
  });
  await setDoc(schoolRef, payload, { merge: true });
  const after = {
    ...before,
    counts,
  };

  await createAuditLog({
    actorUid,
    action: "RECOMPUTE_COUNTS",
    schoolId: resolvedSchoolId,
    targetPath: `schools/${resolvedSchoolId}`,
    before,
    after,
    meta: counts,
  });

  return after;
}

export async function createSupportTicket({
  actorUid,
  schoolId,
  title,
  message,
  priority = "medium",
} = {}) {
  await assertSuperAdmin(actorUid);
  const resolvedSchoolId = String(schoolId || "").trim();
  const trimmedTitle = String(title || "").trim();
  const trimmedMessage = String(message || "").trim();
  if (!resolvedSchoolId) throw new Error("schoolId is required");
  if (!trimmedTitle) throw new Error("Ticket title is required.");
  if (!trimmedMessage) throw new Error("Ticket message is required.");

  const payload = {
    schoolId: resolvedSchoolId,
    title: trimmedTitle,
    message: trimmedMessage,
    status: "open",
    priority: normalizeTicketPriority(priority),
    createdByUid: String(actorUid || "").trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const created = await addDoc(collection(firestore, "supportTickets"), payload);

  await createAuditLog({
    actorUid,
    action: "CREATE_SUPPORT_TICKET",
    schoolId: resolvedSchoolId,
    targetPath: `supportTickets/${created.id}`,
    before: null,
    after: {
      ...payload,
      createdAt: null,
      updatedAt: null,
    },
    meta: {
      ticketId: created.id,
    },
  });

  return created.id;
}

export async function updateSupportTicketStatus({
  actorUid,
  ticketId,
  status,
} = {}) {
  await assertSuperAdmin(actorUid);
  const resolvedTicketId = String(ticketId || "").trim();
  if (!resolvedTicketId) throw new Error("ticketId is required");
  const ticketRef = doc(firestore, "supportTickets", resolvedTicketId);
  const ticketSnap = await getDoc(ticketRef);
  if (!ticketSnap.exists()) {
    throw new Error("Support ticket not found.");
  }
  const before = { id: ticketSnap.id, ...(ticketSnap.data() || {}) };
  const nextStatus = normalizeTicketStatus(status);
  await updateDoc(ticketRef, {
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });
  const after = {
    ...before,
    status: nextStatus,
  };

  await createAuditLog({
    actorUid,
    action: "UPDATE_SUPPORT_TICKET_STATUS",
    schoolId: String(before.schoolId || "").trim() || null,
    targetPath: `supportTickets/${resolvedTicketId}`,
    before,
    after,
    meta: {
      ticketId: resolvedTicketId,
      nextStatus,
    },
  });

  return after;
}

const getRestoreRequestRef = (schoolId, requestId) =>
  doc(firestore, "schools", String(schoolId || "").trim(), "restoreRequests", String(requestId || "").trim());

export async function listRestoreRequests(options = {}) {
  const resolvedSchoolId = String(options?.schoolId || "").trim();
  const pageSize = normalizePageSize(options?.pageSize);
  const resolvedStatus = String(options?.status || "all").trim().toLowerCase();
  const cursor = options?.cursor || null;
  const constraints = [];
  if (!resolvedSchoolId) {
    constraints.push(orderBy("updatedAt", "desc"));
    if (cursor) {
      constraints.push(startAfter(cursor));
    }
  }
  constraints.push(limitDocs(pageSize + 1));
  const sourceQuery = resolvedSchoolId
    ? query(collection(firestore, "schools", resolvedSchoolId, "restoreRequests"), ...constraints)
    : query(collectionGroup(firestore, "restoreRequests"), ...constraints);
  const snap = await instrumentFirestoreRead(getDocs(sourceQuery), {
    screen: "PlatformSupport",
    action: resolvedSchoolId ? "platform_school_restore_requests" : "platform_restore_requests",
    target: resolvedSchoolId ? `restoreRequests:${resolvedSchoolId}` : "restoreRequests",
  });
  const requests = snap.docs.map((row) => {
    const data = row.data() || {};
    return {
      id: row.id,
      ...data,
      status: normalizeRestoreStatus(data?.status),
      createdAtMs: toMillis(data?.createdAt),
      updatedAtMs: toMillis(data?.updatedAt),
    };
  });
  const filtered =
    resolvedStatus === "all"
      ? requests
      : requests.filter((item) => item.status === normalizeRestoreStatus(resolvedStatus));
  const sorted = filtered.sort((a, b) => (b.updatedAtMs || b.createdAtMs) - (a.updatedAtMs || a.createdAtMs));
  return buildPageResult(sorted, snap.docs, pageSize);
}

export async function updateRestoreRequestStatus({
  actorUid,
  schoolId,
  requestId,
  status,
} = {}) {
  await assertSuperAdmin(actorUid);
  const resolvedSchoolId = String(schoolId || "").trim();
  const resolvedRequestId = String(requestId || "").trim();
  if (!resolvedSchoolId) throw new Error("schoolId is required");
  if (!resolvedRequestId) throw new Error("requestId is required");

  const requestRef = getRestoreRequestRef(resolvedSchoolId, resolvedRequestId);
  const requestSnap = await getDoc(requestRef);
  if (!requestSnap.exists()) {
    throw new Error("Restore request not found.");
  }
  const before = { id: requestSnap.id, ...(requestSnap.data() || {}) };
  const nextStatus = normalizeRestoreStatus(status);
  await updateDoc(requestRef, {
    status: nextStatus,
    updatedAt: serverTimestamp(),
    reviewedBy: String(actorUid || "").trim(),
  });
  const after = {
    ...before,
    status: nextStatus,
    reviewedBy: String(actorUid || "").trim(),
  };

  await createAuditLog({
    actorUid,
    action: "UPDATE_RESTORE_REQUEST_STATUS",
    schoolId: resolvedSchoolId,
    targetPath: `schools/${resolvedSchoolId}/restoreRequests/${resolvedRequestId}`,
    before,
    after,
    meta: {
      requestId: resolvedRequestId,
      nextStatus,
    },
  });

  return after;
}

export async function executeRestoreRequest({
  actorUid,
  schoolId,
  requestId,
} = {}) {
  await assertSuperAdmin(actorUid);
  const resolvedSchoolId = String(schoolId || "").trim();
  const resolvedRequestId = String(requestId || "").trim();
  if (!resolvedSchoolId) throw new Error("schoolId is required");
  if (!resolvedRequestId) throw new Error("requestId is required");

  const requestRef = getRestoreRequestRef(resolvedSchoolId, resolvedRequestId);
  const requestSnap = await getDoc(requestRef);
  if (!requestSnap.exists()) {
    throw new Error("Restore request not found.");
  }
  const requestData = requestSnap.data() || {};
  const currentStatus = normalizeRestoreStatus(requestData?.status);
  if (currentStatus === "resolved") {
    throw new Error("Restore request is already resolved.");
  }
  if (currentStatus === "rejected") {
    throw new Error("Rejected restore request cannot be executed.");
  }

  await updateDoc(requestRef, {
    status: "in_progress",
    updatedAt: serverTimestamp(),
    reviewedBy: String(actorUid || "").trim(),
  });

  const summary = await restoreFromBackup({
    schoolId: resolvedSchoolId,
    backupId: String(requestData?.backupId || "").trim(),
    options: {
      allowHistoricalRestore: true,
      writeSettings: false,
    },
  });

  await updateDoc(requestRef, {
    status: "resolved",
    resolvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    reviewedBy: String(actorUid || "").trim(),
    executionSummary: {
      restoredEnrollments: Number(summary?.restored?.enrollments || 0),
      restoredScores: Number(summary?.restored?.scores || 0),
      sessionId: String(summary?.scope?.sessionId || "").trim(),
      termId: String(summary?.scope?.termId || "").trim(),
      classId: String(summary?.scope?.classId || "").trim() || null,
    },
  });

  await createAuditLog({
    actorUid,
    action: "EXECUTE_RESTORE_REQUEST",
    schoolId: resolvedSchoolId,
    targetPath: `schools/${resolvedSchoolId}/restoreRequests/${resolvedRequestId}`,
    before: {
      status: currentStatus,
      backupId: String(requestData?.backupId || "").trim(),
    },
    after: {
      status: "resolved",
      restoredEnrollments: Number(summary?.restored?.enrollments || 0),
      restoredScores: Number(summary?.restored?.scores || 0),
    },
    meta: {
      requestId: resolvedRequestId,
      backupId: String(requestData?.backupId || "").trim(),
    },
  });

  return summary;
}
