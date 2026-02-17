/**
 * Password utilities for role access control.
 * - 6-digit numeric generation
 * - SHA-256 hashing
 * - hash verification
 */

/**
 * Generate a random 6-digit numeric access code.
 * @returns {string}
 */
export const generateSixDigitCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

/**
 * Hash password/code using SHA-256.
 * @param {string|number} code
 * @returns {Promise<string>}
 */
export const hashPassword = async (code) => {
  const normalized = String(code ?? "").trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * Verify input code against stored hash.
 * @param {string|number} input
 * @param {string} storedHash
 * @returns {Promise<boolean>}
 */
export const verifyPassword = async (input, storedHash) => {
  if (!storedHash || typeof storedHash !== "string") return false;
  const inputHash = await hashPassword(input);
  return inputHash === storedHash;
};

/**
 * Mask a code for optional UI display.
 * @param {string} password
 * @returns {string}
 */
export const maskPassword = (password) => {
  if (!password) return "******";
  return `••••${String(password).slice(-2)}`;
};
