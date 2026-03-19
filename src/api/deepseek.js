// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — DeepSeek Provider
// OpenAI-compatible streaming endpoint
// ═══════════════════════════════════════════

import { getKey } from '../db/storage.js';

const ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

export const DEEPSEEK_MODELS = [
  { id: 'deepseek-chat',     label: 'DeepSeek V3' },
  { id: 'deepseek-reasoner', label: 'DeepSeek R1' },
];

// USD per million tokens
const PRICING = {
  'deepseek-chat':     { in: 0.27, out: 1.10 },
  'deepseek-reasoner': { in: 0.55, out: 2.19 },
};

export async function* streamDeepSeek({ model, messages, system, onUsage, key }) {
  const apiKey = key || getKey('deepseek');
  if (!apiKey) throw new Error('No DeepSeek API key. Open API Manager to add one.');

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
    throw new Error(`DeepSeek ${res.status}: ${err?.error?.message || res.statusText}`);
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
