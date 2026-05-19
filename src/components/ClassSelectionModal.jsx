import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  getDepartmentAwareClassStudents,
  saveClassSelection,
  getCustomClasses,
} from "./utils/school-data";
import { useSessionContext } from "../context/SessionContext";
import { useAuthContext } from "../context/AuthContext";
import { useSchoolBootstrap } from "../context/SchoolBootstrapContext";
import {
  buildClassDashboardPath,
  getDepartmentsForClass,
} from "../utils/departmentUtils";

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

const buildClassRosterQueryKey = ({
  schoolId,
  userId,
  classId,
  departmentId,
  sessionId,
  termId,
}) => [
  "class",
  String(schoolId || "").trim() || "none",
  String(userId || "").trim() || "anonymous",
  String(classId || "").trim() || "none",
  String(departmentId || "").trim() || "all",
  String(sessionId || "").trim() || "none",
  String(termId || "").trim() || "term1",
];

const CLASS_DASHBOARD_PREFETCH_STALE_TIME = 10 * 60 * 1000;
const CLASS_DASHBOARD_PREFETCH_GC_TIME = 30 * 60 * 1000;

export default function ClassSelectionModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    selectedSessionId,
    selectedSessionName,
    selectedTermId,
    activeSessionId,
    activeTermId,
  } = useSessionContext();
  const { isAdmin, canManageClass, authUser, schoolId } = useAuthContext();
  const { adminSettings } = useSchoolBootstrap();
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");

  useEffect(() => {
    if (isOpen) {
      const customClasses = schoolId ? getCustomClasses(schoolId) : [];
      const allClasses = customClasses || [];
      const filtered = isAdmin
        ? allClasses
        : allClasses.filter((cls) => canManageClass(cls?.id || cls));
      setClasses(filtered);
      setSelectedClassId("");
    }
  }, [isOpen, isAdmin, canManageClass, schoolId]);

  const selectedDepartments = selectedClassId
    ? getDepartmentsForClass(adminSettings?.classStructure || {}, selectedClassId)
    : [];

  const handleGoToClass = async (selectedClass, department = null) => {
    if (!authUser?.uid) {
      alert("User not found");
      return;
    }
    if (!isAdmin && !canManageClass(selectedClass)) {
      alert("You are not assigned to this resource");
      return;
    }

    const resolvedSessionId = selectedSessionId || activeSessionId || "";
    if (!resolvedSessionId) {
      alert("No active session is selected. Ask admin to set an active session first.");
      return;
    }
    const resolvedSessionName = selectedSessionName || "Not set";
    const selectedDepartmentId = String(department?.id || "").trim();
    const classData = {
      class: selectedClass,
      term: selectedTermId || activeTermId || "term1",
      session: resolvedSessionName,
      sessionId: resolvedSessionId,
      departmentId: selectedDepartmentId,
      departmentName: String(department?.name || "").trim(),
    };

    try {
      await queryClient.prefetchQuery({
        queryKey: buildClassRosterQueryKey({
          schoolId,
          userId: authUser.uid,
          classId: selectedClass,
          departmentId: selectedDepartmentId,
          sessionId: resolvedSessionId,
          termId: classData.term,
        }),
        queryFn: () =>
          getDepartmentAwareClassStudents(schoolId, selectedClass, {
            sessionId: resolvedSessionId,
            termId: classData.term,
            departmentId: selectedDepartmentId,
            classStructure: adminSettings?.classStructure || {},
            includeInactive: true,
            includeDeleted: true,
          }),
        staleTime: CLASS_DASHBOARD_PREFETCH_STALE_TIME,
        gcTime: CLASS_DASHBOARD_PREFETCH_GC_TIME,
      });
    } catch (prefetchError) {
      console.warn("Class roster prefetch skipped:", prefetchError?.message || prefetchError);
    }

    console.log("Saving class selection:", { classData, userId: authUser.uid });
    saveClassSelection(classData, authUser.uid);
    queryClient.setQueryData(
      buildClassSelectionQueryKey({
        userId: authUser.uid,
        sessionId: resolvedSessionId,
        sessionName: resolvedSessionName,
        termId: classData.term,
      }),
      classData
    );
    navigate(
      buildClassDashboardPath({
        classId: selectedClass,
        departmentId: selectedDepartmentId,
        classStructure: adminSettings?.classStructure || {},
      })
    );
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm  flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-md w-full mx-4 p-6 md:p-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-black dark:text-white">
            Select Class
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <div className="space-y-5">
          {!selectedClassId ? (
            <div>
              <label className="label-w block mb-3">Class Level</label>
              <div className="grid grid-cols-2 gap-2 md:gap-3">
                {classes.map((cls) => {
                  const classId = String(cls?.id || "").trim();
                  const departments = getDepartmentsForClass(
                    adminSettings?.classStructure || {},
                    classId
                  );
                  const hasDepartments = departments.length > 0;

                  return (
                    <button
                      key={classId}
                      onClick={() =>
                        hasDepartments
                          ? setSelectedClassId(classId)
                          : void handleGoToClass(classId)
                      }
                      className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-black transition-all duration-300 hover:border-blue-800 dark:border-gray-600 dark:bg-gray-700 dark:text-white md:text-base"
                    >
                      <span className="block">{cls.label}</span>
                      {hasDepartments ? (
                        <span className="mt-1 block text-xs font-semibold text-blue-700 dark:text-blue-300">
                          Choose department
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <label className="label-w block">Department</label>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Select the department view for this class.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedClassId("")}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-all duration-300 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Change Class
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 md:gap-3">
                {selectedDepartments.map((department) => (
                  <button
                    key={department.id}
                    onClick={() => handleGoToClass(selectedClassId, department)}
                    className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-3 text-left text-sm font-medium text-black transition-all duration-300 hover:border-blue-800 dark:border-gray-600 dark:bg-gray-700 dark:text-white md:text-base"
                  >
                    <span className="block">{department.name}</span>
                    <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                      {(department.subjects || []).length} subject
                      {(department.subjects || []).length === 1 ? "" : "s"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



