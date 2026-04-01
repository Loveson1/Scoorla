/**
 * User Session Management
 * Manages user session state without localStorage
 * Uses sessionStorage for temporary in-browser state and Firestore for persistent user data
 */

import { firestore } from "../firebase";
import { doc, setDoc, getDoc, updateDoc } from "firebase/firestore";
import { ensureUserScope, setCachedUserScope } from "./userScopeCache";

/**
 * Initialize user session
 * Creates/updates user record in database
 * @param {Object} userCredential - Firebase user object
 * @param {string} schoolId - Associated school ID
 * @param {string} role - User role
 * @returns {Promise<Object>} - User session info
 */
export const initializeUserSession = async (userCredential, schoolId, role = "teacher") => {
  try {
    const user = userCredential.user || userCredential;
    const userRef = doc(firestore, "users", user.uid);
    const nowIso = new Date().toISOString();

    // Check if user doc exists
    const existingDoc = await getDoc(userRef);
    
    if (existingDoc.exists()) {
      // Update existing user
      await updateDoc(userRef, {
        lastLogin: nowIso,
        lastLoginAt: nowIso,
        isOnline: true,
        updatedAt: nowIso,
      });
    } else {
      // Create new user record
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || "User",
        schoolId,
        role,
        createdAt: nowIso,
        lastLogin: nowIso,
        lastLoginAt: nowIso,
        isOnline: true,
        isActive: true,
      });
    }

    console.log(`✅ User session initialized: ${user.uid}`);
    
    setCachedUserScope(user.uid, {
      schoolId,
      role,
      email: user.email,
      isActive: true,
    });

    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      schoolId,
      role,
    };
  } catch (error) {
    console.error("Error initializing user session:", error);
    throw error;
  }
};

/**
 * Get user session info from Firestore
 * @param {string} uid - User UID
 * @returns {Promise<Object|null>}
 */
export const getUserSession = async (uid) => {
  try {
    return await ensureUserScope(uid, {
      screen: "UserSession",
      action: "get_user_session",
    });
  } catch (error) {
    console.error("Error fetching user session:", error);
    return null;
  }
};

/**
 * Store temporary session state in sessionStorage  
 * (expires when browser tab closes)
 * @param {string} key - Session key
 * @param {any} value - Value to store
 */
export const setSessionState = (key, value) => {
  try {
    sessionStorage.setItem(`session_${key}`, JSON.stringify(value));
  } catch (error) {
    console.error("Error storing session state:", error);
  }
};

/**
 * Get temporary session state from sessionStorage
 * @param {string} key - Session key
 * @returns {any} - Stored value or null
 */
export const getSessionState = (key) => {
  try {
    const value = sessionStorage.getItem(`session_${key}`);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error("Error retrieving session state:", error);
    return null;
  }
};

/**
 * Clear temporary session state
 * @param {string} key - Session key
 */
export const clearSessionState = (key) => {
  try {
    sessionStorage.removeItem(`session_${key}`);
  } catch (error) {
    console.error("Error clearing session state:", error);
  }
};

export const clearAllSessionState = () => {
  try {
    const keysToRemove = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (String(key || "").startsWith("session_")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
  } catch (error) {
    console.error("Error clearing all session state:", error);
  }
};

/**
 * Store persistent user data
 * @param {string} uid - User UID
 * @param {string} schoolId - School ID
 * @param {Object} data - Data to store
 * @returns {Promise<void>}
 */
export const setUserData = async (uid, schoolId, data) => {
  try {
    const userRef = doc(firestore, "users", uid);
    await updateDoc(userRef, {
      ...data,
      updatedAt: new Date().toISOString(),
    });
    console.log(`✅ User data updated for ${uid}`);
  } catch (error) {
    console.error("Error updating user data:", error);
    throw error;
  }
};

/**
 * Get persistent user data
 * @param {string} uid - User UID
 * @returns {Promise<Object|null>}
 */
export const getUserData = async (uid) => {
  try {
    return await ensureUserScope(uid, {
      screen: "UserSession",
      action: "get_user_data",
    });
  } catch (error) {
    console.error("Error fetching user data:", error);
    return null;
  }
};

/**
 * Store selected class temporarily
 * @param {string} uid - User UID
 * @param {string} classId - Class ID
 */
export const setSelectedClass = (uid, classId) => {
  setSessionState(`selectedClass_${uid}`, classId);
};

/**
 * Get selected class
 * @param {string} uid - User UID
 * @returns {string|null}
 */
export const getSelectedClass = (uid) => {
  return getSessionState(`selectedClass_${uid}`);
};

/**
 * Store selected subject temporarily
 * @param {string} uid - User UID
 * @param {string} subjectId - Subject ID
 */
export const setSelectedSubject = (uid, subjectId) => {
  setSessionState(`selectedSubject_${uid}`, subjectId);
};

/**
 * Get selected subject
 * @param {string} uid - User UID
 * @returns {string|null}
 */
export const getSelectedSubject = (uid) => {
  return getSessionState(`selectedSubject_${uid}`);
};

/**
 * End user session
 * @param {string} uid - User UID
 * @returns {Promise<void>}
 */
export const endUserSession = async (uid) => {
  try {
    // Clear all session state
    clearSessionState(`selectedClass_${uid}`);
    clearSessionState(`selectedSubject_${uid}`);
    clearSessionState(`adminVerified_${uid}`);

    // Update session telemetry without disabling the account.
    const userRef = doc(firestore, "users", uid);
    const nowIso = new Date().toISOString();
    await setDoc(
      userRef,
      {
        lastLogout: nowIso,
        lastLogoutAt: nowIso,
        isOnline: false,
        updatedAt: nowIso,
      },
      { merge: true }
    );

    console.log(`✅ User session ended: ${uid}`);
  } catch (error) {
    console.error("Error ending user session:", error);
    // Don't throw - logout should succeed even if DB update fails
  }
};

export default {
  // Session initialization
  initializeUserSession,
  getUserSession,
  
  // Session state (temporary, in-browser)
  setSessionState,
  getSessionState,
  clearSessionState,
  
  // Persistent user data
  setUserData,
  getUserData,
  
  // Specific session helpers
  setSelectedClass,
  getSelectedClass,
  setSelectedSubject,
  getSelectedSubject,
  
  // Session lifecycle
  endUserSession,
};
