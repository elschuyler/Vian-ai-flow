// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — OpenRouter Provider
// OpenAI-compatible endpoint
// ═══════════════════════════════════════════

import { getKey } from '../db/storage.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export const OPENROUTER_MODELS = [
  { id: 'meta-llama/llama-3.1-8b-instruct:free',  label: 'Llama 3.1 8B (free)'  },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)' },
  { id: 'mistralai/mistral-7b-instruct:free',      label: 'Mistral 7B (free)'    },
  { id: 'google/gemma-3-27b-it:free',              label: 'Gemma 3 27B (free)'   },
  { id: 'deepseek/deepseek-r1:free',               label: 'DeepSeek R1 (free)'   },
];

export async function* streamOpenRouter({ model, messages, system, onUsage, key }) {
  const apiKey = key || getKey('openrouter');
  if (!apiKey) throw new Error('No OpenRouter API key. Open API Manager to add one.');

  const msgs = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://elschuyler.github.io/Vian-ai-flow/',
      'X-Title': 'Vian AI Flow',
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: msgs.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenRouter ${res.status}: ${err?.error?.message || res.statusText}`);
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
    // OpenRouter pricing varies by model — report tokens, cost 0
    onUsage({ inputTokens, outputTokens, cost: 0 });
  }
}
