import { useCallback, useEffect, useState } from "react";
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

export default function SchoolDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isAdmin,
    authUser,
    schoolId,
    assignedClasses,
    canAccessClass,
    canAccessSubject,
  } = useAuthContext();
  const { schoolData, isLoading: isBootstrapLoading } = useSchoolBootstrap();
  const {
    selectedSessionId,
    selectedSessionName,
    selectedTermId,
    activeSessionId,
    activeTermId,
    isHistoricalView,
    isReadOnlyView,
    isPastTermView,
  } = useSessionContext();
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [totalStudents, setTotalStudents] = useState(0);
  const [totalClasses, setTotalClasses] = useState(0);
  const [currentSession, setCurrentSession] = useState("");
  const [currentTerm, setCurrentTerm] = useState("");
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const displaySessionName = selectedSessionName || currentSession || "Not set";
  const resolvedTotalClasses =
    Number(totalClasses) > 0
      ? Number(totalClasses)
      : Object.keys(schoolData?.classes || {}).length;

  const getBootstrapSubjectsByClass = useCallback((classId = "") => {
    const normalizedClassId = String(classId || "").trim().toLowerCase();
    const isJunior = ["jss1", "jss2", "jss3"].includes(normalizedClassId);
    const catalog = schoolData?.subjects || {};
    const scopedSubjects = isJunior ? catalog?.junior : catalog?.senior;
    return Array.isArray(scopedSubjects) ? scopedSubjects : [];
  }, [schoolData]);

  useEffect(() => {
    if (isBootstrapLoading) return;
    if (!authUser?.uid) {
      navigate("/login", { replace: true });
      return;
    }
    if (!schoolId) {
      navigate("/welcome", { replace: true });
      return;
    }
    setCurrentTerm(selectedTermId || activeTermId || "term1");
  }, [activeTermId, authUser?.uid, isBootstrapLoading, navigate, schoolId, selectedTermId]);

  // Calculate real statistics from stored data
  useEffect(() => {
    const loadStats = async () => {
      if (!schoolId) {
        setIsStatsLoading(false);
        return;
      }

      try {
        setIsStatsLoading(true);
        const stats = await getSessionDashboardStats(schoolId, selectedSessionId);
        setTotalStudents(Number(stats?.totalStudents) || 0);
        setTotalClasses(Number(stats?.totalClasses) || 0);
        setCurrentSession(selectedSessionName || "");
        setCurrentTerm(selectedTermId || activeTermId || "term1");
      } catch (error) {
        console.error("Error loading statistics:", error);
      } finally {
        setIsStatsLoading(false);
      }
    };

    loadStats();
  }, [schoolId, selectedSessionId, selectedSessionName, selectedTermId, activeTermId]);

  useEffect(() => {
    if (location.pathname !== "/school-dashboard") {
      return;
    }

    if (location.state?.openClassModal) {
      setIsClassModalOpen(true);
      navigate("/school-dashboard", { replace: true });
      return;
    }

    if (location.state?.openRecordModal) {
      setIsResultModalOpen(true);
      navigate("/school-dashboard", { replace: true });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (
      isBootstrapLoading ||
      !schoolId ||
      !authUser?.uid ||
      !location.pathname ||
      location.pathname !== "/school-dashboard"
    ) {
      return;
    }

    const resolvedSessionId = selectedSessionId || activeSessionId || "";
    const resolvedTermId = selectedTermId || activeTermId || "term1";
    if (!resolvedSessionId) {
      return;
    }

    if (isAdmin) {
      const recentSelection = canonicalizeResultSelection(
        getResultSelection(authUser.uid),
        schoolId
      );
      const recentClassId = String(recentSelection?.class || "").trim();
      const recentSubjectId = String(recentSelection?.subject || "").trim();
      if (recentClassId && recentSubjectId) {
        queueRecordDashboardWarmScopes(
          [
            {
              schoolId,
              classId: recentClassId,
              subjectId: recentSubjectId,
              sessionId: resolvedSessionId,
              termId: resolvedTermId,
            },
          ],
          { limit: 1 }
        );
      }
      return;
    }

    const teacherClassIds = [...new Set(
      (assignedClasses || [])
        .map((classId) => String(classId || "").trim())
        .filter((classId) => classId && canAccessClass(classId))
    )];

    const scopes = teacherClassIds.flatMap((classId) =>
      getBootstrapSubjectsByClass(classId)
        .filter((subjectId) => canAccessSubject(subjectId))
        .map((subjectId) => ({
          schoolId,
          classId,
          subjectId,
          sessionId: resolvedSessionId,
          termId: resolvedTermId,
        }))
    );

    queueRecordDashboardWarmScopes(scopes, { limit: 8 });
  }, [
    activeSessionId,
    activeTermId,
    assignedClasses,
    authUser?.uid,
    canAccessClass,
    canAccessSubject,
    getBootstrapSubjectsByClass,
    isAdmin,
    isBootstrapLoading,
    location.pathname,
    schoolId,
    selectedSessionId,
    selectedTermId,
  ]);

  useEffect(() => {
    if (
      isBootstrapLoading ||
      isAdmin ||
      !schoolId ||
      !authUser?.uid ||
      !location.pathname ||
      location.pathname !== "/school-dashboard"
    ) {
      return;
    }

    const resolvedSessionId = selectedSessionId || activeSessionId || "";
    const resolvedTermId = selectedTermId || activeTermId || "term1";
    const isActiveScope =
      !!resolvedSessionId &&
      !!activeSessionId &&
      String(resolvedSessionId || "").trim() === String(activeSessionId || "").trim() &&
      String(resolvedTermId || "term1").trim().toLowerCase() ===
        String(activeTermId || resolvedTermId || "term1").trim().toLowerCase() &&
      !isHistoricalView &&
      !isReadOnlyView;

    if (!isActiveScope) {
      return;
    }

    const teacherClassIds = [...new Set(
      (assignedClasses || [])
        .map((classId) => String(classId || "").trim())
        .filter((classId) => classId && canAccessClass(classId))
    )];

    const scopes = teacherClassIds.flatMap((classId) =>
      getBootstrapSubjectsByClass(classId)
        .filter((subjectId) => canAccessSubject(subjectId))
        .map((subjectId) => ({
          schoolId,
          classId,
          subjectId,
          sessionId: resolvedSessionId,
          termId: resolvedTermId,
        }))
    );
    if (scopes.length === 0) {
      return;
    }

    const markerKey = buildTeacherRecordBackfillMarkerKey({
      schoolId,
      userId: authUser.uid,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
    });
    const nextSignature = buildRecordScopeSignature(scopes);
    let previousSignature = "";
    try {
      previousSignature = String(window.localStorage?.getItem(markerKey) || "");
    } catch {
      previousSignature = "";
    }

    if (previousSignature === nextSignature) {
      return;
    }

    queueRecordDashboardWarmScopes(scopes, { limit: scopes.length });
    try {
      window.localStorage?.setItem(markerKey, nextSignature);
    } catch {
      // Ignore marker write failures; queueing already happened.
    }
  }, [
    activeSessionId,
    activeTermId,
    assignedClasses,
    authUser?.uid,
    canAccessClass,
    canAccessSubject,
    getBootstrapSubjectsByClass,
    isAdmin,
    isBootstrapLoading,
    isHistoricalView,
    isReadOnlyView,
    location.pathname,
    schoolId,
    selectedSessionId,
    selectedTermId,
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

      {isReadOnlyView && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          {isHistoricalView
            ? "Viewing historical session data. Changes will NOT affect the active session."
            : isPastTermView
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
            {getTermDisplayName(currentTerm)}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className={`grid grid-cols-1 gap-6 ${isAdmin ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {/* Go to Class Button */}
        <button
          onClick={() => setIsClassModalOpen(true)}
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
          onClick={() => setIsResultModalOpen(true)}
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

        {isAdmin && (
          <button
            onClick={() => navigate("/admin-config")}
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
        onClose={() => setIsClassModalOpen(false)}
      />

      {/* Result Modal */}
      <ResultModal
        isOpen={isResultModalOpen}
        onClose={() => setIsResultModalOpen(false)}
      />
        </>
      )}
    </div>
  );
}
