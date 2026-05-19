import { getCurrentUser } from "./authUtils";
import { setUserData } from "./userSession";
import { firestore } from "../firebase";
import { doc, getDoc } from "firebase/firestore";

const getVerifiedCurrentUser = (expectedUid = "") => {
  const user = getCurrentUser();
  const resolvedExpectedUid = String(expectedUid || "").trim();
  if (!user?.uid) return null;
  if (resolvedExpectedUid && String(user.uid || "").trim() !== resolvedExpectedUid) {
    return null;
  }
  return user;
};

const readVerifiedUserProfile = async (uid = "") => {
  const resolvedUid = String(uid || "").trim();
  if (!resolvedUid) return null;

  const userSnap = await getDoc(doc(firestore, "users", resolvedUid));
  if (!userSnap.exists()) return null;

  const userData = userSnap.data() || {};
  if (String(userData?.uid || "").trim() !== resolvedUid) {
    return null;
  }

  return userData;
};

/**
 * Mark onboarding as completed in Firebase
 * @param {string} userId - Firebase user ID
 * @returns {Promise<void>}
 */
export const markOnboardingComplete = async (userId) => {
  try {
    const user = getVerifiedCurrentUser(userId);
    if (!user) {
      throw new Error("Onboarding can only be completed for the current authenticated user.");
    }

    const userProfile = await readVerifiedUserProfile(user.uid);
    const schoolId = String(userProfile?.schoolId || "").trim();
    if (!schoolId) {
      throw new Error("Onboarding cannot complete until this UID is linked to a school.");
    }
    
    const onboardingData = {
      completedAt: new Date().toISOString(),
      version: 1,
      uid: user.uid,
      schoolId,
      onboardingCompleted: true,
    };
    
    // Store in Firestore via userSession
    const userData = { uid: user.uid, onboarding: onboardingData };
    await setUserData(user.uid, null, userData);
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
export const isOnboardingComplete = async (expectedUid = "") => {
  try {
    const user = getVerifiedCurrentUser(expectedUid);
    
    if (!user) {
      return false;
    }

    const userData = await readVerifiedUserProfile(user.uid);
    if (!userData) {
      return false;
    }

    return userData?.onboarding?.onboardingCompleted === true;
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
    const user = getVerifiedCurrentUser();
    
    if (!user) {
      return null;
    }

    const userData = await readVerifiedUserProfile(user.uid);
    
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
    const user = getVerifiedCurrentUser();
    
    if (user) {
      await setUserData(user.uid, null, { uid: user.uid, onboarding: null });
    }
  } catch (error) {
    console.error("Error resetting onboarding:", error);
    throw error;
  }
};

