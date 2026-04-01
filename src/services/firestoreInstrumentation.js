const STORAGE_FLAG_KEY = "scoorla_firestore_debug";
const DEBUG_EVENT_NAME = "scoorla-firestore-debug-update";
const ENV_FLAG = String(import.meta?.env?.VITE_FIRESTORE_DEBUG || "").trim();
const ENV_ENABLED =
  ENV_FLAG === "1" || ENV_FLAG.toLowerCase() === "true";

const MAX_OPERATION_LOGS = 120;

const metricsState = {
  enabled: false,
  reads: 0,
  writes: 0,
  operations: [],
};

const isBrowser = typeof window !== "undefined";

const normalizeText = (value, fallback = "") => {
  const token = String(value || "").trim();
  return token || fallback;
};

const inferReadCount = (result) => {
  if (!result) return 0;
  if (typeof result?.size === "number") return Number(result.size) || 0;
  if (typeof result?.exists === "function") return result.exists() ? 1 : 0;
  return 1;
};

const emitUpdate = () => {
  if (!isBrowser) return;
  window.dispatchEvent(
    new CustomEvent(DEBUG_EVENT_NAME, {
      detail: getFirestoreMetricsSnapshot(),
    })
  );
};

const pushOperation = (operation) => {
  metricsState.operations.unshift(operation);
  if (metricsState.operations.length > MAX_OPERATION_LOGS) {
    metricsState.operations = metricsState.operations.slice(0, MAX_OPERATION_LOGS);
  }
};

export const isFirestoreDebugEnabled = () => {
  if (!isBrowser) return ENV_ENABLED;
  const localToken = String(window.localStorage.getItem(STORAGE_FLAG_KEY) || "")
    .trim()
    .toLowerCase();
  return ENV_ENABLED || localToken === "1" || localToken === "true";
};

export const setFirestoreDebugEnabled = (enabled) => {
  if (!isBrowser) return;
  if (enabled) {
    window.localStorage.setItem(STORAGE_FLAG_KEY, "1");
  } else {
    window.localStorage.removeItem(STORAGE_FLAG_KEY);
  }
  metricsState.enabled = isFirestoreDebugEnabled();
  emitUpdate();
};

export const resetFirestoreMetrics = () => {
  metricsState.reads = 0;
  metricsState.writes = 0;
  metricsState.operations = [];
  emitUpdate();
};

export const getFirestoreMetricsSnapshot = () => ({
  enabled: metricsState.enabled,
  reads: metricsState.reads,
  writes: metricsState.writes,
  operations: [...metricsState.operations],
});

export const recordFirestoreRead = ({
  screen = "unknown",
  action = "read",
  count = 0,
  target = "",
} = {}) => {
  if (!metricsState.enabled) return;
  const safeCount = Math.max(0, Number(count) || 0);
  metricsState.reads += safeCount;
  pushOperation({
    type: "read",
    at: Date.now(),
    screen: normalizeText(screen, "unknown"),
    action: normalizeText(action, "read"),
    target: normalizeText(target, "-"),
    count: safeCount,
  });
  emitUpdate();
};

export const recordFirestoreWrite = ({
  screen = "unknown",
  action = "write",
  count = 1,
  target = "",
} = {}) => {
  if (!metricsState.enabled) return;
  const safeCount = Math.max(0, Number(count) || 0);
  metricsState.writes += safeCount;
  pushOperation({
    type: "write",
    at: Date.now(),
    screen: normalizeText(screen, "unknown"),
    action: normalizeText(action, "write"),
    target: normalizeText(target, "-"),
    count: safeCount,
  });
  emitUpdate();
};

export const instrumentFirestoreRead = async (
  promiseOrFactory,
  {
    screen = "unknown",
    action = "read",
    target = "",
    countOverride,
  } = {}
) => {
  const result =
    typeof promiseOrFactory === "function"
      ? await promiseOrFactory()
      : await promiseOrFactory;
  if (metricsState.enabled) {
    const inferredCount =
      countOverride === undefined
        ? inferReadCount(result)
        : Number(countOverride) || 0;
    recordFirestoreRead({
      screen,
      action,
      target,
      count: inferredCount,
    });
  }
  return result;
};

export const instrumentFirestoreWrite = async (
  promiseOrFactory,
  {
    screen = "unknown",
    action = "write",
    target = "",
    count = 1,
  } = {}
) => {
  const result =
    typeof promiseOrFactory === "function"
      ? await promiseOrFactory()
      : await promiseOrFactory;
  if (metricsState.enabled) {
    recordFirestoreWrite({
      screen,
      action,
      target,
      count,
    });
  }
  return result;
};

metricsState.enabled = isFirestoreDebugEnabled();

if (isBrowser) {
  window.__SCOORLA_FIRESTORE_DEBUG__ = {
    enable: () => setFirestoreDebugEnabled(true),
    disable: () => setFirestoreDebugEnabled(false),
    reset: resetFirestoreMetrics,
    snapshot: getFirestoreMetricsSnapshot,
  };
}

export const FIRESTORE_DEBUG_EVENT_NAME = DEBUG_EVENT_NAME;

