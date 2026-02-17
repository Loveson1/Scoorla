import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import { BookOpen, Users, Lock } from "lucide-react";
import AdminPasscodeModal from "./AdminPasscodeModal";
import { getUserSchoolId } from "../utils/authUtils";
import { getSchoolData, getCustomClasses } from "./utils/school-data";

export default function RoleSelector() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showPasscodeModal, setShowPasscodeModal] = useState(false);
  const user = auth.currentUser;
  const [schoolData, setSchoolData] = useState(null);

  const roles = [
    {
      id: "class_teacher",
      label: "Class Teacher",
      description: "Manage classes and monitor overall performance",
      icon: Users,
      color: "from-blue-500 to-blue-600",
      bgColor: "bg-blue-50 dark:bg-blue-900/20",
      borderColor: "border-blue-200 dark:border-blue-800",
    },
    {
      id: "subject_teacher",
      label: "Subject Teacher",
      description: "Manage subjects and record student scores",
      icon: BookOpen,
      color: "from-green-500 to-green-600",
      bgColor: "bg-green-50 dark:bg-green-900/20",
      borderColor: "border-green-200 dark:border-green-800",
    },

    {
      id: "admin",
      label: "Admin Only",
      description: "Full school administration and system settings",
      icon: Lock,
      color: "from-purple-500 to-purple-600",
      bgColor: "bg-purple-50 dark:bg-purple-900/20",
      borderColor: "border-purple-200 dark:border-purple-800",
    },
  ];

  const handleRoleSelect = async (roleId) => {
    try {
      // Store selected role in localStorage
      if (user) {
        const key = `selectedRole_${user.uid}`;
        localStorage.setItem(key, roleId);
        console.log(
          `💾 Stored role in localStorage - Key: "${key}", Value: "${roleId}"`,
        );

        // For teacher roles, load school data first
        if (roleId === "class_teacher" || roleId === "subject_teacher") {
          setLoading(true);
          const schoolId = await getUserSchoolId(user.uid);
          if (schoolId) {
            const school = await getSchoolData(schoolId);
            setSchoolData(school);
            if (school) {
              const hasClasses =
                school.classes && Object.keys(school.classes).length > 0;
              let classesPayload = school.classes || {};

              if (!hasClasses) {
                const customClasses = getCustomClasses(schoolId) || [];
                classesPayload = customClasses.reduce((acc, cls) => {
                  const classId = typeof cls === "string" ? cls : cls?.id;
                  const classLabel =
                    typeof cls === "string"
                      ? cls.toUpperCase()
                      : cls?.label || classId;
                  if (classId) {
                    acc[classId] = { classId, label: classLabel };
                  }
                  return acc;
                }, {});
              }

              // Navigate to appropriate teacher access component
              if (roleId === "class_teacher") {
                navigate("/class-teacher-access", {
                  state: { schoolId, classes: classesPayload },
                });
              } else {
                navigate("/subject-teacher-access", {
                  state: { schoolId, classes: classesPayload },
                });
              }
            }
          }
        }
      } else {
        console.error("❌ No user object available for role selection!");
      }

      // Navigate based on role
      if (roleId === "admin") {
        // Show passcode modal for admin verification
        setShowPasscodeModal(true);
      }
    } catch (error) {
      console.error("Error selecting role:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAdminVerified = () => {
    // Close modal and navigate to admin dashboard
    console.log("✅ Admin passcode was verified!");
    console.log(
      "📋 Selected role in localStorage:",
      localStorage.getItem(`selectedRole_${user.uid}`),
    );
    setShowPasscodeModal(false);
    console.log("🚀 Navigating to /school-dashboard...");
    navigate("/school-dashboard", { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center py-16 px-4">
      <div className="w-full max-w-5xl">
        {/* Header */}
        <div className="text-center mb-12 md:mb-16">
          <h1 className="text-3xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            Select Your Role
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-2">
            How would you like to use Scoorla?
          </p>
        </div>

        {/* Role Cards Grid */}
        <div className="grid md:grid-cols-3 gap-6 md:gap-8">
          {roles.map((role) => {
            const Icon = role.icon;
            return (
              <button
                key={role.id}
                onClick={() => handleRoleSelect(role.id)}
                disabled={loading}
                className={`group p-8 rounded-xl border-2 transition-all duration-300 transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${role.borderColor} ${role.bgColor}`}
              >
                {/* Icon */}
                <div
                  className={`inline-flex p-4 rounded-lg bg-gradient-to-br ${role.color} text-white mb-6 group-hover:shadow-lg transition-shadow`}
                >
                  <Icon className="w-8 h-8" />
                </div>

                {/* Label */}
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3 text-left">
                  {role.label}
                </h2>

                {/* Description */}
                <p className="text-sm text-gray-600 dark:text-gray-400 text-left mb-6">
                  {role.description}
                </p>

                {/* CTA Text */}
                <div className="flex items-center justify-between text-sm font-semibold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                  <span>Continue</span>
                  <span className="group-hover:translate-x-1 transition-transform">
                    →
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="my-12 flex items-center gap-4">
          <div className="flex-1 h-px bg-gray-300 dark:bg-gray-700"></div>
          <span className="text-gray-500 dark:text-gray-400 text-sm">or</span>
          <div className="flex-1 h-px bg-gray-300 dark:bg-gray-700"></div>
        </div>

        {/* Footer Help */}
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-3">
            Not sure which role fits you best?
          </p>
          <a
            href="mailto:support@scoorla.com"
            className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
          >
            Contact support@scoorla.com
          </a>
        </div>
      </div>

      {/* Admin Passcode Modal */}
      {showPasscodeModal && (
        <AdminPasscodeModal
          onClose={() => setShowPasscodeModal(false)}
          onVerified={handleAdminVerified}
        />
      )}
    </div>
  );
}
