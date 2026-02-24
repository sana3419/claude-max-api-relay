# claude-max-api-relay

[claude-max-api-proxy](https://github.com/atalovesyou/claude-max-api-proxy) 的前置中继服务，提供请求内容格式规范化和 Token 用量统计。

## 解决的问题

部分客户端发送 OpenAI chat completions 请求时，`messages[].content` 使用对象数组格式（`[{type:"text", text:"..."}]`）而非纯字符串，导致 [claude-max-api-proxy](https://github.com/atalovesyou/claude-max-api-proxy) 收到 `[object Object]`。本服务在转发前自动完成格式转换。

## 架构

```
客户端 → claude-max-api-relay (:3457) → claude-max-api-proxy (:3456)
                    ↓
              log/stats.json（Token 统计）
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `server.js` | HTTP 服务主入口 |
| `config.json` | 配置文件（端口、上游地址等） |
| `normalize.js` | content 格式规范化（对象数组 → 字符串） |
| `tokenizer.js` | 基于 tiktoken 的 Token 计数 |
| `stats.js` | 统计数据读写 |
| `log/stats.json` | 累计统计数据 |

## 配置

编辑 `config.json` 调整参数：

```json
{
  "listen_port": 3457,
  "upstream_host": "127.0.0.1",
  "upstream_port": 3456,
  "max_requests_per_day": 200
}
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `listen_port` | 本服务监听端口 | `3457` |
| `upstream_host` | claude-max-api-proxy 地址 | `127.0.0.1` |
| `upstream_port` | claude-max-api-proxy 端口 | `3456` |
| `max_requests_per_day` | 每日保留的请求明细上限 | `200` |

## 功能

- **内容规范化**：自动将 `[{type:"text", text:"..."}]` 转换为纯字符串
- **Token 统计**：使用 tiktoken 计算每次请求的 input/output tokens
- **流式支持**：SSE 流式响应实时透传，同时收集 content 用于统计
- **透明代理**：非 chat completions 请求直接透传至 claude-max-api-proxy

## 使用

```bash
# 安装依赖
npm install

# 启动
node server.js
```

## 统计数据

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
      "summary": {
        "requests": 100,
        "input_tokens": 50000,
        "output_tokens": 30000
      },
      "days": {
        "24": {
          "summary": {
            "requests": 5,
            "input_tokens": 2500,
            "output_tokens": 1500
          },
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
