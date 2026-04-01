import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { auth } from "../firebase";
import { LogOut, AlertCircle, ChevronLeft } from "lucide-react";
import { getUserSchoolId } from "../utils/authUtils";
import {
  getSchoolData,
  getSubjectsByClass,
  saveResultSelection,
  getCustomClasses,
  getSession,
  getCurrentTerm,
} from "./utils/school-data";
import TeacherPasswordModal from "./TeacherPasswordModal";

/**
 * SubjectTeacherAccess - Allows subject teachers to select class, subject, and verify password
 * Flow: Select Class -> Select Subject -> Verify Password -> Access record-dashboard
 */
export default function SubjectTeacherAccess() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = auth.currentUser;
  
  const [currentStep, setCurrentStep] = useState("select-class");
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [schoolId, setSchoolId] = useState(null);
  const [selectedClass, setSelectedClass] = useState(null);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const formatClassDisplay = (classId) => {
    const raw = String(classId || "").trim();
    if (!raw) return raw;
    const matched = raw.match(/^([a-zA-Z]+)\s*(\d+)$/);
    if (matched) return `${matched[1].toUpperCase()} ${matched[2]}`;
    return raw.toUpperCase();
  };

  const normalizeClasses = (source) => {
    if (!source) return [];

    if (Array.isArray(source)) {
      return source
        .map((item) => (typeof item === "string" ? item : item?.id))
        .filter(Boolean);
    }

    if (typeof source === "object") {
      return Object.keys(source);
    }

    return [];
  };

  // Load school and classes on mount
  useEffect(() => {
    const loadSchoolData = async () => {
      if (!user) {
        navigate("/select-role");
        return;
      }

      try {
        const sId = await getUserSchoolId(user.uid);
        if (!sId) {
          setError("School information not found");
          return;
        }

        setSchoolId(sId);

        // Use school data from location state if available
        const locationClasses = normalizeClasses(location.state?.classes);
        if (locationClasses.length > 0) {
          setClasses(locationClasses);
        } else {
          // Otherwise fetch it
          const schoolData = await getSchoolData(sId);
          const dbClasses = normalizeClasses(schoolData?.classes);
          if (dbClasses.length > 0) {
            setClasses(dbClasses);
          } else {
            // Final fallback to locally configured custom classes
            const customClasses = getCustomClasses(sId);
            const fallbackClasses = normalizeClasses(customClasses);
            setClasses(fallbackClasses);
          }
        }
      } catch (err) {
        console.error("Error loading school data:", err);
        setError("Failed to load school information");
      } finally {
        setLoading(false);
      }
    };

    loadSchoolData();
  }, [user, navigate, location.state]);

  const handleClassSelect = async (classId) => {
    setSelectedClass(classId);
    
    // Load subjects for the selected class
    try {
      const classSubjects = await getSubjectsByClass(schoolId, classId);
      if (Array.isArray(classSubjects)) {
        setSubjects(classSubjects);
      } else if (classSubjects && typeof classSubjects === "object") {
        setSubjects(Object.keys(classSubjects));
      } else {
        setSubjects([]);
      }
    } catch (err) {
      console.error("Error loading subjects:", err);
      setError("Failed to load subjects for this class");
    }
    
    setCurrentStep("select-subject");
  };

  const handleSubjectSelect = (subjectId) => {
    setSelectedSubject(subjectId);
    setShowPasswordModal(true);
  };

  const handlePasswordVerified = async () => {
    try {
      // Save subject selection for this teacher session
      if (user && schoolId && selectedClass && selectedSubject) {
        const currentTerm = getCurrentTerm(schoolId) || "term1";
        const currentSession = getSession();
        saveResultSelection({
          schoolId,
          class: selectedClass,
          subject: selectedSubject,
          term: currentTerm,
          session: currentSession,
          classId: selectedClass,
          subjectId: selectedSubject,
          teacherType: "subject",
          accessedAt: new Date().toISOString(),
        });
      }

      // Close modal and navigate to record dashboard
      setShowPasswordModal(false);
      navigate("/record-dashboard", {
        state: {
          schoolId,
          classId: selectedClass,
          subjectId: selectedSubject,
          teacherType: "subject",
        },
      });
    } catch (err) {
      console.error("Error saving subject selection:", err);
      setError("Failed to save subject selection. Please try again.");
    }
  };

  const handleBack = () => {
    setCurrentStep("select-class");
    setSelectedClass(null);
    setSelectedSubject(null);
    setSubjects([]);
    setError("");
  };

  const handleLogout = () => {
    navigate("/select-role");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading classes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8 md:mb-12">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">
            Subject Teacher Access
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            {currentStep === "select-class" 
              ? "Select your class" 
              : "Select your subject to record scores"}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Class Selection Step */}
        {currentStep === "select-class" && (
          <div>
            <div className="grid md:grid-cols-2 gap-4 mb-8">
              {classes && classes.length > 0 ? (
                classes.map((classId) => (
                  <button
                    key={classId}
                    onClick={() => handleClassSelect(classId)}
                    className="p-6 bg-white dark:bg-gray-800 rounded-xl border-2 border-blue-200 dark:border-blue-700 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-lg transition-all duration-300 text-left hover:-translate-y-1 active:scale-95"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                          {formatClassDisplay(classId)}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Click to select this class
                        </p>
                      </div>
                      <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                        <span className="text-blue-600 dark:text-blue-400 font-bold">→</span>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="col-span-2 p-8 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl border border-yellow-200 dark:border-yellow-700 text-center">
                  <p className="text-gray-700 dark:text-gray-300">
                    No classes available. Please ensure your school has created classes.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="text-center">
              <button
                onClick={handleLogout}
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white underline flex items-center justify-center gap-2 mx-auto transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Back to Role Selection
              </button>
            </div>
          </div>
        )}

        {/* Subject Selection Step */}
        {currentStep === "select-subject" && (
          <div>
            <div className="grid md:grid-cols-2 gap-4 mb-8">
              {subjects && subjects.length > 0 ? (
                subjects.map((subjectId) => (
                  <button
                    key={subjectId}
                    onClick={() => handleSubjectSelect(subjectId)}
                    className="p-6 bg-white dark:bg-gray-800 rounded-xl border-2 border-purple-200 dark:border-purple-700 hover:border-purple-400 dark:hover:border-purple-500 hover:shadow-lg transition-all duration-300 text-left hover:-translate-y-1 active:scale-95"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                          {subjectId}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Click to record scores for this subject
                        </p>
                      </div>
                      <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                        <span className="text-purple-600 dark:text-purple-400 font-bold">→</span>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="col-span-2 p-8 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl border border-yellow-200 dark:border-yellow-700 text-center">
                  <p className="text-gray-700 dark:text-gray-300">
                    No subjects available for this class.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-4 justify-center">
              <button
                onClick={handleBack}
                className="px-6 py-2 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Back to Classes
              </button>
              <button
                onClick={handleLogout}
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white underline flex items-center justify-center gap-2 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Back to Role Selection
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Password Verification Modal */}
      {selectedSubject && (
        <TeacherPasswordModal
          isOpen={showPasswordModal}
          onClose={() => {
            setShowPasswordModal(false);
            setSelectedSubject(null);
          }}
          onVerified={handlePasswordVerified}
          accessType="subject"
          schoolId={schoolId}
          classId={selectedClass}
          subjectId={selectedSubject}
          itemName={selectedSubject}
        />
      )}
    </div>
  );
}
