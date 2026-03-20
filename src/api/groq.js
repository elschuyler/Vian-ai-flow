// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — Groq Provider
// OpenAI-compatible endpoint, very fast
// ═══════════════════════════════════════════

import { getKey } from '../db/storage.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export const GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile',      label: 'Llama 3.3 70B'       },
  { id: 'llama-3.1-8b-instant',         label: 'Llama 3.1 8B Instant' },
  { id: 'mistral-saba-24b',             label: 'Mistral Saba 24B'     },
  { id: 'gemma2-9b-it',                 label: 'Gemma 2 9B'           },
  { id: 'deepseek-r1-distill-llama-70b',label: 'DeepSeek R1 Distill'  },
];

// USD per million tokens (Groq free tier — approximate)
const PRICING = {
  'llama-3.3-70b-versatile':       { in: 0.59, out: 0.79 },
  'llama-3.1-8b-instant':          { in: 0.05, out: 0.08 },
  'mistral-saba-24b':              { in: 0.79, out: 0.79 },
  'gemma2-9b-it':                  { in: 0.20, out: 0.20 },
  'deepseek-r1-distill-llama-70b': { in: 0.75, out: 0.99 },
};

export async function* streamGroq({ model, messages, system, onUsage, key }) {
  const apiKey = key || getKey('groq');
  if (!apiKey) throw new Error('No Groq API key. Open API Manager to add one.');

  const msgs = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: msgs.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq ${res.status}: ${err?.error?.message || res.statusText}`);
  }

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
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const ev   = JSON.parse(raw);
        const text = ev.choices?.[0]?.delta?.content;
        if (text) yield text;
        if (ev.usage) {
          inputTokens  = ev.usage.prompt_tokens     || 0;
          outputTokens = ev.usage.completion_tokens || 0;
        }
      } catch { /* skip */ }
    }
  }

  if (onUsage) {
    const p = PRICING[model] || { in: 0, out: 0 };
    onUsage({
      inputTokens,
      outputTokens,
      cost: (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out,
    });
  }
}
