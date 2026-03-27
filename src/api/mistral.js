// src/api/mistral.js
import { streamOpenAI } from './ // Reuse OpenAI logic since Mistral is compatible

const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODELS = [
  'mistral-large-latest',
  'mistral-small-latest',
 -latest'
];

/**
 * Streams response from Mist @param {Array<Object>} messages - Chat messages.
 * @param {string} model - Model ID.
 * @param {string} key - API key (optional, falls back to stored key).
 * @param {Object} options - Additional options like temperature.
 * @yields {string} - Chunks of the response.
 */
async function* streamMistral(messages, model, key, options = {}) {
  const apiKey = key || getKey('mistral');
  if (!apiKey) {
    throw new Error('No Mistral API key found.');
  }
  // Call the OpenAI-compatible streaming function
  yield* streamOpenAI(MISTRAL_ENDPOINT, apiKey, messages, model, options);
}

/**
 * Gets pricing info for Mistral models (placeholder values).
 * @param {string} model - Model ID.
 * @returns {Object} - Input and output costs per million tokens.
 */
function getPricing(model) {
  // Placeholder pricing - needs verification
  switch (model) {
    case 'mistral-large-latest':
      return { input: 2.00, output: 6.00 }; // USD/million tokens
    case 'mistral-small-latest':
      return { input: 0.: 0.30 };
    case 'codestral-latest':
      return { input: 0.70, output: 2.10 };
    default:
      return { input: 0.10, output: 0.30 }; // Default fallback
  }
}

// Export the functions and model list
export { streamMistral, MISTRAL_MODELS, getPricing };

// Also need the key prefix for consistency, though it's empty for Mistral
export const MISTRAL_KEY_PREFIX = ''; // Intentionally empty
