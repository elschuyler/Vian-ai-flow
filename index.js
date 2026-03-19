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

export const ALL_MODELS = [
  ...ANTHROPIC_MODELS.map(m => ({ ...m, provider: 'anthropic', group: 'Anthropic' })),
  ...OPENAI_MODELS.map(m    => ({ ...m, provider: 'openai',    group: 'OpenAI'    })),
  ...GOOGLE_MODELS.map(m    => ({ ...m, provider: 'google',    group: 'Google'    })),
  ...DEEPSEEK_MODELS.map(m  => ({ ...m, provider: 'deepseek',  group: 'DeepSeek'  })),
];

export function getProviderForModel(modelId) {
  return ALL_MODELS.find(m => m.id === modelId)?.provider ?? 'anthropic';
}

/**
 * Stream a message to the selected model.
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
  const args     = { ...opts, model: opts.modelId };

  switch (provider) {
    case 'anthropic': yield* streamAnthropic(args); break;
    case 'openai':    yield* streamOpenAI(args);    break;
    case 'google':    yield* streamGoogle(args);    break;
    case 'deepseek':  yield* streamDeepSeek(args);  break;
    default: throw new Error(`Unknown provider for model: ${opts.modelId}`);
  }
}
