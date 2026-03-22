/**
 * Normalize OpenAI message content format.
 * Converts object array format [{type:"text", text:"..."}] to plain string.
 * Also handles extraction of base64 images to temp files for CLI.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

/**
 * Extract base64 images from messages and save to temp files.
 * Returns array of temp file paths to pass to Claude CLI.
 */
export async function extractImages(messages) {
  const files = [];
  if (!Array.isArray(messages)) return files;

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      // OpenAI image_url format
      if (part.type === 'image_url' && part.image_url?.url) {
        const url = part.image_url.url;
        if (url.startsWith('data:')) {
          const match = url.match(/^data:([^;]+);base64,(.+)$/s);
          if (match) {
            const mediaType = match[1];
            const ext = mediaType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
            const tmpFile = path.join(os.tmpdir(), `relay_${crypto.randomBytes(8).toString('hex')}.${ext}`);
            fs.writeFileSync(tmpFile, Buffer.from(match[2], 'base64'));
            files.push(tmpFile);
          }
        }
      }
      // Anthropic image format
      if (part.type === 'image' && part.source?.type === 'base64') {
        const ext = (part.source.media_type || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
        const tmpFile = path.join(os.tmpdir(), `relay_${crypto.randomBytes(8).toString('hex')}.${ext}`);
        fs.writeFileSync(tmpFile, Buffer.from(part.source.data, 'base64'));
        files.push(tmpFile);
      }
    }
  }
  return files;
}

/**
 * Clean up temp image files after request completes.
 */
export function cleanupFiles(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch {}
  }
}

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
