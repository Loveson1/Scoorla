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
  getSelectedRole as getSelectedRoleFromSession,
  clearSessionState,
  getSelectedClass as getSelectedClassFromSession,
  setSelectedClass as setSelectedClassInSession,
  getSelectedSubject as getSelectedSubjectFromSession,
  setSelectedSubject as setSelectedSubjectInSession,
} from "./userSession";
import {
  verifyTeacherAccess,
  createClassAccessCode,
  createSubjectAccessCode,
} from "./teacherCodes";

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
  try {
    const userId = auth.currentUser?.uid;
    if (userId) {
      // Use endUserSession to cleanup Firestore + sessionStorage
      await endUserSession(userId);
    }
    
    // Sign out from Firebase
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
  try {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    return userCredential;
  } catch (error) {
    throw error;
  }
};

/**
 * Sign in existing user with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} User credential object
 */
export const loginUser = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );
    return userCredential;
  } catch (error) {
    throw error;
  }
};

/**
 * Send password reset email
 * @param {string} email - User email
 * @returns {Promise<void>}
 */
export const resetPassword = async (email) => {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    throw error;
  }
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
    
    // Reload user to get latest emailVerified status from Firebase
    await reload(user);
    return user.emailVerified;
  } catch (error) {
    console.error("Error checking email verification:", error);
    return false;
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
    const userDoc = await getDoc(doc(firestore, "users", userId));
    if (userDoc.exists()) {
      return userDoc.data().role || null;
    }
    return null;
  } catch (error) {
    console.error("Error getting user role:", error);
    return null;
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
    const userDoc = await getDoc(doc(firestore, "users", userId));
    if (userDoc.exists()) {
      return userDoc.data().schoolId || null;
    }
    return null;
  } catch (error) {
    console.error("Error getting user school ID:", error);
    return null;
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
  } catch (error) {
    console.error("Error setting user role:", error);
    throw error;
  }
};

/**
 * Get selected role from userSession
 * Uses sessionStorage (temporary, expires on tab close)
 * @param {string} userId - Firebase user ID
 * @returns {string|null} Selected role or null
 */
export const getSelectedRole = (userId) => {
  return getSelectedRoleFromSession(userId);
};

/**
 * Clear selected role from sessionStorage
 * @param {string} userId - Firebase user ID
 */
export const clearSelectedRole = (userId) => {
  clearSessionState(`selectedRole_${userId}`);
};

/**
 * Verify teacher access with code
 * Uses Firebase-stored hashed codes
 * @param {string} schoolId - School ID
 * @param {string} code - Access code to verify
 * @param {string} type - Type: 'class' or 'subject'
 * @param {string} classId - Class ID
 * @param {string} subjectId - Subject ID (required if type='subject')
 * @returns {Promise<Object|null>} Code data if valid, null if invalid
 */
export const validateClassPassword = async (schoolId, code, classId, subjectId = undefined) => {
  try {
    return await verifyTeacherAccess(schoolId, code, subjectId ? 'subject' : 'class', classId, subjectId);
  } catch (error) {
    console.error("Error validating code:", error);
    return null;
  }
};

/**
 * Create new class access code
 * Shows plain code once, stores hashed in database
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @returns {Promise<{plainCode: string, codeId: string}>} Plain code and code ID
 */
export const setClassPassword = async (schoolId, classId) => {
  try {
    return await createClassAccessCode(schoolId, classId);
  } catch (error) {
    console.error("Error creating class code:", error);
    throw error;
  }
};

/**
 * Verify subject access with code
 * Uses Firebase-stored hashed codes
 * @param {string} schoolId - School ID
 * @param {string} code - Access code to verify
 * @param {string} classId - Class ID
 * @param {string} subjectId - Subject ID
 * @returns {Promise<Object|null>} Code data if valid, null if invalid
 */
export const validateSubjectPassword = async (schoolId, code, classId, subjectId) => {
  try {
    return await verifyTeacherAccess(schoolId, code, 'subject', classId, subjectId);
  } catch (error) {
    console.error("Error validating subject code:", error);
    return null;
  }
};

/**
 * Create new subject access code
 * Shows plain code once, stores hashed in database
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {string} subjectId - Subject ID
 * @returns {Promise<{plainCode: string, codeId: string}>} Plain code and code ID
 */
export const setSubjectPassword = async (schoolId, classId, subjectId) => {
  try {
    return await createSubjectAccessCode(schoolId, classId, subjectId);
  } catch (error) {
    console.error("Error creating subject code:", error);
    throw error;
  }
};

/**
 * Get teacher's selected class from sessionStorage
 * @param {string} userId - Firebase user ID
 * @returns {string|null} Selected class ID or null
 */
export const getSelectedClass = (userId) => {
  return getSelectedClassFromSession(userId);
};

/**
 * Set teacher's selected class in sessionStorage
 * @param {string} userId - Firebase user ID
 * @param {string} classId - Class ID to set
 */
export const setSelectedClass = (userId, classId) => {
  setSelectedClassInSession(userId, classId);
};

/**
 * Get teacher's selected subject from sessionStorage
 * @param {string} userId - Firebase user ID
 * @returns {string|null} Selected subject ID or null
 */
export const getSelectedSubject = (userId) => {
  return getSelectedSubjectFromSession(userId);
};

/**
 * Set teacher's selected subject in sessionStorage
 * @param {string} userId - Firebase user ID
 * @param {string} subjectId - Subject ID to set
 */
export const setSelectedSubject = (userId, subjectId) => {
  setSelectedSubjectInSession(userId, subjectId);
};

/**
 * Generate a random password
 * @param {number} length - Password length (default: 8)
 * @returns {string}
 */
export const generatePassword = (length = 8) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};
