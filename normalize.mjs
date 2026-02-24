/**
 * Normalize OpenAI message content format.
 * Converts object array format [{type:"text", text:"..."}] to plain string.
 */

export function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join('');
  }
  return String(content);
}

export function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(msg => ({
    ...msg,
    content: normalizeContent(msg.content),
  }));
}
