// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — OpenAI Provider
// Streaming via /v1/chat/completions SSE
// ═══════════════════════════════════════════

import { getKey } from '../db/storage.js';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export const OPENAI_MODELS = [
  { id: 'gpt-4o',      label: 'GPT-4o'      },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'o3-mini',     label: 'o3-mini'     },
];

// USD per million tokens
const PRICING = {
  'gpt-4o':      { in: 2.50, out: 10.00 },
  'gpt-4o-mini': { in: 0.15, out: 0.60  },
  'o3-mini':     { in: 1.10, out: 4.40  },
};

export async function* streamOpenAI({ model, messages, system, onUsage }) {
  const key = getKey('openai');
  if (!key) throw new Error('No OpenAI API key. Open API Manager to add one.');

  const msgs = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: msgs.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI ${res.status}: ${err?.error?.message || res.statusText}`);
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
