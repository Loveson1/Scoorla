import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Download, Eye, Loader2, Pencil, Trash2, UserMinus } from "lucide-react";
import {
  canDeleteStudentSafely,
  deleteStudentRecord,
  getClassSelection,
  getClassStudents,
  getStudentReportRows,
  saveClassStudents,
  withdrawStudent,
} from "./utils/school-data";
import AddStudent from "./AddStudent";
import { downloadStudentResultPdf } from "../utils/studentResultPdf";
import { useSessionContext } from "../context/SessionContext";
import { useAuthContext } from "../context/AuthContext";
import { useSchoolBootstrap } from "../context/SchoolBootstrapContext";

const CLASS_DASHBOARD_SELECTION_STALE_TIME = 30 * 60 * 1000;
const CLASS_DASHBOARD_ROSTER_STALE_TIME = 5 * 60 * 1000;
const CLASS_DASHBOARD_RESULTS_STALE_TIME = 2 * 60 * 1000;
const CLASS_DASHBOARD_GC_TIME = 30 * 60 * 1000;
const EMPTY_CLASS_SELECTION = Object.freeze({
  class: "",
  term: "term1",
  session: "",
  sessionId: "",
});
const EMPTY_STUDENTS = Object.freeze([]);

const buildClassSelectionQueryKey = ({
  userId,
  sessionId,
  sessionName,
  termId,
}) => [
  "classDashboard",
  "selection",
  String(userId || "").trim() || "anonymous",
  String(sessionId || "").trim() || "none",
  String(sessionName || "").trim() || "none",
  String(termId || "").trim() || "term1",
];

const resolveClassDashboardSelection = ({
  userId,
  sessionId,
  sessionName,
  termId,
}) => {
  const storedSelection = getClassSelection(userId);
  return {
    ...EMPTY_CLASS_SELECTION,
    ...(storedSelection || {}),
    class: String(storedSelection?.class || "").trim(),
    sessionId: String(sessionId || storedSelection?.sessionId || "").trim(),
    session: String(sessionName || storedSelection?.session || "").trim(),
    term: String(termId || storedSelection?.term || "term1").trim() || "term1",
  };
};

const buildClassRosterQueryKey = ({
  schoolId,
  userId,
  classId,
  sessionId,
  termId,
}) => [
  "classDashboard",
  "roster",
  String(schoolId || "").trim() || "none",
  String(userId || "").trim() || "anonymous",
  String(classId || "").trim() || "none",
  String(sessionId || "").trim() || "none",
  String(termId || "").trim() || "term1",
];

const buildStudentReportRowsQueryKey = ({
  schoolId,
  classId,
  studentId,
  sessionId,
  termId,
}) => [
  "classDashboard",
  "studentReportRows",
  String(schoolId || "").trim() || "none",
  String(classId || "").trim() || "none",
  String(studentId || "").trim() || "none",
  String(sessionId || "").trim() || "none",
  String(termId || "").trim() || "term1",
];

export default function ClassDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, canManageStudents, canManageClass, authUser, schoolId } = useAuthContext();
  const { schoolData, adminSettings } = useSchoolBootstrap();
  const {
    selectedSessionId,
    activeSessionId,
    selectedSessionName,
    selectedTermId,
    activeTermId,
    isHistoricalView,
    isReadOnlyView,
    isPastTermView,
  } = useSessionContext();
  const [searchTerm, setSearchTerm] = useState("");
  const [showInactiveStudents, setShowInactiveStudents] = useState(false);
  const [hideActiveOnlyNotice, setHideActiveOnlyNotice] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [isStudentSubmitting, setIsStudentSubmitting] = useState(false);
  const [pendingStudentSyncIds, setPendingStudentSyncIds] = useState([]);
  const [downloadingStudentId, setDownloadingStudentId] = useState("");

  const normalizeStudentName = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const formatStudentName = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  const normalizeRegNumber = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  const isStudentSyncing = (studentId) =>
    pendingStudentSyncIds.includes(String(studentId || "").trim());
  const updatePendingStudentSync = (studentId, isPending) => {
    const normalizedId = String(studentId || "").trim();
    if (!normalizedId) return;
    setPendingStudentSyncIds((prev) => {
      const next = prev.filter((id) => id !== normalizedId);
      return isPending ? [...next, normalizedId] : next;
    });
  };
  const getStatusMeta = (status) => {
    const normalized = String(status || "active").toLowerCase();
    if (normalized === "archived") {
      return {
        label: "Archived",
        className:
          "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
      };
    }
    if (normalized === "inactive") {
      return {
        label: "Inactive",
        className:
          "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
      };
    }
    if (normalized === "withdrawn") {
      return {
        label: "Withdrawn",
        className:
          "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
      };
    }
    if (normalized === "graduated") {
      return {
        label: "Withdrawn",
        className:
          "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
      };
    }
    if (normalized === "transferred") {
      return {
        label: "Transferred",
        className:
          "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
      };
    }
    return {
      label: "Active",
      className:
        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    };
  };
  const isStudentActive = (student) =>
    String(student?.status || "active").toLowerCase() === "active" &&
    !student?.isDeleted;
  const isReadOnlyLifecycleStudent = (student) => {
    const normalizedStatus = String(student?.status || "active").toLowerCase();
    return normalizedStatus === "withdrawn" || normalizedStatus === "graduated";
  };

  const stableSelectionContext = useMemo(
    () => ({
      userId: String(authUser?.uid || "").trim(),
      sessionId: String(selectedSessionId || activeSessionId || "").trim(),
      sessionName: String(selectedSessionName || "").trim(),
      termId: String(selectedTermId || activeTermId || "term1").trim() || "term1",
    }),
    [authUser?.uid, selectedSessionId, activeSessionId, selectedSessionName, selectedTermId, activeTermId]
  );

  const classSelectionQuery = useQuery({
    queryKey: buildClassSelectionQueryKey(stableSelectionContext),
    enabled: !!stableSelectionContext.userId,
    queryFn: () => resolveClassDashboardSelection(stableSelectionContext),
    staleTime: CLASS_DASHBOARD_SELECTION_STALE_TIME,
    gcTime: CLASS_DASHBOARD_GC_TIME,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  const classSelection = classSelectionQuery.data || EMPTY_CLASS_SELECTION;
  const hasClassAccess = isAdmin || canManageClass(classSelection.class);
  const canEditRoster = hasClassAccess && canManageStudents();
  const resolvedRosterSessionId =
    String(classSelection.sessionId || stableSelectionContext.sessionId || "").trim() || null;
  const resolvedRosterTermId =
    String(classSelection.term || stableSelectionContext.termId || "term1").trim() || "term1";

  const applyVisibleRoster = useCallback(
    (roster = []) =>
      (Array.isArray(roster) ? roster : []).filter((student) => {
        const status = String(student?.status || "active").toLowerCase();
        const isDeleted = !!student?.isDeleted;
        const isVisibleLifecycle = isHistoricalView || showInactiveStudents;
        if (!isVisibleLifecycle && (isDeleted || status !== "active")) {
          return false;
        }
        return true;
      }),
    [isHistoricalView, showInactiveStudents]
  );

  const rosterQueryKey = useMemo(
    () =>
      buildClassRosterQueryKey({
        schoolId,
        userId: authUser?.uid,
        classId: classSelection.class,
        sessionId: resolvedRosterSessionId,
        termId: resolvedRosterTermId,
      }),
    [authUser?.uid, classSelection.class, resolvedRosterSessionId, resolvedRosterTermId, schoolId]
  );

  const fetchRoster = useCallback(async () => {
    if (!schoolId || !classSelection.class || !resolvedRosterSessionId || !hasClassAccess) {
      return [];
    }

    const savedStudents = await getClassStudents(schoolId, classSelection.class, {
      sessionId: resolvedRosterSessionId,
      termId: resolvedRosterTermId,
      includeInactive: true,
      includeDeleted: true,
    });

    return Array.isArray(savedStudents) ? savedStudents : [];
  }, [
    schoolId,
    classSelection.class,
    resolvedRosterSessionId,
    resolvedRosterTermId,
    hasClassAccess,
  ]);

  const rosterQuery = useQuery({
    queryKey: rosterQueryKey,
    enabled: !!schoolId && !!classSelection.class && !!resolvedRosterSessionId && hasClassAccess,
    queryFn: fetchRoster,
    staleTime: CLASS_DASHBOARD_ROSTER_STALE_TIME,
    gcTime: CLASS_DASHBOARD_GC_TIME,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const allStudents = hasClassAccess
    ? Array.isArray(rosterQuery.data)
      ? rosterQuery.data
      : EMPTY_STUDENTS
    : EMPTY_STUDENTS;
  const isStudentsLoading =
    !!classSelection.class &&
    !!resolvedRosterSessionId &&
    hasClassAccess &&
    !Array.isArray(rosterQuery.data) &&
    rosterQuery.isPending;

  const setAllStudents = useCallback(
    (updater) => {
      queryClient.setQueryData(rosterQueryKey, (current) => {
        const currentRoster = Array.isArray(current) ? current : [];
        const nextRoster = typeof updater === "function" ? updater(currentRoster) : updater;
        return Array.isArray(nextRoster) ? nextRoster : [];
      });
    },
    [queryClient, rosterQueryKey]
  );

  const reloadClassStudents = useCallback(async () => {
    if (!schoolId || !classSelection.class || !resolvedRosterSessionId || !hasClassAccess) {
      queryClient.setQueryData(rosterQueryKey, []);
      return [];
    }

    const refreshed = await queryClient.fetchQuery({
      queryKey: rosterQueryKey,
      queryFn: fetchRoster,
      staleTime: 0,
      gcTime: CLASS_DASHBOARD_GC_TIME,
    });

    return Array.isArray(refreshed) ? refreshed : [];
  }, [
    classSelection.class,
    fetchRoster,
    hasClassAccess,
    queryClient,
    resolvedRosterSessionId,
    rosterQueryKey,
    schoolId,
  ]);

  const handleAddStudent = async (studentData) => {
    if (!authUser?.uid || !schoolId) return;
    if (isStudentSubmitting) return;
    if (!canEditRoster) {
      alert("You are not assigned to this resource");
      return;
    }
    if (isReadOnlyView) {
      alert("This view is read-only. Return to the current term to add students.");
      return;
    }
    
    const writeSessionId = selectedSessionId || activeSessionId || null;
    if (!writeSessionId) {
      alert("No active session is selected. Please set an active session in Admin Settings.");
      return;
    }

    console.log("Adding student:", studentData);
    const normalizedInputName = normalizeStudentName(studentData.name);
    const normalizedRegNumber = normalizeRegNumber(studentData.regNumber);
    if (!normalizedInputName) {
      alert("Student name is required.");
      return;
    }

    const knownRoster = Array.isArray(allStudents) ? allStudents : [];
    const duplicateName = knownRoster.some(
      (student) => normalizeStudentName(student?.name) === normalizedInputName
    );
    if (duplicateName) {
      alert("A student with this name already exists in this class.");
      return;
    }
    const duplicateRegNumber =
      normalizedRegNumber &&
      knownRoster.some(
        (student) =>
          normalizeRegNumber(student?.regNumber || student?.regNo) === normalizedRegNumber
      );
    if (duplicateRegNumber) {
      alert("A student with this registration number already exists in this class.");
      return;
    }

    const newStudent = {
      id: Date.now(),
      name: formatStudentName(studentData.name),
      regNumber: normalizedRegNumber,
      sex: studentData.sex || "",
      phone: studentData.phone || "",
    };
    const optimisticStudent = {
      ...newStudent,
      id: `temp__${Date.now()}`,
      classId: classSelection.class,
      status: "active",
      isDeleted: false,
    };
    setIsStudentSubmitting(true);
    setAllStudents((prev) => [...(Array.isArray(prev) ? prev : []), optimisticStudent]);
    setIsAddModalOpen(false);
    setEditingStudent(null);
    try {
      console.log("Saving to Firebase:", { schoolId, classId: classSelection.class, students: [newStudent] });
      const saveResult = await saveClassStudents(schoolId, classSelection.class, [newStudent], authUser.uid, {
        sessionId: writeSessionId,
        termId: resolvedRosterTermId,
        upsertExistingStudent: false,
        existingRoster: knownRoster,
      });
      if (Array.isArray(saveResult?.students)) {
        setAllStudents(saveResult.students);
      } else {
        await reloadClassStudents();
      }
    } catch (error) {
      console.error("Error adding student:", error);
      setAllStudents((prev) =>
        (Array.isArray(prev) ? prev : []).filter((student) => student?.id !== optimisticStudent.id)
      );
      alert("Failed to add student: " + error.message);
      await reloadClassStudents();
    } finally {
      setIsStudentSubmitting(false);
    }
  };

  const handleDeleteStudent = async (studentId) => {
    if (!authUser?.uid || !schoolId) return;
    if (!canEditRoster) {
      alert("You are not assigned to this resource");
      return;
    }
    if (isReadOnlyView) {
      alert("This view is read-only. Student lifecycle actions are disabled.");
      return;
    }

    const normalizedStudentId = String(studentId || "").trim();
    const student = allStudents.find(
      (item) => String(item?.id || "").trim() === normalizedStudentId
    );
    if (!student) return;
    if (isReadOnlyLifecycleStudent(student)) {
      alert("Withdrawn students are read-only. Use preview/download result.");
      return;
    }

    updatePendingStudentSync(normalizedStudentId, true);
    let guard;
    try {
      guard = await canDeleteStudentSafely(schoolId, normalizedStudentId);
    } catch (error) {
      console.error("Error checking delete safety:", error);
      alert(`Failed to validate delete safety: ${error?.message || "Unknown error"}`);
      updatePendingStudentSync(normalizedStudentId, false);
      return;
    }

    if (!guard?.canDelete) {
      const confirmWithdraw = window.confirm(
        `${guard?.reason || "Student has academic records."}\n\nMark this student as withdrawn instead?`
      );
      if (confirmWithdraw) {
        const withdrawnStudent = {
          ...student,
          status: "withdrawn",
          isDeleted: false,
          deletedAt: null,
        };
        setAllStudents((prev) =>
          prev.map((item) =>
            String(item?.id || "").trim() === normalizedStudentId ? withdrawnStudent : item
          )
        );
        void (async () => {
          try {
            await withdrawStudent(schoolId, normalizedStudentId);
          } catch (error) {
            console.error("Error withdrawing student:", error);
            setAllStudents((prev) =>
              prev.map((item) =>
                String(item?.id || "").trim() === normalizedStudentId ? student : item
              )
            );
            alert("Failed to withdraw student: " + error.message);
          } finally {
            updatePendingStudentSync(normalizedStudentId, false);
          }
        })();
      } else {
        updatePendingStudentSync(normalizedStudentId, false);
      }
      return;
    }

    if (window.confirm("Are you sure you want to permanently delete this student?")) {
      setAllStudents((prev) =>
        prev.filter((item) => String(item?.id || "").trim() !== normalizedStudentId)
      );
      void (async () => {
        try {
          console.log("Deleting from Firebase:", { schoolId, studentId: normalizedStudentId });
          await deleteStudentRecord(schoolId, normalizedStudentId);
        } catch (error) {
          console.error("Error deleting student:", error);
          setAllStudents((prev) => {
            const alreadyRestored = prev.some(
              (item) => String(item?.id || "").trim() === normalizedStudentId
            );
            return alreadyRestored ? prev : [...prev, student];
          });
          alert("Failed to delete student: " + error.message);
        } finally {
          updatePendingStudentSync(normalizedStudentId, false);
        }
      })();
      return;
    }

    updatePendingStudentSync(normalizedStudentId, false);
  };

  const handleEditStudent = (student) => {
    if (!canEditRoster) {
      alert("You are not assigned to this resource");
      return;
    }
    if (isReadOnlyLifecycleStudent(student)) {
      alert("Withdrawn students are read-only. Use preview/download result.");
      return;
    }
    setEditingStudent(student);
    setIsAddModalOpen(true);
  };

  const handleDownloadResult = async (student) => {
    if (!schoolId || !classSelection?.class) return;
    setDownloadingStudentId(String(student?.id || ""));

    try {
      const results = await queryClient.fetchQuery({
        queryKey: buildStudentReportRowsQueryKey({
          schoolId,
          classId: classSelection.class,
          studentId: student.id,
          termId: classSelection.term,
          sessionId: classSelection.sessionId || selectedSessionId,
        }),
        queryFn: () =>
          getStudentReportRows({
            schoolId,
            classId: classSelection.class,
            studentId: student.id,
            termId: classSelection.term,
            sessionId: classSelection.sessionId || selectedSessionId,
            adminSettings,
            screen: "ClassDashboard",
          }),
        staleTime: CLASS_DASHBOARD_RESULTS_STALE_TIME,
        gcTime: CLASS_DASHBOARD_GC_TIME,
      });

      if (!results.length) {
        alert("No result data is available for this student yet.");
        return;
      }

      const saved = await downloadStudentResultPdf({
        student,
        classInfo: { ...classSelection, schoolId },
        results,
        schoolData,
        adminSettings,
        totalStudentsInClass: visibleStudents.length,
      });

      if (!saved) {
        alert("No result data is available for this student yet.");
      }
    } catch (error) {
      console.error("Error downloading PDF:", error);
      alert("Error downloading PDF. Please try again.");
    } finally {
      setDownloadingStudentId("");
    }
  };

  const handleUpdateStudent = async (studentData) => {
    if (!authUser?.uid || !schoolId) return;
    if (isStudentSubmitting) return;
    if (!canEditRoster) {
      alert("You are not assigned to this resource");
      return;
    }
    if (isReadOnlyView) {
      alert("This view is read-only. Return to the current term to edit students.");
      return;
    }

    const writeSessionId = selectedSessionId || activeSessionId || null;
    if (!writeSessionId) {
      alert("No active session is selected. Please set an active session in Admin Settings.");
      return;
    }
    
    console.log("Updating student:", { studentData, editingStudent });
    if (!editingStudent) return;

    const normalizedInputName = normalizeStudentName(studentData.name);
    const normalizedRegNumber = normalizeRegNumber(studentData.regNumber);
    if (!normalizedInputName) {
      alert("Student name is required.");
      return;
    }

    const currentRoster = Array.isArray(allStudents) ? allStudents : [];
    const duplicateName = currentRoster.some(
      (student) =>
        String(student?.id || "") !== String(editingStudent.id || "") &&
        normalizeStudentName(student?.name) === normalizedInputName
    );
    if (duplicateName) {
      alert("A student with this name already exists in this class.");
      return;
    }
    const duplicateRegNumber =
      normalizedRegNumber &&
      currentRoster.some(
        (student) =>
          String(student?.id || "") !== String(editingStudent.id || "") &&
          normalizeRegNumber(student?.regNumber || student?.regNo) === normalizedRegNumber
      );
    if (duplicateRegNumber) {
      alert("A student with this registration number already exists in this class.");
      return;
    }

    const studentId = String(editingStudent.id || "");
    const previousStudent =
      currentRoster.find((student) => String(student?.id || "") === studentId) || editingStudent;
    const updatedStudent = {
      ...editingStudent,
      name: formatStudentName(studentData.name),
      regNumber: normalizedRegNumber,
      sex: studentData.sex,
      phone: studentData.phone,
    };
    setAllStudents((prev) =>
      prev.map((student) =>
        String(student?.id || "") === studentId ? updatedStudent : student
      )
    );
    setEditingStudent(null);
    setIsAddModalOpen(false);
    updatePendingStudentSync(studentId, true);

    void (async () => {
      try {
        const saveResult = await saveClassStudents(
          schoolId,
          classSelection.class,
          [updatedStudent],
          authUser.uid,
          {
            sessionId: writeSessionId,
            termId: resolvedRosterTermId,
            upsertExistingStudent: true,
            existingRoster: currentRoster,
          }
        );
        if (Array.isArray(saveResult?.students)) {
          const persistedStudent = saveResult.students.find(
            (student) => String(student?.id || "") === studentId
          );
          if (persistedStudent) {
            setAllStudents((prev) =>
              prev.map((student) =>
                String(student?.id || "") === studentId ? persistedStudent : student
              )
            );
          }
        }
      } catch (error) {
        console.error("Error updating student:", error);
        setAllStudents((prev) =>
          prev.map((student) =>
            String(student?.id || "") === studentId ? previousStudent : student
          )
        );
        alert("Failed to update student: " + error.message);
      } finally {
        updatePendingStudentSync(studentId, false);
      }
    })();
  };

  const handleWithdrawStudent = async (student) => {
    if (!student?.id || !schoolId) return;
    if (!canEditRoster) {
      alert("You are not assigned to this resource");
      return;
    }
    if (isReadOnlyView) {
      alert("This view is read-only. Student lifecycle actions are disabled.");
      return;
    }
    if (!isStudentActive(student)) return;
    if (!window.confirm(`Withdraw ${formatStudentName(student.name)}?`)) return;

    const normalizedStudentId = String(student.id || "").trim();
    const withdrawnStudent = {
      ...student,
      status: "withdrawn",
      isDeleted: false,
      deletedAt: null,
    };
    updatePendingStudentSync(normalizedStudentId, true);
    setAllStudents((prev) =>
      prev.map((item) =>
        String(item?.id || "").trim() === normalizedStudentId ? withdrawnStudent : item
      )
    );
    void (async () => {
      try {
        await withdrawStudent(schoolId, normalizedStudentId);
      } catch (error) {
        console.error("Error withdrawing student:", error);
        setAllStudents((prev) =>
          prev.map((item) =>
            String(item?.id || "").trim() === normalizedStudentId ? student : item
          )
        );
        alert("Failed to withdraw student: " + error.message);
      } finally {
        updatePendingStudentSync(normalizedStudentId, false);
      }
    })();
  };

  const visibleStudents = applyVisibleRoster(allStudents);
  const filteredStudents = visibleStudents
    .filter((student) =>
      String(student?.name || "").toLowerCase().includes(searchTerm.toLowerCase()),
    )
    .sort((left, right) => {
      const leftStatus = String(left?.status || "active").toLowerCase();
      const rightStatus = String(right?.status || "active").toLowerCase();
      const leftIsWithdrawn = leftStatus === "withdrawn" || leftStatus === "graduated";
      const rightIsWithdrawn = rightStatus === "withdrawn" || rightStatus === "graduated";

      if (leftIsWithdrawn !== rightIsWithdrawn) {
        return leftIsWithdrawn ? -1 : 1;
      }

      return formatStudentName(left?.name).localeCompare(formatStudentName(right?.name));
    });

  const getClassLabel = (classId) => {
    const classMap = {
      jss1: "JSS 1",
      jss2: "JSS 2",
      jss3: "JSS 3",
      sss1: "SSS 1",
      sss2: "SSS 2",
      sss3: "SSS 3",
    };
    return classMap[classId] || classId;
  };

  const getTermLabel = (termId) => {
    const termMap = {
      "term1": "First Term",
      "term2": "Second Term",
      "term3": "Third Term",
      "1st": "First Term",
      "2nd": "Second Term",
      "3rd": "Third Term",
    };
    return termMap[termId] || termId;
  };

  return (
    <div className="min-h-screen p-4 md:p-8 bg-white dark:bg-gray-900">
      {/* Header Section */}
      {isReadOnlyView && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          {isHistoricalView
            ? "Viewing historical session data. Changes will NOT affect the active session."
            : isPastTermView
              ? "Viewing a past term. Student management is read-only until you return to the current term."
              : "This view is read-only."}
        </div>
      )}
      {!isReadOnlyView && !showInactiveStudents && !hideActiveOnlyNotice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          <span>Showing active students only. Use "Show Withdrawn" to view lifecycle records.</span>
          <button
            type="button"
            onClick={() => setHideActiveOnlyNotice(true)}
            aria-label="Dismiss notice"
            className="shrink-0 rounded p-1 text-blue-700 transition-colors duration-200 hover:bg-blue-100 hover:text-blue-900 dark:text-blue-300 dark:hover:bg-blue-800/40 dark:hover:text-blue-100"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}
      {!hasClassAccess && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
          You are not assigned to this resource.
        </div>
      )}
      <div className="">
        <div className="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-gray-800 dark:to-gray-700 rounded-lg p-6 md:p-8 mb-8">
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:items-center">
            {/* School Info */}
            <div className="flex items-center gap-3">
              {schoolData.logo && (
                <img
                  src={schoolData.logo}
                  alt={schoolData.name}
                  className="w-12 h-12 rounded-full object-cover border-2 border-blue-800"
                />
              )}
              <div>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  School
                </p>
                <p className="text-sm font-bold text-black dark:text-white ">
                  {schoolData.name}
                </p>
              </div>
            </div>

            {/* Class Info */}
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400">Class</p>
              <p className="text-sm font-bold text-black dark:text-white">
                {getClassLabel(classSelection.class)}
              </p>
            </div>

            {/* Term Info */}
            <div className="max-lg:ml-15">
              <p className="text-xs text-gray-600 dark:text-gray-400">Term</p>
              <p className="text-sm font-bold text-black dark:text-white">
                {getTermLabel(classSelection.term)}
              </p>
            </div>

            {/* Session Info */}
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Session
              </p>
              <p className="text-sm font-bold text-black dark:text-white">
                {selectedSessionName ||
                  (classSelection.session && classSelection.session !== "N/A"
                    ? classSelection.session
                    : "Not set")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats and Search Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Student Count Card */}
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-800 dark:to-gray-700 rounded-lg p-6 border-l-4 border-blue-800">
          <h3 className="text-gray-600 dark:text-gray-300 text-sm font-semibold mb-2">
            Total Students
          </h3>
              {isStudentsLoading ? (
            <div className="h-9 w-16 animate-pulse rounded-lg bg-blue-200/70 dark:bg-gray-600" />
          ) : (
            <p className="text-3xl font-bold text-blue-800 dark:text-blue-400">
              {visibleStudents.length}
            </p>
          )}
        </div>

        {/* Search Input */}
        <div className="">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Enter student name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input w-full !pl-12 !pr-3"
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowInactiveStudents((prev) => !prev)}
            className="mt-3 rounded-lg border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 transition-all duration-300 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {showInactiveStudents ? "Hide Withdrawn" : "Show Withdrawn"}
          </button>
          {/* Add Student Button */}
          <div>
            <div className="mt-3 gap-2  flex justify-between">
              <button
                onClick={() => {
                  setEditingStudent(null);
                  setIsAddModalOpen(true);
                }}
                disabled={isReadOnlyView || isStudentSubmitting || !canEditRoster}
                className="flex items-center gap-2 px-6 py-2 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300 shadow-lg hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Add Student
              </button>

            
              <button
                onClick={() => navigate("/school-dashboard")}
                className="px-6 py-2 md:hidden rounded-lg border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300" >
                Back
              </button>
            </div>
          </div>
        </div>
        <div className="flex-col justify-self-end">
          <button
            onClick={() => navigate("/school-dashboard")}
            className="px-6 py-2 max-md:hidden  rounded-lg border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300" >
            Back
          </button>
        </div>
      </div>

      

      {/* Students Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full">
          <thead className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-4 md:px-6 py-4 text-left">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Name
                </span>
              </th>
              <th className="px-4 md:px-6 py-4 text-left">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Action
                </span>
              </th>
              <th className="px-4 md:px-6 py-4 text-left">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Result
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {isStudentsLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={`student-skeleton-${index}`}>
                  <td className="px-4 md:px-6 py-4">
                    <div className="space-y-2">
                      <div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                      <div className="h-3 w-20 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                    </div>
                  </td>
                  <td className="px-4 md:px-6 py-4">
                    <div className="flex gap-2">
                      <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                      <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                      <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                    </div>
                  </td>
                  <td className="px-4 md:px-6 py-4">
                    <div className="flex gap-2">
                      <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                      <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                    </div>
                  </td>
                </tr>
              ))
            ) : filteredStudents.length > 0 ? (
              filteredStudents.map((student) => (
                <tr
                  key={student.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-200"
                >
                  {/* Name Column */}
                  <td className="px-4 md:px-6 py-4">
                    <div>
                      <p className="font-medium text-black dark:text-white">
                        {formatStudentName(student.name)}
                      </p>
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-[10px] font-semibold ${getStatusMeta(student.status).className}`}
                      >
                        {getStatusMeta(student.status).label}
                      </span>
                      {student.regNumber && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Reg: {student.regNumber}
                        </p>
                      )}
                      {isStudentSyncing(student.id) && (
                        <span className="mt-2 inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Syncing changes...
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Action Column */}
                  <td className="px-4 md:px-6 py-4">
                    {isReadOnlyLifecycleStudent(student) ? (
                      <span className="inline-flex rounded bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        Result only
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleEditStudent(student)}
                          disabled={
                            isReadOnlyView ||
                            isStudentSubmitting ||
                            isStudentSyncing(student.id) ||
                            !canEditRoster
                          }
                          type="button"
                          title="Edit student"
                          aria-label={`Edit ${formatStudentName(student.name)}`}
                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white transition-all duration-300 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {isStudentActive(student) && (
                          <button
                            onClick={() => handleWithdrawStudent(student)}
                            disabled={
                              isReadOnlyView ||
                              isStudentSubmitting ||
                              isStudentSyncing(student.id) ||
                              !canEditRoster
                            }
                            type="button"
                            title="Withdraw student"
                            aria-label={`Withdraw ${formatStudentName(student.name)}`}
                            className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-white transition-all duration-300 hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-orange-700 dark:hover:bg-orange-600"
                          >
                            <UserMinus className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteStudent(student.id)}
                          disabled={
                            isReadOnlyView ||
                            isStudentSubmitting ||
                            isStudentSyncing(student.id) ||
                            !canEditRoster
                          }
                          type="button"
                          title="Delete student"
                          aria-label={`Delete ${formatStudentName(student.name)}`}
                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-white transition-all duration-300 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-700 dark:hover:bg-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>

                  {/* Result Column */}
                  <td className="px-4 md:px-6 py-4">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        title="Preview result"
                        aria-label={`Preview result for ${formatStudentName(student.name)}`}
                        onClick={() => {
                          sessionStorage.setItem(
                            "selectedStudent",
                            JSON.stringify(student),
                          );
                          // Save class info to sessionStorage for result sheet
                          sessionStorage.setItem(
                            "classSelection",
                            JSON.stringify({ ...classSelection, schoolId }),
                          );
                          navigate("/student-result-sheet");
                        }}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-600 text-white transition-all duration-300 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-600"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadResult(student)}
                        disabled={downloadingStudentId === String(student.id || "")}
                        title="Download result"
                        aria-label={`Download result for ${formatStudentName(student.name)}`}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-600 text-white transition-all duration-300 hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-green-700 dark:hover:bg-green-600"
                      >
                        {downloadingStudentId === String(student.id || "")
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Download className="h-4 w-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="3" className="px-6 py-8 text-center">
                  <p className="text-gray-500 dark:text-gray-400">
                    {allStudents.length === 0
                      ? "No students added yet. Click 'Add Student' to get started."
                      : searchTerm
                        ? "No students match your search."
                        : !showInactiveStudents
                          ? 'No active students found. Click "Show Withdrawn" to view lifecycle records.'
                          : "No students match the current filters."}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Student Modal */}
      <AddStudent
        isOpen={isAddModalOpen}
        onClose={() => {
          if (isStudentSubmitting) return;
          setIsAddModalOpen(false);
          setEditingStudent(null);
        }}
        onAdd={handleAddStudent}
        onUpdate={handleUpdateStudent}
        editingStudent={editingStudent}
        isSubmitting={isStudentSubmitting}
      />

      
    </div>
  );
}






