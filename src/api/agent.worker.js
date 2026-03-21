// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — Agent Worker (Soldier)
//
// Runs the autonomous agent loop off the main thread.
// Communicates with main thread via postMessage.
//
// Incoming messages from main:
//   { type: 'start',   taskId, modelId, system, messages, goal, stepLimit, tools }
//   { type: 'confirm', taskId, decision: 'accept'|'skip' }
//   { type: 'stop',    taskId }
//
// Outgoing messages to main:
//   { type: 'step',     taskId, step, total, text }       — new step started
//   { type: 'chunk',    taskId, text }                    — streaming text chunk
//   { type: 'tool',     taskId, toolName, args }          — tool call detected
//   { type: 'confirm',  taskId, action, description }     — pause for user confirmation
//   { type: 'file_op',  taskId, op, filename, content }   — file read/write result
//   { type: 'done',     taskId, summary, usage }          — AGENT:DONE received
//   { type: 'limit',    taskId, summary, usage }          — step limit hit
//   { type: 'stopped',  taskId }                          — stop signal received
//   { type: 'error',    taskId, message }                 — unrecoverable error
// ═══════════════════════════════════════════

// ─── Block patterns ───────────────────────────────────────────

const AGENT_START_RE  = /\[AGENT\][\s\S]*?\[\/AGENT\]/;
const AGENT_DONE_RE   = /\[AGENT:DONE\]([\s\S]*?)\[\/AGENT:DONE\]/;
const AGENT_CONFIRM_RE = /\[CONFIRM:([\w]+)\]([\s\S]*?)\[\/CONFIRM\]/;
const FETCH_RE        = /\[FETCH\]\s*(https?:\/\/\S+)\s*\[\/FETCH\]/g;
const LINE_FETCH_RE   = /\[FETCH:([^:\]]+):(\d+)-(\d+)\]/g;
const INDEX_RE        = /\[INDEX:(https?:\/\/[^\]]+)\]/g;
const STORE_RE        = /\[STORE:([^\]]+)\]([\s\S]*?)\[\/STORE\]/g;
const RECALL_RE       = /\[RECALL:([^\]]+)\]/g;
const FILE_WRITE_RE   = /\[FILE:write:([^\]]+)\]([\s\S]*?)\[\/FILE\]/g;
const FILE_READ_RE    = /\[FILE:read:([^\]]+)\]/g;
const FILE_LIST_RE    = /\[FILE:list\]/g;

const MIRROR = 'https://mirror-for-ai.vialewis31.workers.dev';
const MAX_FILE_SLOTS  = 10;
const MAX_FILE_BYTES  = 100 * 1024;
const MAX_STORE_SLOTS = 20;
const MAX_SLOT_BYTES  = 50 * 1024;

// ─── Worker state ─────────────────────────────────────────────

const tasks       = new Map(); // taskId → { stopped, confirmResolve }
const agentFiles  = new Map(); // filename → content  (session, per-task cleared on done)
const sessionStore = new Map(); // STORE/RECALL slots

// ─── Main message handler ─────────────────────────────────────

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === 'start') {
    tasks.set(msg.taskId, { stopped: false, confirmResolve: null });
    agentFiles.clear();
    try {
      await runLoop(msg);
    } catch (err) {
      self.postMessage({ type: 'error', taskId: msg.taskId, message: err.message || String(err) });
    }
    tasks.delete(msg.taskId);
    return;
  }

  if (msg.type === 'stop') {
    const t = tasks.get(msg.taskId);
    if (t) t.stopped = true;
    return;
  }

  if (msg.type === 'confirm') {
    const t = tasks.get(msg.taskId);
    if (t?.confirmResolve) {
      t.confirmResolve(msg.decision);
      t.confirmResolve = null;
    }
    return;
  }
};

// ─── Main loop ────────────────────────────────────────────────

async function runLoop(opts) {
  const { taskId, modelId, system, goal, stepLimit } = opts;
  const messages = [...opts.messages]; // working copy
  const task     = tasks.get(taskId);

  let totalInput  = 0;
  let totalOutput = 0;
  let totalCost   = 0;

  for (let step = 1; step <= stepLimit; step++) {
    // Check stop flag at start of each step
    if (task.stopped) {
      self.postMessage({ type: 'stopped', taskId });
      return;
    }

    self.postMessage({ type: 'step', taskId, step, total: stepLimit });

    // ── Call AI ──────────────────────────────────────────────
    let responseText = '';
    let usage        = null;

    try {
      const result = await callMessageWorker({
        modelId, messages, system,
        onUsage: (u) => { usage = u; },
        onChunk: (chunk) => {
          responseText += chunk;
          self.postMessage({ type: 'chunk', taskId, text: chunk });
        },
      });
      responseText = result.text;
      if (result.usage) usage = result.usage;
    } catch (err) {
      self.postMessage({ type: 'error', taskId, message: err.message });
      return;
    }

    if (usage) {
      totalInput  += usage.inputTokens  || 0;
      totalOutput += usage.outputTokens || 0;
      totalCost   += usage.cost         || 0;
    }

    // ── Process blocks in response ────────────────────────────
    let processed = responseText;

    // STORE/RECALL
    processed = handleStoreRecall(processed, taskId);

    // FILE operations
    processed = await handleFileOps(processed, taskId);

    // Confirmation gate — destructive actions
    const confirmMatch = AGENT_CONFIRM_RE.exec(processed);
    if (confirmMatch) {
      const action      = confirmMatch[1];
      const description = confirmMatch[2].trim();

      self.postMessage({ type: 'confirm', taskId, action, description });

      // Wait for user decision
      const decision = await waitForConfirm(taskId);

      if (decision === 'skip') {
        processed = processed.replace(confirmMatch[0],
          `[Action "${action}" skipped by user]`);
      } else {
        processed = processed.replace(confirmMatch[0],
          `[Action "${action}" accepted by user]`);
      }
    }

    // FETCH blocks — inject content as next user message
    const fetchResults = await handleFetchBlocks(processed, taskId);
    if (fetchResults.length) {
      for (const r of fetchResults) {
        messages.push({ role: 'user', content: r });
      }
      processed = processed.replace(FETCH_RE, (m, url) => `[Fetched: ${url}]`);
      processed = processed.replace(LINE_FETCH_RE, (m, f, s, e) => `[Fetched: ${f}:${s}-${e}]`);
      processed = processed.replace(INDEX_RE, (m, url) => `[Indexed: ${url}]`);
    }

    // Add processed response to history
    messages.push({ role: 'assistant', content: processed });

    // ── Check for DONE signal ─────────────────────────────────
    const doneMatch = AGENT_DONE_RE.exec(processed);
    if (doneMatch) {
      const summary = doneMatch[1].trim();
      self.postMessage({
        type: 'done', taskId, summary,
        usage: { inputTokens: totalInput, outputTokens: totalOutput, cost: totalCost },
      });
      return;
    }

    // ── Check stop again after processing ─────────────────────
    if (task.stopped) {
      self.postMessage({ type: 'stopped', taskId });
      return;
    }
  }

  // Step limit reached
  self.postMessage({
    type: 'limit', taskId,
    summary: `Agent reached the ${stepLimit}-step limit.`,
    usage: { inputTokens: totalInput, outputTokens: totalOutput, cost: totalCost },
  });
}

// ─── Confirmation wait ────────────────────────────────────────

function waitForConfirm(taskId) {
  return new Promise((resolve) => {
    const t = tasks.get(taskId);
    if (t) t.confirmResolve = resolve;
    else   resolve('skip'); // task gone — safe default
  });
}

// ─── STORE / RECALL ───────────────────────────────────────────

function handleStoreRecall(text, taskId) {
  let result = text.replace(STORE_RE, (match, key, value) => {
    const k = key.trim();
    const v = value.trim()
      .replace(/\[RUN\][\s\S]*?\[\/RUN\]/g, '')
      .replace(/\[FETCH[\s\S]*?(\[\/FETCH\]|\])/g, '');
    if (sessionStore.size >= MAX_STORE_SLOTS) return '';
    const bytes = new TextEncoder().encode(v).length;
    sessionStore.set(k, bytes > MAX_SLOT_BYTES ? v.slice(0, MAX_SLOT_BYTES) : v);
    return '';
  });

  result = result.replace(RECALL_RE, (match, key) => {
    const k = key.trim();
    return sessionStore.has(k) ? sessionStore.get(k) : `[${k}: not found]`;
  });

  return result;
}

// ─── FILE operations ──────────────────────────────────────────

async function handleFileOps(text, taskId) {
  let result = text;

  // Write
  result = result.replace(FILE_WRITE_RE, (match, filename, content) => {
    const name = filename.trim();
    if (agentFiles.size >= MAX_FILE_SLOTS) {
      return `[File write failed: limit of ${MAX_FILE_SLOTS} files reached]`;
    }
    const bytes = new TextEncoder().encode(content).length;
    if (bytes > MAX_FILE_BYTES) {
      return `[File write failed: "${name}" exceeds 100 KB limit]`;
    }
    agentFiles.set(name, content.trim());
    self.postMessage({ type: 'file_op', taskId, op: 'write', filename: name });
    return `[File written: ${name}]`;
  });

  // Read
  result = result.replace(FILE_READ_RE, (match, filename) => {
    const name = filename.trim();
    if (agentFiles.has(name)) {
      self.postMessage({ type: 'file_op', taskId, op: 'read', filename: name });
      return `[File: ${name}]\n${agentFiles.get(name)}\n[/File]`;
    }
    return `[File not found: ${name}]`;
  });

  // List
  result = result.replace(FILE_LIST_RE, () => {
    if (!agentFiles.size) return '[No agent files stored]';
    const lines = [...agentFiles.entries()].map(([name, content]) => {
      const bytes = new TextEncoder().encode(content).length;
      return `${name} (${(bytes / 1024).toFixed(1)} KB)`;
    });
    return `[Agent files]\n${lines.join('\n')}\n[/Agent files]`;
  });

  return result;
}

// ─── FETCH blocks ─────────────────────────────────────────────

async function handleFetchBlocks(text, taskId) {
  const injections = [];

  // Full repo/file fetch
  const fetchMatches = [...text.matchAll(FETCH_RE)];
  for (const m of fetchMatches) {
    const url      = m[1].trim();
    const resolved = resolveUrl(url);
    if (!resolved) continue;
    try {
      const content = await fetchText(resolved.url);
      injections.push(`[SYSTEM: Content fetched from ${url}]\n\n${content}\n\n[END FETCH]`);
    } catch (err) {
      injections.push(`[Fetch failed: ${url} — ${err.message}]`);
    }
  }

  // Line range fetch
  const lineMatches = [...text.matchAll(LINE_FETCH_RE)];
  for (const m of lineMatches) {
    const [, filePath, start, end] = m;
    try {
      const rawUrl = resolveRawUrl(filePath);
      if (!rawUrl) { injections.push(`[Line fetch failed: cannot resolve "${filePath}"]`); continue; }
      const result = await fetchLineRange(rawUrl, Number(start), Number(end));
      injections.push(`[SYSTEM: Lines ${start}–${end} from ${filePath}]\n\n${result}\n\n[END FETCH]`);
    } catch (err) {
      injections.push(`[Line fetch failed: ${filePath} — ${err.message}]`);
    }
  }

  // Index
  const indexMatches = [...text.matchAll(INDEX_RE)];
  for (const m of indexMatches) {
    const url      = m[1].trim();
    const resolved = resolveUrl(url);
    if (!resolved) continue;
    try {
      const contextText = await fetchText(resolved.url);
      const files       = parseFileIndex(contextText);
      injections.push(`[SYSTEM: File index for ${url}]\n${files.join('\n')}\n[END INDEX]`);
    } catch (err) {
      injections.push(`[Index failed: ${url} — ${err.message}]`);
    }
  }

  return injections;
}

// ─── Mirror / fetch helpers ───────────────────────────────────

function resolveUrl(url) {
  const s = url.trim();

  let m = s.match(/^https?:\/\/github\.com\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/?$/);
  if (m) return { url: `${MIRROR}/github/${m[1]}/${m[2]}/context`, via: 'mirror' };

  m = s.match(/^https?:\/\/github\.com\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/blob\/([^/]+)\/(.+)$/);
  if (m) return { url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`, via: 'raw' };

  m = s.match(/^https?:\/\/codeberg\.org\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/?$/);
  if (m) return { url: `${MIRROR}/codeberg/${m[1]}/${m[2]}/context`, via: 'mirror' };

  m = s.match(/^https?:\/\/codeberg\.org\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/src\/branch\/([^/]+)\/(.+)$/);
  if (m) return { url: `${MIRROR}/codeberg/${m[1]}/${m[2]}/${m[4]}`, via: 'mirror' };

  return null;
}

function resolveRawUrl(filePath) {
  const p = filePath.trim();
  let m = p.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
  if (p.startsWith('https://raw.githubusercontent.com/')) return p;
  return null;
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchLineRange(rawUrl, start, end) {
  const text     = await fetchText(rawUrl);
  const allLines = text.split('\n');
  const total    = allLines.length;
  const s        = Math.max(1, start);
  const e        = Math.min(total, end);
  const slice    = allLines.slice(s - 1, e);
  return `Lines ${s}–${e} of ${total}:\n` + slice.map((l, i) => `${s + i}: ${l}`).join('\n');
}

function parseFileIndex(contextText) {
  const lines  = contextText.split('\n');
  const files  = [];
  let inList   = false;
  for (const line of lines) {
    if (line.startsWith('## All Files'))  { inList = true;  continue; }
    if (inList && line.startsWith('## ')) { inList = false; continue; }
    if (inList && line.trim() && !line.startsWith('#')) files.push(line.trim());
  }
  return files;
}

// ─── Non-streaming API call ───────────────────────────────────
// The worker can't import from src/api/index.js directly because
// that module uses localStorage (getKeys). Instead we receive the
// resolved key list from main and call the provider endpoint directly.
// Main thread passes { modelId, providerKey, system, messages } in opts.

async function callMessageWorker(opts) {
  const { modelId, providerKey, providerName, system, messages, onChunk, onUsage } = opts;

  if (!providerKey) throw new Error('No API key available for this model.');

  let text         = '';
  let inputTokens  = 0;
  let outputTokens = 0;
  let cost         = 0;

  // Dispatch to the right endpoint based on provider name
  // We replicate just the streaming logic for each provider here
  // rather than importing, to keep the worker self-contained.

  if (providerName === 'anthropic') {
    const body = {
      model: modelId, max_tokens: 8192, stream: true,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (system) body.system = system;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': providerKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`Anthropic ${res.status}: ${e?.error?.message || res.statusText}`); }
    ({ text, inputTokens, outputTokens, cost } = await consumeSSE(res, onChunk, 'anthropic', modelId));

  } else if (providerName === 'google') {
    const contents = [];
    if (system) contents.push({ role: 'user', parts: [{ text: `[System instruction]\n${system}` }] });
    for (const m of messages) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${providerKey}&alt=sse`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 8192 } }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`Google ${res.status}: ${e?.error?.message || res.statusText}`); }
    ({ text, inputTokens, outputTokens, cost } = await consumeSSE(res, onChunk, 'google', modelId));

  } else {
    // OpenAI-compatible: openai, deepseek, openrouter, groq, ollama
    const endpoints = {
      openai:     'https://api.openai.com/v1/chat/completions',
      deepseek:   'https://api.deepseek.com/v1/chat/completions',
      openrouter: 'https://openrouter.ai/api/v1/chat/completions',
      groq:       'https://api.groq.com/openai/v1/chat/completions',
      ollama:     `${(providerKey.startsWith('http') ? providerKey : 'http://localhost:11434').replace(/\/$/, '')}/api/chat`,
    };
    const endpoint = endpoints[providerName] || endpoints.openai;
    const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;

    const headers = { 'Content-Type': 'application/json' };
    if (providerName !== 'ollama') headers['Authorization'] = `Bearer ${providerKey}`;
    if (providerName === 'openrouter') {
      headers['HTTP-Referer'] = 'https://elschuyler.github.io/Vian-ai-flow/';
      headers['X-Title']      = 'Vian AI Flow';
    }

    const isOllama = providerName === 'ollama';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId, stream: true,
        ...(isOllama ? {} : { stream_options: { include_usage: true } }),
        messages: msgs.map(m => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`${providerName} ${res.status}: ${e?.error?.message || res.statusText}`); }
    ({ text, inputTokens, outputTokens, cost } = await consumeSSE(res, onChunk, providerName, modelId));
  }

  if (onUsage) onUsage({ inputTokens, outputTokens, cost });
  return { text, usage: { inputTokens, outputTokens, cost } };
}

// ─── SSE / NDJSON consumer ────────────────────────────────────

async function consumeSSE(res, onChunk, provider, modelId) {
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer       = '';
  let text         = '';
  let inputTokens  = 0;
  let outputTokens = 0;

  const PRICING = {
    'claude-sonnet-4-20250514':   { in: 3.00,  out: 15.00 },
    'claude-opus-4-20250514':     { in: 15.00, out: 75.00 },
    'claude-haiku-4-5-20251001':  { in: 0.80,  out: 4.00  },
    'gpt-4o':                     { in: 2.50,  out: 10.00 },
    'gpt-4o-mini':                { in: 0.15,  out: 0.60  },
    'o3-mini':                    { in: 1.10,  out: 4.40  },
    'gemini-2.0-flash':           { in: 0.10,  out: 0.40  },
    'gemini-2.5-pro-exp-03-25':   { in: 1.25,  out: 5.00  },
    'deepseek-chat':              { in: 0.27,  out: 1.10  },
    'deepseek-reasoner':          { in: 0.55,  out: 2.19  },
    'llama-3.3-70b-versatile':    { in: 0.59,  out: 0.79  },
    'llama-3.1-8b-instant':       { in: 0.05,  out: 0.08  },
  };

  const isOllama = provider === 'ollama';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (isOllama) {
        // Ollama: newline-delimited JSON
        try {
          const ev  = JSON.parse(trimmed);
          const tok = ev.message?.content;
          if (tok) { text += tok; if (onChunk) onChunk(tok); }
          if (ev.done) {
            inputTokens  = ev.prompt_eval_count || 0;
            outputTokens = ev.eval_count        || 0;
          }
        } catch {}
        continue;
      }

      if (!trimmed.startsWith('data:')) continue;
      const raw = trimmed.slice(5).trim();
      if (raw === '[DONE]') continue;

      try {
        const ev = JSON.parse(raw);

        if (provider === 'anthropic') {
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            text += ev.delta.text; if (onChunk) onChunk(ev.delta.text);
          }
          if (ev.type === 'message_start' && ev.message?.usage) inputTokens = ev.message.usage.input_tokens || 0;
          if (ev.type === 'message_delta' && ev.usage)           outputTokens = ev.usage.output_tokens || 0;
        } else if (provider === 'google') {
          const chunk = ev.candidates?.[0]?.content?.parts?.[0]?.text;
          if (chunk) { text += chunk; if (onChunk) onChunk(chunk); }
          if (ev.usageMetadata) {
            inputTokens  = ev.usageMetadata.promptTokenCount     || 0;
            outputTokens = ev.usageMetadata.candidatesTokenCount || 0;
          }
        } else {
          // OpenAI-compatible
          const chunk = ev.choices?.[0]?.delta?.content;
          if (chunk) { text += chunk; if (onChunk) onChunk(chunk); }
          if (ev.usage) {
            inputTokens  = ev.usage.prompt_tokens     || 0;
            outputTokens = ev.usage.completion_tokens || 0;
          }
        }
      } catch {}
    }
  }

  const p    = PRICING[modelId] || { in: 0, out: 0 };
  const cost = (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
  return { text, inputTokens, outputTokens, cost };
}
