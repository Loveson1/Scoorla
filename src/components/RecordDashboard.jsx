import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  canonicalizeResultSelection,
  getAdminSettings,
  getDepartmentAwareClassStudents,
  getDepartmentAwareSubjects,
  getEnabledScoreComponents,
  getLastTermCumulativeMap,
  getRecordDashboardRoster,
  getRecordDashboardScores,
  getResultSelection,
  getScores,
  getStoredLastTermCumulativeMap,
  saveScores,
  shouldUseLastTermCumulative,
  syncCurrentScoreRowsLastTermCumulativeCache,
  syncStoredLastTermCumulativeMap,
} from "./utils/school-data";
import { useSessionContext } from "../context/SessionContext";
import { useAuthContext } from "../context/AuthContext";
import { useSchoolBootstrap } from "../context/SchoolBootstrapContext";
import {
  buildRecordDashboardPath,
  filterStudentsByDepartmentScope,
  formatScopedClassLabel,
  getClassIdFromRouteSegment,
  getDepartmentsForClass,
  isMergedDepartmentSubject,
  resolveDepartmentFromRoute,
  resolveSubjectFromRouteSegment,
} from "../utils/departmentUtils";

const TERM_LABELS = {
  term1: "First Term",
  term2: "Second Term",
  term3: "Third Term",
  "1st": "First Term",
  "2nd": "Second Term",
  "3rd": "Third Term",
};

const getBootstrapSubjectsByClass = (schoolData = {}, classId = "") => {
  const normalizedClassId = String(classId || "").trim().toLowerCase();
  const isJunior = ["jss1", "jss2", "jss3"].includes(normalizedClassId);
  const catalog = schoolData?.subjects || {};
  const scopedSubjects = isJunior ? catalog?.junior : catalog?.senior;
  return Array.isArray(scopedSubjects) ? scopedSubjects : [];
};

const RECORD_DASHBOARD_STALE_TIME = 10 * 60 * 1000;
const RECORD_DASHBOARD_GC_TIME = 30 * 60 * 1000;
const EMPTY_LTC_UI_META = Object.freeze({
  currentTermOrder: 1,
  allowClassWideManualOnZero: false,
});
const EMPTY_RECORD_DASHBOARD_DATA = Object.freeze({
  students: [],
  scores: {},
  ltcByStudent: {},
  ltcUiMeta: EMPTY_LTC_UI_META,
});

const getTermOrder = (termId) => {
  const normalized = String(termId || "").trim().toLowerCase();
  if (normalized === "term2" || normalized === "2nd") return 2;
  if (normalized === "term3" || normalized === "3rd") return 3;
  return 1;
};

const buildRecordDashboardQueryKey = ({
  schoolId,
  userId,
  classId,
  departmentId,
  subjectId,
  sessionId,
  termId,
  isHistoricalView,
  isReadOnlyView,
}) => [
  "record",
  String(schoolId || "").trim() || "none",
  String(userId || "").trim() || "anonymous",
  String(classId || "").trim() || "none",
  String(departmentId || "").trim() || "all",
  String(subjectId || "").trim() || "none",
  String(sessionId || "").trim() || "none",
  String(termId || "").trim() || "term1",
  isHistoricalView ? "historical" : "active",
  isReadOnlyView ? "readonly" : "editable",
];

const buildDirtyScoreScopeKey = ({
  schoolId,
  userId,
  classId,
  departmentId,
  subjectId,
  sessionId,
  termId,
}) =>
  [
    "recordDashboardDirtyScores",
    String(schoolId || "").trim(),
    String(userId || "").trim(),
    String(classId || "").trim(),
    String(departmentId || "").trim() || "all",
    String(subjectId || "").trim(),
    String(sessionId || "").trim(),
    String(termId || "").trim(),
  ].join("__");

export default function RecordDashboard() {
  const navigate = useNavigate();
  const params = useParams();
  const queryClient = useQueryClient();
  const {
    isAdmin,
    canRecordScores,
    canRecordClassSubject,
    authUser,
    schoolId,
  } = useAuthContext();
  const { schoolData, adminSettings } = useSchoolBootstrap();
  const {
    selectedSessionId,
    selectedSessionName,
    selectedTermId,
    isHistoricalView,
    isReadOnlyView,
    isPastTermView,
  } = useSessionContext();

  const [isPreviewSaving, setIsPreviewSaving] = useState(false);
  const [isSavingScores, setIsSavingScores] = useState(false);
  const [scoreEditsByScope, setScoreEditsByScope] = useState({});

  const isTeacherLtcTraceEnabled =
    !isAdmin &&
    typeof window !== "undefined" &&
    window.localStorage?.getItem("scoorla_teacher_ltc_debug") === "1";
  const logTeacherLtcTrace = useCallback(
    (label, payload) => {
      if (!isTeacherLtcTraceEnabled) return;
      console.log("[TEACHER LTC]", label, payload);
    },
    [isTeacherLtcTraceEnabled]
  );

  const storedResultSelection = useMemo(
    () => canonicalizeResultSelection(getResultSelection(authUser?.uid), schoolId),
    [authUser?.uid, schoolId]
  );

  const routeSelection = useMemo(() => {
    const routeClassId = getClassIdFromRouteSegment(params.classSlug || "");
    if (!routeClassId) return null;

    const classStructure = adminSettings?.classStructure || {};
    const routeDepartment = resolveDepartmentFromRoute(
      classStructure,
      routeClassId,
      params.departmentSlug || ""
    );
    const routeSubjects = getDepartmentAwareSubjects(schoolId, routeClassId, {
      departmentId: String(routeDepartment?.id || "").trim(),
      classStructure,
      subjects: getBootstrapSubjectsByClass(schoolData, routeClassId),
    });
    const routeSubject = resolveSubjectFromRouteSegment(
      routeSubjects,
      params.subjectSlug || ""
    );

    return {
      class: routeClassId,
      subject: routeSubject,
      departmentId: String(routeDepartment?.id || "").trim(),
      departmentName: String(routeDepartment?.name || "").trim(),
    };
  }, [
    adminSettings?.classStructure,
    params.classSlug,
    params.departmentSlug,
    params.subjectSlug,
    schoolData,
    schoolId,
  ]);

  const resultSelection = useMemo(
    () => {
      const baseSelection = {
        ...storedResultSelection,
        sessionId: String(selectedSessionId || storedResultSelection?.sessionId || "").trim(),
        session: String(selectedSessionName || storedResultSelection?.session || "").trim(),
        term:
          String(selectedTermId || storedResultSelection?.term || "term1").trim() || "term1",
      };

      if (!routeSelection?.class) {
        return baseSelection;
      }

      return {
        ...baseSelection,
        class: routeSelection.class,
        subject: routeSelection.subject,
        departmentId: routeSelection.departmentId,
        departmentName: routeSelection.departmentName,
      };
    },
    [routeSelection, selectedSessionId, selectedSessionName, selectedTermId, storedResultSelection]
  );

  const resolvedTermId = resultSelection.term || "term1";
  const resolvedSessionId = resultSelection.sessionId || "";
  const selectedDepartments = getDepartmentsForClass(
    adminSettings?.classStructure || {},
    resultSelection.class
  );
  const hasDepartments = selectedDepartments.length > 0;
  const selectedDepartment =
    selectedDepartments.find(
      (department) =>
        String(department?.id || "").trim() === String(resultSelection.departmentId || "").trim()
    ) || null;
  const isMergedSubject =
    hasDepartments &&
    !!resultSelection.subject &&
    isMergedDepartmentSubject(
      adminSettings?.classStructure || {},
      resultSelection.class,
      resultSelection.subject
    );
  const requiresDepartmentSelection =
    hasDepartments && !selectedDepartment && !isMergedSubject;
  const isLtcTerm = shouldUseLastTermCumulative(resolvedTermId);
  const resultConfig = adminSettings?.resultConfig || null;
  const scoreComponents = useMemo(
    () => getEnabledScoreComponents(resultConfig),
    [resultConfig]
  );
  const scoreComponentMap = useMemo(
    () =>
      scoreComponents.reduce((acc, component) => {
        acc[component.key] = component;
        return acc;
      }, {}),
    [scoreComponents]
  );
  const emptyScoreRow = useMemo(
    () =>
      scoreComponents.reduce(
        (acc, component) => ({
          ...acc,
          [component.key]: "",
        }),
        { ltcOverride: "" }
      ),
    [scoreComponents]
  );
  const columnCount = useMemo(
    () => 1 + scoreComponents.length + (isLtcTerm ? 1 : 0),
    [isLtcTerm, scoreComponents.length]
  );

  const hasRecordAccess =
    isAdmin || canRecordClassSubject(resultSelection.class, resultSelection.subject);
  const hasScopedRecordAccess = hasRecordAccess && !requiresDepartmentSelection;
  const canEditScores = hasScopedRecordAccess && canRecordScores();

  const recordQueryKey = useMemo(
    () =>
      buildRecordDashboardQueryKey({
        schoolId,
        userId: authUser?.uid,
        classId: resultSelection.class,
        departmentId: resultSelection.departmentId,
        subjectId: resultSelection.subject,
        sessionId: resolvedSessionId,
        termId: resolvedTermId,
        isHistoricalView,
        isReadOnlyView,
      }),
    [
      authUser?.uid,
      isHistoricalView,
      isReadOnlyView,
      resolvedSessionId,
      resolvedTermId,
      resultSelection.class,
      resultSelection.departmentId,
      resultSelection.subject,
      schoolId,
    ]
  );

  const dirtyScoreScopeKey = useMemo(
    () =>
      buildDirtyScoreScopeKey({
        schoolId,
        userId: authUser?.uid,
        classId: resultSelection.class,
        departmentId: resultSelection.departmentId,
        subjectId: resultSelection.subject,
        sessionId: resolvedSessionId,
        termId: resolvedTermId,
      }),
    [
      authUser?.uid,
      resolvedSessionId,
      resolvedTermId,
      resultSelection.class,
      resultSelection.departmentId,
      resultSelection.subject,
      schoolId,
    ]
  );

  const fetchRecordDashboardData = useCallback(async () => {
    const classStructure = adminSettings?.classStructure || {};
    const baseRosterPromise =
      !isHistoricalView && !isReadOnlyView
        ? getRecordDashboardRoster(schoolId, resultSelection.class, resolvedSessionId, {
            termId: resolvedTermId,
          })
        : getDepartmentAwareClassStudents(schoolId, resultSelection.class, {
            sessionId: resolvedSessionId,
            termId: resolvedTermId,
            departmentId: resultSelection.departmentId,
            subjectId: resultSelection.subject,
            classStructure,
            includeInactive: isHistoricalView,
            includeDeleted: isHistoricalView,
          });

    const classStudentsPromise =
      !isHistoricalView && !isReadOnlyView
        ? baseRosterPromise.then((students) =>
            filterStudentsByDepartmentScope(students, classStructure, resultSelection.class, {
              departmentId: resultSelection.departmentId,
              subjectId: resultSelection.subject,
            })
          )
        : baseRosterPromise;

    const existingScoresPromise =
      !isHistoricalView && !isReadOnlyView
        ? getRecordDashboardScores(
            schoolId,
            resultSelection.class,
            resultSelection.subject,
            resolvedTermId,
            resolvedSessionId,
            {
              studentsPromise: classStudentsPromise,
              allowLegacyFallback: true,
              allowBroadLegacyFallback: false,
              preferContextQueryFirst: true,
            }
          )
        : classStudentsPromise.then((classStudents) =>
            getScores(
              schoolId,
              resultSelection.class,
              resultSelection.subject,
              resolvedTermId,
              resolvedSessionId,
              {
                allowLegacyFallback: true,
                allowBroadLegacyFallback: isHistoricalView || isReadOnlyView,
                preferContextQueryFirst: !isHistoricalView && !isReadOnlyView,
                students: classStudents || [],
              }
            )
          );

    const storedLtcPromise = isLtcTerm
      ? getStoredLastTermCumulativeMap({
          schoolId,
          classId: resultSelection.class,
          subjectId: resultSelection.subject,
          sessionId: resolvedSessionId,
          termId: resolvedTermId,
          bypassLocalCache: false,
        })
      : Promise.resolve({});

    const effectiveAdminSettingsPromise = isLtcTerm
      ? adminSettings
        ? Promise.resolve(adminSettings)
        : getAdminSettings(schoolId)
      : Promise.resolve(adminSettings || null);

    const [classStudents, existingScores, storedLtcMap, effectiveAdminSettings] =
      await Promise.all([
        classStudentsPromise,
        existingScoresPromise,
        storedLtcPromise,
        effectiveAdminSettingsPromise,
      ]);

    logTeacherLtcTrace("scores_returned", {
      schoolId,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
      classId: resultSelection.class,
      subjectId: resultSelection.subject,
      scoreStudentIds: Object.keys(existingScores || {}),
      sample: Object.entries(existingScores || {})
        .slice(0, 5)
        .map(([studentId, value]) => ({ studentId, value })),
    });

    const nextScores = {};
    (classStudents || []).forEach((student) => {
      nextScores[student.id] = {
        ...emptyScoreRow,
        ...(existingScores?.[student.id] || {}),
      };
    });

    let nextLtcByStudent = {};
    let nextLtcUiMeta = EMPTY_LTC_UI_META;

    if (isLtcTerm) {
      logTeacherLtcTrace("load_context", {
        schoolId,
        sessionId: resolvedSessionId,
        termId: resolvedTermId,
        classId: resultSelection.class,
        subjectId: resultSelection.subject,
        storedStudentIds: Object.keys(storedLtcMap || {}),
        storedSample: Object.entries(storedLtcMap || {}).slice(0, 5),
      });

      const displayedStudentIds = (classStudents || [])
        .map((student) => String(student?.id || "").trim())
        .filter(Boolean);
      const hasStoredLtcRows = Object.keys(storedLtcMap || {}).length > 0;
      const storedValuesForDisplayedStudents = displayedStudentIds.map(
        (studentId) => Number(storedLtcMap?.[studentId] || 0)
      );
      const storedMapLooksEmpty =
        !hasStoredLtcRows ||
        (storedValuesForDisplayedStudents.length > 0 &&
          storedValuesForDisplayedStudents.every((value) => Number(value) === 0));

      let effectiveLtcMap = storedLtcMap || {};

      if (storedMapLooksEmpty && (classStudents || []).length > 0) {
        try {
          effectiveLtcMap = await getLastTermCumulativeMap(
            schoolId,
            resultSelection.class,
            resultSelection.subject,
            resolvedTermId,
            resolvedSessionId,
            resultConfig,
            classStudents || []
          );
        } catch (ltcError) {
          console.warn("LTC fallback compute skipped:", ltcError?.message || ltcError);
          effectiveLtcMap = {};
        }
      }

      const scoreRowLtcMap = Object.fromEntries(
        (classStudents || []).map((student) => {
          const normalizedStudentId = String(student?.id || "").trim();
          const scoreRow = existingScores?.[normalizedStudentId] || {};
          const manualOverride = scoreRow?.ltcOverride;
          if (manualOverride !== "" && manualOverride !== null && manualOverride !== undefined) {
            return [normalizedStudentId, Math.round(Number(manualOverride) || 0)];
          }
          if (
            scoreRow?.lastTermCumulativeCache !== null &&
            scoreRow?.lastTermCumulativeCache !== undefined &&
            scoreRow?.lastTermCumulativeCache !== ""
          ) {
            return [
              normalizedStudentId,
              Math.round(Number(scoreRow?.lastTermCumulativeCache) || 0),
            ];
          }
          return [normalizedStudentId, 0];
        })
      );
      const scoreRowHasUsefulLtc = Object.values(scoreRowLtcMap).some(
        (value) => Number(value) > 0
      );
      const effectiveLtcHasUsefulValues = Object.values(effectiveLtcMap || {}).some(
        (value) => Number(value) > 0
      );
      if (!effectiveLtcHasUsefulValues && scoreRowHasUsefulLtc) {
        effectiveLtcMap = scoreRowLtcMap;
      }

      logTeacherLtcTrace("ltc_values_selected", {
        schoolId,
        sessionId: resolvedSessionId,
        termId: resolvedTermId,
        classId: resultSelection.class,
        subjectId: resultSelection.subject,
        hasStoredLtcRows,
        storedMapLooksEmpty,
        scoreRowHasUsefulLtc,
        effectiveStudentIds: Object.keys(effectiveLtcMap || {}),
        effectiveSample: Object.entries(effectiveLtcMap || {}).slice(0, 5),
      });

      nextLtcByStudent = Object.fromEntries(
        (classStudents || []).map((student) => {
          const normalizedStudentId = String(student?.id || "").trim();
          return [normalizedStudentId, Math.round(Number(effectiveLtcMap?.[normalizedStudentId] || 0))];
        })
      );

      const currentTermOrder = getTermOrder(resolvedTermId);
      const previousTermOrder = Math.max(0, currentTermOrder - 1);
      const initialTermOrder = getTermOrder(effectiveAdminSettings?.initialTermId);
      const currentSessionName = resultSelection.session || selectedSessionName || "";
      nextLtcUiMeta = {
        currentTermOrder,
        allowClassWideManualOnZero:
          previousTermOrder > 0 &&
          initialTermOrder > 0 &&
          previousTermOrder < initialTermOrder &&
          String(effectiveAdminSettings?.initialSessionName || "").trim() ===
            String(currentSessionName || "").trim(),
      };

      logTeacherLtcTrace("ltc_final_before_render", {
        schoolId,
        sessionId: resolvedSessionId,
        termId: resolvedTermId,
        classId: resultSelection.class,
        subjectId: resultSelection.subject,
        finalStudentIds: Object.keys(nextLtcByStudent || {}),
        finalSample: Object.entries(nextLtcByStudent || {}).slice(0, 5),
      });

      const computedHasUsefulValues = displayedStudentIds.some(
        (studentId) => Number(effectiveLtcMap?.[studentId] || 0) !== 0
      );

      if (computedHasUsefulValues) {
        void syncStoredLastTermCumulativeMap({
          schoolId,
          classId: resultSelection.class,
          subjectId: resultSelection.subject,
          sessionId: resolvedSessionId,
          termId: resolvedTermId,
          values: nextLtcByStudent,
          bypassBaselineLocalCache: true,
        }).catch((cacheError) => {
          console.warn("LTC cache sync skipped:", cacheError?.message || cacheError);
        });

        void syncCurrentScoreRowsLastTermCumulativeCache({
          schoolId,
          classId: resultSelection.class,
          subjectId: resultSelection.subject,
          sessionId: resolvedSessionId,
          termId: resolvedTermId,
          students: classStudents || [],
          values: nextLtcByStudent,
        }).catch((cacheError) => {
          console.warn("Current score LTC cache sync skipped:", cacheError?.message || cacheError);
        });
      }
    }

    return {
      students: classStudents || [],
      scores: nextScores,
      ltcByStudent: nextLtcByStudent,
      ltcUiMeta: nextLtcUiMeta,
    };
  }, [
    adminSettings,
    emptyScoreRow,
    isHistoricalView,
    isLtcTerm,
    isReadOnlyView,
    logTeacherLtcTrace,
    resolvedSessionId,
    resolvedTermId,
    resultConfig,
    resultSelection.class,
    resultSelection.departmentId,
    resultSelection.session,
    resultSelection.subject,
    schoolId,
    selectedSessionName,
  ]);

  const recordQuery = useQuery({
    queryKey: recordQueryKey,
    queryFn: fetchRecordDashboardData,
    enabled: Boolean(
      resultSelection.class &&
        resultSelection.subject &&
        resolvedSessionId &&
        resolvedTermId &&
        hasScopedRecordAccess
    ),
    staleTime: RECORD_DASHBOARD_STALE_TIME,
    gcTime: RECORD_DASHBOARD_GC_TIME,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const baseRecordData = recordQuery.data || EMPTY_RECORD_DASHBOARD_DATA;
  const students = useMemo(() => baseRecordData.students || [], [baseRecordData.students]);
  const baseScores = useMemo(() => baseRecordData.scores || {}, [baseRecordData.scores]);
  const ltcByStudent = useMemo(
    () => baseRecordData.ltcByStudent || {},
    [baseRecordData.ltcByStudent]
  );
  const ltcUiMeta = useMemo(
    () => baseRecordData.ltcUiMeta || EMPTY_LTC_UI_META,
    [baseRecordData.ltcUiMeta]
  );
  const dirtyScores = useMemo(
    () => scoreEditsByScope?.[dirtyScoreScopeKey] || {},
    [dirtyScoreScopeKey, scoreEditsByScope]
  );

  const scores = useMemo(() => {
    const mergedScores = {};
    const scoreStudentIds = new Set([
      ...Object.keys(baseScores || {}),
      ...Object.keys(dirtyScores || {}),
      ...(students || []).map((student) => String(student?.id || "").trim()).filter(Boolean),
    ]);

    scoreStudentIds.forEach((studentId) => {
      mergedScores[studentId] = {
        ...emptyScoreRow,
        ...(baseScores?.[studentId] || {}),
        ...(dirtyScores?.[studentId] || {}),
      };
    });

    return mergedScores;
  }, [baseScores, dirtyScores, emptyScoreRow, students]);

  const hasUnsavedChanges = Object.keys(dirtyScores || {}).length > 0;
  const isLoading =
    Boolean(resultSelection.class && resultSelection.subject && hasScopedRecordAccess) &&
    recordQuery.isPending &&
    !recordQuery.data;
  const isTableLoading = isLoading;

  const setDirtyScoresForScope = useCallback(
    (updater) => {
      setScoreEditsByScope((prev) => {
        const currentScopeScores = prev?.[dirtyScoreScopeKey] || {};
        const nextScopeScores = typeof updater === "function" ? updater(currentScopeScores) : updater;
        if (!nextScopeScores || Object.keys(nextScopeScores).length === 0) {
          if (!prev?.[dirtyScoreScopeKey]) return prev;
          const next = { ...(prev || {}) };
          delete next[dirtyScoreScopeKey];
          return next;
        }
        return {
          ...(prev || {}),
          [dirtyScoreScopeKey]: nextScopeScores,
        };
      });
    },
    [dirtyScoreScopeKey]
  );

  const clearDirtyScoresForScope = useCallback(() => {
    setDirtyScoresForScope({});
  }, [setDirtyScoresForScope]);

  const getTermLabel = (termId) => TERM_LABELS[termId] || termId;

  const buildPreviewOverrideKey = (sessionId, termId) =>
    `preview_scores_${schoolId || ""}_${resultSelection.class || ""}_${resultSelection.departmentId || "all"}_${resultSelection.subject || ""}_${sessionId || ""}_${termId || ""}`;

  const handleScoreChange = (studentId, scoreType, value) => {
    if (isReadOnlyView || !canEditScores) return;

    const numValue = value === "" ? "" : parseFloat(value) || 0;

    let limitedValue;
    if (value === "") {
      limitedValue = "";
    } else if (scoreType === "ltcOverride") {
      limitedValue = Math.max(0, Math.min(100, numValue));
    } else {
      const componentMax = Number(scoreComponentMap?.[scoreType]?.max);
      const resolvedMax = Number.isFinite(componentMax) ? componentMax : 100;
      limitedValue = Math.max(0, Math.min(resolvedMax, numValue));
    }

    setDirtyScoresForScope((prev) => ({
      ...(prev || {}),
      [studentId]: {
        ...(scores?.[studentId] || emptyScoreRow),
        [scoreType]: limitedValue,
      },
    }));
  };

  const shouldShowManualLtcInput = (student) => {
    if (!isLtcTerm) return false;

    const computedLtc = Number(ltcByStudent?.[student?.id] || 0);
    if (computedLtc !== 0) return false;
    if (ltcUiMeta.allowClassWideManualOnZero) return true;

    const currentTermOrder = Number(ltcUiMeta.currentTermOrder || 1);
    const entryTermOrder = Number(student?.entryTermOrder || 0);
    if (!entryTermOrder) return false;

    return currentTermOrder >= 3 && entryTermOrder >= currentTermOrder;
  };

  const flushDirtyScores = async ({ audit = true, source = "manual_save" } = {}) => {
    if (
      isReadOnlyView ||
      !canEditScores ||
      !resolvedSessionId ||
      !schoolId ||
      !resultSelection.class ||
      !resultSelection.subject
    ) {
      return false;
    }

    const dirtyEntries = Object.entries(dirtyScores || {});
    if (dirtyEntries.length === 0) {
      return true;
    }

    const dirtyPayload = dirtyEntries.reduce((acc, [studentId, value]) => {
      acc[studentId] = value;
      return acc;
    }, {});
    const adminFullPayload = (students || []).reduce((acc, student) => {
      const studentId = String(student?.id || "").trim();
      if (!studentId) return acc;
      acc[studentId] = scores?.[studentId] || {};
      return acc;
    }, {});
    const payloadToSave = isAdmin && source !== "autosave" ? adminFullPayload : dirtyPayload;

    setIsSavingScores(true);
    try {
      await saveScores(
        schoolId,
        resultSelection.class,
        resultSelection.subject,
        payloadToSave,
        resolvedTermId,
        resolvedSessionId,
        { audit, source }
      );

      queryClient.setQueryData(recordQueryKey, (current) => {
        const base = current || EMPTY_RECORD_DASHBOARD_DATA;
        return {
          ...base,
          scores: {
            ...(base?.scores || {}),
            ...(payloadToSave || {}),
          },
          students: base?.students || students || [],
          ltcByStudent: base?.ltcByStudent || ltcByStudent || {},
          ltcUiMeta: base?.ltcUiMeta || ltcUiMeta || EMPTY_LTC_UI_META,
        };
      });
      clearDirtyScoresForScope();
      return true;
    } catch (error) {
      console.error("Error saving scores:", error);
      return false;
    } finally {
      setIsSavingScores(false);
    }
  };

  const handleSaveScores = async () => {
    if (isSavingScores || isPreviewSaving || !hasUnsavedChanges) return;
    const ok = await flushDirtyScores({ audit: true, source: "manual_save" });
    if (!ok) {
      alert("Unable to save scores. Please check your permissions and retry.");
    }
  };

  const handlePreviewResult = async () => {
    if (!hasScopedRecordAccess || isPreviewSaving) return;

    try {
      setIsPreviewSaving(true);

      try {
        sessionStorage.setItem(
          buildPreviewOverrideKey(resolvedSessionId, resolvedTermId),
          JSON.stringify(scores || {})
        );
      } catch (cacheError) {
        console.warn("Unable to cache preview scores override:", cacheError?.message || cacheError);
      }

      if (!isReadOnlyView && canEditScores && resolvedSessionId && schoolId && resultSelection.class && resultSelection.subject) {
        if (hasUnsavedChanges) {
          const saved = await flushDirtyScores({
            audit: true,
            source: "preview_submit",
          });
          if (!saved) {
            alert("Unable to save latest scores before preview.");
            return;
          }
        }
      }

      navigate("/result-preview");
    } catch (error) {
      console.error("Error preparing preview:", error);
      alert(`Unable to open preview: ${error?.message || "Unknown error"}`);
    } finally {
      setIsPreviewSaving(false);
    }
  };

  if (!authUser?.uid) {
    return <Navigate to="/login" replace />;
  }

  if (!schoolId) {
    return <Navigate to="/welcome" replace />;
  }

  return (
    <div className="min-h-screen bg-white p-4 dark:bg-gray-900 md:p-8">
      {isLoading ? (
        <>
          <div className="mb-8 rounded-lg bg-gradient-to-r from-blue-50 to-blue-100 p-6 dark:from-gray-800 dark:to-gray-700 md:p-8">
            <div className="grid grid-cols-2 items-center gap-3 md:grid-cols-4 md:gap-6">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`record-header-skeleton-${index}`} className="min-w-0">
                  <div className="h-3 w-16 animate-pulse rounded bg-blue-100 dark:bg-gray-600" />
                  <div className="mt-2 h-5 w-full max-w-[11rem] animate-pulse rounded bg-blue-200 dark:bg-gray-500" />
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-lg bg-white p-3 dark:bg-gray-700">
              <div className="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-600" />
              <div className="mt-2 h-5 w-full max-w-sm animate-pulse rounded bg-gray-300 dark:bg-gray-500" />
            </div>
          </div>

          <div className="mb-8 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-4 text-left md:px-6">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 md:text-sm">
                      Student Name
                    </span>
                  </th>
                  {scoreComponents.map((component) => (
                    <th key={component.key} className="px-4 py-4 text-center md:px-6">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 md:text-sm">
                        {component.label} (0-{component.max})
                      </span>
                    </th>
                  ))}
                  {isLtcTerm ? (
                    <th className="px-4 py-4 text-center md:px-6">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 md:text-sm">
                        LTC
                      </span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {Array.from({ length: 6 }).map((_, rowIndex) => (
                  <tr key={`record-skeleton-${rowIndex}`}>
                    <td className="px-4 py-4 md:px-6">
                      <div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                    </td>
                    {scoreComponents.map((component) => (
                      <td key={`${component.key}-${rowIndex}`} className="px-1 py-4 md:px-6">
                        <div className="h-10 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                      </td>
                    ))}
                    {isLtcTerm ? (
                      <td className="px-1 py-4 md:px-6">
                        <div className="h-10 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-center gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`record-action-skeleton-${index}`}
                className="h-11 w-32 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"
              />
            ))}
          </div>
        </>
      ) : (
        <>
          {isReadOnlyView ? (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {isHistoricalView
                ? "Viewing historical session data. Changes will NOT affect the active session."
                : isPastTermView
                  ? "Viewing a past term. Scores are read-only until you return to the current term."
                  : "This view is read-only."}
            </div>
          ) : null}

          {requiresDepartmentSelection ? (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 dark:border-blue-800 dark:bg-blue-900/20">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                    Select a department to continue.
                  </p>
                  <p className="mt-1 text-xs text-blue-800/90 dark:text-blue-200/90">
                    This subject is scoped by department, so the record sheet needs the correct department roster.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {selectedDepartments.map((department) => (
                    <button
                      key={department.id}
                      type="button"
                      onClick={() =>
                        navigate(
                          buildRecordDashboardPath({
                            classId: resultSelection.class,
                            departmentId: department.id,
                            subjectId: resultSelection.subject,
                            classStructure: adminSettings?.classStructure || {},
                          })
                        )
                      }
                      className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-blue-800 transition-all duration-300 hover:bg-blue-100 dark:bg-gray-800 dark:text-blue-300 dark:hover:bg-gray-700"
                    >
                      {department.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {!hasRecordAccess ? (
            <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
              You are not assigned to this resource
            </div>
          ) : null}

          <div className="mb-8 rounded-lg bg-gradient-to-r from-blue-50 to-blue-100 p-6 dark:from-gray-800 dark:to-gray-700 md:p-8">
            <div className="grid grid-cols-2 items-center gap-3 md:grid-cols-4 md:gap-6">
              <div className="flex items-center gap-3">
                {schoolData.logo ? (
                  <img
                    src={schoolData.logo}
                    alt={schoolData.name}
                    className="h-12 w-12 rounded-full border-2 border-blue-800 object-cover"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="text-xs text-gray-600 dark:text-gray-400">School</p>
                  <p className="truncate text-xs font-bold text-black dark:text-white md:text-sm">
                    {schoolData.name}
                  </p>
                </div>
              </div>

              <div className="min-w-0">
                <p className="text-xs text-gray-600 dark:text-gray-400">Class</p>
                <p className="text-xs font-bold text-black dark:text-white md:text-sm">
                  {formatScopedClassLabel(
                    resultSelection.class,
                    isMergedSubject
                      ? ""
                      : selectedDepartment?.name || resultSelection.departmentName
                  )}
                </p>
              </div>

              <div className="min-w-0 max-md:ml-15">
                <p className="text-xs text-gray-600 dark:text-gray-400">Term</p>
                <p className="text-xs font-bold text-black dark:text-white md:text-sm">
                  {getTermLabel(resolvedTermId)}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-xs text-gray-600 dark:text-gray-400">Session</p>
                <p className="text-xs font-bold text-black dark:text-white md:text-sm">
                  {selectedSessionName ||
                    (resultSelection.session && resultSelection.session !== "N/A"
                      ? resultSelection.session
                      : "Not set")}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-white p-3 dark:bg-gray-700">
              <p className="text-xs text-gray-600 dark:text-gray-400">Subject</p>
              <p className="text-sm font-bold text-black dark:text-white md:text-base">
                {resultSelection.subject}
              </p>
              {isMergedSubject ? (
                <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
                  Shared subject: this sheet includes the full class roster across departments.
                </p>
              ) : null}
            </div>
          </div>

          <div className="mb-8 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-4 text-left md:px-6">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 md:text-sm">
                      Student Name
                    </span>
                  </th>
                  {scoreComponents.map((component) => (
                    <th key={component.key} className="px-4 py-4 text-center md:px-6">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 md:text-sm">
                        {component.label} (0-{component.max})
                      </span>
                    </th>
                  ))}
                  {isLtcTerm ? (
                    <th className="px-4 py-4 text-center md:px-6">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 md:text-sm">
                        LTC
                      </span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {isTableLoading ? (
                  Array.from({ length: 5 }).map((_, rowIndex) => (
                    <tr key={`record-skeleton-${rowIndex}`}>
                      <td className="px-4 py-4 md:px-6">
                        <div className="h-4 w-36 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                      </td>
                      {scoreComponents.map((component) => (
                        <td key={`${component.key}-${rowIndex}`} className="px-1 py-4 md:px-6">
                          <div className="h-10 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                        </td>
                      ))}
                      {isLtcTerm ? (
                        <td className="px-1 py-4 md:px-6">
                          <div className="h-10 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                        </td>
                      ) : null}
                    </tr>
                  ))
                ) : students.length > 0 ? (
                  students.map((student) => {
                    const showManualLtcInput = shouldShowManualLtcInput(student);
                    const computedLtc = Math.round(Number(ltcByStudent?.[student.id] || 0));

                    return (
                      <tr
                        key={student.id}
                        className="transition-colors duration-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <td className="px-4 py-4 md:px-6">
                          <p className="text-xs font-medium text-black dark:text-white md:text-sm">
                            {student.name}
                          </p>
                        </td>
                        {scoreComponents.map((component) => (
                          <td key={component.key} className="px-1 py-4 md:px-6">
                            <input
                              type="number"
                              min="0"
                              max={component.max}
                              value={scores[student.id]?.[component.key] ?? ""}
                              onChange={(e) =>
                                handleScoreChange(student.id, component.key, e.target.value)
                              }
                              disabled={isReadOnlyView || !canEditScores}
                              className="input w-full text-center text-xs md:text-sm"
                              placeholder="--"
                            />
                          </td>
                        ))}
                        {isLtcTerm ? (
                          <td className="px-1 py-4 text-center md:px-6">
                            {showManualLtcInput ? (
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={scores[student.id]?.ltcOverride ?? ""}
                                onChange={(e) =>
                                  handleScoreChange(student.id, "ltcOverride", e.target.value)
                                }
                                disabled={isReadOnlyView || !canEditScores}
                                className="input w-full text-center text-xs md:text-sm"
                                placeholder="0"
                              />
                            ) : (
                              <span className="flex w-full items-center justify-center text-xs font-semibold text-gray-700 dark:text-gray-300 md:text-sm">
                                {computedLtc}
                              </span>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={columnCount} className="px-6 py-8 text-center">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {requiresDepartmentSelection
                          ? "Select a department to load this subject roster."
                          : "No students in this class"}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-center gap-4">
            <button
              onClick={() => navigate("/school-dashboard")}
              className="rounded-lg border-2 border-gray-300 px-8 py-2 font-semibold text-black transition-all duration-300 hover:bg-gray-100 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
            >
              Back
            </button>
            <button
              onClick={handleSaveScores}
              disabled={
                !hasScopedRecordAccess ||
                isPreviewSaving ||
                isSavingScores ||
                !hasUnsavedChanges ||
                isReadOnlyView
              }
              className="rounded-lg bg-emerald-600 px-8 py-2 font-semibold text-white transition-all duration-300 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-700 dark:hover:bg-emerald-600"
            >
              {isSavingScores ? "Saving..." : hasUnsavedChanges ? "Save Scores" : "Saved"}
            </button>
            <button
              onClick={handlePreviewResult}
              disabled={!hasScopedRecordAccess || isPreviewSaving || isSavingScores}
              className="rounded-lg bg-blue-800 px-8 py-2 font-semibold text-white transition-all duration-300 hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
            >
              {isPreviewSaving ? "Preparing..." : "Preview Result"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}








