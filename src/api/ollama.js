// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — Ollama Provider
// Local models, no API key needed.
// The "key" field stores the base URL.
// Default: http://localhost:11434
// ═══════════════════════════════════════════

import { getKey } from '../db/storage.js';

const DEFAULT_BASE = 'http://localhost:11434';

export const OLLAMA_MODELS = [];
// No hardcoded models — user types model name freely in the combo input.

export async function* streamOllama({ model, messages, system, onUsage, key }) {
  const base    = (key || getKey('ollama') || DEFAULT_BASE).replace(/\/$/, '');
  const endpoint = `${base}/api/chat`;

  const msgs = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        messages: msgs.map(m => ({ role: m.role, content: m.content })),
      }),
    });
  } catch (err) {
    throw new Error(`Ollama: could not connect to ${base} — is Ollama running?`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Ollama ${res.status}: ${text}`);
  }

  // Ollama streams newline-delimited JSON, not SSE
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer       = '';
  let inputTokens  = 0;
  let outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const ev = JSON.parse(trimmed);
        const text = ev.message?.content;
        if (text) yield text;
        // Final message contains eval stats
        if (ev.done && ev.prompt_eval_count !== undefined) {
          inputTokens  = ev.prompt_eval_count || 0;
          outputTokens = ev.eval_count        || 0;
        }
      } catch { /* skip */ }
    }
  }

  if (onUsage) {
    // Ollama is local — no cost
    onUsage({ inputTokens, outputTokens, cost: 0 });
  }
}
