// src/api/index.js
import { streamAnthropic } from './anthropic.js';
import { streamOpenAI } from './openai.js';
import { streamGoogle } from './google.js';
import { streamDeepSeek } from './deepseek.js';
import { streamOpenRouter } from './openrouter.js';
import { streamGroq } from './groq.js';
import { streamOllama } from './ollama.js';
import { streamMistral } from './mistral.js'; // Import Mistral
import { getKey, getKeys } from '../db/storage.js';

// --- Provider Streaming Functions Map ---
const PROVIDER_FUNCTIONS = {
  anthropic: streamAnthropic,
  openai: streamOpenAI,
  google: streamGoogle,
  deepseek: streamDeepSeek,
  openrouter: streamOpenRouter,
  groq: streamGroq,
  ollama: streamOllama,
  mistral: streamMistral, // Add Mistral function
};

// --- Model Lists Map ---
const PROVIDER_MODELS = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  google: ['gemini-2.0-flash', 'gemini-2.5-pro-exp-03-25'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  openrouter: ['meta-llama/llama-3.1-8b-instruct:free', 'meta-llama/llama-3.3-70b-instruct:free', 'mistralai/mistral-7b-instruct:free', 'google/gemma-3-27b-it:free', 'deepseek/deepseek-r1:free'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mistral-saba-24b', 'gemma2-9b-it', 'deepseek-r1-distill-llama-70b'],
  ollama: [], // Dynamic, populated based on user input
  mistral: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'], // Add Mistral models
};

// --- All Providers Array ---
const ALL_PROVIDERS = Object.keys(PROVIDER_FUNCTIONS); // ['anthropic', 'openai', 'google', 'deepseek', 'openrouter', 'groq', 'ollama', 'mistral']

// --- Provider Labels Map ---
const PROVIDER_LABELS = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  ollama: 'Ollama',
  mistral: 'Mistral', // Add Mistral label
};

// --- Detect Provider from Key ---
/**
 * Determines the provider associated with an API key based on its prefix.
 * Returns 'unknown' if the prefix doesn't match any known pattern.
 * @param {string} key - The API key string.
 * @returns {string} - The provider name ('anthropic', 'openai', 'google', 'groq', 'openrouter', 'ollama', 'mistral', 'unknown').
 */
function detectProviderFromKey(key) {
  if (typeof key !== 'string') return 'unknown';

  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('AIza')) return 'google';
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('http://') || key.startsWith('https://')) return 'ollama';
  if (key.startsWith('sk-')) return 'openai_or_deepseek'; // Ambiguous case handled elsewhere
  // Mistral has no unique prefix, so any unrecognized key returns 'unknown'
  // This will trigger the provider picker in the UI when adding keys.
  return 'unknown';
}


// --- Infer Provider from Model Name ---
/**
 * Attempts to determine the provider for a given model name based on naming conventions.
 * Falls back to the first provider with a saved key if no match is found.
 * @param {string} modelName - The model identifier string.
 * @param {string} [fallbackProvider] - Optional provider to use if no match found.
 * @returns {string} - The inferred provider name.
 */
function inferProvider(modelName, fallbackProvider = null) {
  if (!modelName) return fallbackProvider || ALL_PROVIDERS.find(p => getKeys(p).length > 0) || 'openai';

  const lowerModelName = modelName.toLowerCase();

  // Check against known provider model patterns
  if (lowerModelName.includes('claude')) return 'anthropic';
  if (lowerModelName.includes('gpt') || lowerModelName.includes('o3')) return 'openai';
  if (lowerModelName.includes('gemini')) return 'google';
  if (lowerModelName.includes('deepseek')) return 'deepseek';
  if (lowerModelName.includes('llama') || lowerModelName.includes('mistral') || lowerModelName.includes('gemma') || lowerModelName.includes('dbrx') || lowerModelName.includes('nousresearch') || lowerModelName.includes('hacker')) return 'openrouter'; // Common OpenRouter models
  if (lowerModelName.includes('grok') || lowerModelName.includes('mixtral') || lowerModelName.includes('gemma') || lowerModelName.includes('llama') || lowerModelName.includes('codestral') || lowerModelName.includes('ministral')) return 'groq'; // Common Groq models
  // No specific pattern for Mistral beyond its name, covered by lowerModelName check below if needed
  if (lowerModelName.includes('mistral')) return 'mistral';

  // If no pattern matched, use the fallback or the first provider with a key
  return fallbackProvider || ALL_PROVIDERS.find(p => getKeys(p).length > 0) || 'openai';
}

// --- Stream Message Function ---
/**
 * Calls the appropriate provider's streaming function.
 * Implements basic failover by trying subsequent keys if the first fails with 402/429/503.
 * @param {string} provider - The provider name.
 * @param {Array<Object>} messages - Chat messages.
 * @param {string} model - Model ID.
 * @param {string} [keyOverride] - Optional key to use instead of the stored one.
 * @param {Object} options - Additional options like temperature.
 * @returns {AsyncGenerator<string>} - Async generator yielding response chunks.
 */
async function* callMessage(provider, messages, model, keyOverride = null, options = {}) {
  const providerFunc = PROVIDER_FUNCTIONS[provider];
  if (!providerFunc) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const keysToTry = keyOverride ? [keyOverride] : getKeys(provider);

  if (!keysToTry.length && !keyOverride) {
    throw new Error(`No keys found for provider: ${provider}`);
  }

  let lastError;
  for (const key of keysToTry) {
    try {
      yield* providerFunc(messages, model, key, options);
      lastError = null; // Clear error if one attempt succeeds
      break; // Exit loop on success
    } catch (error) {
      console.error(`Error calling ${provider} with key [${key.substring(0, 5)}...]:`, error);
      lastError = error;

      // Check for specific retryable errors (402, 429, 503) often related to rate limits or billing
      // Note: Error object structure might vary depending on network/client
      // This assumes the error contains status information if available
      const status = error.status || (error.message && parseInt(error.message.match(/status:\s*(\d+)/)?.[1]));
      if (status && [402, 429, 503].includes(status)) {
        console.log(`Retrying ${provider} with next key due to status ${status}.`);
        continue; // Try the next key
      } else {
        // Non-retryable error, re-throw
        throw error;
      }
    }
  }

  // If loop completes and lastError is still set, all keys failed
  if (lastError) {
    throw lastError;
  }
}


// --- Exports ---
export {
  callMessage,
  detectProviderFromKey, // Export the detection function
  inferProvider,
  ALL_PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_MODELS,
};
