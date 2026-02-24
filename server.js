/**
 * claude-max-api-relay - Content normalization + token statistics
 * Listens on port 3457, proxies to claude-max-api-proxy on port 3456
 */

const http = require('http');
const crypto = require('crypto');
const { normalizeMessages } = require('./normalize');
const { countTokens, countMessagesTokens } = require('./tokenizer');
const { recordRequest } = require('./stats');

const config = require('./config.json');
const UPSTREAM_HOST = config.upstream_host;
const UPSTREAM_PORT = config.upstream_port;
const LISTEN_PORT = config.listen_port;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function proxyRaw(req, res) {
  const options = {
    hostname: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers },
  };
  const proxyReq = http.request(options, proxyRes => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', err => {
    console.error('[proxy] upstream error:', err.message);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream_error', message: err.message }));
  });
  req.pipe(proxyReq);
}

function handleChatCompletions(req, res, bodyBuf) {
  let body;
  try {
    body = JSON.parse(bodyBuf.toString());
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_json' }));
    return;
  }

  const reqId = 'req_' + crypto.randomBytes(8).toString('hex');
  const startTime = Date.now();
  const isStream = !!body.stream;
  const model = body.model || 'unknown';

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

  // Normalize messages content
  body.messages = normalizeMessages(body.messages);

  // Count input tokens
  const inputTokens = countMessagesTokens(body.messages);

  const newBody = Buffer.from(JSON.stringify(body));
  const headers = { ...req.headers };
  headers['content-length'] = newBody.length;
  // Remove transfer-encoding if present since we're sending a complete body
  delete headers['transfer-encoding'];

  const options = {
    hostname: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: req.url,
    method: 'POST',
    headers,
  };

  const proxyReq = http.request(options, proxyRes => {
    if (isStream) {
      handleStreamResponse(req, res, proxyRes, {
        reqId, startTime, model, isStream, inputTokens, firstMessage,
      });
    } else {
      handleNonStreamResponse(req, res, proxyRes, {
        reqId, startTime, model, isStream, inputTokens, firstMessage,
      });
    }
  });

  proxyReq.on('error', err => {
    console.error(`[${reqId}] upstream error:`, err.message);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream_error', message: err.message }));
  });

  proxyReq.end(newBody);
}

function handleNonStreamResponse(req, res, proxyRes, meta) {
  const chunks = [];
  proxyRes.on('data', c => chunks.push(c));
  proxyRes.on('end', () => {
    const buf = Buffer.concat(chunks);
    let outputTokens = 0;

    try {
      const data = JSON.parse(buf.toString());
      if (data.usage && data.usage.completion_tokens) {
        outputTokens = data.usage.completion_tokens;
      } else if (data.choices && data.choices[0] && data.choices[0].message) {
        outputTokens = countTokens(data.choices[0].message.content || '');
      }
    } catch {
      // Can't parse response, skip token counting
    }

    const elapsed = Date.now() - meta.startTime;
    console.log(`[${meta.reqId}] non-stream | model=${meta.model} | in=${meta.inputTokens} out=${outputTokens} | ${elapsed}ms`);

    recordRequest({
      id: meta.reqId,
      timestamp: new Date(meta.startTime).toISOString(),
      model: meta.model,
      stream: false,
      input_tokens: meta.inputTokens,
      output_tokens: outputTokens,
      response_time_ms: elapsed,
      first_message: meta.firstMessage,
    });

    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    res.end(buf);
  });
}

function handleStreamResponse(req, res, proxyRes, meta) {
  // Pass through headers immediately
  res.writeHead(proxyRes.statusCode, proxyRes.headers);

  let collectedContent = '';

  proxyRes.on('data', chunk => {
    // Forward chunk to client immediately
    res.write(chunk);

    // Parse SSE data to collect content
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const obj = JSON.parse(payload);
        const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
        if (delta && delta.content) {
          collectedContent += delta.content;
        }
      } catch {
        // Skip unparseable chunks
      }
    }
  });

  proxyRes.on('end', () => {
    res.end();

    const outputTokens = countTokens(collectedContent);
    const elapsed = Date.now() - meta.startTime;
    console.log(`[${meta.reqId}] stream | model=${meta.model} | in=${meta.inputTokens} out=${outputTokens} | ${elapsed}ms`);

    recordRequest({
      id: meta.reqId,
      timestamp: new Date(meta.startTime).toISOString(),
      model: meta.model,
      stream: true,
      input_tokens: meta.inputTokens,
      output_tokens: outputTokens,
      response_time_ms: elapsed,
      first_message: meta.firstMessage,
    });
  });
}

const server = http.createServer(async (req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // Only intercept POST /v1/chat/completions
  if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
    try {
      const bodyBuf = await readBody(req);
      handleChatCompletions(req, res, bodyBuf);
    } catch (err) {
      console.error('[server] error reading body:', err.message);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_error', message: err.message }));
    }
    return;
  }

  // Everything else: transparent proxy
  proxyRaw(req, res);
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`claude-max-api-relay listening on :${LISTEN_PORT}`);
  console.log(`Proxying to upstream :${UPSTREAM_PORT}`);
});
