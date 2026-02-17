import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  getSchoolData,
  getResultSelection,
  getClassStudents,
  getScores,
  saveScores,
  cleanupMalformedScores,
} from "./utils/school-data";
import { getCurrentUser } from "../utils/authUtils";
import { getUserData } from "../utils/userSession";

export default function RecordDashboard() {
  const navigate = useNavigate();
  const [schoolData, setSchoolData] = useState({});
  const [resultSelection, setResultSelection] = useState({});
  const [userId, setUserId] = useState(null);
  const [schoolId, setSchoolId] = useState(null);
  const [students, setStudents] = useState([]);
  const [scores, setScores] = useState({});
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

        // Cleanup malformed score rows (e.g. studentId "undefined") using authenticated context.
        try {
          await cleanupMalformedScores(userData.schoolId);
        } catch (cleanupError) {
          console.warn("Score cleanup skipped:", cleanupError?.message || cleanupError);
        }

        // Load school data from Firebase
        const data = await getSchoolData(userData.schoolId);
        setSchoolData(data || {});

        setResultSelection(getResultSelection());
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [navigate]);

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
      "1st": "1st Term",
      "2nd": "2nd Term",
      "3rd": "3rd Term",
    };
    return termMap[termId] || termId;
  };

  useEffect(() => {
    if (!userId || !schoolId || !resultSelection.class) return;
    
    const loadScores = async () => {
      try {
        // Load students from Firebase
        const classStudents = await getClassStudents(schoolId, resultSelection.class);
        setStudents(classStudents || []);

        // Load existing scores from Firebase
        const existingScores = await getScores(
          schoolId,
          resultSelection.class,
          resultSelection.subject
        );

        // Initialize scores with existing data or empty strings
        const initialScores = {};
        classStudents?.forEach((student) => {
          initialScores[student.id] = existingScores[student.id] || {
            test1: "",
            test2: "",
            exam: "",
          };
        });

        setScores(initialScores);
      } catch (error) {
        console.error("Error loading scores:", error);
      }
    };

    loadScores();
  }, [schoolId, resultSelection.class, resultSelection.subject]);

  // Auto-save scores to Firebase whenever they change
  useEffect(() => {
    if (!schoolId || !resultSelection.class || !resultSelection.subject || Object.keys(scores).length === 0) return;

    const timer = setTimeout(async () => {
      try {
        await saveScores(
          schoolId,
          resultSelection.class,
          resultSelection.subject,
          scores
        );
      } catch (error) {
        console.error("Error saving scores:", error);
      }
    }, 1000); // Save after 1 second of inactivity

    return () => clearTimeout(timer);
  }, [scores, schoolId, resultSelection.class, resultSelection.subject]);

  const handleScoreChange = (studentId, scoreType, value) => {
    // Allow empty string, or parse as number
    let numValue = value === "" ? "" : parseFloat(value) || 0;

    // Apply limits based on score type
    let limitedValue;
    if (value === "") {
      limitedValue = "";
    } else if (scoreType === "test1" || scoreType === "test2") {
      limitedValue = Math.max(0, Math.min(20, numValue));
    } else if (scoreType === "exam") {
      limitedValue = Math.max(0, Math.min(60, numValue));
    } else {
      limitedValue = Math.max(0, Math.min(100, numValue));
    }

    setScores((prev) => {
      // Only update the specific student's score
      return {
        ...prev,
        [studentId]: {
          ...prev[studentId],
          [scoreType]: limitedValue,
        },
      };
    });
  };

  const handlePreviewResult = () => {
    navigate("/result-preview");
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 p-4 md:p-8">
      {isLoading && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-800"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading records...</p>
          </div>
        </div>
      )}

      {!isLoading && (
        <>
      {/* Header Section */}
      <div className="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-gray-800 dark:to-gray-700 rounded-lg p-6 md:p-8 mb-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 items-center">
          {/* School Info */}
          <div className="flex items-center gap-3">
            {schoolData.logo && (
              <img
                src={schoolData.logo}
                alt={schoolData.name}
                className="w-12 h-12 rounded-full object-cover border-2 border-blue-800"
              />
            )}
            <div className="min-w-0">
              <p className="text-xs text-gray-600 dark:text-gray-400">School</p>
              <p className="text-xs md:text-sm font-bold text-black dark:text-white truncate">
                {schoolData.name}
              </p>
            </div>
          </div>

          {/* Class */}
          <div className="min-w-0">
            <p className="text-xs text-gray-600 dark:text-gray-400">Class</p>
            <p className="text-xs md:text-sm font-bold text-black dark:text-white">
              {getClassLabel(resultSelection.class)}
            </p>
          </div>

          {/* Term */}
          <div className="min-w-0 max-md:ml-15">
            <p className="text-xs text-gray-600 dark:text-gray-400">Term</p>
            <p className="text-xs md:text-sm font-bold text-black dark:text-white">
              {getTermLabel(resultSelection.term)}
            </p>
          </div>

          {/* Session */}
          <div className="min-w-0">
            <p className="text-xs text-gray-600 dark:text-gray-400">Session</p>
            <p className="text-xs md:text-sm font-bold text-black dark:text-white">
              {resultSelection.session}
            </p>
          </div>
        </div>

        {/* Subject */}
        <div className="mt-4 p-3 bg-white dark:bg-gray-700 rounded-lg">
          <p className="text-xs text-gray-600 dark:text-gray-400">Subject</p>
          <p className="text-sm md:text-base font-bold text-black dark:text-white">
            {resultSelection.subject}
          </p>
        </div>
      </div>

      {/* Scores Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 mb-8">
        <table className="w-full">
          <thead className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-4 md:px-6 py-4 text-left">
                <span className="text-xs md:text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Student Name
                </span>
              </th>
              <th className="px-4 md:px-6 py-4 text-center">
                <span className="text-xs md:text-sm font-semibold text-gray-700 dark:text-gray-300">
                  T1 (0-20)
                </span>
              </th>
              <th className="px-4 md:px-6 py-4 text-center">
                <span className="text-xs md:text-sm font-semibold text-gray-700 dark:text-gray-300">
                  T2 (0-20)
                </span>
              </th>
              <th className="px-4 md:px-6 py-4 text-center">
                <span className="text-xs md:text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Exam (0-60)
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {students.length > 0 ? (
              students.map((student) => (
                <tr
                  key={student.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-200"
                >
                  <td className="px-4 md:px-6 py-4">
                    <p className="font-medium text-black dark:text-white text-xs md:text-sm">
                      {student.name}
                    </p>
                  </td>
                  <td className="px-4 md:px-6 py-4">
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={scores[student.id]?.test1 ?? ""}
                      onChange={(e) =>
                        handleScoreChange(student.id, "test1", e.target.value)
                      }
                      className="input w-full text-center text-xs md:text-sm"
                      placeholder="—"
                    />
                  </td>
                  <td className="px-4 md:px-6 py-4">
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={scores[student.id]?.test2 ?? ""}
                      onChange={(e) =>
                        handleScoreChange(student.id, "test2", e.target.value)
                      }
                      className="input w-full text-center text-xs md:text-sm"
                      placeholder="—"
                    />
                  </td>
                  <td className="px-4 md:px-6 py-4">
                    <input
                      type="number"
                      min="0"
                      max="60"
                      value={scores[student.id]?.exam ?? ""}
                      onChange={(e) =>
                        handleScoreChange(student.id, "exam", e.target.value)
                      }
                      className="input w-full text-center text-xs md:text-sm"
                      placeholder="—"
                    />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="4" className="px-6 py-8 text-center">
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    No students in this class
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4 justify-center">
        <button
          onClick={() => navigate("/school-dashboard")}
          className="px-8 py-2 border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300"
        >
          Back
        </button>
        <button
          onClick={handlePreviewResult}
          className="px-8 py-2 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300"
        >
          Preview Result
        </button>
      </div>
        </>
      )}
    </div>
  );
}
