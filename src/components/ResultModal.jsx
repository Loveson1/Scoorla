import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  canonicalizeResultSelection,
  getResultSelection,
  queueRecordDashboardWarmScopes,
  saveResultSelection,
  warmRecordDashboardScopeCache,
} from "./utils/school-data";
import { useSessionContext } from "../context/SessionContext";
import { useAuthContext } from "../context/AuthContext";
import { useSchoolBootstrap } from "../context/SchoolBootstrapContext";

const getBootstrapClassOptions = (schoolData = {}) => {
  return Object.values(schoolData?.classes || {})
    .map((item) => ({
      id: item?.classId || item?.id || "",
      label: item?.label || item?.name || item?.classId || item?.id || "",
    }))
    .filter((item) => item.id)
    .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
};

const getBootstrapSubjectsByClass = (schoolData = {}, classId = "") => {
  const normalizedClassId = String(classId || "").trim().toLowerCase();
  const isJunior = ["jss1", "jss2", "jss3"].includes(normalizedClassId);
  const catalog = schoolData?.subjects || {};
  const scopedSubjects = isJunior ? catalog?.junior : catalog?.senior;
  return Array.isArray(scopedSubjects) ? scopedSubjects : [];
};

export default function ResultModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const {
    selectedSessionId,
    selectedSessionName,
    selectedTermId,
    activeSessionId,
    activeTermId,
  } = useSessionContext();
  const {
    isAdmin,
    canAccessClass,
    canAccessSubject,
    authUser,
    schoolId,
  } = useAuthContext();
  const { schoolData } = useSchoolBootstrap();
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const preloadPromiseRef = useRef(null);

  const buildRecordSnapshotKey = ({
    schoolId: targetSchoolId,
    userId,
    classId,
    subjectId,
    sessionId,
    termId,
  }) =>
    [
      "recordDashboardSnapshot",
      String(targetSchoolId || "").trim(),
      String(userId || "").trim(),
      String(classId || "").trim(),
      String(subjectId || "").trim(),
      String(sessionId || "").trim(),
      String(termId || "").trim(),
    ].join("__");

  const preloadRecordSnapshot = useCallback(
    async ({
      classId,
      subjectId,
      sessionId,
      termId,
    }) => {
      if (!schoolId || !authUser?.uid || !classId || !subjectId || !sessionId) {
        return;
      }

      const snapshotKey = buildRecordSnapshotKey({
        schoolId,
        userId: authUser.uid,
        classId,
        subjectId,
        sessionId,
        termId,
      });

      const { students, scores } = await warmRecordDashboardScopeCache({
        schoolId,
        classId,
        subjectId,
        sessionId,
        termId,
      });

      try {
        sessionStorage.setItem(
          snapshotKey,
          JSON.stringify({
            students: students || [],
            scores: scores || {},
            ltcByStudent: {},
            ltcUiMeta: {
              currentTermOrder: 1,
              allowClassWideManualOnZero: false,
            },
            savedAt: Date.now(),
          })
        );
      } catch {
        // Ignore snapshot cache write failures.
      }
    },
    [authUser?.uid, schoolId]
  );

  useEffect(() => {
    if (isOpen) {
      setSelectedClass("");
      setSelectedSubject("");
      const bootstrapClasses = getBootstrapClassOptions(schoolData);
      const allClasses =
        bootstrapClasses.length > 0
          ? bootstrapClasses
          : [
              { id: "jss1", label: "JSS 1" },
              { id: "jss2", label: "JSS 2" },
              { id: "jss3", label: "JSS 3" },
              { id: "sss1", label: "SSS 1" },
              { id: "sss2", label: "SSS 2" },
              { id: "sss3", label: "SSS 3" },
            ];
      const filtered = isAdmin
        ? allClasses
        : allClasses.filter((cls) => canAccessClass(cls?.id || cls));
      setClasses(filtered);
    }
  }, [isOpen, isAdmin, canAccessClass, schoolId, schoolData]);

  useEffect(() => {
    if (selectedClass && schoolId) {
      const classSubjects = getBootstrapSubjectsByClass(schoolData, selectedClass) || [];
      const filteredSubjects = isAdmin
        ? classSubjects
        : classSubjects.filter((item) => canAccessSubject(item));
      setSubjects(filteredSubjects);
    } else {
      setSubjects([]);
    }
  }, [selectedClass, schoolId, isAdmin, canAccessSubject, schoolData]);

  useEffect(() => {
    if (!isOpen || !selectedClass || !selectedSubject || !schoolId || !authUser?.uid) {
      preloadPromiseRef.current = null;
      return;
    }

    const resolvedSessionId = selectedSessionId || activeSessionId || "";
    const resolvedTermId = selectedTermId || activeTermId || "term1";
    if (!resolvedSessionId) {
      preloadPromiseRef.current = null;
      return;
    }

    const preloadPromise = preloadRecordSnapshot({
      classId: selectedClass,
      subjectId: selectedSubject,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
    }).catch(() => {
      // Ignore silent warm failures; RecordDashboard will fall back to its live path.
    });

    preloadPromiseRef.current = preloadPromise;
  }, [
    isOpen,
    selectedClass,
    selectedSubject,
    selectedSessionId,
    selectedTermId,
    activeSessionId,
    activeTermId,
    schoolId,
    authUser?.uid,
    preloadRecordSnapshot,
  ]);

  useEffect(() => {
    if (!isOpen || !selectedClass || !schoolId || !authUser?.uid || subjects.length === 0) {
      return;
    }
    const resolvedSessionId = selectedSessionId || activeSessionId || "";
    const resolvedTermId = selectedTermId || activeTermId || "term1";
    if (!resolvedSessionId) {
      return;
    }

    let candidateSubjects = [];
    if (isAdmin) {
      const recentSelection = canonicalizeResultSelection(
        getResultSelection(authUser.uid),
        schoolId
      );
      const recentSubject = String(recentSelection?.subject || "").trim();
      candidateSubjects = [
        ...(recentSelection?.class === selectedClass && recentSubject ? [recentSubject] : []),
        ...subjects.slice(0, 1),
      ];
    } else {
      candidateSubjects = subjects;
    }

    const scopes = [...new Set(candidateSubjects.filter(Boolean))].map((subjectId) => ({
      schoolId,
      classId: selectedClass,
      subjectId,
      sessionId: resolvedSessionId,
      termId: resolvedTermId,
    }));

    queueRecordDashboardWarmScopes(scopes, { limit: isAdmin ? 2 : 6 });
  }, [
    activeSessionId,
    activeTermId,
    authUser?.uid,
    isAdmin,
    isOpen,
    schoolId,
    selectedClass,
    selectedSessionId,
    selectedTermId,
    subjects,
  ]);

  const handleInputScore = async () => {
    if (!selectedClass || !selectedSubject) {
      alert("Please select class and subject");
      return;
    }
    if (!isAdmin && !canAccessClass(selectedClass)) {
      alert("You are not assigned to this resource");
      return;
    }
    if (!isAdmin && !canAccessSubject(selectedSubject)) {
      alert("You are not assigned to this resource");
      return;
    }

    const resolvedSessionId = selectedSessionId || activeSessionId || "";
    if (!resolvedSessionId) {
      alert("No active session is selected. Ask admin to set an active session first.");
      return;
    }
    const resolvedSessionName = selectedSessionName || "Not set";
    const resultData = {
      class: selectedClass,
      term: selectedTermId || activeTermId || "term1",
      session: resolvedSessionName,
      sessionId: resolvedSessionId,
      subject: selectedSubject,
    };

    saveResultSelection(resultData, authUser?.uid);
    navigate("/record-dashboard");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm  flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-md w-full mx-4 p-6 md:p-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-black dark:text-white">
            Record Result
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <div className="space-y-5">
          {/* Class Selection */}
          <div>
            <label className="label-w block mb-3">Class Level</label>
            <div className="grid grid-cols-2 gap-2 md:gap-3">
              {classes.map((cls) => (
                <button
                  key={cls.id}
                  onClick={() => {
                    setSelectedClass(cls.id);
                    setSelectedSubject(""); // Reset subject when class changes
                  }}
                  className={`py-2 px-3 rounded-lg font-medium transition-all duration-300 text-sm md:text-base ${
                    selectedClass === cls.id
                      ? "bg-blue-800 text-white shadow-lg"
                      : "bg-gray-100 dark:bg-gray-700 text-black dark:text-white border border-gray-300 dark:border-gray-600 hover:border-blue-800"
                  }`}
                >
                  {cls.label}
                </button>
              ))}
            </div>
          </div>

          {/* Subject Selection - only show if class is selected */}
          {selectedClass && subjects.length > 0 && (
            <div>
              <label className="label-w block mb-3">Subject</label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {subjects.map((subject) => {
                  return (
                    <button
                      key={subject}
                      onClick={() => setSelectedSubject(subject)}
                      className={`w-full py-2 px-3 rounded-lg font-medium transition-all duration-300 text-sm text-left ${
                        selectedSubject === subject
                          ? "bg-blue-800 text-white shadow-lg"
                          : "bg-gray-100 dark:bg-gray-700 text-black dark:text-white border border-gray-300 dark:border-gray-600 hover:border-blue-800"
                      }`}
                    >
                      {subject}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-8">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 rounded-lg border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300"
          >
            Cancel
          </button>
          <button
            onClick={handleInputScore}
            disabled={!selectedSubject}
            className="flex-1 py-2 px-4 rounded-lg bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold transition-all duration-300"
          >
            Input Score
          </button>
        </div>
      </div>
    </div>
  );
}
