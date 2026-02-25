# claude-max-api-relay

[English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

An all-in-one Claude Max API relay service that integrates [claude-max-api-proxy](https://github.com/atalovesyou/claude-max-api-proxy) as a dependency, providing an OpenAI-compatible API interface, image support, content normalization, and token usage tracking.

One process, one port, directly calls Claude CLI.

### Architecture

```
Client → claude-max-api-relay (:3456) → Claude CLI (text + images)
                    ↓                         ↓
              log/stats.json          /tmp/relay_*.jpg (auto-cleanup)
```

### Features

- **OpenAI-compatible API** — Drop-in replacement for OpenAI SDK, works with any compatible client
- **Image support** — Automatically extracts base64 images (`image_url` / Anthropic `image` format), saves as temp files for Claude CLI, auto-cleanup after use
- **Content normalization** — Converts `[{type:"text", text:"..."}]` to plain strings
- **Token tracking** — Uses tiktoken to count input/output tokens per request
- **Streaming** — SSE streaming with real-time passthrough + content collection for stats
- **Session management** — Maps `user` field to Claude CLI sessions
- **Large payloads** — 50MB request body limit (supports large image uploads)

### Supported Models

| Model ID | CLI Model |
|---------|---------|
| `claude-opus-4` | `opus` |
| `claude-opus-4-6` | `opus` |
| `claude-sonnet-4` | `sonnet` |
| `claude-sonnet-4-6` | `sonnet` |
| `claude-haiku-4` | `haiku` |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/models` | GET | List available models |
| `/v1/chat/completions` | POST | OpenAI-compatible chat completions (with image support) |

### Quick Start

```bash
# Install dependencies
npm install

# Start the server
node server.mjs
```

### Configuration

Edit `config.json`:

```json
{
  "port": 3456,
  "max_requests_per_day": 200
}
```

| Parameter | Description | Default |
|-----------|-------------|---------|
| `port` | Server listening port | `3456` |
| `max_requests_per_day` | Max request records kept per day | `200` |

### Usage Stats

Stats are saved in `log/stats.json`, organized by total → month → day:

```json
{
  "total": {
    "requests": 100,
    "input_tokens": 50000,
    "output_tokens": 30000
  },
  "months": {
    "2026-02": {
      "summary": { "requests": 100, "input_tokens": 50000, "output_tokens": 30000 },
      "days": {
        "24": {
          "summary": { "requests": 5, "input_tokens": 2500, "output_tokens": 1500 },
          "requests": [
            {
              "id": "req_xxx",
              "timestamp": "2026-02-24T12:00:00.000Z",
              "model": "claude-opus-4",
              "stream": true,
              "input_tokens": 500,
              "output_tokens": 300,
              "response_time_ms": 2300,
              "first_message": "Tell me about..."
            }
          ]
        }
      }
    }
  }
}
```

---

<a id="中文"></a>

## 中文

一体化 Claude Max API 服务，将 [claude-max-api-proxy](https://github.com/atalovesyou/claude-max-api-proxy) 作为依赖集成，提供 OpenAI 兼容接口、图片支持、内容格式规范化和 Token 用量统计。

一个进程、一个端口，直接调用 Claude CLI。

### 架构

```
客户端 → claude-max-api-relay (:3456) → Claude CLI（文本 + 图片）
                    ↓                         ↓
              log/stats.json          /tmp/relay_*.jpg（自动清理）
```

### 功能

- **OpenAI 兼容接口**：直接替代 OpenAI SDK，支持所有兼容客户端
- **图片支持**：自动提取消息中的 base64 图片（`image_url` / Anthropic `image` 格式），保存为临时文件后传入 Claude CLI，完成后自动清理
- **内容规范化**：自动将 `[{type:"text", text:"..."}]` 转换为纯字符串
- **Token 统计**：使用 tiktoken 计算每次请求的 input/output tokens
- **流式支持**：SSE 流式响应实时透传，同时收集 content 用于统计
- **会话管理**：通过 `user` 字段映射 Claude CLI session
- **请求体限制**：50MB（支持大图传输）

### 支持模型

| 模型 ID | 对应 CLI |
|---------|---------|
| `claude-opus-4` | `opus` |
| `claude-opus-4-6` | `opus` |
| `claude-sonnet-4` | `sonnet` |
| `claude-sonnet-4-6` | `sonnet` |
| `claude-haiku-4` | `haiku` |

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/v1/models` | GET | 返回可用模型列表 |
| `/v1/chat/completions` | POST | OpenAI 兼容 chat completions（支持图片） |

### 使用

```bash
# 安装依赖
npm install

# 启动
node server.mjs
```

### 配置

编辑 `config.json`：

```json
{
  "port": 3456,
  "max_requests_per_day": 200
}
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `port` | 服务监听端口 | `3456` |
| `max_requests_per_day` | 每日保留的请求明细上限 | `200` |

### 统计数据

统计数据保存在 `log/stats.json`，按 总计 → 月 → 日 分层汇总：

```json
{
  "total": {
    "requests": 100,
    "input_tokens": 50000,
    "output_tokens": 30000
  },
  "months": {
    "2026-02": {
      "summary": { "requests": 100, "input_tokens": 50000, "output_tokens": 30000 },
      "days": {
        "24": {
          "summary": { "requests": 5, "input_tokens": 2500, "output_tokens": 1500 },
          "requests": [
            {
              "id": "req_xxx",
              "timestamp": "2026-02-24T12:00:00.000Z",
              "model": "claude-opus-4",
              "stream": true,
              "input_tokens": 500,
              "output_tokens": 300,
              "response_time_ms": 2300,
              "first_message": "请帮我写一个..."
            }
          ]
        }
      }
    }
  }
}
```

## License

MIT
