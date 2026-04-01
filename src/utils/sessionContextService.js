import { doc, getDoc } from "firebase/firestore";
import { firestore } from "../firebase";
import {
  getActiveSession,
  getActiveTerm,
  listSessions,
} from "./firestoreService";

const SESSION_CONTEXT_KEY = "currentSessionId";
const TERM_CONTEXT_KEY = "currentTermId";

const normalizeTermToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

const toTermAlias = (value) => {
  const token = normalizeTermToken(value);
  if (!token) return "";
  if (["term1", "1", "1stterm", "firstterm"].includes(token)) return "term1";
  if (["term2", "2", "2ndterm", "secondterm"].includes(token)) return "term2";
  if (["term3", "3", "3rdterm", "thirdterm"].includes(token)) return "term3";
  return "";
};

const resolveTermAliasFromRecord = (term) =>
  toTermAlias(term?.alias) ||
  toTermAlias(term?.termId) ||
  toTermAlias(term?.name) ||
  "";

/**
 * Resolve currently active session id for a school from Firestore settings/sessions.
 */
export const getCurrentSessionId = async (schoolId) => {
  try {
    if (!schoolId) {
      throw new Error("schoolId is required");
    }

    // Prefer authoritative settings pointer first.
    const settingsSnapshot = await getDoc(doc(firestore, "settings", schoolId));
    if (settingsSnapshot.exists()) {
      const fromSettings = String(settingsSnapshot.data()?.activeSessionId || "").trim();
      if (fromSettings) return fromSettings;
    }

    const activeSession = await getActiveSession(schoolId);
    return activeSession?.sessionId || activeSession?.id || null;
  } catch (error) {
    console.error("Error getting current session ID:", error);
    return null;
  }
};

/**
 * Set current session context on client side.
 */
export const setCurrentSessionContext = (sessionId, setState) => {
  try {
    const normalizedSessionId = String(sessionId || "").trim();

    if (!normalizedSessionId) {
      localStorage.removeItem(SESSION_CONTEXT_KEY);
      if (typeof setState === "function") {
        setState(null);
      }
      return null;
    }

    localStorage.setItem(SESSION_CONTEXT_KEY, normalizedSessionId);
    if (typeof setState === "function") {
      setState(normalizedSessionId);
    }
    return normalizedSessionId;
  } catch (error) {
    console.error("Error setting current session context:", error);
    return null;
  }
};

/**
 * Resolve a usable session id.
 * - Returns explicit input when valid.
 * - Accepts either Firestore session id or session name (e.g. "2025/2026").
 * - Falls back to active session id when not provided.
 */
export const resolveSession = async (inputSessionId, schoolId) => {
  const normalizedInput = String(inputSessionId || "").trim();
  if (normalizedInput) {
    if (!schoolId) return normalizedInput;

    const sessions = await listSessions(schoolId);
    const compareName = normalizedInput.replace(/\s+/g, "").toLowerCase();

    const idMatch = sessions.find((session) => {
      const candidateId = String(session?.sessionId || session?.id || "").trim();
      return candidateId === normalizedInput;
    });
    if (idMatch) {
      return String(idMatch.sessionId || idMatch.id || normalizedInput);
    }

    const nameMatches = sessions.filter((session) => {
      const candidateName = String(session?.name || "").replace(/\s+/g, "").toLowerCase();
      return candidateName && candidateName === compareName;
    });
    if (nameMatches.length > 0) {
      const preferred =
        nameMatches.find((session) => !!session?.isActive) ||
        nameMatches.find((session) => session?.isArchived !== true && session?.isEditable !== false) ||
        nameMatches[0];
      return String(preferred?.sessionId || preferred?.id || normalizedInput);
    }

    // Input token does not map to any known session for this school.
    // Fall back to active session to avoid permission failures from invalid IDs.
    const fallbackActive = await getCurrentSessionId(schoolId);
    return fallbackActive || normalizedInput;
  }

  return getCurrentSessionId(schoolId);
};

/**
 * Resolve currently active term id (canonical alias) for a school.
 */
export const getCurrentTermId = async (schoolId) => {
  try {
    if (!schoolId) {
      throw new Error("schoolId is required");
    }

    const settingsSnapshot = await getDoc(doc(firestore, "settings", schoolId));
    const fromSettings = settingsSnapshot.exists()
      ? toTermAlias(settingsSnapshot.data()?.activeTermId)
      : "";
    if (fromSettings) return fromSettings;

    const activeTerm = await getActiveTerm(schoolId);
    const alias = resolveTermAliasFromRecord(activeTerm);
    return alias || "term1";
  } catch (error) {
    console.error("Error getting current term ID:", error);
    return "term1";
  }
};

/**
 * Set current term context on client side.
 */
export const setCurrentTermContext = (termId, setState) => {
  try {
    const normalizedTermId = toTermAlias(termId) || "term1";
    localStorage.setItem(TERM_CONTEXT_KEY, normalizedTermId);

    if (typeof setState === "function") {
      setState(normalizedTermId);
    }

    return normalizedTermId;
  } catch (error) {
    console.error("Error setting current term context:", error);
    return "term1";
  }
};

/**
 * Resolve a usable term id.
 * - If input exists, returns its canonical alias.
 * - Otherwise falls back to active term for school.
 */
export const resolveTerm = async (inputTermId, schoolId) => {
  const normalizedInput = toTermAlias(inputTermId);
  if (normalizedInput) {
    return normalizedInput;
  }

  return getCurrentTermId(schoolId);
};

export default {
  getCurrentSessionId,
  setCurrentSessionContext,
  resolveSession,
  getCurrentTermId,
  setCurrentTermContext,
  resolveTerm,
};
