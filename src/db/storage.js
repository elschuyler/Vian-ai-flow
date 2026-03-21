// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — Storage Layer
// IndexedDB : conversations, context blocks, projects, agent_tasks
// localStorage : API keys, settings, mercenary credentials
// ═══════════════════════════════════════════

const DB_NAME    = 'vian-ai-flow';
const DB_VERSION = 3; // v3 adds agent_tasks store

let db = null;

export async function initDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const d      = e.target.result;
      const oldVer = e.oldVersion;

      // ── v1 stores ──────────────────────────────────────────
      if (!d.objectStoreNames.contains('conversations')) {
        const s = d.createObjectStore('conversations', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
        s.createIndex('projectId', 'projectId', { unique: false });
      } else if (oldVer < 2) {
        const tx = e.target.transaction;
        const cs = tx.objectStore('conversations');
        if (!cs.indexNames.contains('projectId')) {
          cs.createIndex('projectId', 'projectId', { unique: false });
        }
      }

      if (!d.objectStoreNames.contains('context_blocks')) {
        d.createObjectStore('context_blocks', { keyPath: 'id' });
      }

      // ── v2 stores ──────────────────────────────────────────
      if (!d.objectStoreNames.contains('projects')) {
        d.createObjectStore('projects', { keyPath: 'id' });
      }

      // ── v3 stores ──────────────────────────────────────────
      if (!d.objectStoreNames.contains('agent_tasks')) {
        const at = d.createObjectStore('agent_tasks', { keyPath: 'id' });
        at.createIndex('projectId',  'projectId',  { unique: false });
        at.createIndex('createdAt',  'createdAt',  { unique: false });
        at.createIndex('status',     'status',     { unique: false });
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

export async function getConversationsByProject(projectId) {
  return new Promise((resolve, reject) => {
    const req = store('conversations').index('projectId').getAll(projectId);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.updatedAt - a.updatedAt));
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

export async function migrateConversationsToProject(projectId) {
  return new Promise((resolve, reject) => {
    const tx       = db.transaction('conversations', 'readwrite');
    const objStore = tx.objectStore('conversations');
    const req      = objStore.getAll();
    req.onsuccess  = () => {
      const orphans = (req.result || []).filter(c => !c.projectId);
      if (!orphans.length) { resolve(); return; }
      let pending = orphans.length;
      orphans.forEach(conv => {
        conv.projectId = projectId;
        const put = objStore.put(conv);
        put.onsuccess = () => { if (--pending === 0) resolve(); };
        put.onerror   = () => reject(put.error);
      });
    };
    req.onerror = () => reject(req.error);
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

// ─── Projects ─────────────────────────────────────

export async function saveProject(project) {
  return new Promise((resolve, reject) => {
    const req = store('projects', 'readwrite').put(project);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

export async function getAllProjects() {
  return new Promise((resolve, reject) => {
    const req = store('projects').getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.createdAt - b.createdAt));
    req.onerror   = () => reject(req.error);
  });
}

export async function getProject(id) {
  return new Promise((resolve, reject) => {
    const req = store('projects').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function deleteProject(id) {
  return new Promise((resolve, reject) => {
    const req = store('projects', 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ─── Agent Tasks ──────────────────────────────────
//
// task shape:
// {
//   id, projectId, convId,
//   type: 'soldier' | 'mercenary',
//   goal,
//   status: 'running' | 'done' | 'stopped' | 'error' | 'limit',
//   steps: [ { role, content, ts } ],
//   stepCount, stepLimit,
//   createdAt, updatedAt,
// }

export async function saveAgentTask(task) {
  return new Promise((resolve, reject) => {
    const req = store('agent_tasks', 'readwrite').put(task);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

export async function getAgentTask(id) {
  return new Promise((resolve, reject) => {
    const req = store('agent_tasks').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function getAgentTasksByProject(projectId) {
  return new Promise((resolve, reject) => {
    const req = store('agent_tasks').index('projectId').getAll(projectId);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.createdAt - a.createdAt));
    req.onerror   = () => reject(req.error);
  });
}

export async function deleteAgentTask(id) {
  return new Promise((resolve, reject) => {
    const req = store('agent_tasks', 'readwrite').delete(id);
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

// ─── Provider registry ────────────────────────────

export const ALL_PROVIDERS = [
  'anthropic', 'openai', 'google', 'deepseek',
  'openrouter', 'groq', 'ollama',
];

export const PROVIDER_LABELS = {
  anthropic:  'Anthropic',
  openai:     'OpenAI',
  google:     'Google',
  deepseek:   'DeepSeek',
  openrouter: 'OpenRouter',
  groq:       'Groq',
  ollama:     'Ollama (local)',
};

// ─── Multi-key API key storage ────────────────────

export function getKeys(provider) {
  try {
    const raw = localStorage.getItem(`vian_keys_${provider}`);
    if (raw !== null) return JSON.parse(raw);
    const legacy = localStorage.getItem(`vian_key_${provider}`);
    if (legacy) {
      const arr = [legacy];
      localStorage.setItem(`vian_keys_${provider}`, JSON.stringify(arr));
      localStorage.removeItem(`vian_key_${provider}`);
      return arr;
    }
    return [];
  } catch { return []; }
}

export function setKeys(provider, arr) {
  try {
    localStorage.setItem(`vian_keys_${provider}`, JSON.stringify(arr));
    localStorage.removeItem(`vian_key_${provider}`);
  } catch {}
}

export function getKey(provider) {
  return getKeys(provider)[0] || '';
}

export function setKey(provider, value) {
  const arr = getKeys(provider);
  if (value) {
    if (!arr.includes(value)) arr.unshift(value);
    setKeys(provider, arr);
  } else {
    setKeys(provider, []);
  }
}

// ─── Mercenary credentials ────────────────────────
//
// Stored in plain localStorage for now.
// Will be encrypted with Web Crypto AES-GCM when Mercenary is wired up.
//
// GitHub: { pat, repo }
// Cloudflare: { workerUrl, apiToken }

export function getMercenaryCredential(type) {
  // type: 'github' | 'cloudflare'
  try {
    const raw = localStorage.getItem(`vian_mercenary_${type}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setMercenaryCredential(type, value) {
  try {
    if (value) {
      localStorage.setItem(`vian_mercenary_${type}`, JSON.stringify(value));
    } else {
      localStorage.removeItem(`vian_mercenary_${type}`);
    }
  } catch {}
}

export function clearMercenaryCredential(type) {
  try { localStorage.removeItem(`vian_mercenary_${type}`); } catch {}
}

// ─── ID generator ─────────────────────────────────

export function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
