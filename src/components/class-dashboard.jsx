import { useCallback, useEffect, useState } from "react";
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


export default function ClassDashboard() {
  const navigate = useNavigate();
  const { isAdmin, canManageStudents, canAccessClass, authUser, schoolId } = useAuthContext();
  const { schoolData, adminSettings } = useSchoolBootstrap();
  const {
    selectedSessionId,
    activeSessionId,
    selectedSessionName,
    selectedTermId,
    isHistoricalView,
    isReadOnlyView,
    isPastTermView,
  } = useSessionContext();
  const [classSelection, setClassSelection] = useState({});
  const [students, setStudents] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showInactiveStudents, setShowInactiveStudents] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [isStudentSubmitting, setIsStudentSubmitting] = useState(false);
  const [downloadingStudentId, setDownloadingStudentId] = useState("");
  const [isStudentsLoading, setIsStudentsLoading] = useState(true);
  const [hasHydratedSelection, setHasHydratedSelection] = useState(false);

  const normalizeStudentName = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
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
  const hasClassAccess = isAdmin || canAccessClass(classSelection.class);
  const canEditRoster = hasClassAccess && canManageStudents();
  const resolvedRosterSessionId =
    selectedSessionId || classSelection.sessionId || activeSessionId || null;
  const resolvedRosterTermId = selectedTermId || classSelection.term || "term1";
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
  const loadClassStudents = useCallback(async () => {
    if (!schoolId || !classSelection.class) {
      setStudents([]);
      if (hasHydratedSelection) {
        setIsStudentsLoading(false);
      }
      return;
    }
    if (!hasClassAccess) {
      setStudents([]);
      setIsStudentsLoading(false);
      return;
    }
    setIsStudentsLoading(true);
    try {
      const savedStudents = await getClassStudents(schoolId, classSelection.class, {
        sessionId: resolvedRosterSessionId,
        termId: resolvedRosterTermId,
        includeInactive: isHistoricalView || showInactiveStudents,
        includeDeleted: isHistoricalView || showInactiveStudents,
      });
      setStudents(applyVisibleRoster(savedStudents || []));
    } catch (error) {
      console.error("Error loading class students:", error);
      setStudents([]);
    } finally {
      setIsStudentsLoading(false);
    }
  }, [
    schoolId,
    classSelection.class,
    resolvedRosterSessionId,
    resolvedRosterTermId,
    isHistoricalView,
    showInactiveStudents,
    hasClassAccess,
    applyVisibleRoster,
    hasHydratedSelection,
  ]);

  useEffect(() => {
    if (!authUser?.uid) {
      setHasHydratedSelection(false);
      return;
    }
    setClassSelection(getClassSelection(authUser.uid));
    setHasHydratedSelection(true);
  }, [authUser?.uid]);

  useEffect(() => {
    if (!schoolId || !classSelection.class) {
      if (hasHydratedSelection) {
        setIsStudentsLoading(false);
      }
      return;
    }

    // Load students from Firebase
    loadClassStudents();
  }, [classSelection.class, schoolId, loadClassStudents, hasHydratedSelection]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setClassSelection((prev) => {
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
    if (!normalizedInputName) {
      alert("Student name is required.");
      return;
    }

    const knownRoster = Array.isArray(students) ? students : [];
    const duplicate = knownRoster.some(
      (student) => normalizeStudentName(student?.name) === normalizedInputName
    );
    if (duplicate) {
      alert("A student with this name already exists in this class.");
      return;
    }
    
    const newStudent = {
      id: Date.now(),
      name: String(studentData.name || "").replace(/\s+/g, " ").trim(),
      regNumber: studentData.regNumber || "",
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
    setStudents((prev) => applyVisibleRoster([...(Array.isArray(prev) ? prev : []), optimisticStudent]));
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
        setStudents(applyVisibleRoster(saveResult.students));
      } else {
        await loadClassStudents();
      }
    } catch (error) {
      console.error("Error adding student:", error);
      setStudents((prev) =>
        (Array.isArray(prev) ? prev : []).filter((student) => student?.id !== optimisticStudent.id)
      );
      alert("Failed to add student: " + error.message);
      await loadClassStudents();
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

    const student = students.find((item) => item.id === studentId);
    if (isReadOnlyLifecycleStudent(student)) {
      alert("Withdrawn students are read-only. Use preview/download result.");
      return;
    }

    setIsStudentSubmitting(true);
    let guard;
    try {
      guard = await canDeleteStudentSafely(schoolId, studentId);
    } catch (error) {
      console.error("Error checking delete safety:", error);
      alert(`Failed to validate delete safety: ${error?.message || "Unknown error"}`);
      setIsStudentSubmitting(false);
      return;
    }

    if (!guard?.canDelete) {
      const confirmWithdraw = window.confirm(
        `${guard?.reason || "Student has academic records."}\n\nMark this student as withdrawn instead?`
      );
      if (confirmWithdraw) {
        try {
          await withdrawStudent(schoolId, studentId);
          await loadClassStudents();
        } catch (error) {
          console.error("Error withdrawing student:", error);
          alert("Failed to withdraw student: " + error.message);
        } finally {
          setIsStudentSubmitting(false);
        }
      } else {
        setIsStudentSubmitting(false);
      }
      return;
    }

    if (window.confirm("Are you sure you want to permanently delete this student?")) {
      try {
        console.log("Deleting from Firebase:", { schoolId, studentId });
        await deleteStudentRecord(schoolId, studentId);
        await loadClassStudents();
      } catch (error) {
        console.error("Error deleting student:", error);
        alert("Failed to delete student: " + error.message);
      } finally {
        setIsStudentSubmitting(false);
      }
      return;
    }

    setIsStudentSubmitting(false);
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
      const results = await getStudentReportRows({
        schoolId,
        classId: classSelection.class,
        studentId: student.id,
        termId: classSelection.term,
        sessionId: classSelection.sessionId || selectedSessionId,
        adminSettings,
        screen: "ClassDashboard",
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
        totalStudentsInClass: students.length,
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
    if (!normalizedInputName) {
      alert("Student name is required.");
      return;
    }

    const allClassStudents = await getClassStudents(schoolId, classSelection.class, {
      sessionId: writeSessionId || classSelection.sessionId,
      termId: resolvedRosterTermId,
      includeInactive: true,
      includeDeleted: true,
    });
    const duplicate = (allClassStudents || []).some(
      (student) =>
        student.id !== editingStudent.id &&
        normalizeStudentName(student?.name) === normalizedInputName
    );
    if (duplicate) {
      alert("A student with this name already exists in this class.");
      return;
    }
    
    const updatedStudent = {
      ...editingStudent,
      name: String(studentData.name || "").replace(/\s+/g, " ").trim(),
      regNumber: studentData.regNumber,
      sex: studentData.sex,
      phone: studentData.phone,
    };
    setStudents((prev) =>
      prev.map((s) => (s.id === editingStudent.id ? updatedStudent : s))
    );
    
    setIsStudentSubmitting(true);
    try {
      const saveResult = await saveClassStudents(schoolId, classSelection.class, [updatedStudent], authUser.uid, {
        sessionId: writeSessionId,
        termId: resolvedRosterTermId,
        upsertExistingStudent: true,
        existingRoster: allClassStudents,
      });
      if (Array.isArray(saveResult?.students)) {
        setStudents(applyVisibleRoster(saveResult.students));
      } else {
        await loadClassStudents();
      }
      
      setEditingStudent(null);
      setIsAddModalOpen(false);
    } catch (error) {
      console.error("Error updating student:", error);
      alert("Failed to update student: " + error.message);
      await loadClassStudents();
    } finally {
      setIsStudentSubmitting(false);
    }
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
    if (!window.confirm(`Withdraw ${student.name}?`)) return;

    setIsStudentSubmitting(true);
    try {
      await withdrawStudent(schoolId, student.id);
      await loadClassStudents();
    } catch (error) {
      console.error("Error withdrawing student:", error);
      alert("Failed to withdraw student: " + error.message);
    } finally {
      setIsStudentSubmitting(false);
    }
  };

  const filteredStudents = students
    .filter((student) =>
      student.name.toLowerCase().includes(searchTerm.toLowerCase()),
    )
    .sort((left, right) => {
      const leftStatus = String(left?.status || "active").toLowerCase();
      const rightStatus = String(right?.status || "active").toLowerCase();
      const leftIsWithdrawn = leftStatus === "withdrawn" || leftStatus === "graduated";
      const rightIsWithdrawn = rightStatus === "withdrawn" || rightStatus === "graduated";

      if (leftIsWithdrawn !== rightIsWithdrawn) {
        return leftIsWithdrawn ? -1 : 1;
      }

      return String(left?.name || "").localeCompare(String(right?.name || ""));
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
      {!isReadOnlyView && !showInactiveStudents && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          Showing active students only. Use "Show Withdrawn" to view lifecycle records.
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
              {students.length}
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
                        {student.name}
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
                          disabled={isReadOnlyView || isStudentSubmitting || !canEditRoster}
                          type="button"
                          title="Edit student"
                          aria-label={`Edit ${student.name}`}
                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white transition-all duration-300 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {isStudentActive(student) && (
                          <button
                            onClick={() => handleWithdrawStudent(student)}
                            disabled={isReadOnlyView || isStudentSubmitting || !canEditRoster}
                            type="button"
                            title="Withdraw student"
                            aria-label={`Withdraw ${student.name}`}
                            className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-white transition-all duration-300 hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-orange-700 dark:hover:bg-orange-600"
                          >
                            <UserMinus className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteStudent(student.id)}
                          disabled={isReadOnlyView || isStudentSubmitting || !canEditRoster}
                          type="button"
                          title="Delete student"
                          aria-label={`Delete ${student.name}`}
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
                        aria-label={`Preview result for ${student.name}`}
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
                        aria-label={`Download result for ${student.name}`}
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
                    {students.length === 0
                      ? "No students added yet. Click 'Add Student' to get started."
                      : "No students match your search."}
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
