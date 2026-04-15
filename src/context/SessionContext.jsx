/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { firestore } from "../firebase";
import {
  instrumentFirestoreRead,
  recordFirestoreRead,
} from "../services/firestoreInstrumentation";
import { useAuthContext } from "./AuthContext";

const SessionContext = createContext(null);

const SESSION_STORAGE_KEY_PREFIX = "selectedSessionId_";
const TERM_STORAGE_KEY_PREFIX = "selectedTermId_";
const CURRENT_SESSION_ID_KEY = "currentSessionId";
const CURRENT_TERM_ID_KEY = "currentTermId";
const TERM_DEFINITIONS = [
  { alias: "term1", name: "First Term", sortOrder: 1 },
  { alias: "term2", name: "Second Term", sortOrder: 2 },
  { alias: "term3", name: "Third Term", sortOrder: 3 },
];

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

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") {
    const nanos = typeof value?.nanoseconds === "number" ? value.nanoseconds : 0;
    return value.seconds * 1000 + Math.floor(nanos / 1_000_000);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getTermAliasFromRecord = (term) =>
  toTermAlias(term?.alias) ||
  toTermAlias(term?.termId) ||
  toTermAlias(term?.name) ||
  "";

const buildDisplayedTerms = (terms = [], fallbackActiveAlias = "term1") => {
  const byAlias = new Map();
  terms.forEach((term) => {
    const alias = getTermAliasFromRecord(term);
    if (alias) {
      byAlias.set(alias, term);
    }
  });

  const flaggedActive = terms.find((term) => !!term?.isActive);
  const resolvedActiveAlias =
    getTermAliasFromRecord(flaggedActive) ||
    toTermAlias(fallbackActiveAlias) ||
    "term1";
  const activeSortOrder =
    Number(
      TERM_DEFINITIONS.find((item) => item.alias === resolvedActiveAlias)?.sortOrder || 1
    ) || 1;

  return TERM_DEFINITIONS.map((definition) => {
    const existing = byAlias.get(definition.alias) || {};
    const hasEditableFlag = Object.prototype.hasOwnProperty.call(existing, "isEditable");
    const sortOrder = Number(existing?.sortOrder || definition.sortOrder || 0);
    const isCurrent = definition.alias === resolvedActiveAlias;
    return {
      ...existing,
      id: existing?.id || "",
      termId: existing?.termId || existing?.id || "",
      alias: definition.alias,
      name: existing?.name || definition.name,
      sortOrder,
      isCurrent,
      isPast: sortOrder < activeSortOrder,
      isFuture: sortOrder > activeSortOrder,
      isEditable: hasEditableFlag ? existing?.isEditable === true : isCurrent,
    };
  });
};

export const SessionProvider = ({ children }) => {
  const { authUser, schoolId: authSchoolId, isLoading: isAuthLoading } = useAuthContext();
  const [schoolId, setSchoolId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeTermId, setActiveTermId] = useState("term1");
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [selectedTermId, setSelectedTermId] = useState("term1");
  const [selectedSessionTerms, setSelectedSessionTerms] = useState(
    buildDisplayedTerms([], "term1")
  );
  const [selectedSessionActiveTermId, setSelectedSessionActiveTermId] = useState("term1");
  const [isLoading, setIsLoading] = useState(true);
  const [selectionReadyKey, setSelectionReadyKey] = useState("");
  const lastSelectedSessionRef = useRef(null);
  const previousSelectedSessionActiveTermRef = useRef("term1");
  const previousActiveSessionRef = useRef(null);

  useEffect(() => {
    if (isAuthLoading) {
      setIsLoading(true);
      return;
    }

    if (!authUser?.uid || !authSchoolId) {
      setSchoolId(null);
      setSessions([]);
      setActiveSessionId(null);
      setActiveTermId("term1");
      setSelectedSessionId(null);
      setSelectedTermId("term1");
      setSelectedSessionTerms(buildDisplayedTerms([], "term1"));
      setSelectedSessionActiveTermId("term1");
      setSelectionReadyKey("");
      lastSelectedSessionRef.current = null;
      previousSelectedSessionActiveTermRef.current = "term1";
      previousActiveSessionRef.current = null;
      try {
        localStorage.removeItem(CURRENT_SESSION_ID_KEY);
        localStorage.removeItem(CURRENT_TERM_ID_KEY);
      } catch {
        // no-op
      }
      setIsLoading(false);
      return;
    }

    setSchoolId(authSchoolId || null);
    setIsLoading(false);
  }, [authUser?.uid, authSchoolId, isAuthLoading]);

  useEffect(() => {
    if (!schoolId) return undefined;

    let cancelled = false;
    const shouldShowLoading = sessions.length === 0;

    const loadSessions = async () => {
      if (shouldShowLoading) {
        setIsLoading(true);
      }
      try {
        const sessionsQ = query(
          collection(firestore, "sessions"),
          where("schoolId", "==", schoolId)
        );
        const snapshot = await instrumentFirestoreRead(getDocs(sessionsQ), {
          screen: "SessionContext",
          action: "sessions_fetch",
          target: `sessions:${schoolId}`,
        });
        if (cancelled) return;
        const nextSessions = snapshot.docs
          .map((item) => {
            const data = item.data();
            return {
              id: item.id,
              ...data,
              sessionId: data?.sessionId || item.id,
            };
          })
          .sort((a, b) => toMillis(b?.createdAt) - toMillis(a?.createdAt));
        setSessions(nextSessions);
      } catch (error) {
        console.error("Error loading sessions:", error);
        if (!cancelled) {
          setSessions([]);
        }
      } finally {
        if (!cancelled && shouldShowLoading) {
          setIsLoading(false);
        }
      }
    };

    loadSessions();

    return () => {
      cancelled = true;
    };
  }, [schoolId, activeSessionId, sessions.length]);

  useEffect(() => {
    if (!schoolId) return undefined;

    const settingsRef = doc(firestore, "settings", schoolId);

    const unsubSettings = onSnapshot(
      settingsRef,
      (snapshot) => {
        recordFirestoreRead({
          screen: "SessionContext",
          action: "settings_snapshot",
          target: `settings/${schoolId}`,
          count: snapshot.exists() ? 1 : 0,
        });
        const settings = snapshot.exists() ? snapshot.data() : {};
        const nextActiveSessionId = String(settings?.activeSessionId || "").trim() || null;
        const nextActiveTermId = toTermAlias(settings?.activeTermId) || "term1";
        setActiveSessionId(nextActiveSessionId);
        setActiveTermId(nextActiveTermId);
      },
      (error) => {
        console.error("Error listening to settings:", error);
      }
    );

    return () => {
      unsubSettings();
    };
  }, [schoolId]);

  useEffect(() => {
    if (!sessions.length) {
      setSelectedSessionId(null);
      setSelectionReadyKey("");
      return;
    }

    if (selectedSessionId && sessions.some((item) => item.sessionId === selectedSessionId)) {
      return;
    }

    if (activeSessionId && sessions.some((item) => item.sessionId === activeSessionId)) {
      setSelectedSessionId(activeSessionId);
      return;
    }

    const storageKey = `${SESSION_STORAGE_KEY_PREFIX}${schoolId}`;
    const storedSelectedId =
      sessionStorage.getItem(storageKey) || localStorage.getItem(CURRENT_SESSION_ID_KEY);
    if (storedSelectedId && sessions.some((item) => item.sessionId === storedSelectedId)) {
      setSelectedSessionId(storedSelectedId);
      return;
    }

    const flagged = sessions.find((item) => !!item?.isActive);
    setSelectedSessionId(flagged?.sessionId || sessions[0]?.sessionId || null);
  }, [schoolId, sessions, selectedSessionId, activeSessionId]);

  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      const flagged = sessions.find((item) => !!item?.isActive);
      if (flagged?.sessionId) {
        setActiveSessionId(flagged.sessionId);
      }
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    const previousActiveSessionId = previousActiveSessionRef.current;
    if (!activeSessionId) {
      previousActiveSessionRef.current = null;
      return;
    }

    if (!previousActiveSessionId) {
      previousActiveSessionRef.current = activeSessionId;
      return;
    }

    if (
      previousActiveSessionId !== activeSessionId &&
      selectedSessionId &&
      String(selectedSessionId) === String(previousActiveSessionId)
    ) {
      setSelectedSessionId(activeSessionId);
    }

    previousActiveSessionRef.current = activeSessionId;
  }, [activeSessionId, selectedSessionId]);

  useEffect(() => {
    if (!schoolId || !selectedSessionId) return;
    const storageKey = `${SESSION_STORAGE_KEY_PREFIX}${schoolId}`;
    sessionStorage.setItem(storageKey, selectedSessionId);
    localStorage.setItem(CURRENT_SESSION_ID_KEY, selectedSessionId);
  }, [schoolId, selectedSessionId]);

  useEffect(() => {
    const resolvedSessionId = selectedSessionId || activeSessionId || null;
    if (!schoolId || !resolvedSessionId) {
      setSelectedSessionTerms(buildDisplayedTerms([], activeTermId || "term1"));
      setSelectedSessionActiveTermId(activeTermId || "term1");
      return undefined;
    }

    const fallbackActiveAlias =
      resolvedSessionId === activeSessionId ? activeTermId || "term1" : "term1";
    let cancelled = false;

    const loadTerms = async () => {
      try {
        const termsQ = query(
          collection(firestore, "terms"),
          where("schoolId", "==", schoolId),
          where("sessionId", "==", resolvedSessionId)
        );
        const snapshot = await instrumentFirestoreRead(getDocs(termsQ), {
          screen: "SessionContext",
          action: "terms_fetch",
          target: `terms:${resolvedSessionId}`,
        });
        if (cancelled) return;
        const rawTerms = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => {
            const orderDelta = Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0);
            if (orderDelta !== 0) return orderDelta;
            return toMillis(a?.createdAt) - toMillis(b?.createdAt);
          });
        const nextTerms = buildDisplayedTerms(rawTerms, fallbackActiveAlias);
        const nextActiveAlias =
          nextTerms.find((item) => item?.isCurrent)?.alias || fallbackActiveAlias || "term1";
        setSelectedSessionTerms(nextTerms);
        setSelectedSessionActiveTermId(nextActiveAlias);
      } catch (error) {
        console.error("Error loading terms:", error);
        if (cancelled) return;
        const fallbackTerms = buildDisplayedTerms([], fallbackActiveAlias);
        setSelectedSessionTerms(fallbackTerms);
        setSelectedSessionActiveTermId(fallbackActiveAlias || "term1");
      }
    };

    loadTerms();

    return () => {
      cancelled = true;
    };
  }, [schoolId, selectedSessionId, activeSessionId, activeTermId]);

  useEffect(() => {
    if (!schoolId || !selectedSessionId) return;

    const fallbackTerm = selectedSessionActiveTermId || "term1";
    const markSelectionReady = (termAlias) => {
      const resolvedTermAlias = toTermAlias(termAlias) || fallbackTerm || "term1";
      setSelectionReadyKey(`${schoolId}::${selectedSessionId}::${resolvedTermAlias}`);
    };
    const storageKey = `${TERM_STORAGE_KEY_PREFIX}${schoolId}_${selectedSessionId}`;
    const storedTerm = toTermAlias(sessionStorage.getItem(storageKey));
    const localTerm = toTermAlias(localStorage.getItem(CURRENT_TERM_ID_KEY));
    const sessionChanged = lastSelectedSessionRef.current !== selectedSessionId;
    const isSelectableStoredTerm = (termAlias) => {
      if (!termAlias) return false;
      const termRecord = selectedSessionTerms.find((item) => item.alias === termAlias);
      return !!termRecord && !termRecord.isFuture;
    };

    if (sessionChanged) {
      if (!!activeSessionId && String(selectedSessionId) === String(activeSessionId)) {
        const nextTerm = fallbackTerm || "term1";
        setSelectedTermId(nextTerm);
        lastSelectedSessionRef.current = selectedSessionId;
        previousSelectedSessionActiveTermRef.current = fallbackTerm;
        markSelectionReady(nextTerm);
        return;
      }

      const preferredStoredTerm =
        isSelectableStoredTerm(storedTerm)
          ? storedTerm
          : isSelectableStoredTerm(localTerm)
            ? localTerm
            : fallbackTerm;
      const nextTerm = preferredStoredTerm || "term1";
      setSelectedTermId(nextTerm);
      lastSelectedSessionRef.current = selectedSessionId;
      previousSelectedSessionActiveTermRef.current = fallbackTerm;
      markSelectionReady(nextTerm);
      return;
    }

    if (!selectedSessionTerms.some((item) => item.alias === selectedTermId)) {
      const nextTerm = fallbackTerm || "term1";
      setSelectedTermId(nextTerm);
      markSelectionReady(nextTerm);
      return;
    }

    markSelectionReady(selectedTermId || fallbackTerm || "term1");
  }, [
    schoolId,
    selectedSessionId,
    selectedTermId,
    selectedSessionTerms,
    selectedSessionActiveTermId,
    activeSessionId,
  ]);

  useEffect(() => {
    const previousActiveTerm = previousSelectedSessionActiveTermRef.current || "term1";
    const nextActiveTerm = selectedSessionActiveTermId || "term1";
    const isViewingActiveSession =
      !!selectedSessionId &&
      !!activeSessionId &&
      String(selectedSessionId) === String(activeSessionId);

    if (
      isViewingActiveSession &&
      selectedTermId === previousActiveTerm &&
      nextActiveTerm !== previousActiveTerm
    ) {
      setSelectedTermId(nextActiveTerm);
      if (schoolId && selectedSessionId) {
        setSelectionReadyKey(`${schoolId}::${selectedSessionId}::${nextActiveTerm}`);
      }
    }

    previousSelectedSessionActiveTermRef.current = nextActiveTerm;
  }, [selectedSessionActiveTermId, selectedSessionId, activeSessionId, selectedTermId, schoolId]);

  useEffect(() => {
    if (!schoolId || !selectedSessionId || !selectedTermId) return;
    const storageKey = `${TERM_STORAGE_KEY_PREFIX}${schoolId}_${selectedSessionId}`;
    sessionStorage.setItem(storageKey, selectedTermId);
    localStorage.setItem(CURRENT_TERM_ID_KEY, selectedTermId);
  }, [schoolId, selectedSessionId, selectedTermId]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.sessionId === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );
  const selectedTerm = useMemo(
    () => selectedSessionTerms.find((term) => term.alias === selectedTermId) || null,
    [selectedSessionTerms, selectedTermId]
  );
  const activeTermForSelectedSession = useMemo(
    () =>
      selectedSessionTerms.find((term) => term.alias === selectedSessionActiveTermId) || null,
    [selectedSessionTerms, selectedSessionActiveTermId]
  );
  const isSelectedSessionActive =
    !!selectedSessionId && !!activeSessionId && selectedSessionId === activeSessionId;
  const isPastTermView =
    isSelectedSessionActive &&
    !!selectedTerm &&
    !!activeTermForSelectedSession &&
    Number(selectedTerm?.sortOrder || 0) < Number(activeTermForSelectedSession?.sortOrder || 0);
  const isReadOnlyView =
    !isSelectedSessionActive ||
    (!!selectedTermId && selectedTermId !== (selectedSessionActiveTermId || "term1"));
  const isSelectionReady =
    !!schoolId &&
    !!selectedSessionId &&
    !!selectedTermId &&
    selectionReadyKey === `${schoolId}::${selectedSessionId}::${selectedTermId}`;

  const selectSession = useCallback((sessionId) => {
    setSelectedSessionId(sessionId || null);
  }, []);

  const selectTerm = useCallback((termId) => {
    const normalizedTermId = toTermAlias(termId) || "term1";
    const targetTerm =
      selectedSessionTerms.find((term) => term.alias === normalizedTermId) || null;
    if (!targetTerm || targetTerm.isFuture) {
      setSelectedTermId(selectedSessionActiveTermId || "term1");
      return;
    }
    setSelectedTermId(normalizedTermId);
  }, [selectedSessionTerms, selectedSessionActiveTermId]);

  const value = useMemo(
    () => ({
      schoolId,
      sessions,
      activeSessionId,
      activeTermId,
      selectedSessionId,
      selectedTermId,
      selectedSessionTerms,
      selectedSessionActiveTermId,
      selectedSession,
      selectedSessionName: selectedSession?.name || "",
      selectedTerm,
      selectedTermName:
        selectedTermId === "term1"
          ? "First Term"
          : selectedTermId === "term2"
            ? "Second Term"
            : selectedTermId === "term3"
              ? "Third Term"
              : selectedTermId,
      isHistoricalView:
        !!selectedSessionId && !!activeSessionId && selectedSessionId !== activeSessionId,
      isReadOnlyView,
      isPastTermView,
      isSelectionReady,
      isLoading,
      selectSession,
      selectTerm,
    }),
    [
      schoolId,
      sessions,
      activeSessionId,
      activeTermId,
      selectedSessionId,
      selectedTermId,
      selectedSessionTerms,
      selectedSessionActiveTermId,
      selectedSession,
      selectedTerm,
      isReadOnlyView,
      isPastTermView,
      isSelectionReady,
      isLoading,
      selectSession,
      selectTerm,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSessionContext = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSessionContext must be used within SessionProvider");
  }
  return context;
};
