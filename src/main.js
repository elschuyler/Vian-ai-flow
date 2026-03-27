// src/main.js
import { initDB, getKeys, setKeys, getKey, saveConversation, loadConversation, deleteConversation, getConversationsByProject, createProject, loadProject, updateProject, deleteProject, listProjects, getProjectCount, saveContextBlock, loadContextBlock, deleteContextBlock, listContextBlocks, createAgentTask, updateAgentTask, getAgentTask, getAgentTasksByProject, getMercenaryCredential, setMercenaryCredential, ALL_PROVIDERS } from './db/storage.js';
import { callMessage, detectProviderFromKey, inferProvider, PROVIDER_LABELS, PROVIDER_MODELS } from './api/index.js';
import { stripBlocks } from './utils/blocks.js'; // Assume this utility exists or adapt
import { fetchFileLines, fetchRepoIndex } from './utils/repo-mirror.js';
import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';

// --- State Variables ---
let currentProjectId = null;
let currentConversationId = null;
let currentConversation = { id: '', title: 'New Chat', messages: [], projectId: null, createdAt: Date.now(), updatedAt: Date.now() };
let isAgentRunning = false; // Track overall agent status for UI disablement
let activeAgents = new Set(); // Track individual agent IDs (e.g., soldier-worker-123)
let showApiKeyModal = false;
let showProviderPickerForUnknownKey = false; // NEW STATE: Show provider picker for unknown key
let unknownKeyInputValue = ''; // Store the value causing the picker to appear
let selectedProviderForUnknownKey = ''; // Store the selected provider from the picker
let showProjectsModal = false;
let showContextModal = false;
let isAgentMode = false; // Toggle for agent-specific UI/logic
let isPreviewMode = false; // Toggle for preview-specific UI/logic
let agentWorker = null; // Global reference for the active agent worker (if single allowed)
let activeAgentWorkers = new Map(); // Map to store worker references by agentId (for multi-agent)
let agentConfirmBannerVisible = false; // Flag for showing confirm banner
let agentConfirmAction = null; // Store the action to confirm
let agentConfirmDesc = null; // Store the description of the action
let isMultiAgentEnabled = false; // Setting for allowing multiple agents
let agentLogStyle = 'panel'; // 'panel' or 'inline'
let agentMaxSteps = 10; // Default max steps for agents
let agentStopRequested = false; // Global flag to signal agent stop
let showAgentSettings = false; // Flag for agent settings modal
let showApiManagerInSidebar = false; // Flag to show/hide API manager in sidebar
let showProjectsInSidebar = false; // Flag to show/hide projects in sidebar
let showContextInSidebar = false; // Flag to show/hide context in sidebar
let showToolsInSidebar = false; // Flag to show/hide tools in sidebar
let agentStatusTrayVisible = true; // Toggle for showing/hiding the tray (default true)
// Status objects for different agent types
let soldierStatus = { active: false, currentStep: null, workerId: null }; // Example status for Soldier
let mercenaryStatus = { active: false, progress: null, taskDetails: null }; // Example status for Mercenary (scaffold)
let legionStatus = { active: false, elapsedTime: null, taskDetails: null }; // Example status for Legion (scaffold)

// --- DOM Elements ---
const chatContainer = document.getElementById('chat-container');
const inputBar = document.getElementById('input-bar');
const sendButton = document.getElementById('send-button');
const providerSelect = document.getElementById('provider-select'); // Assuming combo input has an ID
const modelSelect = document.getElementById('model-select'); // Assuming combo input has an ID
const apiKeyModal = document.getElementById('api-key-modal');
const apiKeyForm = document.getElementById('api-key-form');
const apiKeyInput = document.getElementById('api-key-input');
const providerCardsContainer = document.getElementById('provider-cards');
const addKeyButton = document.getElementById('add-key-button');
const closeApiKeyModal = document.getElementById('close-api-key-modal');
const providerPickerModal = document.getElementById('provider-picker-modal'); // NEW ELEMENT
const providerPickerForm = document.getElementById('provider-picker-form'); // NEW ELEMENT
const providerPickerOptions = document.getElementById('provider-picker-options'); // NEW ELEMENT (container for radio buttons)
const confirmProviderButton = document.getElementById('confirm-provider-btn'); // NEW ELEMENT
const cancelProviderButton = document.getElementById('cancel-provider-btn'); // NEW ELEMENT
const closeProviderPickerModal = document.getElementById('close-provider-picker-modal'); // NEW ELEMENT (if using close button)
const projectsModal = document.getElementById('projects-modal');
const contextModal = document.getElementById('context-modal');
const newChatButton = document.getElementById('new-chat-btn');
const projectsButton = document.getElementById('projects-btn');
const contextButton = document.getElementById('context-btn');
const apiManagerButton = document.getElementById('api-manager-btn');
const toolsButton = document.getElementById('tools-btn');
const agentModeToggle = document.getElementById('agent-mode-toggle');
const stopAgentButton = document.getElementById('stop-agent-btn'); // Button to replace send when agent runs
const agentConfirmBanner = document.getElementById('agent-confirm-banner'); // Banner for agent confirm
const agentConfirmAcceptBtn = document.getElementById('agent-confirm-accept'); // Accept button for confirm
const agentConfirmSkipBtn = document.getElementById('agent-confirm-skip'); // Skip button for confirm
const agentSettingsModal = document.getElementById('agent-settings-modal');
const agentLogStyleSelect = document.getElementById('agent-log-style');
const agentMaxStepsInput = document.getElementById('agent-max-steps');
const multiAgentToggle = document.getElementById('multi-agent-toggle');
const saveAgentSettingsBtn = document.getElementById('save-agent-settings');
const themeToggle = document.getElementById('theme-toggle');

// --- Tool Toggles (stored in localStorage) ---
const TOOL_FETCH_ENABLED_KEY = 'vian_tool_fetch';
const TOOL_ZIP_ENABLED_KEY = 'vian_tool_zip';
const TOOL_PREVIEW_ENABLED_KEY = 'vian_tool_preview';
const TOOL_EXTSCRIPTS_ENABLED_KEY = 'vian // For preview sandbox
const TOOL_AGENT_ENABLED_KEY = 'vian_tool_agent';

let isFetchEnabled = localStorage.getItem(TOOL_FETCH_ENABLED_KEY) !== 'false'; // Default true
let isZipEnabled = localStorage.getItem(TOOL_ZIP_ENABLED_KEY) !== 'false'; // Default true
let isPreviewEnabled = localStorage.getItem(TOOL_PREVIEW_ENABLED_KEY) !== 'false'; // Default true
let isExtScriptsEnabled = localStorage.getItem(TOOL_EXTSCRIPTS_ENABLED_KEY) === 'true'; // Default false
let isAgentToolEnabled = localStorage.getItem(TOOL_AGENT_ENABLED_KEY) === 'true'; // Default false

// --- System Prompts ---
const BASE_CORE = `You are an AI assistant integrated into a private, offline chat application. Your primary goal is to be maximally helpful to the user using the tools available to you. All communication happens through structured blocks, which you must use precisely as instructed.`;

const TOOL_FETCH = `
You have access to a repository mirror tool that allows you to fetch files or full repositories.
Use the [FETCH] block to retrieve content:
- [FETCH]https://github.com/user/repo[/FETCH] - Fetches the entire repository context.
- [FETCH:path/to/file.js] - Fetches a specific file.
- [FETCH:path/to/file.js:10-20] - Fetches specific lines (10 to 20) from a file.
- [INDEX:https://github.com/user/repo] - Fetches an index of files in the repository.
After fetching, you will receive the content as a user message. Process it accordingly and continue the conversation.
`;

const TOOL_ZIP = `
You can generate ZIP archives containing files specified by the user.
Use the [RUN] block with JSZip syntax:
[RUN]
JSZipUtils.getBinaryContent('path/to/file1.txt', function(err, data1) {
  if(err) throw err;
  zip.file('file1.txt', data1);
  // Add more files similarly
  zip.generateAsync({type:'blob'}).then(function(content) {
      // Download logic handled by PWA
  });
});
[/RUN]
The PWA will execute this script in a sandboxed environment and offer the resulting ZIP for download.
`;

const TOOL_PREVIEW = `
You can render HTML previews for the user.
Use the [PREVIEW] block:
[PREVIEW]
<!DOCTYPE html>
<html>...</html>
[/PREVIEW]
The PWA will render this in a sandboxed iframe. The user must tap to view it. External scripts are blocked unless 'Allow External Scripts' is enabled (check tool status).
`;

const TOOL_AGENT = `
You can initiate autonomous agent loops.
Use the [AGENT] block:
[AGENT]Define a specific, achievable goal for the agent to work towards.[/AGENT]
The agent will operate in a separate Web Worker, using your current provider/key. It reports back using [AGENT:DONE] or [AGENT:LIMIT] blocks.
It can use other tools like [FETCH], [STORE], [RECALL], [FILE], [CONFIRM].
[CONFIRM:action]description[/CONFIRM] pauses the agent and asks for user permission.
`;

// --- Utility Functions ---
function showToast(message, type = 'info') {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 4px;
    color: white;
    background-color: ${type === 'error' ? '#d32f2f' : type === 'warning' ? '#ffa000' : '#2e7d32'};
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    opacity: 0;
    transition: opacity 0.3s ease-out;
  `;

  document.body.appendChild(toast);

  // Fade in
  setTimeout(() => { toast.style.opacity = '1'; }, 10);

  // Remove after delay
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.remove(); }, 300);
  }, 3000);
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- API Key Management UI ---
async function updateApiKeyCards() {
  if (!providerCardsContainer) return;
  providerCardsContainer.innerHTML = '';

  for (const provider of ALL_PROVIDERS) {
    const keys = await getKeys(provider);
    if (keys.length > 0) {
      const card = document.createElement('div');
      card.className = 'key-card';
      card.innerHTML = `
        <h4>${PROVIDER_LABELS[provider]}</h4>
        <ul>
          ${keys.map((key, index) => `
            <li>
              <span class="key-preview">${key.substring(0, 5)}...${key.substring(key.length - 3)}</span>
              <button class="move-key-up" data-provider="${provider}" data-index="${index}">▲</button>
              <button class="move-key-down" data-provider="${provider}" data-index="${index}">▼</button>
              <button class="delete-key" data-provider="${provider}" data-index="${index}">✕</button>
            </li>
          `).join('')}
        </ul>
      `;
      providerCardsContainer.appendChild(card);

      // Add event listeners for move/delete buttons within the card
      card.querySelectorAll('.move-key-up').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const p = e.target.dataset.provider;
          const i = parseInt(e.target.dataset.index);
          const keys = await getKeys(p);
          if (i > 0) {
            [keys[i], keys[i - 1]] = [keys[i - 1], keys[i]]; // Swap
            await setKeys(p, keys);
            updateApiKeyCards(); // Refresh UI
          }
        });
      });
      card.querySelectorAll('.move-key-down').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const p = e.target.dataset.provider;
          const i = parseInt(e.target.dataset.index);
          const keys = await getKeys(p);
          if (i < keys.length - 1) {
            [keys[i], keys[i + 1]] = [keys[i + 1], keys[i]]; // Swap
            await setKeys(p, keys);
            updateApiKeyCards(); // Refresh UI
          }
        });
      });
      card.querySelectorAll('.delete-key').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const p = e.target.dataset.provider;
          const i = parseInt(e.target.dataset.index);
          const keys = await getKeys(p);
          keys.splice(i, 1); // Remove
          await setKeys(p, keys);
          updateApiKeyCards(); // Refresh UI
        });
      });
    }
  }
}

async function addApiKey(e) {
  e.preventDefault();
  const keyInput = apiKeyInput.value.trim();
  if (!keyInput) return;

  // Detect provider from the key
  const detectedProvider = detectProviderFromKey(keyInput);

  if (detectedProvider === 'unknown') {
    // NEW LOGIC: Handle unknown provider prefix
    unknownKeyInputValue = keyInput; // Store the key value
    showProviderPickerForUnknownKey = true; // Set state to show picker
    render(); // Trigger re-render to show the picker modal
  } else if (detectedProvider === 'openai_or_deepseek') {
    // Existing ambiguous case handling - show disambiguation row
    // This logic needs to be implemented similarly to how the provider picker works,
    // but for the specific openai/deepseek case.
    // For brevity in this full file, let's assume a helper function exists or the logic is inline.
    // Example placeholder logic:
    const choice = prompt("Key prefix 'sk-' is ambiguous. Is this an OpenAI key or a DeepSeek key? Enter 'openai' or 'deepseek'.");
    if (choice && (choice.toLowerCase() === 'openai' || choice.toLowerCase() === 'deepseek')) {
        const currentKeys = await getKeys(choice.toLowerCase());
        if (!currentKeys.includes(keyInput)) {
          currentKeys.push(keyInput);
          await setKeys(choice.toLowerCase(), currentKeys);
          console.log(`Added key for ${choice.toLowerCase()}`);
          apiKeyInput.value = ''; // Clear input after successful add
          updateApiKeyCards(); // Refresh the UI
          render(); // Re-render main UI if needed (e.g., to update model selector datalist)
        } else {
          showToast(`Key already exists for ${PROVIDER_LABELS[choice.toLowerCase()]}.`, 'warning');
        }
    } else {
        showToast("Invalid choice or cancelled. Key not added.", 'error');
    }
  } else {
    // Known provider case
    const currentKeys = await getKeys(detectedProvider);
    if (!currentKeys.includes(keyInput)) {
      currentKeys.push(keyInput);
      await setKeys(detectedProvider, currentKeys);
      console.log(`Added key for ${detectedProvider}`);
      apiKeyInput.value = ''; // Clear input after successful add
      updateApiKeyCards(); // Refresh the UI
      render(); // Re-render main UI if needed (e.g., to update model selector datalist)
    } else {
      showToast(`Key already exists for ${PROVIDER_LABELS[detectedProvider]}.`, 'warning');
    }
  }
}

async function confirmProviderSelection(e) {
  e.preventDefault();
  if (!selectedProviderForUnknownKey || !unknownKeyInputValue) {
    showToast('Please select a provider.', 'error');
    return;
  }

  // Add the key under the selected provider
  const currentKeys = await getKeys(selectedProviderForUnknownKey);
  if (!currentKeys.includes(unknownKeyInputValue)) {
    currentKeys.push(unknownKeyInputValue);
    await setKeys(selectedProviderForUnknownKey, currentKeys);
    console.log(`Added key for ${selectedProviderForUnknownKey} (via picker)`);
    apiKeyInput.value = ''; // Clear original input
    updateApiKeyCards(); // Refresh the UI
    //
    showProviderPickerForUnknownKey = false;
    selectedProviderForUnknownKey = '';
    unknownKeyInputValue = '';
    render(); // Re-render main UI if needed
    showToast(`Key added for ${PROVIDER_LABELS[selectedProviderForUnknownKey]}.`, 'success');
  } else {
     showToast(`Key already exists for ${PROVIDER_LABELS[selectedProviderForUnknownKey]}.`, 'warning');
     // Still close the modal even if duplicate
     showProviderPickerForUnknownKey = false;
     selectedProviderForUnknownKey = '';
     unknownKeyInputValue = '';
     render();
  }
}

function cancelProviderSelection() {
   showProviderPickerForUnknownKey = false;
   selectedProviderForUnknownKey = '';
   unknownKeyInputValue = '';
   render(); // Re-render to hide the modal
}

// --- Project Management UI ---
async function loadProjectsIntoSidebar() {
  const projects = await listProjects();
  const projectsList = document.getElementById('sidebar-projects-list');
  if (projectsList) {
    projectsList.innerHTML = '';
    projects.forEach(project => {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      item.textContent = project.name;
      item.dataset.projectId = project.id;
      if (project.id === currentProjectId) {
        item.classList.add('active');
      }
      item.addEventListener('click', () => switchProject(project.id));
      projectsList.appendChild(item);
    });
  }
}

async function switchProject(projectId) {
  if (currentConversationId && currentConversation.messages.length > 0) {
    await saveCurrentConversation();
  }
  const project = await loadProject(projectId);
  if (project) {
    // Save last conversation ID in the old project if switching
    if (currentProjectId && currentProjectId !== projectId) {
      const oldProject = await loadProject(currentProjectId);
      if (oldProject) {
        oldProject.lastConvId = currentConversationId;
        await updateProject(oldProject);
      }
    }
    currentProjectId = projectId;
    // Restore last conversation ID from the new project
    currentConversationId = project.lastConvId;
    if (currentConversationId) {
      currentConversation = await loadConversation(currentConversationId) || { id: currentConversationId, title: 'Restored Chat', messages: [], projectId: currentProjectId, createdAt: Date.now(), updatedAt: Date.now() };
    } else {
      currentConversation = { id: '', title: 'New Chat', messages: [], projectId: currentProjectId, createdAt: Date.now(), updatedAt: Date.now() };
    }
    loadProjectsIntoSidebar(); // Update sidebar highlighting
    render();
  }
}

async function saveCurrentConversation() {
  if (currentConversation && currentConversation.messages.length > 0) {
    if (!currentConversation.id) {
      currentConversation.id = `conv_${Date.now()}`;
    }
    currentConversation.updatedAt = Date.now();
    if (currentConversation.projectId !== currentProjectId) {
      currentConversation.projectId = currentProjectId; // Ensure it's linked correctly
    }
    await saveConversation(currentConversation);
  }
}

// --- Context Block Management UI ---
async function loadContextBlocksIntoSidebar() {
  const blocks = await listContextBlocks();
  const contextList = document.getElementById('sidebar-context-list');
  if (contextList) {
    contextList.innerHTML = '';
    blocks.forEach(block => {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      item.textContent = block.name;
      item.dataset.blockId = block.id;
      // Add checkbox logic here if needed for active/inactive blocks
      contextList.appendChild(item);
    });
  }
}

// --- Agent Control Functions ---
async function startSoldierAgent(goal, provider, key, model, maxSteps, logStyle) {
  if (!isMultiAgentEnabled && activeAgents.size > 0) {
     showToast('Multi-agent disabled. Stop current agent first.', 'error');
     return;
  }

  const workerId = `soldier-${Date.now()}`;
  const agentId = `soldier-worker-${workerId}`; // Unique ID for the tray

  // Add to active agents set
  activeAgents.add(agentId);

  // Update local status tracker
  soldierStatus = { active: true, currentStep: 1, workerId: agentId }; // Simplified initial status

  // Update UI state
  isAgentRunning = true;
  render();

  // Instantiate worker
  const worker = new Worker('/src/workers/agent.worker.js');
  activeAgentWorkers.set(agentId, worker); // Store reference

  worker.postMessage({
    type: 'START',
    goal: goal,
    providerName: provider,
    providerKey: key,
    model: model,
    maxSteps: maxSteps,
    conversationHistory: [...currentConversation.messages], // Pass current history
    projectId: currentProjectId
  });

  worker.addEventListener('message', (event) => {
    const { type, data, agentId: msgAgentId } = event.data; // Receive agentId from worker

    if (msgAgentId !== agentId) return; // Ignore messages not intended for this instance

    if (type === 'STEP') {
        soldierStatus.currentStep = data.stepNumber; // Update current step
        render(); // Update UI
        if (logStyle === 'inline') {
            // Add step message to chat
            const stepMsg = { role: 'agent_step', content: `**Step ${data.stepNumber}:** ${data.thought}\n\n**Action:** \`\`\`${data.action}\`\`\``, timestamp: Date.now() };
            currentConversation.messages.push(stepMsg);
            render(); // Update chat display
        } else {
            // Log panel style - update a dedicated area (implementation depends on UI structure)
            // For now, just log to console or update a hidden div if panel is open
            console.log(`Agent ${agentId} Step ${data.stepNumber}:`, data);
        }
    } else if (type === 'STREAM_START') {
        // Prepare for streaming agent output if needed (e.g., for DONE summary)
        // Usually handled within STEP or DONE
    } else if (type === type === 'LIMIT_REACHED' || type === 'ERROR' || type === 'STOPPED') {
      activeAgents.delete(agentId); // Remove from active set
      activeAgentWorkers.delete(agentId); // Remove worker reference
      if (activeAgents.size === 0) {
          isAgentRunning = false; // Update global status if no agents left
      }
      soldierStatus = { active: false, currentStep: null, workerId: null }; // Reset status
      render(); // Update UI
      // Clean up worker
      worker.terminate();
      if (type === 'DONE' || type === 'LIMIT_REACHED') {
          // Add final report message
          const reportMsg = { role: 'agent_report', content: `**Agent Finished:**\n\n${data.summary || 'Completed successfully.'}`, timestamp: Date.now() };
          currentConversation.messages.push(reportMsg);
          render(); // Update chat display
      } else if (type === 'ERROR') {
          const errorMsg = { role: 'agent_error', content: `**Agent Error:** ${data.error || 'An unknown error occurred.'}`, timestamp: Date.now() };
          currentConversation.messages.push(errorMsg);
          render();
          showToast(`Agent Error: ${data.error || 'Check console.'}`, 'error');
      } else if (type === 'STOPPED') {
          const stopMsg = { role: 'agent_stopped', content: '**Agent Stopped by User.**', timestamp: Date.now() };
          currentConversation.messages.push(stopMsg);
          render();
          showToast('Agent stopped.', 'info');
      }
    } else if (type === 'CONFIRM') {
        // Show confirm banner
        agentConfirmBannerVisible = true;
        agentConfirmAction = data.action;
        agentConfirmDesc = data.description;
        render();
    }
  });

  // Save updated conversation state potentially modified by agent
  // This happens implicitly when messages are added during STEP/DONE etc.
}

function stopSpecificAgent(agentId) {
    const worker = activeAgentWorkers.get(agentId);
    if (worker) {
        worker.postMessage({ type: 'STOP', agentId: agentId }); // Send stop signal to specific worker
        worker.terminate(); // Terminate immediately after sending stop
        activeAgentWorkers.delete(agentId); // Clean up reference
    }
    // Remove from activeAgents set and update statuses
    activeAgents.delete(agentId);
    if (agentId.startsWith('soldier-worker-')) {
        soldierStatus = { active: false, currentStep: null, workerId: null };
    } else if (agentId.startsWith('mercenary-worker-')) {
        mercenaryStatus = { active: false, progress: null, taskDetails: null };
    } else if (agentId.startsWith('legion-worker-')) {
        legionStatus = { active: false, elapsedTime: null, taskDetails: null };
    }
    if (activeAgents.size === 0) {
        isAgentRunning = false; // Update global status if no agents left
    }
    render(); // Update UI
}

function stopAllAgents() {
    // Stop all active agents
    activeAgentWorkers.forEach((worker, agentId) => {
        worker.postMessage({ type: 'STOP', agentId: agentId });
        worker.terminate();
    });
    activeAgentWorkers.clear();
    activeAgents.clear();
    isAgentRunning = false;
    soldierStatus = { active: false, currentStep: null, workerId: null };
    mercenaryStatus = { active: false, progress: null, taskDetails: null };
    legionStatus = { active: false, elapsedTime: null, taskDetails: null };
    render();
}

function acceptAgentConfirm() {
    const worker = activeAgentWorkers.get(soldierStatus.workerId); // Assuming confirm relates to active soldier
    if (worker) {
        worker.postMessage({ type: 'CONFIRM_RESPONSE', accepted: true, agentId: soldierStatus.workerId });
    }
    agentConfirmBannerVisible = false;
    render();
}

function skipAgentConfirm() {
    const worker = activeAgentWorkers.get(soldierStatus.workerId); // Assuming confirm relates to active soldier
    if (worker) {
        worker.postMessage({ type: 'CONFIRM_RESPONSE', accepted: false, agentId: soldierStatus.workerId });
    }
    agentConfirmBannerVisible = false;
    render();
}

// --- Rendering Logic ---
function render() {
  // --- Main Chat Area ---
  if (chatContainer) {
    chatContainer.innerHTML = '';
    currentConversation.messages.forEach(msg => {
      const messageDiv = document.createElement('div');
      messageDiv.className = `message ${msg.role}`;

      // Determine if message contains blocks needing special handling
      const hasBlocks = /\[(FETCH|INDEX|RUN|PREVIEW|STORE|RECALL|AGENT|CONFIRM|FILE)\]/.test(msg.content);

      if (msg.role === 'user') {
        messageDiv.innerHTML = `<strong>You:</strong> <span class="user-message-text">${marked.parseInline(escapeHtml(msg.content))}</span>`;
        messageDiv.classList.add('user-message'); // Add class for potential folding
        messageDiv.addEventListener('click', () => messageDiv.classList.toggle('folded')); // Toggle fold on click
      } else if (msg.role === 'assistant') {
        // Strip blocks for display if not handled specially
        const displayContent = hasBlocks ? stripBlocks(msg.content) : msg.content;
        messageDiv.innerHTML = `<strong>Assistant:</strong> ${marked.parse(displayContent)}`;
        messageDiv.classList.add('assistant-message');
      } else if (msg.role === 'agent_step') {
          messageDiv.innerHTML = `<strong>Agent Step:</strong> ${marked.parse(msg.content)}`;
          messageDiv.classList.add('agent-step-message');
      } else if (msg.role === 'agent_report') {
          messageDiv.innerHTML = `<strong>Agent Report:</strong> ${marked.parse(msg.content)}`;
          messageDiv.classList.add('agent-report-message');
      } else if (msg.role === 'agent_error') {
          messageDiv.innerHTML = `<strong>Agent Error:</strong> ${marked.parse(escapeHtml(msg.content))}`;
          messageDiv.classList.add('agent-error-message');
      } else if (msg.role === 'agent_stopped') {
          messageDiv.innerHTML = `<strong>Agent Status:</strong> ${marked.parse(escapeHtml(msg.content))}`;
          messageDiv.classList.add('agent-status-message');
      } else {
        // Fallback for other roles
        messageDiv.innerHTML = `<strong>${msg.role}:</strong> ${marked.parse(escapeHtml(msg.content))}`;
      }

      chatContainer.appendChild(messageDiv);
    });
    chatContainer.scrollTop = chatContainer.scrollHeight; // Auto-scroll to bottom
  }

  // --- Input Bar State ---
  if (inputBar) {
    // Disable input bar when agent is running
    inputBar.disabled = isAgentRunning;
    inputBar.classList.toggle('disabled', isAgentRunning);
  }
  if (sendButton) {
    // Disable send button when agent is running
    sendButton.disabled = isAgentRunning;
    sendButton.classList.toggle('disabled', isAgentRunning);
    // Replace text/content with Stop button if agent is running
    if (isAgentRunning) {
        sendButton.textContent = '⏹️ Stop';
        sendButton.onclick = stopAllAgents;
    } else {
        sendButton.textContent = 'Send'; // Or use original icon/text logic
        sendButton.onclick = sendMessage; // Restore original send logic
    }
  }
  if (providerSelect) {
      providerSelect.disabled = isAgentRunning;
      providerSelect.classList.toggle('disabled', isAgentRunning);
  }
  if (modelSelect) {
      modelSelect.disabled = isAgentRunning;
      modelSelect.classList.toggle('disabled', isAgentRunning);
  }
  if (newChatButton) {
      newChatButton.disabled = isAgentRunning;
      newChatButton.classList.toggle('disabled', isAgentRunning);
  }

  // --- Modals ---
  apiKeyModal.style.display = showApiKeyModal ? 'block' : 'none';
  projectsModal.style.display = showProjectsModal ? 'block' : 'none';
  contextModal.style.display = showContextModal ? 'block' : 'none';
  agentSettingsModal.style.display = showAgentSettings ? 'block' : 'none';
  providerPickerModal.style.display = showProviderPickerForUnknownKey ? 'block' : 'none'; // NEW MODAL

  // --- Populate Provider Picker Options (NEW LOGIC) ---
  if (showProviderPickerForUnknownKey && providerPickerOptions) {
    providerPickerOptions.innerHTML = ''; // Clear previous options
    ALL_PROVIDERS.forEach(provider => {
      const optionDiv = document.createElement('div');
      optionDiv.className = 'provider-option-item'; // Add a class for styling
      optionDiv.innerHTML = `
        <input type="radio" id="pick-${provider}" name="provider-picker" value="${provider}">
        <label for="pick-${provider}">${PROVIDER_LABELS[provider]}</label>
      `;
      optionDiv.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) {
              selectedProviderForUnknownKey = e.target.value;
          }
      });
      providerPickerOptions.appendChild(optionDiv);
    });
    // Optionally pre-select a likely candidate based on the unknown key's content
    // const likelyProvider = unknownKeyInputValue.startsWith('mistral-') ? 'mistral' : null;
    // if (likelyProvider && document.getElementById(`pick-${likelyProvider}`)) {
    //    document.getElementById(`pick-${likelyProvider}`).checked = true;
    //    selectedProviderForUnknownKey = likelyProvider;
    // }
  }

  // --- Sidebar Visibility ---
  document.getElementById('sidebar').style.display = showApiManagerInSidebar || showProjectsInSidebar || showContextInSidebar || showToolsInSidebar ? 'flex' : 'none';
  document.getElementById('api-manager-section').style.display = showApiManagerInSidebar ? 'block' : 'none';
  document.getElementById('projects-section').style.display = showProjectsInSidebar ? 'block' : 'none';
  document.getElementById('context-section').style.display = showContextInSidebar ? 'block' : 'none';
  document.getElementById('tools-section').style.display = showToolsInSidebar ? 'block' : 'none';

  // --- Agent Confirm Banner ---
  if (agentConfirmBanner) {
      agentConfirmBanner.style.display = agentConfirmBannerVisible ? 'flex' : 'none';
      if (agentConfirmBannerVisible) {
          agentConfirmBanner.innerHTML = `
              <div class="agent-confirm-content">
                  <p><strong>Agent Action Requires Confirmation:</strong></p>
                  <p>${escapeHtml(agentConfirmDesc || 'An action needs your approval.')}</p>
                  <button id="agent-confirm-accept">Accept</button>
                  <button id="agent-confirm-skip">Skip</button>
              </div>
          `;
          document.getElementById('agent-confirm-accept')?.addEventListener('click', acceptAgentConfirm);
          document.getElementById('agent-confirm-skip')?.addEventListener('click', skipAgentConfirm);
      }
  }

  // --- Agent Settings Modal Content ---
  if (agentLogStyleSelect) agentLogStyleSelect.value = agentLogStyle;
  if (agentMaxStepsInput) agentMaxStepsInput.value = agentMaxSteps;
  if (multiAgentToggle) multiAgentToggle.checked = isMultiAgentEnabled;

  // --- Agent Status Tray (NEW SECTION) ---
  const existingTray = document.getElementById('agent-status-tray');
  if (agentStatusTrayVisible || soldierStatus.active || mercenaryStatus.active || legionStatus.active) {
      if (!existingTray) {
          const trayDiv = document.createElement('div');
          trayDiv.id = 'agent-status-tray';
          trayDiv.className = 'agent-status-tray'; // Add CSS class
          trayDiv.style.cssText = `position: fixed; bottom: 80px; right: 12px; display: flex; flex-direction: column; gap: 8px; z-index: 1000;`; // Basic styles

          // Create icons for Soldier, Mercenary, Legion
          const soldierIcon = document.createElement('div');
          soldierIcon.id = 'soldier-tray-icon';
          soldierIcon.className = `agent-tray-icon ${soldierStatus.active ? 'active' : 'idle'}`;
          soldierIcon.title = `Soldier Agent ${soldierStatus.active ? `(Step ${soldierStatus.currentStep})` : '(Idle)'}`;
          soldierIcon.innerHTML = '⚔️'; // Or use an SVG icon
          soldierIcon.addEventListener('click', () => showAgentLogOverlay(soldierStatus)); // Example action
          soldierIcon.addEventListener('auxclick', (e) => { if (e.button === 2) stopSpecificAgent(soldierStatus.workerId); }); // Right-click to stop

          const mercenaryIcon = document.createElement('div');
          mercenaryIcon.id = 'mercenary-tray-icon';
          mercenaryIcon.className = `agent-tray-icon ${mercenaryStatus.active ? 'active' : 'idle'}`;
          mercenaryIcon.title = `Mercenary Task ${mercenaryStatus.active ? '(Active)' : '(Idle)'}`;
          mercenaryIcon.innerHTML = '🏹'; // Or use an SVG icon
          mercenaryIcon.addEventListener('click', () => showAgentLogOverlay(mercenaryStatus)); // Example action
          mercenaryIcon.addEventListener('auxclick', (e) => { if (e.button === 2) stopSpecificAgent(mercenaryStatus.workerId); }); // Right-click to stop

          const legionIcon = document.createElement('div');
          legionIcon.id = 'legion-tray-icon';
          legionIcon.className = `agent-tray-icon ${legionStatus.active ? 'active' : 'idle'}`;
          legionIcon.title = `Legion Task ${legionStatus.active ? '(Active)' : '(Idle)'}`;
          legionIcon.innerHTML = '🛡️'; // Or use an SVG icon
          legionIcon.addEventListener('click', () => showAgentLogOverlay(legionStatus)); // Example action
          legionIcon.addEventListener('auxclick', (e) => { if (e.button === 2) stopSpecificAgent(legionStatus.workerId); }); // Right-click to stop

          trayDiv.appendChild(soldierIcon);
          trayDiv.appendChild(mercenaryIcon);
          trayDiv.appendChild(legionIcon);

          document.body.appendChild(trayDiv);
      } else {
          // Update existing tray icons if tray is already rendered
          const sIcon = document.getElementById('soldier-tray-icon');
          const mIcon = document.getElementById('mercenary-tray-icon');
          const lIcon = document.getElementById('legion-tray-icon');
          if (sIcon) {
              sIcon.className = `agent-tray-icon ${soldierStatus.active ? 'active' : 'idle'}`;
              sIcon.title = `Soldier Agent ${soldierStatus.active ? `(Step ${soldierStatus.currentStep})` : '(Idle)'}`;
          }
          if (mIcon) {
               mIcon.className = `agent-tray-icon ${mercenaryStatus.active ? 'active' : 'idle'}`;
               mIcon.title = `Mercenary Task ${mercenaryStatus.active ? '(Active)' : '(Idle)'}`;
          }
          if (lIcon) {
               lIcon.className = `agent-tray-icon ${legionStatus.active ? 'active' : 'idle'}`;
               lIcon.title = `Legion Task ${legionStatus.active ? '(Active)' : '(Idle)'}`;
          }
      }
  } else {
      if (existingTray) {
          existingTray.remove(); // Remove tray if no agents are active and visibility is off
      }
  }
}

// --- Message Sending Logic ---
async function sendMessage() {
  const inputElement = document.getElementById('message-input'); // Assuming this ID exists
  const message = inputElement?.value.trim();
  if (!message || isAgentRunning) return; // Don't send if agent is running

  // Add user message to conversation
  const userMsg = { role: 'user', content: message, timestamp: Date.now() };
  currentConversation.messages.push(userMsg);

  // Prepare system prompt based on active tools and project
  let systemPrompt = BASE_CORE;

  // Add project system prompt if applicable
  if (currentProjectId) {
    const project = await loadProject(currentProjectId);
    if (project && project.systemPrompt) {
      systemPrompt += `\n\nProject Instructions:\n${project.systemPrompt}`;
    }
  }

  // Add context blocks if any are active (implementation depends on how context is tracked)
  // For simplicity, assuming all context blocks are considered active for now
  const contextBlocks = await listContextBlocks();
  if (contextBlocks.length > 0) {
    systemPrompt += "\n\nActive Context:\n";
    for (const block of contextBlocks) {
      systemPrompt += `${block.content}\n`;
    }
  }

  if (isFetchEnabled) systemPrompt += '\n\n' + TOOL_FETCH;
  if (isZipEnabled) systemPrompt += '\n\n' + TOOL_ZIP;
  if (isPreviewEnabled) systemPrompt += '\n\n' + TOOL_PREVIEW;
  if (isAgentToolEnabled) systemPrompt += '\n\n' + TOOL_AGENT;

  // Construct full message history for the API call
  const fullMessages = [{ role: 'system', content: systemPrompt }, ...currentConversation.messages];

  // Get provider and model from UI elements (assuming they exist and are combo inputs)
  const provider = providerSelect.value || 'openai'; // Fallback to openai
  const model = modelSelect.value || 'gpt-4o'; // Fallback to gpt-4o

  // Clear input
  inputElement.value = '';

  // Add a temporary assistant message placeholder for streaming
  const assistantMsg = { role: 'assistant', content: '', timestamp: Date.now() };
  currentConversation.messages.push(assistantMsg);
  render(); // Render the placeholder

  try {
    // Call the API
    const stream = callMessage(provider, fullMessages, model);
    for await (const chunk of stream) {
      assistantMsg.content += chunk;
      render(); // Update the assistant message content in real-time
    }
  } catch (error) {
    console.error("Error during API call:", error);
    // Replace the placeholder with an error message
    assistantMsg.role = 'error';
    assistantMsg.content = `Error: ${error.message || 'An unknown error occurred.'}`;
    showToast(`API Error: ${error.message || 'Check console.'}`, 'error');
  } finally {
    currentConversation.updatedAt = Date.now();
    if (currentConversation.id) {
        await saveConversation(currentConversation); // Save after receiving full response
    }
    render(); // Final render
  }
}

// --- Helper function for Agent Log Overlay (Placeholder) ---
function showAgentLogOverlay(agentStatus) {
    // Create a simple overlay showing current status/step
    // This could be a modal or a tooltip depending on preference
    if (agentStatus.active) {
        alert(`Agent Active\nCurrent Info: ${JSON.stringify(agentStatus, null, 2)}`); // Simple alert for now
        // TODO: Implement a better overlay UI
    } else {
        alert('Agent Idle');
    }
}

// --- Event Listeners ---
apiKeyForm?.addEventListener('submit', addApiKey);
providerPickerForm?.addEventListener('submit', confirmProviderSelection);
cancelProviderButton?.addEventListener('click', cancelProviderSelection);
confirmProviderButton?.addEventListener('click', confirmProviderSelection);
closeProviderPickerModal?.addEventListener('click', cancelProviderSelection); // Assuming a close button exists in the picker modal

// Existing event listeners for other modals, buttons, etc., would go here...
// e.g., closeApiKeyModal, projectsButton, contextButton, agentModeToggle, etc.

// --- Initialize App ---
async function initApp() {
  await initDB();

  // Load initial data (e.g., default project, last conversation, etc.)
  const projects = await listProjects();
  if (projects.length === 0) {
    // Create default project if none exist
    await createProject('Default Project');
  }
  const allProjects = await listProjects();
  if (allProjects.length > 0 && !currentProjectId) {
    currentProjectId = allProjects[0].id;
  }

  // Load projects into sidebar
  loadProjectsIntoSidebar();

  // Apply initial theme
  const savedTheme = localStorage.getItem('vian_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  render();
}

initApp();
