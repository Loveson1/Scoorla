import { setSessionState, getSessionState } from "../../utils/userSession";
import { auth, firestore } from "../../firebase";
import {
  collection,
  documentId,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  resolveSession,
  resolveTerm,
  getCurrentSessionId as getCurrentSessionIdFromContext,
} from "../../utils/sessionContextService";
import { getTermDocumentForSession } from "../../utils/firestoreService";
import { getStudentsInClass as queryStudentsInClass } from "../../utils/queryService";
import {
  applySchoolCountDelta,
  buildSchoolSearchIndex,
  recomputeSchoolCounts,
} from "../../utils/schoolDirectoryService";
import { logAuditEvent } from "../../services/auditLogService";
import {
  instrumentFirestoreRead,
  instrumentFirestoreWrite,
} from "../../services/firestoreInstrumentation";
import {
  getCachedValue,
  setCachedValue,
  invalidateCachePrefix,
} from "../../services/dataCache";
import {
  dispatchSchoolProfileUpdated,
  dispatchSchoolSettingsUpdated,
} from "../../utils/appEvents";
import {
  ensureUserScope,
  getCachedUserScope,
  getCachedUserScopeForSchool,
} from "../../utils/userScopeCache";

// Utility function for rounding: 0.5 and above rounds up, below 0.5 rounds down
export function roundScore(value) {
  return Math.round(value);
}

const normalizeTermAlias = (value) => {
  const token = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!token) return "term1";
  if (["term1", "1", "1st", "1stterm", "firstterm"].includes(token)) return "term1";
  if (["term2", "2", "2nd", "2ndterm", "secondterm"].includes(token)) return "term2";
  if (["term3", "3", "3rd", "3rdterm", "thirdterm"].includes(token)) return "term3";
  return "term1";
};

const getTermSortOrder = (value, fallback = 1) => {
  const normalized = normalizeTermAlias(value);
  if (normalized === "term1") return 1;
  if (normalized === "term2") return 2;
  if (normalized === "term3") return 3;
  return fallback;
};

export const shouldUseLastTermCumulative = (termId) =>
  normalizeTermAlias(termId) !== "term1";

export const getPreviousTermAlias = (termId) => {
  const normalized = normalizeTermAlias(termId);
  if (normalized === "term2") return "term1";
  if (normalized === "term3") return "term2";
  return null;
};

const normalizeStoredLtcOverride = (value) => {
  if (value === "" || value === null || value === undefined) {
    return "";
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "";
  }
  return Math.max(0, Math.min(100, numericValue));
};

const DEFAULT_RESULT_ASSESSMENTS = [
  { key: "test1", label: "Test 1", max: 20, enabled: true, type: "ca", order: 1 },
  { key: "test2", label: "Test 2", max: 20, enabled: true, type: "ca", order: 2 },
  { key: "test3", label: "Test 3", max: 20, enabled: false, type: "ca", order: 3 },
  { key: "exam", label: "Exam", max: 60, enabled: true, type: "exam", order: 4 },
];

const DEFAULT_RESULT_DISPLAY = {
  showCa: true,
  showExamPlusCa: true,
  showLtc: true,
  showTotal: true,
  showClassAverage: true,
  showPosition: true,
  showGrade: true,
  showRemark: true,
  showHighestInClass: false,
  showLowestInClass: false,
};

const DEFAULT_ENABLED_GRADES = ["A", "B", "C", "D", "E", "F"];
const GRADE_ORDER = ["A", "B", "C", "D", "E", "F"];

const createDefaultAssessments = () =>
  DEFAULT_RESULT_ASSESSMENTS.map((item) => ({ ...item }));

export function getDefaultResultConfig() {
  return {
    assessments: createDefaultAssessments(),
    display: { ...DEFAULT_RESULT_DISPLAY },
    enabledGrades: [...DEFAULT_ENABLED_GRADES],
  };
}

export function normalizeResultConfig(config = {}) {
  const fallback = getDefaultResultConfig();
  const incomingAssessments = Array.isArray(config?.assessments) ? config.assessments : [];
  const mergedAssessments = fallback.assessments.map((baseItem) => {
    const override = incomingAssessments.find(
      (candidate) => String(candidate?.key || "").trim() === baseItem.key
    );
    const normalizedMax = Number(override?.max);
    return {
      ...baseItem,
      label: String(override?.label || baseItem.label).trim() || baseItem.label,
      max: Number.isFinite(normalizedMax) && normalizedMax >= 0 ? normalizedMax : baseItem.max,
      enabled:
        baseItem.key === "test1" ||
        baseItem.key === "test2" ||
        baseItem.key === "exam"
          ? true
          : override?.enabled === undefined
            ? baseItem.enabled
            : override.enabled !== false,
    };
  });

  const enabledGrades = Array.isArray(config?.enabledGrades)
    ? config.enabledGrades
        .map((grade) => String(grade || "").trim().toUpperCase())
        .filter(Boolean)
    : fallback.enabledGrades;

  return {
    assessments: mergedAssessments.sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    display: {
      ...fallback.display,
      ...(config?.display || {}),
    },
    enabledGrades:
      enabledGrades.length > 0
        ? [...new Set(enabledGrades)]
        : [...fallback.enabledGrades],
  };
}

export function getEnabledScoreComponents(resultConfig = null) {
  const normalized = normalizeResultConfig(resultConfig || {});
  return normalized.assessments.filter((component) => component.enabled !== false);
}

export const isResultColumnEnabled = (resultConfig, key) => {
  const normalized = normalizeResultConfig(resultConfig || {});
  const displayMap = {
    ca: "showCa",
    examAndCa: "showExamPlusCa",
    ltc: "showLtc",
    total: "showTotal",
    classAverage: "showClassAverage",
    position: "showPosition",
    grade: "showGrade",
    remark: "showRemark",
    highestInClass: "showHighestInClass",
    lowestInClass: "showLowestInClass",
  };
  const toggleKey = displayMap[key];
  if (!toggleKey) return true;
  return normalized.display?.[toggleKey] !== false;
};

export const getConfiguredGradingScale = (
  gradingScale = getDefaultGradingScale(),
  resultConfig = null
) => {
  const normalized = normalizeResultConfig(resultConfig || {});
  const enabledGrades = new Set(normalized.enabledGrades || DEFAULT_ENABLED_GRADES);
  const baseScale = normalizeGradingScale(gradingScale);

  const configured = {};
  GRADE_ORDER.forEach((grade) => {
    if (!enabledGrades.has(grade)) return;
    configured[grade] = {
      ...baseScale[grade],
    };
  });

  if (Object.keys(configured).length === 0) {
    return baseScale;
  }

  GRADE_ORDER.forEach((grade, index) => {
    if (enabledGrades.has(grade)) return;

    const disabledRange = baseScale[grade];
    const lowerEnabledGrade = GRADE_ORDER.slice(index + 1).find((candidate) =>
      enabledGrades.has(candidate)
    );

    if (lowerEnabledGrade) {
      configured[lowerEnabledGrade] = {
        min: Math.min(
          Number(configured[lowerEnabledGrade]?.min || 0),
          Number(disabledRange?.min || 0)
        ),
        max: Math.max(
          Number(configured[lowerEnabledGrade]?.max || 0),
          Number(disabledRange?.max || 0)
        ),
      };
      return;
    }

    const higherEnabledGrade = [...GRADE_ORDER.slice(0, index)]
      .reverse()
      .find((candidate) => enabledGrades.has(candidate));

    if (higherEnabledGrade) {
      configured[higherEnabledGrade] = {
        min: Math.min(
          Number(configured[higherEnabledGrade]?.min || 0),
          Number(disabledRange?.min || 0)
        ),
        max: Math.max(
          Number(configured[higherEnabledGrade]?.max || 0),
          Number(disabledRange?.max || 0)
        ),
      };
    }
  });

  return GRADE_ORDER.reduce((acc, grade) => {
    if (configured[grade]) {
      acc[grade] = configured[grade];
    }
    return acc;
  }, {});
};

export const formatGradingScaleLegend = (
  gradingScale = getDefaultGradingScale(),
  resultConfig = null
) => {
  const filtered = getConfiguredGradingScale(gradingScale, resultConfig);
  return Object.entries(filtered)
    .sort(([, a], [, b]) => Number(b?.max || 0) - Number(a?.max || 0))
    .map(([grade, range]) => `${grade}(${range.min}-${range.max})`)
    .join(", ");
};

export const hasAnyStoredScoreValue = (scoreRow) =>
  [scoreRow?.test1, scoreRow?.test2, scoreRow?.test3, scoreRow?.exam, scoreRow?.ltcOverride].some(
    (value) => value !== "" && value !== null && value !== undefined
  );

export const buildScoreBreakdown = ({
  termId,
  scoreRow,
  computedLtc = 0,
  resultConfig = null,
}) => {
  const normalizedTerm = normalizeTermAlias(termId);
  const enabledComponents = getEnabledScoreComponents(resultConfig);
  const examComponent =
    enabledComponents.find((item) => item.type === "exam") ||
    { key: "exam", label: "Exam", max: 60, enabled: true, type: "exam", order: 4 };
  const caComponents = enabledComponents.filter((item) => item.type !== "exam");
  const componentScores = enabledComponents.reduce((acc, component) => {
    acc[component.key] = roundScore(parseFloat(scoreRow?.[component.key]) || 0);
    return acc;
  }, {});
  const caTotal = caComponents.reduce(
    (sum, component) => sum + (Number(componentScores?.[component.key]) || 0),
    0
  );
  const exam = Number(componentScores?.[examComponent.key] || 0);
  const examAndCa = caTotal + exam;

  if (normalizedTerm === "term1") {
    return {
      ...componentScores,
      componentScores,
      caTotal,
      testSum: caTotal,
      exam,
      examAndCa,
      lastTermCumulative: null,
      total: examAndCa,
    };
  }

  const manualLtc = normalizeStoredLtcOverride(scoreRow?.ltcOverride);
  const computedLtcValue = roundScore(Number(computedLtc) || 0);
  const hasStoredLtcCache =
    scoreRow?.lastTermCumulativeCache !== "" &&
    scoreRow?.lastTermCumulativeCache !== null &&
    scoreRow?.lastTermCumulativeCache !== undefined;
  const storedLtcCacheValue = hasStoredLtcCache
    ? roundScore(Number(scoreRow?.lastTermCumulativeCache) || 0)
    : 0;
  const lastTermCumulative =
    computedLtcValue > 0
      ? computedLtcValue
      : manualLtc !== ""
        ? roundScore(Number(manualLtc) || 0)
        : hasStoredLtcCache
          ? storedLtcCacheValue
          : 0;

  return {
    ...componentScores,
    componentScores,
    caTotal,
    testSum: caTotal,
    exam,
    examAndCa,
    lastTermCumulative,
    total: roundScore((examAndCa + lastTermCumulative) / 2),
  };
};

const normalizeSubjectId = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeSubjectAliasToken = (value) => {
  const normalized = normalizeSubjectId(value)
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalized) return "";
  if (normalized === "basic science" || normalized === "basic science and technology") {
    return "basic_science_and_technology";
  }
  return normalized.replace(/\s+/g, "_");
};

const normalizeClassId = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const getClassQueryCandidates = (value) => {
  const normalized = normalizeClassId(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return [];
  const classLabelMap = {
    jss1: "JSS 1",
    jss2: "JSS 2",
    jss3: "JSS 3",
    sss1: "SSS 1",
    sss2: "SSS 2",
    sss3: "SSS 3",
  };
  return [...new Set([normalizeClassId(value), classLabelMap[normalized]].filter(Boolean))];
};

const getTermQueryCandidates = (termId) => {
  const normalized = normalizeTermAlias(termId);
  if (normalized === "term1") {
    return ["term1", "1st", "1st Term", "First Term"];
  }
  if (normalized === "term2") {
    return ["term2", "2nd", "2nd Term", "Second Term"];
  }
  if (normalized === "term3") {
    return ["term3", "3rd", "3rd Term", "Third Term"];
  }
  return [String(termId || "").trim()].filter(Boolean);
};

const normalizeLegacyTermMatchToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

const getSessionQueryCandidates = async (sessionId) => {
  const normalized = String(sessionId || "").trim();
  if (!normalized) return [];
  const values = new Set([normalized]);
  try {
    const sessionSnap = await instrumentFirestoreRead(
      getDoc(doc(firestore, "sessions", normalized)),
      {
        screen: "Record/Result Preview",
        action: "scores_session_context_lookup",
        target: `sessions/${normalized}`,
      }
    );
    if (sessionSnap.exists()) {
      const sessionName = String(sessionSnap.data()?.name || "").trim();
      if (sessionName) {
        values.add(sessionName);
      }
    }
  } catch {
    // no-op
  }
  return [...values];
};

const normalizeSubjectMatchToken = (value) =>
  normalizeSubjectAliasToken(value);

const getSubjectQueryCandidates = (value, { schoolId = "", classId = "" } = {}) => {
  const normalized = normalizeSubjectId(value);
  const aliasToken = normalizeSubjectAliasToken(normalized);
  if (!normalized) return [];

  const baseCandidates =
    aliasToken === "basic_science_and_technology"
      ? uniqueSubjectNames([
          normalized,
          "Basic Science",
          "Basic Science and Technology",
          "Basic Science & Technology",
        ])
      : uniqueSubjectNames([
          normalized,
          normalizeSubjectId(normalized.replace(/\s*&\s*/gi, " and ")),
          normalizeSubjectId(normalized.replace(/\s+and\s+/gi, " & ")),
        ]);

  const normalizedSchoolId = String(schoolId || "").trim();
  const normalizedClassId = normalizeClassId(classId).toLowerCase();
  const level = ["jss1", "jss2", "jss3"].includes(normalizedClassId) ? "junior" : "senior";
  const docIdCandidates =
    normalizedSchoolId && level
      ? baseCandidates
          .map((candidate) => buildSubjectCatalogDocId(normalizedSchoolId, level, candidate))
          .filter(Boolean)
      : [];

  return uniqueSubjectNames([
    ...baseCandidates,
    ...docIdCandidates,
  ]);
};

const normalizeClassMatchToken = (value) =>
  normalizeClassId(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const pickPreferredSubjectLabel = (items = []) => {
  const normalizedItems = uniqueSubjectNames(items);
  if (normalizedItems.length === 0) return "";

  const exactPreference = [
    "Basic Science and Technology",
    "Basic Science & Technology",
    "Basic Science",
  ];

  for (const preferred of exactPreference) {
    const match = normalizedItems.find((item) => item === preferred);
    if (match) {
      return match;
    }
  }

  return [...normalizedItems].sort((left, right) => {
    const leftLength = String(left || "").length;
    const rightLength = String(right || "").length;
    if (leftLength !== rightLength) {
      return leftLength - rightLength;
    }
    return String(left || "").localeCompare(String(right || ""));
  })[0];
};

export const collapseSubjectAliasOptions = (items = []) => {
  const grouped = new Map();

  (items || []).forEach((item) => {
    const normalized = normalizeSubjectId(item);
    if (!normalized) return;
    if (normalized.includes("__junior__") || normalized.includes("__senior__")) {
      return;
    }
    const token = normalizeSubjectMatchToken(normalized);
    if (!token) return;
    if (!grouped.has(token)) {
      grouped.set(token, []);
    }
    grouped.get(token).push(normalized);
  });

  return [...grouped.values()]
    .map((groupItems) => pickPreferredSubjectLabel(groupItems))
    .filter(Boolean)
    .sort((left, right) => String(left || "").localeCompare(String(right || "")));
};

const filterClassesByAssignments = (classes = {}, assignedClasses = []) => {
  const allowedTokens = new Set(
    (assignedClasses || []).map((item) => normalizeClassMatchToken(item)).filter(Boolean)
  );
  if (allowedTokens.size === 0) {
    return classes || {};
  }
  return Object.entries(classes || {}).reduce((acc, [classId, value]) => {
    if (allowedTokens.has(normalizeClassMatchToken(classId))) {
      acc[classId] = value;
    }
    return acc;
  }, {});
};

const filterSubjectCatalogByAssignments = (catalog, assignedSubjects = []) => {
  const normalizedCatalog = normalizeSubjectCatalog(catalog, { fallbackToDefault: false });
  const allowedTokens = new Set(
    (assignedSubjects || []).map((item) => normalizeSubjectMatchToken(item)).filter(Boolean)
  );

  if (allowedTokens.size === 0) {
    return normalizedCatalog;
  }

  const filtered = {
    junior: (normalizedCatalog?.junior || []).filter((subject) =>
      allowedTokens.has(normalizeSubjectMatchToken(subject))
    ),
    senior: (normalizedCatalog?.senior || []).filter((subject) =>
      allowedTokens.has(normalizeSubjectMatchToken(subject))
    ),
  };

  if (filtered.junior.length > 0 || filtered.senior.length > 0) {
    return filtered;
  }

  const fallbackSubjects = collapseSubjectAliasOptions(assignedSubjects);
  return {
    junior: [...fallbackSubjects],
    senior: [...fallbackSubjects],
  };
};

const buildTeacherScopedClassCatalog = async () => ({});

const buildTeacherScopedSubjectCatalog = async (_schoolId, assignedSubjects = []) => {
  const subjectValues = collapseSubjectAliasOptions(assignedSubjects);
  return normalizeSubjectCatalog(
    {
      junior: [...subjectValues],
      senior: [...subjectValues],
    },
    { fallbackToDefault: false }
  );
};

const getCurrentUserCacheToken = () =>
  String(auth?.currentUser?.uid || "anonymous")
    .trim()
    .toLowerCase() || "anonymous";

const isLtcDebugEnabled = () => {
  try {
    return localStorage.getItem("scoorla_ltc_debug") === "1";
  } catch {
    return false;
  }
};

const logLtcDebug = (...args) => {
  if (!isLtcDebugEnabled()) return;
  console.log("[LTC DEBUG]", ...args);
};

const isTeacherLtcTraceEnabled = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem("scoorla_teacher_ltc_debug") === "1";
  } catch {
    return false;
  }
};

const logTeacherLtcTrace = (label, payload) => {
  if (!isTeacherLtcTraceEnabled()) return;
  console.log("[TEACHER LTC]", label, payload);
};

async function loadCurrentUserAccessProfile({
  screen = "RecordDashboard",
  action = "load_user_access_scope",
} = {}) {
  const currentUid = String(auth?.currentUser?.uid || "").trim();
  if (!currentUid) {
    return {
      uid: "",
      schoolId: "",
      role: "",
      isActive: true,
      assignedClasses: [],
      assignedSubjects: [],
    };
  }

  const cachedScope = getCachedUserScope(currentUid);
  if (cachedScope) {
    return cachedScope;
  }

  const resolvedScope =
    (await ensureUserScope(currentUid, { screen, action })) || {
      uid: currentUid,
      schoolId: "",
      role: "",
      isActive: true,
      assignedClasses: [],
      assignedSubjects: [],
    }
  ;
  return resolvedScope;
}

async function validateScoreWriteAccess({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
}) {
  const currentUid = String(auth?.currentUser?.uid || "").trim();
  if (!currentUid) {
    throw new Error("User is not authenticated.");
  }

  const cachedScope = getCachedUserScopeForSchool(schoolId, currentUid);
  const userScope =
    cachedScope ||
    (await loadCurrentUserAccessProfile({
      screen: "RecordDashboard",
      action: "validate_writer_profile",
    }));
  if (!userScope?.uid) {
    throw new Error("User profile not found.");
  }
  const role = String(userScope?.role || "").toLowerCase();
  const userSchoolId = String(userScope?.schoolId || "").trim();
  if (!userSchoolId || userSchoolId !== String(schoolId || "").trim()) {
    throw new Error("User school does not match selected school.");
  }
  if (userScope?.isActive === false) {
    throw new Error("Teacher account is inactive.");
  }
  const canRecordRole = ["admin", "subject_teacher", "class_subject_teacher"].includes(role);
  if (!canRecordRole) {
    throw new Error(
      `Role "${role || "unknown"}" cannot record scores. Expected subject_teacher or class_subject_teacher.`
    );
  }
  const isAdminRole = role === "admin";
  if (!isAdminRole) {
    const assignedClasses = Array.isArray(userScope?.assignedClasses)
      ? userScope.assignedClasses.map((item) => String(item ?? "").trim())
      : [];
    const assignedSubjects = Array.isArray(userScope?.assignedSubjects)
      ? userScope.assignedSubjects.map((item) => String(item ?? "").trim())
      : [];
    const requiredClassToken = normalizeClassMatchToken(classId);
    const requiredSubjectToken = normalizeSubjectMatchToken(subjectId);
    const hasAssignedClass = assignedClasses.some(
      (item) => normalizeClassMatchToken(item) === requiredClassToken
    );
    const hasAssignedSubject = assignedSubjects.some(
      (item) => normalizeSubjectMatchToken(item) === requiredSubjectToken
    );
    if (!hasAssignedClass || !hasAssignedSubject) {
      const classList = assignedClasses.join(", ") || "(none)";
      const subjectList = assignedSubjects.join(", ") || "(none)";
      throw new Error(
        `Assignment mismatch. Required class="${classId}", subject="${subjectId}". Assigned classes=[${classList}], subjects=[${subjectList}].`
      );
    }
  }

  const sessionSnap = await instrumentFirestoreRead(
    getDoc(doc(firestore, "sessions", String(sessionId || ""))),
    {
      screen: "RecordDashboard",
      action: "validate_writer_session",
      target: `sessions/${String(sessionId || "").trim()}`,
    }
  );
  if (!sessionSnap.exists()) {
    throw new Error("Selected session does not exist.");
  }
  const sessionData = sessionSnap.data() || {};
  if (String(sessionData?.schoolId || "").trim() !== String(schoolId || "").trim()) {
    throw new Error("Selected session belongs to a different school.");
  }
  if (sessionData?.isArchived === true || sessionData?.isEditable === false) {
    throw new Error("Selected session is read-only. Switch to active editable session.");
  }

  const termRecord = await getTermDocumentForSession(schoolId, sessionId, termId || "term1");
  if (!termRecord?.id) {
    throw new Error("Selected term is not configured for this session.");
  }
  if (termRecord.isEditable !== true) {
    throw new Error("Selected term is read-only. Return to the current term to record scores.");
  }

  return termRecord;
}

async function resolveAuthorizedContextTokens(requestedClassId, requestedSubjectId) {
  const normalizedClass = normalizeClassId(requestedClassId);
  const normalizedSubject = normalizeSubjectId(requestedSubjectId);

  return {
    classId: normalizedClass,
    subjectId: normalizedSubject,
  };
}

const sanitizeDocIdToken = (value) =>
  encodeURIComponent(String(value || ""))
    .replace(/%/g, "_")
    .replace(/\./g, "_");

const buildScoreDocId = (enrollmentId, termId, subjectId) =>
  `${enrollmentId}__${normalizeTermAlias(termId)}__${sanitizeDocIdToken(subjectId)}`;

const CACHE_TTL = {
  schoolDataMs: 120_000,
  adminSettingsMs: 30_000,
  resultConfigMs: 30_000,
  classStudentsMs: 300_000,
  scoresMs: 180_000,
  recordRosterMs: 300_000,
  recordScoresMs: 180_000,
  subjectSnapshotMs: 120_000,
  lastTermMapMs: 300_000,
};

const buildClassStudentsCacheKey = ({
  schoolId,
  classId,
  sessionId,
  termId,
  includeInactive,
  includeDeleted,
}) =>
  `class_students::${schoolId}::${classId}::${sessionId}::${termId}::${includeInactive ? 1 : 0}::${
    includeDeleted ? 1 : 0
  }`;

const buildClassStudentsSessionCacheKey = ({
  schoolId,
  classId,
  sessionId,
  termId,
  includeInactive,
  includeDeleted,
}) =>
  `students_${schoolId}_${classId}_${sessionId}_${termId}_${includeInactive ? 1 : 0}_${
    includeDeleted ? 1 : 0
  }`;

const buildScoresCacheKey = ({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
}) =>
  `scores_ctx::${getCurrentUserCacheToken()}::${schoolId}::${classId}::${normalizeSubjectAliasToken(subjectId)}::${sessionId}::${normalizeTermAlias(termId)}`;

const buildLastTermMapCacheKey = ({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
}) =>
  `last_term_map::${getCurrentUserCacheToken()}::${schoolId}::${classId}::${normalizeSubjectAliasToken(subjectId)}::${sessionId}::${normalizeTermAlias(termId)}`;

const buildSubjectSnapshotCacheKey = ({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
}) =>
  `subject_snapshot::${getCurrentUserCacheToken()}::${schoolId}::${classId}::${subjectId}::${sessionId}::${normalizeTermAlias(termId)}`;

const buildClassScoresCacheKey = ({
  schoolId,
  classId,
  sessionId,
  termId,
  subjectIds = [],
}) =>
  `class_scores::${getCurrentUserCacheToken()}::${schoolId}::${classId}::${sessionId}::${normalizeTermAlias(termId)}::${buildSubjectScopeCacheSegment(subjectIds)}`;

const buildClassTotalsBySubjectCacheKey = ({
  schoolId,
  classId,
  sessionId,
  termId,
  subjectIds = [],
}) =>
  `class_subject_totals::${getCurrentUserCacheToken()}::${schoolId}::${classId}::${sessionId}::${normalizeTermAlias(termId)}::${buildSubjectScopeCacheSegment(subjectIds)}`;

const buildStoredLtcCacheKey = ({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
}) =>
  `ltc_cache::${getCurrentUserCacheToken()}::${schoolId}::${classId}::${normalizeSubjectAliasToken(subjectId)}::${sessionId}::${normalizeTermAlias(termId)}`;

const buildScopedScoreSessionCacheKey = ({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
}) =>
  `scores_${getCurrentUserCacheToken()}_${schoolId}_${classId}_${subjectId}_${sessionId}_${termId}`;

const RECORD_CACHE_ENVELOPE = "__recordCache";

const buildRecordRosterCacheKey = ({
  schoolId,
  classId,
  sessionId,
}) =>
  `record_roster_cache::${getCurrentUserCacheToken()}::${schoolId}::${classId}::${sessionId}`;

const buildRecordRosterSessionCacheKey = ({
  schoolId,
  classId,
  sessionId,
}) =>
  `record_roster_${getCurrentUserCacheToken()}_${schoolId}_${classId}_${sessionId}`;

const buildRecordScoreCacheKey = ({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
}) =>
  `record_score_cache::${getCurrentUserCacheToken()}::${schoolId}::${classId}::${normalizeSubjectAliasToken(subjectId)}::${sessionId}::${normalizeTermAlias(termId)}`;

const buildRecordScoreSessionCacheKey = ({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
}) =>
  `record_score_${getCurrentUserCacheToken()}_${schoolId}_${classId}_${normalizeSubjectAliasToken(subjectId)}_${sessionId}_${normalizeTermAlias(termId)}`;

const buildRecordRosterCacheDocId = (schoolId, classId, sessionId) =>
  [
    String(schoolId || "").trim(),
    normalizeClassId(classId),
    String(sessionId || "").trim(),
  ]
    .filter(Boolean)
    .join("__");

const buildRecordScoreCacheDocId = (schoolId, classId, subjectId, sessionId, termId) =>
  [
    String(schoolId || "").trim(),
    normalizeClassId(classId),
    sanitizeDocIdToken(normalizeSubjectAliasToken(subjectId)),
    String(sessionId || "").trim(),
    normalizeTermAlias(termId),
  ]
    .filter(Boolean)
    .join("__");

const sortRecordRosterRows = (rows = []) =>
  [...(Array.isArray(rows) ? rows : [])].sort((left, right) =>
    String(left?.name || "").localeCompare(String(right?.name || ""))
  );

const normalizeRecordRosterRows = (rows = []) =>
  sortRecordRosterRows(
    (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        id: String(row?.id || "").trim(),
        enrollmentId: row?.enrollmentId ? String(row.enrollmentId).trim() : null,
        name: String(row?.name || "").trim(),
        classId: normalizeClassId(row?.classId || ""),
        regNo: String(row?.regNo || row?.regNumber || "").trim(),
        regNumber: String(row?.regNumber || row?.regNo || "").trim(),
        gender: String(row?.gender || row?.sex || "").trim(),
        sex: String(row?.sex || row?.gender || "").trim(),
        phone: String(row?.phone || "").trim(),
        status: String(row?.status || "active").trim() || "active",
        isDeleted: !!row?.isDeleted,
        entryTermId: String(row?.entryTermId || "").trim(),
        entryTermOrder: Number(row?.entryTermOrder || 0) || 0,
      }))
      .filter((row) => row.id)
  );

const normalizeRecordScoreRow = (row = {}) => ({
  test1:
    row?.test1 === "" || row?.test1 === null || row?.test1 === undefined
      ? ""
      : Number(row?.test1),
  test2:
    row?.test2 === "" || row?.test2 === null || row?.test2 === undefined
      ? ""
      : Number(row?.test2),
  test3:
    row?.test3 === "" || row?.test3 === null || row?.test3 === undefined
      ? ""
      : Number(row?.test3),
  exam:
    row?.exam === "" || row?.exam === null || row?.exam === undefined
      ? ""
      : Number(row?.exam),
  score:
    row?.score === null || row?.score === undefined
      ? row?.total === null || row?.total === undefined
        ? null
        : Number(row?.total) || 0
      : Number(row?.score) || 0,
  ltcOverride: normalizeStoredLtcOverride(row?.ltcOverride),
  lastTermCumulativeCache:
    row?.lastTermCumulativeCache === null ||
    row?.lastTermCumulativeCache === undefined ||
    row?.lastTermCumulativeCache === ""
      ? null
      : Number(row?.lastTermCumulativeCache) || 0,
});

const normalizeRecordScoreMap = (scores = {}) =>
  Object.entries(scores && typeof scores === "object" ? scores : {}).reduce(
    (acc, [studentId, row]) => {
      const normalizedStudentId = String(studentId || "").trim();
      if (!normalizedStudentId) return acc;
      acc[normalizedStudentId] = normalizeRecordScoreRow(row || {});
      return acc;
    },
    {}
  );

const buildRecordScoreMapFromRows = (rows = [], studentIdByEnrollmentId = {}) => {
  const bestRowByStudent = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const enrollmentId = String(row?.enrollmentId || "").trim();
    const studentId = String(
      row?.studentId || studentIdByEnrollmentId?.[enrollmentId] || ""
    ).trim();
    if (!studentId) return;
    const currentBest = bestRowByStudent[studentId];
    if (!currentBest || toMillis(row?.updatedAt) >= toMillis(currentBest?.updatedAt)) {
      bestRowByStudent[studentId] = row;
    }
  });
  return Object.entries(bestRowByStudent).reduce((acc, [studentId, row]) => {
    acc[studentId] = normalizeRecordScoreRow(row || {});
    return acc;
  }, {});
};

const normalizeRecordCacheEnvelope = (payload, normalizer, fallbackValue) => {
  if (!payload) {
    return { hit: false, data: fallbackValue };
  }
  const parsedPayload =
    typeof payload === "string"
      ? (() => {
          try {
            return JSON.parse(payload);
          } catch {
            return null;
          }
        })()
      : payload;
  if (!parsedPayload || parsedPayload?.[RECORD_CACHE_ENVELOPE] !== true) {
    return { hit: false, data: fallbackValue };
  }
  return {
    hit: true,
    data: normalizer(parsedPayload?.data),
  };
};

const readResolvedRecordCache = ({ cacheKey, sessionKey, normalizer, fallbackValue }) => {
  const cachedValue = getCachedValue(cacheKey);
  const normalizedCachedValue = normalizeRecordCacheEnvelope(
    cachedValue,
    normalizer,
    fallbackValue
  );
  if (normalizedCachedValue.hit) {
    return normalizedCachedValue;
  }
  const sessionValue = getSessionState(sessionKey);
  const normalizedSessionValue = normalizeRecordCacheEnvelope(
    sessionValue,
    normalizer,
    fallbackValue
  );
  if (normalizedSessionValue.hit) {
    setCachedValue(
      cacheKey,
      {
        [RECORD_CACHE_ENVELOPE]: true,
        data: normalizedSessionValue.data,
      },
      Array.isArray(normalizedSessionValue.data)
        ? CACHE_TTL.recordRosterMs
        : CACHE_TTL.recordScoresMs
    );
    return normalizedSessionValue;
  }
  return { hit: false, data: fallbackValue };
};

const writeResolvedRecordCache = ({
  cacheKey,
  sessionKey,
  data,
  ttlMs,
}) => {
  const envelope = {
    [RECORD_CACHE_ENVELOPE]: true,
    data,
  };
  setCachedValue(cacheKey, envelope, ttlMs);
  setSessionState(sessionKey, JSON.stringify(envelope));
};

const invalidateStudentCachesForClass = ({ schoolId, classId, sessionId }) => {
  const base = `class_students::${schoolId}::${classId}::${sessionId}::`;
  invalidateCachePrefix(base);
  invalidateCachePrefix(
    `record_roster_cache::${getCurrentUserCacheToken()}::${schoolId}::${classId}::${sessionId}`
  );
  try {
    const sessionPrefix = `students_${schoolId}_${classId}`;
    const recordSessionPrefix = `record_roster_${getCurrentUserCacheToken()}_${schoolId}_${classId}_${sessionId}`;
    Object.keys(sessionStorage || {}).forEach((key) => {
      if (String(key || "").startsWith(sessionPrefix)) {
        sessionStorage.removeItem(key);
      }
      if (String(key || "").startsWith(recordSessionPrefix)) {
        sessionStorage.removeItem(key);
      }
    });
  } catch {
    // Ignore session cache cleanup failures.
  }
};

const invalidateScoreCachesForContext = ({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
}) => {
  const userToken = getCurrentUserCacheToken();
  const normalizedTermId = normalizeTermAlias(termId);
  const normalizedSubjectToken = normalizeSubjectAliasToken(subjectId);
  const scorePrefix = `scores_ctx::${userToken}::${schoolId}::${classId}::${normalizedSubjectToken}::${sessionId}::${normalizedTermId}`;
  const snapshotPrefix = `subject_snapshot::${userToken}::${schoolId}::${classId}::${subjectId}::${sessionId}::${normalizedTermId}`;
  const ltcPrefix = `last_term_map::${userToken}::${schoolId}::${classId}::${normalizedSubjectToken}::${sessionId}::`;
  invalidateCachePrefix(scorePrefix);
  invalidateCachePrefix(snapshotPrefix);
  invalidateCachePrefix(ltcPrefix);
  invalidateCachePrefix(
    `class_scores::${userToken}::${schoolId}::${classId}::${sessionId}::${normalizedTermId}`
  );
  invalidateCachePrefix(
    `class_subject_totals::${userToken}::${schoolId}::${classId}::${sessionId}::`
  );
  invalidateCachePrefix(
    `ltc_cache::${userToken}::${schoolId}::${classId}::${normalizedSubjectToken}::${sessionId}::${normalizedTermId}`
  );
  invalidateCachePrefix(
    `record_score_cache::${userToken}::${schoolId}::${classId}::${normalizedSubjectToken}::${sessionId}::${normalizedTermId}`
  );
  try {
    const recordScoreSessionPrefix = `record_score_${userToken}_${schoolId}_${classId}_${normalizedSubjectToken}_${sessionId}_${normalizedTermId}`;
    Object.keys(sessionStorage || {}).forEach((key) => {
      if (String(key || "").startsWith(recordScoreSessionPrefix)) {
        sessionStorage.removeItem(key);
      }
    });
  } catch {
    // Ignore session cache cleanup failures.
  }
};

const chunkArray = (items, size = 350) => {
  const chunkSize = Math.max(1, Number(size) || 1);
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const normalizeSubjectScopeTokens = (subjectIds = []) =>
  [...new Set(
    (Array.isArray(subjectIds) ? subjectIds : [subjectIds])
      .map((item) => normalizeSubjectAliasToken(item))
      .filter(Boolean)
  )].sort();

const buildSubjectScopeCacheSegment = (subjectIds = []) => {
  const normalizedTokens = normalizeSubjectScopeTokens(subjectIds);
  return normalizedTokens.length > 0 ? normalizedTokens.join("|") : "all";
};

const isTeacherScopedRole = (role) =>
  ["class_teacher", "subject_teacher", "class_subject_teacher", "teacher"].includes(
    String(role || "").trim().toLowerCase()
  );

const filterSubjectsForCurrentUserScope = async ({
  subjects = [],
  screen = "StudentResult",
}) => {
  const normalizedSubjects = uniqueSubjectNames(subjects || []);
  if (normalizedSubjects.length === 0) {
    return [];
  }

  try {
    const userScope = await loadCurrentUserAccessProfile({
      screen,
      action: "result_subject_scope",
    });
    if (!isTeacherScopedRole(userScope?.role)) {
      return normalizedSubjects;
    }

    const allowedSubjectTokens = new Set(
      (userScope?.assignedSubjects || [])
        .map((item) => normalizeSubjectMatchToken(item))
        .filter(Boolean)
    );
    if (allowedSubjectTokens.size === 0) {
      return normalizedSubjects;
    }

    const filteredSubjects = normalizedSubjects.filter((subject) =>
      allowedSubjectTokens.has(normalizeSubjectMatchToken(subject))
    );
    return filteredSubjects.length > 0 ? filteredSubjects : [];
  } catch {
    return normalizedSubjects;
  }
};

const commitBatchedSetOperations = async (operations = [], context = {}) => {
  if (!Array.isArray(operations) || operations.length === 0) return;
  const chunks = chunkArray(operations, 350);
  for (const batchOps of chunks) {
    const batch = writeBatch(firestore);
    batchOps.forEach((operation) => {
      batch.set(operation.ref, operation.data, operation.options || {});
    });
    await instrumentFirestoreWrite(batch.commit(), {
      screen: context?.screen || "RecordDashboard",
      action: context?.action || "batch_set",
      target: context?.target || "scores",
      count: batchOps.length,
    });
  }
};

const fetchScoresByPreferredDocIds = async ({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
  scoreDocIds = [],
}) => {
  const normalizedIds = [...new Set(
    (scoreDocIds || []).map((item) => String(item || "").trim()).filter(Boolean)
  )];
  if (normalizedIds.length === 0) {
    return [];
  }

  const requestedSubjectToken = normalizeSubjectAliasToken(subjectId);
  const rows = [];
  for (const docIdChunk of chunkArray(normalizedIds, 30)) {
    try {
      const exactConstraints = [
        collection(firestore, "scores"),
      ];
      const exactSnap = await instrumentFirestoreRead(
        getDocs(
          query(
            ...exactConstraints,
            where("schoolId", "==", schoolId),
            where("sessionId", "==", String(sessionId || "").trim()),
            where("termId", "==", normalizeTermAlias(termId)),
            where("classId", "==", String(classId || "").trim()),
            ...(requestedSubjectToken
              ? [where("subjectToken", "==", requestedSubjectToken)]
              : []),
            where(documentId(), "in", docIdChunk)
          )
        ),
        {
          screen: "RecordDashboard",
          action: "scores_query_exact_doc_ids",
          target: `scores:${classId}:${subjectId}:${sessionId}:${normalizeTermAlias(termId)}`,
        }
      );

      exactSnap.docs.forEach((item) => {
        const data = item.data() || {};
        const rowSubjectToken = normalizeSubjectAliasToken(
          data?.subjectToken || data?.subjectId || data?.subject || ""
        );
        if (rowSubjectToken !== requestedSubjectToken) {
          return;
        }
        rows.push({ id: item.id, ...data });
      });
    } catch (error) {
      const code = String(error?.code || "");
      if (code.includes("permission-denied") || code.includes("failed-precondition")) {
        return [];
      }
      throw error;
    }
  }

  return rows;
};

const mapStudentRecord = (
  studentId,
  record,
  enrollmentId,
  fallbackClassId,
  enrollmentData = null
) => ({
  id: studentId,
  enrollmentId: enrollmentId || null,
  name: record?.name || "",
  classId: fallbackClassId || record?.classId || "",
  regNo: record?.regNo || "",
  regNumber: record?.regNo || "",
  gender: record?.gender || record?.sex || "",
  sex: record?.sex || record?.gender || "",
  phone: record?.phone || "",
  status: record?.status || (record?.isDeleted ? "archived" : "active"),
  isDeleted: !!record?.isDeleted,
  entryTermId: enrollmentData?.entryTermId || enrollmentData?.createdTermId || "",
  entryTermOrder:
    Number(enrollmentData?.entryTermOrder ?? enrollmentData?.createdTermOrder) || 0,
});

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

async function fetchScoresForContext({
  schoolId,
  classId,
  sessionId,
  termId,
  subjectId,
  allowLegacyFallback = true,
  allowBroadLegacyFallback = allowLegacyFallback,
}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedTermId = normalizeTermAlias(termId);
  if (!normalizedSessionId || !normalizedTermId) {
    return [];
  }
  const cacheKey = buildScoresCacheKey({
    schoolId,
    classId,
    subjectId,
    sessionId: normalizedSessionId,
    termId: normalizedTermId,
  });
  const cachedRows = getCachedValue(cacheKey);
  if (Array.isArray(cachedRows) && cachedRows.length > 0) {
    return cachedRows;
  }

  const subjectCandidates = getSubjectQueryCandidates(subjectId, {
    schoolId,
    classId,
  });
  const requestedSubjectToken = normalizeSubjectAliasToken(subjectId);
  const rowsById = new Map();
  logLtcDebug("fetchScoresForContext:start", {
    user: getCurrentUserCacheToken(),
    schoolId,
    classId,
    sessionId: normalizedSessionId,
    termId: normalizedTermId,
    subjectId,
    subjectCandidates,
  });

  if (requestedSubjectToken) {
    try {
      const tokenSnap = await instrumentFirestoreRead(
        getDocs(
          query(
            collection(firestore, "scores"),
            where("schoolId", "==", schoolId),
            where("sessionId", "==", normalizedSessionId),
            where("termId", "==", normalizedTermId),
            where("classId", "==", classId),
            where("subjectToken", "==", requestedSubjectToken)
          )
        ),
        {
          screen: "Record/Result Preview",
          action: "scores_query_context_token",
          target: `scores:${classId}:${requestedSubjectToken}:${normalizedTermId}`,
        }
      );
      tokenSnap.docs.forEach((item) => {
        rowsById.set(item.id, { id: item.id, ...item.data() });
      });
    } catch (error) {
      const code = String(error?.code || "");
      if (!code.includes("permission-denied") && !code.includes("failed-precondition")) {
        throw error;
      }
    }
  }

  for (const candidate of subjectCandidates) {
    try {
      const scoreSnap = await instrumentFirestoreRead(
        getDocs(
          query(
            collection(firestore, "scores"),
            where("schoolId", "==", schoolId),
            where("sessionId", "==", normalizedSessionId),
            where("termId", "==", normalizedTermId),
            where("classId", "==", classId),
            where("subjectId", "==", candidate)
          )
        ),
        {
          screen: "Record/Result Preview",
          action: "scores_query_context",
          target: `scores:${classId}:${candidate}:${normalizedTermId}`,
        }
      );
      logLtcDebug("fetchScoresForContext:canonical_query", {
        candidate,
        count: scoreSnap.docs.length,
      });
      scoreSnap.docs.forEach((item) => {
        rowsById.set(item.id, { id: item.id, ...item.data() });
      });
      if (rowsById.size > 0) {
        break;
      }
    } catch (error) {
      const code = String(error?.code || "");
      logLtcDebug("fetchScoresForContext:canonical_query_error", {
        candidate,
        code,
        message: error?.message || String(error || ""),
      });
      if (!code.includes("permission-denied")) {
        throw error;
      }
    }
  }

  // Legacy fallback: older score docs may have missed schoolId and/or used
  // `subject` / `class` field names. Only pay this cost when the canonical
  // scoped query returned nothing.
  if (allowLegacyFallback && rowsById.size === 0) {
    const legacyQueryPlans = [
      { classField: "classId", subjectField: "subjectId" },
      { classField: "classId", subjectField: "subject" },
      { classField: "class", subjectField: "subjectId" },
      { classField: "class", subjectField: "subject" },
    ];
    const classCandidates = getClassQueryCandidates(classId);

    for (const candidate of subjectCandidates) {
      for (const plan of legacyQueryPlans) {
        for (const classCandidate of classCandidates) {
          try {
            const legacySnap = await instrumentFirestoreRead(
              getDocs(
                query(
                  collection(firestore, "scores"),
                  where("sessionId", "==", normalizedSessionId),
                  where("termId", "==", normalizedTermId),
                  where(plan.classField, "==", classCandidate),
                  where(plan.subjectField, "==", candidate)
                )
              ),
              {
                screen: "Record/Result Preview",
                action: "scores_query_context_legacy",
                target: `scores:${classCandidate}:${candidate}:${normalizedTermId}:${plan.classField}:${plan.subjectField}`,
              }
            );
            logLtcDebug("fetchScoresForContext:legacy_query", {
              candidate,
              classCandidate,
              classField: plan.classField,
              subjectField: plan.subjectField,
              count: legacySnap.docs.length,
            });
            legacySnap.docs.forEach((item) => {
              rowsById.set(item.id, { id: item.id, ...item.data() });
            });
            if (rowsById.size > 0) {
              break;
            }
          } catch (error) {
            const code = String(error?.code || "");
            logLtcDebug("fetchScoresForContext:legacy_query_error", {
              candidate,
              classCandidate,
              classField: plan.classField,
              subjectField: plan.subjectField,
              code,
              message: error?.message || String(error || ""),
            });
            if (!code.includes("permission-denied")) {
              throw error;
            }
          }
        }
        if (rowsById.size > 0) {
          break;
        }
      }
      if (rowsById.size > 0) {
        break;
      }
    }
  }

  if (allowBroadLegacyFallback && rowsById.size === 0) {
    const broadPlans = [
      { classField: "classId", subjectField: "subjectId" },
      { classField: "classId", subjectField: "subject" },
      { classField: "class", subjectField: "subjectId" },
      { classField: "class", subjectField: "subject" },
    ];
    const classCandidates = getClassQueryCandidates(classId);
    const sessionCandidates = await getSessionQueryCandidates(normalizedSessionId);
    const normalizedSessionTokens = new Set(
      sessionCandidates.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
    );
    const termCandidates = getTermQueryCandidates(normalizedTermId);
    const normalizedTermTokens = new Set(
      termCandidates
        .map(
          (item) =>
            normalizeLegacyTermMatchToken(item) || String(item || "").trim().toLowerCase()
        )
        .filter(Boolean)
    );

    for (const candidate of subjectCandidates) {
      for (const plan of broadPlans) {
        for (const classCandidate of classCandidates) {
          try {
            const legacySnap = await instrumentFirestoreRead(
              getDocs(
                query(
                  collection(firestore, "scores"),
                  where("schoolId", "==", schoolId),
                  where(plan.classField, "==", classCandidate),
                  where(plan.subjectField, "==", candidate)
                )
              ),
              {
                screen: "Record/Result Preview",
                action: "scores_query_context_broad_legacy",
                target: `scores:${classCandidate}:${candidate}:${plan.classField}:${plan.subjectField}`,
              }
            );
            logLtcDebug("fetchScoresForContext:broad_query", {
              candidate,
              classCandidate,
              classField: plan.classField,
              subjectField: plan.subjectField,
              rawCount: legacySnap.docs.length,
            });
            legacySnap.docs.forEach((item) => {
              const data = item.data() || {};
              const rawSession =
                String(data?.sessionId || data?.session || "").trim().toLowerCase();
              const rawTermToken =
                normalizeLegacyTermMatchToken(data?.termId || data?.term) ||
                String(data?.termId || data?.term || "").trim().toLowerCase();
              if (
                normalizedSessionTokens.has(rawSession) &&
                (normalizedTermTokens.has(rawTermToken) || !rawTermToken)
              ) {
                rowsById.set(item.id, { id: item.id, ...data });
              }
            });
            if (rowsById.size > 0) {
              break;
            }
          } catch (error) {
            const code = String(error?.code || "");
            logLtcDebug("fetchScoresForContext:broad_query_error", {
              candidate,
              classCandidate,
              classField: plan.classField,
              subjectField: plan.subjectField,
              code,
              message: error?.message || String(error || ""),
            });
            if (!code.includes("permission-denied")) {
              throw error;
            }
          }
        }
        if (rowsById.size > 0) {
          break;
        }
      }
      if (rowsById.size > 0) {
        break;
      }
    }
  }

  const rows = [...rowsById.values()];
  logLtcDebug("fetchScoresForContext:resolved_rows", {
    count: rows.length,
    sample: rows.slice(0, 5).map((row) => ({
      id: row?.id,
      schoolId: row?.schoolId || "",
      sessionId: row?.sessionId || row?.session || "",
      termId: row?.termId || row?.term || "",
      classId: row?.classId || row?.class || "",
      subjectId: row?.subjectId || row?.subject || "",
      studentId: row?.studentId || "",
      enrollmentId: row?.enrollmentId || "",
      score: row?.score ?? row?.total ?? "",
    })),
  });
  if (rows.length > 0) {
    setCachedValue(cacheKey, rows, CACHE_TTL.scoresMs);
  }
  return rows;
}

async function fetchScoresForClassTerm({
  schoolId,
  classId,
  sessionId,
  termId,
  subjectIds = [],
  options = {},
}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedTermId = normalizeTermAlias(termId);
  const normalizedSubjectTokens = normalizeSubjectScopeTokens(subjectIds);
  if (!normalizedSessionId || !normalizedTermId) {
    return [];
  }

  const cacheKey = buildClassScoresCacheKey({
    schoolId,
    classId,
    sessionId: normalizedSessionId,
    termId: normalizedTermId,
    subjectIds: normalizedSubjectTokens,
  });
  const cachedRows = getCachedValue(cacheKey);
  if (Array.isArray(cachedRows) && cachedRows.length > 0) {
    return cachedRows;
  }

  const rows = [];
  if (normalizedSubjectTokens.length > 0) {
    for (const subjectTokenChunk of chunkArray(normalizedSubjectTokens, 10)) {
      const subjectConstraint =
        subjectTokenChunk.length === 1
          ? where("subjectToken", "==", subjectTokenChunk[0])
          : where("subjectToken", "in", subjectTokenChunk);
      const scoreSnap = await instrumentFirestoreRead(
        getDocs(
          query(
            collection(firestore, "scores"),
            where("schoolId", "==", schoolId),
            where("sessionId", "==", normalizedSessionId),
            where("termId", "==", normalizedTermId),
            where("classId", "==", classId),
            subjectConstraint
          )
        ),
        {
          screen: options?.screen || "StudentResult",
          action: options?.action || "class_term_scores_query",
          target: `scores:${classId}:${normalizedTermId}:${buildSubjectScopeCacheSegment(
            subjectTokenChunk
          )}`,
        }
      );
      scoreSnap.docs.forEach((item) => {
        rows.push({ id: item.id, ...item.data() });
      });
    }
  } else {
    const scoreSnap = await instrumentFirestoreRead(
      getDocs(
        query(
          collection(firestore, "scores"),
          where("schoolId", "==", schoolId),
          where("sessionId", "==", normalizedSessionId),
          where("termId", "==", normalizedTermId),
          where("classId", "==", classId)
        )
      ),
      {
        screen: options?.screen || "StudentResult",
        action: options?.action || "class_term_scores_query",
        target: `scores:${classId}:${normalizedTermId}`,
      }
    );
    scoreSnap.docs.forEach((item) => {
      rows.push({ id: item.id, ...item.data() });
    });
  }

  const dedupedRows = [...new Map(rows.map((row) => [String(row?.id || ""), row])).values()];
  const unresolvedEnrollmentIds = dedupedRows.reduce((acc, row) => {
    const studentId = String(row?.studentId || "").trim();
    const enrollmentId = String(row?.enrollmentId || "").trim();
    if (!studentId && enrollmentId) {
      acc.push(enrollmentId);
    }
    return acc;
  }, []);

  let hydratedRows = dedupedRows;
  if (unresolvedEnrollmentIds.length > 0) {
    const classStudents = await getClassStudents(schoolId, classId, {
      sessionId: normalizedSessionId,
      termId: normalizedTermId,
      includeInactive: true,
      includeDeleted: true,
    });
    const studentIdByEnrollmentId = (classStudents || []).reduce((acc, student) => {
      const enrollmentId = String(student?.enrollmentId || "").trim();
      const studentId = String(student?.id || "").trim();
      if (enrollmentId && studentId) {
        acc[enrollmentId] = studentId;
      }
      return acc;
    }, {});
    hydratedRows = rows.map((row) => {
      const studentId = String(row?.studentId || "").trim();
      if (studentId) {
        return row;
      }
      const enrollmentId = String(row?.enrollmentId || "").trim();
      return {
        ...row,
        studentId: studentIdByEnrollmentId[enrollmentId] || "",
      };
    });
  }

  if (hydratedRows.length > 0) {
    setCachedValue(cacheKey, hydratedRows, CACHE_TTL.scoresMs);
  }
  return hydratedRows;
}

export async function getStoredLastTermCumulativeMap({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
  bypassLocalCache = false,
}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedTermId = normalizeTermAlias(termId);
  if (
    !schoolId ||
    !classId ||
    !subjectId ||
    !normalizedSessionId ||
    !shouldUseLastTermCumulative(normalizedTermId)
  ) {
    return {};
  }

  const cacheKey = buildStoredLtcCacheKey({
    schoolId,
    classId,
    subjectId,
    sessionId: normalizedSessionId,
    termId: normalizedTermId,
  });
  if (!bypassLocalCache) {
    const cachedMap = getCachedValue(cacheKey);
    if (
      cachedMap &&
      typeof cachedMap === "object" &&
      Object.keys(cachedMap).length > 0
    ) {
      return cachedMap;
    }
    const cachedSessionMap = getSessionState(cacheKey);
    if (cachedSessionMap) {
      try {
        const parsed =
          typeof cachedSessionMap === "string" ? JSON.parse(cachedSessionMap) : cachedSessionMap;
        if (
          parsed &&
          typeof parsed === "object" &&
          Object.keys(parsed).length > 0
        ) {
          const normalizedCachedMap = normalizeLtcCacheMap(parsed);
          setCachedValue(cacheKey, normalizedCachedMap, CACHE_TTL.lastTermMapMs);
          return normalizedCachedMap;
        }
      } catch {
        // Ignore malformed cached LTC payload and fall through to Firestore.
      }
    }
  }

  const cacheDocIds = buildStoredLtcDocIdCandidates(
    schoolId,
    classId,
    subjectId,
    normalizedSessionId,
    normalizedTermId
  );
  let sawPermissionDenied = false;
  try {
    for (const cacheDocId of cacheDocIds) {
      try {
        const cacheSnap = await instrumentFirestoreRead(
          getDoc(doc(firestore, "scoreLtcCaches", cacheDocId)),
          {
            screen: "RecordDashboard",
            action: "ltc_cache_read",
            target: `scoreLtcCaches/${cacheDocId}`,
          }
        );
        if (!cacheSnap.exists()) {
          continue;
        }
        const normalizedMap = normalizeLtcCacheMap(cacheSnap.data()?.values || {});
        logTeacherLtcTrace("stored_cache_read", {
          schoolId,
          classId,
          subjectId,
          sessionId: normalizedSessionId,
          termId: normalizedTermId,
          cacheDocId,
          studentIds: Object.keys(normalizedMap),
          sample: Object.entries(normalizedMap).slice(0, 5),
        });
        setSessionState(cacheKey, normalizedMap);
        setCachedValue(cacheKey, normalizedMap, CACHE_TTL.lastTermMapMs);
        return normalizedMap;
      } catch (error) {
        const code = String(error?.code || "");
        if (code.includes("permission-denied")) {
          sawPermissionDenied = true;
          continue;
        }
        throw error;
      }
    }

    logTeacherLtcTrace("stored_cache_missing", {
      schoolId,
      classId,
      subjectId,
      sessionId: normalizedSessionId,
      termId: normalizedTermId,
      cacheDocIds,
      sawPermissionDenied,
    });
    return {};
  } catch (error) {
    console.warn("LTC cache read failed:", error?.message || error);
    return {};
  }
}

export async function syncStoredLastTermCumulativeMap({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
  values,
  existingValues = null,
  bypassBaselineLocalCache = false,
}) {
  try {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedTermId = normalizeTermAlias(termId);
    if (
      !schoolId ||
      !classId ||
      !subjectId ||
      !normalizedSessionId ||
      !shouldUseLastTermCumulative(normalizedTermId)
    ) {
      return false;
    }

    const normalizedValues = normalizeLtcCacheMap(values);
    if (Object.keys(normalizedValues).length === 0) {
      return false;
    }

    const cacheDocId = buildStoredLtcDocId(
      schoolId,
      classId,
      subjectId,
      normalizedSessionId,
      normalizedTermId
    );
    const cacheKey = buildStoredLtcCacheKey({
      schoolId,
      classId,
      subjectId,
      sessionId: normalizedSessionId,
      termId: normalizedTermId,
    });
    const baselineValues =
      existingValues && typeof existingValues === "object"
        ? normalizeLtcCacheMap(existingValues)
        : await getStoredLastTermCumulativeMap({
            schoolId,
            classId,
            subjectId,
            sessionId: normalizedSessionId,
            termId: normalizedTermId,
            bypassLocalCache: bypassBaselineLocalCache,
          });
    const hasDelta =
      Object.keys(normalizedValues).length !== Object.keys(baselineValues || {}).length ||
      Object.entries(normalizedValues).some(
        ([studentId, value]) => Number(baselineValues?.[studentId] ?? NaN) !== Number(value)
      );
    if (!hasDelta) {
      return false;
    }

    await instrumentFirestoreWrite(
      setDoc(
        doc(firestore, "scoreLtcCaches", cacheDocId),
        {
          schoolId,
          classId: normalizeClassId(classId),
          classToken: normalizeClassId(classId),
          subjectId: normalizeSubjectId(subjectId),
          subjectToken: normalizeSubjectAliasToken(subjectId),
          sessionId: normalizedSessionId,
          termId: normalizedTermId,
          values: normalizedValues,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
      {
        screen: "RecordDashboard",
        action: "ltc_cache_write",
        target: `scoreLtcCaches/${cacheDocId}`,
        count: Object.keys(normalizedValues).length,
      }
    );

    setCachedValue(cacheKey, normalizedValues, CACHE_TTL.lastTermMapMs);
    setSessionState(cacheKey, normalizedValues);
    return true;
  } catch (error) {
    console.warn("LTC cache write skipped:", error?.message || error);
    return false;
  }
}

export async function syncCurrentScoreRowsLastTermCumulativeCache({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
  students = [],
  values = {},
}) {
  try {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedTermId = normalizeTermAlias(termId);
    if (
      !schoolId ||
      !classId ||
      !subjectId ||
      !normalizedSessionId ||
      !shouldUseLastTermCumulative(normalizedTermId)
    ) {
      return false;
    }

    const normalizedValues = normalizeLtcCacheMap(values);
    if (Object.keys(normalizedValues).length === 0) {
      return false;
    }

    const subjectCandidates = [
      normalizeSubjectId(subjectId),
      ...getSubjectQueryCandidates(subjectId, { schoolId, classId }),
    ].filter(Boolean);

    const preferredScoreDocIds = [...new Set(
      (students || []).flatMap((student) => {
        const enrollmentId = String(student?.enrollmentId || "").trim();
        if (!enrollmentId) return [];
        return [...new Set(subjectCandidates)]
          .map((candidate) => buildScoreDocId(enrollmentId, normalizedTermId, candidate))
          .filter(Boolean);
      })
    )];
    if (preferredScoreDocIds.length === 0) {
      return false;
    }

    const existingRows = await fetchScoresByPreferredDocIds({
      schoolId,
      classId,
      subjectId,
      sessionId: normalizedSessionId,
      termId: normalizedTermId,
      scoreDocIds: preferredScoreDocIds,
    });
    if (!existingRows.length) {
      return false;
    }

    const bestRowByStudentId = existingRows.reduce((acc, row) => {
      const studentId = String(row?.studentId || "").trim();
      if (!studentId) return acc;
      const currentBest = acc[studentId];
      if (!currentBest || toMillis(row?.updatedAt) >= toMillis(currentBest?.updatedAt)) {
        acc[studentId] = row;
      }
      return acc;
    }, {});

    const operations = Object.entries(normalizedValues).reduce((acc, [studentId, value]) => {
      const row = bestRowByStudentId[String(studentId || "").trim()];
      if (!row?.id) return acc;
      if (Number(row?.lastTermCumulativeCache ?? NaN) === Number(value)) {
        return acc;
      }
      acc.push({
        ref: doc(firestore, "scores", row.id),
        data: {
          lastTermCumulativeCache: roundScore(Number(value) || 0),
          updatedAt: serverTimestamp(),
        },
        options: { merge: true },
      });
      return acc;
    }, []);

    if (operations.length === 0) {
      return false;
    }

    await commitBatchedSetOperations(operations, {
      screen: "RecordDashboard",
      action: "score_ltc_cache_sync",
      target: `scores:${classId}:${subjectId}:${normalizedSessionId}:${normalizedTermId}`,
    });
    invalidateScoreCachesForContext({
      schoolId,
      classId,
      subjectId,
      sessionId: normalizedSessionId,
      termId: normalizedTermId,
    });
    return true;
  } catch (error) {
    console.warn("Current score LTC sync skipped:", error?.message || error);
    return false;
  }
}

const groupBestScoreRowsBySubjectAndStudent = (rows = []) => {
  const grouped = {};
  (rows || []).forEach((row) => {
    const subjectId = normalizeSubjectMatchToken(row?.subjectId || row?.subject);
    const studentId = String(row?.studentId || "").trim();
    if (!subjectId || !studentId) return;
    if (!grouped[subjectId]) {
      grouped[subjectId] = {};
    }
    const currentBest = grouped[subjectId][studentId];
    if (!currentBest || toMillis(row?.updatedAt) >= toMillis(currentBest?.updatedAt)) {
      grouped[subjectId][studentId] = row;
    }
  });
  return grouped;
};

async function getClassSubjectTotalsByTerm(
  schoolId,
  classId,
  termId,
  sessionId,
  resultConfig,
  memo = new Map(),
  options = {}
) {
  const resolvedSessionId = String(sessionId || "").trim();
  const normalizedTermId = normalizeTermAlias(termId);
  const normalizedSubjectTokens = normalizeSubjectScopeTokens(options?.subjectIds || []);
  const cacheKey = buildClassTotalsBySubjectCacheKey({
    schoolId,
    classId,
    sessionId: resolvedSessionId,
    termId: normalizedTermId,
    subjectIds: normalizedSubjectTokens,
  });

  if (memo.has(cacheKey)) {
    return memo.get(cacheKey);
  }

  const cachedTotals = getCachedValue(cacheKey);
  if (cachedTotals) {
    memo.set(cacheKey, cachedTotals);
    return cachedTotals;
  }

  const currentRows = await fetchScoresForClassTerm({
    schoolId,
    classId,
    sessionId: resolvedSessionId,
    termId: normalizedTermId,
    subjectIds: normalizedSubjectTokens,
  });
  const grouped = groupBestScoreRowsBySubjectAndStudent(currentRows);

  let previousTotalsBySubject = {};
  const previousTermAlias = getPreviousTermAlias(normalizedTermId);
  if (previousTermAlias) {
    previousTotalsBySubject = await getClassSubjectTotalsByTerm(
      schoolId,
      classId,
      previousTermAlias,
      resolvedSessionId,
      resultConfig,
      memo,
      { subjectIds: normalizedSubjectTokens }
    );
  }

  const totalsBySubject = {};
  Object.entries(grouped).forEach(([subjectId, rowsByStudent]) => {
    totalsBySubject[subjectId] = {};
    Object.entries(rowsByStudent || {}).forEach(([studentId, scoreRow]) => {
      const breakdown = buildScoreBreakdown({
        termId: normalizedTermId,
        scoreRow,
        computedLtc: Number(previousTotalsBySubject?.[subjectId]?.[studentId] || 0),
        resultConfig,
      });
      totalsBySubject[subjectId][studentId] = roundScore(Number(breakdown?.total) || 0);
    });
  });

  memo.set(cacheKey, totalsBySubject);
  setCachedValue(cacheKey, totalsBySubject, CACHE_TTL.lastTermMapMs);
  return totalsBySubject;
}

const buildSubjectScoreSnapshotFromRows = ({
  termId,
  rowsByStudent = {},
  previousTotalsByStudent = {},
  resultConfig = getDefaultResultConfig(),
}) => {
  const normalizedTermId = normalizeTermAlias(termId);
  const scoreMap = {};
  const snapshotRowsByStudent = {};
  const rankedRows = [];

  Object.entries(rowsByStudent || {}).forEach(([studentId, scoreRow]) => {
    const storedScoreRow = {
      test1: scoreRow?.test1 ?? "",
      test2: scoreRow?.test2 ?? "",
      test3: scoreRow?.test3 ?? "",
      exam: scoreRow?.exam ?? "",
      ltcOverride: scoreRow?.ltcOverride ?? "",
      lastTermCumulativeCache: scoreRow?.lastTermCumulativeCache ?? null,
    };
    const breakdown = buildScoreBreakdown({
      termId: normalizedTermId,
      scoreRow: storedScoreRow,
      computedLtc: Number(previousTotalsByStudent?.[studentId] || 0),
      resultConfig,
    });
    const total = roundScore(Number(breakdown?.total) || 0);

    scoreMap[String(studentId)] = storedScoreRow;
    snapshotRowsByStudent[String(studentId)] = {
      scoreRow: storedScoreRow,
      breakdown,
      total,
      lastTermCumulative: shouldUseLastTermCumulative(normalizedTermId)
        ? roundScore(Number(breakdown?.lastTermCumulative) || 0)
        : null,
    };
    rankedRows.push({
      id: String(studentId),
      total,
    });
  });

  const classAverage =
    rankedRows.length > 0
      ? roundScore(rankedRows.reduce((sum, row) => sum + row.total, 0) / rankedRows.length)
      : 0;
  const highestScore =
    rankedRows.length > 0
      ? rankedRows.reduce((highest, row) => Math.max(highest, row.total), 0)
      : 0;
  const lowestScore =
    rankedRows.length > 0
      ? rankedRows.reduce((lowest, row) => Math.min(lowest, row.total), rankedRows[0].total)
      : 0;

  rankedRows.sort((a, b) => b.total - a.total);
  const positionByStudent = {};
  let previousTotal = null;
  let currentRank = 0;
  rankedRows.forEach((entry, index) => {
    if (previousTotal === null || entry.total < previousTotal) {
      currentRank = index + 1;
    }
    positionByStudent[entry.id] = currentRank;
    previousTotal = entry.total;
  });

  return {
    scoreMap,
    rowsByStudent: snapshotRowsByStudent,
    classAverage,
    highestScore,
    lowestScore,
    positionByStudent,
    resultConfig,
  };
};

const buildEmptyScoreRow = () => ({
  test1: 0,
  test2: 0,
  test3: 0,
  exam: 0,
  ltcOverride: "",
  lastTermCumulativeCache: null,
});

export async function getClassSubjectResultRows({
  schoolId,
  classId,
  subjectId,
  termId,
  sessionId,
  adminSettings = null,
  classStudents = null,
  previewOverrides = null,
  includeInactive = false,
  includeDeleted = false,
  screen = "ResultPreview",
}) {
  try {
    const normalizedSubjectId = normalizeSubjectId(subjectId);
    if (!schoolId || !classId || !normalizedSubjectId) {
      return [];
    }

    const resolvedSessionId = await resolveSession(
      sessionId || getCurrentSessionId(),
      schoolId
    );
    if (!resolvedSessionId) {
      return [];
    }

    const resolvedTermId = await resolveTerm(termId || "term1", schoolId);
    const normalizedTermId = normalizeTermAlias(resolvedTermId);
    const resultConfig = normalizeResultConfig(
      adminSettings?.resultConfig || (await getResultConfig(schoolId))
    );
    const gradingScale = getConfiguredGradingScale(
      adminSettings?.gradingScale,
      resultConfig
    );
    const resolvedStudents = Array.isArray(classStudents)
      ? classStudents
      : await getClassStudents(schoolId, classId, {
          sessionId: resolvedSessionId,
          termId: normalizedTermId,
          includeInactive,
          includeDeleted,
        });

    const currentRows = await fetchScoresForClassTerm({
      schoolId,
      classId,
      sessionId: resolvedSessionId,
      termId: normalizedTermId,
      subjectIds: [normalizedSubjectId],
      options: {
        screen,
        action: "class_subject_preview_scores_query",
      },
    });
    const groupedRowsBySubject = groupBestScoreRowsBySubjectAndStudent(currentRows);
    const subjectToken = normalizeSubjectMatchToken(normalizedSubjectId);
    const completeRowsByStudent = (resolvedStudents || []).reduce((acc, student) => {
      const studentId = String(student?.id || "").trim();
      if (!studentId) {
        return acc;
      }
      acc[studentId] = {
        studentId,
        subjectId: normalizedSubjectId,
        ...(groupedRowsBySubject?.[subjectToken]?.[studentId] || buildEmptyScoreRow()),
      };
      return acc;
    }, {});

    Object.entries(previewOverrides || {}).forEach(([studentId, localScore]) => {
      const normalizedStudentId = String(studentId || "").trim();
      if (!normalizedStudentId || !hasAnyStoredScoreValue(localScore)) {
        return;
      }
      completeRowsByStudent[normalizedStudentId] = {
        ...(completeRowsByStudent[normalizedStudentId] || {
          studentId: normalizedStudentId,
          subjectId: normalizedSubjectId,
          ...buildEmptyScoreRow(),
        }),
        ...localScore,
      };
    });

    let previousTotalsBySubject = {};
    const previousTermAlias = getPreviousTermAlias(normalizedTermId);
    if (previousTermAlias) {
      const storedLtcMap = await getStoredLastTermCumulativeMap({
        schoolId,
        classId,
        subjectId: normalizedSubjectId,
        sessionId: resolvedSessionId,
        termId: normalizedTermId,
      });
      if (Object.keys(storedLtcMap || {}).length > 0) {
        previousTotalsBySubject = {
          [subjectToken]: storedLtcMap,
        };
      } else {
        previousTotalsBySubject = await getClassSubjectTotalsByTerm(
          schoolId,
          classId,
          previousTermAlias,
          resolvedSessionId,
          resultConfig,
          new Map(),
          { subjectIds: [normalizedSubjectId] }
        );
      }
    }

    const snapshot = buildSubjectScoreSnapshotFromRows({
      termId: normalizedTermId,
      rowsByStudent: completeRowsByStudent,
      previousTotalsByStudent: previousTotalsBySubject?.[subjectToken] || {},
      resultConfig,
    });

    return (resolvedStudents || []).map((student) => {
      const studentId = String(student?.id || "").trim();
      const studentSnapshot =
        snapshot?.rowsByStudent?.[studentId] || {
          scoreRow: buildEmptyScoreRow(),
          breakdown: buildScoreBreakdown({
            termId: normalizedTermId,
            scoreRow: buildEmptyScoreRow(),
            computedLtc: 0,
            resultConfig,
          }),
          total: 0,
          lastTermCumulative: shouldUseLastTermCumulative(normalizedTermId) ? 0 : null,
        };
      const scoreBreakdown = studentSnapshot.breakdown;
      const total = roundScore(Number(studentSnapshot.total) || 0);
      const grade = calculateGrade(total, gradingScale);

      return {
        id: studentId,
        name: student?.name || "",
        ...scoreBreakdown.componentScores,
        testSum: scoreBreakdown.testSum,
        ca: scoreBreakdown.caTotal,
        exam: scoreBreakdown.exam,
        examAndCa: scoreBreakdown.examAndCa,
        total,
        lastTermCum: shouldUseLastTermCumulative(normalizedTermId)
          ? roundScore(Number(studentSnapshot.lastTermCumulative) || 0)
          : null,
        classAverage: roundScore(Number(snapshot?.classAverage || 0)),
        highestInClass: roundScore(Number(snapshot?.highestScore || 0)),
        lowestInClass: roundScore(Number(snapshot?.lowestScore || 0)),
        position: Number(snapshot?.positionByStudent?.[studentId] || 0),
        grade,
        remark: getRemarkByGrade(grade),
      };
    });
  } catch (error) {
    console.error("Error building class subject result rows:", error);
    return [];
  }
}

export async function getStudentReportRows({
  schoolId,
  classId,
  studentId,
  termId,
  sessionId,
  adminSettings = null,
  screen = "StudentResult",
}) {
  try {
    const normalizedStudentId = String(studentId || "").trim();
    if (!schoolId || !classId || !normalizedStudentId) {
      return [];
    }

    const resolvedSessionId = await resolveSession(
      sessionId || getCurrentSessionId(),
      schoolId
    );
    if (!resolvedSessionId) {
      return [];
    }

    const resolvedTermId = await resolveTerm(termId || "term1", schoolId);
    const normalizedTermId = normalizeTermAlias(resolvedTermId);
    const resultConfig = normalizeResultConfig(
      adminSettings?.resultConfig || (await getResultConfig(schoolId))
    );
    const gradingScale = getConfiguredGradingScale(
      adminSettings?.gradingScale,
      resultConfig
    );
    const subjects = await filterSubjectsForCurrentUserScope({
      subjects: getSubjectsByClass(schoolId, classId),
      screen,
    });
    if (subjects.length === 0) {
      return [];
    }
    const currentRows = await fetchScoresForClassTerm({
      schoolId,
      classId,
      sessionId: resolvedSessionId,
      termId: normalizedTermId,
      subjectIds: subjects,
      options: {
        screen,
        action: "student_report_rows_scores_query",
      },
    });
    const groupedRowsBySubject = groupBestScoreRowsBySubjectAndStudent(currentRows);

    let previousTotalsBySubject = {};
    const previousTermAlias = getPreviousTermAlias(normalizedTermId);
    if (previousTermAlias) {
      previousTotalsBySubject = await getClassSubjectTotalsByTerm(
        schoolId,
        classId,
        previousTermAlias,
        resolvedSessionId,
        resultConfig,
        new Map(),
        { subjectIds: subjects }
      );
    }

    return subjects.reduce((rows, subject) => {
      const subjectToken = normalizeSubjectMatchToken(subject);
      const snapshot = buildSubjectScoreSnapshotFromRows({
        termId: normalizedTermId,
        rowsByStudent: groupedRowsBySubject?.[subjectToken] || {},
        previousTotalsByStudent: previousTotalsBySubject?.[subjectToken] || {},
        resultConfig,
      });
      const studentSnapshot = snapshot?.rowsByStudent?.[normalizedStudentId] || null;
      if (!studentSnapshot || !hasAnyStoredScoreValue(studentSnapshot?.scoreRow)) {
        return rows;
      }

      const scoreBreakdown = studentSnapshot.breakdown;
      const total = roundScore(Number(studentSnapshot.total) || 0);
      const grade = calculateGrade(total, gradingScale);
      rows.push({
        subject,
        ...scoreBreakdown.componentScores,
        testSum: scoreBreakdown.testSum,
        ca: scoreBreakdown.caTotal,
        exam: scoreBreakdown.exam,
        examAndCa: scoreBreakdown.examAndCa,
        total,
        lastTermCumulative: shouldUseLastTermCumulative(normalizedTermId)
          ? studentSnapshot.lastTermCumulative
          : "",
        classAverage: roundScore(Number(snapshot?.classAverage || 0)),
        highestInClass: roundScore(Number(snapshot?.highestScore || 0)),
        lowestInClass: roundScore(Number(snapshot?.lowestScore || 0)),
        position: Number(snapshot?.positionByStudent?.[normalizedStudentId] || 0),
        grade,
        remark: getRemarkByGrade(grade),
      });
      return rows;
    }, []);
  } catch (error) {
    console.error("Error building student report rows:", error);
    return [];
  }
}

/**
 * Save school data (Firestore).
 * @param {Object} form - School form data
 * @param {string} userId - Firebase user ID (required)
 * @param {string} schoolId - School ID (required)
 */
export async function saveSchoolData(form, userId, schoolId) {
  try {
    if (!schoolId) {
      console.error("Error: schoolId is required to save school data");
      return;
    }
    
    const schoolData = {
      schoolId,
      name: form.name,
      logo: form.logo || '',
      address: form.address || '',
      email: form.email || '',
      phone: form.phone || '',
      motto: form.motto || '',
      searchIndex: buildSchoolSearchIndex({
        schoolId,
        name: form.name,
        schoolCode: schoolId,
        email: form.email || "",
      }),
      updatedAt: new Date().toISOString(),
    };

    await instrumentFirestoreWrite(
      setDoc(doc(firestore, "schools", schoolId), schoolData, { merge: true }),
      {
        screen: "AdminConfig",
        action: "save_school_profile",
        target: `schools/${schoolId}`,
        count: 1,
      }
    );
    
    // Also keep in sessionStorage for quick access
    setSessionState(`schoolData_${schoolId}`, JSON.stringify(schoolData));
    setCachedValue(`school_data::${schoolId}`, schoolData, CACHE_TTL.schoolDataMs);
    dispatchSchoolProfileUpdated({
      schoolId,
      schoolData,
    });
  } catch (error) {
    console.error("Error saving school data:", error);
    throw error;
  }
}

/**
 * Get school data for current user (from Firebase or cache)
 * @param {string} schoolId - School ID
 * @returns {Promise<Object>} School data or empty object
 */
export async function getSchoolData(schoolId) {
  try {
    if (!schoolId) {
      console.warn("Warning: schoolId not provided to getSchoolData");
      return {};
    }

    const memoryCached = getCachedValue(`school_data::${schoolId}`);
    if (memoryCached) {
      return memoryCached;
    }

    // Try sessionStorage cache first
    let cachedData = null;
    try {
      const cached = getSessionState(`schoolData_${schoolId}`);
      cachedData = cached ? JSON.parse(cached) : null;
    } catch {
      cachedData = null;
    }
    const hasUsableCachedProfile =
      !!cachedData &&
      (String(cachedData?.name || "").trim().length > 0 ||
        String(cachedData?.logo || "").trim().length > 0);
    const hasUsableCachedCatalog =
      !!cachedData &&
      ((cachedData?.classes && Object.keys(cachedData.classes || {}).length > 0) ||
        (cachedData?.subjects && Object.keys(cachedData.subjects || {}).length > 0));
    if (hasUsableCachedProfile && hasUsableCachedCatalog) {
      return cachedData;
    }

    let schoolDoc = null;
    let currentUserScope = null;
    let isTeacherScopedCatalog = false;
    try {
      currentUserScope = await loadCurrentUserAccessProfile({
        screen: "Shared",
        action: "get_school_catalog_scope",
      });
      const scopeRole = String(currentUserScope?.role || "").trim().toLowerCase();
      isTeacherScopedCatalog =
        ["class_teacher", "subject_teacher", "class_subject_teacher", "teacher"].includes(
          scopeRole
        );
    } catch (scopeError) {
      console.warn("School catalog scope lookup failed:", scopeError?.message || scopeError);
    }

    try {
      const schoolSnap = await instrumentFirestoreRead(
        getDoc(doc(firestore, "schools", schoolId)),
        {
          screen: "Shared",
          action: "get_school_profile_doc",
          target: `schools/${schoolId}`,
        }
      );
      schoolDoc = schoolSnap.exists() ? schoolSnap.data() : null;
    } catch (schoolError) {
      console.warn("School profile read failed:", schoolError?.message || schoolError);
    }

    let classes = {};
    if (!isTeacherScopedCatalog) {
      try {
        const classesSnap = await instrumentFirestoreRead(
          getDocs(
            query(collection(firestore, "classes"), where("schoolId", "==", schoolId))
          ),
          {
            screen: "Shared",
            action: "get_school_classes",
            target: `classes:${schoolId}`,
          }
        );
        classes = classesSnap.docs.reduce((acc, row) => {
          const data = row.data() || {};
          const classId = data?.classId || row.id;
          acc[classId] = {
            ...data,
            classId,
            label: data?.label || data?.name || String(classId).toUpperCase(),
          };
          return acc;
        }, {});
      } catch (classesError) {
        const code = String(classesError?.code || "");
        if (code.includes("permission-denied")) {
          console.warn("Class catalog read blocked for this role; using cached/default classes.");
        } else {
          console.warn("Class catalog read failed:", classesError?.message || classesError);
        }
      }
    } else {
      classes = await buildTeacherScopedClassCatalog(currentUserScope?.assignedClasses || []);
    }

    let subjects = normalizeSubjectCatalog(null, { fallbackToDefault: false });
    if (!isTeacherScopedCatalog) {
      try {
        const subjectsSnap = await instrumentFirestoreRead(
          getDocs(
            query(collection(firestore, "subjects"), where("schoolId", "==", schoolId))
          ),
          {
            screen: "Shared",
            action: "get_school_subjects",
            target: `subjects:${schoolId}`,
          }
        );
        subjects = normalizeSubjectCatalog(
          subjectsSnap.docs.map((row) => {
            const data = row.data() || {};
            return {
              level: data?.level,
              subjectId: data?.subjectId || row.id,
              name: data?.name || data?.subjectId || row.id,
            };
          }),
          { fallbackToDefault: false }
        );
      } catch (subjectsError) {
        const code = String(subjectsError?.code || "");
        if (code.includes("permission-denied")) {
          console.warn("Subject catalog read blocked for this role; using cached/default subjects.");
        } else {
          console.warn("Subject catalog read failed:", subjectsError?.message || subjectsError);
        }
      }
    } else {
      subjects = await buildTeacherScopedSubjectCatalog(
        schoolId,
        currentUserScope?.assignedSubjects || []
      );
    }

    const profile = schoolDoc || cachedData || {};

    let resolvedClasses = classes || {};
    if (!resolvedClasses || Object.keys(resolvedClasses).length === 0) {
      const customClasses = getCustomClasses(schoolId) || [];
      resolvedClasses = customClasses.reduce((acc, cls) => {
        const classId = typeof cls === "string" ? cls : cls?.id;
        const classLabel =
          typeof cls === "string" ? cls.toUpperCase() : cls?.label || classId;
        if (classId) {
          acc[classId] = { classId, label: classLabel };
        }
        return acc;
      }, {});
    }
    if (isTeacherScopedCatalog) {
      resolvedClasses = filterClassesByAssignments(
        resolvedClasses,
        currentUserScope?.assignedClasses || []
      );
    }

    let resolvedSubjects = normalizeSubjectCatalog(subjects, {
      fallbackToDefault: false,
    });
    if (!hasConfiguredSubjects(resolvedSubjects)) {
      const cachedLocalSubjects = readLegacySubjectCatalogCache(schoolId);
      if (hasConfiguredSubjects(cachedLocalSubjects)) {
        resolvedSubjects = await maybeSeedSharedSubjectCatalog(
          schoolId,
          cachedLocalSubjects
        );
      } else {
        resolvedSubjects = createDefaultSubjectCatalog();
      }
    }
    if (isTeacherScopedCatalog) {
      resolvedSubjects = filterSubjectCatalogByAssignments(
        resolvedSubjects,
        currentUserScope?.assignedSubjects || []
      );
    }

    const data = {
      ...(cachedData || {}),
      ...(profile || {}),
      classes: resolvedClasses,
      subjects: resolvedSubjects,
    };

    setSessionState(`schoolData_${schoolId}`, JSON.stringify(data));
    setCachedValue(`school_data::${schoolId}`, data, CACHE_TTL.schoolDataMs);
    return data;
  } catch (error) {
    console.error("Error getting school data:", error);
    return {};
  }
}

/**
 * Clear all school data for a specific school
 * @param {string} schoolId - School ID
 */
export function clearUserSchoolData(schoolId) {
  try {
    if (!schoolId) return;
    // Clear sessionStorage cache
    const keys = Object.keys(sessionStorage);
    keys.forEach(key => {
      if (key.includes(`_${schoolId}`)) {
        sessionStorage.removeItem(key);
      }
    });
    invalidateCachePrefix(`school_data::${schoolId}`);
    invalidateCachePrefix(`admin_settings::${schoolId}`);
    invalidateCachePrefix(`result_config::${schoolId}`);
    invalidateCachePrefix(`class_students::${schoolId}::`);
    invalidateCachePrefix(`scores_ctx::${schoolId}::`);
  } catch (error) {
    console.error("Error clearing user data:", error);
  }
}

/**
 * Save class selection (using sessionStorage)
 * @param {Object} classData - Class selection data
 * @param {string} userId - Firebase user ID
 */
export function saveClassSelection(classData, userId) {
  try {
    if (!userId) return;
    setSessionState(`classSelection_${userId}`, JSON.stringify(classData));
    localStorage.setItem(`classSelection_${userId}`, JSON.stringify(classData));
    localStorage.setItem("classSelection", JSON.stringify(classData));
  } catch (error) {
    console.error("Error saving class selection:", error);
  }
}

/**
 * Get class selection (from sessionStorage)
 * @param {string} userId - Firebase user ID
 */
export function getClassSelection(userId) {
  try {
    if (!userId) {
      // Fallback for preview mode: use sessionStorage 'classSelection'
      const sessionData = sessionStorage.getItem("classSelection");
      const localData = localStorage.getItem("classSelection");
      const data = sessionData || localData;
      return data ? JSON.parse(data) : { class: "", term: "", session: "" };
    }
    const data = getSessionState(`classSelection_${userId}`);
    if (data) {
      return JSON.parse(data);
    }
    const fallback =
      sessionStorage.getItem("classSelection") ||
      localStorage.getItem(`classSelection_${userId}`) ||
      localStorage.getItem("classSelection");
    return fallback ? JSON.parse(fallback) : { class: "", term: "", session: "" };
  } catch (error) {
    console.error("Error getting class selection:", error);
    return { class: "", term: "", session: "" };
  }
}

/**
 * Save class students (Firestore enrollment model).
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {Array} students - Students array
 * @param {string} userId - Firebase user ID
 */
export async function saveClassStudents(schoolId, classId, students, userId, options = {}) {
  try {
    if (!schoolId || !classId) return;
    const resolvedSessionId = await resolveSession(
      options?.sessionId || getCurrentSessionId(),
      schoolId
    );
    if (!resolvedSessionId) {
      throw new Error("No active session selected.");
    }
    let effectiveSessionId = String(resolvedSessionId);

    // Preflight checks to fail with actionable errors before Firestore batch commit.
    // This avoids generic "Missing or insufficient permissions" responses.
    const currentUser = auth?.currentUser || null;
    if (!currentUser?.uid) {
      throw new Error("User is not authenticated.");
    }

    const cachedScope = getCachedUserScopeForSchool(schoolId, currentUser.uid);
    const userScope =
      cachedScope ||
      (await loadCurrentUserAccessProfile({
        screen: "ClassDashboard",
        action: "save_students_user_profile",
      }));
    if (!userScope?.uid) {
      throw new Error("User profile is missing. Please sign in again.");
    }
    const userRole = String(userScope?.role || "").toLowerCase();
    const userSchoolId = String(userScope?.schoolId || "").trim();
    if (!["admin", "class_teacher", "class_subject_teacher"].includes(userRole)) {
      throw new Error("Only admin or class teacher can add students.");
    }
    if (!userSchoolId || userSchoolId !== String(schoolId)) {
      throw new Error("Your account school does not match the selected school.");
    }

    let sessionSnap = null;
    try {
      sessionSnap = await instrumentFirestoreRead(
        getDoc(doc(firestore, "sessions", effectiveSessionId)),
        {
          screen: "ClassDashboard",
          action: "save_students_session_check",
          target: `sessions/${effectiveSessionId}`,
        }
      );
    } catch (sessionReadError) {
      const readCode = String(sessionReadError?.code || "");
      if (readCode.includes("permission-denied")) {
        const fallbackSessionId = await getCurrentSessionIdFromContext(schoolId);
        const normalizedFallback = String(fallbackSessionId || "").trim();
        if (normalizedFallback && normalizedFallback !== effectiveSessionId) {
          effectiveSessionId = normalizedFallback;
          try {
            sessionSnap = await instrumentFirestoreRead(
              getDoc(doc(firestore, "sessions", effectiveSessionId)),
              {
                screen: "ClassDashboard",
                action: "save_students_session_fallback_check",
                target: `sessions/${effectiveSessionId}`,
              }
            );
          } catch (fallbackReadError) {
            const fallbackCode = String(fallbackReadError?.code || "");
            if (!fallbackCode.includes("permission-denied")) {
              throw fallbackReadError;
            }
            sessionSnap = null;
          }
        }
      } else {
        throw sessionReadError;
      }
    }
    if (sessionSnap) {
      if (!sessionSnap.exists()) {
        throw new Error("Selected session is invalid. Refresh and select an active session.");
      }
      const sessionData = sessionSnap.data() || {};
      if (String(sessionData?.schoolId || "").trim() !== String(schoolId)) {
        throw new Error("Selected session belongs to a different school.");
      }
      if (sessionData?.isArchived === true || sessionData?.isEditable === false) {
        throw new Error("Selected session is archived/read-only. Switch to the active session.");
      }
    }

    const effectiveTermId = await resolveTerm(options?.termId, schoolId);
    const termRecord = await getTermDocumentForSession(
      schoolId,
      effectiveSessionId,
      effectiveTermId,
    ).catch(() => null);
    const effectiveTermAlias = normalizeTermAlias(termRecord?.alias || effectiveTermId);
    const effectiveTermOrder = Number(termRecord?.sortOrder) || getTermSortOrder(effectiveTermAlias);

    const normalizeStudentName = (value) =>
      String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const mergeRosterRows = (baseRoster = [], deltaRoster = []) => {
      const merged = new Map();
      [...(Array.isArray(baseRoster) ? baseRoster : []), ...(Array.isArray(deltaRoster) ? deltaRoster : [])].forEach(
        (row) => {
          const studentId = String(row?.id || "").trim();
          if (!studentId) return;
          merged.set(studentId, row);
        }
      );
      return Array.from(merged.values()).sort((left, right) =>
        String(left?.name || "").localeCompare(String(right?.name || ""))
      );
    };
    const groupedByName = {};
    for (const student of students || []) {
      const normalizedName = normalizeStudentName(student?.name);
      if (!normalizedName) continue;
      if (!groupedByName[normalizedName]) groupedByName[normalizedName] = [];
      groupedByName[normalizedName].push(student);
    }
    const hasBlockingDuplicate = Object.values(groupedByName).some((entries) => {
      if ((entries || []).length <= 1) return false;
      // Block duplicates only when a new row is being introduced with a conflicting name.
      // This avoids freezing the class when legacy duplicate rows already exist.
      return (entries || []).some((entry) => typeof entry?.id === "number");
    });
    if (hasBlockingDuplicate) {
      throw new Error("Duplicate student names are not allowed in the same class");
    }

    const enrollmentByStudentId = {};
    const needsEnrollmentLookup = (students || []).some((student) => {
      const existingId = String(student?.id || "").trim();
      return !!existingId && typeof student?.id !== "number";
    });
    if (needsEnrollmentLookup) {
      try {
        const existingEnrollmentsSnap = await instrumentFirestoreRead(
          getDocs(
            query(
              collection(firestore, "enrollments"),
              where("schoolId", "==", schoolId),
              where("sessionId", "==", effectiveSessionId)
            )
          ),
          {
            screen: "ClassDashboard",
            action: "save_students_existing_enrollments",
            target: `enrollments:${effectiveSessionId}`,
          }
        );
        existingEnrollmentsSnap.docs.forEach((row) => {
          const data = row.data() || {};
          const studentId = String(data?.studentId || "").trim();
          if (!studentId) return;
          if (!enrollmentByStudentId[studentId]) {
            enrollmentByStudentId[studentId] = [];
          }
          enrollmentByStudentId[studentId].push({ id: row.id, ...data });
        });
      } catch (lookupError) {
        const lookupCode = String(lookupError?.code || "");
        if (lookupCode.includes("permission-denied")) {
          throw new Error(
            `Permission denied while reading enrollment index (sessionId=${effectiveSessionId}, role=${userRole}).`
          );
        }
        throw lookupError;
      }
    }

    const batch = writeBatch(firestore);
    const hydratedStudents = [];
    const shouldUpsertExisting = options?.upsertExistingStudent !== false;
    let createdStudentsCount = 0;
    let createdEnrollmentsCount = 0;
    let batchWriteCount = 0;

    for (const student of students || []) {
      const normalizedName = String(student?.name || "").replace(/\s+/g, " ").trim();
      if (!normalizedName) continue;

      const existingId = String(student?.id || "").trim();
      const isExistingStudent = !!existingId && typeof student?.id !== "number";

      if (isExistingStudent) {
        if (shouldUpsertExisting) {
          const studentRef = doc(firestore, "students", existingId);
          batch.set(
            studentRef,
            {
              studentId: existingId,
              schoolId,
              name: normalizedName,
              regNo: student.regNumber || student.regNo || "",
              gender: student.sex || student.gender || "",
              sex: student.sex || student.gender || "",
              phone: student.phone || "",
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          batchWriteCount += 1;
        }

        const hasClassEnrollment = (enrollmentByStudentId[existingId] || []).some(
          (enrollment) => String(enrollment?.classId || "") === String(classId)
        );
        let resolvedEnrollmentId = String(student?.enrollmentId || "").trim();
        if (!hasClassEnrollment) {
          const enrollmentRef = doc(collection(firestore, "enrollments"));
          resolvedEnrollmentId = enrollmentRef.id;
          batch.set(enrollmentRef, {
            enrollmentId: enrollmentRef.id,
            schoolId,
            studentId: existingId,
            classId,
            sessionId: effectiveSessionId,
            entryTermId: effectiveTermAlias,
            entryTermOrder: effectiveTermOrder,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batchWriteCount += 1;
          createdEnrollmentsCount += 1;
        }

        hydratedStudents.push({
          ...mapStudentRecord(
            existingId,
            {
              ...student,
              studentId: existingId,
              schoolId,
              name: normalizedName,
              regNo: student.regNumber || student.regNo || "",
              gender: student.sex || student.gender || "",
              sex: student.sex || student.gender || "",
              phone: student.phone || "",
              status: student.status || "active",
              isDeleted: !!student.isDeleted,
            },
            resolvedEnrollmentId || null,
            classId,
            {
              classId,
              sessionId: effectiveSessionId,
              entryTermId: effectiveTermAlias,
              entryTermOrder: effectiveTermOrder,
            }
          ),
          name: normalizedName,
        });
        continue;
      }

      const studentRef = doc(collection(firestore, "students"));
      const enrollmentRef = doc(collection(firestore, "enrollments"));
      batch.set(studentRef, {
        studentId: studentRef.id,
        schoolId,
        name: normalizedName,
        regNo: student.regNumber || student.regNo || "",
        gender: student.sex || student.gender || "",
        sex: student.sex || student.gender || "",
        phone: student.phone || "",
        status: "active",
        isDeleted: false,
        deletedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batchWriteCount += 1;
      batch.set(enrollmentRef, {
        enrollmentId: enrollmentRef.id,
        schoolId,
        studentId: studentRef.id,
        classId,
        sessionId: effectiveSessionId,
        entryTermId: effectiveTermAlias,
        entryTermOrder: effectiveTermOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batchWriteCount += 1;
      createdStudentsCount += 1;
      createdEnrollmentsCount += 1;

      hydratedStudents.push({
        ...mapStudentRecord(
          studentRef.id,
          {
            ...student,
            studentId: studentRef.id,
            schoolId,
            name: normalizedName,
            regNo: student.regNumber || student.regNo || "",
            gender: student.sex || student.gender || "",
            sex: student.sex || student.gender || "",
            phone: student.phone || "",
            status: "active",
            isDeleted: false,
          },
          enrollmentRef.id,
          classId,
          {
            classId,
            sessionId: effectiveSessionId,
            entryTermId: effectiveTermAlias,
            entryTermOrder: effectiveTermOrder,
          }
        ),
        name: normalizedName,
      });
    }

    try {
      await instrumentFirestoreWrite(batch.commit(), {
        screen: "ClassDashboard",
        action: "save_students_batch_commit",
        target: `class:${classId}`,
        count: batchWriteCount,
      });
    } catch (commitError) {
      const commitCode = String(commitError?.code || "");
      if (commitCode.includes("permission-denied")) {
        throw new Error(
          `Permission denied while saving student records (sessionId=${effectiveSessionId}, role=${userRole}).`
        );
      }
      throw commitError;
    }

    invalidateStudentCachesForClass({
      schoolId,
      classId,
      sessionId: effectiveSessionId,
    });

    const knownRoster = Array.isArray(options?.existingRoster) ? options.existingRoster : [];
    const mergedRoster = mergeRosterRows(knownRoster, hydratedStudents);
    let cachePayload = mergedRoster;
    if (cachePayload.length === 0) {
      try {
        cachePayload = await getClassStudents(schoolId, classId, {
          sessionId: effectiveSessionId,
          termId: effectiveTermAlias,
          includeInactive: true,
          includeDeleted: true,
          bypassCache: true,
        });
      } catch (rosterError) {
        console.warn(
          "Roster refresh after saveClassStudents failed:",
          rosterError?.message || rosterError
        );
        cachePayload = hydratedStudents;
      }
    }

    const fullRosterSessionKey = buildClassStudentsSessionCacheKey({
      schoolId,
      classId,
      sessionId: effectiveSessionId,
      termId: effectiveTermAlias,
      includeInactive: true,
      includeDeleted: true,
    });
    const visibleRosterSessionKey = buildClassStudentsSessionCacheKey({
      schoolId,
      classId,
      sessionId: effectiveSessionId,
      termId: effectiveTermAlias,
      includeInactive: false,
      includeDeleted: false,
    });
    const fullRosterCacheKey = buildClassStudentsCacheKey({
      schoolId,
      classId,
      sessionId: effectiveSessionId,
      termId: effectiveTermAlias,
      includeInactive: true,
      includeDeleted: true,
    });
    const visibleRosterCacheKey = buildClassStudentsCacheKey({
      schoolId,
      classId,
      sessionId: effectiveSessionId,
      termId: effectiveTermAlias,
      includeInactive: false,
      includeDeleted: false,
    });
    const visibleCachePayload = (Array.isArray(cachePayload) ? cachePayload : []).filter(
      (student) =>
        String(student?.status || "active").toLowerCase() === "active" && !student?.isDeleted
    );
    setSessionState(fullRosterSessionKey, JSON.stringify(cachePayload));
    setSessionState(visibleRosterSessionKey, JSON.stringify(visibleCachePayload));
    setCachedValue(fullRosterCacheKey, cachePayload, CACHE_TTL.classStudentsMs);
    setCachedValue(visibleRosterCacheKey, visibleCachePayload, CACHE_TTL.classStudentsMs);
    void syncRecordDashboardRosterCache({
      schoolId,
      classId,
      sessionId: effectiveSessionId,
      students: visibleCachePayload,
    });
    if (createdStudentsCount || createdEnrollmentsCount) {
      try {
        await applySchoolCountDelta(schoolId, {
          students: createdStudentsCount,
          enrollments: createdEnrollmentsCount,
        });
      } catch (countDeltaError) {
        const countCode = String(countDeltaError?.code || "");
        if (!countCode.includes("permission-denied")) {
          console.warn("Count delta update failed:", countDeltaError?.message || countDeltaError);
        }
      }
    }
    if (options?.forceRecomputeCounts === true) {
      try {
        await recomputeSchoolCounts(schoolId);
      } catch (countError) {
        const countCode = String(countError?.code || "");
        if (!countCode.includes("permission-denied")) {
          console.warn("Student count refresh failed:", countError?.message || countError);
        }
      }
    }
    return {
      students: cachePayload,
      sessionId: effectiveSessionId,
      termId: effectiveTermAlias,
    };
  } catch (error) {
    console.error("Error saving students:", error);
    throw error;
  }
}

/**
 * Get class students (from Firebase)
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 */
export async function getClassStudents(schoolId, classId, options = {}) {
  try {
    if (!schoolId || !classId) return [];
    const includeInactive = !!options?.includeInactive;
    const includeDeleted = !!options?.includeDeleted;
    const bypassCache = !!options?.bypassCache;
    const resolvedSessionId = await resolveSession(
      options?.sessionId || getCurrentSessionId(),
      schoolId
    );
    if (!resolvedSessionId) return [];
    const resolvedTermId = await resolveTerm(options?.termId, schoolId);
    const cacheKey = buildClassStudentsCacheKey({
      schoolId,
      classId,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
      includeInactive,
      includeDeleted,
    });
    const cachedStudents = bypassCache ? null : getCachedValue(cacheKey);
    if (Array.isArray(cachedStudents)) {
      return cachedStudents;
    }
    const exactSessionCacheKey = buildClassStudentsSessionCacheKey({
      schoolId,
      classId,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
      includeInactive,
      includeDeleted,
    });
    const cachedSessionStudents = bypassCache ? null : getSessionState(exactSessionCacheKey);
    if (cachedSessionStudents) {
      try {
        const parsed =
          typeof cachedSessionStudents === "string"
            ? JSON.parse(cachedSessionStudents)
            : cachedSessionStudents;
        if (Array.isArray(parsed)) {
          setCachedValue(cacheKey, parsed, CACHE_TTL.classStudentsMs);
          return parsed;
        }
      } catch {
        // Ignore malformed cached roster payload and fall through to live query.
      }
    }

    const scopedRows = await queryStudentsInClass({
      schoolId,
      classId,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
    });

    const scopedStudents = scopedRows
      .map((row) => {
        const student = row?.student || {};
        const status = student.status || (student.isDeleted ? "archived" : "active");
        const isDeleted = !!student.isDeleted;
        const normalizedStatus = String(status).toLowerCase();
        const isActive = normalizedStatus === "active" && !isDeleted;
        if (!includeDeleted && isDeleted) return null;
        if (!includeInactive && !isActive) return null;
        return mapStudentRecord(
          row.studentId,
          student,
          row.enrollmentId,
          classId,
          row.enrollment || null
        );
      })
      .filter(Boolean)
      .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));

    setSessionState(exactSessionCacheKey, JSON.stringify(scopedStudents));
    setCachedValue(cacheKey, scopedStudents, CACHE_TTL.classStudentsMs);
    return scopedStudents;
  } catch (error) {
    console.error("Error getting students:", error);
    return [];
  }
}

export const JUNIOR_SUBJECTS = [
  "Business Studies",
  "Civic Education",
  "Social Studies",
  "Christian Religious Knowledge/Islamic Studies",
  "English Language",
  "Mathematics",
  "Basic Science and Technology",
  "Agricultural Science",
  "Home Economics",
  "Cultural and Creative Arts",
];

export const SENIOR_SUBJECTS = [
  "English Language",
  "Mathematics",
  "Biology",
  "Further Mathematics",
  "Economics",
  "Literature",
  "Computer Studies",
  "C.R. Studies",
  "Government/History",
  "Geography",
  "French",
  "Fine Arts",
  "Music",
  "Agricultural Science",
  "Commerce",
  "Physics",
  "Chemistry",
  "Financial Accounting",
];

const createDefaultSubjectCatalog = () => ({
  junior: [...JUNIOR_SUBJECTS],
  senior: [...SENIOR_SUBJECTS],
});

const uniqueSubjectNames = (items = []) =>
  [...new Set(
    (items || [])
      .map((item) => normalizeSubjectId(item))
      .filter(Boolean)
  )];

const hasConfiguredSubjects = (catalog) =>
  Array.isArray(catalog?.junior) &&
  Array.isArray(catalog?.senior) &&
  (catalog.junior.length > 0 || catalog.senior.length > 0);

const normalizeSubjectCatalog = (value, { fallbackToDefault = true } = {}) => {
  const normalized = {
    junior: [],
    senior: [],
  };

  if (Array.isArray(value?.junior) || Array.isArray(value?.senior)) {
    normalized.junior = uniqueSubjectNames(value?.junior);
    normalized.senior = uniqueSubjectNames(value?.senior);
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const levelToken = String(entry?.level || entry?.levelKey || entry?.group || "")
        .trim()
        .toLowerCase();
      const levelKey = levelToken.startsWith("sen")
        ? "senior"
        : levelToken.startsWith("jun")
          ? "junior"
          : "";
      const subjectName = normalizeSubjectId(entry?.name || entry?.subjectId || "");
      if (!levelKey || !subjectName) return;
      normalized[levelKey].push(subjectName);
    });
    normalized.junior = uniqueSubjectNames(normalized.junior);
    normalized.senior = uniqueSubjectNames(normalized.senior);
  }

  if (fallbackToDefault && !hasConfiguredSubjects(normalized)) {
    return createDefaultSubjectCatalog();
  }
  return normalized;
};

const readLegacySubjectCatalogCache = (schoolId) => {
  try {
    const cached = getSessionState(`customSubjects_${schoolId}`);
    if (!cached) {
      return normalizeSubjectCatalog(null, { fallbackToDefault: false });
    }
    return normalizeSubjectCatalog(JSON.parse(cached), { fallbackToDefault: false });
  } catch (error) {
    console.error("Error reading cached subject catalog:", error);
    return normalizeSubjectCatalog(null, { fallbackToDefault: false });
  }
};

const readSchoolDataCache = (schoolId) => {
  const memoryCached = getCachedValue(`school_data::${schoolId}`);
  if (memoryCached) {
    return memoryCached;
  }
  try {
    const cached = getSessionState(`schoolData_${schoolId}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
};

const writeSubjectCatalogCaches = (schoolId, catalog) => {
  const normalizedCatalog = normalizeSubjectCatalog(catalog);
  try {
    setSessionState(`customSubjects_${schoolId}`, JSON.stringify(normalizedCatalog));
  } catch (error) {
    console.error("Error caching subject catalog:", error);
  }

  const cachedSchoolData = readSchoolDataCache(schoolId) || {};
  const nextSchoolData = {
    ...cachedSchoolData,
    subjects: normalizedCatalog,
  };
  setSessionState(`schoolData_${schoolId}`, JSON.stringify(nextSchoolData));
  setCachedValue(`school_data::${schoolId}`, nextSchoolData, CACHE_TTL.schoolDataMs);
};

const buildSubjectCatalogDocId = (schoolId, level, subject) =>
  `${schoolId}__${level}__${sanitizeDocIdToken(normalizeSubjectMatchToken(subject))}`;

const buildStoredLtcDocId = (schoolId, classId, subjectId, sessionId, termId) =>
  [
    String(schoolId || "").trim(),
    normalizeClassId(classId),
    sanitizeDocIdToken(normalizeSubjectAliasToken(subjectId)),
    String(sessionId || "").trim(),
    normalizeTermAlias(termId),
  ]
    .filter(Boolean)
    .join("__");

const buildStoredLtcDocIdCandidates = (schoolId, classId, subjectId, sessionId, termId) => {
  const normalizedSchoolId = String(schoolId || "").trim();
  const normalizedClassId = normalizeClassId(classId);
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedTermId = normalizeTermAlias(termId);
  const canonicalSubjectToken = normalizeSubjectAliasToken(subjectId);
  const normalizedSubjectId = normalizeSubjectId(subjectId);

  return [
    [
      normalizedSchoolId,
      normalizedClassId,
      sanitizeDocIdToken(canonicalSubjectToken),
      normalizedSessionId,
      normalizedTermId,
    ],
    [
      normalizedSchoolId,
      normalizedClassId,
      sanitizeDocIdToken(normalizedSubjectId),
      normalizedSessionId,
      normalizedTermId,
    ],
  ]
    .map((parts) => parts.filter(Boolean).join("__"))
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
};

const normalizeLtcCacheMap = (values = {}) =>
  Object.entries(values || {}).reduce((acc, [studentId, value]) => {
    const normalizedStudentId = String(studentId || "").trim();
    if (!normalizedStudentId) {
      return acc;
    }
    acc[normalizedStudentId] = roundScore(Number(value) || 0);
    return acc;
  }, {});

const readRecordDashboardRosterCache = async ({
  schoolId,
  classId,
  sessionId,
  bypassLocalCache = false,
}) => {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!schoolId || !classId || !normalizedSessionId) {
    return { hit: false, students: [] };
  }

  const cacheKey = buildRecordRosterCacheKey({
    schoolId,
    classId,
    sessionId: normalizedSessionId,
  });
  const sessionKey = buildRecordRosterSessionCacheKey({
    schoolId,
    classId,
    sessionId: normalizedSessionId,
  });

  if (!bypassLocalCache) {
    const cached = readResolvedRecordCache({
      cacheKey,
      sessionKey,
      normalizer: normalizeRecordRosterRows,
      fallbackValue: [],
    });
    if (cached.hit) {
      return { hit: true, students: cached.data };
    }
  }

  try {
    const cacheDocId = buildRecordRosterCacheDocId(schoolId, classId, normalizedSessionId);
    const cacheSnap = await instrumentFirestoreRead(
      getDoc(doc(firestore, "recordRosterCaches", cacheDocId)),
      {
        screen: "RecordDashboard",
        action: "record_roster_cache_read",
        target: `recordRosterCaches/${cacheDocId}`,
      }
    );
    if (!cacheSnap.exists()) {
      return { hit: false, students: [] };
    }
    const normalizedStudents = normalizeRecordRosterRows(cacheSnap.data()?.students || []);
    writeResolvedRecordCache({
      cacheKey,
      sessionKey,
      data: normalizedStudents,
      ttlMs: CACHE_TTL.recordRosterMs,
    });
    return { hit: true, students: normalizedStudents };
  } catch (error) {
    const code = String(error?.code || "");
    if (!code.includes("permission-denied")) {
      console.warn("Record roster cache read failed:", error?.message || error);
    }
    return { hit: false, students: [] };
  }
};

const syncRecordDashboardRosterCache = async ({
  schoolId,
  classId,
  sessionId,
  students = [],
}) => {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!schoolId || !classId || !normalizedSessionId) {
    return false;
  }

  const normalizedStudents = normalizeRecordRosterRows(students);
  const cacheKey = buildRecordRosterCacheKey({
    schoolId,
    classId,
    sessionId: normalizedSessionId,
  });
  const sessionKey = buildRecordRosterSessionCacheKey({
    schoolId,
    classId,
    sessionId: normalizedSessionId,
  });

  writeResolvedRecordCache({
    cacheKey,
    sessionKey,
    data: normalizedStudents,
    ttlMs: CACHE_TTL.recordRosterMs,
  });

  try {
    const cacheDocId = buildRecordRosterCacheDocId(schoolId, classId, normalizedSessionId);
    await instrumentFirestoreWrite(
      setDoc(
        doc(firestore, "recordRosterCaches", cacheDocId),
        {
          schoolId,
          classId: normalizeClassId(classId),
          classToken: normalizeClassId(classId),
          sessionId: normalizedSessionId,
          students: normalizedStudents,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
      {
        screen: "RecordDashboard",
        action: "record_roster_cache_write",
        target: `recordRosterCaches/${cacheDocId}`,
        count: normalizedStudents.length,
      }
    );
    return true;
  } catch (error) {
    console.warn("Record roster cache write skipped:", error?.message || error);
    return false;
  }
};

const readRecordDashboardScoreCache = async ({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
  bypassLocalCache = false,
}) => {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedTermId = normalizeTermAlias(termId);
  if (!schoolId || !classId || !subjectId || !normalizedSessionId || !normalizedTermId) {
    return { hit: false, scores: {} };
  }

  const cacheKey = buildRecordScoreCacheKey({
    schoolId,
    classId,
    subjectId,
    sessionId: normalizedSessionId,
    termId: normalizedTermId,
  });
  const sessionKey = buildRecordScoreSessionCacheKey({
    schoolId,
    classId,
    subjectId,
    sessionId: normalizedSessionId,
    termId: normalizedTermId,
  });

  if (!bypassLocalCache) {
    const cached = readResolvedRecordCache({
      cacheKey,
      sessionKey,
      normalizer: normalizeRecordScoreMap,
      fallbackValue: {},
    });
    if (cached.hit) {
      return { hit: true, scores: cached.data };
    }
  }

  try {
    const cacheDocId = buildRecordScoreCacheDocId(
      schoolId,
      classId,
      subjectId,
      normalizedSessionId,
      normalizedTermId
    );
    const cacheSnap = await instrumentFirestoreRead(
      getDoc(doc(firestore, "recordScoreCaches", cacheDocId)),
      {
        screen: "RecordDashboard",
        action: "record_score_cache_read",
        target: `recordScoreCaches/${cacheDocId}`,
      }
    );
    if (!cacheSnap.exists()) {
      return { hit: false, scores: {} };
    }
    const normalizedScores = normalizeRecordScoreMap(cacheSnap.data()?.scores || {});
    writeResolvedRecordCache({
      cacheKey,
      sessionKey,
      data: normalizedScores,
      ttlMs: CACHE_TTL.recordScoresMs,
    });
    return { hit: true, scores: normalizedScores };
  } catch (error) {
    const code = String(error?.code || "");
    if (!code.includes("permission-denied")) {
      console.warn("Record score cache read failed:", error?.message || error);
    }
    return { hit: false, scores: {} };
  }
};

const syncRecordDashboardScoreCache = async ({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
  scores = {},
}) => {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedTermId = normalizeTermAlias(termId);
  if (!schoolId || !classId || !subjectId || !normalizedSessionId || !normalizedTermId) {
    return false;
  }

  const normalizedScores = normalizeRecordScoreMap(scores);
  const cacheKey = buildRecordScoreCacheKey({
    schoolId,
    classId,
    subjectId,
    sessionId: normalizedSessionId,
    termId: normalizedTermId,
  });
  const sessionKey = buildRecordScoreSessionCacheKey({
    schoolId,
    classId,
    subjectId,
    sessionId: normalizedSessionId,
    termId: normalizedTermId,
  });

  writeResolvedRecordCache({
    cacheKey,
    sessionKey,
    data: normalizedScores,
    ttlMs: CACHE_TTL.recordScoresMs,
  });

  try {
    const cacheDocId = buildRecordScoreCacheDocId(
      schoolId,
      classId,
      subjectId,
      normalizedSessionId,
      normalizedTermId
    );
    await instrumentFirestoreWrite(
      setDoc(
        doc(firestore, "recordScoreCaches", cacheDocId),
        {
          schoolId,
          classId: normalizeClassId(classId),
          classToken: normalizeClassId(classId),
          subjectId: normalizeSubjectId(subjectId),
          subjectToken: normalizeSubjectAliasToken(subjectId),
          sessionId: normalizedSessionId,
          termId: normalizedTermId,
          scores: normalizedScores,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
      {
        screen: "RecordDashboard",
        action: "record_score_cache_write",
        target: `recordScoreCaches/${cacheDocId}`,
        count: Object.keys(normalizedScores).length,
      }
    );
    return true;
  } catch (error) {
    console.warn("Record score cache write skipped:", error?.message || error);
    return false;
  }
};

const refreshRecordDashboardRosterCacheForScope = async ({
  schoolId,
  classId,
  sessionId,
}) => {
  try {
    const students = await getClassStudents(schoolId, classId, {
      sessionId,
      includeInactive: false,
      includeDeleted: false,
      bypassCache: true,
    });
    await syncRecordDashboardRosterCache({
      schoolId,
      classId,
      sessionId,
      students,
    });
    return students;
  } catch (error) {
    console.warn("Record roster cache refresh skipped:", error?.message || error);
    return [];
  }
};

const refreshRecordDashboardRosterCachesForStudent = async ({
  schoolId,
  studentId,
}) => {
  if (!schoolId || !studentId) return;
  try {
    const enrollmentsSnap = await instrumentFirestoreRead(
      getDocs(
        query(
          collection(firestore, "enrollments"),
          where("schoolId", "==", schoolId),
          where("studentId", "==", String(studentId || "").trim())
        )
      ),
      {
        screen: "ClassDashboard",
        action: "record_roster_cache_refresh_enrollments",
        target: `enrollments:${String(studentId || "").trim()}`,
      }
    );
    const scopes = [...new Set(
      enrollmentsSnap.docs
        .map((item) => {
          const data = item.data() || {};
          const classId = normalizeClassId(data?.classId || "");
          const sessionId = String(data?.sessionId || "").trim();
          return classId && sessionId ? `${classId}__${sessionId}` : "";
        })
        .filter(Boolean)
    )].map((token) => {
      const [classId, sessionId] = token.split("__");
      return { classId, sessionId };
    });
    await Promise.all(
      scopes.map((scope) =>
        refreshRecordDashboardRosterCacheForScope({
          schoolId,
          classId: scope.classId,
          sessionId: scope.sessionId,
        })
      )
    );
  } catch (error) {
    console.warn("Record roster cache refresh skipped:", error?.message || error);
  }
};

export async function getRecordDashboardRoster(
  schoolId,
  classId,
  sessionId,
  options = {}
) {
  const resolvedSessionId = await resolveSession(sessionId || getCurrentSessionId(), schoolId);
  if (!resolvedSessionId) return [];

  const cached = await readRecordDashboardRosterCache({
    schoolId,
    classId,
    sessionId: resolvedSessionId,
    bypassLocalCache: !!options?.bypassLocalCache,
  });
  if (cached.hit) {
    return cached.students;
  }

  const liveStudents = await getClassStudents(schoolId, classId, {
    sessionId: resolvedSessionId,
    termId: options?.termId,
    includeInactive: false,
    includeDeleted: false,
    bypassCache: !!options?.bypassLiveCache,
  });
  void syncRecordDashboardRosterCache({
    schoolId,
    classId,
    sessionId: resolvedSessionId,
    students: liveStudents,
  });
  return liveStudents;
}

export async function getRecordDashboardScores(
  schoolId,
  classId,
  subjectId,
  termId,
  sessionId,
  options = {}
) {
  const resolvedSessionId = await resolveSession(sessionId || getCurrentSessionId(), schoolId);
  if (!resolvedSessionId) return {};
  const resolvedTermId = await resolveTerm(termId || "term1", schoolId);

  const cached = await readRecordDashboardScoreCache({
    schoolId,
    classId,
    subjectId,
    sessionId: resolvedSessionId,
    termId: resolvedTermId,
    bypassLocalCache: !!options?.bypassLocalCache,
  });
  if (cached.hit) {
    return cached.scores;
  }

  const liveScores = await getScores(
    schoolId,
    classId,
    subjectId,
    resolvedTermId,
    resolvedSessionId,
    {
      students: options?.students || [],
      allowLegacyFallback:
        options?.allowLegacyFallback === undefined ? true : options.allowLegacyFallback,
      allowBroadLegacyFallback:
        options?.allowBroadLegacyFallback === undefined
          ? false
          : options.allowBroadLegacyFallback,
      preferContextQueryFirst:
        options?.preferContextQueryFirst === undefined
          ? true
          : options.preferContextQueryFirst,
    }
  );
  void syncRecordDashboardScoreCache({
    schoolId,
    classId,
    subjectId,
    sessionId: resolvedSessionId,
    termId: resolvedTermId,
    scores: liveScores,
  });
  return liveScores;
}

export async function warmRecordDashboardScopeCache({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
}) {
  const students = await getRecordDashboardRoster(schoolId, classId, sessionId, {
    termId,
  });
  const scores = await getRecordDashboardScores(
    schoolId,
    classId,
    subjectId,
    termId,
    sessionId,
    {
      students,
      allowLegacyFallback: true,
      allowBroadLegacyFallback: false,
      preferContextQueryFirst: true,
    }
  );
  return { students, scores };
}

const RECORD_WARM_TTL_MS = 10 * 60 * 1000;
const recordWarmQueue = [];
const queuedRecordWarmTokens = new Set();
const warmedRecordScopeTimestamps = new Map();
let isProcessingRecordWarmQueue = false;

const buildRecordWarmScopeToken = ({
  schoolId,
  classId,
  subjectId,
  sessionId,
  termId,
}) =>
  [
    String(schoolId || "").trim(),
    normalizeClassId(classId),
    normalizeSubjectAliasToken(subjectId),
    String(sessionId || "").trim(),
    normalizeTermAlias(termId),
  ]
    .filter(Boolean)
    .join("__");

const scheduleRecordWarmQueueFlush = (callback) => {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => callback(), { timeout: 1500 });
    return;
  }
  setTimeout(callback, 120);
};

const processRecordWarmQueue = async () => {
  if (isProcessingRecordWarmQueue) return;
  isProcessingRecordWarmQueue = true;
  try {
    while (recordWarmQueue.length > 0) {
      const scope = recordWarmQueue.shift();
      const token = buildRecordWarmScopeToken(scope);
      if (!token) continue;
      try {
        await warmRecordDashboardScopeCache(scope);
        warmedRecordScopeTimestamps.set(token, Date.now());
      } catch (error) {
        console.warn("Record scope warm skipped:", error?.message || error);
      } finally {
        queuedRecordWarmTokens.delete(token);
      }
    }
  } finally {
    isProcessingRecordWarmQueue = false;
    if (recordWarmQueue.length > 0) {
      scheduleRecordWarmQueueFlush(() => {
        void processRecordWarmQueue();
      });
    }
  }
};

export function queueRecordDashboardWarmScopes(
  scopes = [],
  { limit = Number.POSITIVE_INFINITY } = {}
) {
  const normalizedScopes = [];
  (Array.isArray(scopes) ? scopes : [scopes]).forEach((scope) => {
    const normalizedScope = {
      schoolId: String(scope?.schoolId || "").trim(),
      classId: normalizeClassId(scope?.classId),
      subjectId: normalizeSubjectId(scope?.subjectId),
      sessionId: String(scope?.sessionId || "").trim(),
      termId: normalizeTermAlias(scope?.termId),
    };
    const token = buildRecordWarmScopeToken(normalizedScope);
    if (!token) return;
    const lastWarm = Number(warmedRecordScopeTimestamps.get(token) || 0);
    if (Date.now() - lastWarm < RECORD_WARM_TTL_MS) return;
    if (queuedRecordWarmTokens.has(token)) return;
    queuedRecordWarmTokens.add(token);
    normalizedScopes.push(normalizedScope);
  });

  normalizedScopes.slice(0, Math.max(0, Number(limit) || 0)).forEach((scope) => {
    recordWarmQueue.push(scope);
  });

  if (recordWarmQueue.length > 0) {
    scheduleRecordWarmQueueFlush(() => {
      void processRecordWarmQueue();
    });
  }
}

async function persistSubjectCatalogToFirestore(
  schoolId,
  subjects,
  { screen = "AdminConfig" } = {}
) {
  const normalizedCatalog = normalizeSubjectCatalog(subjects);
  const existingSnap = await instrumentFirestoreRead(
    getDocs(query(collection(firestore, "subjects"), where("schoolId", "==", schoolId))),
    {
      screen,
      action: "subject_catalog_query",
      target: `subjects:${schoolId}`,
    }
  );

  const desiredDocs = [
    ...normalizedCatalog.junior.map((subject) => ({
      id: buildSubjectCatalogDocId(schoolId, "junior", subject),
      level: "junior",
      subject,
    })),
    ...normalizedCatalog.senior.map((subject) => ({
      id: buildSubjectCatalogDocId(schoolId, "senior", subject),
      level: "senior",
      subject,
    })),
  ];

  const desiredIds = new Set(desiredDocs.map((entry) => entry.id));
  const batch = writeBatch(firestore);

  desiredDocs.forEach((entry) => {
    batch.set(
      doc(firestore, "subjects", entry.id),
      {
        schoolId,
        subjectId: entry.subject,
        name: entry.subject,
        level: entry.level,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  existingSnap.docs.forEach((row) => {
    if (!desiredIds.has(row.id)) {
      batch.delete(doc(firestore, "subjects", row.id));
    }
  });

  await instrumentFirestoreWrite(batch.commit(), {
    screen,
    action: "subject_catalog_save",
    target: `subjects:${schoolId}`,
    count: desiredDocs.length + existingSnap.docs.filter((row) => !desiredIds.has(row.id)).length,
  });

  writeSubjectCatalogCaches(schoolId, normalizedCatalog);
  return normalizedCatalog;
}

async function maybeSeedSharedSubjectCatalog(schoolId, subjects) {
  const normalizedCatalog = normalizeSubjectCatalog(subjects, { fallbackToDefault: false });
  if (!hasConfiguredSubjects(normalizedCatalog)) {
    return normalizedCatalog;
  }

  const currentUid = String(auth?.currentUser?.uid || "").trim();
  if (!currentUid) {
    return normalizedCatalog;
  }

  const cachedScope = getCachedUserScope(currentUid);
  const scope =
    cachedScope ||
    (await ensureUserScope(currentUid, {
      screen: "Shared",
      action: "subject_catalog_seed_scope",
    }));

  const isAdminForSchool =
    String(scope?.role || "").trim().toLowerCase() === "admin" &&
    String(scope?.schoolId || "").trim() === String(schoolId || "").trim();

  if (!isAdminForSchool) {
    return normalizedCatalog;
  }

  await persistSubjectCatalogToFirestore(schoolId, normalizedCatalog, {
    screen: "Shared",
  });
  return normalizedCatalog;
}

export function getDefaultGradingScale() {
  return {
    A: { min: 70, max: 100 },
    B: { min: 55, max: 69 },
    C: { min: 50, max: 54 },
    D: { min: 45, max: 49 },
    E: { min: 40, max: 44 },
    F: { min: 0, max: 39 },
  };
}

export function normalizeGradingScale(gradingScale = getDefaultGradingScale()) {
  const defaults = getDefaultGradingScale();
  return GRADE_ORDER.reduce((acc, grade) => {
    const fallback = defaults[grade] || { min: 0, max: 0 };
    const current = gradingScale?.[grade] || fallback;
    const min = Number(current?.min);
    const max = Number(current?.max);
    acc[grade] = {
      min: Number.isFinite(min) ? min : Number(fallback.min) || 0,
      max: Number.isFinite(max) ? max : Number(fallback.max) || 0,
    };
    return acc;
  }, {});
}

export function calculateGrade(score, gradingScale = getDefaultGradingScale()) {
  for (const [grade, range] of Object.entries(gradingScale)) {
    if (score >= range.min && score <= range.max) {
      return grade;
    }
  }
  return "F";
}

const toFiniteScore = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const buildScoreAuditSnapshot = (row, gradingScale) => {
  const test1 = toFiniteScore(row?.test1);
  const test2 = toFiniteScore(row?.test2);
  const test3 = toFiniteScore(row?.test3);
  const exam = toFiniteScore(row?.exam);
  const total = roundScore(toFiniteScore(row?.score ?? row?.total));
  return {
    test1,
    test2,
    test3,
    exam,
    total,
    grade: calculateGrade(total, gradingScale),
  };
};

const hasScoreAuditDelta = (before = {}, after = {}) =>
  ["test1", "test2", "test3", "exam", "total", "grade"].some((key) => {
    const prev = before?.[key];
    const next = after?.[key];
    return String(prev ?? "") !== String(next ?? "");
  });

/**
 * Save scores (Firestore, scoped by session + term).
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {string} subject - Subject name
 * @param {Object} scores - Scores object
 */
export async function saveScores(
  schoolId,
  classId,
  subject,
  scores,
  termId,
  sessionId,
  options = {}
) {
  try {
    const shouldLogAudit = options?.audit !== false;
    if (!schoolId || !classId || !subject) return;
    const resolvedSessionId = await resolveSession(sessionId || getCurrentSessionId(), schoolId);
    if (!resolvedSessionId) {
      throw new Error("No active session selected.");
    }
    const resolvedTermId = await resolveTerm(termId || "term1", schoolId);
    const { classId: resolvedClassId, subjectId } = await resolveAuthorizedContextTokens(
      classId,
      subject
    );
    const cacheKey = buildScopedScoreSessionCacheKey({
      schoolId,
      classId,
      subjectId,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
    });
    const termRecord = await validateScoreWriteAccess({
      schoolId,
      classId: resolvedClassId,
      subjectId,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
    });
    let resolvedTermDocId = String(termRecord?.id || "").trim();
    try {
      const settingsSnap = await instrumentFirestoreRead(
        getDoc(doc(firestore, "settings", schoolId)),
        {
          screen: "RecordDashboard",
          action: "resolve_term_doc_from_settings",
          target: `settings/${schoolId}`,
        }
      );
      if (settingsSnap.exists()) {
        const settingsData = settingsSnap.data() || {};
        const activeTermAlias = normalizeTermAlias(settingsData?.activeTermId);
        const activeTermDocId = String(settingsData?.activeTermDocId || "").trim();
        if (
          activeTermAlias &&
          activeTermAlias === normalizeTermAlias(resolvedTermId) &&
          activeTermDocId
        ) {
          resolvedTermDocId = activeTermDocId;
        }
      }
    } catch {
      // Fall back to resolved term document when settings lookup fails.
    }
    const resultConfig = await getResultConfig(schoolId);
    const enabledComponents = getEnabledScoreComponents(resultConfig);
    const configuredGradingScale = getConfiguredGradingScale(
      getGradingScale(schoolId),
      resultConfig
    );

    const liveRosterRows = await queryStudentsInClass({
      schoolId,
      classId: resolvedClassId,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
    });
    const classStudents = liveRosterRows
      .map((row) =>
        mapStudentRecord(
          row?.studentId,
          row?.student || {},
          row?.enrollmentId || row?.enrollment?.enrollmentId || row?.enrollment?.id || "",
          resolvedClassId,
          row?.enrollment || null
        )
      )
      .filter(Boolean);
    const studentNameByStudentId = classStudents.reduce((acc, student) => {
      const studentIdToken = String(student?.id || "").trim();
      if (!studentIdToken) return acc;
      const fullName = String(student?.name || "").trim();
      if (fullName) {
        acc[studentIdToken] = fullName;
      }
      return acc;
    }, {});
    const enrollmentByStudentId = classStudents.reduce((acc, student) => {
      if (student?.id && student?.enrollmentId) {
        acc[String(student.id)] = student.enrollmentId;
      }
      return acc;
    }, {});
    const liveScopeByStudentId = liveRosterRows.reduce((acc, row) => {
      const enrollment = row?.enrollment || null;
      const studentIdToken = String(
        row?.studentId || enrollment?.studentId || row?.student?.id || ""
      ).trim();
      if (!studentIdToken) return acc;
      acc[studentIdToken] = {
        studentId: studentIdToken,
        enrollmentId: String(row?.enrollmentId || enrollment?.id || "").trim(),
        classId: String(row?.classId || enrollment?.classId || resolvedClassId || "").trim(),
        sessionId: String(
          row?.sessionId || enrollment?.sessionId || resolvedSessionId || ""
        ).trim(),
      };
      return acc;
    }, {});

    const scoreEntries = Object.entries(scores || {});
    if (scoreEntries.length === 0) return;

    const writePayloads = [];
    scoreEntries.forEach(([studentId, scoreData]) => {
      const normalizedStudentId = String(studentId || "").trim();
      if (!normalizedStudentId || normalizedStudentId === "undefined") return;

      const liveScope = liveScopeByStudentId[normalizedStudentId] || null;
      const enrollmentId =
        liveScope?.enrollmentId || enrollmentByStudentId[normalizedStudentId];
      if (!enrollmentId) {
        return;
      }

      const normalizedScoreData = {
        test1:
          scoreData?.test1 === "" || scoreData?.test1 === null || scoreData?.test1 === undefined
            ? ""
            : Number(scoreData.test1),
        test2:
          scoreData?.test2 === "" || scoreData?.test2 === null || scoreData?.test2 === undefined
            ? ""
            : Number(scoreData.test2),
        test3:
          scoreData?.test3 === "" || scoreData?.test3 === null || scoreData?.test3 === undefined
            ? ""
            : Number(scoreData.test3),
        exam:
          scoreData?.exam === "" || scoreData?.exam === null || scoreData?.exam === undefined
            ? ""
            : Number(scoreData.exam),
        ltcOverride: normalizeStoredLtcOverride(scoreData?.ltcOverride),
      };
      const hasAnyScoreValue = [
        normalizedScoreData.test1,
        normalizedScoreData.test2,
        normalizedScoreData.test3,
        normalizedScoreData.exam,
        normalizedScoreData.ltcOverride,
      ].some((value) => value !== "");
      if (!hasAnyScoreValue) {
        // Safety rule: empty values should not delete historical scores implicitly.
        // Teachers can overwrite with numeric values; explicit delete flow can be added separately.
        return;
      }

      const rawComponentTotal = enabledComponents.reduce(
        (sum, component) => sum + (Number(normalizedScoreData?.[component.key]) || 0),
        0
      );
      const total = shouldUseLastTermCumulative(resolvedTermId)
        ? normalizedScoreData.ltcOverride === ""
          ? rawComponentTotal
          : roundScore(
              Number(
                buildScoreBreakdown({
                  termId: resolvedTermId,
                  scoreRow: normalizedScoreData,
                  computedLtc: Number(normalizedScoreData.ltcOverride) || 0,
                  resultConfig,
                })?.total
              ) || 0
            )
        : roundScore(
            Number(
              buildScoreBreakdown({
                termId: resolvedTermId,
                scoreRow: normalizedScoreData,
                computedLtc: 0,
                resultConfig,
              })?.total
            ) || 0
          );

      const preferredDocId = buildScoreDocId(enrollmentId, resolvedTermId, subjectId);
      writePayloads.push({
        preferredDocId,
        payload: {
          scoreId: preferredDocId,
          schoolId,
          classId: liveScope?.classId || resolvedClassId,
          classToken: normalizeClassMatchToken(liveScope?.classId || resolvedClassId),
          studentId: liveScope?.studentId || normalizedStudentId,
          enrollmentId,
          sessionId: liveScope?.sessionId || resolvedSessionId,
          termId: resolvedTermId,
          termDocId: resolvedTermDocId || termRecord.id,
          subjectId,
          subjectToken: normalizeSubjectMatchToken(subjectId),
          test1: normalizedScoreData.test1,
          test2: normalizedScoreData.test2,
          test3: normalizedScoreData.test3,
          exam: normalizedScoreData.exam,
          ltcOverride: normalizedScoreData.ltcOverride,
          ...(shouldUseLastTermCumulative(resolvedTermId) &&
          normalizedScoreData.ltcOverride !== ""
            ? {
                lastTermCumulativeCache:
                  roundScore(Number(normalizedScoreData.ltcOverride) || 0),
              }
            : {}),
          score: total,
          updatedAt: serverTimestamp(),
        },
        auditAfter: buildScoreAuditSnapshot(
          {
            test1: normalizedScoreData.test1,
            test2: normalizedScoreData.test2,
            test3: normalizedScoreData.test3,
            exam: normalizedScoreData.exam,
            score: total,
          },
          configuredGradingScale
        ),
        auditScope: {
          sessionId: resolvedSessionId,
          termId: resolvedTermId,
          classId: resolvedClassId,
          studentId: normalizedStudentId,
          subjectId,
          enrollmentId,
        },
      });
    });

    const existingRows = await fetchScoresForContext({
      schoolId,
      classId: resolvedClassId,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
      subjectId,
      allowLegacyFallback: false,
    });
    const existingByPreferredDocId = (existingRows || []).reduce((acc, row) => {
      const preferredId = buildScoreDocId(row?.enrollmentId, resolvedTermId, subjectId);
      if (preferredId) {
        acc[preferredId] = row;
      }
      return acc;
    }, {});
    const baselineRecordScoreCache = buildRecordScoreMapFromRows(existingRows || []);

    const changedWrites = [];
    const batchSetOperations = [];
    writePayloads.forEach((item) => {
      const beforeData = existingByPreferredDocId[item.preferredDocId] || null;
      const auditBefore = beforeData
        ? buildScoreAuditSnapshot(beforeData, configuredGradingScale)
        : undefined;
      if (!hasScoreAuditDelta(auditBefore, item.auditAfter)) {
        return;
      }
      changedWrites.push({
        docId: item.preferredDocId,
        before: auditBefore,
        after: item.auditAfter,
        scope: item.auditScope,
      });
      batchSetOperations.push({
        ref: doc(firestore, "scores", item.preferredDocId),
        data: item.payload,
        options: { merge: true },
      });
    });

    if (batchSetOperations.length > 0) {
      try {
        await commitBatchedSetOperations(batchSetOperations, {
          screen: "RecordDashboard",
          action: "save_scores_batch",
          target: `scores:${resolvedClassId}:${subjectId}:${resolvedTermId}`,
        });
      } catch (batchError) {
        const code = String(batchError?.code || "");
        if (code.includes("permission-denied")) {
          let activeContextNote = "";
          let roleContextNote = "";
          let attemptedContextNote = "";
          try {
            const settingsSnap = await instrumentFirestoreRead(
              getDoc(doc(firestore, "settings", schoolId)),
              {
                screen: "RecordDashboard",
                action: "diagnostic_settings_read",
                target: `settings/${schoolId}`,
              }
            );
            if (settingsSnap.exists()) {
              const settingsData = settingsSnap.data() || {};
              activeContextNote = ` Active context is session "${String(settingsData?.activeSessionId || "").trim()}", term "${String(settingsData?.activeTermId || "").trim()}", termDoc "${String(settingsData?.activeTermDocId || "").trim()}".`;
            }
          } catch {
            // Ignore diagnostics fetch failure.
          }
          try {
            const currentUid = String(auth?.currentUser?.uid || "").trim();
            if (currentUid) {
              const userScope =
                getCachedUserScope(currentUid) ||
                (await loadCurrentUserAccessProfile({
                  screen: "RecordDashboard",
                  action: "diagnostic_user_read",
                }));
              if (userScope?.uid) {
                roleContextNote = ` User role is "${String(userScope?.role || "").trim()}" and user school is "${String(userScope?.schoolId || "").trim()}".`;
              }
            }
          } catch {
            // Ignore diagnostics fetch failure.
          }
          attemptedContextNote = ` Attempted payload used school "${String(schoolId || "").trim()}" and termDoc "${String(resolvedTermDocId || termRecord?.id || "").trim()}".`;
          throw new Error(
            `Permission denied for class "${resolvedClassId}", subject "${subjectId}", session "${resolvedSessionId}", term "${resolvedTermId}".${activeContextNote}${attemptedContextNote}${roleContextNote}`
          );
        }
        throw batchError;
      }
    }

    const savedCount = changedWrites.length;
    const successfulWrites = changedWrites;

    if (shouldLogAudit && successfulWrites.length > 0) {
      const changedRows = successfulWrites
        .filter((auditItem) => hasScoreAuditDelta(auditItem?.before, auditItem?.after))
        .map((auditItem) => ({
          studentId: String(auditItem?.scope?.studentId || "").trim(),
          studentName:
            studentNameByStudentId[String(auditItem?.scope?.studentId || "").trim()] || "",
          before: auditItem?.before || {},
          after: auditItem?.after || {},
        }));

      if (changedRows.length > 0) {
        try {
          await logAuditEvent({
            schoolId,
            action: "score_bulk_upsert",
            entityType: "score_batch",
            entityId: `${resolvedClassId}__${subjectId}__${resolvedSessionId}__${resolvedTermId}__${Date.now()}`,
            scope: {
              sessionId: resolvedSessionId,
              termId: resolvedTermId,
              classId: resolvedClassId,
              subjectId,
            },
            before: {
              studentCount: changedRows.length,
            },
            after: {
              studentCount: changedRows.length,
              students: changedRows.slice(0, 50),
            },
          });
        } catch (auditError) {
          console.warn("Score audit log skipped:", auditError?.message || auditError);
        }
      }
    }

    // Cache in sessionStorage (merge incremental writes to keep a full in-tab snapshot).
    let mergedScores = {};
    try {
      const existingCached = getSessionState(cacheKey);
      mergedScores = existingCached ? JSON.parse(existingCached) : {};
    } catch {
      mergedScores = {};
    }
    Object.entries(scores || {}).forEach(([studentId, scoreData]) => {
      mergedScores[String(studentId)] = {
        ...(mergedScores[String(studentId)] || {}),
        ...(scoreData || {}),
      };
    });
    setSessionState(cacheKey, JSON.stringify(mergedScores));
    invalidateScoreCachesForContext({
      schoolId,
      classId: resolvedClassId,
      subjectId,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
    });
    const nextRecordScoreCache = { ...baselineRecordScoreCache };
    writePayloads.forEach((item) => {
      const studentIdToken = String(item?.payload?.studentId || "").trim();
      if (!studentIdToken) return;
      nextRecordScoreCache[studentIdToken] = normalizeRecordScoreRow({
        ...(nextRecordScoreCache?.[studentIdToken] || {}),
        ...(item?.payload || {}),
      });
    });
    void syncRecordDashboardScoreCache({
      schoolId,
      classId: resolvedClassId,
      subjectId,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
      scores: nextRecordScoreCache,
    });

    if (savedCount === 0 && writePayloads.length > 0 && options?.source === "autosave") {
      return;
    }
  } catch (error) {
    console.error("Error saving scores:", error);
    throw error;
  }
}

/**
 * Get scores (from Firebase)
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {string} subject - Subject name
 */
export async function getScores(
  schoolId,
  classId,
  subject,
  termId,
  sessionId,
  options = {}
) {
  let fallbackSessionScores = null;
  try {
    if (!schoolId || !classId || !subject) return {};
    const resolvedSessionId = await resolveSession(sessionId || getCurrentSessionId(), schoolId);
    if (!resolvedSessionId) return {};
    const resolvedTermId = await resolveTerm(termId || "term1", schoolId);
    const { classId: resolvedClassId, subjectId } = await resolveAuthorizedContextTokens(
      classId,
      subject
    );
    const preferredScoreDocIds = Array.isArray(options?.students)
      ? [...new Set(
          options.students.flatMap((student) => {
            const enrollmentId = String(student?.enrollmentId || "").trim();
            if (!enrollmentId) return [];
            return [buildScoreDocId(enrollmentId, resolvedTermId, subjectId)].filter(Boolean);
          })
        )]
      : [];
    const cacheKey = buildScopedScoreSessionCacheKey({
      schoolId,
      classId,
      subjectId,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
    });
    const cachedSessionScores = getSessionState(cacheKey);
    if (cachedSessionScores) {
      try {
        const parsed =
          typeof cachedSessionScores === "string"
            ? JSON.parse(cachedSessionScores)
            : cachedSessionScores;
        if (parsed && typeof parsed === "object") {
          fallbackSessionScores = parsed;
        }
      } catch {
        fallbackSessionScores = null;
      }
    }
    const scoreMap = {};
    const bestRowByStudent = {};
    const unresolvedEnrollmentIds = new Set();

    const preferContextQueryFirst = options?.preferContextQueryFirst === true;

    let contextRows = [];
    if (preferContextQueryFirst) {
      contextRows = await fetchScoresForContext({
        schoolId,
        classId: resolvedClassId,
        sessionId: resolvedSessionId,
        termId: resolvedTermId,
        subjectId,
        allowLegacyFallback: options?.allowLegacyFallback !== false,
        allowBroadLegacyFallback: options?.allowBroadLegacyFallback !== false,
      });
    }

    const exactRows =
      contextRows.length === 0 && preferredScoreDocIds.length > 0
        ? await fetchScoresByPreferredDocIds({
            schoolId,
            classId: resolvedClassId,
            subjectId,
            sessionId: resolvedSessionId,
            termId: resolvedTermId,
            scoreDocIds: preferredScoreDocIds,
          })
        : [];

    if (!preferContextQueryFirst) {
      contextRows =
        exactRows.length > 0
          ? exactRows
          : await fetchScoresForContext({
              schoolId,
              classId: resolvedClassId,
              sessionId: resolvedSessionId,
              termId: resolvedTermId,
              subjectId,
              allowLegacyFallback: options?.allowLegacyFallback !== false,
              allowBroadLegacyFallback: options?.allowBroadLegacyFallback !== false,
            });
    } else if (contextRows.length === 0 && exactRows.length > 0) {
      contextRows = exactRows;
    }
    contextRows.forEach((row) => {
      const sid = String(row?.studentId || "").trim();
      if (!sid) {
        const enrollmentId = String(row?.enrollmentId || "").trim();
        if (enrollmentId) {
          unresolvedEnrollmentIds.add(enrollmentId);
        }
      }
    });

    let studentIdByEnrollmentId = {};
    if (unresolvedEnrollmentIds.size > 0) {
      const classStudents = await getClassStudents(schoolId, classId, {
        sessionId: resolvedSessionId,
        termId: resolvedTermId,
        includeInactive: true,
        includeDeleted: true,
      });
      studentIdByEnrollmentId = (classStudents || []).reduce((acc, student) => {
        const enrollmentId = String(student?.enrollmentId || "").trim();
        const studentId = String(student?.id || "").trim();
        if (enrollmentId && studentId) {
          acc[enrollmentId] = studentId;
        }
        return acc;
      }, {});
    }

    contextRows.forEach((row) => {
      const enrollmentId = String(row?.enrollmentId || "").trim();
      const sid = String(row?.studentId || studentIdByEnrollmentId[enrollmentId] || "").trim();
      if (!sid) return;
      const currentBest = bestRowByStudent[sid];
      if (!currentBest || toMillis(row?.updatedAt) >= toMillis(currentBest?.updatedAt)) {
        bestRowByStudent[sid] = row;
      }
    });
    Object.entries(bestRowByStudent).forEach(([sid, row]) => {
      scoreMap[sid] = {
        test1: row?.test1 ?? "",
        test2: row?.test2 ?? "",
        test3: row?.test3 ?? "",
        exam: row?.exam ?? "",
        score:
          row?.score === null || row?.score === undefined
            ? row?.total === null || row?.total === undefined
              ? null
              : Number(row?.total) || 0
            : Number(row?.score) || 0,
        ltcOverride: row?.ltcOverride ?? "",
        lastTermCumulativeCache:
          row?.lastTermCumulativeCache === null ||
          row?.lastTermCumulativeCache === undefined
            ? null
            : Number(row?.lastTermCumulativeCache) || 0,
      };
    });

    const liveScoreCount = Object.keys(scoreMap).length;
    const fallbackScoreCount =
      fallbackSessionScores && typeof fallbackSessionScores === "object"
        ? Object.keys(fallbackSessionScores).length
        : 0;

    if (liveScoreCount === 0 && fallbackScoreCount > 0) {
      return fallbackSessionScores;
    }

    // Firestore is authoritative on successful non-empty reads. Session cache is
    // still kept as the warm in-tab source for fast reopen and resilience.
    setSessionState(cacheKey, JSON.stringify(scoreMap));
    return scoreMap;
  } catch (error) {
    const code = String(error?.code || "");
    if (code.includes("permission-denied")) {
      console.warn("Score read blocked by permissions for this context. Falling back to local cache.");
    } else if (code.includes("failed-precondition")) {
      console.warn("Score read index is missing for this context. Falling back to local cache.");
    } else {
      console.error("Error getting scores:", error);
    }
    if (fallbackSessionScores && typeof fallbackSessionScores === "object") {
      return fallbackSessionScores;
    }
    try {
      const resolvedSessionId = await resolveSession(sessionId || getCurrentSessionId(), schoolId);
      const resolvedTermId = await resolveTerm(termId || "term1", schoolId);
      const cacheKey = buildScopedScoreSessionCacheKey({
        schoolId,
        classId,
        subjectId: normalizeSubjectId(subject),
        sessionId: resolvedSessionId,
        termId: resolvedTermId,
      });
      const cached = getSessionState(cacheKey);
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  }
}

const buildResultSelectionStorageKey = (userId = "") => {
  const normalizedUserId = String(userId || "").trim();
  return normalizedUserId ? `resultSelection_${normalizedUserId}` : "resultSelection";
};

export function saveResultSelection(resultData, userId = "") {
  try {
    localStorage.setItem(buildResultSelectionStorageKey(userId), JSON.stringify(resultData));
  } catch (error) {
    console.error("Error saving result selection:", error);
  }
}

export function canonicalizeSubjectForClass(schoolId, classId, subjectValue) {
  const normalizedClassId = normalizeClassId(classId);
  const normalizedSubject = normalizeSubjectId(subjectValue);
  if (!schoolId || !normalizedClassId || !normalizedSubject) {
    return normalizedSubject;
  }

  const classSubjects = getSubjectsByClass(schoolId, normalizedClassId) || [];
  const targetToken = normalizeSubjectMatchToken(normalizedSubject);
  const canonicalSubject = classSubjects.find(
    (item) => normalizeSubjectMatchToken(item) === targetToken
  );
  return canonicalSubject || normalizedSubject;
}

export function canonicalizeResultSelection(resultData, schoolId) {
  const nextSelection = {
    ...(resultData || {}),
    class: normalizeClassId(resultData?.class),
  };
  nextSelection.subject = canonicalizeSubjectForClass(
    schoolId,
    nextSelection.class,
    resultData?.subject
  );
  return nextSelection;
}

export function getResultSelection(userId = "") {
  try {
    const data =
      localStorage.getItem(buildResultSelectionStorageKey(userId)) ||
      localStorage.getItem("resultSelection");
    return data
      ? JSON.parse(data)
      : { class: "", term: "", session: "", subject: "" };
  } catch (error) {
    console.error("Error getting result selection:", error);
    return { class: "", term: "", session: "", subject: "" };
  }
}
export function getRemarkByGrade(grade) {
  const remarks = {
    A: "Excellent",
    B: "Very Good",
    C: "Good",
    D: "Pass",
    E: "Fair",
    F: "Poor",
  };
  return remarks[grade] || "Fair";
}

const CANONICAL_CLASS_IDS = new Set(["jss1", "jss2", "jss3", "sss1", "sss2", "sss3"]);

const toCanonicalClassId = (value) => {
  const token = normalizeClassMatchToken(value);
  if (CANONICAL_CLASS_IDS.has(token)) {
    return token;
  }
  const normalized = normalizeClassId(value);
  return normalized || "";
};

const toTitleCaseWords = (value) =>
  String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const extractLegacySubjectToken = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.includes("__")) {
    const parts = normalized.split("__").filter(Boolean);
    return String(parts[parts.length - 1] || "").trim();
  }
  return normalizeSubjectAliasToken(normalized);
};

const toCanonicalSubjectId = (schoolId, classId, rawSubjectValue) => {
  const normalizedRaw = String(rawSubjectValue || "").trim();
  if (!normalizedRaw) return "";

  const rawToken = extractLegacySubjectToken(normalizedRaw);
  const classSubjects = getSubjectsByClass(schoolId, classId) || [];
  const matchedSubject = classSubjects.find(
    (item) => normalizeSubjectMatchToken(item) === normalizeSubjectAliasToken(rawToken)
  );
  if (matchedSubject) {
    return matchedSubject;
  }

  const aliasToken = normalizeSubjectAliasToken(rawToken);
  if (aliasToken === "basic_science_and_technology") {
    return "Basic Science and Technology";
  }

  if (!normalizedRaw.includes("__")) {
    return normalizeSubjectId(normalizedRaw);
  }

  return toTitleCaseWords(String(rawToken || "").replace(/_/g, " "));
};

/**
 * Save admin settings (to Firebase)
 * @param {Object} settings - Settings object
 * @param {string} schoolId - School ID
 */
export async function saveAdminSettings(settings, schoolId) {
  try {
    if (!schoolId) {
      console.error("schoolId required to save admin settings");
      return;
    }

    const settingsRef = doc(firestore, "settings", schoolId);
    const previousSnapshot = await instrumentFirestoreRead(getDoc(settingsRef), {
      screen: "AdminConfig",
      action: "save_settings_before_read",
      target: `settings/${schoolId}`,
    });
    const previousData = previousSnapshot.exists() ? previousSnapshot.data() || {} : {};
    const normalizedSettings = {
      ...settings,
      schoolId,
      updatedAt: new Date().toISOString(),
      gradingScale: normalizeGradingScale(settings?.gradingScale || getDefaultGradingScale()),
      nextTermBegins: settings?.nextTermBegins || "2026-04-20",
      resultConfig: normalizeResultConfig(settings?.resultConfig || {}),
    };
    await instrumentFirestoreWrite(
      setDoc(settingsRef, normalizedSettings, {
        merge: true,
      }),
      {
        screen: "AdminConfig",
        action: "save_settings_write",
        target: `settings/${schoolId}`,
        count: 1,
      }
    );
    setSessionState(`adminSettings_${schoolId}`, JSON.stringify(normalizedSettings));
    setCachedValue(`admin_settings::${schoolId}`, normalizedSettings, CACHE_TTL.adminSettingsMs);
    invalidateCachePrefix(`result_config::${schoolId}`);
    dispatchSchoolSettingsUpdated({
      schoolId,
      settings: normalizedSettings,
    });

    const summarizeSettingsForAudit = (data) => {
      const normalizedResultConfig = normalizeResultConfig(data?.resultConfig || {});
      return {
        nextTermBegins: String(data?.nextTermBegins || ""),
        activeSessionId: String(data?.activeSessionId || ""),
        activeTermId: String(data?.activeTermId || ""),
        enabledAssessments: normalizedResultConfig.assessments
          .filter((component) => component.enabled !== false)
          .map((component) => component.key),
        enabledGrades: normalizedResultConfig.enabledGrades || [],
      };
    };

    try {
      await logAuditEvent({
        schoolId,
        action: "settings_update",
        entityType: "settings",
        entityId: schoolId,
        actorRole: "admin",
        scope: {
          sessionId: normalizedSettings?.activeSessionId || "",
          termId: normalizedSettings?.activeTermId || "",
        },
        before: summarizeSettingsForAudit(previousData),
        after: summarizeSettingsForAudit({ ...previousData, ...normalizedSettings }),
      });
    } catch (auditError) {
      console.warn("Admin settings audit log skipped:", auditError?.message || auditError);
    }
  } catch (error) {
    console.error("Error saving admin settings:", error);
    throw error;
  }
}

/**
 * Get admin settings (from Firebase)
 * @param {string} schoolId - School ID
 */
export async function getAdminSettings(schoolId) {
  try {
    if (!schoolId) {
      return {
        nextTermBegins: "2026-04-20",
        gradingScale: getDefaultGradingScale(),
        resultConfig: getDefaultResultConfig(),
      };
    }
    
    const memoryCached = getCachedValue(`admin_settings::${schoolId}`);
    if (memoryCached) {
      return {
        ...memoryCached,
        nextTermBegins: memoryCached?.nextTermBegins || "2026-04-20",
        gradingScale: normalizeGradingScale(memoryCached?.gradingScale || getDefaultGradingScale()),
        resultConfig: normalizeResultConfig(memoryCached?.resultConfig || {}),
      };
    }

    // Try session cache first
    const cached = getSessionState(`adminSettings_${schoolId}`);
    if (cached) {
      const parsed = JSON.parse(cached) || {};
      const normalized = {
        ...parsed,
        nextTermBegins: parsed?.nextTermBegins || "2026-04-20",
        gradingScale: normalizeGradingScale(parsed?.gradingScale || getDefaultGradingScale()),
        resultConfig: normalizeResultConfig(parsed?.resultConfig || {}),
      };
      setCachedValue(`admin_settings::${schoolId}`, normalized, CACHE_TTL.adminSettingsMs);
      return normalized;
    }
    
    // Fetch from Firestore settings doc
    const settingsSnapshot = await instrumentFirestoreRead(
      getDoc(doc(firestore, "settings", schoolId)),
      {
        screen: "Shared",
        action: "get_admin_settings",
        target: `settings/${schoolId}`,
      }
    );
    if (settingsSnapshot.exists()) {
      const settings = settingsSnapshot.data() || {};
      const normalized = {
        ...settings,
        nextTermBegins: settings?.nextTermBegins || "2026-04-20",
        gradingScale: normalizeGradingScale(settings?.gradingScale || getDefaultGradingScale()),
        resultConfig: normalizeResultConfig(settings?.resultConfig || {}),
      };
      setSessionState(`adminSettings_${schoolId}`, JSON.stringify(normalized));
      setCachedValue(`admin_settings::${schoolId}`, normalized, CACHE_TTL.adminSettingsMs);
      return normalized;
    }
    
    // Return defaults if not found
    return {
      nextTermBegins: "2026-04-20",
      gradingScale: getDefaultGradingScale(),
      resultConfig: getDefaultResultConfig(),
    };
  } catch (error) {
    console.error("Error getting admin settings:", error);
    return {
      nextTermBegins: "2026-04-20",
      gradingScale: getDefaultGradingScale(),
      resultConfig: getDefaultResultConfig(),
    };
  }
}

export async function getResultConfig(schoolId) {
  try {
    const cached = getCachedValue(`result_config::${schoolId}`);
    if (cached) {
      return normalizeResultConfig(cached || {});
    }
    const settings = await getAdminSettings(schoolId);
    const normalized = normalizeResultConfig(settings?.resultConfig || {});
    setCachedValue(`result_config::${schoolId}`, normalized, CACHE_TTL.resultConfigMs);
    return normalized;
  } catch (error) {
    console.error("Error getting result config:", error);
    return getDefaultResultConfig();
  }
}

/**
 * Save student subject scores (to Firebase)
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {string} studentId - Student ID
 * @param {Object} subjectScores - Subject scores object
 */
export async function saveStudentSubjectScores(schoolId, classId, studentId, subjectScores) {
  try {
    if (!schoolId || !classId || !studentId) return;

    const currentTerm = getCurrentTerm(schoolId) || "term1";
    const currentSessionId = getCurrentSessionId();
    for (const [subject, scoreData] of Object.entries(subjectScores || {})) {
      await saveScores(
        schoolId,
        classId,
        subject,
        { [String(studentId)]: scoreData || {} },
        currentTerm,
        currentSessionId
      );
    }

    setSessionState(`student_scores_${schoolId}_${classId}_${studentId}`, JSON.stringify(subjectScores));
  } catch (error) {
    console.error("Error saving student subject scores:", error);
    throw error;
  }
}

/**
 * Get student subject scores (from Firebase)
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {string} studentId - Student ID
 */
export async function getStudentSubjectScores(schoolId, classId, studentId) {
  try {
    if (!schoolId || !classId || !studentId) return {};
    
    // Try cache first
    const cached = getSessionState(`student_scores_${schoolId}_${classId}_${studentId}`);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // For now, return empty (would need to fetch all scores for student)
    return {};
  } catch (error) {
    console.error("Error getting student subject scores:", error);
    return {};
  }
}

export function getCurrentSessionId() {
  try {
    return localStorage.getItem("currentSessionId") || "";
  } catch (error) {
    console.error("Error getting current session ID:", error);
    return "";
  }
}

// Term Management (Admin Preselection)
/**
 * Save current term (admin preselection)
 * @param {string} schoolId - School ID
 * @param {string} term - Term value (e.g., "term1", "term2", "term3")
 * @param {string} [sessionId] - Optional session ID for scoped term persistence
 */
export function saveTerm(schoolId, term, sessionId) {
  try {
    setSessionState(`currentTerm_${schoolId}`, term);
    localStorage.setItem("currentTermId", String(term || "term1"));
    const resolvedSessionId = String(sessionId || getCurrentSessionId() || "").trim();
    if (resolvedSessionId) {
      setSessionState(`currentTerm_${schoolId}_${resolvedSessionId}`, term);
    }
  } catch (error) {
    console.error("Error saving term:", error);
  }
}

/**
 * Get current term (preselected by admin)
 * @param {string} schoolId - School ID
 * @param {string} [sessionId] - Optional session ID scope
 * @returns {string} Current term value
 */
export function getCurrentTerm(schoolId, sessionId) {
  try {
    const resolvedSessionId = String(sessionId || getCurrentSessionId() || "").trim();
    if (resolvedSessionId) {
      const scopedTerm = getSessionState(`currentTerm_${schoolId}_${resolvedSessionId}`);
      if (scopedTerm) return scopedTerm;
    }
    const globalTerm = localStorage.getItem("currentTermId");
    if (globalTerm) return globalTerm;
    return getSessionState(`currentTerm_${schoolId}`) || "term1";
  } catch (error) {
    console.error("Error getting term:", error);
    return "term1";
  }
}

/**
 * Convert term ID to display name
 * @param {string} termId - Term ID ("term1", "term2", "term3", "1st", "2nd", "3rd")
 * @returns {string} Display name (e.g., "First Term")
 */
export function getTermDisplayName(termId) {
  const termMap = {
    "term1": "First Term",
    "term2": "Second Term",
    "term3": "Third Term",
    "1st": "First Term",
    "2nd": "Second Term",
    "3rd": "Third Term",
  };
  return termMap[termId] || termId;
}

/**
 * Get array of terms with IDs and display names
 * @returns {Array} Array of term objects
 */
export function getTerms() {
  return [
    { id: "term1", label: "First Term" },
    { id: "term2", label: "Second Term" },
    { id: "term3", label: "Third Term" },
  ];
}

// Convert class name to ID (e.g., "JSS 1" -> "jss1")
export function generateClassId(className) {
  return className
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

// Custom Classes Management
export function getCustomClasses(schoolId) {
  try {
    const cached = getSessionState(`customClasses_${schoolId}`);
    if (cached) return JSON.parse(cached);
    // Return default classes if none exist
    return [
      { id: "jss1", label: "JSS 1" },
      { id: "jss2", label: "JSS 2" },
      { id: "jss3", label: "JSS 3" },
      { id: "sss1", label: "SSS 1" },
      { id: "sss2", label: "SSS 2" },
      { id: "sss3", label: "SSS 3" },
    ];
  } catch (error) {
    console.error("Error getting custom classes:", error);
    return [];
  }
}

export function saveCustomClasses(schoolId, classes) {
  try {
    setSessionState(`customClasses_${schoolId}`, JSON.stringify(classes));
  } catch (error) {
    console.error("Error saving custom classes:", error);
  }
}

export function addClass(schoolId, classId, classLabel) {
  const classes = getCustomClasses(schoolId);
  if (!classes.find((c) => c.id === classId)) {
    classes.push({ id: classId, label: classLabel });
    saveCustomClasses(schoolId, classes);
  }
}

export function removeClass(schoolId, classId) {
  const classes = getCustomClasses(schoolId).filter((c) => c.id !== classId);
  saveCustomClasses(schoolId, classes);
}

// Custom Subjects Management
export function getCustomSubjects(schoolId) {
  try {
    const schoolDataCache = readSchoolDataCache(schoolId);
    const sharedCatalog = normalizeSubjectCatalog(schoolDataCache?.subjects, {
      fallbackToDefault: false,
    });
    if (hasConfiguredSubjects(sharedCatalog)) {
      return sharedCatalog;
    }

    const cachedCatalog = readLegacySubjectCatalogCache(schoolId);
    if (hasConfiguredSubjects(cachedCatalog)) {
      return cachedCatalog;
    }

    return createDefaultSubjectCatalog();
  } catch (error) {
    console.error("Error getting custom subjects:", error);
    return createDefaultSubjectCatalog();
  }
}

export async function saveCustomSubjects(schoolId, subjects) {
  try {
    await persistSubjectCatalogToFirestore(schoolId, subjects, {
      screen: "AdminConfig",
    });
  } catch (error) {
    console.error("Error saving custom subjects:", error);
  }
}

export async function addSubject(schoolId, level, subject) {
  const subjects = getCustomSubjects(schoolId);
  const levelKey = level === "junior" ? "junior" : "senior";
  const normalizedSubject = normalizeSubjectId(subject);
  if (normalizedSubject && !subjects[levelKey].includes(normalizedSubject)) {
    subjects[levelKey].push(normalizedSubject);
    subjects[levelKey] = uniqueSubjectNames(subjects[levelKey]);
    await saveCustomSubjects(schoolId, subjects);
  }
}

export async function removeSubject(schoolId, level, subject) {
  const subjects = getCustomSubjects(schoolId);
  const levelKey = level === "junior" ? "junior" : "senior";
  const targetToken = normalizeSubjectMatchToken(subject);
  subjects[levelKey] = subjects[levelKey].filter(
    (item) => normalizeSubjectMatchToken(item) !== targetToken
  );
  await saveCustomSubjects(schoolId, subjects);
}

// Updated getSubjectsByClass to use custom subjects
export function getSubjectsByClass(schoolId, className) {
  const customSubjects = getCustomSubjects(schoolId);
  const normalizedClassName = String(className || "").trim().toLowerCase();
  const juniorClasses = ["jss1", "jss2", "jss3"];
  return juniorClasses.includes(normalizedClassName)
    ? customSubjects.junior
    : customSubjects.senior;
}

// Custom Grading Scale Management
export function saveGradingScale(schoolId, gradingScale) {
  try {
    const settings = getSessionState(`adminSettings_${schoolId}`)
      ? JSON.parse(getSessionState(`adminSettings_${schoolId}`))
      : {};
    settings.gradingScale = normalizeGradingScale(gradingScale);
    settings.resultConfig = normalizeResultConfig(settings?.resultConfig || {});
    setSessionState(`adminSettings_${schoolId}`, JSON.stringify(settings));
  } catch (error) {
    console.error("Error saving grading scale:", error);
  }
}

export function getGradingScale(schoolId) {
  try {
    const settings = getSessionState(`adminSettings_${schoolId}`) ? JSON.parse(getSessionState(`adminSettings_${schoolId}`)) : {};
    return normalizeGradingScale(settings.gradingScale || getDefaultGradingScale());
  } catch (error) {
    console.error("Error getting grading scale:", error);
    return getDefaultGradingScale();
  }
}

/**
 * Get last term cumulative for a student
 * - First Term: No last term (returns null)
 * - Second Term: Total score from First Term
 * - Third Term: Total score from Second Term
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {string} subject - Subject name
 * @param {string} currentTerm - Current term ("term1", "term2", "term3")
 * @param {string|number} studentId - Student ID
 * @param {string} sessionId - Session ID
 * @returns {number|null} Last term cumulative or null if not applicable
 */
async function getTermTotalsByStudent(
  schoolId,
  classId,
  subject,
  termId,
  sessionId,
  cache = new Map(),
  resultConfig = null,
  rosterStudents = null
) {
  const resolvedSessionId = await resolveSession(
    sessionId || getCurrentSessionId(),
    schoolId
  );
  if (!resolvedSessionId) {
    return {};
  }

  const normalizedTermId = normalizeTermAlias(termId);
  const cacheKey = `${schoolId}__${classId}__${subject}__${resolvedSessionId}__${normalizedTermId}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  logLtcDebug("getTermTotalsByStudent:start", {
    schoolId,
    classId,
    subject,
    termId: normalizedTermId,
    sessionId: resolvedSessionId,
  });

  const subjectCandidates = getSubjectQueryCandidates(subject, {
    schoolId,
    classId,
  });
  const preferredScoreDocIds = Array.isArray(rosterStudents)
    ? [...new Set(
        rosterStudents.flatMap((student) => {
          const enrollmentId = String(student?.enrollmentId || "").trim();
          if (!enrollmentId) return [];
          const candidates = [
            normalizeSubjectId(subject),
            ...subjectCandidates,
          ].filter(Boolean);
          return [...new Set(candidates)]
            .map((candidate) => buildScoreDocId(enrollmentId, normalizedTermId, candidate))
            .filter(Boolean);
        })
      )]
    : [];

  const exactRows =
    preferredScoreDocIds.length > 0
      ? await fetchScoresByPreferredDocIds({
          schoolId,
          classId,
          subjectId: subject,
          sessionId: resolvedSessionId,
          termId: normalizedTermId,
          scoreDocIds: preferredScoreDocIds,
        })
      : [];

  const currentRows =
    exactRows.length > 0
      ? exactRows
      : await fetchScoresForContext({
          schoolId,
          classId,
          sessionId: resolvedSessionId,
          termId: normalizedTermId,
          subjectId: subject,
        });
  logTeacherLtcTrace("term_rows_fetched", {
    schoolId,
    classId,
    subject,
    sessionId: resolvedSessionId,
    termId: normalizedTermId,
    rowCount: currentRows?.length || 0,
    sample: (currentRows || []).slice(0, 5).map((row) => ({
      id: row?.id,
      studentId: row?.studentId || "",
      enrollmentId: row?.enrollmentId || "",
      subjectId: row?.subjectId || row?.subject || "",
      subjectToken: row?.subjectToken || "",
      score: row?.score ?? row?.total ?? "",
      test1: row?.test1 ?? "",
      test2: row?.test2 ?? "",
      test3: row?.test3 ?? "",
      exam: row?.exam ?? "",
    })),
  });
  if (!currentRows || currentRows.length === 0) {
    const emptyResult = {};
    logLtcDebug("getTermTotalsByStudent:no_rows", {
      schoolId,
      classId,
      subject,
      termId: normalizedTermId,
      sessionId: resolvedSessionId,
    });
    cache.set(cacheKey, emptyResult);
    return emptyResult;
  }

  const unresolvedEnrollmentIds = new Set();
  currentRows.forEach((row) => {
    const studentId = String(row?.studentId || "").trim();
    if (!studentId) {
      const enrollmentId = String(row?.enrollmentId || "").trim();
      if (enrollmentId) {
        unresolvedEnrollmentIds.add(enrollmentId);
      }
    }
  });

  let studentIdByEnrollmentId = {};
  if (unresolvedEnrollmentIds.size > 0) {
    const classStudents = await getClassStudents(schoolId, classId, {
      sessionId: resolvedSessionId,
      termId: normalizedTermId,
      includeInactive: true,
      includeDeleted: true,
    });
    studentIdByEnrollmentId = (classStudents || []).reduce((acc, student) => {
      const enrollmentId = String(student?.enrollmentId || "").trim();
      const studentId = String(student?.id || "").trim();
      if (enrollmentId && studentId) {
        acc[enrollmentId] = studentId;
      }
      return acc;
    }, {});
  }

  const bestRowByStudent = {};
  currentRows.forEach((row) => {
    const enrollmentId = String(row?.enrollmentId || "").trim();
    const studentId = String(row?.studentId || studentIdByEnrollmentId[enrollmentId] || "").trim();
    if (!studentId) return;
    const currentBest = bestRowByStudent[studentId];
    if (!currentBest || toMillis(row?.updatedAt) >= toMillis(currentBest?.updatedAt)) {
      bestRowByStudent[studentId] = row;
    }
  });

  if (Object.keys(bestRowByStudent).length === 0) {
    const emptyResult = {};
    logLtcDebug("getTermTotalsByStudent:no_best_rows", {
      schoolId,
      classId,
      subject,
      termId: normalizedTermId,
      sessionId: resolvedSessionId,
    });
    cache.set(cacheKey, emptyResult);
    return emptyResult;
  }

  let previousTotalsByStudent = {};
  const previousTermAlias = getPreviousTermAlias(normalizedTermId);
  if (previousTermAlias) {
    previousTotalsByStudent = await getTermTotalsByStudent(
      schoolId,
      classId,
      subject,
      previousTermAlias,
      resolvedSessionId,
      cache
    );
  }

  const totalsByStudent = {};
  Object.entries(bestRowByStudent).forEach(([studentId, scoreRow]) => {
    const storedTotalValue =
      scoreRow?.score ?? scoreRow?.total ?? scoreRow?.aggregate ?? scoreRow?.resultTotal;
    if (
      storedTotalValue !== "" &&
      storedTotalValue !== null &&
      storedTotalValue !== undefined &&
      Number.isFinite(Number(storedTotalValue))
    ) {
      totalsByStudent[String(studentId)] = roundScore(Number(storedTotalValue) || 0);
      return;
    }

    const breakdown = buildScoreBreakdown({
      termId: normalizedTermId,
      scoreRow: {
        test1: scoreRow?.test1 ?? "",
        test2: scoreRow?.test2 ?? "",
        test3: scoreRow?.test3 ?? "",
        exam: scoreRow?.exam ?? "",
        ltcOverride: scoreRow?.ltcOverride ?? "",
      },
      computedLtc: Number(previousTotalsByStudent?.[studentId] || 0),
      resultConfig,
    });
    totalsByStudent[String(studentId)] = roundScore(Number(breakdown?.total) || 0);
  });

  logLtcDebug("getTermTotalsByStudent:resolved_totals", {
    schoolId,
    classId,
    subject,
    termId: normalizedTermId,
    sessionId: resolvedSessionId,
    studentCount: Object.keys(totalsByStudent).length,
    sample: Object.entries(totalsByStudent)
      .slice(0, 5)
      .map(([studentId, total]) => ({ studentId, total })),
  });
  logTeacherLtcTrace("term_totals_resolved", {
    schoolId,
    classId,
    subject,
    sessionId: resolvedSessionId,
    termId: normalizedTermId,
    sample: Object.entries(totalsByStudent).slice(0, 5),
  });
  cache.set(cacheKey, totalsByStudent);
  return totalsByStudent;
}

export async function getLastTermCumulativeMap(
  schoolId,
  classId,
  subject,
  currentTerm,
  sessionId,
  resultConfig = null,
  rosterStudents = null
) {
  try {
    const normalizedCurrentTerm = normalizeTermAlias(currentTerm);
    if (normalizedCurrentTerm === "term1") {
      return {};
    }

    const previousTermAlias = getPreviousTermAlias(normalizedCurrentTerm);
    if (!previousTermAlias) {
      return {};
    }

    const resolvedSessionId = await resolveSession(
      sessionId || getCurrentSessionId(),
      schoolId
    );
    if (!resolvedSessionId) return {};
    const cacheKey = buildLastTermMapCacheKey({
      schoolId,
      classId,
      subjectId: normalizeSubjectId(subject),
      sessionId: resolvedSessionId,
      termId: normalizedCurrentTerm,
    });
    const cached = getCachedValue(cacheKey);
    if (
      cached &&
      typeof cached === "object" &&
      Object.keys(cached).length > 0
    ) {
      return cached;
    }

    const computed = await getTermTotalsByStudent(
      schoolId,
      classId,
      subject,
      previousTermAlias,
      resolvedSessionId,
      new Map(),
      resultConfig,
      rosterStudents
    );
    logTeacherLtcTrace("last_term_map_computed", {
      schoolId,
      classId,
      subject,
      currentTerm: normalizedCurrentTerm,
      previousTermAlias,
      sessionId: resolvedSessionId,
      studentIds: Object.keys(computed || {}),
      sample: Object.entries(computed || {}).slice(0, 5),
    });
    setCachedValue(cacheKey, computed, CACHE_TTL.lastTermMapMs);
    return computed;
  } catch (error) {
    console.error("Error getting last term cumulative map:", error);
    return {};
  }
}

export async function getLastTermCumulative(
  schoolId,
  classId,
  subject,
  currentTerm,
  studentId,
  sessionId
) {
  try {
    const normalizedCurrentTerm = normalizeTermAlias(currentTerm);
    if (normalizedCurrentTerm === "term1") {
      return null; // No last term for First Term
    }

    const normalizedStudentId = String(studentId || "").trim();
    if (!normalizedStudentId) {
      return 0;
    }

    const previousTermAlias = getPreviousTermAlias(normalizedCurrentTerm);
    if (!previousTermAlias) {
      return 0;
    }

    const previousTotalsByStudent = await getLastTermCumulativeMap(
      schoolId,
      classId,
      subject,
      normalizedCurrentTerm,
      sessionId,
      await getResultConfig(schoolId)
    );
    const resolvedValue = roundScore(Number(previousTotalsByStudent?.[normalizedStudentId] || 0));
    logLtcDebug("getLastTermCumulative:student", {
      schoolId,
      classId,
      subject,
      currentTerm: normalizedCurrentTerm,
      previousTermAlias,
      sessionId,
      studentId: normalizedStudentId,
      value: resolvedValue,
    });
    return resolvedValue;
  } catch (error) {
    console.error("Error getting last term cumulative:", error);
    return 0;
  }
}

export async function getSubjectScoreSnapshot(
  schoolId,
  classId,
  subject,
  term,
  session
) {
  try {
    const resolvedSessionId = await resolveSession(
      session || getCurrentSessionId(),
      schoolId
    );
    if (!resolvedSessionId) {
      return {
        scoreMap: {},
        rowsByStudent: {},
        classAverage: 0,
        highestScore: 0,
        lowestScore: 0,
        positionByStudent: {},
        resultConfig: getDefaultResultConfig(),
      };
    }

    const resolvedTermId = await resolveTerm(term || "term1", schoolId);
    const normalizedTermId = normalizeTermAlias(resolvedTermId);
    const cacheKey = buildSubjectSnapshotCacheKey({
      schoolId,
      classId,
      subjectId: normalizeSubjectId(subject),
      sessionId: resolvedSessionId,
      termId: normalizedTermId,
    });
    const cachedSnapshot = getCachedValue(cacheKey);
    if (cachedSnapshot) {
      return cachedSnapshot;
    }
    const resultConfig = await getResultConfig(schoolId);
    const currentRows = await fetchScoresForClassTerm({
      schoolId,
      classId,
      sessionId: resolvedSessionId,
      termId: normalizedTermId,
      subjectIds: [subject],
      options: {
        screen: "Shared",
        action: "subject_snapshot_scores_query",
      },
    });
    const groupedRowsBySubject = groupBestScoreRowsBySubjectAndStudent(currentRows);
    const subjectToken = normalizeSubjectMatchToken(subject);
    let previousTotalsBySubject = {};
    const previousTermAlias = getPreviousTermAlias(normalizedTermId);
    if (previousTermAlias) {
      previousTotalsBySubject = await getClassSubjectTotalsByTerm(
        schoolId,
        classId,
        previousTermAlias,
        resolvedSessionId,
        resultConfig,
        new Map(),
        { subjectIds: [subject] }
      );
    }

    const snapshotPayload = buildSubjectScoreSnapshotFromRows({
      termId: normalizedTermId,
      rowsByStudent: groupedRowsBySubject?.[subjectToken] || {},
      previousTotalsByStudent: previousTotalsBySubject?.[subjectToken] || {},
      resultConfig,
    });
    setCachedValue(cacheKey, snapshotPayload, CACHE_TTL.subjectSnapshotMs);
    return snapshotPayload;
  } catch (error) {
    console.error("Error building subject score snapshot:", error);
    return {
      scoreMap: {},
      rowsByStudent: {},
      classAverage: 0,
      highestScore: 0,
      lowestScore: 0,
      positionByStudent: {},
      resultConfig: getDefaultResultConfig(),
    };
  }
}

// Get class average for a subject in a term
export async function getClassAverage(schoolId, classId, subject, term, session) {
  try {
    const snapshot = await getSubjectScoreSnapshot(
      schoolId,
      classId,
      subject,
      term,
      session
    );
    return Number(snapshot?.classAverage || 0);
  } catch (error) {
    console.error("Error calculating class average:", error);
    return 0;
  }
}

// Get student's position (rank) in class for a subject
export async function getStudentPosition(schoolId, classId, subject, term, session, studentId) {
  try {
    const snapshot = await getSubjectScoreSnapshot(
      schoolId,
      classId,
      subject,
      term,
      session
    );
    const studentIdStr = String(studentId || "").trim();
    return Number(snapshot?.positionByStudent?.[studentIdStr] || 0);
  } catch (error) {
    console.error("Error getting student position:", error);
    return 0;
  }
}
/**
 * Student lifecycle helpers.
 */
export async function withdrawStudent(schoolId, studentId) {
  if (!schoolId || !studentId) {
    throw new Error("schoolId and studentId are required");
  }
  await instrumentFirestoreWrite(
    setDoc(
      doc(firestore, "students", String(studentId)),
      {
        schoolId,
        status: "withdrawn",
        isDeleted: false,
        deletedAt: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ),
    {
      screen: "ClassDashboard",
      action: "withdraw_student",
      target: `students/${String(studentId)}`,
      count: 1,
    }
  );
  void refreshRecordDashboardRosterCachesForStudent({ schoolId, studentId });
  return { success: true };
}

export async function graduateStudent(schoolId, studentId) {
  if (!schoolId || !studentId) {
    throw new Error("schoolId and studentId are required");
  }
  await setDoc(
    doc(firestore, "students", String(studentId)),
    {
      schoolId,
      status: "graduated",
      isDeleted: false,
      deletedAt: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  void refreshRecordDashboardRosterCachesForStudent({ schoolId, studentId });
  return { success: true };
}

export async function archiveStudent(schoolId, studentId) {
  if (!schoolId || !studentId) {
    throw new Error("schoolId and studentId are required");
  }
  await setDoc(
    doc(firestore, "students", String(studentId)),
    {
      schoolId,
      status: "archived",
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  void refreshRecordDashboardRosterCachesForStudent({ schoolId, studentId });
  return { success: true };
}

export async function restoreStudent(schoolId, studentId) {
  if (!schoolId || !studentId) {
    throw new Error("schoolId and studentId are required");
  }
  await setDoc(
    doc(firestore, "students", String(studentId)),
    {
      schoolId,
      status: "active",
      isDeleted: false,
      deletedAt: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  void refreshRecordDashboardRosterCachesForStudent({ schoolId, studentId });
  return { success: true };
}

export async function canDeleteStudentSafely(schoolId, studentId) {
  if (!schoolId || !studentId) {
    return {
      canDelete: false,
      reason: "schoolId and studentId are required",
    };
  }

  // Guard: students with any score history cannot be hard-deleted.
  const enrollmentsSnap = await instrumentFirestoreRead(
    getDocs(
      query(
        collection(firestore, "enrollments"),
        where("schoolId", "==", schoolId),
        where("studentId", "==", String(studentId))
      )
    ),
    {
      screen: "ClassDashboard",
      action: "delete_guard_read_enrollments",
      target: `students/${String(studentId)}`,
    }
  );
  const enrollmentIds = enrollmentsSnap.docs.map((item) => item.id);
  const chunks = chunkArray(enrollmentIds, 30);
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    let scoreExistsSnap;
    try {
      scoreExistsSnap = await instrumentFirestoreRead(
        getDocs(
          query(
            collection(firestore, "scores"),
            where("schoolId", "==", schoolId),
            where("enrollmentId", "in", chunk)
          )
        ),
        {
          screen: "ClassDashboard",
          action: "delete_guard_read_scores",
          target: `scores:${String(studentId)}`,
        }
      );
    } catch {
      let foundScore = false;
      for (const enrollmentId of chunk) {
        const singleSnap = await instrumentFirestoreRead(
          getDocs(
            query(
              collection(firestore, "scores"),
              where("schoolId", "==", schoolId),
              where("enrollmentId", "==", String(enrollmentId || ""))
            )
          ),
          {
            screen: "ClassDashboard",
            action: "delete_guard_read_scores_fallback",
            target: `scores:${String(studentId)}`,
          }
        );
        if (!singleSnap.empty) {
          foundScore = true;
          break;
        }
      }
      scoreExistsSnap = {
        empty: !foundScore,
      };
    }
    if (!scoreExistsSnap.empty) {
      return {
        canDelete: false,
        reason: "Student has academic records. Use withdraw instead.",
      };
    }
  }

  return {
    canDelete: true,
    reason: "",
  };
}

export async function removeStudentFromSession(schoolId, studentId, sessionId, classId) {
  if (!schoolId || !studentId || !sessionId) {
    return { removed: 0 };
  }
  const resolvedSessionId = await resolveSession(sessionId, schoolId);
  if (!resolvedSessionId) {
    return { removed: 0 };
  }

  const enrollmentsSnap = await instrumentFirestoreRead(
    getDocs(
      query(
        collection(firestore, "enrollments"),
        where("schoolId", "==", schoolId),
        where("studentId", "==", String(studentId)),
        where("sessionId", "==", resolvedSessionId)
      )
    ),
    {
      screen: "ClassDashboard",
      action: "remove_student_session_read_enrollments",
      target: `enrollments:${resolvedSessionId}`,
    }
  );
  const matches = enrollmentsSnap.docs.filter((item) => {
    if (!classId) return true;
    return String(item.data()?.classId || "") === String(classId);
  });
  if (matches.length === 0) return { removed: 0 };

  const batch = writeBatch(firestore);
  matches.forEach((item) => batch.delete(item.ref));
  await instrumentFirestoreWrite(batch.commit(), {
    screen: "ClassDashboard",
    action: "remove_student_session_commit",
    target: `enrollments:${resolvedSessionId}`,
    count: matches.length,
  });
  const impactedClassIds = [...new Set(matches.map((item) => String(item.data()?.classId || classId || "").trim()).filter(Boolean))];
  impactedClassIds.forEach((impactedClassId) => {
    invalidateStudentCachesForClass({
      schoolId,
      classId: impactedClassId,
      sessionId: resolvedSessionId,
    });
  });
  void Promise.all(
    impactedClassIds.map((impactedClassId) =>
      refreshRecordDashboardRosterCacheForScope({
        schoolId,
        classId: impactedClassId,
        sessionId: resolvedSessionId,
      })
    )
  );
  try {
    await applySchoolCountDelta(schoolId, {
      enrollments: -Math.max(0, matches.length),
    });
  } catch (countError) {
    const countCode = String(countError?.code || "");
    if (!countCode.includes("permission-denied")) {
      console.warn("Enrollment count delta failed:", countError?.message || countError);
    }
  }
  return { removed: matches.length };
}

export async function deleteStudentRecord(schoolId, studentId) {
  if (!schoolId || !studentId) {
    throw new Error("schoolId and studentId are required");
  }
  const guard = await canDeleteStudentSafely(schoolId, studentId);
  if (!guard?.canDelete) {
    throw new Error(guard?.reason || "Student cannot be deleted");
  }

  const enrollmentsSnap = await instrumentFirestoreRead(
    getDocs(
      query(
        collection(firestore, "enrollments"),
        where("schoolId", "==", schoolId),
        where("studentId", "==", String(studentId))
      )
    ),
    {
      screen: "ClassDashboard",
      action: "delete_student_read_enrollments",
      target: `students/${String(studentId)}`,
    }
  );

  const batch = writeBatch(firestore);
  enrollmentsSnap.docs.forEach((item) => batch.delete(item.ref));
  batch.delete(doc(firestore, "students", String(studentId)));
  await instrumentFirestoreWrite(batch.commit(), {
    screen: "ClassDashboard",
    action: "delete_student_commit",
    target: `students/${String(studentId)}`,
    count: enrollmentsSnap.size + 1,
  });
  const impactedScopes = enrollmentsSnap.docs.reduce((acc, item) => {
    const data = item.data() || {};
    const classId = String(data?.classId || "").trim();
    const sessionId = String(data?.sessionId || "").trim();
    if (classId && sessionId) {
      acc.push({ classId, sessionId });
    }
    return acc;
  }, []);
  impactedScopes.forEach(({ classId, sessionId }) => {
    invalidateStudentCachesForClass({
      schoolId,
      classId,
      sessionId,
    });
  });
  void Promise.all(
    impactedScopes.map(({ classId, sessionId }) =>
      refreshRecordDashboardRosterCacheForScope({
        schoolId,
        classId,
        sessionId,
      })
    )
  );
  try {
    await applySchoolCountDelta(schoolId, {
      students: -1,
      enrollments: -Math.max(0, enrollmentsSnap.size),
    });
  } catch (countError) {
    const countCode = String(countError?.code || "");
    if (!countCode.includes("permission-denied")) {
      console.warn("Student count delta failed:", countError?.message || countError);
    }
  }
  return { success: true, removedEnrollments: enrollmentsSnap.size };
}

/**
 * Cleanup malformed score rows for a school.
 * Removes entries keyed by "undefined" or with studentId === "undefined".
 * @param {string} schoolId - School ID
 * Also normalizes legacy score docs into canonical class/subject/session/term fields
 * so teacher-scoped reads can use the same rows as admin.
 * @returns {Promise<{removed:number, normalized:number}>}
 */
export async function cleanupMalformedScores(schoolId) {
  try {
    if (!schoolId) return { removed: 0, normalized: 0 };

    const currentUid = String(auth?.currentUser?.uid || "").trim();
    const cleanupCacheKey = `score_cleanup_v4_${schoolId}_${currentUid || "anonymous"}`;
    try {
      const lastRun = Number(getSessionState(cleanupCacheKey) || 0);
      if (Date.now() - lastRun < 24 * 60 * 60 * 1000) {
        return { removed: 0, normalized: 0 };
      }
    } catch {
      // no-op
    }

    const sessionsSnap = await getDocs(
      query(collection(firestore, "sessions"), where("schoolId", "==", schoolId))
    );
    const sessions = sessionsSnap.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }));
    const sessionIdByNameToken = sessions.reduce((acc, item) => {
      const sessionId = String(item?.sessionId || item?.id || "").trim();
      const sessionNameToken = String(item?.name || "").replace(/\s+/g, "").toLowerCase();
      if (sessionId && sessionNameToken) {
        acc[sessionNameToken] = sessionId;
      }
      return acc;
    }, {});

    const scoreDocsById = new Map();
    const canonicalScoreSnap = await getDocs(
      query(collection(firestore, "scores"), where("schoolId", "==", schoolId))
    );
    canonicalScoreSnap.docs.forEach((item) => {
      scoreDocsById.set(item.id, item);
    });

    const malformedRefs = [];
    const normalizedWrites = [];

    scoreDocsById.forEach((item) => {
      const data = item.data() || {};
      const docId = String(item.id || "").toLowerCase();
      const studentId = String(data?.studentId || "").trim();
      const enrollmentId = String(data?.enrollmentId || "").trim();
      if (
        docId.includes("undefined") ||
        studentId === "undefined" ||
        enrollmentId === "undefined"
      ) {
        malformedRefs.push(item.ref);
        return;
      }

      const rawSessionId = String(data?.sessionId || "").trim();
      const rawSessionName = String(data?.session || "").replace(/\s+/g, "").toLowerCase();
      const resolvedSessionId = rawSessionId || sessionIdByNameToken[rawSessionName] || "";
      const rawClassValue = data?.classId || data?.class || "";
      const resolvedClassId = toCanonicalClassId(rawClassValue);
      const resolvedSubjectId = toCanonicalSubjectId(
        schoolId,
        resolvedClassId,
        data?.subjectId || data?.subject || ""
      );
      const resolvedTermId = normalizeTermAlias(data?.termId || data?.term || "");

      const patch = {};
      if (String(data?.schoolId || "").trim() !== String(schoolId)) {
        patch.schoolId = schoolId;
      }
      if (resolvedSessionId && rawSessionId !== resolvedSessionId) {
        patch.sessionId = resolvedSessionId;
      }
      if (resolvedClassId && String(data?.classId || "").trim() !== resolvedClassId) {
        patch.classId = resolvedClassId;
      }
      if (resolvedSubjectId && String(data?.subjectId || "").trim() !== resolvedSubjectId) {
        patch.subjectId = resolvedSubjectId;
      }
      if (resolvedTermId && normalizeTermAlias(data?.termId || "") !== resolvedTermId) {
        patch.termId = resolvedTermId;
      }

      if (Object.keys(patch).length > 0) {
        normalizedWrites.push({
          ref: item.ref,
          data: patch,
        });
      }
    });

    let removedCount = 0;
    if (malformedRefs.length > 0) {
      try {
        for (const refsChunk of chunkArray(malformedRefs, 350)) {
          const batch = writeBatch(firestore);
          refsChunk.forEach((ref) => batch.delete(ref));
          await batch.commit();
          removedCount += refsChunk.length;
        }
      } catch (deleteError) {
        console.warn(
          "Malformed score delete skipped during cleanup:",
          deleteError?.message || deleteError
        );
      }
    }

    let normalizedCount = 0;
    if (normalizedWrites.length > 0) {
      for (const writesChunk of chunkArray(normalizedWrites, 350)) {
        try {
          const batch = writeBatch(firestore);
          writesChunk.forEach((entry) => batch.set(entry.ref, entry.data, { merge: true }));
          await batch.commit();
          normalizedCount += writesChunk.length;
        } catch (normalizeBatchError) {
          console.warn(
            "Score normalization batch fell back to per-doc updates:",
            normalizeBatchError?.message || normalizeBatchError
          );
          for (const entry of writesChunk) {
            try {
              await setDoc(entry.ref, entry.data, { merge: true });
              normalizedCount += 1;
            } catch (normalizeDocError) {
              console.warn(
                "Score normalization skipped for one doc:",
                normalizeDocError?.message || normalizeDocError
              );
            }
          }
        }
      }
    }

    try {
      setSessionState(cleanupCacheKey, String(Date.now()));
    } catch {
      // no-op
    }

    return {
      removed: removedCount,
      normalized: normalizedCount,
    };
  } catch (error) {
    console.warn("Score cleanup failed internally:", error?.message || error);
    return { removed: 0, normalized: 0 };
  }
}
