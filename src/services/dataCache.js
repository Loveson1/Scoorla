const cacheStore = new Map();

const now = () => Date.now();

const normalizeTtl = (ttlMs) => {
  const ttl = Number(ttlMs);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : 0;
};

export const getCachedValue = (key) => {
  const token = String(key || "").trim();
  if (!token) return null;
  const entry = cacheStore.get(token);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= now()) {
    cacheStore.delete(token);
    return null;
  }
  return entry.value;
};

export const setCachedValue = (key, value, ttlMs = 30_000) => {
  const token = String(key || "").trim();
  if (!token) return;
  const ttl = normalizeTtl(ttlMs);
  cacheStore.set(token, {
    value,
    expiresAt: ttl > 0 ? now() + ttl : 0,
  });
};

export const removeCachedValue = (key) => {
  const token = String(key || "").trim();
  if (!token) return;
  cacheStore.delete(token);
};

export const invalidateCachePrefix = (prefix) => {
  const token = String(prefix || "").trim();
  if (!token) return;
  for (const key of cacheStore.keys()) {
    if (key.startsWith(token)) {
      cacheStore.delete(key);
    }
  }
};

export const clearDataCache = () => {
  cacheStore.clear();
};

