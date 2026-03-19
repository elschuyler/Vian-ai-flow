// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — Google Provider
// Streaming via generativelanguage SSE
// ═══════════════════════════════════════════

import { getKey } from '../db/storage.js';

export const GOOGLE_MODELS = [
  { id: 'gemini-2.0-flash',         label: 'Gemini 2.0 Flash'   },
  { id: 'gemini-2.5-pro-exp-03-25', label: 'Gemini 2.5 Pro'     },
];

// USD per million tokens
const PRICING = {
  'gemini-2.0-flash':         { in: 0.10, out: 0.40 },
  'gemini-2.5-pro-exp-03-25': { in: 1.25, out: 5.00 },
};

export async function* streamGoogle({ model, messages, system, onUsage, key }) {
  const apiKey = key || getKey('google');
  if (!apiKey) throw new Error('No Google API key. Open API Manager to add one.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  // Build contents array — system prompt injected as first user turn
  const contents = [];
  if (system) {
    contents.push({
      role: 'user',
      parts: [{ text: `[System instruction]\n${system}` }],
    });
  }
  for (const msg of messages) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Google ${res.status}: ${err?.error?.message || res.statusText}`);
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
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr === '[DONE]') continue;
      try {
        const parsed    = JSON.parse(jsonStr);
        const candidate = parsed.candidates?.[0];
        if (!candidate) continue;

        const text = candidate.content?.parts?.[0]?.text;
        if (text) yield text;

        if (parsed.usageMetadata) {
          inputTokens  = parsed.usageMetadata.promptTokenCount     || 0;
          outputTokens = parsed.usageMetadata.candidatesTokenCount || 0;
        }
      } catch { /* skip malformed */ }
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
