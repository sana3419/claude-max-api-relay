/**
 * claude-max-api-relay — Unified service
 *
 * Combines claude-max-api-proxy (Claude CLI → OpenAI adapter) with
 * content normalization and token statistics into a single process.
 *
 * Listens on port 3456, directly invokes Claude CLI.
 *
 * Supported endpoints:
 *   GET  /health
 *   GET  /v1/models
 *   POST /v1/chat/completions  — Claude CLI (text + image)
 */

// Clear Claude Code nesting detection so CLI subprocess can run
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;

import express from 'express';
import crypto from 'crypto';
import { createRequire } from 'module';

// Import proxy core modules (subpath imports — no "exports" field in package)
import { ClaudeSubprocess, verifyClaude } from 'claude-max-api-proxy/dist/subprocess/manager.js';
import { openaiToCli } from 'claude-max-api-proxy/dist/adapter/openai-to-cli.js';
import { cliResultToOpenai, createDoneChunk } from 'claude-max-api-proxy/dist/adapter/cli-to-openai.js';

// Import local modules
import { extractImages, cleanupFiles, normalizeMessages } from './normalize.mjs';
import { countTokens, countMessagesTokens } from './tokenizer.mjs';
import { recordRequest } from './stats.mjs';

const require = createRequire(import.meta.url);
const config = require('./config.json');
const PORT = config.port || 3456;

// ── Extended subprocess with image file support ──────────────────────────
class ImageAwareSubprocess extends ClaudeSubprocess {
  buildArgs(prompt, options) {
    const args = super.buildArgs(prompt, options);
    // Append image file paths as positional args (Claude CLI supports this)
    if (options.files?.length) {
      args.push(...options.files);
    }
    return args;
  }
}

const app = express();

// Middleware — increase limit for base64 images
app.use(express.json({ limit: '50mb' }));

// CORS
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

app.options('*', (_req, res) => res.sendStatus(204));

// ── Health ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    provider: 'claude-code-cli',
    timestamp: new Date().toISOString(),
  });
});

// ── Models ──────────────────────────────────────────────────────────────
app.get('/v1/models', (_req, res) => {
  const ts = Math.floor(Date.now() / 1000);
  res.json({
    object: 'list',
    data: [
      { id: 'claude-opus-4',   object: 'model', owned_by: 'anthropic', created: ts },
      { id: 'claude-opus-4-6', object: 'model', owned_by: 'anthropic', created: ts },
      { id: 'claude-sonnet-4', object: 'model', owned_by: 'anthropic', created: ts },
      { id: 'claude-sonnet-4-6', object: 'model', owned_by: 'anthropic', created: ts },
      { id: 'claude-haiku-4',  object: 'model', owned_by: 'anthropic', created: ts },
    ],
  });
});

// ── Chat Completions ────────────────────────────────────────────────────
app.post('/v1/chat/completions', async (req, res) => {
  const body = req.body;
  const reqId = 'req_' + crypto.randomBytes(8).toString('hex');
  const startTime = Date.now();
  const isStream = body.stream === true;
  const model = body.model || 'unknown';

  console.log(`[${new Date().toISOString()}] [${reqId}] POST /v1/chat/completions model=${model} stream=${isStream}`);

  // Validate
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({
      error: { message: 'messages is required and must be a non-empty array', type: 'invalid_request_error', code: 'invalid_messages' },
    });
    return;
  }

  // Extract first user message for logging
  const firstUserMsg = (body.messages || []).find(m => m.role === 'user');
  const firstMessage = firstUserMsg
    ? (typeof firstUserMsg.content === 'string'
        ? firstUserMsg.content
        : Array.isArray(firstUserMsg.content)
          ? firstUserMsg.content.filter(p => p.type === 'text').map(p => p.text).join('')
          : String(firstUserMsg.content)
      ).slice(0, 100)
    : '';

  // Extract images to temp files before normalization
  const imageFiles = await extractImages(body.messages);
  if (imageFiles.length > 0) {
    console.log(`[${reqId}] extracted ${imageFiles.length} image(s) to temp files`);
  }

  // Normalize messages content (object array → string)
  body.messages = normalizeMessages(body.messages);

  // Count input tokens
  const inputTokens = countMessagesTokens(body.messages);

  try {
    // Convert OpenAI format → CLI input
    const cliInput = openaiToCli(body);
    const subprocess = new ImageAwareSubprocess();

    if (isStream) {
      await handleStream(req, res, subprocess, cliInput, imageFiles, { reqId, startTime, model, inputTokens, firstMessage });
    } else {
      await handleNonStream(res, subprocess, cliInput, imageFiles, { reqId, startTime, model, inputTokens, firstMessage });
    }
  } catch (error) {
    cleanupFiles(imageFiles);
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${reqId}] Error:`, message);
    if (!res.headersSent) {
      res.status(500).json({ error: { message, type: 'server_error', code: null } });
    }
  }
});

// ── Streaming handler ───────────────────────────────────────────────────
function handleStream(req, res, subprocess, cliInput, imageFiles, meta) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Request-Id', meta.reqId);
  res.flushHeaders();
  res.write(':ok\n\n');

  return new Promise((resolve) => {
    let isFirst = true;
    let lastModel = meta.model;
    let isComplete = false;
    let collectedContent = '';

    const finish = () => {
      cleanupFiles(imageFiles);
      resolve();
    };

    // Kill subprocess on client disconnect
    res.on('close', () => {
      if (!isComplete) subprocess.kill();
      finish();
    });

    // Stream content deltas
    subprocess.on('content_delta', (event) => {
      const text = event.event.delta?.text || '';
      if (text && !res.writableEnded) {
        collectedContent += text;
        const chunk = {
          id: `chatcmpl-${meta.reqId}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: lastModel,
          choices: [{
            index: 0,
            delta: { role: isFirst ? 'assistant' : undefined, content: text },
            finish_reason: null,
          }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        isFirst = false;
      }
    });

    subprocess.on('assistant', (message) => {
      lastModel = message.message.model;
    });

    subprocess.on('result', (_result) => {
      isComplete = true;
      if (!res.writableEnded) {
        const doneChunk = createDoneChunk(meta.reqId, lastModel);
        res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }

      // Record stats
      const outputTokens = countTokens(collectedContent);
      const elapsed = Date.now() - meta.startTime;
      console.log(`[${meta.reqId}] stream | model=${lastModel} | in=${meta.inputTokens} out=${outputTokens} | ${elapsed}ms`);
      recordRequest({
        id: meta.reqId,
        timestamp: new Date(meta.startTime).toISOString(),
        model: lastModel,
        stream: true,
        input_tokens: meta.inputTokens,
        output_tokens: outputTokens,
        response_time_ms: elapsed,
        first_message: meta.firstMessage,
      });
      finish();
    });

    subprocess.on('error', (error) => {
      console.error(`[${meta.reqId}] Stream error:`, error.message);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: { message: error.message, type: 'server_error', code: null } })}\n\n`);
        res.end();
      }
      finish();
    });

    subprocess.on('close', (code) => {
      if (!res.writableEnded) {
        if (code !== 0 && !isComplete) {
          res.write(`data: ${JSON.stringify({ error: { message: `Process exited with code ${code}`, type: 'server_error', code: null } })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      }
      finish();
    });

    subprocess.start(cliInput.prompt, {
      model: cliInput.model,
      sessionId: cliInput.sessionId,
      files: imageFiles,
    }).catch((err) => {
      console.error(`[${meta.reqId}] Subprocess start error:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: { message: err.message, type: 'server_error', code: null } });
      }
      finish();
    });
  });
}

// ── Non-streaming handler ───────────────────────────────────────────────
function handleNonStream(res, subprocess, cliInput, imageFiles, meta) {
  return new Promise((resolve) => {
    let finalResult = null;

    const finish = () => {
      cleanupFiles(imageFiles);
      resolve();
    };

    subprocess.on('result', (result) => {
      finalResult = result;
    });

    subprocess.on('error', (error) => {
      console.error(`[${meta.reqId}] NonStream error:`, error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: { message: error.message, type: 'server_error', code: null } });
      }
      finish();
    });

    subprocess.on('close', (code) => {
      if (finalResult) {
        const response = cliResultToOpenai(finalResult, meta.reqId);

        // Record stats
        const outputTokens = response.usage?.completion_tokens || countTokens(response.choices?.[0]?.message?.content || '');
        const elapsed = Date.now() - meta.startTime;
        console.log(`[${meta.reqId}] non-stream | model=${meta.model} | in=${meta.inputTokens} out=${outputTokens} | ${elapsed}ms`);
        recordRequest({
          id: meta.reqId,
          timestamp: new Date(meta.startTime).toISOString(),
          model: response.model || meta.model,
          stream: false,
          input_tokens: meta.inputTokens,
          output_tokens: outputTokens,
          response_time_ms: elapsed,
          first_message: meta.firstMessage,
        });

        res.json(response);
      } else if (!res.headersSent) {
        res.status(500).json({
          error: { message: `Claude CLI exited with code ${code} without response`, type: 'server_error', code: null },
        });
      }
      finish();
    });

    subprocess.start(cliInput.prompt, {
      model: cliInput.model,
      sessionId: cliInput.sessionId,
      files: imageFiles,
    }).catch((error) => {
      if (!res.headersSent) {
        res.status(500).json({ error: { message: error.message, type: 'server_error', code: null } });
      }
      finish();
    });
  });
}

// ── Startup ─────────────────────────────────────────────────────────────
async function main() {
  // Verify Claude CLI is available
  const check = await verifyClaude();
  if (!check.ok) {
    console.error('Claude CLI not found:', check.error);
    process.exit(1);
  }
  console.log(`Claude CLI version: ${check.version}`);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`claude-max-api-relay listening on :${PORT}`);
    console.log('Endpoints: /health  /v1/models  /v1/chat/completions  /v1/embeddings');
  });
}

main();
