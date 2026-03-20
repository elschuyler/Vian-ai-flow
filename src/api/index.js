// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — API Router
// Single entry point for all AI providers.
// ═══════════════════════════════════════════

import { streamAnthropic,  ANTHROPIC_MODELS  } from './anthropic.js';
import { streamOpenAI,     OPENAI_MODELS     } from './openai.js';
import { streamGoogle,     GOOGLE_MODELS     } from './google.js';
import { streamDeepSeek,   DEEPSEEK_MODELS   } from './deepseek.js';
import { streamOpenRouter, OPENROUTER_MODELS } from './openrouter.js';
import { streamGroq,       GROQ_MODELS       } from './groq.js';
import { streamOllama,     OLLAMA_MODELS     } from './ollama.js';
import { getKeys } from '../db/storage.js';

export const ALL_MODELS = [
  ...ANTHROPIC_MODELS.map(m  => ({ ...m, provider: 'anthropic',  group: 'Anthropic'  })),
  ...OPENAI_MODELS.map(m     => ({ ...m, provider: 'openai',     group: 'OpenAI'     })),
  ...GOOGLE_MODELS.map(m     => ({ ...m, provider: 'google',     group: 'Google'     })),
  ...DEEPSEEK_MODELS.map(m   => ({ ...m, provider: 'deepseek',   group: 'DeepSeek'   })),
  ...OPENROUTER_MODELS.map(m => ({ ...m, provider: 'openrouter', group: 'OpenRouter' })),
  ...GROQ_MODELS.map(m       => ({ ...m, provider: 'groq',       group: 'Groq'       })),
  ...OLLAMA_MODELS.map(m     => ({ ...m, provider: 'ollama',     group: 'Ollama'     })),
];

export function getProviderForModel(modelId) {
  return ALL_MODELS.find(m => m.id === modelId)?.provider ?? null;
}

// HTTP status codes that mean quota / rate-limit. Try next key on these.
const FAILOVER_CODES = new Set([402, 429, 503]);

function isFailoverError(err) {
  if (!err?.message) return false;
  for (const code of FAILOVER_CODES) {
    if (err.message.includes(String(code))) return true;
  }
  return false;
}

/**
 * Stream a message to the selected model with automatic key failover.
 *
 * Because the top bar is now a free-text combo input, modelId may be any
 * string the user typed. We first try to match it against the known model
 * list to find the provider. If not found we fall back to checking which
 * providers have keys saved and try them in order:
 *   openrouter → groq → ollama → openai → deepseek → anthropic → google
 *
 * @param {object} opts
 * @param {string}   opts.modelId
 * @param {array}    opts.messages
 * @param {string}   opts.system
 * @param {function} opts.onUsage
 */
export async function* streamMessage(opts) {
  const modelId  = opts.modelId;
  let   provider = getProviderForModel(modelId);

  // Unknown model ID — infer provider from saved keys + model name heuristics
  if (!provider) {
    provider = inferProvider(modelId);
  }

  if (!provider) {
    throw new Error(`Cannot determine provider for model "${modelId}". Add a key in API Manager.`);
  }

  const keys = getKeys(provider);

  if (!keys.length) {
    throw new Error(`No ${provider} key saved. Open API Manager to add one.`);
  }

  let lastErr = null;

  for (const key of keys) {
    const args = { ...opts, model: modelId, key };
    try {
      switch (provider) {
        case 'anthropic':  yield* streamAnthropic(args);  break;
        case 'openai':     yield* streamOpenAI(args);     break;
        case 'google':     yield* streamGoogle(args);     break;
        case 'deepseek':   yield* streamDeepSeek(args);   break;
        case 'openrouter': yield* streamOpenRouter(args); break;
        case 'groq':       yield* streamGroq(args);       break;
        case 'ollama':     yield* streamOllama(args);     break;
        default: throw new Error(`Unknown provider: ${provider}`);
      }
      return; // success
    } catch (err) {
      if (isFailoverError(err)) { lastErr = err; continue; }
      throw err;
    }
  }

  throw lastErr || new Error(`All ${provider} keys failed.`);
}

// ─── Provider inference for free-text model IDs ──────────────
// When the user types a model name that isn't in our known list,
// we guess the provider from the model ID string, then fall back
// to whichever provider has a saved key.

const PROVIDER_PRIORITY = [
  'openrouter', 'groq', 'ollama', 'openai', 'deepseek', 'anthropic', 'google',
];

function inferProvider(modelId) {
  const id = modelId.toLowerCase();

  // Strong string signals
  if (id.includes('claude'))      return 'anthropic';
  if (id.includes('gemini'))      return 'google';
  if (id.includes('gpt') || id.includes('o1') || id.includes('o3')) return 'openai';
  if (id.includes('deepseek'))    return 'deepseek';
  if (id.includes('groq'))        return 'groq';

  // OpenRouter models always contain a slash (owner/model)
  if (id.includes('/'))           return 'openrouter';

  // Fall back to first provider that has a key saved
  for (const p of PROVIDER_PRIORITY) {
    if (getKeys(p).length) return p;
  }

  return null;
}
