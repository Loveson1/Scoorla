import { getCurrentUser } from "./authUtils";
import { setUserData, getUserData } from "./userSession";

const onboardingCacheKey = (userId) => `onboarding_complete_${userId}`;
const schoolCacheKey = (userId) => `cached_school_id_${userId}`;

const setOnboardingCache = (userId, complete, schoolId = "") => {
  try {
    localStorage.setItem(onboardingCacheKey(userId), complete ? "true" : "false");
    const normalizedSchoolId = String(schoolId || "").trim();
    if (normalizedSchoolId) {
      localStorage.setItem(schoolCacheKey(userId), normalizedSchoolId);
    }
  } catch (error) {
    console.warn("Unable to persist onboarding cache:", error?.message || error);
  }
};

const readOnboardingCache = (userId) => {
  try {
    const onboardingFlag = localStorage.getItem(onboardingCacheKey(userId)) === "true";
    const cachedSchoolId = String(localStorage.getItem(schoolCacheKey(userId)) || "").trim();
    return {
      onboardingFlag,
      cachedSchoolId,
      isComplete: onboardingFlag || !!cachedSchoolId,
    };
  } catch (error) {
    console.warn("Unable to read onboarding cache:", error?.message || error);
    return { onboardingFlag: false, cachedSchoolId: "", isComplete: false };
  }
};

/**
 * Mark onboarding as completed in Firebase
 * @param {string} userId - Firebase user ID
 * @returns {Promise<void>}
 */
export const markOnboardingComplete = async (userId) => {
  try {
    
    const onboardingData = {
      completedAt: new Date().toISOString(),
      version: 1,
      onboardingCompleted: true,
    };
    
    // Store in Firestore via userSession
    const userData = { onboarding: onboardingData };
    await setUserData(userId, null, userData);
    setOnboardingCache(userId, true);
  } catch (error) {
    console.error("Error marking onboarding complete:", error);
    throw error;
  }
};

/**
 * Check if user has completed onboarding
 * Checks Firebase user document
 * @returns {Promise<boolean>}
 */
export const isOnboardingComplete = async () => {
  try {
    const user = getCurrentUser();
    
    if (!user) {
      return false;
    }
    const cached = readOnboardingCache(user.uid);
    const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (isOffline && cached.isComplete) {
      return true;
    }

    const userData = await getUserData(user.uid);
    if (!userData) {
      return cached.isComplete;
    }

    // Firestore migration-safe authoritative check:
    // onboarding is complete once a schoolId is bound to the user profile.
    if (userData.schoolId) {
      setOnboardingCache(user.uid, true, userData.schoolId);
      return true;
    }

    // Legacy fallback for older onboarding documents.
    if (userData.onboarding && userData.onboarding.onboardingCompleted) {
      setOnboardingCache(user.uid, true);
      return true;
    }

    if (!isOffline) {
      setOnboardingCache(user.uid, false);
    }
    return false;
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    const user = getCurrentUser();
    if (!user) return false;
    return readOnboardingCache(user.uid).isComplete;
  }
};

/**
 * Get onboarding completion data
 * @returns {Promise<Object|null>}
 */
export const getOnboardingData = async () => {
  try {
    const user = getCurrentUser();
    
    if (!user) {
      return null;
    }

    const userData = await getUserData(user.uid);
    
    if (userData && userData.onboarding) {
      return userData.onboarding;
    }
    
    return null;
  } catch (error) {
    console.error("Error getting onboarding data:", error);
    return null;
  }
};

/**
 * Reset onboarding (for admin or testing)
 * @returns {Promise<void>}
 */
export const resetOnboarding = async () => {
  try {
    const user = getCurrentUser();
    
    if (user) {
      await setUserData(user.uid, null, { onboarding: null });
    }
  } catch (error) {
    console.error("Error resetting onboarding:", error);
    throw error;
  }
};

