import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { getCurrentUser } from "../utils/authUtils";
import { isOnboardingComplete } from "../utils/onboardingUtils";
import { checkEmailVerification } from "../utils/authUtils";
import { auth, firestore } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

/**
 * ProtectedRoute component that enforces auth, email verification, onboarding, and role selection
 * 
 * Rules:
 * - Not authenticated → redirect to /login
 * - Email NOT verified → redirect to /verify-email
 * - Email verified but onboarding NOT complete → redirect to /welcome
 * - Onboarding complete but NO ROLE SELECTED → redirect to /select-role
 * - If allowUnonboarded={true}: Allow access (for welcome, onboarding, role selection screens)
 * - If allowUnonboarded={false} (default): Require onboarding AND role selection complete
 * 
 * @param {Object} props
 * @param {React.ReactNode} props.children - Component to render if authorized
 * @param {boolean} props.allowUnonboarded - Allow unonboarded users (default: false)
 * @param {boolean} props.requireVerified - Require email verification (default: true)
 */
export default function ProtectedRoute({ 
  children, 
  allowUnonboarded = false,
  requireVerified = true 
}) {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [roleSelected, setRoleSelected] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  useEffect(() => {
    // Subscribe to auth state changes
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      try {
        if (!authUser) {
          // Not authenticated
          setIsAuthenticated(false);
          setLoading(false);
          return;
        }

        setIsAuthenticated(true);

        // Check email verification
        const isVerified = await checkEmailVerification();
        setEmailVerified(isVerified);

        // Check if role has been selected - re-check from localStorage every time
        const roleKey = `selectedRole_${authUser.uid}`;
        const selectedRole = localStorage.getItem(roleKey);
        setRoleSelected(!!selectedRole);
        console.log(`🔍 ProtectedRoute checking - Key: "${roleKey}", Value: "${selectedRole}", roleSelected: ${!!selectedRole}`);
        console.log(`👤 Auth User UID: ${authUser.uid}`);

        // Check if onboarding is complete
        // Approach: Check if user has schoolId in Firestore (means they created a school)
        // OR check if onboarding flag is set in Firestore
        let isComplete = false;
        
        try {
          const userRef = doc(firestore, "users", authUser.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists() && userSnap.data().schoolId) {
            // User has a schoolId, which means they've created a school → onboarding complete
            isComplete = true;
            console.log(`✅ Onboarding complete (schoolId found): ${userSnap.data().schoolId}`);
          } else {
            // Fall back to checking onboarding flag from Firestore
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

    // Also listen for localStorage changes (in case role is set in another tab/window)
    const handleStorageChange = (e) => {
      const user = getCurrentUser();
      if (user && e.key === `selectedRole_${user.uid}`) {
        console.log("📝 localStorage change detected - updating role:", e.newValue);
        setRoleSelected(!!e.newValue);
      }
    };

    window.addEventListener("storage", handleStorageChange);

    // Cleanup subscriptions on unmount
    return () => {
      unsubscribe();
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  // Loading state
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

  // Not authenticated → redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Email verification required but not verified → redirect to verify
  if (requireVerified && !emailVerified) {
    return <Navigate to="/verify-email" replace />;
  }

  // If allowUnonboarded is true, allow access regardless of onboarding/role status
  // (for welcome, onboarding, role selection screens)
  if (allowUnonboarded) {
    return children;
  }

  // From here on, we require onboarding to be complete + role selected
  
  // Email verified but onboarding NOT complete → redirect to welcome page
  if (requireVerified && emailVerified && !onboardingComplete) {
    console.warn("⚠️ REDIRECT TO /welcome - onboarding not complete");
    return <Navigate to="/welcome" replace />;
  }

  // Onboarding complete but NO ROLE SELECTED → redirect to role selector
  // Check localStorage directly in addition to state to handle timing issues
  const user = getCurrentUser();
  const roleInStorage = user ? localStorage.getItem(`selectedRole_${user.uid}`) : null;
  const hasRole = roleSelected || !!roleInStorage;
  
  if (requireVerified && emailVerified && onboardingComplete && !hasRole) {
    console.warn("⚠️ REDIRECT TO /select-role - roleSelected is false!");
    console.warn("🔍 State:", { requireVerified, emailVerified, onboardingComplete, roleSelected, roleInStorage });
    return <Navigate to="/select-role" replace />;
  }

  // Authenticated, verified, onboarded, and role selected → allow access to protected app
  console.log("✅ ProtectedRoute: Granting access to protected component");
  return children;
}



