import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { saveClassSelection, getSession, getCustomClasses, getCurrentTerm } from "./utils/school-data";
import { getCurrentUser } from "../utils/authUtils";
import { getUserData } from "../utils/userSession";

export default function ClassSelectionModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [userId, setUserId] = useState(null);
  const [schoolId, setSchoolId] = useState(null);
  const [classes, setClasses] = useState([]);

  useEffect(() => {
    const loadData = async () => {
      const currentUser = getCurrentUser();
      if (currentUser) {
        setUserId(currentUser.uid);
        
        // Get schoolId from Firestore
        const userData = await getUserData(currentUser.uid);
        if (userData?.schoolId) {
          setSchoolId(userData.schoolId);
          // Load classes for this school
          const customClasses = getCustomClasses(userData.schoolId);
          setClasses(customClasses || []);
        }
      }
    };
    
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const handleGoToClass = (selectedClass) => {
    if (!userId) {
      alert("User not found");
      return;
    }

    const classData = {
      class: selectedClass,
      term: getCurrentTerm(schoolId) || "term1", // Use admin-preset term
      session: getSession(),
    };

    console.log("Saving class selection:", { classData, userId });
    saveClassSelection(classData, userId);
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
            ×
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
                  className="py-3 px-3 rounded-lg font-medium transition-all duration-300 text-sm md:text-base bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white shadow-lg hover:shadow-xl"
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
