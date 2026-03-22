/**
 * Token counting using tiktoken (cl100k_base as approximation for Claude).
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let encoder = null;

function getEncoder() {
  if (!encoder) {
    const { encoding_for_model } = require('tiktoken');
    encoder = encoding_for_model('gpt-4o');
  }
  return encoder;
}

export function countTokens(text) {
  if (!text) return 0;
  try {
    const enc = getEncoder();
    const tokens = enc.encode(text);
    return tokens.length;
  } catch {
    // Fallback: rough estimate
    return Math.ceil(text.length / 4);
  }
}

export function countMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    total += countTokens(content);
    // Overhead per message (role, separators)
    total += 4;
  }
  return total;
}
