import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getSchoolData, getClassStudents, getCustomClasses, getSession, getCurrentTerm, getTermDisplayName } from "./utils/school-data";
import { getCurrentUser } from "../utils/authUtils";
import { getUserData } from "../utils/userSession";
import ClassSelectionModal from "./ClassSelectionModal";
import ResultModal from "./ResultModal";

export default function SchoolDashboard() {
  const navigate = useNavigate();
  const [schoolData, setSchoolData] = useState({});
  const [userId, setUserId] = useState(null);
  const [schoolId, setSchoolId] = useState(null);
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [totalStudents, setTotalStudents] = useState(0);
  const [totalClasses, setTotalClasses] = useState(0);
  const [currentSession, setCurrentSession] = useState(getSession());
  const [currentTerm, setCurrentTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Load user and school data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const currentUser = getCurrentUser();
        if (!currentUser) {
          navigate("/login", { replace: true });
          return;
        }

        setUserId(currentUser.uid);

        // Get schoolId from user document
        const userData = await getUserData(currentUser.uid);
        if (!userData?.schoolId) {
          navigate("/select-role", { replace: true });
          return;
        }

        setSchoolId(userData.schoolId);

        // Load school data from Firebase
        const data = await getSchoolData(userData.schoolId);
        setSchoolData(data || {});

        // Load term from settings
        setCurrentTerm(getCurrentTerm(userData.schoolId) || "term1");
      } catch (error) {
        console.error("Error loading school data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [navigate]);

  // Calculate real statistics from stored data
  useEffect(() => {
    const loadStats = async () => {
      if (!schoolId) return;

      try {
        // Get custom classes added by admin
        const customClasses = getCustomClasses(schoolId);
        const classIds = customClasses.map((cls) => cls.id);
        let studentCount = 0;

        // Count students across all custom classes
        for (const classId of classIds) {
          try {
            const students = await getClassStudents(schoolId, classId);
            if (students && students.length > 0) {
              studentCount += students.length;
            }
          } catch (error) {
            console.error(`Error loading students for class ${classId}:`, error);
          }
        }

        setTotalStudents(studentCount || 0);
        setTotalClasses(customClasses.length); // Number of custom classes
        setCurrentSession(getSession()); // Current session from settings
      } catch (error) {
        console.error("Error loading statistics:", error);
      }
    };

    loadStats();
  }, [schoolId]);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 p-6 md:p-10">
      {isLoading && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-800"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading dashboard...</p>
          </div>
        </div>
      )}

      {!isLoading && (
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
            <h1 className="text-2xl md:text-4xl font-bold dark:text-white text-black">
              Welcome, {schoolData.name}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {schoolData.address}
            </p>
          </div>
        </div>
      </div>

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
            {totalClasses}
          </p>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-gray-800 dark:to-gray-700 rounded-lg p-6 border-l-4 border-purple-600">
          <h3 className="text-gray-600 dark:text-gray-300 text-sm font-semibold mb-2">
            Session & Term
          </h3>
          <p className="text-xl font-bold text-purple-600 dark:text-purple-400">
            {currentSession}
          </p>
          <p className="text-sm text-purple-700 dark:text-purple-300 font-medium mt-1">
            {getTermDisplayName(currentTerm)}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

        {/* Admin Button */}
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
