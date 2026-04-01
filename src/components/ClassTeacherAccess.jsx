import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { auth } from "../firebase";
import { LogOut, AlertCircle } from "lucide-react";
import { getUserSchoolId } from "../utils/authUtils";
import {
  getSchoolData,
  saveClassSelection,
  getCustomClasses,
  getSession,
  getCurrentTerm,
} from "./utils/school-data";
import TeacherPasswordModal from "./TeacherPasswordModal";

/**
 * ClassTeacherAccess - Allows class teachers to select class and verify password
 * Flow: Select Class -> Verify Password -> Access class-dashboard
 */
export default function ClassTeacherAccess() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = auth.currentUser;
  
  const [classes, setClasses] = useState([]);
  const [schoolId, setSchoolId] = useState(null);
  const [selectedClass, setSelectedClass] = useState(null);
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

  const handleClassSelect = (classId) => {
    setSelectedClass(classId);
    setShowPasswordModal(true);
  };

  const handlePasswordVerified = async () => {
    try {
      // Save class selection for this teacher session
      if (user && schoolId && selectedClass) {
        const currentTerm = getCurrentTerm(schoolId) || "term1";
        const currentSession = getSession();
        saveClassSelection({
          schoolId,
          class: selectedClass,
          term: currentTerm,
          session: currentSession,
          classId: selectedClass,
          teacherType: "class",
          accessedAt: new Date().toISOString(),
        }, user.uid);
      }

      // Close modal and navigate to class dashboard
      setShowPasswordModal(false);
      navigate("/class-dashboard", {
        state: {
          schoolId,
          classId: selectedClass,
          teacherType: "class",
        },
      });
    } catch (err) {
      console.error("Error saving class selection:", err);
      setError("Failed to save class selection. Please try again.");
    }
  };

  const handleLogout = () => {
    navigate("/select-role");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading classes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8 md:mb-12">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">
            Class Teacher Access
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            Select your class to manage students and view performance
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Classes Grid */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {classes && classes.length > 0 ? (
            classes.map((classId) => (
              <button
                key={classId}
                onClick={() => handleClassSelect(classId)}
                className="p-6 bg-white dark:bg-gray-800 rounded-xl border-2 border-green-200 dark:border-green-700 hover:border-green-400 dark:hover:border-green-500 hover:shadow-lg transition-all duration-300 text-left hover:-translate-y-1 active:scale-95"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                      {formatClassDisplay(classId)}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Click to access this class
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                    <span className="text-green-600 dark:text-green-400 font-bold">→</span>
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

      {/* Password Verification Modal */}
      {selectedClass && (
        <TeacherPasswordModal
          isOpen={showPasswordModal}
          onClose={() => {
            setShowPasswordModal(false);
            setSelectedClass(null);
          }}
          onVerified={handlePasswordVerified}
          accessType="class"
          schoolId={schoolId}
          classId={selectedClass}
          itemName={formatClassDisplay(selectedClass)}
        />
      )}
    </div>
  );
}
