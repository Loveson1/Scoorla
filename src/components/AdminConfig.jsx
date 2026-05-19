import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  getCustomClasses,
  addClass,
  removeClass,
  getCustomSubjects,
  addSubject,
  removeSubject,
  getConfiguredGradingScale,
  getDefaultResultConfig,
  normalizeGradingScale,
  getSchoolData,
  getGradingScale,
  getAdminSettings,
  normalizeResultConfig,
  saveSchoolData,
  saveGradingScale,
  saveAdminSettings,
  generateClassId,
} from "./utils/school-data";
import {
  advanceToNextTerm,
  correctInitialAcademicCycle,
  getAcademicCycleEditStatus,
  setActiveSession,
  listSessions,
} from "../utils/firestoreService";
import { getCurrentUser, getUserSchoolId } from "../utils/authUtils";
import { useSessionContext } from "../context/SessionContext";
import {
  archiveSession,
  listSessionsWithCounts,
  promoteToNewSession,
  previewPromotionImpact,
} from "../utils/adminSessionUtils";
import { cleanupAuditLogs, getRecentAuditLogs } from "../services/auditLogService";
import {
  listRecentBackups,
  requestHistoricalRestore,
} from "../services/backupService";
import SessionListPanel from "./session/SessionListPanel";
import PromotionConfirmModal from "./session/PromotionConfirmModal";
import TeacherManagementPanel from "./TeacherManagementPanel";
import {
  getDefaultClassStructure,
  normalizeClassStructure,
} from "../utils/departmentUtils";

const formatClassDisplay = (classId) => {
  const raw = String(classId || "").trim();
  if (!raw) return raw;
  const matched = raw.match(/^([a-zA-Z]+)\s*(\d+)$/);
  if (matched) {
    return `${matched[1].toUpperCase()} ${matched[2]}`;
  }
  return raw.toUpperCase();
};

const parseSessionYears = (sessionName) => {
  const match = String(sessionName || "").trim().match(/^(\d{4})\s*\/\s*(\d{4})$/);
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
  return { startYear, endYear };
};

const normalizeWhitespace = (value) =>
  String(value || "").replace(/\s+/g, " ").trim();

const validateSchoolProfileFields = (form) => {
  const nextErrors = {};
  const trimmedName = normalizeWhitespace(form?.name);
  const trimmedAddress = normalizeWhitespace(form?.address);
  const trimmedEmail = normalizeWhitespace(form?.email).toLowerCase();
  const trimmedPhone = normalizeWhitespace(form?.phone);
  const trimmedMotto = normalizeWhitespace(form?.motto);
  const validTextRegex = /^[a-zA-Z0-9\s.,&'()\-/:]+$/;

  if (!trimmedName) {
    nextErrors.name = "School name is required.";
  } else if (trimmedName.length < 3 || trimmedName.length > 100) {
    nextErrors.name = "School name must be between 3 and 100 characters.";
  } else if (!validTextRegex.test(trimmedName)) {
    nextErrors.name = "School name contains invalid characters.";
  }

  if (!trimmedAddress) {
    nextErrors.address = "School address is required.";
  } else if (trimmedAddress.length < 5 || trimmedAddress.length > 200) {
    nextErrors.address = "Address must be between 5 and 200 characters.";
  } else if (!validTextRegex.test(trimmedAddress)) {
    nextErrors.address = "Address contains invalid characters.";
  }

  if (!trimmedEmail) {
    nextErrors.email = "School email is required.";
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(trimmedEmail)) {
      nextErrors.email = "Enter a valid email address.";
    }
  }

  if (!trimmedPhone) {
    nextErrors.phone = "School phone number is required.";
  } else if (!/^[\d\s+()-]+$/.test(trimmedPhone)) {
    nextErrors.phone = "Enter a valid phone number.";
  } else {
    const digits = trimmedPhone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      nextErrors.phone = "Phone number must contain 10 to 15 digits.";
    }
  }

  if (!trimmedMotto) {
    nextErrors.motto = "School motto is required.";
  } else if (trimmedMotto.length < 3 || trimmedMotto.length > 150) {
    nextErrors.motto = "Motto must be between 3 and 150 characters.";
  } else if (!validTextRegex.test(trimmedMotto)) {
    nextErrors.motto = "Motto contains invalid characters.";
  }

  return nextErrors;
};

const validateAcademicCycleFields = (sessionName, termAlias) => {
  const nextErrors = {};
  const trimmedSessionName = normalizeWhitespace(sessionName);
  const normalizedTerm = String(termAlias || "").trim();

  if (!trimmedSessionName) {
    nextErrors.startingSessionName = "Academic session is required.";
  } else {
    const parsed = parseSessionYears(trimmedSessionName);
    if (!parsed) {
      nextErrors.startingSessionName = "Use session format YYYY/YYYY.";
    } else if (parsed.endYear !== parsed.startYear + 1) {
      nextErrors.startingSessionName = "Session years must be consecutive.";
    } else if (parsed.startYear < 2025) {
      nextErrors.startingSessionName = "Session must be 2025/2026 or later.";
    }
  }

  if (!["term1", "term2", "term3"].includes(normalizedTerm)) {
    nextErrors.startingTermAlias = "Select a valid term.";
  }

  return nextErrors;
};

const formatAuditTimestamp = (value) => {
  if (!value) return "-";
  const date =
    typeof value?.toDate === "function"
      ? value.toDate()
      : new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const formatTermForAudit = (termId) => {
  const normalized = String(termId || "").trim().toLowerCase();
  if (normalized === "term1") return "First Term";
  if (normalized === "term2") return "Second Term";
  if (normalized === "term3") return "Third Term";
  return termId || "-";
};

const formatShortId = (value, headLength = 6) => {
  const token = String(value || "").trim();
  if (!token) return "";
  if (token.length <= headLength + 2) return token;
  return `${token.slice(0, headLength)}...`;
};

const formatAuditScopeSummary = (scope = {}, sessionNameById = {}) => {
  const parts = [];
  if (scope?.classId) parts.push(`Class: ${formatClassDisplay(scope.classId)}`);
  if (scope?.subjectId) parts.push(`Subject: ${scope.subjectId}`);
  if (scope?.termId) parts.push(`Term: ${formatTermForAudit(scope.termId)}`);
  if (scope?.sessionId) {
    const rawSessionId = String(scope?.sessionId || "").trim();
    const knownSessionName = String(sessionNameById?.[rawSessionId] || "").trim();
    parts.push(`Session: ${knownSessionName || formatShortId(rawSessionId, 10)}`);
  }
  if (scope?.studentId) parts.push(`Student: ${formatShortId(scope.studentId)}`);
  return parts.join(" | ") || "-";
};

const formatAuditActionLabel = (action) => {
  const normalized = String(action || "").trim();
  const labels = {
    score_bulk_upsert: "Scores Updated",
    score_upsert: "Single Score Updated",
    session_switch: "Active Session Changed",
    term_switch: "Active Term Changed",
    promotion: "Students Promoted",
    settings_update: "Settings Updated",
  };
  return labels[normalized] || normalized || "-";
};

const getChangedScoreFieldLabels = (before = {}, after = {}) => {
  const keyToLabel = {
    test1: "T1",
    test2: "T2",
    test3: "T3",
    exam: "Exam",
    total: "Total",
    grade: "Grade",
  };
  return Object.entries(keyToLabel)
    .filter(([key]) => String(before?.[key] ?? "") !== String(after?.[key] ?? ""))
    .map(([, label]) => label);
};

const formatAuditDetails = (entry) => {
  const action = String(entry?.action || "").trim();
  const deltaAfter = entry?.delta?.after || {};
  const deltaBefore = entry?.delta?.before || {};
  const scope = entry?.scope || {};

  if (action === "score_bulk_upsert") {
    const count =
      Number(deltaAfter?.studentCount) ||
      Number(deltaBefore?.studentCount) ||
      0;
    const rows = Array.isArray(deltaAfter?.students) ? deltaAfter.students : [];
    const sampleStudents = rows
      .map((row) => {
        const studentName = String(row?.studentName || "").trim();
        if (studentName) return studentName;
        return formatShortId(String(row?.studentId || "").trim());
      })
      .filter(Boolean)
      .slice(0, 3);
    const changedFieldLabels = Array.from(
      new Set(
        rows.flatMap((row) => getChangedScoreFieldLabels(row?.before || {}, row?.after || {}))
      )
    );
    const changedFieldsText = changedFieldLabels.length
      ? ` Fields: ${changedFieldLabels.join(", ")}.`
      : "";
    const sampleText = sampleStudents.length ? ` Sample: ${sampleStudents.join(", ")}.` : "";
    return `Updated ${count} student score row${count === 1 ? "" : "s"}.${changedFieldsText}${sampleText}`;
  }

  if (action === "score_upsert") {
    const changedFieldLabels = getChangedScoreFieldLabels(deltaBefore, deltaAfter);
    const targetStudent = String(scope?.studentId || "").trim();
    const studentText = targetStudent ? ` Student ${formatShortId(targetStudent)}.` : "";
    const changedText = changedFieldLabels.length
      ? ` Fields: ${changedFieldLabels.join(", ")}.`
      : "";
    return `Updated one score row.${studentText}${changedText}`;
  }

  if (action === "promotion") {
    const promoted = Number(deltaAfter?.promoted || 0);
    const skipped = Number(deltaAfter?.skipped || 0);
    return `Promoted ${promoted} students, skipped ${skipped}.`;
  }

  if (action === "session_switch" || action === "term_switch") {
    const beforeTerm = String(deltaBefore?.activeTermId || "").trim();
    const afterTerm = String(deltaAfter?.activeTermId || "").trim();
    const beforeSession = String(deltaBefore?.activeSessionId || "").trim();
    const afterSession = String(deltaAfter?.activeSessionId || "").trim();
    return `From ${formatShortId(beforeSession, 10) || "-"} / ${formatTermForAudit(beforeTerm)} to ${formatShortId(afterSession, 10) || "-"} / ${formatTermForAudit(afterTerm)}.`;
  }

  return "-";
};

const formatBackupTimestamp = (value) => {
  if (!value) return "-";
  const date =
    typeof value?.toDate === "function"
      ? value.toDate()
      : new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const formatBackupTypeLabel = (value) => {
  const normalized = String(value || "").trim();
  if (normalized === "pre_promotion") return "Before Promotion";
  if (normalized === "pre_term_switch") return "Before Term Switch";
  if (normalized === "pre_restore") return "Before Restore";
  return normalized || "-";
};

const toTermAliasToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

export default function AdminConfig() {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const {
    selectedSessionId,
    selectedSessionName,
    selectedTermId,
    activeSessionId,
    activeTermId,
    selectedSessionTerms,
    selectedSessionActiveTermId,
    selectSession,
    selectTerm,
    isHistoricalView,
    isReadOnlyView,
  } = useSessionContext();
  const [activeTab, setActiveTab] = useState("session");
  const [classes, setClasses] = useState([]);
  const [newClassName, setNewClassName] = useState("");
  const [subjects, setSubjects] = useState({ junior: [], senior: [] });
  const [selectedLevel, setSelectedLevel] = useState("junior");
  const [newSubject, setNewSubject] = useState("");
  const [gradingScale, setGradingScale] = useState(getGradingScale());
  const [resultConfig, setResultConfig] = useState(getDefaultResultConfig());
  const [classStructure, setClassStructure] = useState(
    getDefaultClassStructure()
  );
  const [nextTermBegins, setNextTermBegins] = useState("2026-04-20");
  const [schoolId, setSchoolId] = useState(null);
  const [sessionsWithCounts, setSessionsWithCounts] = useState([]);
  const [isSessionBusy, setIsSessionBusy] = useState(false);
  const [isAdvanceTermModalOpen, setIsAdvanceTermModalOpen] = useState(false);
  const [pendingAdvanceTermAlias, setPendingAdvanceTermAlias] = useState("");
  const [isPromotionModalOpen, setIsPromotionModalOpen] = useState(false);
  const [promotionTargetSessionId, setPromotionTargetSessionId] = useState("");
  const [nextSessionNamePreview, setNextSessionNamePreview] = useState("");
  const [promotionImpact, setPromotionImpact] = useState(null);
  const [uiActiveSessionId, setUiActiveSessionId] = useState("");
  const [schoolProfileForm, setSchoolProfileForm] = useState({
    logo: "",
    name: "",
    address: "",
    email: "",
    phone: "",
    motto: "",
    startingSessionName: "",
    startingTermAlias: "term1",
  });
  const [schoolProfileErrors, setSchoolProfileErrors] = useState({});
  const [schoolLogoPreview, setSchoolLogoPreview] = useState("");
  const [isSavingSchoolProfile, setIsSavingSchoolProfile] = useState(false);
  const [isSavingAcademicCycle, setIsSavingAcademicCycle] = useState(false);
  const [isSavingResultConfig, setIsSavingResultConfig] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("all");
  const [auditEntityFilter, setAuditEntityFilter] = useState("all");
  const [recentBackups, setRecentBackups] = useState([]);
  const [isBackupsLoading, setIsBackupsLoading] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [selectedHistoricalBackupId, setSelectedHistoricalBackupId] = useState("");
  const [isRestoreRequestBusy, setIsRestoreRequestBusy] = useState(false);
  const [academicCycleEditState, setAcademicCycleEditState] = useState({
    canEdit: false,
    reason: "",
    currentSessionId: "",
    currentSessionName: "",
    currentTermId: "term1",
  });

  const loadSessionsSafely = useCallback(async (targetSchoolId) => {
    if (!targetSchoolId) return [];

    try {
      const summary = await listSessionsWithCounts(targetSchoolId);
      return summary?.sessions || [];
    } catch (error) {
      // Fallback to basic session listing when summary query fails.
      console.warn("Session count summary unavailable, using basic list:", error?.message || error);
      const basic = await listSessions(targetSchoolId);
      return (basic || []).map((sessionItem) => ({
        ...sessionItem,
        counts: {
          termCount: 0,
          enrollmentCount: 0,
          scoreCount: 0,
        },
      }));
    }
  }, []);

  const loadSchoolProfileEditor = useCallback(async (targetSchoolId) => {
    if (!targetSchoolId) return;

    const [profile, cycleStatus] = await Promise.all([
      getSchoolData(targetSchoolId),
      getAcademicCycleEditStatus(targetSchoolId),
    ]);

    setAcademicCycleEditState(
      cycleStatus || {
        canEdit: false,
        reason: "",
        currentSessionId: "",
        currentSessionName: "",
        currentTermId: "term1",
      }
    );

    setSchoolProfileForm({
      logo: String(profile?.logo || "").trim(),
      name: String(profile?.name || "").trim(),
      address: String(profile?.address || "").trim(),
      email: String(profile?.email || "").trim(),
      phone: String(profile?.phone || "").trim(),
      motto: String(profile?.motto || "").trim(),
      startingSessionName: String(cycleStatus?.currentSessionName || "").trim(),
      startingTermAlias: String(cycleStatus?.currentTermId || "term1").trim() || "term1",
    });
    setSchoolLogoPreview(String(profile?.logo || "").trim());
    setSchoolProfileErrors({});
  }, []);

  const loadAuditPanel = useCallback(async () => {
    if (!schoolId) return;
    setIsAuditLoading(true);
    setAuditError("");
    try {
      try {
        await cleanupAuditLogs({ schoolId });
      } catch (cleanupError) {
        console.warn("Audit cleanup skipped:", cleanupError?.message || cleanupError);
      }
      const recentLogs = await getRecentAuditLogs({ schoolId, max: 50 });
      setAuditLogs(recentLogs);
    } catch (error) {
      console.error("Error loading audit logs:", error);
      setAuditError(error?.message || "Failed to load audit logs.");
    } finally {
      setIsAuditLoading(false);
    }
  }, [schoolId]);

  const loadRecentBackups = useCallback(async () => {
    if (!schoolId) return;
    setIsBackupsLoading(true);
    setBackupError("");
    try {
      const rows = await listRecentBackups({ schoolId, max: 6 });
      setRecentBackups(rows || []);
      setSelectedHistoricalBackupId((previous) => {
        const stillExists = (rows || []).some(
          (entry) => String(entry?.id || "").trim() === String(previous || "").trim()
        );
        if (stillExists) return previous;
        return rows?.[0]?.id || "";
      });
    } catch (error) {
      console.error("Error loading backups:", error);
      setBackupError(error?.message || "Failed to load backups.");
      setRecentBackups([]);
      setSelectedHistoricalBackupId("");
    } finally {
      setIsBackupsLoading(false);
    }
  }, [schoolId]);

  // Get school ID from user data
  useEffect(() => {
    const getSchoolInfo = async () => {
      if (user) {
        const sId = await getUserSchoolId(user.uid);
        setSchoolId(sId);
      }
    };
    getSchoolInfo();
  }, [user]);

  // Load school-scoped settings/data
  useEffect(() => {
    const loadLocalConfig = async () => {
      if (!schoolId) return;
      const currentClasses = getCustomClasses(schoolId);
      const currentSubjects = getCustomSubjects(schoolId);
      setClasses(currentClasses);
      setSubjects(currentSubjects);
      setGradingScale(getGradingScale(schoolId));
      try {
        const settings = await getAdminSettings(schoolId);
        if (settings?.nextTermBegins) {
          setNextTermBegins(settings.nextTermBegins);
        }
        setResultConfig(normalizeResultConfig(settings?.resultConfig || {}));
        setClassStructure(
          normalizeClassStructure(settings?.classStructure || {}, {
            seniorSubjects: currentSubjects?.senior || [],
          })
        );
      } catch {
        // Keep defaults if settings load fails
        setResultConfig(getDefaultResultConfig());
        setClassStructure(
          getDefaultClassStructure({
            seniorSubjects: currentSubjects?.senior || [],
          })
        );
      }
    };
    loadLocalConfig();
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    loadSchoolProfileEditor(schoolId).catch((error) => {
      console.error("Error loading school profile editor:", error);
    });
  }, [schoolId, loadSchoolProfileEditor]);

  useEffect(() => {
    const loadSessionSummary = async () => {
      if (!schoolId) return;
      try {
        const next = await loadSessionsSafely(schoolId);
        setSessionsWithCounts(next);
      } catch (error) {
        console.error("Error loading sessions with counts:", error);
      }
    };

    loadSessionSummary();
  }, [schoolId, selectedSessionId, loadSessionsSafely]);

  useEffect(() => {
    if (activeTab !== "audit" || !schoolId) return;
    loadAuditPanel();
  }, [activeTab, schoolId, loadAuditPanel]);

  useEffect(() => {
    if (activeTab !== "session" || !schoolId) return;
    loadRecentBackups();
  }, [activeTab, schoolId, loadRecentBackups]);

  useEffect(() => {
    if (!promotionTargetSessionId && sessionsWithCounts.length > 0) {
      const sourceSessionId =
        selectedSessionId || uiActiveSessionId || activeSessionId || "";
      const defaultTarget = sessionsWithCounts.find(
        (item) => item.sessionId !== sourceSessionId
      );
      if (defaultTarget) {
        setPromotionTargetSessionId(defaultTarget.sessionId);
      }
    }
  }, [
    sessionsWithCounts,
    promotionTargetSessionId,
    activeSessionId,
    uiActiveSessionId,
    selectedSessionId,
  ]);

  useEffect(() => {
    if (activeSessionId) {
      setUiActiveSessionId(activeSessionId);
    }
  }, [activeSessionId]);

  const activeSession = sessionsWithCounts.find(
    (item) => item.sessionId === (uiActiveSessionId || activeSessionId)
  ) || sessionsWithCounts.find((item) => item?.isActive);
  const promotionSourceSessionId =
    selectedSessionId || uiActiveSessionId || activeSessionId || "";
  const promotionSourceSession =
    sessionsWithCounts.find((item) => item.sessionId === promotionSourceSessionId) ||
    activeSession ||
    null;
  const activeScopeSessionId = String(uiActiveSessionId || activeSessionId || "").trim();
  const activeScopeTermId = toTermAliasToken(activeTermId) || "term1";

  const currentViewedSession = sessionsWithCounts.find(
    (item) => item.sessionId === selectedSessionId
  );
  const selectedTermMeta =
    selectedSessionTerms.find((item) => item.alias === selectedTermId) || null;
  const sessionNameById = (sessionsWithCounts || []).reduce((acc, sessionItem) => {
    const token = String(sessionItem?.sessionId || "").trim();
    if (!token) return acc;
    acc[token] = String(sessionItem?.name || "").trim();
    return acc;
  }, {});
  const activeScopeSessionName =
    sessionNameById[activeScopeSessionId] || "Current Session";
  const historicalBackups = (recentBackups || []).filter((entry) => {
    const sessionToken = String(entry?.sessionId || "").trim();
    const termToken = toTermAliasToken(entry?.termId);
    return (
      sessionToken !== activeScopeSessionId ||
      termToken !== activeScopeTermId ||
      String(entry?.status || "").trim() !== "ready"
    );
  });
  const selectedHistoricalBackup =
    historicalBackups.find(
      (entry) => String(entry?.id || "").trim() === String(selectedHistoricalBackupId)
    ) ||
    null;

  useEffect(() => {
    setSelectedHistoricalBackupId((previous) => {
      const exists = historicalBackups.some(
        (entry) => String(entry?.id || "").trim() === String(previous || "").trim()
      );
      if (exists) return previous;
      return historicalBackups[0]?.id || "";
    });
  }, [historicalBackups]);
  const nextTermAlias =
    (selectedSessionActiveTermId || "") === "term1"
      ? "term2"
      : (selectedSessionActiveTermId || "") === "term2"
        ? "term3"
        : "";

  const getAdvanceTermBlockedMessage = () => {
    if (!promotionSourceSessionId) {
      return "No source session selected.";
    }
    if (isHistoricalView) {
      return "Switch to the active session before moving to a new term.";
    }
    if (isReadOnlyView) {
      return "Return to the current active term before moving to a new term.";
    }
    if (!nextTermAlias) {
      return "Third Term is final. Promote students to a new session instead.";
    }
    return "";
  };

  const getPromotionBlockedMessage = () => {
    if (!promotionSourceSessionId) {
      return "No source session selected.";
    }
    if (isHistoricalView) {
      return "Switch to the active session before promoting students.";
    }
    if (isReadOnlyView) {
      return "Return to the current active term before promoting students.";
    }
    if ((selectedSessionActiveTermId || "") !== "term3") {
      return "Promotion only happens in Third Term.";
    }
    return "";
  };

  const handleSetSessionActive = async (sessionItem) => {
    if (!schoolId || !sessionItem?.sessionId) return;
    setIsSessionBusy(true);
    try {
      await setActiveSession(schoolId, sessionItem.sessionId);
      setUiActiveSessionId(sessionItem.sessionId);
      selectSession(sessionItem.sessionId);
      setSessionsWithCounts((prev) =>
        (prev || []).map((session) => ({
          ...session,
          isActive: session.sessionId === sessionItem.sessionId,
        }))
      );
      const refreshed = await loadSessionsSafely(schoolId);
      if (refreshed.length) setSessionsWithCounts(refreshed);
      await loadSchoolProfileEditor(schoolId);
      await loadRecentBackups();
    } catch (error) {
      console.error("Error activating session:", error);
      alert(`Failed to set session as active: ${error?.message || "Unknown error"}`);
    } finally {
      setIsSessionBusy(false);
    }
  };

  const handleViewSession = (sessionItem) => {
    if (!sessionItem?.sessionId) return;
    selectSession(sessionItem.sessionId);
  };

  const handleArchiveSession = async (sessionItem) => {
    if (!schoolId || !sessionItem?.sessionId) return;
    if (!window.confirm(`Archive session "${sessionItem.name}"?`)) return;

    setIsSessionBusy(true);
    try {
      await archiveSession(sessionItem.sessionId, schoolId);
      const refreshed = await loadSessionsSafely(schoolId);
      setSessionsWithCounts(refreshed);
      await loadSchoolProfileEditor(schoolId);
      await loadRecentBackups();
    } catch (error) {
      console.error("Error archiving session:", error);
      alert(`Failed to archive session: ${error?.message || "Unknown error"}`);
    } finally {
      setIsSessionBusy(false);
    }
  };

  const openPromotionModal = async () => {
    const blockedMessage = getPromotionBlockedMessage();
    if (blockedMessage) {
      alert(blockedMessage);
      return;
    }
    const sourceSessionId = promotionSourceSessionId;
    if (!schoolId || !sourceSessionId) {
      alert("No source session selected.");
      return;
    }
    setIsSessionBusy(true);
    try {
      const impact = await previewPromotionImpact(schoolId, sourceSessionId);
      setPromotionImpact(impact);
      const sourceSession = sessionsWithCounts.find(
        (item) => item.sessionId === sourceSessionId
      );
      const parsed = parseSessionYears(sourceSession?.name || "");
      if (!parsed) {
        throw new Error("Source session name must use YYYY/YYYY format.");
      }
      setNextSessionNamePreview(`${parsed.startYear + 1}/${parsed.endYear + 1}`);
      setPromotionTargetSessionId("");
      setIsPromotionModalOpen(true);
    } catch (error) {
      console.error("Error loading promotion preview:", error);
      alert(`Failed to preview promotion impact: ${error?.message || "Unknown error"}`);
    } finally {
      setIsSessionBusy(false);
    }
  };

  const openAdvanceTermModal = () => {
    const blockedMessage = getAdvanceTermBlockedMessage();
    if (blockedMessage) {
      alert(blockedMessage);
      return;
    }

    setPendingAdvanceTermAlias(nextTermAlias);
    setIsAdvanceTermModalOpen(true);
  };

  const handleAdvanceTerm = async () => {
    if (!schoolId || !promotionSourceSessionId) return;
    const blockedMessage = getAdvanceTermBlockedMessage();
    if (blockedMessage) {
      alert(blockedMessage);
      return;
    }

    setIsSessionBusy(true);
    try {
      const nextTerm = await advanceToNextTerm({
        schoolId,
        sessionId: promotionSourceSessionId,
      });
      selectTerm(nextTerm?.alias || "term1");
      setIsAdvanceTermModalOpen(false);
      setPendingAdvanceTermAlias("");
      alert(`Moved to ${getTermDisplayName(nextTerm?.alias || "term1")}.`);
      const refreshed = await loadSessionsSafely(schoolId);
      setSessionsWithCounts(refreshed);
      await loadSchoolProfileEditor(schoolId);
      await loadRecentBackups();
    } catch (error) {
      console.error("Error advancing term:", error);
      alert(`Failed to advance term: ${error?.message || "Unknown error"}`);
    } finally {
      setIsSessionBusy(false);
    }
  };

  const handleConfirmPromotion = async () => {
    const sourceSessionId = promotionSourceSessionId;
    if (!schoolId || !sourceSessionId) {
      return;
    }
    if (!nextSessionNamePreview) {
      alert("Unable to resolve next session name from active session.");
      return;
    }

    setIsSessionBusy(true);
    try {
      const summary = await promoteToNewSession({
        schoolId,
        fromSessionId: sourceSessionId,
      });
      alert(
        `Promotion complete.\nFrom: ${summary.fromSessionId}\nTo: ${summary.toSessionName}\nTotal: ${summary.promotion.totalStudents}\nPromoted: ${summary.promotion.promoted}\nSkipped: ${summary.promotion.skipped}`
      );
      setIsPromotionModalOpen(false);
      setUiActiveSessionId(summary.toSessionId);
      selectSession(summary.toSessionId);
      setNextSessionNamePreview("");
      const refreshed = await loadSessionsSafely(schoolId);
      setSessionsWithCounts(refreshed);
      await loadSchoolProfileEditor(schoolId);
      await loadRecentBackups();
    } catch (error) {
      console.error("Error running promotion:", error);
      alert(`Promotion failed: ${error?.message || "Unknown error"}`);
    } finally {
      setIsSessionBusy(false);
    }
  };

  const handleTermChange = (newTerm) => {
    const normalizedTerm = String(newTerm || "").trim();
    const targetTerm =
      selectedSessionTerms.find((item) => item.alias === normalizedTerm) || null;
    if (!targetTerm || targetTerm.isFuture) {
      return;
    }
    selectTerm(targetTerm.alias);
  };

  const handleRequestHistoricalRestore = async () => {
    if (!schoolId || !selectedHistoricalBackup) {
      alert("Select a historical backup first.");
      return;
    }
    const targetSessionName =
      sessionNameById[String(selectedHistoricalBackup.sessionId || "").trim()] ||
      String(selectedHistoricalBackup.sessionName || "").trim() ||
      "Unknown Session";
    const targetTermLabel = getTermDisplayName(selectedHistoricalBackup.termId || "term1");
    const targetClassLabel = selectedHistoricalBackup.classId
      ? formatClassDisplay(selectedHistoricalBackup.classId)
      : "All classes";
    const confirmed = window.confirm(
      `Send restore request for Session ${targetSessionName}, ${targetTermLabel}, ${targetClassLabel}?`
    );
    if (!confirmed) return;

    setIsRestoreRequestBusy(true);
    try {
      await requestHistoricalRestore({
        schoolId,
        backupId: selectedHistoricalBackup.id,
        reason: `Historical restore requested for ${targetSessionName}, ${targetTermLabel}, ${targetClassLabel}.`,
      });
      alert("Historical restore request sent to platform support.");
      await loadRecentBackups();
    } catch (error) {
      console.error("Error requesting historical restore:", error);
      alert(`Request failed: ${error?.message || "Unknown error"}`);
    } finally {
      setIsRestoreRequestBusy(false);
    }
  };

  const getTermDisplayName = (termId) => {
    const termMap = {
      "term1": "First Term",
      "term2": "Second Term",
      "term3": "Third Term",
    };
    return termMap[termId] || termId;
  };

  const handleAddClass = async () => {
    if (!newClassName.trim()) {
      alert("Please enter class name");
      return;
    }
    
    if (!schoolId) {
      alert("Error: School ID not found. Please refresh the page.");
      return;
    }

    try {
      const classId = generateClassId(newClassName);

      // Add class and refresh list
      addClass(schoolId, classId, newClassName);
      const updated = getCustomClasses(schoolId);
      setClasses(updated);
      alert(`Class "${newClassName}" created.`);
      setNewClassName("");
    } catch (err) {
      console.error("Error adding class:", err);
      alert("Error creating class. Please try again.");
    }
  };

  const handleRemoveClass = (classId) => {
    if (window.confirm(`Remove class ${formatClassDisplay(classId)}?`)) {
      removeClass(schoolId, classId);
      const updated = getCustomClasses(schoolId);
      setClasses(updated);
    }
  };

  const handleAddSubject = async () => {
    if (!newSubject.trim()) {
      alert("Please enter subject name");
      return;
    }

    if (!schoolId) {
      alert("Error: School ID not found. Please refresh the page.");
      return;
    }

    try {
      await addSubject(schoolId, selectedLevel, newSubject);
      const updated = getCustomSubjects(schoolId);
      setSubjects(updated);
      if (selectedLevel === "senior") {
        setClassStructure((prev) =>
          normalizeClassStructure(prev, {
            seniorSubjects: updated?.senior || [],
          })
        );
      }

      alert(`Subject "${newSubject}" created for all classes!`);
      setNewSubject("");
    } catch (err) {
      console.error("Error adding subject:", err);
      alert("Error creating subject. Please try again.");
    }
  };

  const handleRemoveSubject = async (level, subject) => {
    if (!window.confirm(`Remove subject ${subject}?`)) return;

    try {
      await removeSubject(schoolId, level, subject);
      const updated = getCustomSubjects(schoolId);
      setSubjects(updated);
      if (level === "senior") {
        setClassStructure((prev) =>
          normalizeClassStructure(prev, {
            seniorSubjects: updated?.senior || [],
          })
        );
      }
    } catch (err) {
      console.error("Error removing subject:", err);
      alert("Error removing subject. Please try again.");
    }
  };

  const updateDepartmentStructure = useCallback(
    (updater, seniorSubjects = subjects?.senior || []) => {
      setClassStructure((prev) => {
        const base = normalizeClassStructure(prev, { seniorSubjects });
        const nextValue = typeof updater === "function" ? updater(base) : updater;
        return normalizeClassStructure(nextValue || {}, { seniorSubjects });
      });
    },
    [subjects?.senior]
  );

  const handleDepartmentEnabledToggle = (seniorKey, enabled) => {
    updateDepartmentStructure((prev) => ({
      ...prev,
      [seniorKey]: {
        ...prev[seniorKey],
        hasDepartments: enabled,
      },
    }));
  };

  const handleDepartmentCountChange = (seniorKey, value) => {
    const nextCount = Math.max(2, Math.min(3, Number(value) || 2));
    const defaults = getDefaultClassStructure({
      seniorSubjects: subjects?.senior || [],
    });
    updateDepartmentStructure((prev) => {
      const currentEntry = prev?.[seniorKey] || defaults[seniorKey];
      const nextDepartments = Array.from({ length: nextCount }, (_, index) => {
        return (
          currentEntry?.departments?.[index] ||
          defaults?.[seniorKey]?.departments?.[index]
        );
      });

      return {
        ...prev,
        [seniorKey]: {
          ...currentEntry,
          departments: nextDepartments,
        },
      };
    });
  };

  const handleDepartmentNameChange = (seniorKey, departmentIndex, value) => {
    updateDepartmentStructure((prev) => ({
      ...prev,
      [seniorKey]: {
        ...prev[seniorKey],
        departments: (prev?.[seniorKey]?.departments || []).map((department, index) =>
          index === departmentIndex
            ? {
                ...department,
                name: value,
              }
            : department
        ),
      },
    }));
  };

  const handleDepartmentSubjectToggle = (seniorKey, departmentIndex, subject) => {
    updateDepartmentStructure((prev) => ({
      ...prev,
      [seniorKey]: {
        ...prev[seniorKey],
        departments: (prev?.[seniorKey]?.departments || []).map((department, index) => {
          if (index !== departmentIndex) return department;
          const existing = new Set(department?.subjects || []);
          if (existing.has(subject)) {
            existing.delete(subject);
          } else {
            existing.add(subject);
          }
          return {
            ...department,
            subjects: [...existing],
          };
        }),
      },
    }));
  };

  const handleMergeGeneralSubjectsToggle = (seniorKey, enabled) => {
    updateDepartmentStructure((prev) => ({
      ...prev,
      [seniorKey]: {
        ...prev[seniorKey],
        mergeGeneralSubjects: enabled,
      },
    }));
  };

  const handleSaveClassStructure = async () => {
    if (!schoolId) {
      alert("Class structure cannot be saved right now. Refresh and try again.");
      return;
    }

    try {
      const settings = await getAdminSettings(schoolId);
      const nextClassStructure = normalizeClassStructure(classStructure, {
        seniorSubjects: subjects?.senior || [],
      });
      await saveAdminSettings(
        {
          ...settings,
          classStructure: nextClassStructure,
        },
        schoolId
      );
      setClassStructure(nextClassStructure);
      alert("Department structure updated.");
    } catch (error) {
      console.error("Error saving class structure:", error);
      alert(`Failed to save department structure: ${error?.message || "Unknown error"}`);
    }
  };

  const handleGradeChange = (grade, field, value) => {
    const numValue = parseInt(value) || 0;
    const baseScale = normalizeGradingScale(gradingScale);
    setGradingScale({
      ...baseScale,
      [grade]: {
        ...baseScale[grade],
        [field]: numValue,
      },
    });
  };

  const handleSaveGrading = async () => {
    const normalizedConfig = normalizeResultConfig(resultConfig);
    if (!normalizedConfig.enabledGrades?.length) {
      alert("Enable at least one grade band before saving grading.");
      return;
    }

    const effectiveScale = getConfiguredGradingScale(normalizedGradingScale, normalizedConfig);
    for (const [grade, range] of Object.entries(effectiveScale)) {
      if (range.min > range.max) {
        alert(`Invalid range for grade ${grade}`);
        return;
      }
    }
    saveGradingScale(schoolId, normalizedGradingScale);
    try {
      const settings = await getAdminSettings(schoolId);
      await saveAdminSettings(
        {
          ...settings,
          gradingScale: normalizedGradingScale,
          resultConfig: normalizedConfig,
        },
        schoolId
      );
    } catch (error) {
      console.error("Error saving grading scale:", error);
    }
    alert("Grading scale updated successfully!");
  };

  const handleSaveNextTerm = async () => {
    const settings = await getAdminSettings(schoolId);
    settings.nextTermBegins = nextTermBegins;
    await saveAdminSettings(settings, schoolId);
    alert("Next term date updated!");
  };

  const handleResultAssessmentChange = (key, field, value) => {
    setResultConfig((prev) => {
      const nextConfig = normalizeResultConfig(prev);
      nextConfig.assessments = nextConfig.assessments.map((component) => {
        if (component.key !== key) return component;
        if (field === "enabled") {
          return {
            ...component,
            enabled: component.key === "test3" ? value === true : true,
          };
        }
        if (field === "max") {
          const numericValue = Math.max(0, Number.parseInt(value, 10) || 0);
          return {
            ...component,
            max: numericValue,
          };
        }
        return {
          ...component,
          [field]: String(value || "").trim() || component[field],
        };
      });
      return nextConfig;
    });
  };

  const handleResultDisplayToggle = (field) => {
    setResultConfig((prev) => {
      const nextConfig = normalizeResultConfig(prev);
      nextConfig.display = {
        ...nextConfig.display,
        [field]: !(nextConfig.display?.[field] !== false),
      };
      return nextConfig;
    });
  };

  const handleGradeEnabledToggle = (grade) => {
    setResultConfig((prev) => {
      const nextConfig = normalizeResultConfig(prev);
      const normalizedGrade = String(grade || "").trim().toUpperCase();
      const enabled = new Set(nextConfig.enabledGrades || []);
      if (enabled.has(normalizedGrade)) {
        if (enabled.size === 1) {
          return nextConfig;
        }
        enabled.delete(normalizedGrade);
      } else {
        enabled.add(normalizedGrade);
      }
      nextConfig.enabledGrades = ["A", "B", "C", "D", "E", "F"].filter((item) =>
        enabled.has(item)
      );
      return nextConfig;
    });
  };

  const validateResultConfigState = () => {
    const normalized = normalizeResultConfig(resultConfig);
    const enabledAssessments = normalized.assessments.filter(
      (component) => component.enabled !== false
    );
    const totalMax = enabledAssessments.reduce(
      (sum, component) => sum + (Number(component.max) || 0),
      0
    );

    if (totalMax !== 100) {
      return `Enabled score components must total 100. Current total is ${totalMax}.`;
    }

    const invalidLabel = enabledAssessments.find(
      (component) => String(component.label || "").trim().length === 0
    );
    if (invalidLabel) {
      return "Each enabled score component needs a label.";
    }

    if (!normalized.enabledGrades || normalized.enabledGrades.length === 0) {
      return "Enable at least one grade band.";
    }

    const filteredScale = getConfiguredGradingScale(normalizedGradingScale, normalized);
    const ranges = Object.entries(filteredScale);
    for (const [grade, range] of ranges) {
      if (Number(range?.min) > Number(range?.max)) {
        return `Invalid grading range for ${grade}.`;
      }
    }

    return "";
  };

  const handleSaveResultConfig = async () => {
    if (!schoolId) {
      alert("Result configuration cannot be saved right now. Refresh and try again.");
      return;
    }

    const validationError = validateResultConfigState();
    if (validationError) {
      alert(validationError);
      return;
    }

    setIsSavingResultConfig(true);
    try {
      const settings = await getAdminSettings(schoolId);
      const nextConfig = normalizeResultConfig(resultConfig);
      const effectiveScale = getConfiguredGradingScale(normalizedGradingScale, nextConfig);
      for (const [grade, range] of Object.entries(effectiveScale)) {
        if (Number(range?.min) > Number(range?.max)) {
          throw new Error(`Invalid grading range for ${grade}.`);
        }
      }
      await saveAdminSettings(
        {
          ...settings,
          gradingScale: normalizedGradingScale,
          resultConfig: nextConfig,
        },
        schoolId
      );
      setResultConfig(nextConfig);
      alert("Result configuration updated.");
    } catch (error) {
      console.error("Error saving result configuration:", error);
      alert(`Failed to save result configuration: ${error?.message || "Unknown error"}`);
    } finally {
      setIsSavingResultConfig(false);
    }
  };

  const handleSchoolProfileChange = (event) => {
    const { name, value } = event.target;
    setSchoolProfileForm((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (schoolProfileErrors[name]) {
      setSchoolProfileErrors((prev) => ({
        ...prev,
        [name]: "",
      }));
    }
  };

  const handleSchoolLogoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setSchoolProfileErrors((prev) => ({
        ...prev,
        logo: "Please upload a valid image file.",
      }));
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setSchoolProfileErrors((prev) => ({
        ...prev,
        logo: "Image size must be less than 2MB.",
      }));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const nextLogo = String(reader.result || "");
      setSchoolProfileForm((prev) => ({
        ...prev,
        logo: nextLogo,
      }));
      setSchoolLogoPreview(nextLogo);
      setSchoolProfileErrors((prev) => ({
        ...prev,
        logo: "",
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveSchoolProfile = async () => {
    if (!schoolId || !user?.uid) {
      alert("School profile cannot be updated right now. Refresh and try again.");
      return;
    }

    const nextErrors = validateSchoolProfileFields(schoolProfileForm);
    if (Object.keys(nextErrors).length > 0) {
      setSchoolProfileErrors((prev) => ({
        ...prev,
        ...nextErrors,
      }));
      return;
    }

    setIsSavingSchoolProfile(true);
    try {
      const sanitizedProfile = {
        ...schoolProfileForm,
        name: normalizeWhitespace(schoolProfileForm.name),
        address: normalizeWhitespace(schoolProfileForm.address),
        email: normalizeWhitespace(schoolProfileForm.email).toLowerCase(),
        phone: normalizeWhitespace(schoolProfileForm.phone),
        motto: normalizeWhitespace(schoolProfileForm.motto),
      };
      await saveSchoolData(sanitizedProfile, user.uid, schoolId);
      await loadSchoolProfileEditor(schoolId);
      alert("School details updated.");
    } catch (error) {
      console.error("Error saving school profile:", error);
      alert(`Failed to save school details: ${error?.message || "Unknown error"}`);
    } finally {
      setIsSavingSchoolProfile(false);
    }
  };

  const handleSaveAcademicCycleSetup = async () => {
    if (!schoolId) {
      alert("Academic cycle settings cannot be updated right now. Refresh and try again.");
      return;
    }

    if (!academicCycleEditState?.canEdit) {
      alert(
        academicCycleEditState?.reason ||
          "Session and term can only be edited before the first term or session promotion."
      );
      return;
    }

    const cycleErrors = validateAcademicCycleFields(
      schoolProfileForm.startingSessionName,
      schoolProfileForm.startingTermAlias
    );
    if (Object.keys(cycleErrors).length > 0) {
      setSchoolProfileErrors((prev) => ({
        ...prev,
        ...cycleErrors,
      }));
      return;
    }

    setIsSavingAcademicCycle(true);
    try {
      const updatedCycle = await correctInitialAcademicCycle({
        schoolId,
        sessionName: normalizeWhitespace(schoolProfileForm.startingSessionName),
        termAlias: String(schoolProfileForm.startingTermAlias || "term1").trim() || "term1",
      });
      selectSession(updatedCycle?.sessionId || selectedSessionId);
      selectTerm(updatedCycle?.activeTermId || "term1");
      const refreshedSessions = await loadSessionsSafely(schoolId);
      setSessionsWithCounts(refreshedSessions);
      await loadSchoolProfileEditor(schoolId);
      alert("Session and term updated.");
    } catch (error) {
      console.error("Error correcting academic cycle:", error);
      alert(`Failed to update session/term: ${error?.message || "Unknown error"}`);
      await loadSchoolProfileEditor(schoolId);
    } finally {
      setIsSavingAcademicCycle(false);
    }
  };

  const normalizedResultConfig = normalizeResultConfig(resultConfig);
  const normalizedClassStructure = normalizeClassStructure(classStructure, {
    seniorSubjects: subjects?.senior || [],
  });
  const normalizedGradingScale = normalizeGradingScale(gradingScale);
  const enabledAssessmentTotal = normalizedResultConfig.assessments
    .filter((component) => component.enabled !== false)
    .reduce((sum, component) => sum + (Number(component.max) || 0), 0);
  const enabledGradesSet = new Set(normalizedResultConfig.enabledGrades || []);
  const effectiveGradingScale = getConfiguredGradingScale(
    normalizedGradingScale,
    normalizedResultConfig
  );
  const auditSessionNameById = (sessionsWithCounts || []).reduce((acc, sessionItem) => {
    const sessionIdToken = String(sessionItem?.sessionId || "").trim();
    if (!sessionIdToken) return acc;
    acc[sessionIdToken] = String(sessionItem?.name || "").trim();
    return acc;
  }, {});
  const auditActionOptions = [
    "all",
    ...new Set(auditLogs.map((entry) => String(entry?.action || "").trim()).filter(Boolean)),
  ];
  const auditEntityOptions = [
    "all",
    ...new Set(auditLogs.map((entry) => String(entry?.entityType || "").trim()).filter(Boolean)),
  ];
  const filteredAuditLogs = auditLogs.filter((entry) => {
    const action = String(entry?.action || "").trim();
    const entityType = String(entry?.entityType || "").trim();
    const actionMatch = auditActionFilter === "all" || action === auditActionFilter;
    const entityMatch = auditEntityFilter === "all" || entityType === auditEntityFilter;
    return actionMatch && entityMatch;
  });

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 p-4 md:p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="sm:text-3xl text-xl font-bold text-black dark:text-white">
          Admin Configuration
        </h1>
        <button
          onClick={() => navigate("/school-dashboard")}
          className="px-6 py-2   rounded-lg border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300" >
          Back
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto mb-8 bg-gray-50 dark:bg-gray-800 rounded-t-lg">
        <button
          onClick={() => setActiveTab("school")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "school"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          School
        </button>
        <button
          onClick={() => setActiveTab("session")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "session"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Session
        </button>
        <button
          onClick={() => setActiveTab("classes")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "classes"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Classes
        </button>
        <button
          onClick={() => setActiveTab("subjects")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "subjects"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Subjects
        </button>
        <button
          onClick={() => setActiveTab("results")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "results"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Results
        </button>
        <button
          onClick={() => setActiveTab("grades")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "grades"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Grading
        </button>
        <button
          onClick={() => setActiveTab("dates")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "dates"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Dates
        </button>
        <button
          onClick={() => setActiveTab("teachers")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "teachers"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Teachers
        </button>
        <button
          onClick={() => setActiveTab("audit")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "audit"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Audit Logs
        </button>
      </div>

      {/* Content */}
      <div className="bg-white dark:bg-gray-800 p-8 rounded-b-lg shadow-lg">
        {/* School Tab */}
        {activeTab === "school" && (
          <div>
            <h3 className="text-2xl font-semibold text-black dark:text-white mb-6">
              School Profile
            </h3>
            <div className="space-y-8">
              <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
                <p className="text-sm text-blue-900 dark:text-blue-100">
                  Update the school identity used across dashboards, previews, and PDFs.
                </p>
                <p className="mt-2 text-xs text-blue-800/90 dark:text-blue-200/90">
                  Session and term corrections are only available before the first time the school moves to another term or session.
                </p>
              </div>

              <div className="grid gap-8 lg:grid-cols-2">
                <div className="space-y-5 rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-900/40">
                  <div>
                    <h4 className="text-lg font-semibold text-black dark:text-white">
                      School Details
                    </h4>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      These details are editable at any time.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-black dark:text-white mb-2">
                      School Logo
                    </label>
                    <div className="flex items-center gap-4">
                      <div className="h-16 w-16 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                        {schoolLogoPreview ? (
                          <img
                            src={schoolLogoPreview}
                            alt="School logo preview"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-gray-400">
                            No Logo
                          </div>
                        )}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleSchoolLogoChange}
                        className="input flex-1"
                      />
                    </div>
                    {schoolProfileErrors.logo && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        {schoolProfileErrors.logo}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-black dark:text-white mb-2">
                      School Name
                    </label>
                    <input
                      type="text"
                      name="name"
                      value={schoolProfileForm.name}
                      onChange={handleSchoolProfileChange}
                      className="input w-full"
                      placeholder="School name"
                    />
                    {schoolProfileErrors.name && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        {schoolProfileErrors.name}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-black dark:text-white mb-2">
                      Motto
                    </label>
                    <input
                      type="text"
                      name="motto"
                      value={schoolProfileForm.motto}
                      onChange={handleSchoolProfileChange}
                      className="input w-full"
                      placeholder="School motto"
                    />
                    {schoolProfileErrors.motto && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        {schoolProfileErrors.motto}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-black dark:text-white mb-2">
                      Address
                    </label>
                    <input
                      type="text"
                      name="address"
                      value={schoolProfileForm.address}
                      onChange={handleSchoolProfileChange}
                      className="input w-full"
                      placeholder="School address"
                    />
                    {schoolProfileErrors.address && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        {schoolProfileErrors.address}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-semibold text-black dark:text-white mb-2">
                        Email
                      </label>
                      <input
                        type="email"
                        name="email"
                        value={schoolProfileForm.email}
                        onChange={handleSchoolProfileChange}
                        className="input w-full"
                        placeholder="school@example.com"
                      />
                      {schoolProfileErrors.email && (
                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                          {schoolProfileErrors.email}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-black dark:text-white mb-2">
                        Phone
                      </label>
                      <input
                        type="text"
                        name="phone"
                        value={schoolProfileForm.phone}
                        onChange={handleSchoolProfileChange}
                        className="input w-full"
                        placeholder="School phone number"
                      />
                      {schoolProfileErrors.phone && (
                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                          {schoolProfileErrors.phone}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleSaveSchoolProfile}
                    disabled={isSavingSchoolProfile}
                    className="w-full px-6 py-3 bg-blue-800 hover:bg-blue-900 disabled:opacity-60 disabled:cursor-not-allowed dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300"
                  >
                    {isSavingSchoolProfile ? "Saving..." : "Save School Details"}
                  </button>
                </div>

                <div className="space-y-5 rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-900/40">
                  <div>
                    <h4 className="text-lg font-semibold text-black dark:text-white">
                      Starting Session & Term
                    </h4>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      Use this only to correct onboarding mistakes before the first term or session promotion.
                    </p>
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-900/20">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                      Current setup: {academicCycleEditState.currentSessionName || "Not set"} /{" "}
                      {getTermDisplayName(academicCycleEditState.currentTermId || "term1")}
                    </p>
                    {!academicCycleEditState.canEdit && (
                      <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                        {academicCycleEditState.reason}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-black dark:text-white mb-2">
                      Academic Session
                    </label>
                    <input
                      type="text"
                      name="startingSessionName"
                      value={schoolProfileForm.startingSessionName}
                      onChange={handleSchoolProfileChange}
                      disabled={!academicCycleEditState.canEdit}
                      className="input w-full disabled:opacity-60 disabled:cursor-not-allowed"
                      placeholder="e.g. 2026/2027"
                    />
                    {schoolProfileErrors.startingSessionName && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        {schoolProfileErrors.startingSessionName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-black dark:text-white mb-2">
                      Starting Term
                    </label>
                    <select
                      name="startingTermAlias"
                      value={schoolProfileForm.startingTermAlias}
                      onChange={handleSchoolProfileChange}
                      disabled={!academicCycleEditState.canEdit}
                      className="input w-full disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="term1">First Term</option>
                      <option value="term2">Second Term</option>
                      <option value="term3">Third Term</option>
                    </select>
                    {schoolProfileErrors.startingTermAlias && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        {schoolProfileErrors.startingTermAlias}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={handleSaveAcademicCycleSetup}
                    disabled={!academicCycleEditState.canEdit || isSavingAcademicCycle}
                    className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold rounded-lg transition-all duration-300"
                  >
                    {isSavingAcademicCycle ? "Saving..." : "Save Session & Term"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Session Tab */}
        {activeTab === "session" && (
          <div>
            <h3 className="text-2xl font-semibold text-black dark:text-white mb-6">
              Session Management
            </h3>
            <div className="space-y-6">
              <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
                <p className="text-sm text-blue-900 dark:text-blue-100">
                  Active Session:{" "}
                  <span className="font-semibold">
                    {activeSession?.name || activeSession?.sessionId || "Not set"}
                  </span>
                </p>
                <p className="mt-1 text-sm text-blue-900 dark:text-blue-100">
                  Current View:{" "}
                  <span className="font-semibold">
                    {currentViewedSession?.name ||
                      selectedSessionName ||
                      activeSession?.name ||
                      "Not selected"}
                  </span>
                </p>
                <p className="mt-2 text-xs text-blue-800/90 dark:text-blue-200/90">
                  Terms = number of terms in session, Enrollments = class placements in session, Scores = score records for that session.
                </p>
                {isHistoricalView && (
                  <p className="mt-2 rounded border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    Viewing historical data. Changes will NOT affect active session.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={openAdvanceTermModal}
                  className="px-5 py-2 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold rounded-lg transition-all duration-300"
                  disabled={isSessionBusy || !promotionSourceSessionId}
                >
                  Go To Next Term
                </button>
                <button
                  onClick={openPromotionModal}
                  className="px-5 py-2 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300"
                  disabled={isSessionBusy || !promotionSourceSessionId}
                >
                  Promote Students to New Session
                </button>
              </div>

              <SessionListPanel
                sessions={sessionsWithCounts}
                activeSessionId={uiActiveSessionId || activeSessionId}
                selectedSessionId={selectedSessionId}
                onSetActive={handleSetSessionActive}
                onViewSession={handleViewSession}
                onArchiveSession={handleArchiveSession}
                isWorking={isSessionBusy}
              />
              {isReadOnlyView && !isHistoricalView && (
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                  You are viewing a past term. Scores and roster changes are read-only until you return to the current term.
                </p>
              )}
              {!isHistoricalView && (selectedSessionActiveTermId || "") === "term3" && (
                <p className="text-xs font-medium text-blue-700 dark:text-blue-300">
                  Third Term is the last editable term. The next academic step is session promotion.
                </p>
              )}

              <div>
                <label className="block text-sm font-semibold text-black dark:text-white mb-3">
                  Current Term
                </label>
                <div className="flex gap-3 flex-wrap">
                  {selectedSessionTerms.map((term) => {
                    const isSelected = selectedTermId === term.alias;
                    const buttonClass = term.isFuture
                      ? "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500 cursor-not-allowed"
                      : isSelected
                        ? "bg-blue-800 text-white dark:bg-blue-600"
                        : term.isPast
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/30"
                          : "bg-gray-200 text-black dark:bg-gray-700 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600";
                    return (
                      <button
                        key={term.alias}
                        onClick={() => handleTermChange(term.alias)}
                        disabled={term.isFuture}
                        className={`px-6 py-3 rounded-lg font-semibold transition-all duration-300 disabled:opacity-70 ${buttonClass}`}
                      >
                        {getTermDisplayName(term.alias)}
                        {term.isPast ? " (Read-only)" : ""}
                        {term.isFuture ? " (Upcoming)" : ""}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Past terms are view-only. Upcoming terms open only through "Go To Next Term".
                </p>
                {selectedTermMeta && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Viewing: {getTermDisplayName(selectedTermMeta.alias)}
                    {selectedTermMeta.isPast ? " (read-only history)" : ""}
                    {selectedTermMeta.isFuture ? " (upcoming)" : ""}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-black dark:text-white">
                      Historical Backup Restore Request
                    </p>
                    <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">
                      Active scope is {activeScopeSessionName}, {getTermDisplayName(activeScopeTermId)}.
                      Past-session/term restores are handled from Platform Support.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadRecentBackups}
                    disabled={isBackupsLoading || isSessionBusy || isRestoreRequestBusy}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-black transition-all duration-300 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
                  >
                    {isBackupsLoading ? "Loading..." : "Refresh"}
                  </button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                  <select
                    value={selectedHistoricalBackupId}
                    onChange={(event) => setSelectedHistoricalBackupId(event.target.value)}
                    disabled={isBackupsLoading || historicalBackups.length === 0}
                    className="input w-full disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {historicalBackups.length === 0 ? (
                      <option value="">
                        {isBackupsLoading
                          ? "Loading backups..."
                          : "No historical backups available"}
                      </option>
                    ) : (
                      historicalBackups.map((backupRow) => {
                        const backupSessionName =
                          sessionNameById[String(backupRow?.sessionId || "").trim()] ||
                          String(backupRow?.sessionName || "").trim() ||
                          "Unknown Session";
                        const label = [
                          formatBackupTimestamp(backupRow?.createdAt),
                          formatBackupTypeLabel(backupRow?.type),
                          backupSessionName,
                          getTermDisplayName(backupRow?.termId || "term1"),
                          backupRow?.classId
                            ? `Class ${formatClassDisplay(backupRow.classId)}`
                            : "All classes",
                        ].join(" | ");
                        return (
                          <option key={backupRow.id} value={backupRow.id}>
                            {label}
                          </option>
                        );
                      })
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={handleRequestHistoricalRestore}
                    disabled={
                      !selectedHistoricalBackup ||
                      isBackupsLoading ||
                      isSessionBusy ||
                      isRestoreRequestBusy
                    }
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-all duration-300 hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-700 dark:hover:bg-amber-600"
                  >
                    {isRestoreRequestBusy ? "Sending..." : "Request Restore"}
                  </button>
                </div>

                {backupError ? (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">{backupError}</p>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Classes Tab */}
        {activeTab === "classes" && (
          <div>
            <h3 className="text-2xl font-semibold text-black dark:text-white mb-6">
              Manage Classes
            </h3>
            <div className="space-y-6">
              <div className="bg-blue-50 dark:bg-blue-900 p-6 rounded-lg">
                <h4 className="font-semibold text-black dark:text-white mb-4 text-lg">
                  Add New Class
                </h4>
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    placeholder="Class Name (e.g., JSS 1, SSS 2)"
                    className="input w-full"
                  />
                </div>
                <button
                  onClick={handleAddClass}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold rounded-lg transition-all duration-300"
                >
                  Add Class
                </button>
              </div>

              <div>
                <h4 className="font-semibold text-black dark:text-white mb-4 text-lg">
                  Current Classes
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {classes.map((cls) => (
                    <div
                      key={cls.id}
                      className="flex justify-between items-center p-4 bg-gray-100 dark:bg-gray-700 rounded-lg"
                    >
                      <span className="font-medium text-black dark:text-white">
                        {cls.label}
                      </span>
                      <button
                        onClick={() => handleRemoveClass(cls.id)}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white text-sm font-semibold rounded transition-all duration-300"
                      >
                         ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-blue-100 bg-white p-6 dark:border-blue-900/40 dark:bg-gray-800">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h4 className="text-lg font-semibold text-black dark:text-white">
                      Senior Department Structure
                    </h4>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      Enable optional department splits for SS1 to SS3. Leaving a class disabled keeps the current class flow unchanged.
                    </p>
                  </div>
                  <button
                    onClick={handleSaveClassStructure}
                    className="rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white transition-all duration-300 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600"
                  >
                    Save Department Setup
                  </button>
                </div>

                <div className="mt-6 space-y-4">
                  {["SS1", "SS2", "SS3"].map((seniorKey) => {
                    const config = normalizedClassStructure?.[seniorKey] || {
                      hasDepartments: false,
                      departments: [],
                      mergeGeneralSubjects: false,
                    };
                    const activeDepartments = config?.departments || [];

                    return (
                      <div
                        key={seniorKey}
                        className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-700 dark:bg-gray-900/60"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <h5 className="text-base font-semibold text-black dark:text-white">
                              {seniorKey}
                            </h5>
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                              Configure department names, subject sets, and whether shared subjects use a full-class roster.
                            </p>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                              <input
                                type="checkbox"
                                checked={config.hasDepartments === true}
                                onChange={(event) =>
                                  handleDepartmentEnabledToggle(seniorKey, event.target.checked)
                                }
                                className="h-4 w-4 rounded border-gray-300 text-blue-700 focus:ring-blue-500"
                              />
                              Enable departments
                            </label>

                            <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                              <span>Department count</span>
                              <select
                                value={activeDepartments.length || 3}
                                onChange={(event) =>
                                  handleDepartmentCountChange(seniorKey, event.target.value)
                                }
                                className="input ml-auto max-w-[7rem]"
                              >
                                <option value="2">2 departments</option>
                                <option value="3">3 departments</option>
                              </select>
                            </label>
                          </div>
                        </div>

                        {config.hasDepartments ? (
                          <>
                            <label className="mt-4 flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-100">
                              <input
                                type="checkbox"
                                checked={config.mergeGeneralSubjects === true}
                                onChange={(event) =>
                                  handleMergeGeneralSubjectsToggle(seniorKey, event.target.checked)
                                }
                                className="h-4 w-4 rounded border-blue-300 text-blue-700 focus:ring-blue-500"
                              />
                              Merge shared subjects across departments
                            </label>
                            <p className="mt-2 text-xs text-blue-800/90 dark:text-blue-200/90">
                              When enabled, any subject assigned to every department is recorded with the full class roster instead of department-only students.
                            </p>

                            <div className="mt-5 grid gap-4 xl:grid-cols-3">
                              {activeDepartments.map((department, departmentIndex) => (
                                <div
                                  key={`${seniorKey}-${department.id}`}
                                  className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
                                >
                                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200">
                                    Department Name
                                  </label>
                                  <input
                                    type="text"
                                    value={department.name || ""}
                                    onChange={(event) =>
                                      handleDepartmentNameChange(
                                        seniorKey,
                                        departmentIndex,
                                        event.target.value
                                      )
                                    }
                                    className="input mt-2 w-full"
                                    placeholder={`Department ${departmentIndex + 1}`}
                                  />

                                  <div className="mt-4">
                                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                                      Subjects
                                    </p>
                                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                      Choose the subjects this department should handle.
                                    </p>
                                  </div>

                                  <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                                    {(subjects?.senior || []).length > 0 ? (
                                      subjects.senior.map((subject) => {
                                        const isChecked = (department?.subjects || []).includes(subject);
                                        return (
                                          <label
                                            key={`${department.id}-${subject}`}
                                            className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-all duration-200 hover:border-blue-300 dark:border-gray-700 dark:text-gray-200 dark:hover:border-blue-700"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={() =>
                                                handleDepartmentSubjectToggle(
                                                  seniorKey,
                                                  departmentIndex,
                                                  subject
                                                )
                                              }
                                              className="h-4 w-4 rounded border-gray-300 text-blue-700 focus:ring-blue-500"
                                            />
                                            <span>{subject}</span>
                                          </label>
                                        );
                                      })
                                    ) : (
                                      <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                        Add senior subjects first to assign department subjects.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="mt-4 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
                            Departments are disabled for {seniorKey}. Students and records will continue using the existing class-wide flow.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Subjects Tab */}
        {activeTab === "subjects" && (
          <div>
            <h3 className="text-2xl font-semibold text-black dark:text-white mb-6">
              Manage Subjects
            </h3>
            <div className="space-y-6">
              <div className="bg-purple-50 dark:bg-purple-900 p-6 rounded-lg">
                <h4 className="font-semibold text-black dark:text-white mb-4 text-lg">
                  Add New Subject
                </h4>
                <div className="flex gap-2 mb-4 max-sm:flex-col">
                  <select
                    value={selectedLevel}
                    onChange={(e) => setSelectedLevel(e.target.value)}
                    className="input"
                  >
                    <option value="junior">Junior (JSS)</option>
                    <option value="senior">Senior (SSS)</option>
                  </select>
                  <input
                    type="text"
                    value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value)}
                    placeholder="Subject name"
                    className="input flex-1"
                  />
                </div>
                <button
                  onClick={handleAddSubject}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold rounded-lg transition-all duration-300"
                >
                  Add Subject
                </button>
              </div>

              <div>
                <h4 className="font-semibold text-black dark:text-white mb-4 text-lg">
                  Junior Subjects (JSS 1-3)
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                  {subjects.junior.map((subject) => (
                    <div
                      key={subject}
                      className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg"
                    >
                      <span className="text-sm font-medium text-black dark:text-white truncate">
                        {subject}
                      </span>
                      <button
                        onClick={() => handleRemoveSubject("junior", subject)}
                        className="px-2 py-1 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white text-xs font-semibold rounded transition-all duration-300 ml-2 flex-shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-black dark:text-white mb-4 text-lg">
                  Senior Subjects (SSS 1-3)
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {subjects.senior.map((subject) => (
                    <div
                      key={subject}
                      className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg"
                    >
                      <span className="text-sm font-medium text-black dark:text-white truncate">
                        {subject}
                      </span>
                      <button
                        onClick={() => handleRemoveSubject("senior", subject)}
                        className="px-2 py-1 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white text-xs font-semibold rounded transition-all duration-300 ml-2 flex-shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results Tab */}
        {activeTab === "results" && (
          <div>
            <h3 className="mb-6 text-2xl font-semibold text-black dark:text-white">
              Result Configuration
            </h3>
            <div className="space-y-6">
              <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
                <p className="text-sm text-blue-900 dark:text-blue-100">
                  Configure the score inputs teachers record and the extra result headings shown across previews and PDFs.
                </p>
                <p className="mt-2 text-xs text-blue-800/90 dark:text-blue-200/90">
                  Enabled score components must total exactly 100 before the changes can be saved.
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {normalizedResultConfig.assessments.map((component) => {
                  const isOptional = component.key === "test3";
                  const isEnabled = component.enabled !== false;

                  return (
                    <div
                      key={component.key}
                      className="rounded-xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-700 dark:bg-gray-900/40"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-black dark:text-white">
                            {component.key === "exam"
                              ? "Exam"
                              : component.key === "test3"
                                ? "Optional Third Test"
                                : component.label}
                          </p>
                          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                            {isOptional
                              ? "Turn this on only when the school uses three tests."
                              : "This score input is always required."}
                          </p>
                        </div>
                        <label className="flex items-center gap-2 text-sm font-medium text-black dark:text-white">
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            disabled={!isOptional}
                            onChange={(event) =>
                              handleResultAssessmentChange(
                                component.key,
                                "enabled",
                                event.target.checked
                              )
                            }
                            className="h-4 w-4"
                          />
                          Enabled
                        </label>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-black dark:text-white">
                            Column Label
                          </label>
                          <input
                            type="text"
                            value={component.label}
                            onChange={(event) =>
                              handleResultAssessmentChange(
                                component.key,
                                "label",
                                event.target.value
                              )
                            }
                            disabled={!isEnabled}
                            className="input w-full disabled:cursor-not-allowed disabled:opacity-60"
                            placeholder="Column label"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-black dark:text-white">
                            Maximum Score
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={component.max}
                            onChange={(event) =>
                              handleResultAssessmentChange(
                                component.key,
                                "max",
                                event.target.value
                              )
                            }
                            disabled={!isEnabled}
                            className="input w-full disabled:cursor-not-allowed disabled:opacity-60"
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-semibold text-black dark:text-white">
                      Extra Result Headings
                    </h4>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      Toggle optional calculated columns such as class average, highest score, and position.
                    </p>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-800 dark:border-blue-700 dark:bg-gray-800 dark:text-blue-300">
                    Enabled Total: {enabledAssessmentTotal}/100
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { key: "showCa", label: "CA" },
                    { key: "showExamPlusCa", label: "Exam + CA" },
                    { key: "showLtc", label: "Last Term Cumulative" },
                    { key: "showTotal", label: "Total" },
                    { key: "showClassAverage", label: "Class Average" },
                    { key: "showPosition", label: "Position" },
                    { key: "showHighestInClass", label: "Highest In Class" },
                    { key: "showLowestInClass", label: "Lowest In Class" },
                    { key: "showGrade", label: "Grade" },
                    { key: "showRemark", label: "Remark" },
                  ].map((toggle) => (
                    <label
                      key={toggle.key}
                      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-black dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    >
                      <input
                        type="checkbox"
                        checked={normalizedResultConfig.display?.[toggle.key] !== false}
                        onChange={() => handleResultDisplayToggle(toggle.key)}
                        className="h-4 w-4"
                      />
                      <span>{toggle.label}</span>
                    </label>
                  ))}
                </div>

                <button
                  onClick={handleSaveResultConfig}
                  disabled={isSavingResultConfig}
                  className="mt-6 w-full rounded-lg bg-blue-800 px-6 py-3 font-semibold text-white transition-all duration-300 hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
                >
                  {isSavingResultConfig ? "Saving..." : "Save Result Configuration"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Grades Tab */}
        {activeTab === "grades" && (
          <div>
            <h3 className="text-2xl font-semibold text-black dark:text-white mb-6">
              Grading Scale Configuration
            </h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              Disable grade bands the school does not use. Only enabled grades appear in results, previews, and PDFs.
            </p>
            <div className="space-y-4 mb-8">
              {Object.entries(normalizedGradingScale).map(([grade, range]) => (
                <div
                  key={grade}
                  className={`flex items-center gap-4 rounded-lg p-4 ${
                    enabledGradesSet.has(grade)
                      ? "bg-gray-100 dark:bg-gray-700"
                      : "bg-gray-50 opacity-90 dark:bg-gray-800/70"
                  }`}
                >
                  <label className="flex items-center gap-2 text-sm font-medium text-black dark:text-white">
                    <input
                      type="checkbox"
                      checked={enabledGradesSet.has(grade)}
                      onChange={() => handleGradeEnabledToggle(grade)}
                      className="h-4 w-4"
                    />
                    Use
                  </label>
                  <span className="font-bold text-2xl text-blue-800 dark:text-blue-400 w-12">
                    {grade}
                  </span>
                  <div className="flex-1 flex gap-3 items-center">
                    <input
                      type="number"
                      value={
                        enabledGradesSet.has(grade)
                          ? effectiveGradingScale?.[grade]?.min ?? range.min
                          : range.min
                      }
                      onChange={(e) => handleGradeChange(grade, "min", e.target.value)}
                      disabled={!enabledGradesSet.has(grade)}
                      className="input w-16 sm:w-32 disabled:cursor-not-allowed disabled:opacity-60"
                      placeholder="Min"
                    />
                    <span className="text-gray-600 dark:text-gray-400 font-semibold">to</span>
                    <input
                      type="number"
                      value={
                        enabledGradesSet.has(grade)
                          ? effectiveGradingScale?.[grade]?.max ?? range.max
                          : range.max
                      }
                      onChange={(e) => handleGradeChange(grade, "max", e.target.value)}
                      disabled={!enabledGradesSet.has(grade)}
                      className="input w-16 sm:w-32 disabled:cursor-not-allowed disabled:opacity-60"
                      placeholder="Max"
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={handleSaveGrading}
              className="w-full px-6 py-3 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300"
            >
              Save Grading Scale
            </button>
          </div>
        )}

        {/* Dates Tab */}
        {activeTab === "dates" && (
          <div>
            <h3 className="text-2xl font-semibold text-black dark:text-white mb-6">
              Important Dates
            </h3>
            <div className="space-y-4 max-w-md">
              <div>
                <label className="label-w block mb-3 text-lg">Next Term Begins</label>
                <div className="flex gap-3">
                  <input
                    type="date"
                    value={nextTermBegins}
                    onChange={(e) => setNextTermBegins(e.target.value)}
                    className="input w-2/3"
                  />
                  <button
                    onClick={handleSaveNextTerm}
                    className="px-6 py-2 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300"
                  >
                    Save
                  </button>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">
                  This date appears on student result sheets
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Teachers Tab */}
        {activeTab === "teachers" && (
          <TeacherManagementPanel schoolId={schoolId} classes={classes} subjects={subjects} />
        )}

        {/* Audit Logs Tab */}
        {activeTab === "audit" && (
          <div>
            <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-2xl font-semibold text-black dark:text-white">Audit Logs</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Last 50 entries. Logs are fetched on demand when this tab opens.
                </p>
              </div>
              <button
                type="button"
                onClick={loadAuditPanel}
                disabled={isAuditLoading}
                className="rounded-lg border-2 border-gray-300 px-4 py-2 font-semibold text-black transition-all duration-300 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
              >
                {isAuditLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div className="mb-4 grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-black dark:text-white">
                  Filter by Action
                </label>
                <select
                  value={auditActionFilter}
                  onChange={(event) => setAuditActionFilter(event.target.value)}
                  className="input w-full"
                >
                  {auditActionOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "all" ? "All actions" : formatAuditActionLabel(option)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-black dark:text-white">
                  Filter by Entity
                </label>
                <select
                  value={auditEntityFilter}
                  onChange={(event) => setAuditEntityFilter(event.target.value)}
                  className="input w-full"
                >
                  {auditEntityOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "all" ? "All entities" : option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {auditError ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
                {auditError}
              </div>
            ) : null}

            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-100 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-black dark:text-white">
                        Timestamp
                      </th>
                      <th className="px-4 py-3 font-semibold text-black dark:text-white">
                        Role
                      </th>
                      <th className="px-4 py-3 font-semibold text-black dark:text-white">
                        Action
                      </th>
                      <th className="px-4 py-3 font-semibold text-black dark:text-white">
                        Entity
                      </th>
                      <th className="px-4 py-3 font-semibold text-black dark:text-white">
                        Scope
                      </th>
                      <th className="px-4 py-3 font-semibold text-black dark:text-white">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isAuditLoading ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-8 text-center text-sm text-gray-600 dark:text-gray-300"
                        >
                          Loading audit logs...
                        </td>
                      </tr>
                    ) : filteredAuditLogs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-8 text-center text-sm text-gray-600 dark:text-gray-300"
                        >
                          No audit logs found for the selected filters.
                        </td>
                      </tr>
                    ) : (
                      filteredAuditLogs.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                        >
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                            {formatAuditTimestamp(entry?.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                            {String(entry?.actorRole || "-")}
                          </td>
                          <td className="px-4 py-3 font-medium text-black dark:text-white">
                            {formatAuditActionLabel(entry?.action)}
                          </td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                            {String(entry?.entityType || "-")}
                          </td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                            {formatAuditScopeSummary(entry?.scope || {}, auditSessionNameById)}
                          </td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                            {formatAuditDetails(entry)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <PromotionConfirmModal
        isOpen={isPromotionModalOpen}
        sourceSession={promotionSourceSession}
        nextSessionName={nextSessionNamePreview}
        sessions={sessionsWithCounts}
        activeSessionId={promotionSourceSessionId}
        targetSession={sessionsWithCounts.find(
          (item) => item.sessionId === promotionTargetSessionId
        )}
        selectedTargetSessionId={promotionTargetSessionId}
        onTargetSessionChange={setPromotionTargetSessionId}
        impact={promotionImpact}
        isSubmitting={isSessionBusy}
        onCancel={() => setIsPromotionModalOpen(false)}
        onConfirm={handleConfirmPromotion}
      />

      {isAdvanceTermModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            <h3 className="mb-4 text-xl font-semibold text-black dark:text-white">
              Confirm New Term
            </h3>
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
              <p className="text-sm text-black dark:text-white">
                You are about to move from{" "}
                <span className="font-semibold">
                  {getTermDisplayName(selectedSessionActiveTermId || "term1")}
                </span>{" "}
                to{" "}
                <span className="font-semibold">
                  {getTermDisplayName(pendingAdvanceTermAlias || nextTermAlias || "term1")}
                </span>.
              </p>
              <p className="text-sm text-black dark:text-white">
                Once you continue, all data recorded for{" "}
                <span className="font-semibold">
                  {getTermDisplayName(selectedSessionActiveTermId || "term1")}
                </span>{" "}
                becomes read-only.
              </p>
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                Warning: This action is irreversible.
              </p>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isSessionBusy) return;
                  setIsAdvanceTermModalOpen(false);
                  setPendingAdvanceTermAlias("");
                }}
                disabled={isSessionBusy}
                className="flex-1 rounded-lg border-2 border-gray-300 px-4 py-2 font-semibold text-black transition-all duration-300 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdvanceTerm}
                disabled={isSessionBusy}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2 font-semibold text-white transition-all duration-300 hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-green-700 dark:hover:bg-green-600"
              >
                {isSessionBusy
                  ? "Moving..."
                  : `Proceed to ${getTermDisplayName(
                      pendingAdvanceTermAlias || nextTermAlias || "term1"
                    )}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
