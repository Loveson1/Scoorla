import { useState, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getCurrentUser } from "../utils/authUtils";
import { isOnboardingComplete } from "../utils/onboardingUtils";
import { checkEmailVerification } from "../utils/authUtils";
import { auth, firestore } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

/**
 * ProtectedRoute component that enforces auth, email verification, onboarding, and role selection
 */
export default function ProtectedRoute({
  children,
  allowUnonboarded = false,
  requireVerified = true,
}) {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [roleSelected, setRoleSelected] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      try {
        if (!authUser) {
          setIsAuthenticated(false);
          setLoading(false);
          return;
        }

        setIsAuthenticated(true);

        const isVerified = await checkEmailVerification();
        setEmailVerified(isVerified);

        const roleKey = `selectedRole_${authUser.uid}`;
        const selectedRole = localStorage.getItem(roleKey);
        setRoleSelected(!!selectedRole);

        let isComplete = false;
        try {
          const userRef = doc(firestore, "users", authUser.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists() && userSnap.data().schoolId) {
            isComplete = true;
          } else {
            isComplete = await isOnboardingComplete();
          }
        } catch (error) {
          console.error("Error checking onboarding:", error);
          isComplete = await isOnboardingComplete();
        }

        setOnboardingComplete(isComplete);
        setLoading(false);
      } catch (error) {
        console.error("Error checking auth status:", error);
        setLoading(false);
      }
    });

    const handleStorageChange = (e) => {
      const user = getCurrentUser();
      if (user && e.key === `selectedRole_${user.uid}`) {
        setRoleSelected(!!e.newValue);
      }
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      unsubscribe();
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-r from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-700 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requireVerified && !emailVerified) {
    return <Navigate to="/verify-email" replace />;
  }

  if (allowUnonboarded) {
    return children;
  }

  if (requireVerified && emailVerified && !onboardingComplete) {
    return <Navigate to="/welcome" replace />;
  }

  const user = getCurrentUser();
  const roleInStorage = user ? localStorage.getItem(`selectedRole_${user.uid}`) : null;
  const hasRole = roleSelected || !!roleInStorage;

  if (requireVerified && emailVerified && onboardingComplete && !hasRole) {
    return <Navigate to="/select-role" replace />;
  }

  const path = location.pathname;
  if (roleInStorage === "class_teacher") {
    const classTeacherAllowedPaths = ["/class-dashboard", "/student-result-sheet"];
    const isAllowed = classTeacherAllowedPaths.some((prefix) => path.startsWith(prefix));
    if (!isAllowed) {
      return <Navigate to="/class-dashboard" replace />;
    }
  }

  if (roleInStorage === "subject_teacher") {
    const subjectTeacherAllowedPaths = ["/record-dashboard", "/result-preview", "/student-result-sheet"];
    const isAllowed = subjectTeacherAllowedPaths.some((prefix) => path.startsWith(prefix));
    if (!isAllowed) {
      return <Navigate to="/record-dashboard" replace />;
    }
  }

  return children;
}
