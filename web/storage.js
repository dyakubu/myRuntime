// localStorage: theme + LLM A settings (provider/model/key — never sent to our backend,
// only ever attached to requests going straight to the provider's own API).
// IndexedDB: cached /api/verify responses, keyed by SHA-256 of the normalized problem
// text, so re-opening a problem doesn't re-trigger generation or the sandbox self-check.
// See docs/myruntime-v0-spec.md §8.

const LS_KEYS = {
  theme: "myruntime.theme",
  provider: "myruntime.llmA.provider",
  model: "myruntime.llmA.model",
  apiKey: "myruntime.llmA.apiKey",
};

const Settings = {
  getTheme() {
    return localStorage.getItem(LS_KEYS.theme) || "dark";
  },
  setTheme(theme) {
    localStorage.setItem(LS_KEYS.theme, theme);
  },
  getLlmA() {
    return {
      provider: localStorage.getItem(LS_KEYS.provider) || "anthropic",
      model: localStorage.getItem(LS_KEYS.model) || "",
      apiKey: localStorage.getItem(LS_KEYS.apiKey) || "",
    };
  },
  setLlmA({ provider, model, apiKey }) {
    localStorage.setItem(LS_KEYS.provider, provider);
    localStorage.setItem(LS_KEYS.model, model);
    localStorage.setItem(LS_KEYS.apiKey, apiKey);
  },
};

const DB_NAME = "myruntime";
const DB_VERSION = 1;
const STORE = "verified_suites";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "hash" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const Cache = {
  hashOf(normalizedStatement) {
    return sha256Hex(normalizedStatement);
  },
  async get(hash) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(hash);
      req.onsuccess = () => resolve(req.result ? req.result.suite : null);
      req.onerror = () => reject(req.error);
    });
  },
  async set(hash, suite) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ hash, suite, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

window.MyRuntimeStorage = { Settings, Cache };
