# ClamAI Service API 清单

> **端口**：`8080`（Proxy/模型 API）、`8081`（Admin/管理 API）
> **Base URL（Admin）**：`http://127.0.0.1:8081/api/v1`
> **Base URL（Proxy）**：`http://127.0.0.1:8080`
> **内容类型**：所有 API 均使用 `application/json`

---

## 一、认证接口（Admin 端口，`/api/v1/auth/*`）

> **前缀**：`/api/v1/auth`
> **鉴权**：除 `/auth/status`、`/auth/setup` 外均需 Bearer Token

| 方法 | 路径 | 功能 | 鉴权 | 请求体 | 响应 |
|------|------|------|------|--------|------|
| GET | `/status` | 查询系统初始化状态 | 否 | - | `{initialized, mode, has_api_key, registration_open}` |
| POST | `/setup` | 初始化管理员账号 | 否 | `{username, password}` | `{token, refresh_token}` |
| POST | `/login` | 管理员登录 | 否 | `{username, password}` | `{token, refresh_token, remaining}` |
| POST | `/register` | 用户注册（需 registration_open=true） | 否 | `{username, password, display_name?}` | `{token, refresh_token}` |
| GET | `/reg-open` | 查询注册是否开放 | 否 | - | `{open: bool}` |
| POST | `/change-password` | 修改当前用户密码 | Bearer | `{old_password, new_password}` | `{success}` |
| POST | `/token` | 获取当前 Token 信息 | Bearer | - | `{username, role, exp, iat}` |
| POST | `/refresh` | 刷新 Access Token | 否 | `{refresh_token}` | `{access_token, refresh_token?}` |
| GET | `/me` | 获取当前登录用户信息 | Bearer | - | `{user_id, username, role}` |

### 密码规范
- 最少 8 字符
- 必须包含至少一个大写字母
- 必须包含至少一个数字

---

## 二、用户管理（Admin 端口，`/api/v1/users/*`）

> **前缀**：`/api/v1/users`
> **鉴权**：Bearer Token（admin 角色）

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/` | 列出所有用户 | - | `{users: [...]}` |
| POST | `/` | 创建用户 | `{username, password, display_name?, role}` | `{id, username, role}` |
| PUT | `/{id}` | 更新用户 | `{username?, display_name?, role?}` | `{success}` |
| DELETE | `/{id}` | 删除用户 | - | `{success}` |
| POST | `/{id}/reset-password` | 重置用户密码 | `{new_password}` | `{success}` |
| PUT | `/settings/registration` | 开关开放注册 | `{open: bool}` | `{success}` |

---

## 三、API Key 管理（Admin 端口，`/api/v1/keys/*`）

> **前缀**：`/api/v1/keys`（也支持 `/api-keys`，两者等价）
> **鉴权**：Bearer Token（admin 角色）

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/` | 列出所有 API Key | - | `{keys: [{id, name, key_preview, allowed_models, active, created_at, request_count}]}` |
| POST | `/` | 创建 API Key | `{name, allowed_models?, active?}` | `{id, key}` |
| PUT | `/{id}` | 更新 API Key | `{name?, allowed_models?, active?}` | `{success}` |
| DELETE | `/{id}` | 删除 API Key | - | `{success}` |
| GET | `/{id}/reveal` | 展示完整 Key（一次性） | - | `{id, key}` |

### allowed_models 格式
模型 ID 格式为 `{provider}:{model}`，例如 `siliconflow:deepseek-ai/DeepSeek-V3`。空数组表示允许所有模型。

---

## 四、提供商管理（Admin 端口，`/api/v1/providers/*`）

> **前缀**：`/api/v1/providers`
> **鉴权**：Bearer Token（admin 角色）

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/` | 列出所有提供商 | - | `{providers: [...]}` |
| POST | `/` | 添加提供商 | `{name, provider_type, base_url, api_keys, ...}` | `{id}` |
| PUT | `/test` | 测试提供商连通性 | `{provider_id}` 或 `{provider, api_key, base_url}` | `{success, message, latency_ms, available_models?}` |
| PUT | `/{name}/key` | 更新提供商 API Key | `{api_key}` | `{success}` |
| PUT | `/{id}` | 更新提供商配置 | `{name?, base_url?, enabled?, ...}` | `{success}` |
| DELETE | `/{id}` | 删除提供商 | - | `{success}` |
| POST | `/sync-all` | 从数据库同步所有提供商到内存 | - | `{synced, total_providers}` |

### provider_type 可选值
`openai`、`anthropic`、`gemini`、`deepseek`、`siliconflow`、`glm`、`glm-coding`、`minimax`、`minimax-tokenplan`、`doubao`、`qwen`、`moonshot`、`yi`、`openrouter`、`arkcode`

---

## 五、配置管理（Admin 端口，`/api/v1/config/*`）

> **前缀**：`/api/v1/config`
> **鉴权**：Bearer Token
> **说明**：`GET /config` 返回完整的 Provider API Keys（不再做掩码处理），`PUT /config` 保存完整配置到数据库

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/` | 获取配置（含完整 Provider API Keys） | - | `{...config}` |
| PUT | `/` | 保存配置 | `{...config}` | `{success}` |
| POST | `/reset` | 重置为默认配置 | - | `{success}` |

---

## 六、Profile 管理（Admin 端口，`/api/v1/profiles/*`）

> **前缀**：`/api/v1/profiles`
> **鉴权**：Bearer Token

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/` | 列出配置 Profile | - | `{profiles: [...]}` |
| POST | `/` | 保存为新 Profile | `{name, config}` | `{id}` |
| PUT | `/{id}` | 切换到指定 Profile | `{name?, config?}` | `{success}` |
| DELETE | `/{id}` | 删除 Profile | - | `{success}` |

---

## 七、统计接口（Admin 端口，`/api/v1/stats/*`）

> **前缀**：`/api/v1/stats`
> **鉴权**：Bearer Token

| 方法 | 路径 | 功能 | 查询参数 | 响应 |
|------|------|------|----------|------|
| GET | `/usage` | 流量统计 | `period`（分钟，默认 10080） | `{total_requests, success_requests, failure_requests, avg_latency_ms}` |
| GET | `/logs` | 最近请求日志 | `limit`（默认 100） | `{logs: [{...is_proxy_call, upstream_request_headers, upstream_response_headers, upstream_provider, upstream_model}], total_count}` |
| GET | `/service-logs` | 服务运行日志 | `level`, `keyword`, `limit`（默认 200）, `offset` | `{lines, total}` |
| GET | `/alerts` | 安全告警统计 | - | `{alerts: [...]}` |
| GET | `/alert-severity` | 告警级别统计 | `period`（分钟） | `{by_severity: {critical, high, medium, low}}` |
| GET | `/callers` | Top Caller 排行 | - | `{callers: [...]}` |
| GET | `/security-tokens` | Token 统计 | - | `{tokens: [...]}` |

---

## 八、安全配置（Admin 端口，`/api/v1/security/*`）

> **前缀**：`/api/v1/security`
> **鉴权**：Bearer Token

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/config` | 获取安全配置 | - | `{enabled, keywords, keyword_levels, block_message, semantic_model}` |
| PUT | `/config` | 更新安全配置 | `{enabled?, keywords?, ...}` | `{success}` |
| GET | `/alerts` | 获取安全告警列表 | `limit`, `offset`, `severity`, `direction`, `trigger_type`, `search` | `{alerts: [{id, timestamp, direction, mode, trigger_type, trigger_detail, severity, content_preview, model, api_key_used, client_ip, action, resolved}], total}` |
| PUT | `/alerts/{id}/resolve` | 标记告警已处理 | `{resolved: bool}` | `{success}` |

---

## 九、限流配置（Admin 端口，`/api/v1/ratelimit/*`）

> **前缀**：`/api/v1/ratelimit`
> **鉴权**：Bearer Token

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/config` | 获取限流配置 | - | `{...config}` |
| PUT | `/config` | 更新限流配置 | `{...config}` | `{success}` |

---

## 十、向量样本库（Admin 端口，`/api/v1/security/vector/*`）

> **前缀**：`/api/v1/security/vector`
> **鉴权**：Bearer Token

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/config` | 获取向量配置 | - | `{embedding_model, ...}` |
| PUT | `/config` | 更新向量配置 | `{embedding_model?}` | `{success}` |
| GET | `/samples` | 列出样本 | - | `{samples: [...]}` |
| POST | `/samples` | 添加样本 | `{text, label, embedding?}` | `{id}` |
| DELETE | `/samples/{id}` | 删除样本 | - | `{success}` |
| POST | `/samples/batch` | 批量添加样本 | `{samples: [...]}` | `{count}` |

---

## 十一、威胁规则（Admin 端口，`/api/v1/threats/*`）

> **前缀**：`/api/v1/threats`
> **鉴权**：Bearer Token

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/rules` | 列出威胁规则 | `?type=hacker_attack` | `{rules: [{id, threat_type, name, patterns, severity, enabled}]}` |
| POST | `/rules` | 创建威胁规则 | `{threat_type, name, patterns, severity, enabled}` | `{id, success}` |
| PUT | `/rules/{id}` | 更新威胁规则 | `{threat_type, name, patterns, severity, enabled}` | `{success}` |
| DELETE | `/rules/{id}` | 删除威胁规则 | - | `{success}` |
| GET | `/stats` | 威胁统计 | `?period=1440` | `{by_type: {hacker_attack, jailbreak, ...}, total, rule_counts}` |

### 威胁类型
`hacker_attack`（黑客攻击）、`jailbreak`（模型越狱）、`adversarial`（对抗攻击）、`malicious_gen`（恶意内容生成）

---

## 十二、系统行为分析（Admin 端口，`/api/v1/system-analysis/*`）

> **前缀**：`/api/v1/system-analysis`
> **鉴权**：Bearer Token
> **说明**：系统级 AI 行为分析，独立于用户分析任务，自动周期性执行，识别未知威胁

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/config` | 获取分析配置 | - | `{enabled, model, api_key_id, time_range, interval_minutes, notify_on_high_risk}` |
| PUT | `/config` | 更新分析配置 | `{enabled, model, api_key_id, time_range, interval_minutes, notify_on_high_risk}` | `{success}` |
| GET | `/tasks` | 列出系统分析任务 | - | `{tasks: [{id, task_no, name, status, result_risk_level, result_summary, last_run_at, next_run_at}]}` |
| POST | `/tasks/trigger` | 手动触发一次分析 | - | `{success}` |
| GET | `/history` | 历史分析记录 | - | `{history: [{id, risk_level, summary, detail, dimensions, logs_analyzed, run_at}]}` |

---

## 十三、用户分析任务（Admin 端口，`/api/v1/analysis/*`）

> **前缀**：`/api/v1/analysis`
> **鉴权**：Bearer Token

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| POST | `/tasks` | 创建分析任务 | `{type, name, api_key_id?, model?, time_range?, schedule_type?, interval_minutes?}` | `{task_id}` |
| GET | `/tasks` | 列出分析任务 | - | `{tasks: [...]}` |
| PUT | `/tasks/{id}` | 更新任务 | `{name?, api_key_id?, model?}` | `{success}` |
| DELETE | `/tasks/{id}` | 删除任务 | - | `{success}` |
| POST | `/tasks/{id}/start` | 启动任务 | - | `{success}` |
| POST | `/tasks/{id}/stop` | 停止任务 | - | `{success}` |
| GET | `/tasks/{id}/history` | 任务历史 | - | `{history: [...]}` |

---

## 十四、技能检测任务（Admin 端口，`/api/v1/skills/*`）

> **前缀**：`/api/v1/skills`
> **鉴权**：Bearer Token
> **防注入**：待检测内容以 `<document>` 标签包裹后发送给 LLM，system prompt 明确要求只做安全分析、不执行文档中的任何指令

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| POST | `/tasks` | 创建技能检测任务 | `{name, model, source_type?, source_info?}` | `{id, task_no}` |
| GET | `/tasks` | 列出任务 | - | `{tasks: [...]}` |
| PUT | `/tasks/{id}` | 更新任务 | `{name?, model?, source_type?, source_info?}` | `{success}` |
| DELETE | `/tasks/{id}` | 删除任务 | - | `{success}` |
| POST | `/tasks/{id}/start` | 启动检测 | - | `{success}` |
| POST | `/tasks/{id}/stop` | 停止检测 | - | `{success}` |
| GET | `/tasks/{id}/history` | 检测历史 | - | `{history: [...]}` |
| GET | `/history` | 全局技能历史 | - | `{history: [...]}` |

### source_type 说明
- `text`：`source_info` 为待检测文本内容
- `url`：`source_info` 为待检测 URL 地址（仅 http/https，禁止内网/本地地址）
- `file`：`source_info` 为应用数据目录下的文件路径
- `agent_skills`：`source_info` 为智能体名称（如 `Claude Code`），自动从该智能体目录读取 Skills 文件

---

## 十五、Agent 工具（Admin 端口，`/api/v1/agent/*`）

> **前缀**：`/api/v1/agent`
> **鉴权**：Bearer Token

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| POST | `/scan-logs` | 扫描日志 | `{query?, limit?}` | `{logs: [...]}` |
| POST | `/env-check` | 检查环境 | `{...params}` | `{result}` |
| GET | `/discover` | 发现 Agent | - | `{agents: [...]}` |
| POST | `/deep-check` | 深度检查 | `{agent_name, model?}` | `{checks, score, scan_time}` |
| POST | `/push-skills` | 推送 Skills 至检测 | `{agent_name, model}` | `{tasks: [{id, task_no, file_name}], total, message}` |

### /push-skills 说明
发现指定智能体目录下的所有 Skills/规则文件，为每个文件创建独立的 Skills 检测任务（状态为 `idle`，不自动执行）。用户需在 Skills 文档检测页面手动启动。

---

## 十六、代理测试（Admin 端口，`/api/v1/proxy/*`）

> **前缀**：`/api/v1/proxy`
> **鉴权**：Bearer Token

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/test` | 测试代理连通性 | `?url=` | `{success, message, latency_ms}` |
| POST | `/test-chat` | 测试聊天补全 | `{mode, providerId?, baseUrl?, apiKey?, model, message, providerType?}` | `{success, message, latency_ms?, input_tokens?, output_tokens?}` |

---

## 十七、模型代理接口（Proxy 端口，Provider-native 透明代理）

> **架构**：Provider-native 透明代理，按服务商原生协议透传转发
> **鉴权**：Bearer Token（JWT）或 x-api-key（静态 API Key `clam-sk-xxx`）
> **说明**：外部工具按 provider 选择对应的路径前缀，ClamAI 透传请求到上游，不做格式转换

### 全局模型列表

| 方法 | 路径 | 功能 | 响应 |
|------|------|------|------|
| GET | `/v1/models` | 列出所有可用模型（汇总所有 provider） | `{object:"list", data:[{id, object, created, owned_by}]}` |

> 模型 ID 格式为 `{provider}:{model}`，如 `siliconflow:deepseek-ai/DeepSeek-V3`

### Provider-native 路由

每个 provider 通过独立路径前缀暴露，请求体/响应体按各服务商原生协议透传（不做格式转换）：

| 路径前缀 | 上游地址 | 认证方式 | 说明 |
|----------|----------|----------|------|
| `/openai/v1/*` | `https://api.openai.com/v1/*` | Bearer | OpenAI 原生 API |
| `/anthropic/v1/*` | `https://api.anthropic.com/v1/*` | x-api-key | Anthropic 原生 API |
| `/siliconflow/v1/*` | `https://api.siliconflow.cn/v1/*` | Bearer | 硅基流动（OpenAI 兼容） |
| `/deepseek/v1/*` | `https://api.deepseek.com/v1/*` | Bearer | DeepSeek（OpenAI 兼容） |
| `/minimax/v1/*` | `https://api.minimax.chat/v1/*` | Bearer | MiniMax（OpenAI 兼容） |
| `/minimax-tokenplan/v1/*` | `https://api.minimaxi.com/anthropic/v1/*` | x-api-key | MiniMax Token Plan（Anthropic 兼容） |
| `/glm/v1/*` | `https://open.bigmodel.cn/api/paas/v4/*` | Bearer | 智谱 GLM |
| `/glm-coding/v1/*` | `https://open.bigmodel.cn/api/coding/paas/v4/*` | Bearer | 智谱 Coding |
| `/doubao/v1/*` | `https://ark.cn-beijing.volces.com/api/v3/*` | Bearer | 豆包（字节跳动） |
| `/arkcode/v1/*` | `https://ark.cn-beijing.volces.com/api/coding/v3/*` | Bearer | ArkCode（字节跳动 Coding） |
| `/qwen/v1/*` | `https://dashscope.aliyuncs.com/compatible-mode/v1/*` | Bearer | 通义千问（OpenAI 兼容） |
| `/moonshot/v1/*` | `https://api.moonshot.cn/v1/*` | Bearer | Moonshot（月之暗面） |
| `/yi/v1/*` | `https://api.lingyiwanwu.com/v1/*` | Bearer | 零一万物（Yi） |
| `/openrouter/v1/*` | `https://openrouter.ai/api/v1/*` | Bearer | OpenRouter |

### 使用示例

```bash
# OpenAI 原生调用 — 通过 ClamAI 代理
curl http://localhost:8080/openai/v1/chat/completions \
  -H "Authorization: Bearer clam-sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"hello"}]}'

# Anthropic 原生调用 — 通过 ClamAI 代理
curl http://localhost:8080/anthropic/v1/messages \
  -H "x-api-key: clam-sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3-opus-20240229","messages":[{"role":"user","content":"hello"}]}'

# SiliconFlow（OpenAI 兼容）— 通过 ClamAI 代理
curl http://localhost:8080/siliconflow/v1/chat/completions \
  -H "Authorization: Bearer clam-sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen/Qwen2.5-72B-Instruct","messages":[{"role":"user","content":"hello"}]}'
```

> **认证说明**：外部工具发送的 `Authorization: Bearer clam-sk-xxxx`（ClamAI API Key）会被 ClamAI 中间件验证后，替换为对应 provider 在数据库中配置的真实 API Key 再转发到上游。

---

## 十八、其他管理接口

### 健康检查（Admin 端口）
| 方法 | 路径 | 功能 | 鉴权 |
|------|------|------|------|
| GET | `/health` | 健康检查 | 否 |

### OAuth 回调（Admin 端口）
| 方法 | 路径 | 功能 | 鉴权 |
|------|------|------|------|
| GET | `/oauth/callback` | OAuth 授权回调 | 否 |

### App 信息（Admin 端口）
| 方法 | 路径 | 功能 | 鉴权 |
|------|------|------|------|
| GET | `/api/v1/app/info` | 获取服务信息（版本、端口、部署模式） | 否 |

---

## 十九、鉴权机制说明

### Bearer Token（JWT）
- 管理接口使用 JWT Bearer Token
- Header：`Authorization: Bearer <token>`
- JWT Payload 包含 `user_id`、`username`、`role`、`iss`（"clamai"）、`exp`、`iat`
- Token 默认有效期由配置决定

### 静态 API Key
- 代理接口支持 `Authorization: Bearer <api_key>` 或 `x-api-key: <api_key>`
- 优先匹配数据库中活跃的 API Key

### 透明代理认证替换
- 外部请求携带 ClamAI API Key（`clam-sk-xxx`）
- ClamAI 中间件验证 API Key 后，根据路由匹配的 provider 从数据库取出真实上游 API Key
- 透明代理处理器将认证头替换为上游 API Key 后转发

### CORS
- `Origin: http://127.0.0.1:*` 和 `Origin: http://localhost:*` 自动放行
- Chrome 对 localhost 会省略端口号，通过 Referer 头回退处理
- 预检请求（OPTIONS）自动返回 CORS headers