import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "../firebase";
import {
  createSession,
  getActiveSession,
  getActiveTerm,
  listSessions,
  promoteStudents,
  setActiveSession,
} from "./firestoreService";
import { getCurrentSessionId, resolveSession } from "./sessionContextService";

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

const parseSessionYears = (sessionName) => {
  const match = String(sessionName || "").trim().match(/^(\d{4})\s*\/\s*(\d{4})$/);
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
  return { startYear, endYear };
};

const getNextSessionName = (sessionName) => {
  const parsed = parseSessionYears(sessionName);
  if (!parsed) {
    throw new Error("Current session name must use YYYY/YYYY format");
  }
  return `${parsed.startYear + 1}/${parsed.endYear + 1}`;
};

const getTermAlias = (value) => {
  const token = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (["term1", "1", "1stterm", "firstterm"].includes(token)) return "term1";
  if (["term2", "2", "2ndterm", "secondterm"].includes(token)) return "term2";
  if (["term3", "3", "3rdterm", "thirdterm"].includes(token)) return "term3";
  return "";
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

const getCandidateClassKeys = (stage, level, suffix = "") => {
  if (stage === "JSS") return [`JSS${level}${suffix}`];
  return [`SS${level}${suffix}`, `SSS${level}${suffix}`];
};

const resolveNextClassIdByRules = (classId, classesById) => {
  const classRecord = classesById[classId] || {};
  const parsed =
    parseClassForPromotion(classRecord?.classId) ||
    parseClassForPromotion(classRecord?.name) ||
    parseClassForPromotion(classRecord?.label) ||
    parseClassForPromotion(classId);
  if (!parsed) return null;

  let nextStage = parsed.stage;
  let nextLevel = parsed.level;

  if (parsed.stage === "JSS") {
    if (parsed.level === 1) nextLevel = 2;
    else if (parsed.level === 2) nextLevel = 3;
    else if (parsed.level === 3) {
      nextStage = "SS";
      nextLevel = 1;
    } else return null;
  } else if (parsed.stage === "SS") {
    if (parsed.level === 1) nextLevel = 2;
    else if (parsed.level === 2) nextLevel = 3;
    else if (parsed.level === 3) return null;
    else return null;
  }

  const targetKeys = [
    ...getCandidateClassKeys(nextStage, nextLevel, parsed.suffix),
    ...getCandidateClassKeys(nextStage, nextLevel, ""),
  ];

  const keyToClassIds = {};
  Object.entries(classesById).forEach(([candidateId, candidate]) => {
    const keys = [
      normalizeClassToken(candidateId),
      normalizeClassToken(candidate?.classId),
      normalizeClassToken(candidate?.name),
      normalizeClassToken(candidate?.label),
    ].filter(Boolean);
    keys.forEach((key) => {
      if (!keyToClassIds[key]) keyToClassIds[key] = [];
      keyToClassIds[key].push(candidateId);
    });
  });

  for (const key of targetKeys) {
    const candidates = keyToClassIds[key] || [];
    if (candidates.length > 0) return candidates[0];
  }

  const broadTargets = getCandidateClassKeys(nextStage, nextLevel, "").map((key) =>
    normalizeClassToken(key)
  );
  const broadMatch = Object.entries(classesById).find(([candidateId, candidate]) => {
    const candidateTokens = [
      candidateId,
      candidate?.classId,
      candidate?.name,
      candidate?.label,
    ]
      .map((token) => normalizeClassToken(token))
      .filter(Boolean);

    return candidateTokens.some((token) =>
      broadTargets.some((target) => token.startsWith(target))
    );
  });
  if (broadMatch) return broadMatch[0];

  if (nextStage === "JSS") return `jss${nextLevel}`;
  return `sss${nextLevel}`;
};

const isTerminalSeniorClass = (classId, classesById = {}) => {
  const classRecord = classesById[classId] || {};
  const parsed =
    parseClassForPromotion(classRecord?.classId) ||
    parseClassForPromotion(classRecord?.name) ||
    parseClassForPromotion(classRecord?.label) ||
    parseClassForPromotion(classId);
  return parsed?.stage === "SS" && Number(parsed?.level) === 3;
};

const getNextClassMap = (classesById) => {
  const orderedClasses = Object.entries(classesById)
    .map(([id, classData]) => ({
      classId: classData?.classId || id,
      levelOrder: Number(classData?.levelOrder),
    }))
    .filter((entry) => Number.isFinite(entry.levelOrder))
    .sort((a, b) => a.levelOrder - b.levelOrder);

  const nextClassById = {};
  orderedClasses.forEach((entry, index) => {
    const next = orderedClasses[index + 1];
    if (next) {
      nextClassById[entry.classId] = next.classId;
    }
  });
  return nextClassById;
};

const getClassRecords = async (schoolId) => {
  const classesQ = query(collection(firestore, "classes"), where("schoolId", "==", schoolId));
  const classesSnap = await getDocs(classesQ);
  return classesSnap.docs.reduce((acc, item) => {
    const data = item.data();
    const key = data?.classId || item.id;
    acc[key] = { id: item.id, ...data, classId: key };
    return acc;
  }, {});
};

const getSessionEnrollments = async (schoolId, sessionId) => {
  const enrollmentsQ = query(
    collection(firestore, "enrollments"),
    where("schoolId", "==", schoolId),
    where("sessionId", "==", sessionId)
  );
  const enrollmentsSnap = await getDocs(enrollmentsQ);
  return enrollmentsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
};

/**
 * Create a session and immediately activate it.
 */
export const createAndActivateSession = async (name, schoolId) => {
  if (!name || !String(name).trim()) {
    throw new Error("Session name is required");
  }
  if (!schoolId) {
    throw new Error("schoolId is required");
  }

  const previousActiveSessionId = await getCurrentSessionId(schoolId);
  const createdSession = await createSession(schoolId, name);
  await setActiveSession(schoolId, createdSession.sessionId);

  if (previousActiveSessionId && previousActiveSessionId !== createdSession.sessionId) {
    await writeBatch(firestore)
      .set(
        doc(firestore, "sessions", previousActiveSessionId),
        {
          isArchived: true,
          isEditable: false,
          isActive: false,
          archivedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
      .commit();
  }

  const sessions = await listSessions(schoolId);
  return {
    success: true,
    action: "createAndActivateSession",
    schoolId,
    createdSessionId: createdSession.sessionId,
    previousActiveSessionId: previousActiveSessionId || null,
    currentActiveSessionId: createdSession.sessionId,
    counts: {
      totalSessions: sessions.length,
      activeSessions: sessions.filter((session) => !!session?.isActive).length,
      archivedSessions: sessions.filter((session) => !!session?.isArchived).length,
    },
    session: createdSession,
  };
};

/**
 * Promote current session into the next session.
 */
export const promoteToNewSession = async ({ schoolId, fromSessionId } = {}) => {
  if (!schoolId) throw new Error("schoolId is required");

  const resolvedFromSessionId = fromSessionId || (await getCurrentSessionId(schoolId));
  if (!resolvedFromSessionId) {
    throw new Error("No active session found to promote");
  }

  const sessions = await listSessions(schoolId);
  const sourceSession =
    sessions.find((item) => item?.sessionId === resolvedFromSessionId) || null;
  if (!sourceSession) {
    throw new Error("Source session not found");
  }
  if (sourceSession?.isArchived) {
    throw new Error("Cannot promote an archived session");
  }

  const activeSession = await getActiveSession(schoolId);
  const activeSessionId = String(activeSession?.sessionId || activeSession?.id || "").trim();
  if (!activeSessionId || activeSessionId !== String(resolvedFromSessionId)) {
    throw new Error("Promotion is only allowed from the active session");
  }

  const activeTerm = await getActiveTerm(schoolId);
  const activeTermAlias =
    getTermAlias(activeTerm?.alias) ||
    getTermAlias(activeTerm?.termId) ||
    getTermAlias(activeTerm?.name) ||
    "term1";
  if (activeTermAlias !== "term3") {
    throw new Error("Promotion is only allowed after Third Term.");
  }

  const nextSessionName = getNextSessionName(sourceSession?.name || "");
  const duplicate = sessions.find(
    (item) =>
      String(item?.name || "").replace(/\s+/g, "").toLowerCase() ===
      nextSessionName.replace(/\s+/g, "").toLowerCase()
  );
  if (duplicate) {
    throw new Error("Next session already exists. Archive or activate it manually.");
  }

  const impact = await previewPromotionImpact(schoolId, resolvedFromSessionId);
  const totalEnrollments = Number(impact?.counts?.totalEnrollments || 0);
  const promotable = Number(impact?.counts?.promotable || 0);
  if (totalEnrollments <= 0) {
    throw new Error(
      "No students found in the selected source session. Switch to the correct session before promoting."
    );
  }
  if (promotable <= 0) {
    throw new Error(
      "No promotable students found. Check class structure/mapping (JSS1->JSS2 ... SS2->SS3)."
    );
  }

  const promotionSummary = await promoteStudents({
    schoolId,
    fromSessionId: resolvedFromSessionId,
    targetSessionName: nextSessionName,
  });

  return {
    success: true,
    schoolId,
    fromSessionId: resolvedFromSessionId,
    toSessionId: promotionSummary.toSessionId,
    toSessionName: promotionSummary.toSessionName,
    promotion: promotionSummary,
  };
};

/**
 * Archive a session and maintain active-session integrity.
 */
export const archiveSession = async (sessionId, schoolId) => {
  if (!sessionId) {
    throw new Error("sessionId is required");
  }

  const sessionDoc = await getDoc(doc(firestore, "sessions", sessionId));
  if (!sessionDoc.exists()) {
    throw new Error("Session not found");
  }
  const sessionData = sessionDoc.data();
  const resolvedSchoolId = schoolId || sessionData?.schoolId;
  if (!resolvedSchoolId) {
    throw new Error("Unable to resolve schoolId for this session");
  }
  if (sessionData.schoolId !== resolvedSchoolId) {
    throw new Error("Session does not belong to this school");
  }

  const settingsSnap = await getDoc(doc(firestore, "settings", resolvedSchoolId));
  const activeSessionId = settingsSnap.exists()
    ? String(settingsSnap.data()?.activeSessionId || "")
    : "";
  const wasActive = activeSessionId === sessionId;

  const batch = writeBatch(firestore);
  batch.set(
    doc(firestore, "sessions", sessionId),
    {
      isArchived: true,
      isActive: false,
      isEditable: false,
      archivedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await batch.commit();

  let nextActiveSessionId = null;
  if (wasActive) {
    const sessions = await listSessions(resolvedSchoolId);
    const fallback = sessions
      .filter((item) => item.sessionId !== sessionId && !item?.isArchived)
      .sort((a, b) => toMillis(b?.createdAt) - toMillis(a?.createdAt))[0];
    if (fallback?.sessionId) {
      await setActiveSession(resolvedSchoolId, fallback.sessionId);
      nextActiveSessionId = fallback.sessionId;
    } else {
      await writeBatch(firestore)
        .set(
          doc(firestore, "settings", resolvedSchoolId),
          {
            schoolId: resolvedSchoolId,
            activeSessionId: null,
            activeTermId: "term1",
            activeTermDocId: null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
        .commit();
    }
  }

  const latestSessions = await listSessions(resolvedSchoolId);
  return {
    success: true,
    action: "archiveSession",
    schoolId: resolvedSchoolId,
    sessionId,
    wasActive,
    nextActiveSessionId: nextActiveSessionId || null,
    counts: {
      totalSessions: latestSessions.length,
      activeSessions: latestSessions.filter((session) => session?.isActive).length,
      archivedSessions: latestSessions.filter((session) => session?.isArchived).length,
    },
    summary: {
      archived: true,
      activeSessionChanged: wasActive,
    },
  };
};

/**
 * List sessions with enrollment/term/score counts.
 */
export const listSessionsWithCounts = async (schoolId) => {
  if (!schoolId) {
    throw new Error("schoolId is required");
  }

  const [sessions, enrollmentsSnap, scoresSnap, termsSnap] = await Promise.all([
    listSessions(schoolId),
    getDocs(query(collection(firestore, "enrollments"), where("schoolId", "==", schoolId))),
    getDocs(query(collection(firestore, "scores"), where("schoolId", "==", schoolId))),
    getDocs(query(collection(firestore, "terms"), where("schoolId", "==", schoolId))),
  ]);

  const enrollmentCounts = {};
  enrollmentsSnap.docs.forEach((item) => {
    const sessionId = String(item.data()?.sessionId || "").trim();
    if (!sessionId) return;
    enrollmentCounts[sessionId] = (enrollmentCounts[sessionId] || 0) + 1;
  });

  const scoreCounts = {};
  scoresSnap.docs.forEach((item) => {
    const sessionId = String(item.data()?.sessionId || "").trim();
    if (!sessionId) return;
    scoreCounts[sessionId] = (scoreCounts[sessionId] || 0) + 1;
  });

  const termCounts = {};
  termsSnap.docs.forEach((item) => {
    const sessionId = String(item.data()?.sessionId || "").trim();
    if (!sessionId) return;
    termCounts[sessionId] = (termCounts[sessionId] || 0) + 1;
  });

  const sessionsWithCounts = sessions.map((session) => {
    const sessionId = session?.sessionId;
    return {
      ...session,
      counts: {
        termCount: termCounts[sessionId] || 0,
        enrollmentCount: enrollmentCounts[sessionId] || 0,
        scoreCount: scoreCounts[sessionId] || 0,
      },
    };
  });

  return {
    schoolId,
    sessions: sessionsWithCounts,
    counts: {
      totalSessions: sessionsWithCounts.length,
      activeSessions: sessionsWithCounts.filter((session) => session?.isActive).length,
      archivedSessions: sessionsWithCounts.filter((session) => session?.isArchived).length,
      totalEnrollments: sessionsWithCounts.reduce(
        (sum, session) => sum + (session?.counts?.enrollmentCount || 0),
        0
      ),
      totalScores: sessionsWithCounts.reduce(
        (sum, session) => sum + (session?.counts?.scoreCount || 0),
        0
      ),
    },
  };
};

/**
 * Preview class-by-class promotion impact without writing data.
 */
export const previewPromotionImpact = async (schoolId, sessionId) => {
  if (!schoolId) {
    throw new Error("schoolId is required");
  }

  const resolvedSessionId = await resolveSession(sessionId, schoolId);
  if (!resolvedSessionId) {
    return {
      schoolId,
      sessionId: null,
      counts: {
        totalEnrollments: 0,
        promotable: 0,
        graduating: 0,
        unmappedClass: 0,
      },
      classSummary: [],
    };
  }

  const [classesById, enrollments] = await Promise.all([
    getClassRecords(schoolId),
    getSessionEnrollments(schoolId, resolvedSessionId),
  ]);

  if (enrollments.length === 0) {
    return {
      schoolId,
      sessionId: resolvedSessionId,
      counts: {
        totalEnrollments: 0,
        promotable: 0,
        graduating: 0,
        unmappedClass: 0,
      },
      classSummary: [],
    };
  }

  const nextClassMap = getNextClassMap(classesById);
  const classMetrics = {};
  let promotable = 0;
  let graduating = 0;
  let unmappedClass = 0;

  enrollments.forEach((enrollment) => {
    const classId = String(enrollment?.classId || "").trim();
    if (!classId) return;

    const nextClassId = nextClassMap[classId] || resolveNextClassIdByRules(classId, classesById);
    if (!classMetrics[classId]) {
      classMetrics[classId] = {
        classId,
        total: 0,
        promotable: 0,
        graduating: 0,
        nextClassId: nextClassId || null,
      };
    }

    classMetrics[classId].total += 1;

    if (nextClassId) {
      promotable += 1;
      classMetrics[classId].promotable += 1;
    } else if (isTerminalSeniorClass(classId, classesById)) {
      graduating += 1;
      classMetrics[classId].graduating += 1;
    } else {
      unmappedClass += 1;
    }
  });

  return {
    schoolId,
    sessionId: resolvedSessionId,
    counts: {
      totalEnrollments: enrollments.length,
      promotable,
      graduating,
      unmappedClass,
    },
    classSummary: Object.values(classMetrics).sort((a, b) =>
      String(a.classId).localeCompare(String(b.classId))
    ),
    summary: {
      promotionReady: promotable > 0,
    },
  };
};

export default {
  createAndActivateSession,
  archiveSession,
  listSessionsWithCounts,
  previewPromotionImpact,
  promoteToNewSession,
};
