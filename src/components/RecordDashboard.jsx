import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  canonicalizeResultSelection,
  cleanupMalformedScores,
  getAdminSettings,
  getEnabledScoreComponents,
  getLastTermCumulativeMap,
  getRecordDashboardRoster,
  getRecordDashboardScores,
  getResultSelection,
  getScores,
  getStoredLastTermCumulativeMap,
  saveScores,
  shouldUseLastTermCumulative,
  getClassStudents,
  syncCurrentScoreRowsLastTermCumulativeCache,
  syncStoredLastTermCumulativeMap,
} from "./utils/school-data";
import { useSessionContext } from "../context/SessionContext";
import { useAuthContext } from "../context/AuthContext";
import { useSchoolBootstrap } from "../context/SchoolBootstrapContext";

const TERM_LABELS = {
  term1: "First Term",
  term2: "Second Term",
  term3: "Third Term",
  "1st": "First Term",
  "2nd": "Second Term",
  "3rd": "Third Term",
};

const CLASS_LABELS = {
  jss1: "JSS 1",
  jss2: "JSS 2",
  jss3: "JSS 3",
  sss1: "SSS 1",
  sss2: "SSS 2",
  sss3: "SSS 3",
};

const getTermOrder = (termId) => {
  const normalized = String(termId || "").trim().toLowerCase();
  if (normalized === "term2" || normalized === "2nd") return 2;
  if (normalized === "term3" || normalized === "3rd") return 3;
  return 1;
};

const buildRecordSnapshotKey = ({
  schoolId,
  userId,
  classId,
  subjectId,
  sessionId,
  termId,
}) =>
  [
    "recordDashboardSnapshot",
    String(schoolId || "").trim(),
    String(userId || "").trim(),
    String(classId || "").trim(),
    String(subjectId || "").trim(),
    String(sessionId || "").trim(),
    String(termId || "").trim(),
  ].join("__");

const readRecordSnapshot = (key) => {
  try {
    const raw = sessionStorage.getItem(String(key || ""));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeRecordSnapshot = (key, value) => {
  try {
    sessionStorage.setItem(String(key || ""), JSON.stringify(value));
  } catch {
    // no-op
  }
};

export default function RecordDashboard() {
  const navigate = useNavigate();
  const {
    isAdmin,
    canRecordScores,
    canRecordClassSubject,
    authUser,
    schoolId,
  } = useAuthContext();
  const {
    schoolData,
    adminSettings,
    isLoading: isBootstrapLoading,
  } = useSchoolBootstrap();
  const {
    selectedSessionId,
    selectedSessionName,
    selectedTermId,
    isHistoricalView,
    isReadOnlyView,
    isPastTermView,
    isLoading: isSessionLoading,
  } = useSessionContext();

  const [resultSelection, setResultSelection] = useState({});
  const [students, setStudents] = useState([]);
  const [scores, setScores] = useState({});
  const [ltcByStudent, setLtcByStudent] = useState({});
  const [ltcUiMeta, setLtcUiMeta] = useState({
    currentTermOrder: 1,
    allowClassWideManualOnZero: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isTableLoading, setIsTableLoading] = useState(true);
  const [isPreviewSaving, setIsPreviewSaving] = useState(false);
  const [isSavingScores, setIsSavingScores] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const hasScoreChangesRef = useRef(false);
  const dirtyScoresRef = useRef({});
  const loadVersionRef = useRef(0);
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

  const hasRecordAccess =
    isAdmin || canRecordClassSubject(resultSelection.class, resultSelection.subject);
  const canEditScores = hasRecordAccess && canRecordScores();
  const resolvedTermId = selectedTermId || resultSelection.term || "term1";
  const resolvedSessionId = selectedSessionId || resultSelection.sessionId || "";
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
  const columnCount = useMemo(
    () => 1 + scoreComponents.length + (isLtcTerm ? 1 : 0),
    [isLtcTerm, scoreComponents.length]
  );
  const recordSnapshotKey = useMemo(
    () =>
      buildRecordSnapshotKey({
        schoolId,
        userId: authUser?.uid,
        classId: resultSelection.class,
        subjectId: resultSelection.subject,
        sessionId: resolvedSessionId,
        termId: resolvedTermId,
      }),
    [
      authUser?.uid,
      resolvedSessionId,
      resolvedTermId,
      resultSelection.class,
      resultSelection.subject,
      schoolId,
    ]
  );

  const getClassLabel = (classId) => CLASS_LABELS[classId] || classId;
  const getTermLabel = (termId) => TERM_LABELS[termId] || termId;

  const buildPreviewOverrideKey = (sessionId, termId) =>
    `preview_scores_${schoolId || ""}_${resultSelection.class || ""}_${resultSelection.subject || ""}_${sessionId || ""}_${termId || ""}`;

  useEffect(() => {
    const loadData = async () => {
      try {
        if (isBootstrapLoading) return;
        if (!authUser?.uid) {
          navigate("/login", { replace: true });
          return;
        }
        if (!schoolId) {
          navigate("/welcome", { replace: true });
          return;
        }

        if (isAdmin) {
          void cleanupMalformedScores(schoolId).catch((cleanupError) => {
            console.warn("Score cleanup skipped:", cleanupError?.message || cleanupError);
          });
        }

        setResultSelection(
          canonicalizeResultSelection(getResultSelection(authUser?.uid), schoolId)
        );
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [authUser?.uid, isAdmin, isBootstrapLoading, navigate, schoolId]);

  useEffect(() => {
    if (!selectedSessionId) return;

    setResultSelection((prev) => {
      if (!prev || !prev.class) return prev;

      if (
        prev.sessionId === selectedSessionId &&
        prev.session === selectedSessionName &&
        prev.term === selectedTermId
      ) {
        return prev;
      }

      return {
        ...prev,
        sessionId: selectedSessionId,
        session: selectedSessionName || prev.session,
        term: selectedTermId || prev.term || "term1",
      };
    });
  }, [selectedSessionId, selectedSessionName, selectedTermId]);

  useEffect(() => {
    if (
      isBootstrapLoading ||
      isSessionLoading ||
      !authUser?.uid ||
      !schoolId ||
      !selectedSessionId ||
      !resultSelection.class ||
      !resultSelection.subject
    ) {
      return;
    }

    let cancelled = false;
    const loadVersion = ++loadVersionRef.current;
    const isCurrentLoad = () => !cancelled && loadVersionRef.current === loadVersion;

    const loadScores = async () => {
      const cachedSnapshot = readRecordSnapshot(recordSnapshotKey);
      if (cachedSnapshot && isCurrentLoad()) {
        setStudents(Array.isArray(cachedSnapshot?.students) ? cachedSnapshot.students : []);
        setScores(cachedSnapshot?.scores || {});
        setLtcByStudent(cachedSnapshot?.ltcByStudent || {});
        setLtcUiMeta(
          cachedSnapshot?.ltcUiMeta || {
            currentTermOrder: 1,
            allowClassWideManualOnZero: false,
          }
        );
        setIsTableLoading(false);
      } else {
        if (isCurrentLoad()) {
          setIsTableLoading(true);
        }
      }
      try {
        if (!hasRecordAccess) {
          if (isCurrentLoad()) {
            setStudents([]);
            setScores({});
            setLtcByStudent({});
            setLtcUiMeta({
              currentTermOrder: 1,
              allowClassWideManualOnZero: false,
            });
          }
          return;
        }

        const classStudentsPromise =
          !isHistoricalView && !isReadOnlyView
            ? getRecordDashboardRoster(
                schoolId,
                resultSelection.class,
                resolvedSessionId,
                {
                  termId: resolvedTermId,
                }
              )
            : getClassStudents(schoolId, resultSelection.class, {
                sessionId: resolvedSessionId,
                termId: resolvedTermId,
                includeInactive: isHistoricalView,
                includeDeleted: isHistoricalView,
              });
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

        const classStudents = await classStudentsPromise;
        if (!isCurrentLoad()) return;
        const existingScores =
          !isHistoricalView && !isReadOnlyView
            ? await getRecordDashboardScores(
                schoolId,
                resultSelection.class,
                resultSelection.subject,
                resolvedTermId,
                resolvedSessionId,
                {
                  students: classStudents || [],
                  allowLegacyFallback: true,
                  allowBroadLegacyFallback: false,
                  preferContextQueryFirst: true,
                }
              )
            : await getScores(
                schoolId,
                resultSelection.class,
                resultSelection.subject,
                resolvedTermId,
                resolvedSessionId,
                {
                  // Keep legacy fallback on for active views too so teacher/admin read
                  // the same historical score rows while canonical docs are rebuilt.
                  allowLegacyFallback: true,
                  allowBroadLegacyFallback: isHistoricalView || isReadOnlyView,
                  preferContextQueryFirst: !isHistoricalView && !isReadOnlyView,
                  students: classStudents || [],
                }
              );
        if (!isCurrentLoad()) return;
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

        const emptyRow = scoreComponents.reduce(
          (acc, component) => ({
            ...acc,
            [component.key]: "",
          }),
          { ltcOverride: "" }
        );

        const nextScores = {};
        (classStudents || []).forEach((student) => {
          nextScores[student.id] = {
            ...emptyRow,
            ...(existingScores?.[student.id] || {}),
          };
        });
        let nextLtcByStudent = {};
        let nextLtcUiMeta = {
          currentTermOrder: 1,
          allowClassWideManualOnZero: false,
        };

        setStudents(classStudents || []);
        hasScoreChangesRef.current = false;
        dirtyScoresRef.current = {};
        setHasUnsavedChanges(false);
        setScores(nextScores);
        writeRecordSnapshot(recordSnapshotKey, {
          students: classStudents || [],
          scores: nextScores,
          ltcByStudent: nextLtcByStudent,
          ltcUiMeta: nextLtcUiMeta,
          savedAt: Date.now(),
        });
        setIsTableLoading(false);

        if (isLtcTerm) {
          const [storedLtcMap, effectiveAdminSettings] = await Promise.all([
            storedLtcPromise,
            effectiveAdminSettingsPromise,
          ]);
          if (!isCurrentLoad()) return;
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
            (
              storedValuesForDisplayedStudents.length > 0 &&
              storedValuesForDisplayedStudents.every((value) => Number(value) === 0)
            );

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
            if (!isCurrentLoad()) return;
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
            (v) => Number(v) > 0
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

          const ltcEntries = (classStudents || []).map((student) => {
            const normalizedStudentId = String(student?.id || "").trim();
            const storedValue = effectiveLtcMap?.[normalizedStudentId];
            return [
              normalizedStudentId,
              Math.round(Number(storedValue) || 0),
            ];
          });

          const currentTermOrder = getTermOrder(resolvedTermId);
          const previousTermOrder = Math.max(0, currentTermOrder - 1);
          const initialTermOrder = getTermOrder(effectiveAdminSettings?.initialTermId);
          const currentSessionName = resultSelection.session || selectedSessionName || "";
          nextLtcByStudent = Object.fromEntries(ltcEntries);
          nextLtcUiMeta = {
            currentTermOrder,
            allowClassWideManualOnZero:
              previousTermOrder > 0 &&
              initialTermOrder > 0 &&
              previousTermOrder < initialTermOrder &&
              String(effectiveAdminSettings?.initialSessionName || "").trim() ===
                String(currentSessionName || "").trim(),
          };

          if (!isCurrentLoad()) return;
          setLtcByStudent(nextLtcByStudent);
          setLtcUiMeta(nextLtcUiMeta);
          logTeacherLtcTrace("ltc_final_before_render", {
            schoolId,
            sessionId: resolvedSessionId,
            termId: resolvedTermId,
            classId: resultSelection.class,
            subjectId: resultSelection.subject,
            finalStudentIds: Object.keys(nextLtcByStudent || {}),
            finalSample: Object.entries(nextLtcByStudent || {}).slice(0, 5),
          });

          const computedValuesForDisplayedStudents = displayedStudentIds.map(
            (studentId) => Number(effectiveLtcMap?.[studentId] || 0)
          );
          const computedHasUsefulValues = computedValuesForDisplayedStudents.some(
            (value) => Number(value) !== 0
          );

          if (computedHasUsefulValues) {
            void (async () => {
              try {
                const computedLtcMap =
                  effectiveLtcMap && Object.keys(effectiveLtcMap).length > 0
                    ? effectiveLtcMap
                    : await getLastTermCumulativeMap(
                        schoolId,
                        resultSelection.class,
                        resultSelection.subject,
                        resolvedTermId,
                        resolvedSessionId,
                        resultConfig,
                        classStudents || []
                      );
                if (cancelled) return;
                const computedEntries = (classStudents || []).map((student) => {
                  const normalizedStudentId = String(student?.id || "").trim();
                  return [
                    normalizedStudentId,
                    Math.round(Number(computedLtcMap?.[normalizedStudentId] || 0)),
                  ];
                });
                const computedLtcByStudent = Object.fromEntries(computedEntries);
                setLtcByStudent(computedLtcByStudent);
                void syncStoredLastTermCumulativeMap({
                  schoolId,
                  classId: resultSelection.class,
                  subjectId: resultSelection.subject,
                  sessionId: resolvedSessionId,
                  termId: resolvedTermId,
                  values: computedLtcByStudent,
                  bypassBaselineLocalCache: true,
                });
                void syncCurrentScoreRowsLastTermCumulativeCache({
                  schoolId,
                  classId: resultSelection.class,
                  subjectId: resultSelection.subject,
                  sessionId: resolvedSessionId,
                  termId: resolvedTermId,
                  students: classStudents || [],
                  values: computedLtcByStudent,
                });
                writeRecordSnapshot(recordSnapshotKey, {
                  students: classStudents || [],
                  scores: nextScores,
                  ltcByStudent: computedLtcByStudent,
                  ltcUiMeta: nextLtcUiMeta,
                  savedAt: Date.now(),
                });
              } catch (cacheError) {
                console.warn("LTC cache sync skipped:", cacheError?.message || cacheError);
              }
            })();
          }
        } else {
          if (!isCurrentLoad()) return;
          setLtcByStudent({});
          setLtcUiMeta(nextLtcUiMeta);
        }
      } catch (error) {
        console.error("Error loading scores:", error);
        if (isCurrentLoad()) {
          setStudents([]);
          setScores({});
        }
      } finally {
        if (isCurrentLoad()) {
          setIsTableLoading(false);
        }
      }
    };

    loadScores();
    return () => {
      cancelled = true;
    };
  }, [
    adminSettings,
    authUser?.uid,
    isBootstrapLoading,
    isSessionLoading,
    schoolId,
    selectedSessionId,
    resultSelection.class,
    resultSelection.subject,
    resultSelection.session,
    resolvedSessionId,
    resolvedTermId,
    recordSnapshotKey,
    selectedSessionName,
    isHistoricalView,
    isReadOnlyView,
    hasRecordAccess,
    scoreComponents,
    isLtcTerm,
    isAdmin,
    resultConfig,
    logTeacherLtcTrace,
  ]);

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

    setScores((prev) => {
      const nextScores = {
        ...prev,
        [studentId]: {
          ...prev[studentId],
          [scoreType]: limitedValue,
        },
      };

      dirtyScoresRef.current = {
        ...(dirtyScoresRef.current || {}),
        [studentId]: nextScores[studentId],
      };

      return nextScores;
    });

    hasScoreChangesRef.current = true;
    setHasUnsavedChanges(true);
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
      isSessionLoading ||
      isReadOnlyView ||
      !canEditScores ||
      !selectedSessionId ||
      !schoolId ||
      !resultSelection.class ||
      !resultSelection.subject
    ) {
      return false;
    }
    const dirtyEntries = Object.entries(dirtyScoresRef.current || {});
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
    const payloadToSave =
      isAdmin && source !== "autosave" ? adminFullPayload : dirtyPayload;
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
      hasScoreChangesRef.current = false;
      dirtyScoresRef.current = {};
      setHasUnsavedChanges(false);
      writeRecordSnapshot(recordSnapshotKey, {
        students: students || [],
        scores: scores || {},
        ltcByStudent: ltcByStudent || {},
        ltcUiMeta: ltcUiMeta || {
          currentTermOrder: 1,
          allowClassWideManualOnZero: false,
        },
        savedAt: Date.now(),
      });
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
    if (!hasRecordAccess || isPreviewSaving) return;

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

      if (
        !isSessionLoading &&
        !isReadOnlyView &&
        canEditScores &&
        selectedSessionId &&
        schoolId &&
        resultSelection.class &&
        resultSelection.subject
      ) {
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

  return (
    <div className="min-h-screen bg-white p-4 dark:bg-gray-900 md:p-8">
      {isLoading ? (
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-blue-800"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading records...</p>
          </div>
        </div>
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
                  {getClassLabel(resultSelection.class)}
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
                        No students in this class
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
                !hasRecordAccess ||
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
              disabled={!hasRecordAccess || isPreviewSaving || isSavingScores}
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





