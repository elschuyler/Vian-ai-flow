// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — API Router
// Single entry point for all AI providers.
// ═══════════════════════════════════════════

import { streamAnthropic, ANTHROPIC_MODELS } from './anthropic.js';
import { streamOpenAI,    OPENAI_MODELS    } from './openai.js';
import { streamGoogle,    GOOGLE_MODELS    } from './google.js';
import { streamDeepSeek,  DEEPSEEK_MODELS  } from './deepseek.js';
import { getKeys } from '../db/storage.js';

export const ALL_MODELS = [
  ...ANTHROPIC_MODELS.map(m => ({ ...m, provider: 'anthropic', group: 'Anthropic' })),
  ...OPENAI_MODELS.map(m    => ({ ...m, provider: 'openai',    group: 'OpenAI'    })),
  ...GOOGLE_MODELS.map(m    => ({ ...m, provider: 'google',    group: 'Google'    })),
  ...DEEPSEEK_MODELS.map(m  => ({ ...m, provider: 'deepseek',  group: 'DeepSeek'  })),
];

export function getProviderForModel(modelId) {
  return ALL_MODELS.find(m => m.id === modelId)?.provider ?? 'anthropic';
}

// HTTP status codes that mean "quota exhausted / billing / rate limit".
// On these we try the next key. Any other error we throw immediately.
const FAILOVER_CODES = new Set([402, 429, 503]);

function isFailoverError(err) {
  // Providers embed the status code in the message string, e.g. "Anthropic 429: ..."
  if (!err?.message) return false;
  for (const code of FAILOVER_CODES) {
    if (err.message.includes(String(code))) return true;
  }
  return false;
}

/**
 * Stream a message to the selected model with automatic key failover.
 * Tries each saved key for the provider in order.
 * Only fails over on 402 / 429 / 503 errors — other errors throw immediately.
 * Returns an async generator that yields text chunks.
 *
 * @param {object} opts
 * @param {string}   opts.modelId  - model ID string
 * @param {array}    opts.messages - [{role, content}, ...]
 * @param {string}   opts.system   - system prompt string
 * @param {function} opts.onUsage  - callback({inputTokens, outputTokens, cost})
 */
export async function* streamMessage(opts) {
  const provider = getProviderForModel(opts.modelId);
  const keys     = getKeys(provider);

  if (!keys.length) {
    throw new Error(`No ${provider} API key. Open API Manager to add one.`);
  }

  let lastErr = null;

  for (const key of keys) {
    const args = { ...opts, model: opts.modelId, key };
    try {
      switch (provider) {
        case 'anthropic': yield* streamAnthropic(args); break;
        case 'openai':    yield* streamOpenAI(args);    break;
        case 'google':    yield* streamGoogle(args);    break;
        case 'deepseek':  yield* streamDeepSeek(args);  break;
        default: throw new Error(`Unknown provider for model: ${opts.modelId}`);
      }
      return; // success — stop trying keys
    } catch (err) {
      if (isFailoverError(err)) {
        lastErr = err;
        continue; // try next key
      }
      throw err; // non-quota error — throw immediately
    }
  }

  // All keys exhausted
  throw lastErr || new Error(`All ${provider} keys failed.`);
}
