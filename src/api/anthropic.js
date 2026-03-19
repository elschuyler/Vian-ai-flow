// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — Anthropic Provider
// Streaming via /v1/messages SSE
// ═══════════════════════════════════════════

import { getKey } from '../db/storage.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-4-20250514',  label: 'Claude Sonnet 4'  },
  { id: 'claude-opus-4-20250514',    label: 'Claude Opus 4'    },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

// USD per million tokens
const PRICING = {
  'claude-sonnet-4-20250514':  { in: 3.00,  out: 15.00 },
  'claude-opus-4-20250514':    { in: 15.00, out: 75.00 },
  'claude-haiku-4-5-20251001': { in: 0.80,  out: 4.00  },
};

export async function* streamAnthropic({ model, messages, system, onUsage, key }) {
  const apiKey = key || getKey('anthropic');
  if (!apiKey) throw new Error('No Anthropic API key. Open API Manager to add one.');

  const body = {
    model,
    max_tokens: 8192,
    stream: true,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  };
  if (system) body.system = system;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Anthropic ${res.status}: ${err?.error?.message || res.statusText}`);
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
        const ev = JSON.parse(raw);
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          yield ev.delta.text;
        }
        if (ev.type === 'message_start' && ev.message?.usage) {
          inputTokens = ev.message.usage.input_tokens || 0;
        }
        if (ev.type === 'message_delta' && ev.usage) {
          outputTokens = ev.usage.output_tokens || 0;
        }
      } catch { /* skip malformed lines */ }
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
