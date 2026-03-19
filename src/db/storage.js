// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — Storage Layer
// IndexedDB : conversations, context blocks
// localStorage : API keys, settings
// ═══════════════════════════════════════════

const DB_NAME    = 'vian-ai-flow';
const DB_VERSION = 1;

let db = null;

export async function initDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('conversations')) {
        const s = d.createObjectStore('conversations', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!d.objectStoreNames.contains('context_blocks')) {
        d.createObjectStore('context_blocks', { keyPath: 'id' });
      }
    };

    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror   = ()  => reject(req.error);
  });
}

function store(name, mode = 'readonly') {
  return db.transaction(name, mode).objectStore(name);
}

// ─── Conversations ────────────────────────────────

export async function saveConversation(conv) {
  return new Promise((resolve, reject) => {
    const req = store('conversations', 'readwrite').put(conv);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

export async function getAllConversations() {
  return new Promise((resolve, reject) => {
    const req = store('conversations').index('updatedAt').getAll();
    req.onsuccess = () => resolve((req.result || []).reverse());
    req.onerror   = () => reject(req.error);
  });
}

export async function getConversation(id) {
  return new Promise((resolve, reject) => {
    const req = store('conversations').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function deleteConversation(id) {
  return new Promise((resolve, reject) => {
    const req = store('conversations', 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ─── Context Blocks ───────────────────────────────

export async function saveContextBlock(block) {
  return new Promise((resolve, reject) => {
    const req = store('context_blocks', 'readwrite').put(block);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

export async function getAllContextBlocks() {
  return new Promise((resolve, reject) => {
    const req = store('context_blocks').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

export async function deleteContextBlock(id) {
  return new Promise((resolve, reject) => {
    const req = store('context_blocks', 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ─── localStorage helpers ─────────────────────────

export function getSetting(key, fallback = null) {
  try {
    const v = localStorage.getItem(`vian_${key}`);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function setSetting(key, value) {
  localStorage.setItem(`vian_${key}`, JSON.stringify(value));
}

// ─── Multi-key API key storage ────────────────────
//
// Keys are stored as a JSON array under vian_keys_{provider}.
// On first read we migrate the old single-key format
// (vian_key_{provider}) automatically so no keys are lost.

export function getKeys(provider) {
  try {
    // Try new array format first
    const raw = localStorage.getItem(`vian_keys_${provider}`);
    if (raw !== null) return JSON.parse(raw);

    // Migrate old single-key format if present
    const legacy = localStorage.getItem(`vian_key_${provider}`);
    if (legacy) {
      const arr = [legacy];
      localStorage.setItem(`vian_keys_${provider}`, JSON.stringify(arr));
      localStorage.removeItem(`vian_key_${provider}`);
      return arr;
    }

    return [];
  } catch {
    return [];
  }
}

export function setKeys(provider, arr) {
  try {
    localStorage.setItem(`vian_keys_${provider}`, JSON.stringify(arr));
    // Remove legacy key if it somehow still exists
    localStorage.removeItem(`vian_key_${provider}`);
  } catch {}
}

// Compatibility shim — everything that calls getKey() keeps working
export function getKey(provider) {
  return getKeys(provider)[0] || '';
}

// Legacy setKey kept so nothing else breaks
export function setKey(provider, value) {
  const arr = getKeys(provider);
  if (value) {
    if (!arr.includes(value)) arr.unshift(value);
    setKeys(provider, arr);
  } else {
    setKeys(provider, []);
  }
}

// ─── ID generator ─────────────────────────────────

export function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
