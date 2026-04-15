import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  saveClassSelection,
  getCustomClasses,
} from "./utils/school-data";
import { useSessionContext } from "../context/SessionContext";
import { useAuthContext } from "../context/AuthContext";

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
  const [classes, setClasses] = useState([]);

  useEffect(() => {
    if (isOpen) {
      const customClasses = schoolId ? getCustomClasses(schoolId) : [];
      const allClasses = customClasses || [];
      const filtered = isAdmin
        ? allClasses
        : allClasses.filter((cls) => canManageClass(cls?.id || cls));
      setClasses(filtered);
    }
  }, [isOpen, isAdmin, canManageClass, schoolId]);

  const handleGoToClass = (selectedClass) => {
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
    const classData = {
      class: selectedClass,
      term: selectedTermId || activeTermId || "term1",
      session: resolvedSessionName,
      sessionId: resolvedSessionId,
    };

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
    navigate("/class-dashboard");
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
          {/* Class Selection Only */}
          <div>
            <label className="label-w block mb-3">Class Level</label>
            <div className="grid grid-cols-2 gap-2 md:gap-3">
              {classes.map((cls) => (
                <button
                  key={cls.id}
                  onClick={() => handleGoToClass(cls.id)}
                  className="py-2 px-3 rounded-lg font-medium transition-all duration-300 text-sm md:text-base bg-gray-100 dark:bg-gray-700 text-black dark:text-white border border-gray-300 dark:border-gray-600 hover:border-blue-800"

                >
                  {cls.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



