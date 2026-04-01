import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Check, RefreshCw, AlertCircle } from "lucide-react";
import {
  getSession,
  getCurrentTerm,
  saveSession,
  saveTerm,
  getCustomClasses,
  addClass,
  removeClass,
  getCustomSubjects,
  addSubject,
  removeSubject,
  getGradingScale,
  getAdminSettings,
  saveGradingScale,
  saveAdminSettings,
  generateClassId,
} from "./utils/school-data";
import {
  generateSixDigitCode,
  hashPassword,
  maskPassword,
} from "../utils/passwordUtils";
import {
  getAllClassTeacherCodes,
  getAllSubjectTeacherCodes,
  getSubjectTeacherCode,
  setClassTeacherCodeHash,
  setSubjectTeacherCodeHash,
} from "../utils/firebaseDatabase";
import { getCurrentUser, getUserSchoolId } from "../utils/authUtils";

const getLevelFromClassId = (classId) => {
  const normalized = String(classId || "").toLowerCase();
  if (/^jss/.test(normalized)) return "junior";
  if (/^sss|^ss/.test(normalized)) return "senior";
  return null;
};

const getSubjectScopeKey = (classId) => {
  const level = getLevelFromClassId(classId);
  if (level === "junior") return "jss";
  if (level === "senior") return "sss";
  return classId;
};

const formatClassDisplay = (classId) => {
  const raw = String(classId || "").trim();
  if (!raw) return raw;
  const matched = raw.match(/^([a-zA-Z]+)\s*(\d+)$/);
  if (matched) {
    return `${matched[1].toUpperCase()} ${matched[2]}`;
  }
  return raw.toUpperCase();
};

export default function AdminConfig() {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const [activeTab, setActiveTab] = useState("session");
  const [session, setSession] = useState(getSession());
  const [currentTerm, setCurrentTerm] = useState("term1");
  const [classes, setClasses] = useState([]);
  const [newClassName, setNewClassName] = useState("");
  const [subjects, setSubjects] = useState({ junior: [], senior: [] });
  const [selectedLevel, setSelectedLevel] = useState("junior");
  const [newSubject, setNewSubject] = useState("");
  const [gradingScale, setGradingScale] = useState(getGradingScale());
  const [nextTermBegins, setNextTermBegins] = useState("2026-04-20");
  
  // Password management state
  const [classPasswords, setClassPasswords] = useState({});
  const [subjectPasswords, setSubjectPasswords] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [schoolId, setSchoolId] = useState(null);
  const [loadingPasswords, setLoadingPasswords] = useState(false);
  const [error, setError] = useState(null);
  const [classCodeExists, setClassCodeExists] = useState({});
  const [subjectCodeExists, setSubjectCodeExists] = useState({});
  const [classCodeUpdatedAt, setClassCodeUpdatedAt] = useState({});
  const [subjectCodeUpdatedAt, setSubjectCodeUpdatedAt] = useState({});

  const getClassesForLevel = (targetLevel) =>
    (classes || [])
      .map((item) => item.id || item)
      .filter((id) => getLevelFromClassId(id) === targetLevel);

  // Get school ID from user data
  useEffect(() => {
    const getSchoolInfo = async () => {
      if (user) {
        const sId = await getUserSchoolId(user.uid);
        setSchoolId(sId);
      }
    };
    getSchoolInfo();
  }, [user]);

  // Load school-scoped settings/data
  useEffect(() => {
    const loadLocalConfig = async () => {
      if (!schoolId) return;
      setClasses(getCustomClasses(schoolId));
      setSubjects(getCustomSubjects(schoolId));
      setCurrentTerm(getCurrentTerm(schoolId) || "term1");
      setGradingScale(getGradingScale(schoolId));
      try {
        const settings = await getAdminSettings(schoolId);
        if (settings?.nextTermBegins) {
          setNextTermBegins(settings.nextTermBegins);
        }
      } catch {
        // Keep defaults if settings load fails
      }
    };
    loadLocalConfig();
  }, [schoolId]);

  // Load password metadata from RTDB (hashes only)
  useEffect(() => {
    const loadPasswords = async () => {
      if (!schoolId) return;
      
      setLoadingPasswords(true);
      setError(null);
      try {
        const classCodes = await getAllClassTeacherCodes(schoolId);
        const classExists = {};
        const classUpdatedAt = {};
        Object.entries(classCodes || {}).forEach(([classId, value]) => {
          if (value?.hash) {
            classExists[classId] = true;
            classUpdatedAt[classId] = value.updatedAt || null;
          }
        });
        setClassCodeExists(classExists);
        setClassCodeUpdatedAt(classUpdatedAt);

        const subjectCodes = await getAllSubjectTeacherCodes(schoolId);
        const subjectExists = {};
        const subjectUpdatedAt = {};
        Object.entries(subjectCodes || {}).forEach(([scopeKey, subjectsByClass]) => {
          Object.entries(subjectsByClass || {}).forEach(([subjectId, value]) => {
            if (value?.hash) {
              if (scopeKey === "jss" || scopeKey === "sss") {
                const matchingClasses = (classes || [])
                  .map((item) => item.id || item)
                  .filter((id) => getSubjectScopeKey(id) === scopeKey);
                matchingClasses.forEach((classId) => {
                  const key = `${classId}_${subjectId}`;
                  subjectExists[key] = true;
                  subjectUpdatedAt[key] = value.updatedAt || null;
                });
              } else {
                const key = `${scopeKey}_${subjectId}`;
                subjectExists[key] = true;
                subjectUpdatedAt[key] = value.updatedAt || null;
              }
            }
          });
        });
        setSubjectCodeExists(subjectExists);
        setSubjectCodeUpdatedAt(subjectUpdatedAt);
      } catch (err) {
        console.error("Error loading passwords:", err);
        setError("Failed to load passwords. Please try again.");
      } finally {
        setLoadingPasswords(false);
      }
    };

    loadPasswords();
  }, [schoolId, classes]);

  const handleSessionChange = (newSession) => {
    setSession(newSession);
    saveSession(newSession);
  };

  const handleTermChange = (newTerm) => {
    setCurrentTerm(newTerm);
    if (schoolId) saveTerm(schoolId, newTerm);
  };

  const getTermDisplayName = (termId) => {
    const termMap = {
      "term1": "First Term",
      "term2": "Second Term",
      "term3": "Third Term",
    };
    return termMap[termId] || termId;
  };

  const formatUpdatedAt = (isoString) => {
    if (!isoString) return "Unknown";
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return "Unknown";
    }
  };

  const handleAddClass = async () => {
    if (!newClassName.trim()) {
      alert("Please enter class name");
      return;
    }
    
    if (!schoolId) {
      alert("Error: School ID not found. Please refresh the page.");
      return;
    }

    try {
      const classId = generateClassId(newClassName);
      const nowIso = new Date().toISOString();
      
      // Add class and refresh list
      addClass(schoolId, classId, newClassName);
      const updated = getCustomClasses(schoolId);
      setClasses(updated);

      // Auto-generate class teacher password (6-digit) and store hash
      const classPassword = generateSixDigitCode();
      const classHash = await hashPassword(classPassword);
      await setClassTeacherCodeHash(schoolId, classId, classHash);

      // Ensure level-shared subject passwords exist (one per subject for JSS, one per subject for SSS)
      const level = getLevelFromClassId(classId);
      const relevantSubjects =
        level === "junior"
          ? subjects?.junior || []
          : level === "senior"
            ? subjects?.senior || []
            : [];
      const generatedSubjectPasswords = {};

      for (const subjectName of relevantSubjects) {
        const existingCode = await getSubjectTeacherCode(
          schoolId,
          classId,
          subjectName
        );
        if (existingCode?.hash) {
          continue;
        }

        const subjectPassword = generateSixDigitCode();
        const subjectHash = await hashPassword(subjectPassword);
        const scopeKey = getSubjectScopeKey(classId);
        await setSubjectTeacherCodeHash(schoolId, scopeKey, subjectName, subjectHash);

        const levelClassIds = (updated || [])
          .map((item) => item.id || item)
          .filter((id) => getLevelFromClassId(id) === level);
        levelClassIds.forEach((levelClassId) => {
          generatedSubjectPasswords[`${levelClassId}_${subjectName}`] = subjectPassword;
        });
      }

      // Update local state
      setClassPasswords((prev) => ({
        ...prev,
        [classId]: classPassword,
      }));
      setClassCodeExists((prev) => ({ ...prev, [classId]: true }));
      setClassCodeUpdatedAt((prev) => ({ ...prev, [classId]: nowIso }));
      setSubjectPasswords((prev) => ({ ...prev, ...generatedSubjectPasswords }));
      setSubjectCodeExists((prev) => {
        const next = { ...prev };
        Object.keys(generatedSubjectPasswords).forEach((key) => {
          next[key] = true;
        });
        return next;
      });
      setSubjectCodeUpdatedAt((prev) => {
        const next = { ...prev };
        Object.keys(generatedSubjectPasswords).forEach((key) => {
          next[key] = nowIso;
        });
        return next;
      });

      alert(
        `Class "${newClassName}" created.\nClass Teacher Password: ${classPassword}`
      );
      setNewClassName("");
    } catch (err) {
      console.error("Error adding class:", err);
      alert("Error creating class. Please try again.");
    }
  };

  const handleRemoveClass = (classId) => {
    if (window.confirm(`Remove class ${formatClassDisplay(classId)}?`)) {
      removeClass(schoolId, classId);
      const updated = getCustomClasses(schoolId);
      setClasses(updated);
    }
  };

  const handleAddSubject = async () => {
    if (!newSubject.trim()) {
      alert("Please enter subject name");
      return;
    }

    if (!schoolId) {
      alert("Error: School ID not found. Please refresh the page.");
      return;
    }

    try {
      addSubject(schoolId, selectedLevel, newSubject);
      const updated = getCustomSubjects(schoolId);
      setSubjects(updated);
      const nowIso = new Date().toISOString();

      // Generate one level-shared subject password (JSS1-3 share, SSS1-3 share)
      const classIds = getClassesForLevel(selectedLevel);
      const generatedSubjectPasswords = {};
      const password = generateSixDigitCode();
      const codeHash = await hashPassword(password);
      const scopeKey = selectedLevel === "junior" ? "jss" : "sss";
      await setSubjectTeacherCodeHash(schoolId, scopeKey, newSubject, codeHash);
      classIds.forEach((classId) => {
        generatedSubjectPasswords[`${classId}_${newSubject}`] = password;
      });
      setSubjectPasswords((prev) => ({ ...prev, ...generatedSubjectPasswords }));
      setSubjectCodeExists((prev) => {
        const next = { ...prev };
        Object.keys(generatedSubjectPasswords).forEach((subjectId) => {
          next[subjectId] = true;
        });
        return next;
      });
      setSubjectCodeUpdatedAt((prev) => {
        const next = { ...prev };
        Object.keys(generatedSubjectPasswords).forEach((subjectId) => {
          next[subjectId] = nowIso;
        });
        return next;
      });

      alert(`Subject "${newSubject}" created for all classes!`);
      setNewSubject("");
    } catch (err) {
      console.error("Error adding subject:", err);
      alert("Error creating subject. Please try again.");
    }
  };

  const handleRemoveSubject = (level, subject) => {
    if (window.confirm(`Remove subject ${subject}?`)) {
      removeSubject(schoolId, level, subject);
      const updated = getCustomSubjects(schoolId);
      setSubjects(updated);
    }
  };

  const handleGradeChange = (grade, field, value) => {
    const numValue = parseInt(value) || 0;
    setGradingScale({
      ...gradingScale,
      [grade]: {
        ...gradingScale[grade],
        [field]: numValue,
      },
    });
  };

  const handleSaveGrading = () => {
    for (const [grade, range] of Object.entries(gradingScale)) {
      if (range.min > range.max) {
        alert(`Invalid range for grade ${grade}`);
        return;
      }
    }
    saveGradingScale(schoolId, gradingScale);
    alert("Grading scale updated successfully!");
  };

  const handleSaveNextTerm = async () => {
    const settings = await getAdminSettings(schoolId);
    settings.nextTermBegins = nextTermBegins;
    await saveAdminSettings(settings, schoolId);
    alert("Next term date updated!");
  };

  const handleGenerateClassPassword = async (classId) => {
    if (!schoolId) {
      alert("Error: School ID not found.");
      return;
    }

    try {
      const newPassword = generateSixDigitCode();
      const codeHash = await hashPassword(newPassword);
      const nowIso = new Date().toISOString();
      await setClassTeacherCodeHash(schoolId, classId, codeHash);

      setClassPasswords((prev) => ({
        ...prev,
        [classId]: newPassword,
      }));
      setClassCodeExists((prev) => ({ ...prev, [classId]: true }));
      setClassCodeUpdatedAt((prev) => ({ ...prev, [classId]: nowIso }));
      alert(`New password for ${formatClassDisplay(classId)}: ${newPassword}`);
    } catch (err) {
      console.error("Error generating class password:", err);
      alert("Error generating password. Please try again.");
    }
  };

  const handleGenerateSubjectPassword = async (classId, subject) => {
    if (!schoolId) {
      alert("Error: School ID not found.");
      return;
    }

    try {
      const newPassword = generateSixDigitCode();
      const codeHash = await hashPassword(newPassword);
      const nowIso = new Date().toISOString();
      const level = getLevelFromClassId(classId);
      const scopeKey = getSubjectScopeKey(classId);
      await setSubjectTeacherCodeHash(schoolId, scopeKey, subject, codeHash);

      const affectedClassIds =
        level === "junior" || level === "senior"
          ? getClassesForLevel(level)
          : [classId];
      const updates = {};
      affectedClassIds.forEach((affectedClassId) => {
        updates[`${affectedClassId}_${subject}`] = newPassword;
      });

      setSubjectPasswords((prev) => ({ ...prev, ...updates }));
      setSubjectCodeExists((prev) => {
        const next = { ...prev };
        Object.keys(updates).forEach((subjectId) => {
          next[subjectId] = true;
        });
        return next;
      });
      setSubjectCodeUpdatedAt((prev) => {
        const next = { ...prev };
        Object.keys(updates).forEach((subjectId) => {
          next[subjectId] = nowIso;
        });
        return next;
      });
      alert(`New level-shared password for ${subject} (${scopeKey.toUpperCase()}): ${newPassword}`);
    } catch (err) {
      console.error("Error generating subject password:", err);
      alert("Error generating password. Please try again.");
    }
  };

  const handleCopyPassword = (password) => {
    navigator.clipboard.writeText(password);
    setCopiedId(password);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleResetPassword = (classId) => {
    if (window.confirm(`Reset password for class ${formatClassDisplay(classId)}?`)) {
      handleGenerateClassPassword(classId);
    }
  };

  const handleResetSubjectPassword = (classId, subject) => {
    const scopeKey = getSubjectScopeKey(classId).toUpperCase();
    if (window.confirm(`Reset ${subject} password for all ${scopeKey} classes?`)) {
      handleGenerateSubjectPassword(classId, subject);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 p-4 md:p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="sm:text-3xl text-xl font-bold text-black dark:text-white">
          Admin Configuration
        </h1>
        <button
          onClick={() => navigate("/school-dashboard")}
          className="px-6 py-2   rounded-lg border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300" >
          Back
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto mb-8 bg-gray-50 dark:bg-gray-800 rounded-t-lg">
        <button
          onClick={() => setActiveTab("session")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "session"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Session
        </button>
        <button
          onClick={() => setActiveTab("classes")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "classes"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Classes
        </button>
        <button
          onClick={() => setActiveTab("subjects")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "subjects"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Subjects
        </button>
        <button
          onClick={() => setActiveTab("grades")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "grades"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Grading
        </button>
        <button
          onClick={() => setActiveTab("dates")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "dates"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Dates
        </button>
        <button
          onClick={() => setActiveTab("passwords")}
          className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-all ${
            activeTab === "passwords"
              ? "border-blue-800 text-blue-800 dark:text-blue-400 bg-white dark:bg-gray-700"
              : "border-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Teacher Passwords
        </button>
      </div>

      {/* Content */}
      <div className="bg-white dark:bg-gray-800 p-8 rounded-b-lg shadow-lg">
        {/* Session Tab */}
        {activeTab === "session" && (
          <div>
            <h3 className="text-2xl font-semibold text-black dark:text-white mb-6">
              Current Session & Term
            </h3>
            <div className="space-y-6">
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Select the current academic session and term. These will be used automatically
                when teachers select class or record results, so they don't have to manually set it every time.
              </p>
              
              {/* Session Selection */}
              <div>
                <label className="block text-sm font-semibold text-black dark:text-white mb-2">
                  Academic Session
                </label>
                <div className="flex gap-3 max-w-md">
                  <input
                    type="text"
                    value={session}
                    onChange={(e) => setSession(e.target.value)}
                    className="input  w-2/3"
                    placeholder="e.g., 2025/2026"
                  />
                  <button
                    onClick={() => handleSessionChange(session)}
                    className="px-6 py-2 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300"
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Term Selection */}
              <div>
                <label className="block text-sm font-semibold text-black dark:text-white mb-3">
                  Current Term
                </label>
                <div className="flex gap-3 flex-wrap">
                  {["term1", "term2", "term3"].map((term) => (
                    <button
                      key={term}
                      onClick={() => handleTermChange(term)}
                      className={`px-6 py-3 rounded-lg font-semibold transition-all duration-300 ${
                        currentTerm === term
                          ? "bg-blue-800 text-white dark:bg-blue-600"
                          : "bg-gray-200 text-black dark:bg-gray-700 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600"
                      }`}
                    >
                      {getTermDisplayName(term)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  ✓ Selected term will be preloaded everywhere
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Classes Tab */}
        {activeTab === "classes" && (
          <div>
            <h3 className="text-2xl font-semibold text-black dark:text-white mb-6">
              Manage Classes
            </h3>
            <div className="space-y-6">
              <div className="bg-blue-50 dark:bg-blue-900 p-6 rounded-lg">
                <h4 className="font-semibold text-black dark:text-white mb-4 text-lg">
                  Add New Class
                </h4>
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    placeholder="Class Name (e.g., JSS 1, SSS 2)"
                    className="input w-full"
                  />
                </div>
                <button
                  onClick={handleAddClass}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold rounded-lg transition-all duration-300"
                >
                  Add Class
                </button>
              </div>

              <div>
                <h4 className="font-semibold text-black dark:text-white mb-4 text-lg">
                  Current Classes
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {classes.map((cls) => (
                    <div
                      key={cls.id}
                      className="flex justify-between items-center p-4 bg-gray-100 dark:bg-gray-700 rounded-lg"
                    >
                      <span className="font-medium text-black dark:text-white">
                        {cls.label}
                      </span>
                      <button
                        onClick={() => handleRemoveClass(cls.id)}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white text-sm font-semibold rounded transition-all duration-300"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Subjects Tab */}
        {activeTab === "subjects" && (
          <div>
            <h3 className="text-2xl font-semibold text-black dark:text-white mb-6">
              Manage Subjects
            </h3>
            <div className="space-y-6">
              <div className="bg-purple-50 dark:bg-purple-900 p-6 rounded-lg">
                <h4 className="font-semibold text-black dark:text-white mb-4 text-lg">
                  Add New Subject
                </h4>
                <div className="flex gap-2 mb-4 max-sm:flex-col">
                  <select
                    value={selectedLevel}
                    onChange={(e) => setSelectedLevel(e.target.value)}
                    className="input"
                  >
                    <option value="junior">Junior (JSS)</option>
                    <option value="senior">Senior (SSS)</option>
                  </select>
                  <input
                    type="text"
                    value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value)}
                    placeholder="Subject name"
                    className="input flex-1"
                  />
                </div>
                <button
                  onClick={handleAddSubject}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold rounded-lg transition-all duration-300"
                >
                  Add Subject
                </button>
              </div>

              <div>
                <h4 className="font-semibold text-black dark:text-white mb-4 text-lg">
                  Junior Subjects (JSS 1-3)
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                  {subjects.junior.map((subject) => (
                    <div
                      key={subject}
                      className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg"
                    >
                      <span className="text-sm font-medium text-black dark:text-white truncate">
                        {subject}
                      </span>
                      <button
                        onClick={() => handleRemoveSubject("junior", subject)}
                        className="px-2 py-1 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white text-xs font-semibold rounded transition-all duration-300 ml-2 flex-shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-black dark:text-white mb-4 text-lg">
                  Senior Subjects (SSS 1-3)
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {subjects.senior.map((subject) => (
                    <div
                      key={subject}
                      className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg"
                    >
                      <span className="text-sm font-medium text-black dark:text-white truncate">
                        {subject}
                      </span>
                      <button
                        onClick={() => handleRemoveSubject("senior", subject)}
                        className="px-2 py-1 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white text-xs font-semibold rounded transition-all duration-300 ml-2 flex-shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Grades Tab */}
        {activeTab === "grades" && (
          <div>
            <h3 className="text-2xl font-semibold text-black dark:text-white mb-6">
              Grading Scale Configuration
            </h3>
            <div className="space-y-4 mb-8">
              {Object.entries(gradingScale).map(([grade, range]) => (
                <div
                  key={grade}
                  className="flex items-center gap-4 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg"
                >
                  <span className="font-bold text-2xl text-blue-800 dark:text-blue-400 w-12">
                    {grade}
                  </span>
                  <div className="flex-1 flex gap-3 items-center">
                    <input
                      type="number"
                      value={range.min}
                      onChange={(e) => handleGradeChange(grade, "min", e.target.value)}
                      className="input w-16 sm:w-32"
                      placeholder="Min"
                    />
                    <span className="text-gray-600 dark:text-gray-400 font-semibold">to</span>
                    <input
                      type="number"
                      value={range.max}
                      onChange={(e) => handleGradeChange(grade, "max", e.target.value)}
                      className="input w-16 sm:w-32"
                      placeholder="Max"
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={handleSaveGrading}
              className="w-full px-6 py-3 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300"
            >
              Save Grading Scale
            </button>
          </div>
        )}

        {/* Dates Tab */}
        {activeTab === "dates" && (
          <div>
            <h3 className="text-2xl font-semibold text-black dark:text-white mb-6">
              Important Dates
            </h3>
            <div className="space-y-4 max-w-md">
              <div>
                <label className="label-w block mb-3 text-lg">Next Term Begins</label>
                <div className="flex gap-3">
                  <input
                    type="date"
                    value={nextTermBegins}
                    onChange={(e) => setNextTermBegins(e.target.value)}
                    className="input w-2/3"
                  />
                  <button
                    onClick={handleSaveNextTerm}
                    className="px-6 py-2 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300"
                  >
                    Save
                  </button>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">
                  This date appears on student result sheets
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Passwords Tab */}
        {activeTab === "passwords" && (
          <div>
            <h3 className="text-2xl font-semibold text-black dark:text-white mb-6">
              Teacher Access Passwords
            </h3>

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-700 dark:text-red-300 text-sm font-medium">{error}</p>
              </div>
            )}

            {/* Loading State */}
            {loadingPasswords ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-4"></div>
                <p className="text-gray-600 dark:text-gray-400">Loading passwords...</p>
              </div>
            ) : (
              <>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Passwords are automatically generated when you create classes or subjects. Share them securely with teachers.
                </p>

                {/* Class Passwords Section */}
                <div className="mb-8">
                  <h4 className="text-xl font-semibold text-black dark:text-white mb-4">
                    Class Teacher Passwords
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Class teachers use these passwords to unlock access to their specific classes.
                  </p>
                  
                  {classes && classes.length > 0 ? (
                    <div className="space-y-3">
                      {classes.map((classItem) => {
                        const classId = classItem.id || classItem;
                        const password = classPasswords[classId];
                        const updatedAt = classCodeUpdatedAt[classId];
                        
                        return (
                          <div
                            key={classId}
                            className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-700 rounded-lg"
                          >
                            <div>
                              <p className="font-semibold text-black dark:text-black">
                                {formatClassDisplay(classId)}
                              </p>
                              {password ? (
                                <div className="flex items-center gap-2">
                                  <p className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                                    {maskPassword(password)}
                                  </p>
                                  <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900 dark:text-green-300">
                                    Copy now
                                  </span>
                                </div>
                              ) : classCodeExists[classId] ? (
                                <p className="text-sm text-gray-500 dark:text-gray-500 italic">
                                  Password is set (hash stored only)
                                </p>
                              ) : (
                                <p className="text-sm text-gray-500 dark:text-gray-500 italic">
                                  No password generated yet
                                </p>
                              )}
                              {(classCodeExists[classId] || password) && (
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                  Updated: {formatUpdatedAt(updatedAt)}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2">
                              {password && (
                                <button
                                  onClick={() => handleCopyPassword(password)}
                                  className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                                  title="Copy password"
                                >
                                  {copiedId === password ? (
                                    <Check className="w-5 h-5 text-green-600" />
                                  ) : (
                                    <Copy className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                                  )}
                                </button>
                              )}
                              <button
                                onClick={() => handleResetPassword(classId)}
                                className="p-2 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                                title="Reset password"
                              >
                                <RefreshCw className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-gray-600 dark:text-gray-400">No classes available</p>
                  )}
                </div>

                {/* Subject Passwords Section */}
                <div>
                  <h4 className="text-xl font-semibold text-black dark:text-white mb-4">
                    Subject Teacher Passwords
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Subject teachers use one shared password per subject by level (all JSS classes share one, all SSS classes share one).
                  </p>

                  {classes && classes.length > 0 ? (
                    <div className="space-y-6">
                      {[
                        {
                          scopeKey: "jss",
                          title: "JSS Subjects (shared for JSS1-3)",
                          classIds: getClassesForLevel("junior"),
                          subjectsList: subjects?.junior || [],
                        },
                        {
                          scopeKey: "sss",
                          title: "SSS Subjects (shared for SSS1-3)",
                          classIds: getClassesForLevel("senior"),
                          subjectsList: subjects?.senior || [],
                        },
                      ].map((group) => {
                        if (!group.subjectsList.length) return null;
                        const scopeClassId = group.classIds[0] || group.scopeKey;

                        return (
                          <div key={`subjects-${group.scopeKey}`}>
                            <h5 className="font-semibold text-black dark:text-white mb-3">
                              {group.title}
                            </h5>
                            <div className="space-y-2 ">
                              {group.subjectsList.map((subject) => {
                                const existingKey =
                                  group.classIds
                                    .map((id) => `${id}_${subject}`)
                                    .find(
                                      (id) => subjectCodeExists[id] || subjectPasswords[id]
                                    ) || `${scopeClassId}_${subject}`;
                                const password = subjectPasswords[existingKey];
                                const updatedAt = subjectCodeUpdatedAt[existingKey];

                                return (
                                  <div
                                    key={`${group.scopeKey}_${subject}`}
                                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-700 rounded-lg"
                                  >
                                    <div>
                                      <p className="font-semibold text-black dark:text-black text-sm">
                                        {subject}
                                      </p>
                                      {password ? (
                                        <div className="flex items-center gap-2">
                                          <p className="text-xs text-gray-600 dark:text-gray-400 font-mono">
                                            {maskPassword(password)}
                                          </p>
                                          <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900 dark:text-green-300">
                                            Copy now
                                          </span>
                                        </div>
                                      ) : subjectCodeExists[existingKey] ? (
                                        <p className="text-xs text-gray-500 dark:text-gray-500 italic">
                                          Password is set (hash stored only)
                                        </p>
                                      ) : (
                                        <p className="text-xs text-gray-500 dark:text-gray-500 italic">
                                          No password generated yet
                                        </p>
                                      )}
                                      {(subjectCodeExists[existingKey] || password) && (
                                        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                                          Updated: {formatUpdatedAt(updatedAt)}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex gap-2">
                                      {password && (
                                        <button
                                          onClick={() => handleCopyPassword(password)}
                                          className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                                          title="Copy password"
                                        >
                                          {copiedId === password ? (
                                            <Check className="w-4 h-4 text-green-600" />
                                          ) : (
                                            <Copy className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                                          )}
                                        </button>
                                      )}
                                      <button
                                        onClick={() =>
                                          handleResetSubjectPassword(scopeClassId, subject)
                                        }
                                        className="p-2 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                                        title="Reset password"
                                      >
                                        <RefreshCw className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-gray-600 dark:text-gray-400">No classes available</p>
                  )}
                </div>

                {/* Help Text */}
                <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm text-blue-900 dark:text-blue-200">
                    <strong>How it works:</strong> Passwords are automatically generated as 6-digit codes. Subject passwords are shared by level (JSS1-3 together, SSS1-3 together). Only SHA-256 hashes are stored in Realtime Database. Click copy when a fresh code is generated, and use refresh to regenerate (old code becomes invalid).
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
