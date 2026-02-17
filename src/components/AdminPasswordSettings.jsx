import React, { useState, useEffect } from "react";
import { Copy, Check, RefreshCw, AlertCircle, Eye, EyeOff } from "lucide-react";
import { auth } from "../firebase";
import { getUserSchoolId } from "../utils/authUtils";
import { getSchoolData, setClassAccessCode, setSubjectAccessCode } from "./utils/school-data";
import {
  generateAccessCode,
  hashAccessCode,
} from "../utils/teacherCodes";

/**
 * AdminPasswordSettings - Admin panel for managing teacher access passwords
 * Allows admin to:
 * - Generate 6-digit passwords for each class
 * - Generate 6-digit passwords for each subject
 * - View and manage existing passwords
 * - Regenerate passwords as needed
 */
export default function AdminPasswordSettings() {
  const user = auth.currentUser;
  const [schoolId, setSchoolId] = useState(null);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classPasswords, setClassPasswords] = useState({});
  const [subjectPasswords, setSubjectPasswords] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [showPasswords, setShowPasswords] = useState({});

  // Load school data on mount
  useEffect(() => {
    const loadSchoolData = async () => {
      if (!user) return;

      try {
        const sId = await getUserSchoolId(user.uid);
        if (!sId) {
          setError("School information not found");
          return;
        }

        setSchoolId(sId);
        const schoolData = await getSchoolData(sId);

        if (schoolData) {
          if (schoolData.classes) {
            setClasses(Object.keys(schoolData.classes));
          }
          if (schoolData.subjects) {
            setSubjects(Object.keys(schoolData.subjects));
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
  }, [user]);

  const handleGenerateClassPassword = async (classId) => {
    try {
      setError("");
      setSuccess("");

      // Generate a new 6-digit code
      const plainCode = generateAccessCode();
      const codeHash = await hashAccessCode(plainCode);

      // Save to Firebase
      await setClassAccessCode(schoolId, classId, codeHash);

      // Update local state to show the password
      setClassPasswords((prev) => ({
        ...prev,
        [classId]: plainCode,
      }));

      setSuccess(`Password generated for ${classId}: ${plainCode}`);
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      console.error("Error generating class password:", err);
      setError("Failed to generate password. Please try again.");
    }
  };

  const handleGenerateSubjectPassword = async (subjectId) => {
    try {
      setError("");
      setSuccess("");

      // Generate a new 6-digit code
      const plainCode = generateAccessCode();
      const codeHash = await hashAccessCode(plainCode);

      // Save to Firebase
      await setSubjectAccessCode(schoolId, subjectId, codeHash);

      // Update local state to show the password
      setSubjectPasswords((prev) => ({
        ...prev,
        [subjectId]: plainCode,
      }));

      setSuccess(`Password generated for ${subjectId}: ${plainCode}`);
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      console.error("Error generating subject password:", err);
      setError("Failed to generate password. Please try again.");
    }
  };

  const handleCopyPassword = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleShowPassword = (id) => {
    setShowPasswords((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading school data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Teacher Access Passwords
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Generate and manage 6-digit passwords for class and subject teacher access
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-green-700 dark:text-green-300 text-sm">{success}</p>
        </div>
      )}

      {/* Class Passwords Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
          Class Teacher Passwords
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Generate passwords for class teachers to access specific classes
        </p>

        {classes.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">
                    Class
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">
                    Password
                  </th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {classes.map((classId) => (
                  <tr
                    key={classId}
                    className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="py-3 px-4 text-gray-900 dark:text-white font-medium">
                      {classId}
                    </td>
                    <td className="py-3 px-4">
                      {classPasswords[classId] ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-lg font-bold text-blue-600 dark:text-blue-400">
                            {showPasswords[classId]
                              ? classPasswords[classId]
                              : "••••••"}
                          </span>
                          <button
                            onClick={() => toggleShowPassword(classId)}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                          >
                            {showPasswords[classId] ? (
                              <EyeOff className="w-4 h-4 text-gray-500" />
                            ) : (
                              <Eye className="w-4 h-4 text-gray-500" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">
                          Not generated yet
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 flex justify-end">
                      {classPasswords[classId] ? (
                        <>
                          <button
                            onClick={() =>
                              handleCopyPassword(classPasswords[classId], classId)
                            }
                            className="p-2 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded text-blue-600 dark:text-blue-400 transition-colors"
                            title="Copy password"
                          >
                            {copiedId === classId ? (
                              <Check className="w-4 h-4" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleGenerateClassPassword(classId)}
                            className="p-2 hover:bg-orange-100 dark:hover:bg-orange-900/30 rounded text-orange-600 dark:text-orange-400 transition-colors"
                            title="Regenerate password"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleGenerateClassPassword(classId)}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
                        >
                          Generate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            No classes available. Create classes first.
          </p>
        )}
      </div>

      {/* Subject Passwords Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
          Subject Teacher Passwords
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Generate passwords for subject teachers to access and record scores in specific subjects
        </p>

        {subjects.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">
                    Subject
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">
                    Password
                  </th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((subjectId) => (
                  <tr
                    key={subjectId}
                    className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="py-3 px-4 text-gray-900 dark:text-white font-medium">
                      {subjectId}
                    </td>
                    <td className="py-3 px-4">
                      {subjectPasswords[subjectId] ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-lg font-bold text-purple-600 dark:text-purple-400">
                            {showPasswords[subjectId]
                              ? subjectPasswords[subjectId]
                              : "••••••"}
                          </span>
                          <button
                            onClick={() => toggleShowPassword(subjectId)}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                          >
                            {showPasswords[subjectId] ? (
                              <EyeOff className="w-4 h-4 text-gray-500" />
                            ) : (
                              <Eye className="w-4 h-4 text-gray-500" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">
                          Not generated yet
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 flex justify-end">
                      {subjectPasswords[subjectId] ? (
                        <>
                          <button
                            onClick={() =>
                              handleCopyPassword(
                                subjectPasswords[subjectId],
                                subjectId
                              )
                            }
                            className="p-2 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded text-purple-600 dark:text-purple-400 transition-colors"
                            title="Copy password"
                          >
                            {copiedId === subjectId ? (
                              <Check className="w-4 h-4" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleGenerateSubjectPassword(subjectId)}
                            className="p-2 hover:bg-orange-100 dark:hover:bg-orange-900/30 rounded text-orange-600 dark:text-orange-400 transition-colors"
                            title="Regenerate password"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleGenerateSubjectPassword(subjectId)}
                          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors text-sm font-medium"
                        >
                          Generate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            No subjects available. Create subjects first.
          </p>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
          Password Requirements:
        </h4>
        <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
          <li>✓ Passwords must be exactly 6 digits</li>
          <li>✓ Passwords are SHA-256 hashed before storage</li>
          <li>✓ Never store or share plain passwords in Firebase</li>
          <li>✓ Share passwords only with authorized teachers</li>
          <li>✓ Regenerate passwords regularly for security</li>
        </ul>
      </div>
    </div>
  );
}
