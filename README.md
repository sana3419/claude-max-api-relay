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
- **Prompt Caching** — Automatic Anthropic prompt caching support via `--system-prompt`, reduces costs by 90% on cache hits
- **Image support** — Automatically extracts base64 images (`image_url` / Anthropic `image` format), saves as temp files for Claude CLI, auto-cleanup after use
- **Content normalization** — Converts `[{type:"text", text:"..."}]` to plain strings
- **Token tracking** — Uses tiktoken to count input/output tokens per request, tracks cache hit rates
- **Rate limiting** — Configurable per-minute request limits and daily token quotas
- **Authentication** — Optional API key authentication for secure access
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
  "max_requests_per_day": 200,
  "cache": {
    "ttl": "5m",
    "min_tokens": 1024
  },
  "rate_limit": {
    "max_requests_per_minute": 60,
    "max_tokens_per_day": 1000000
  },
  "auth": {
    "enabled": false,
    "api_keys": []
  }
}
```

| Parameter | Description | Default |
|-----------|-------------|---------|
| `port` | Server listening port | `3456` |
| `max_requests_per_day` | Max request records kept per day | `200` |
| `cache.ttl` | Cache time-to-live (`5m` or `1h`) | `5m` |
| `cache.min_tokens` | Minimum tokens required for caching | `1024` |
| `rate_limit.max_requests_per_minute` | Max requests per minute | `60` |
| `rate_limit.max_tokens_per_day` | Max tokens per day | `1000000` |
| `auth.enabled` | Enable API key authentication | `false` |
| `auth.api_keys` | Array of valid API keys | `[]` |

#### Prompt Caching

The service automatically enables Anthropic prompt caching by passing system messages via `--system-prompt` to Claude CLI. This reduces costs significantly:

- **Cache writes**: 1.25x base price (first time)
- **Cache reads**: 0.1x base price (90% savings)
- **Default TTL**: 5 minutes (configurable to 1 hour at 2x price)

System messages meeting the `min_tokens` threshold are automatically cached. Cache hit rates are tracked in `log/stats.json`.

#### Authentication

To enable API key authentication:

```json
{
  "auth": {
    "enabled": true,
    "api_keys": ["sk-your-secret-key-1", "sk-your-secret-key-2"]
  }
}
```

Clients must include the API key in the `Authorization` header:

```bash
curl -H "Authorization: Bearer sk-your-secret-key-1" \
  http://localhost:3456/v1/chat/completions
```

#### Rate Limiting

Rate limits are enforced per server instance:

- **Per-minute limit**: Prevents burst traffic
- **Daily token limit**: Controls total usage

Requests exceeding limits receive `429 Too Many Requests` responses.

### Usage Stats

Stats are saved in `log/stats.json`, organized by total → month → day:

```json
{
  "total": {
    "requests": 100,
    "input_tokens": 50000,
    "output_tokens": 30000,
    "cache_read_tokens": 15000,
    "cache_write_tokens": 8000
  },
  "cache_stats": {
    "total_requests": 100,
    "cache_hits": 45,
    "hit_rate": "45.00",
    "tokens_saved": 15000
  },
  "months": {
    "2026-02": {
      "summary": {
        "requests": 100,
        "input_tokens": 50000,
        "output_tokens": 30000,
        "cache_read_tokens": 15000,
        "cache_write_tokens": 8000
      },
      "days": {
        "24": {
          "summary": {
            "requests": 5,
            "input_tokens": 2500,
            "output_tokens": 1500,
            "cache_read_tokens": 800,
            "cache_write_tokens": 400
          },
          "requests": [
            {
              "id": "req_xxx",
              "timestamp": "2026-02-24T12:00:00.000Z",
              "model": "claude-opus-4",
              "stream": true,
              "input_tokens": 500,
              "output_tokens": 300,
              "cache_read_input_tokens": 200,
              "cache_creation_input_tokens": 0,
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

**Cache Statistics**:
- `cache_hits`: Number of requests with cache hits
- `hit_rate`: Percentage of requests that hit cache
- `tokens_saved`: Total tokens saved via cache reads
- `cache_read_tokens`: Tokens read from cache (0.1x cost)
- `cache_write_tokens`: Tokens written to cache (1.25x cost)

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
- **提示词缓存**：通过 `--system-prompt` 自动启用 Anthropic 提示词缓存，缓存命中可节省 90% 成本
- **图片支持**：自动提取消息中的 base64 图片（`image_url` / Anthropic `image` 格式），保存为临时文件后传入 Claude CLI，完成后自动清理
- **内容规范化**：自动将 `[{type:"text", text:"..."}]` 转换为纯字符串
- **Token 统计**：使用 tiktoken 计算每次请求的 input/output tokens，追踪缓存命中率
- **速率限制**：可配置每分钟请求数和每日 token 配额
- **身份验证**：可选的 API 密钥认证，保障访问安全
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
  "max_requests_per_day": 200,
  "cache": {
    "ttl": "5m",
    "min_tokens": 1024
  },
  "rate_limit": {
    "max_requests_per_minute": 60,
    "max_tokens_per_day": 1000000
  },
  "auth": {
    "enabled": false,
    "api_keys": []
  }
}
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `port` | 服务监听端口 | `3456` |
| `max_requests_per_day` | 每日保留的请求明细上限 | `200` |
| `cache.ttl` | 缓存有效期（`5m` 或 `1h`） | `5m` |
| `cache.min_tokens` | 缓存所需最小 token 数 | `1024` |
| `rate_limit.max_requests_per_minute` | 每分钟最大请求数 | `60` |
| `rate_limit.max_tokens_per_day` | 每日最大 token 数 | `1000000` |
| `auth.enabled` | 启用 API 密钥认证 | `false` |
| `auth.api_keys` | 有效的 API 密钥数组 | `[]` |

#### 提示词缓存

服务通过 `--system-prompt` 参数将系统消息传递给 Claude CLI，自动启用 Anthropic 提示词缓存，显著降低成本：

- **缓存写入**：1.25 倍基础价格（首次）
- **缓存读取**：0.1 倍基础价格（节省 90%）
- **默认 TTL**：5 分钟（可配置为 1 小时，价格 2 倍）

达到 `min_tokens` 阈值的系统消息会自动缓存。缓存命中率记录在 `log/stats.json` 中。

#### 身份验证

启用 API 密钥认证：

```json
{
  "auth": {
    "enabled": true,
    "api_keys": ["sk-your-secret-key-1", "sk-your-secret-key-2"]
  }
}
```

客户端需在 `Authorization` 头中包含 API 密钥：

```bash
curl -H "Authorization: Bearer sk-your-secret-key-1" \
  http://localhost:3456/v1/chat/completions
```

#### 速率限制

速率限制按服务实例执行：

- **每分钟限制**：防止突发流量
- **每日 token 限制**：控制总用量

超出限制的请求返回 `429 Too Many Requests`。

### 统计数据

统计数据保存在 `log/stats.json`，按 总计 → 月 → 日 分层汇总：

```json
{
  "total": {
    "requests": 100,
    "input_tokens": 50000,
    "output_tokens": 30000,
    "cache_read_tokens": 15000,
    "cache_write_tokens": 8000
  },
  "cache_stats": {
    "total_requests": 100,
    "cache_hits": 45,
    "hit_rate": "45.00",
    "tokens_saved": 15000
  },
  "months": {
    "2026-02": {
      "summary": {
        "requests": 100,
        "input_tokens": 50000,
        "output_tokens": 30000,
        "cache_read_tokens": 15000,
        "cache_write_tokens": 8000
      },
      "days": {
        "24": {
          "summary": {
            "requests": 5,
            "input_tokens": 2500,
            "output_tokens": 1500,
            "cache_read_tokens": 800,
            "cache_write_tokens": 400
          },
          "requests": [
            {
              "id": "req_xxx",
              "timestamp": "2026-02-24T12:00:00.000Z",
              "model": "claude-opus-4",
              "stream": true,
              "input_tokens": 500,
              "output_tokens": 300,
              "cache_read_input_tokens": 200,
              "cache_creation_input_tokens": 0,
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

**缓存统计**：
- `cache_hits`：缓存命中的请求数
- `hit_rate`：缓存命中率百分比
- `tokens_saved`：通过缓存读取节省的 token 总数
- `cache_read_tokens`：从缓存读取的 token（0.1 倍成本）
- `cache_write_tokens`：写入缓存的 token（1.25 倍成本）

## License

MIT
