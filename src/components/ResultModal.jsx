import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getSubjectsByClass, saveResultSelection, getSession, getCustomClasses, getCurrentTerm } from "./utils/school-data";
import { getCurrentUser } from "../utils/authUtils";
import { getUserData } from "../utils/userSession";

export default function ResultModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [schoolId, setSchoolId] = useState(null);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);

  useEffect(() => {
    const loadData = async () => {
      const currentUser = getCurrentUser();
      if (currentUser) {
        const userData = await getUserData(currentUser.uid);
        if (userData?.schoolId) {
          setSchoolId(userData.schoolId);
          setClasses(getCustomClasses(userData.schoolId) || []);
        }
      }
    };
    
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedClass && schoolId) {
      const classSubjects = getSubjectsByClass(schoolId, selectedClass) || [];
      setSubjects(classSubjects);
    } else {
      setSubjects([]);
    }
  }, [selectedClass, schoolId]);

  const handleInputScore = () => {
    if (!selectedClass || !selectedSubject) {
      alert("Please select class and subject");
      return;
    }

    const resultData = {
      class: selectedClass,
      term: getCurrentTerm(schoolId) || "term1", // Use admin-preset term
      session: getSession(),
      subject: selectedSubject,
    };

    saveResultSelection(resultData, getCurrentUser().uid);
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
                {subjects.map((subject) => (
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
                ))}
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
