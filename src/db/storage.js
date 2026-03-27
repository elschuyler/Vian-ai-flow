// src/db/storage.js
import { openDB } from 'idb';
import { ALL_PROVIDERS } from '../api/index.js'; // Import ALL_PROVIDERS from api/index

const DB_NAME = 'VianAIFlowDB';
const DB_VERSION = 3; // Ensure this matches the documented schema version
const STORES = {
  conversations: 'conversations',
  context_blocks: 'context_blocks',
  projects: 'projects',
  agent_tasks: 'agent_tasks' // Added in v3
};

let db;

// --- Initialize Database ---
async function initDB() {
  if (db) return db;

  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(upgradeDb, oldVersion, newVersion, transaction) {
      console.log(`DB Upgrade: ${oldVersion} -> ${newVersion}`);

      if (oldVersion < 1) {
        // Version 1: Initial setup
        upgradeDb.createObjectStore(STORES.conversations, { keyPath: 'id' });
        upgradeDb.createObjectStore(STORES.context_blocks, { keyPath: 'id' });
        const projectsOS = upgradeDb.createObjectStore(STORES.projects, { keyPath: 'id' });
        // Index for fetching conversations by projectId
        upgradeDb.transaction.objectStore(STORES.conversations).createIndex('projectId', 'projectId', { unique: false });

        // Create initial default project if upgrading from scratch
        if (oldVersion === 0) {
          const projectData = {
            id: 'default_project',
            name: 'Default Project',
            systemPrompt: '',
            repoUrl: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
: null // Will be set later if migrating
          };
          projectsOS.add(projectData);
        }
      }

      if (oldVersion < 2) {
        // Version 2: Add projects store (if not already added in v1 upgrade path)
        // Note: This block handles upgrades from v1 specifically.
        if (!upgradeDb.objectStoreNames.contains(STORES.projects)) {
          const projectsOS = upgradeDb.createObjectStore(STORES.projects, { keyPath: 'id' });
          // Attempt to migrate orphaned conversations if any exist without projectId
          // This logic runs *during* the upgrade transaction
          const tx = upgradeDb.transaction;
          const convStore = tx.objectStore(STORES.conversations);
          const projectData = {
            id: 'default_project',
            name: 'Default Project',
            systemPrompt: '',
            repoUrl: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastConvId: null
          };
          projectsOS.add(projectData);

          // Iterate and update conversations without projectId
          const request = convStore.getAll();
          request.onsuccess = function(event) {
            const conversations = event.target.result;
            conversations.forEach(conv => {
              if (!conv.projectId) {
                conv.projectId = 'default_project';
                convStore.put(conv);
              }
            });
          };
        } else {
           // If projects store exists, just add the index if missing (handles potential inconsistencies)
           const convStore = upgradeDb.transaction.objectStore(STORES.conversations);
           if (!convStore.indexNames.contains('projectId')) {
             convStore.createIndex('projectId', 'projectId', { unique: false });
           }
        }
      }

      if (oldVersion < 3) {
        // Version 3: Add agent_tasks store
        upgradeDb.createObjectStore(STORES.agent_tasks, { keyPath: 'id' });
        // Add indexes for agent_tasks
        const agentTasksStore = upgradeDb.transaction.objectStore(STORES.agent_tasks);
        agentTasksStore.createIndex('projectId', 'projectId', { unique: false });
        agentTasksStore.createIndex('createdAt', 'createdAt', { unique: false });
        agentTasksStore.createIndex('status', 'status', { unique: false }); // e.g., 'pending', 'running', 'done', 'error'
      }
      // Future versions can be added here
    },
    blocked() {
      console.warn('DB connection blocked. Is the database open in another tab?');
    },
    blocking() {
      console.warn('Another connection is blocking this upgrade.');
    },
    terminated() {
      console.warn('Database connection unexpectedly closed.');
    }
  });

  return db;
}

// --- Key Management ---
const KEY_STORAGE_PREFIX = 'vian_keys_'; // Use plural for consistency with internal representation

/**
 * Retrieves an array of API keys for a specific provider.
 * Handles legacy single-key storage format.
 * @param {string} provider - The provider name (e.g., 'openai', 'anthropic').
 * @returns {Array<string>} - An array of keys, potentially empty.
 */
async function getKeys(provider) {
  if (!ALL_PROVIDERS.includes(provider)) {
    console.warn(`Warning: Unknown provider '${provider}' requested for keys.`);
    return [];
  }

  const legacyKey = localStorage.getItem(`vian_key_${provider}`); // e.g., vian_key_openai
  const keysJson = localStorage.getItem(`${KEY_STORAGE_PREFIX}${provider}`); // e.g., vian_keys_openai

  if (keysJson) {
    try {
      const parsed = JSON.parse(keysJson);
      if (Array.isArray(parsed)) {
        // Migration happened previously or new format is used
        return parsed;
      } else {
         console.warn(`Stored keys for ${provider} are not an array, returning empty array.`);
         return []; // Return empty if format is wrong
      }
    } catch (e) {
      console.error(`Error parsing keys for ${provider}:`, e);
      return []; // Return empty on parse error
    }
  } else if (legacyKey) {
    // Migration needed: convert single key to array format
    console.log(`M for ${provider}`);
    const newKeysArray = [legacyKey];
    localStorage.setItem(`${KEY_STORAGE_PREFIX}${provider}`, JSON.stringify(newKeysArray));
    localStorage.removeItem(`vian_key_${provider}`); // Remove old key
    return newKeysArray;
  }

  // No keys found
  return [];
}

/**
 * Stores an array of API keys for a specific provider.
 * @param {string} provider - The provider name.
 * @param {Array<string>} keys - The array of keys to store.
 */
async function setKeys(provider, keys) {
  if (!ALL_PROVIDERS.includes(provider)) {
    console.warn(`Warning: Unknown provider '${provider}' for key storage.`);
    return;
  }

  if (!Array.isArray(keys)) {
     console.error("setKeys requires an array of keys.");
     return;
  }

  // Validate keys (basic check for emptiness)
  const validKeys = keys.filter(k => typeof k === 'string' && k.trim() !== '');
  if (validKeys.length !== keys.length) {
    console.warn("Some keys were invalid (empty or non-string) and were removed.");
  }

  try {
    localStorage.setItem(`${KEY_STORAGE_PREFIX}${provider}`, JSON.stringify(validKeys));
  } catch (e) {
    console.error(`Failed to store keys for ${provider}:`, e);
    // Potentially show a user-facing error about storage quota
  }
}

/**
 * Convenience function to get the first key for a provider (for backwards compatibility).
 * @param {string} provider - The provider name.
 * @returns {string} - The first key in the array, or an empty string if none exist.
 */
async function getKey(provider) {
  const keys = await getKeys(provider);
  return keys[0] || '';
}

// --- Conversation Management ---
async function saveConversation(conversation) {
  const db = await initDB();
  const tx = db.transaction(STORES.conversations, 'readwrite');
  await tx.store.put(conversation);
  await tx.done;
}

async function loadConversation(id) {
  const db = await initDB();
  return await db.get(STORES.conversations, id);
}

async function deleteConversation(id) {
  const db = await initDB();
  const tx = db.transaction(STORES.conversations, 'readwrite');
  await tx.store.delete(id);
  await tx.done;
}

async function getConversationsByProject(projectId) {
  const db = await initDB();
  const tx = db.transaction(STORES.conversations, 'readonly');
  const index = tx.store.index('projectId');
  return await index.getAll(IDBKeyRange.only(projectId));
}

// --- Project Management ---
// Project CRUD functions
async function createProject(name, systemPrompt = '', repoUrl = '') {
  const db = await initDB();
  const project = {
    id: `proj_${Date.now()}`, // Simple ID generation
    name,
    systemPrompt,
    repoUrl,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastConvId: null // Initially no conversation loaded
  };
  await db.put(STORES.projects, project);
  return project;
}

async function loadProject(id) {
  const db = await initDB();
  return await db.get(STORES.projects, id);
}

async function updateProject(project) {
  const db = await initDB();
  project.updatedAt = Date.now();
  await db.put(STORES.projects, project);
}

async function deleteProject(id) {
  const db = await initDB();
  // Load the project to get associated conversations
  const project = await loadProject(id);
  if (project) {
    // Delete all conversations belonging to this project
    const conversationsToDelete = await getConversationsByProject(id);
    const tx = db.transaction(STORES.conversations, 'readwrite');
    for (const conv of conversationsToDelete) {
      await tx.store.delete(conv.id);
    }
    await tx.done;

    // Delete the project itself
    await db.delete(STORES.projects, id);
  }
}

async function listProjects() {
  const db = await initDB();
  return await db.getAll(STORES.projects);
}

async function getProjectCount() {
  const db = await initDB();
  return await db.count(STORES.projects);
}

// --- Context Block Management ---
async function saveContextBlock(block) {
  const db = await initDB();
  const tx = db.transaction(STORES.context_blocks, 'readwrite');
  await tx.store.put(block);
  await tx.done;
}

async function loadContextBlock(id) {
  const db = await initDB();
  return await db.get(STORES.context_blocks, id);
}

async function deleteContextBlock(id) {
  const db = await initDB();
  const tx = db.transaction(STORES.context_blocks, 'readwrite');
  await tx.store.delete(id);
  await tx.done;
}

async function listContextBlocks() {
  const db = await initDB();
  return await db.getAll(STORES.context_blocks);
}

// --- Agent Task Management (Added in v3) ---
async function createAgentTask(task) {
  const db = await initDB();
  const defaultTask = {
    id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // Simple ID generation
    projectId: currentProjectId, // Associate with current project
    type: 'soldier', // Default or passed in
    status: 'pending', // 'pending', 'running', 'done', 'error'
    goal: '',
    provider: '',
    model: '',
    maxSteps: 10,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null
  };
  const finalTask = { ...defaultTask, ...task };
  await db.put(STORES.agent_tasks, finalTask);
  return finalTask;
}

async function updateAgentTask(id, updates) {
  const db = await initDB();
  const task = await db.get(STORES.agent_tasks, id);
  if (task) {
    Object.assign(task, updates);
    if (updates.status === 'running' && !task.startedAt) {
      task.startedAt = Date.now();
    }
    if (['done', 'error', 'stopped'].includes(updates.status) && !task.finishedAt) {
      task.finishedAt = Date.now();
    }
    await db.put(STORES.agent_tasks, task);
  }
}

async function getAgentTask(id) {
  const db = await initDB();
  return await db.get(STORES.agent_tasks, id);
}

async function getAgentTasksByProject(projectId) {
  const db = await initDB();
  const tx = db.transaction(STORES.agent_tasks, 'readonly');
  const index = tx.store.index('projectId');
  return await index.getAll(IDBKeyRange.only(projectId));
}

// --- Mercenary Credential Helpers (Scaffold) ---
// Note: Storing credentials in plain text in localStorage is temporary.
// Encryption planned for Phase 17.
const MERCENARY_GITHUB_CREDENTIAL_KEY = 'vian_mercenary_github';
const MERCENARY_CLOUDFLARE_CREDENTIAL_KEY = 'vian_mercenary_cloudflare';

async function getMercenaryCredential(type) {
  if (type === 'github') {
    const stored = localStorage.getItem(MERCENARY_GITHUB_CREDENTIAL_KEY);
    return stored ? JSON.parse(stored) : { pat: '', repo: '' };
  } else if (type === 'cloudflare') {
    const stored = localStorage.getItem(MERCENARY_CLOUDFLARE_CREDENTIAL_KEY);
    return stored ? JSON.parse(stored) : { url: '', token: '' };
  }
  return null;
}

async function setMercenaryCredential(type, credential) {
  if (type === 'github') {
    localStorage.setItem(MERCENARY_GITHUB_CREDENTIAL_KEY, JSON.stringify(credential));
  } else if (type === 'cloudflare') {
    localStorage.setItem(MERCENARY_CLOUDFLARE_CREDENTIAL_KEY, JSON.stringify(credential));
  }
}

// --- Exports ---
export {
  initDB,
  getKeys,
  setKeys,
  getKey,
  saveConversation,
  loadConversation,
  deleteConversation,
  getConversationsByProject,
  createProject,
  loadProject,
  updateProject,
  deleteProject,
  listProjects,
  getProjectCount,
  saveContextBlock,
  loadContextBlock,
  deleteContextBlock,
  listContextBlocks,
  createAgentTask,
  updateAgentTask,
  getAgentTask,
  getAgentTasksByProject,
  getMercenaryCredential,
  setMercenaryCredential,
  ALL_PROVIDERS // Re-export from api/index.js for components that might need it
};
