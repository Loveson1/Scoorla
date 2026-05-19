/**
 * Admin Authentication System
 * Uses Firebase Authentication for secure admin login
 * 
 * Features:
 * - Email/Password authentication
 * - Password reset via email
 * - Secure session management
 * - Role-based access control
 */

import { auth, firestore } from "../firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ensureUserScope } from "./userScopeCache";

/**
 * Register a new admin account
 * @param {string} email - Admin email
 * @param {string} password - Admin password
 * @param {string} schoolId - Associated school ID
 * @param {string} displayName - Admin name
 * @returns {Promise<Object>} - Admin user info
 */
export const registerAdmin = async (email, password, schoolId, displayName) => {
  try {
    // Create Firebase Auth account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Update profile
    await updateProfile(user, { displayName });

    // Create admin record in Firestore
    await setDoc(doc(firestore, "users", user.uid), {
      uid: user.uid,
      email: user.email,
      displayName,
      role: "admin",
      schoolId,
      createdAt: serverTimestamp(),
      isActive: true,
    });

    console.log(`✅ Admin registered: ${email}`);
    return {
      uid: user.uid,
      email: user.email,
      displayName,
      schoolId,
      role: "admin",
    };
  } catch (error) {
    console.error("Error registering admin:", error);
    if (error.code === "auth/email-already-in-use") {
      throw new Error("Email already registered");
    }
    if (error.code === "auth/weak-password") {
      throw new Error("Password is too weak (minimum 6 characters)");
    }
    throw error;
  }
};

/**
 * Admin login
 * @param {string} email - Admin email
 * @param {string} password - Admin password
 * @returns {Promise<Object>} - Admin session info
 */
export const adminLogin = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Verify admin record exists and get metadata
    const userData = await ensureUserScope(user.uid, {
      screen: "AdminAuth",
      action: "admin_login_profile",
    });
    if (!userData) {
      throw new Error("Admin account not found");
    }
    if (userData.role !== "admin") {
      throw new Error("Not authorized as admin");
    }

    if (!userData.isActive) {
      throw new Error("Admin account is inactive");
    }

    console.log(`✅ Admin logged in: ${email}`);
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      schoolId: userData.schoolId,
      role: "admin",
    };
  } catch (error) {
    console.error("Error logging in admin:", error);
    if (error.code === "auth/user-not-found") {
      throw new Error("Email not found");
    }
    if (error.code === "auth/wrong-password") {
      throw new Error("Incorrect password");
    }
    throw error;
  }
};

/**
 * Send password reset email to admin
 * @param {string} email - Admin email
 * @returns {Promise<void>}
 */
export const sendAdminPasswordReset = async (email) => {
  try {
    await sendPasswordResetEmail(auth, email);
    console.log(`✅ Password reset email sent to ${email}`);
  } catch (error) {
    console.error("Error sending reset email:", error);
    if (error.code === "auth/user-not-found") {
      throw new Error("Email not found");
    }
    throw error;
  }
};

/**
 * Admin logout
 * @returns {Promise<void>}
 */
export const adminLogout = async () => {
  try {
    await signOut(auth);
    console.log("✅ Admin logged out");
  } catch (error) {
    console.error("Error logging out:", error);
    throw error;
  }
};

/**
 * Get current admin info from Firestore
 * @param {string} uid - User UID
 * @returns {Promise<Object|null>}
 */
export const getAdminInfo = async (uid) => {
  try {
    const userData = await ensureUserScope(uid, {
      screen: "AdminAuth",
      action: "get_admin_info",
    });
    if (!userData) return null;
    if (userData.role !== "admin") return null;

    return userData;
  } catch (error) {
    console.error("Error fetching admin info:", error);
    return null;
  }
};

/**
 * Verify admin has access to school
 * @param {string} uid - User UID
 * @param {string} schoolId - School ID to verify
 * @returns {Promise<boolean>}
 */
export const verifyAdminForSchool = async (uid, schoolId) => {
  try {
    const adminInfo = await getAdminInfo(uid);
    return adminInfo && adminInfo.schoolId === schoolId && adminInfo.role === "admin";
  } catch (error) {
    console.error("Error verifying admin:", error);
    return false;
  }
};

export default {
  registerAdmin,
  adminLogin,
  sendAdminPasswordReset,
  adminLogout,
  getAdminInfo,
  verifyAdminForSchool,
};
