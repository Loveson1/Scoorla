import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  canonicalizeResultSelection,
  getResultSelection,
  getTermDisplayName,
  queueRecordDashboardWarmScopes,
} from "./utils/school-data";
import ClassSelectionModal from "./ClassSelectionModal";
import ResultModal from "./ResultModal";
import { useSessionContext } from "../context/SessionContext";
import { getSessionDashboardStats } from "../utils/queryService";
import { useAuthContext } from "../context/AuthContext";
import { useSchoolBootstrap } from "../context/SchoolBootstrapContext";

const buildTeacherRecordBackfillMarkerKey = ({
  schoolId,
  userId,
  sessionId,
  termId,
}) =>
  [
    "teacherRecordBackfill",
    String(schoolId || "").trim(),
    String(userId || "").trim(),
    String(sessionId || "").trim(),
    String(termId || "").trim(),
  ].join("__");

const buildRecordScopeSignature = (scopes = []) =>
  [...new Set(
    (Array.isArray(scopes) ? scopes : [])
      .map((scope) =>
        [
          String(scope?.schoolId || "").trim(),
          String(scope?.classId || "").trim(),
          String(scope?.subjectId || "").trim(),
          String(scope?.sessionId || "").trim(),
          String(scope?.termId || "").trim(),
        ]
          .filter(Boolean)
          .join("__")
      )
      .filter(Boolean)
  )]
    .sort()
    .join("|");

const SCHOOL_DASHBOARD_ROUTE = "/school-dashboard";
const SCHOOL_DASHBOARD_STALE_TIME = 5 * 60 * 1000;
const EMPTY_SCHOOL_DATA = Object.freeze({});
const EMPTY_DASHBOARD_STATS = Object.freeze({
  schoolId: "",
  sessionId: null,
  totalEnrollments: 0,
  totalStudents: 0,
  totalClasses: 0,
  totalTerms: 0,
  totalScores: 0,
  classBreakdown: {},
  termBreakdown: {},
});

const fetchSchoolDashboardStats = async ({ queryKey }) => {
  const [, schoolId, sessionId, userId] = queryKey;
  if (!schoolId || schoolId === "none" || !userId || userId === "anonymous") {
    return EMPTY_DASHBOARD_STATS;
  }

  const nextStats = await getSessionDashboardStats(
    schoolId,
    sessionId === "none" ? "" : sessionId
  );

  return {
    ...EMPTY_DASHBOARD_STATS,
    ...(nextStats || {}),
  };
};

export default function SchoolDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const authContext = useAuthContext();
  const bootstrapContext = useSchoolBootstrap();
  const sessionContext = useSessionContext();
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const handledRouteModalRequestRef = useRef("");
  const lastHighPriorityWarmSignatureRef = useRef("");
  const lastTeacherBackfillRequestRef = useRef("");

  const stableAuth = useMemo(
    () => ({
      isAdmin: Boolean(authContext?.isAdmin),
      authUserId: String(authContext?.authUser?.uid || "").trim(),
      schoolId: String(authContext?.schoolId || "").trim(),
    }),
    [authContext?.isAdmin, authContext?.authUser?.uid, authContext?.schoolId]
  );

  const stableSession = useMemo(
    () => ({
      selectedSessionId: String(sessionContext?.selectedSessionId || "").trim(),
      selectedSessionName: String(sessionContext?.selectedSessionName || "").trim(),
      selectedTermId: String(sessionContext?.selectedTermId || "").trim(),
      activeSessionId: String(sessionContext?.activeSessionId || "").trim(),
      activeTermId: String(sessionContext?.activeTermId || "").trim(),
      isHistoricalView: Boolean(sessionContext?.isHistoricalView),
      isReadOnlyView: Boolean(sessionContext?.isReadOnlyView),
      isPastTermView: Boolean(sessionContext?.isPastTermView),
    }),
    [
      sessionContext?.selectedSessionId,
      sessionContext?.selectedSessionName,
      sessionContext?.selectedTermId,
      sessionContext?.activeSessionId,
      sessionContext?.activeTermId,
      sessionContext?.isHistoricalView,
      sessionContext?.isReadOnlyView,
      sessionContext?.isPastTermView,
    ]
  );

  const schoolData = useMemo(
    () => bootstrapContext?.schoolData || EMPTY_SCHOOL_DATA,
    [bootstrapContext?.schoolData]
  );
  const isBootstrapLoading = Boolean(bootstrapContext?.isLoading);
  const recordClassIdsGetter = authContext?.getRecordClassIds;
  const recordSubjectsForClassGetter = authContext?.getRecordSubjectsForClass;

  const getStableRecordClassIds = useCallback(
    () => recordClassIdsGetter?.() || [],
    [recordClassIdsGetter]
  );

  const getStableRecordSubjectsForClass = useCallback(
    (classId) => recordSubjectsForClassGetter?.(classId) || [],
    [recordSubjectsForClassGetter]
  );

  const isOnSchoolDashboard = useMemo(
    () => location.pathname === SCHOOL_DASHBOARD_ROUTE,
    [location.pathname]
  );

  const resolvedSessionId = useMemo(
    () => stableSession.selectedSessionId || stableSession.activeSessionId || "",
    [stableSession.selectedSessionId, stableSession.activeSessionId]
  );
  const resolvedTermId = useMemo(
    () => stableSession.selectedTermId || stableSession.activeTermId || "term1",
    [stableSession.selectedTermId, stableSession.activeTermId]
  );

  const dashboardStatsQueryKey = useMemo(
    () => [
      "school-dashboard",
      stableAuth.schoolId || "none",
      resolvedSessionId || "none",
      stableAuth.authUserId || "anonymous",
    ],
    [stableAuth.schoolId, stableAuth.authUserId, resolvedSessionId]
  );

  const {
    data: dashboardStatsData,
    isPending: isDashboardStatsPending,
  } = useQuery({
    queryKey: dashboardStatsQueryKey,
    queryFn: fetchSchoolDashboardStats,
    enabled:
      !isBootstrapLoading &&
      Boolean(stableAuth.schoolId) &&
      Boolean(stableAuth.authUserId),
    staleTime: SCHOOL_DASHBOARD_STALE_TIME,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    placeholderData: (previousData) => previousData,
  });

  const dashboardStats = useMemo(
    () => dashboardStatsData || EMPTY_DASHBOARD_STATS,
    [dashboardStatsData]
  );

  const totalStudents = useMemo(
    () => Number(dashboardStats?.totalStudents) || 0,
    [dashboardStats?.totalStudents]
  );
  const totalClasses = useMemo(
    () => Number(dashboardStats?.totalClasses) || 0,
    [dashboardStats?.totalClasses]
  );
  const bootstrapClassCount = useMemo(
    () => Object.keys(schoolData?.classes || {}).length,
    [schoolData]
  );
  const resolvedTotalClasses = useMemo(
    () => (totalClasses > 0 ? totalClasses : bootstrapClassCount),
    [bootstrapClassCount, totalClasses]
  );
  const displaySessionName = useMemo(
    () => stableSession.selectedSessionName || "Not set",
    [stableSession.selectedSessionName]
  );
  const displayTermName = useMemo(
    () => getTermDisplayName(resolvedTermId),
    [resolvedTermId]
  );
  const isStatsLoading =
    !isBootstrapLoading && isDashboardStatsPending && !dashboardStatsData;

  const handleOpenClassModal = useCallback(() => {
    setIsClassModalOpen(true);
  }, []);

  const handleCloseClassModal = useCallback(() => {
    setIsClassModalOpen(false);
  }, []);

  const handleOpenResultModal = useCallback(() => {
    setIsResultModalOpen(true);
  }, []);

  const handleCloseResultModal = useCallback(() => {
    setIsResultModalOpen(false);
  }, []);

  const handleOpenAdminConfig = useCallback(() => {
    navigate("/admin-config");
  }, [navigate]);

  const clearDashboardRouteState = useCallback(() => {
    navigate(SCHOOL_DASHBOARD_ROUTE, { replace: true });
  }, [navigate]);

  const routeModalRequest = useMemo(() => {
    if (!isOnSchoolDashboard) {
      return "";
    }
    if (location.state?.openClassModal) {
      return "class";
    }
    if (location.state?.openRecordModal) {
      return "record";
    }
    return "";
  }, [isOnSchoolDashboard, location.state?.openClassModal, location.state?.openRecordModal]);

  const recentSelection = useMemo(() => {
    if (!stableAuth.authUserId || !stableAuth.schoolId) {
      return { class: "", subject: "", term: "", session: "" };
    }

    return canonicalizeResultSelection(
      getResultSelection(stableAuth.authUserId),
      stableAuth.schoolId
    );
  }, [stableAuth.authUserId, stableAuth.schoolId]);

  const recentClassId = useMemo(
    () => String(recentSelection?.class || "").trim(),
    [recentSelection?.class]
  );
  const recentSubjectId = useMemo(
    () => String(recentSelection?.subject || "").trim(),
    [recentSelection?.subject]
  );

  const teacherClassIds = useMemo(
    () =>
      stableAuth.isAdmin
        ? []
        : [
            ...new Set(
              getStableRecordClassIds()
                .map((classId) => String(classId || "").trim())
                .filter(Boolean)
            ),
          ],
    [getStableRecordClassIds, stableAuth.isAdmin]
  );

  const teacherScopes = useMemo(
    () =>
      !stableAuth.schoolId || !resolvedSessionId || stableAuth.isAdmin
        ? []
        : teacherClassIds.flatMap((classId) =>
            getStableRecordSubjectsForClass(classId)
              .map((subjectId) => String(subjectId || "").trim())
              .filter(Boolean)
              .map((subjectId) => ({
                schoolId: stableAuth.schoolId,
                classId,
                subjectId,
                sessionId: resolvedSessionId,
                termId: resolvedTermId,
              }))
          ),
    [
      getStableRecordSubjectsForClass,
      resolvedSessionId,
      resolvedTermId,
      stableAuth.isAdmin,
      stableAuth.schoolId,
      teacherClassIds,
    ]
  );

  const prioritizedTeacherScopes = useMemo(() => {
    if (teacherScopes.length === 0) {
      return [];
    }

    return [
      ...teacherScopes.filter(
        (scope) =>
          scope.classId === recentClassId && scope.subjectId === recentSubjectId
      ),
      ...teacherScopes.filter(
        (scope) =>
          !(scope.classId === recentClassId && scope.subjectId === recentSubjectId)
      ),
    ];
  }, [recentClassId, recentSubjectId, teacherScopes]);

  const highPriorityWarmScopes = useMemo(() => {
    if (
      isBootstrapLoading ||
      !isOnSchoolDashboard ||
      !stableAuth.schoolId ||
      !stableAuth.authUserId ||
      !resolvedSessionId
    ) {
      return [];
    }

    if (stableAuth.isAdmin) {
      return recentClassId && recentSubjectId
        ? [
            {
              schoolId: stableAuth.schoolId,
              classId: recentClassId,
              subjectId: recentSubjectId,
              sessionId: resolvedSessionId,
              termId: resolvedTermId,
            },
          ]
        : [];
    }

    return prioritizedTeacherScopes;
  }, [
    isBootstrapLoading,
    isOnSchoolDashboard,
    prioritizedTeacherScopes,
    recentClassId,
    recentSubjectId,
    resolvedSessionId,
    resolvedTermId,
    stableAuth.authUserId,
    stableAuth.isAdmin,
    stableAuth.schoolId,
  ]);

  const highPriorityWarmLimit = stableAuth.isAdmin ? 1 : 8;
  const highPriorityWarmSignature = useMemo(
    () => buildRecordScopeSignature(highPriorityWarmScopes.slice(0, highPriorityWarmLimit)),
    [highPriorityWarmLimit, highPriorityWarmScopes]
  );

  const isActiveScope = useMemo(
    () =>
      !!resolvedSessionId &&
      !!stableSession.activeSessionId &&
      resolvedSessionId === stableSession.activeSessionId &&
      String(resolvedTermId || "term1").trim().toLowerCase() ===
        String(stableSession.activeTermId || resolvedTermId || "term1")
          .trim()
          .toLowerCase() &&
      !stableSession.isHistoricalView &&
      !stableSession.isReadOnlyView,
    [
      resolvedSessionId,
      resolvedTermId,
      stableSession.activeSessionId,
      stableSession.activeTermId,
      stableSession.isHistoricalView,
      stableSession.isReadOnlyView,
    ]
  );

  const teacherBackfillSignature = useMemo(
    () => buildRecordScopeSignature(teacherScopes),
    [teacherScopes]
  );
  const teacherBackfillMarkerKey = useMemo(
    () =>
      buildTeacherRecordBackfillMarkerKey({
        schoolId: stableAuth.schoolId,
        userId: stableAuth.authUserId,
        sessionId: resolvedSessionId,
        termId: resolvedTermId,
      }),
    [resolvedSessionId, resolvedTermId, stableAuth.authUserId, stableAuth.schoolId]
  );
  const teacherBackfillRequestKey = useMemo(() => {
    if (
      isBootstrapLoading ||
      stableAuth.isAdmin ||
      !isOnSchoolDashboard ||
      !stableAuth.schoolId ||
      !stableAuth.authUserId ||
      !isActiveScope ||
      !teacherBackfillSignature
    ) {
      return "";
    }

    return `${teacherBackfillMarkerKey}::${teacherBackfillSignature}`;
  }, [
    isActiveScope,
    isBootstrapLoading,
    isOnSchoolDashboard,
    stableAuth.authUserId,
    stableAuth.isAdmin,
    stableAuth.schoolId,
    teacherBackfillMarkerKey,
    teacherBackfillSignature,
  ]);

  useEffect(() => {
    if (isBootstrapLoading) return;
    if (!stableAuth.authUserId) {
      navigate("/login", { replace: true });
      return;
    }
    if (!stableAuth.schoolId) {
      navigate("/welcome", { replace: true });
      return;
    }
  }, [
    isBootstrapLoading,
    navigate,
    stableAuth.authUserId,
    stableAuth.schoolId,
  ]);

  useEffect(() => {
    if (!routeModalRequest) {
      handledRouteModalRequestRef.current = "";
      return;
    }

    if (handledRouteModalRequestRef.current === routeModalRequest) {
      return;
    }

    handledRouteModalRequestRef.current = routeModalRequest;

    if (routeModalRequest === "class") {
      setIsClassModalOpen(true);
      clearDashboardRouteState();
      return;
    }

    if (routeModalRequest === "record") {
      setIsResultModalOpen(true);
      clearDashboardRouteState();
    }
  }, [clearDashboardRouteState, routeModalRequest]);

  useEffect(() => {
    if (!highPriorityWarmSignature) {
      lastHighPriorityWarmSignatureRef.current = "";
      return;
    }

    if (lastHighPriorityWarmSignatureRef.current === highPriorityWarmSignature) {
      return;
    }

    lastHighPriorityWarmSignatureRef.current = highPriorityWarmSignature;
    queueRecordDashboardWarmScopes(highPriorityWarmScopes, {
      limit: highPriorityWarmLimit,
      priority: "high",
    });
  }, [
    highPriorityWarmLimit,
    highPriorityWarmScopes,
    highPriorityWarmSignature,
  ]);

  useEffect(() => {
    if (!teacherBackfillRequestKey) {
      lastTeacherBackfillRequestRef.current = "";
      return;
    }

    if (lastTeacherBackfillRequestRef.current === teacherBackfillRequestKey) {
      return;
    }

    if (teacherScopes.length === 0) {
      return;
    }

    let previousSignature = "";
    try {
      previousSignature = String(window.localStorage?.getItem(teacherBackfillMarkerKey) || "");
    } catch {
      previousSignature = "";
    }

    if (previousSignature === teacherBackfillSignature) {
      lastTeacherBackfillRequestRef.current = teacherBackfillRequestKey;
      return;
    }

    lastTeacherBackfillRequestRef.current = teacherBackfillRequestKey;
    queueRecordDashboardWarmScopes(teacherScopes, { limit: teacherScopes.length });
    try {
      window.localStorage?.setItem(teacherBackfillMarkerKey, teacherBackfillSignature);
    } catch {
      // Ignore marker write failures; queueing already happened.
    }
  }, [
    teacherBackfillMarkerKey,
    teacherBackfillRequestKey,
    teacherBackfillSignature,
    teacherScopes,
  ]);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 p-6 md:p-10">
      {(isBootstrapLoading || isStatsLoading) && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-800"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading dashboard...</p>
          </div>
        </div>
      )}

      {!(isBootstrapLoading || isStatsLoading) && (
        <>
      {/* Header Section */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-10">
        {/* School Info */}
        <div className="flex items-center gap-4">
          {schoolData.logo && (
            <img
              src={schoolData.logo}
              alt={schoolData.name}
              className="w-16 h-16 rounded-full object-cover border-2 border-blue-800"
            />
          )}
          <div>
            <h2 className="sm:text-xl text-lg dark:text-white text-black"> Welcome,</h2>
            <h1 className="text-2xl md:text-4xl font-bold dark:text-white text-black">
              {schoolData.name}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {schoolData.address}
            </p>
          </div>
        </div>
      </div>

      {stableSession.isReadOnlyView && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          {stableSession.isHistoricalView
            ? "Viewing historical session data. Changes will NOT affect the active session."
            : stableSession.isPastTermView
              ? "Viewing a past term. This dashboard is showing read-only history."
              : "This view is read-only."}
        </div>
      )}

      {/* Statistics Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-800 dark:to-gray-700 rounded-lg p-6 border-l-4 border-blue-800">
          <h3 className="text-gray-600 dark:text-gray-300 text-sm font-semibold mb-2">
            Total Students
          </h3>
          <p className="text-4xl font-bold text-blue-800 dark:text-blue-400">
            {totalStudents}
          </p>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-gray-800 dark:to-gray-700 rounded-lg p-6 border-l-4 border-green-600">
          <h3 className="text-gray-600 dark:text-gray-300 text-sm font-semibold mb-2">
            Total Classes
          </h3>
          <p className="text-4xl font-bold text-green-600 dark:text-green-400">
            {resolvedTotalClasses}
          </p>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-gray-800 dark:to-gray-700 rounded-lg p-6 border-l-4 border-purple-600">
          <h3 className="text-gray-600 dark:text-gray-300 text-sm font-semibold mb-2">
            Session & Term
          </h3>
          <p className="text-xl font-bold text-purple-600 dark:text-purple-400">
            {displaySessionName}
          </p>
          <p className="text-sm text-purple-700 dark:text-purple-300 font-medium mt-1">
            {displayTermName}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div
        className={`grid grid-cols-1 gap-6 ${
          stableAuth.isAdmin ? "md:grid-cols-3" : "md:grid-cols-2"
        }`}
      >
        {/* Go to Class Button */}
        <button
          onClick={handleOpenClassModal}
          className="flex flex-col items-center justify-center p-8 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg transition-all duration-300 shadow-lg hover:shadow-xl"
        >
          <svg
            className="w-12 h-12 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
          <span className="text-lg font-semibold">Go to Class</span>
          <p className="text-sm text-blue-100 mt-1 text-center">
            Select class and manage students
          </p>
        </button>

        {/* Record Result Button */}
        <button
          onClick={handleOpenResultModal}
          className="flex flex-col items-center justify-center p-8 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white rounded-lg transition-all duration-300 shadow-lg hover:shadow-xl"
        >
          <svg
            className="w-12 h-12 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-lg font-semibold">Record Result</span>
          <p className="text-sm text-green-100 mt-1 text-center">
            Enter and manage student results
          </p>
        </button>

        {stableAuth.isAdmin && (
          <button
            onClick={handleOpenAdminConfig}
            className="flex flex-col items-center justify-center p-8 bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-600 text-white rounded-lg transition-all duration-300 shadow-lg hover:shadow-xl"
          >
            <svg
              className="w-12 h-12 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span className="text-lg font-semibold">Admin</span>
            <p className="text-sm text-purple-100 mt-1 text-center">
              School settings and configuration
            </p>
          </button>
        )}
      </div>

      {/* Class Selection Modal */}
      <ClassSelectionModal
        isOpen={isClassModalOpen}
        onClose={handleCloseClassModal}
      />

      {/* Result Modal */}
      <ResultModal
        isOpen={isResultModalOpen}
        onClose={handleCloseResultModal}
      />
        </>
      )}
    </div>
  );
}

