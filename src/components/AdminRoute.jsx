import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { getCurrentUser, isAdmin } from "../utils/authUtils";
import { isOnboardingComplete } from "../utils/onboardingUtils";

/**
 * AdminRoute component that enforces admin role requirement
 * 
 * Rules:
 * - Not authenticated → redirect to /login
 * - Email NOT verified → redirect to /verify-email
 * - Onboarding NOT complete → redirect to /school
 * - User role is NOT admin → redirect to /school-dashboard (access denied)
 * - User is admin → allow access
 * 
 * @param {Object} props
 * @param {React.ReactNode} props.children - Component to render if authorized
 */
export default function AdminRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [redirectTo, setRedirectTo] = useState(null);

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const user = getCurrentUser();
        
        // Not authenticated
        if (!user) {
          setRedirectTo("/login");
          setLoading(false);
          return;
        }

        // Check if onboarding is complete
        const isComplete = await isOnboardingComplete();
        if (!isComplete) {
          setRedirectTo("/school");
          setLoading(false);
          return;
        }

        // Check if user is admin
        const userIsAdmin = await isAdmin(user.uid);
        if (!userIsAdmin) {
          // User is not admin, redirect to dashboard
          setRedirectTo("/school-dashboard");
          setLoading(false);
          return;
        }

        // User is admin
        setIsAuthorized(true);
        setLoading(false);
      } catch (error) {
        console.error("Error checking admin status:", error);
        setRedirectTo("/login");
        setLoading(false);
      }
    };

    checkAdminStatus();
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-r from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-700 dark:text-gray-300">Checking permissions...</p>
        </div>
      </div>
    );
  }

  // Redirect if needed
  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }

  // Authorized
  return children;
}
