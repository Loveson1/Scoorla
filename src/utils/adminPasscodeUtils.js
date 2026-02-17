import { firestore } from "../firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";

/**
 * Generate a random 6-digit Admin Passcode
 * @returns {string} Random 6-digit passcode (e.g., "384756")
 */
export function generateAdminPasscode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Hash a passcode using a simple but secure method
 * For production, consider using bcryptjs or similar
 * @param {string} passcode - The passcode to hash
 * @returns {Promise<string>} Hashed passcode
 */
export async function hashAdminPasscode(passcode) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(passcode);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    console.error("Error hashing passcode:", error);
    throw new Error("Failed to hash passcode");
  }
}

/**
 * Store admin passcode hash in Firestore
 * @param {string} schoolId - School ID
 * @param {string} passcodeHash - Hashed passcode
 * @returns {Promise<void>}
 */
export async function storeAdminPasscodeHash(schoolId, passcodeHash) {
  try {
    const schoolSecurityRef = doc(firestore, "schools", schoolId, "security", "adminPasscode");
    await setDoc(schoolSecurityRef, {
      hash: passcodeHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error storing passcode hash:", error);
    throw new Error("Failed to store admin passcode");
  }
}

/**
 * Get admin passcode hash from Firestore
 * @param {string} schoolId - School ID
 * @returns {Promise<string|null>} Hashed passcode or null if not found
 */
export async function getAdminPasscodeHash(schoolId) {
  try {
    const schoolSecurityRef = doc(firestore, "schools", schoolId, "security", "adminPasscode");
    const docSnap = await getDoc(schoolSecurityRef);
    if (docSnap.exists()) {
      return docSnap.data().hash;
    }
    return null;
  } catch (error) {
    console.error("Error getting passcode hash:", error);
    return null;
  }
}

/**
 * Verify entered passcode against stored hash
 * @param {string} enteredPasscode - The passcode user entered
 * @param {string} storedHash - The stored hash from Firestore
 * @returns {Promise<boolean>} True if passcode matches
 */
export async function verifyAdminPasscode(enteredPasscode, storedHash) {
  try {
    const enteredHash = await hashAdminPasscode(enteredPasscode);
    // Secure comparison to prevent timing attacks
    return secureCompare(enteredHash, storedHash);
  } catch (error) {
    console.error("Error verifying passcode:", error);
    return false;
  }
}

/**
 * Secure string comparison (prevents timing attacks)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings match
 */
function secureCompare(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
