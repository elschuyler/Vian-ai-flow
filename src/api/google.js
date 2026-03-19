// src/api/google.js
// Fixed version: single streaming request, token usage extracted from final chunk

export const GOOGLE_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-pro-exp-03-25',
];

/**
 * Calls Google Gemini API with streaming support.
 * @param {Array} messages - Conversation history (role/content)
 * @param {Object} contextBlocks - Active context blocks to prepend
 * @param {string} model - Model name (e.g., 'gemini-2.0-flash')
 * @param {string} apiKey - Google API key
 * @param {function} onChunk - Callback for each stream chunk
 * @param {function} onComplete - Callback with final token usage
 */
export async function streamGoogle(messages, contextBlocks, model, apiKey, onChunk, onComplete) {
  // 1. Prepare the request payload
  const systemPrompt = buildSystemPrompt(contextBlocks);
  const geminiMessages = convertToGeminiFormat(messages, systemPrompt);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: geminiMessages,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google API error (${response.status}): ${error}`);
  }

  // 2. Process the SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const jsonStr = trimmed.substring(5).trim();
      if (jsonStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(jsonStr);
        const candidate = parsed.candidates?.[0];
        if (!candidate) continue;

        // Extract text chunk
        const text = candidate.content?.parts?.[0]?.text;
        if (text) {
          fullText += text;
          onChunk(text);
        }

        // Extract token usage from final chunk (if present)
        if (parsed.usageMetadata) {
          totalInputTokens = parsed.usageMetadata.promptTokenCount || 0;
          totalOutputTokens = parsed.usageMetadata.candidatesTokenCount || 0;
        }
      } catch (e) {
        console.warn('Failed to parse SSE chunk:', e, jsonStr);
      }
    }
  }

  // 3. Call onComplete with token usage (no second request needed)
  onComplete({
    text: fullText,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  });
}

/**
 * Builds system prompt from active context blocks.
 * @param {Object} contextBlocks - { blockName: { content, enabled } }
 * @returns {string}
 */
function buildSystemPrompt(contextBlocks) {
  const activeBlocks = Object.values(contextBlocks || {})
    .filter(block => block.enabled)
    .map(block => block.content)
    .join('\n\n');
  return activeBlocks || '';
}

/**
 * Converts our internal message format to Gemini's expected structure.
 * @param {Array} messages - [{ role: 'user'|'assistant', content }]
 * @param {string} systemPrompt - Optional system instructions
 * @returns {Array} Gemini contents array
 */
function convertToGeminiFormat(messages, systemPrompt) {
  const contents = [];

  // If system prompt exists, prepend as a user message with instruction
  if (systemPrompt) {
    contents.push({
      role: 'user',
      parts: [{ text: `[System instruction]\n${systemPrompt}` }],
    });
  }

  for (const msg of messages) {
    // Gemini uses 'user' and 'model' roles
    const role = msg.role === 'assistant' ? 'model' : 'user';
    contents.push({
      role: role,
      parts: [{ text: msg.content }],
    });
  }

  return contents;
}
