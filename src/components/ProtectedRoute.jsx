import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { checkEmailVerification } from "../utils/authUtils";
import { useAuthContext } from "../context/AuthContext";

/**
 * Guard app routes with auth + verification + onboarding + role checks.
 */
export default function ProtectedRoute({
  children,
  allowUnonboarded = false,
  requireVerified = true,
  allowDisabledSchool = false,
  allowedRoles = [],
}) {
  const {
    authUser,
    profile,
    role,
    schoolId,
    schoolDisabled,
    isPlatformSuperAdmin,
    isLoading,
    isProfileSynced,
    profileHasPendingWrites,
  } = useAuthContext();
  const isAdminRole = role === "admin";
  const enforceEmailVerification = requireVerified && isAdminRole;
  const authUserUid = String(authUser?.uid || "").trim();
  const onboardingComplete = profile?.onboarding?.onboardingCompleted === true;
  const shouldWaitForProfile =
    !!authUserUid && (!isProfileSynced || profileHasPendingWrites || !profile);
  const [emailVerified, setEmailVerified] = useState(false);
  const [isCheckingState, setIsCheckingState] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const resolveState = async () => {
      if (!authUser) {
        if (isMounted) {
          setEmailVerified(false);
          setIsCheckingState(false);
        }
        return;
      }

      if (shouldWaitForProfile) {
        if (isMounted) {
          setEmailVerified(false);
          setIsCheckingState(true);
        }
        return;
      }

      try {
        if (enforceEmailVerification) {
          const verified = await checkEmailVerification();
          if (!isMounted) return;
          setEmailVerified(!!verified);
        } else {
          setEmailVerified(true);
        }
      } catch (error) {
        if (!isMounted) return;
        setEmailVerified(enforceEmailVerification ? !!authUser?.emailVerified : true);
        console.error("Error resolving route guard state:", error);
      } finally {
        if (isMounted) setIsCheckingState(false);
      }
    };

    setIsCheckingState(true);
    resolveState();
    return () => {
      isMounted = false;
    };
  }, [authUser, enforceEmailVerification, shouldWaitForProfile]);

  if (isLoading || isCheckingState || shouldWaitForProfile) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-r from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
          <p className="text-gray-700 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return <Navigate to="/login" replace />;
  }

  if (isPlatformSuperAdmin) {
    return <Navigate to="/platform" replace />;
  }

  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (enforceEmailVerification && !emailVerified && !isOffline) {
    return <Navigate to="/verify-email" replace />;
  }

  if (allowUnonboarded) {
    return children;
  }

  if (!allowUnonboarded && !onboardingComplete && !isOffline) {
    return <Navigate to="/welcome" replace />;
  }

  if (!allowUnonboarded && onboardingComplete && !role) {
    // Wait until profile is fully loaded before denying access
    if (isLoading) return null;
    return <Navigate to="/access-denied" replace />;
  }

  if (!allowDisabledSchool && schoolId && schoolDisabled) {
    return <Navigate to="/school-disabled" replace />;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    return <Navigate to="/access-denied" replace />;
  }

  return children;
}
