import { getCurrentUser } from "./authUtils";
import { setUserData, getUserData } from "./userSession";

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
    const userData = await getUserData(user.uid);
    
    if (userData && userData.onboarding && userData.onboarding.onboardingCompleted) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    return false;
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
      const { setUserData } = require("./userSession");
      await setUserData(user.uid, null, { onboarding: null });
    }
  } catch (error) {
    console.error("Error resetting onboarding:", error);
    throw error;
  }
};

