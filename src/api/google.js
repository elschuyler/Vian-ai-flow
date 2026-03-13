// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — Google Gemini Provider
// Streaming via streamGenerateContent SSE
// ═══════════════════════════════════════════

import { getKey } from '../db/storage.js';

export const GOOGLE_MODELS = [
  { id: 'gemini-2.0-flash',         label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.5-pro-exp-03-25', label: 'Gemini 2.5 Pro'   },
];

// USD per million tokens
const PRICING = {
  'gemini-2.0-flash':         { in: 0.10, out: 0.40  },
  'gemini-2.5-pro-exp-03-25': { in: 1.25, out: 10.00 },
};

export async function* streamGoogle({ model, messages, system, onUsage }) {
  const key = getKey('google');
  if (!key) throw new Error('No Google API key. Open API Manager to add one.');

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}` +
    `:streamGenerateContent?alt=sse&key=${key}`;

  const contents = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    contents,
    generationConfig: { maxOutputTokens: 8192 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      try {
        const ev   = JSON.parse(raw);
        const text = ev.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
        const u = ev.usageMetadata;
        if (u) {
          inputTokens  = u.promptTokenCount     || 0;
          outputTokens = u.candidatesTokenCount || 0;
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
