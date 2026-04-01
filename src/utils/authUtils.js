import { auth, firestore } from "../firebase";
import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  reload,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  endUserSession,
  clearAllSessionState,
} from "./userSession";
import {
  ensureUserScope,
  setCachedUserScope,
} from "./userScopeCache";
import { clearDataCache } from "../services/dataCache";

const schoolCacheKey = (userId) => `cached_school_id_${userId}`;

/**
 * Listen for authentication state changes
 * @param {Function} callback - Function to call with user data
 * @returns {Function} Unsubscribe function
 */
export const subscribeToAuthChanges = (callback) => {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      callback({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      });
    } else {
      callback(null);
    }
  });
};

/**
 * Sign out the current user and clear all user-specific data
 * @returns {Promise<void>}
 */
export const logoutUser = async () => {
  const userId = auth.currentUser?.uid;
  if (userId) {
    try {
      // Best-effort telemetry/session cleanup.
      await endUserSession(userId);
    } catch (sessionError) {
      console.warn("Session cleanup failed during logout:", sessionError);
    }
  }

  clearDataCache();
  clearAllSessionState();

  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out:", error);
    throw error;
  }
};

/**
 * Sign up a new user with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} User credential object
 */
export const registerUser = async (email, password) => {
  return createUserWithEmailAndPassword(auth, email, password);
};

/**
 * Sign in existing user with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} User credential object
 */
export const loginUser = async (email, password) => {
  return signInWithEmailAndPassword(auth, email, password);
};

/**
 * Send password reset email
 * @param {string} email - User email
 * @returns {Promise<void>}
 */
export const resetPassword = async (email) => {
  await sendPasswordResetEmail(auth, email);
};

/**
 * Get current user
 * @returns {Object|null} Current user or null
 */
export const getCurrentUser = () => {
  return auth.currentUser;
};

/**
 * Check if user is authenticated
 * @returns {boolean}
 */
export const isUserAuthenticated = () => {
  return auth.currentUser !== null;
};

/**
 * Parse Firebase auth error codes into user-friendly messages
 * @param {Object} error - Firebase auth error
 * @returns {string} User-friendly error message
 */
export const getAuthErrorMessage = (error) => {
  const errorMessages = {
    "auth/email-already-in-use": "This email is already registered. Please use another email or sign in.",
    "auth/invalid-email": "Invalid email format. Please check and try again.",
    "auth/weak-password": "Password is too weak. Use at least 8 characters with a mix of letters and numbers.",
    "auth/user-not-found": "No account found with this email. Please sign up first.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/too-many-requests": "Too many failed login attempts. Please try again later.",
    "auth/operation-not-allowed": "Operation not allowed. Please contact support.",
    "auth/invalid-credential": "Invalid email or password. Please try again.",
  };

  return (
    errorMessages[error.code] ||
    "An error occurred. Please try again later."
  );
};

/**
 * Send email verification to current user
 * @returns {Promise<void>}
 */
export const sendVerificationEmail = async () => {
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error("No authenticated user found");
    }
    
    await sendEmailVerification(user, {
      url: `${window.location.origin}/login`,
      handleCodeInApp: false,
    });
  } catch (error) {
    console.error("Error sending verification email:", error);
    throw error;
  }
};

/**
 * Check if current user's email is verified
 * Reloads user data from Firebase to get latest verification status
 * @returns {Promise<boolean>}
 */
export const checkEmailVerification = async () => {
  try {
    const user = auth.currentUser;
    if (!user) {
      return false;
    }

    // Avoid forcing verification failure while offline.
    // Use cached auth state and only refresh when network is available.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return !!user.emailVerified;
    }

    // Reload user to get latest emailVerified status from Firebase
    await reload(user);
    return !!user.emailVerified;
  } catch (error) {
    const code = String(error?.code || "");
    if (
      code.includes("network-request-failed") ||
      code.includes("unavailable")
    ) {
      // On transient network failures, keep the cached auth claim.
      return !!auth.currentUser?.emailVerified;
    }
    console.error("Error checking email verification:", error);
    return !!auth.currentUser?.emailVerified;
  }
};

/**
 * Check if user is email verified
 * @returns {boolean}
 */
export const isEmailVerified = () => {
  const user = auth.currentUser;
  return user ? user.emailVerified : false;
};

/**
 * Get user role from Firestore
 * @param {string} userId - Firebase user ID
 * @returns {Promise<string|null>} User role (admin, class_teacher, subject_teacher) or null
 */
export const getUserRole = async (userId) => {
  try {
    const scope = await ensureUserScope(userId, {
      screen: "AuthUtils",
      action: "get_user_role",
    });
    return scope?.role || null;
  } catch (error) {
    console.error("Error getting user role:", error);
    return null;
  }
};

/**
 * Backward-compatible no-op.
 * RTDB mirror syncing is deprecated after Firestore migration.
 * @param {string} uid
 * @param {{schoolId?: string|null, role?: string|null, email?: string|null}} profile
 * @returns {Promise<void>}
 */
export const upsertRtdbUserAccessProfile = async (uid, profile = {}) => {
  void uid;
  void profile;
};

/**
 * Validate Firestore user profile presence.
 * @param {string} uid
 * @returns {Promise<void>}
 */
export const syncUserAccessProfile = async (uid) => {
  try {
    if (!uid) return;
    return await ensureUserScope(uid, {
      screen: "AuthUtils",
      action: "sync_user_access_profile",
    });
  } catch (error) {
    console.error("Error syncing user access profile:", error);
    throw error;
  }
};

/**
 * Check if user is an admin
 * @param {string} userId - Firebase user ID
 * @returns {Promise<boolean>}
 */
export const isAdmin = async (userId) => {
  const role = await getUserRole(userId);
  return role === "admin";
};

/**
 * Get user's school ID from Firestore
 * @param {string} userId - Firebase user ID
 * @returns {Promise<string|null>} School ID or null
 */
export const getUserSchoolId = async (userId) => {
  try {
    const scope = await ensureUserScope(userId, {
      screen: "AuthUtils",
      action: "get_user_school_id",
    });
    if (scope?.schoolId) {
      const schoolId = scope.schoolId || null;
      if (schoolId) {
        try {
          localStorage.setItem(schoolCacheKey(userId), String(schoolId));
        } catch (storageError) {
          void storageError;
        }
      }
      return schoolId;
    }
    try {
      return localStorage.getItem(schoolCacheKey(userId)) || null;
    } catch {
      return null;
    }
  } catch (error) {
    console.error("Error getting user school ID:", error);
    try {
      return localStorage.getItem(schoolCacheKey(userId)) || null;
    } catch {
      return null;
    }
  }
};

/**
 * Set user role in Firestore
 * @param {string} userId - Firebase user ID
 * @param {string} role - Role to assign (admin, class_teacher, subject_teacher)
 * @param {string} schoolId - School ID associated with user
 * @returns {Promise<void>}
 */
export const setUserRole = async (userId, role, schoolId) => {
  try {
    const userRef = doc(firestore, "users", userId);
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
      // Update existing user document
      await updateDoc(userRef, {
        role,
        schoolId,
        roleUpdatedAt: new Date().toISOString(),
      });
    } else {
      // Create new user document
      await setDoc(userRef, {
        role,
        schoolId,
        email: auth.currentUser?.email,
        createdAt: new Date().toISOString(),
        roleUpdatedAt: new Date().toISOString(),
      });
    }

    setCachedUserScope(userId, {
      role,
      schoolId,
      email: auth.currentUser?.email,
    });

    if (schoolId) {
      try {
        localStorage.setItem(schoolCacheKey(userId), String(schoolId));
      } catch (storageError) {
        void storageError;
      }
    }
  } catch (error) {
    console.error("Error setting user role:", error);
    throw error;
  }
};
