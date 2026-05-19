import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "../firebase";

const TERM_DEFINITIONS = [
  { alias: "term1", name: "First Term", sortOrder: 1 },
  { alias: "term2", name: "Second Term", sortOrder: 2 },
  { alias: "term3", name: "Third Term", sortOrder: 3 },
];

const normalizeWhitespace = (value) => String(value || "").replace(/\s+/g, " ").trim();

const normalizeTermAlias = (value) => {
  const token = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (["term1", "1", "1st", "1stterm", "firstterm"].includes(token)) return "term1";
  if (["term2", "2", "2nd", "2ndterm", "secondterm"].includes(token)) return "term2";
  if (["term3", "3", "3rd", "3rdterm", "thirdterm"].includes(token)) return "term3";
  return "term1";
};

const getTermDefinition = (alias) =>
  TERM_DEFINITIONS.find((item) => item.alias === normalizeTermAlias(alias)) || TERM_DEFINITIONS[0];

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

const normalizeSessionName = (value) => normalizeWhitespace(value);

const parseSessionYears = (sessionName) => {
  const match = normalizeSessionName(sessionName).match(/^(\d{4})\s*\/\s*(\d{4})$/);
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
  return { startYear, endYear };
};

const normalizeClassToken = (value) =>
  String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const parseClassForPromotion = (value) => {
  const normalized = normalizeClassToken(value);
  let matched = normalized.match(/^JSS([123])([A-Z0-9]*)$/);
  if (matched) {
    return { stage: "JSS", level: Number(matched[1]), suffix: matched[2] || "" };
  }

  matched = normalized.match(/^(SSS|SS)([123])([A-Z0-9]*)$/);
  if (matched) {
    return { stage: "SS", level: Number(matched[2]), suffix: matched[3] || "" };
  }

  return null;
};

const buildClassPromotionMap = (classRecords) => {
  const grouped = {};
  Object.values(classRecords || {}).forEach((entry) => {
    const parsed = parseClassForPromotion(entry?.classId);
    if (!parsed) return;
    const key = `${parsed.stage}:${parsed.suffix || ""}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      classId: entry.classId,
      parsed,
    });
  });

  const nextClassById = {};
  Object.values(grouped).forEach((items) => {
    const ordered = [...items].sort((left, right) => left.parsed.level - right.parsed.level);
    ordered.forEach((item, index) => {
      const next = ordered[index + 1];
      if (next) {
        nextClassById[item.classId] = next.classId;
      }
    });
  });
  return nextClassById;
};

const getSessionRef = (sessionId) => doc(firestore, "sessions", sessionId);
const getTermRef = (termId) => doc(firestore, "terms", termId);
const getSettingsRef = (schoolId) => doc(firestore, "settings", schoolId);
const getSchoolRef = (schoolId) => doc(firestore, "schools", schoolId);

const readSettings = async (schoolId) => {
  const snap = await getDoc(getSettingsRef(schoolId));
  return snap.exists() ? snap.data() || {} : {};
};

const listTermsForSessionInternal = async (schoolId, sessionId) => {
  const termsSnap = await getDocs(
    query(
      collection(firestore, "terms"),
      where("schoolId", "==", schoolId),
      where("sessionId", "==", sessionId)
    )
  );

  return termsSnap.docs
    .map((item) => ({
      id: item.id,
      ...item.data(),
    }))
    .sort((left, right) => {
      const orderDelta = Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0);
      if (orderDelta !== 0) return orderDelta;
      return toMillis(left?.createdAt) - toMillis(right?.createdAt);
    });
};

const upsertTermLifecycle = ({
  batch,
  schoolId,
  sessionId,
  termsByAlias,
  activeAlias,
}) => {
  TERM_DEFINITIONS.forEach((definition) => {
    const existing = termsByAlias.get(definition.alias) || null;
    const ref = existing ? getTermRef(existing.id) : doc(collection(firestore, "terms"));
    const isCurrent = definition.alias === activeAlias;
    const isPast = definition.sortOrder < getTermDefinition(activeAlias).sortOrder;
    const payload = {
      termId: definition.alias,
      alias: definition.alias,
      name: definition.name,
      schoolId,
      sessionId,
      sortOrder: definition.sortOrder,
      isActive: isCurrent,
      isEditable: isCurrent,
      openedAt: isCurrent ? existing?.openedAt || serverTimestamp() : existing?.openedAt || null,
      closedAt: isPast ? existing?.closedAt || serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    };
    if (!existing) {
      payload.createdAt = serverTimestamp();
    }
    batch.set(ref, payload, { merge: true });
    termsByAlias.set(definition.alias, { ...(existing || {}), id: ref.id, ...payload });
  });
};

const ensureCanonicalTerms = async (schoolId, sessionId, activeAlias = "term1") => {
  const existingTerms = await listTermsForSessionInternal(schoolId, sessionId);
  const termsByAlias = new Map();
  existingTerms.forEach((term) => {
    const alias = normalizeTermAlias(term?.alias || term?.termId || term?.name);
    if (alias) termsByAlias.set(alias, term);
  });

  const batch = writeBatch(firestore);
  upsertTermLifecycle({
    batch,
    schoolId,
    sessionId,
    termsByAlias,
    activeAlias: normalizeTermAlias(activeAlias),
  });
  await batch.commit();

  return TERM_DEFINITIONS.map((definition) => termsByAlias.get(definition.alias)).filter(Boolean);
};

const updateSchoolPointers = ({ batch, schoolId, sessionId, activeTerm }) => {
  batch.set(
    getSettingsRef(schoolId),
    {
      schoolId,
      activeSessionId: sessionId,
      activeTermId: activeTerm.alias,
      activeTermDocId: activeTerm.id,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  batch.set(
    getSchoolRef(schoolId),
    {
      activeSessionId: sessionId,
      activeTermId: activeTerm.alias,
      activeTermDocId: activeTerm.id,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

const getClassRecords = async (schoolId) => {
  const classesSnap = await getDocs(
    query(collection(firestore, "classes"), where("schoolId", "==", schoolId))
  );
  return classesSnap.docs.reduce((acc, item) => {
    const data = item.data() || {};
    const classId = String(data?.classId || item.id).trim();
    if (!classId) return acc;
    acc[classId] = { id: item.id, ...data, classId };
    return acc;
  }, {});
};

export async function listSessions(schoolId) {
  if (!schoolId) return [];
  const sessionsSnap = await getDocs(
    query(collection(firestore, "sessions"), where("schoolId", "==", schoolId))
  );
  return sessionsSnap.docs
    .map((item) => ({
      id: item.id,
      ...item.data(),
      sessionId: item.data()?.sessionId || item.id,
    }))
    .sort((left, right) => toMillis(right?.createdAt) - toMillis(left?.createdAt));
}

export async function getActiveSession(schoolId) {
  if (!schoolId) return null;
  const settings = await readSettings(schoolId);
  const activeSessionId = String(settings?.activeSessionId || "").trim();
  if (activeSessionId) {
    const sessionSnap = await getDoc(getSessionRef(activeSessionId));
    if (sessionSnap.exists()) {
      return {
        id: sessionSnap.id,
        ...sessionSnap.data(),
        sessionId: sessionSnap.data()?.sessionId || sessionSnap.id,
      };
    }
  }

  const sessions = await listSessions(schoolId);
  return (
    sessions.find((item) => !!item?.isActive) ||
    sessions.find((item) => item?.isArchived !== true) ||
    sessions[0] ||
    null
  );
}

export async function getActiveTerm(schoolId) {
  if (!schoolId) return null;
  const settings = await readSettings(schoolId);
  const activeTermDocId = String(settings?.activeTermDocId || "").trim();
  if (activeTermDocId) {
    const termSnap = await getDoc(getTermRef(activeTermDocId));
    if (termSnap.exists()) {
      return { id: termSnap.id, ...termSnap.data() };
    }
  }

  const activeSession = await getActiveSession(schoolId);
  if (!activeSession?.sessionId) return null;

  const terms = await listTermsForSessionInternal(schoolId, activeSession.sessionId);
  const activeAlias = normalizeTermAlias(settings?.activeTermId || "term1");
  return (
    terms.find((item) => normalizeTermAlias(item?.alias || item?.termId) === activeAlias) ||
    terms.find((item) => !!item?.isActive) ||
    terms[0] ||
    null
  );
}

export async function getTermDocumentForSession(schoolId, sessionId, termId = "term1") {
  if (!schoolId || !sessionId) return null;
  const resolvedAlias = normalizeTermAlias(termId);
  const existing = await listTermsForSessionInternal(schoolId, sessionId);
  if (!existing.length) {
    const created = await ensureCanonicalTerms(schoolId, sessionId, resolvedAlias);
    return created.find((item) => normalizeTermAlias(item?.alias || item?.termId) === resolvedAlias) || null;
  }

  return (
    existing.find((item) => normalizeTermAlias(item?.alias || item?.termId || item?.name) === resolvedAlias) ||
    existing.find((item) => String(item?.id || "") === String(termId || "").trim()) ||
    null
  );
}

export async function createSession(schoolId, name) {
  if (!schoolId) throw new Error("schoolId is required");
  const normalizedName = normalizeSessionName(name);
  if (!normalizedName) throw new Error("Session name is required");

  const sessionRef = doc(collection(firestore, "sessions"));
  await setDoc(sessionRef, {
    sessionId: sessionRef.id,
    schoolId,
    name: normalizedName,
    isActive: false,
    isArchived: false,
    isEditable: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await ensureCanonicalTerms(schoolId, sessionRef.id, "term1");

  return {
    id: sessionRef.id,
    sessionId: sessionRef.id,
    schoolId,
    name: normalizedName,
    isActive: false,
    isArchived: false,
    isEditable: true,
  };
}

export async function setActiveSession(schoolId, sessionId) {
  if (!schoolId || !sessionId) {
    throw new Error("schoolId and sessionId are required");
  }

  const sessions = await listSessions(schoolId);
  const targetSession =
    sessions.find((item) => String(item?.sessionId || item?.id) === String(sessionId)) || null;
  if (!targetSession) {
    throw new Error("Session not found");
  }

  const currentSettings = await readSettings(schoolId);
  const currentActiveTermAlias =
    String(currentSettings?.activeSessionId || "").trim() === String(sessionId)
      ? normalizeTermAlias(currentSettings?.activeTermId || "term1")
      : "term1";

  const terms = await ensureCanonicalTerms(schoolId, sessionId, currentActiveTermAlias);
  const activeTerm =
    terms.find((item) => normalizeTermAlias(item?.alias || item?.termId) === currentActiveTermAlias) ||
    terms[0];
  if (!activeTerm?.id) {
    throw new Error("No term configuration found for the selected session");
  }

  const batch = writeBatch(firestore);
  sessions.forEach((sessionItem) => {
    const sessionRef = getSessionRef(sessionItem.id || sessionItem.sessionId);
    const isTarget = String(sessionItem.sessionId || sessionItem.id) === String(sessionId);
    batch.set(
      sessionRef,
      {
        isActive: isTarget,
        isEditable: isTarget ? sessionItem?.isEditable !== false : false,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
  updateSchoolPointers({
    batch,
    schoolId,
    sessionId: String(sessionId),
    activeTerm: {
      id: activeTerm.id,
      alias: normalizeTermAlias(activeTerm.alias || activeTerm.termId),
    },
  });
  await batch.commit();

  return {
    sessionId: String(sessionId),
    activeTermId: normalizeTermAlias(activeTerm.alias || activeTerm.termId),
    activeTermDocId: activeTerm.id,
  };
}

export async function initializeSchoolAcademicCycle({
  schoolId,
  initialSessionName,
  initialTermAlias,
} = {}) {
  if (!schoolId) throw new Error("schoolId is required");
  const normalizedSessionName = normalizeSessionName(initialSessionName);
  if (!parseSessionYears(normalizedSessionName)) {
    throw new Error("Academic session must use YYYY/YYYY format.");
  }
  const activeAlias = normalizeTermAlias(initialTermAlias);

  const session = await createSession(schoolId, normalizedSessionName);
  const terms = await ensureCanonicalTerms(schoolId, session.sessionId, activeAlias);
  const activeTerm =
    terms.find((item) => normalizeTermAlias(item?.alias || item?.termId) === activeAlias) || terms[0];
  if (!activeTerm?.id) {
    throw new Error("Unable to resolve active term during initialization.");
  }

  const batch = writeBatch(firestore);
  batch.set(
    getSessionRef(session.sessionId),
    {
      isActive: true,
      isArchived: false,
      isEditable: true,
      cycleLockedAt: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  updateSchoolPointers({
    batch,
    schoolId,
    sessionId: session.sessionId,
    activeTerm: {
      id: activeTerm.id,
      alias: activeAlias,
    },
  });
  await batch.commit();

  return {
    sessionId: session.sessionId,
    sessionName: normalizedSessionName,
    activeTermId: activeAlias,
    activeTermDocId: activeTerm.id,
  };
}

export async function advanceToNextTerm({ schoolId, sessionId } = {}) {
  if (!schoolId || !sessionId) {
    throw new Error("schoolId and sessionId are required");
  }

  const settings = await readSettings(schoolId);
  if (String(settings?.activeSessionId || "").trim() !== String(sessionId)) {
    throw new Error("Term can only be advanced on the active session.");
  }

  const currentAlias = normalizeTermAlias(settings?.activeTermId || "term1");
  const currentIndex = TERM_DEFINITIONS.findIndex((item) => item.alias === currentAlias);
  if (currentIndex < 0 || currentIndex >= TERM_DEFINITIONS.length - 1) {
    throw new Error("Third Term is final. Use session promotion instead.");
  }

  const nextAlias = TERM_DEFINITIONS[currentIndex + 1].alias;
  const existingTerms = await listTermsForSessionInternal(schoolId, sessionId);
  const termsByAlias = new Map();
  existingTerms.forEach((term) => {
    const alias = normalizeTermAlias(term?.alias || term?.termId || term?.name);
    if (alias) termsByAlias.set(alias, term);
  });

  const batch = writeBatch(firestore);
  upsertTermLifecycle({
    batch,
    schoolId,
    sessionId,
    termsByAlias,
    activeAlias: nextAlias,
  });
  batch.set(
    getSessionRef(sessionId),
    {
      cycleLockedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  updateSchoolPointers({
    batch,
    schoolId,
    sessionId,
    activeTerm: {
      id: termsByAlias.get(nextAlias)?.id,
      alias: nextAlias,
    },
  });
  await batch.commit();

  return {
    sessionId,
    alias: nextAlias,
    activeTermId: nextAlias,
    activeTermDocId: termsByAlias.get(nextAlias)?.id || null,
  };
}

export async function getAcademicCycleEditStatus(schoolId) {
  if (!schoolId) {
    return {
      canEdit: false,
      reason: "No school selected.",
      currentSessionId: "",
      currentSessionName: "",
      currentTermId: "term1",
    };
  }

  const sessions = await listSessions(schoolId);
  const activeSession = await getActiveSession(schoolId);
  const activeTerm = await getActiveTerm(schoolId);
  const currentTermId = normalizeTermAlias(activeTerm?.alias || activeTerm?.termId || "term1");

  const hasLockedCycle =
    sessions.length > 1 ||
    sessions.some((item) => !!item?.cycleLockedAt || !!item?.archivedAt || item?.isArchived === true);

  return {
    canEdit: !hasLockedCycle,
    reason: hasLockedCycle
      ? "Session and term can only be edited before the first term or session promotion."
      : "",
    currentSessionId: String(activeSession?.sessionId || activeSession?.id || "").trim(),
    currentSessionName: String(activeSession?.name || "").trim(),
    currentTermId,
  };
}

export async function correctInitialAcademicCycle({
  schoolId,
  sessionName,
  termAlias,
} = {}) {
  if (!schoolId) throw new Error("schoolId is required");
  const status = await getAcademicCycleEditStatus(schoolId);
  if (!status.canEdit) {
    throw new Error(status.reason || "Academic cycle can no longer be edited.");
  }

  const sessionId = String(status.currentSessionId || "").trim();
  if (!sessionId) {
    return initializeSchoolAcademicCycle({
      schoolId,
      initialSessionName: sessionName,
      initialTermAlias: termAlias,
    });
  }

  const normalizedSessionName = normalizeSessionName(sessionName);
  const activeAlias = normalizeTermAlias(termAlias);
  const existingTerms = await listTermsForSessionInternal(schoolId, sessionId);
  const termsByAlias = new Map();
  existingTerms.forEach((term) => {
    const alias = normalizeTermAlias(term?.alias || term?.termId || term?.name);
    if (alias) termsByAlias.set(alias, term);
  });

  const batch = writeBatch(firestore);
  batch.set(
    getSessionRef(sessionId),
    {
      name: normalizedSessionName,
      isActive: true,
      isArchived: false,
      isEditable: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  upsertTermLifecycle({
    batch,
    schoolId,
    sessionId,
    termsByAlias,
    activeAlias,
  });
  updateSchoolPointers({
    batch,
    schoolId,
    sessionId,
    activeTerm: {
      id: termsByAlias.get(activeAlias)?.id,
      alias: activeAlias,
    },
  });
  await batch.commit();

  return {
    sessionId,
    sessionName: normalizedSessionName,
    activeTermId: activeAlias,
    activeTermDocId: termsByAlias.get(activeAlias)?.id || null,
  };
}

export async function promoteStudents({
  schoolId,
  fromSessionId,
  targetSessionName,
} = {}) {
  if (!schoolId || !fromSessionId || !targetSessionName) {
    throw new Error("schoolId, fromSessionId and targetSessionName are required");
  }

  const targetSession = await createSession(schoolId, targetSessionName);
  const targetTerms = await ensureCanonicalTerms(schoolId, targetSession.sessionId, "term1");
  const targetTerm = targetTerms.find((item) => normalizeTermAlias(item?.alias || item?.termId) === "term1");
  if (!targetTerm?.id) {
    throw new Error("Unable to configure target session term.");
  }

  const [enrollmentsSnap, studentsSnap, classRecords] = await Promise.all([
    getDocs(
      query(
        collection(firestore, "enrollments"),
        where("schoolId", "==", schoolId),
        where("sessionId", "==", fromSessionId)
      )
    ),
    getDocs(query(collection(firestore, "students"), where("schoolId", "==", schoolId))),
    getClassRecords(schoolId),
  ]);

  const studentMap = studentsSnap.docs.reduce((acc, item) => {
    acc[item.id] = { id: item.id, ...item.data() };
    return acc;
  }, {});

  const nextClassById = buildClassPromotionMap(classRecords);
  const sourceEnrollments = enrollmentsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const batch = writeBatch(firestore);

  batch.set(
    getSessionRef(fromSessionId),
    {
      isActive: false,
      isArchived: true,
      isEditable: false,
      archivedAt: serverTimestamp(),
      cycleLockedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  batch.set(
    getSessionRef(targetSession.sessionId),
    {
      isActive: true,
      isArchived: false,
      isEditable: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  updateSchoolPointers({
    batch,
    schoolId,
    sessionId: targetSession.sessionId,
    activeTerm: {
      id: targetTerm.id,
      alias: "term1",
    },
  });

  let totalStudents = 0;
  let promoted = 0;
  let skipped = 0;
  const existingTargetEnrollments = new Set();

  const existingTargetSnap = await getDocs(
    query(
      collection(firestore, "enrollments"),
      where("schoolId", "==", schoolId),
      where("sessionId", "==", targetSession.sessionId)
    )
  );
  existingTargetSnap.docs.forEach((item) => {
    const data = item.data() || {};
    existingTargetEnrollments.add(`${data.studentId}::${data.classId}`);
  });

  sourceEnrollments.forEach((enrollment) => {
    totalStudents += 1;
    const student = studentMap[enrollment.studentId] || null;
    const studentStatus = String(student?.status || "active").toLowerCase();
    if (student?.isDeleted || studentStatus === "withdrawn" || studentStatus === "graduated") {
      skipped += 1;
      return;
    }
    const nextClassId = nextClassById[String(enrollment.classId || "").trim()];
    if (!nextClassId) {
      skipped += 1;
      return;
    }
    const dedupeKey = `${enrollment.studentId}::${nextClassId}`;
    if (existingTargetEnrollments.has(dedupeKey)) {
      skipped += 1;
      return;
    }
    existingTargetEnrollments.add(dedupeKey);

    const newEnrollmentRef = doc(collection(firestore, "enrollments"));
    batch.set(newEnrollmentRef, {
      enrollmentId: newEnrollmentRef.id,
      schoolId,
      studentId: enrollment.studentId,
      classId: nextClassId,
      departmentId: String(enrollment?.departmentId || "").trim(),
      departmentName: String(enrollment?.departmentName || "").trim(),
      sessionId: targetSession.sessionId,
      entryTermId: "term1",
      entryTermOrder: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    promoted += 1;
  });

  await batch.commit();

  return {
    fromSessionId,
    toSessionId: targetSession.sessionId,
    toSessionName: targetSessionName,
    totalStudents,
    promoted,
    skipped,
  };
}
