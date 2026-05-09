# ClamAI AI 智能体安全模块 — 方案 B 详细设计

## 一、背景与目标

随着 AI 智能体（Agent）技术的快速发展，智能体面临的安全威胁日益多样化。传统的内容安全检测已无法覆盖智能体特有的安全风险。ClamAI 定位为 **AI 模型网关 + 安全分析平台**，有必要将安全能力从「模型内容安全」扩展到「智能体运行安全」，形成完整的 AI 安全防护体系。

本文档基于 ClamAI 现有架构，评估五大安全模块的可行性，并给出方案 B（独立导航区块）的界面组织建议。

---

## 二、现状评估

### 2.1 已有能力盘点

| 已有能力 | 对应模块 | 可复用的部分 |
|---------|---------|------------|
| 请求日志记录 | `request_logs` | 智能体调用行为数据来源 |
| 威胁规则检测（正则） | `threat_rules` | 运行时行为检测引擎 |
| 系统行为分析 | `system_analysis` | 智能体行为模式分析框架 |
| Skills 检测 | `handlers_agent.push-skills` | 供应链安全检测入口 |
| Agent 环境扫描 | `handleAgentEnvCheck` | 智能体目录发现能力 |
| 用户/Key 隔离 | `users`/`api_keys` | 环境归属关联 |
| Provider-native 代理 | `handlers_proxy` | 智能体工具调用记录 |
| 告警体系 | `security_alerts` | 风险事件上报通道 |

---

## 三、五大安全模块详细设计

### 3.1 环境安全（Environment Security）

**目标**：检测智能体是否运行于不安全的高危环境。

**核心检查项**：

| 检查维度 | 检查内容 | 实现难度 | 技术手段 |
|---------|---------|---------|---------|
| 容器检测 | 是否运行在 Docker/Linux Container/cgroup namespace | 中 | 读取 `/proc/1/cgroup`、检查 `/.dockerenv` |
| 虚拟化检测 | 是否运行在 VM（VMware/KVM/QEMU/VirtualBox） | 中 | 检查 `sys/class/dmi/id/*` |
| 进程特权 | 是否以 root/特权用户运行 | 低 | `os.Getuid() == 0`、检查 capabilities |
| 网络隔离 | 是否可访问内网段（RFC1918） | 低 | 分析 `client_ip` 来源段 |
| 环境变量 | 危险路径注入、LD_PRELOAD 等 | 低 | 遍历 `os.Environ()` 关键词匹配 |
| 敏感目录 | 智能体目录权限是否过于宽松 | 低 | `os.Stat()` 检查目录权限位 |
| 可疑工具 | 是否安装了 nc/curl/wget 等网络工具 | 低 | 扫描 `$PATH` 常见黑客工具 |

**数据库扩展**：

```sql
CREATE TABLE agent_env_checks (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  run_at DATETIME,
  container_detected BOOLEAN,
  vm_detected BOOLEAN,
  is_root BOOLEAN,
  suspicious_env_vars TEXT,  -- JSON array
  network_access TEXT,       -- JSON array of accessible subnets
  risk_score INTEGER,        -- 0-100
  details TEXT                -- JSON
);
```

**后端新增接口**：

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/v1/agent/env-check/full` | 全量环境安全检测（返回各维度详情 + 综合评分） |
| GET | `/api/v1/agent/env-history` | 检测历史记录 |

**前端页面**：`/agent-security/environment`

```
┌─────────────────────────────────────────────────────────────────┐
│ Agent 环境安全                     [刷新检测] [扫描所有Agent]    │
├─────────────────────────────────────────────────────────────────┤
│ Agent          │ 容器 │ 虚拟机 │ 特权 │ 网络隔离 │ 目录安全 │ 综合 │
│────────────────┼──────┼────────┼──────┼──────────┼──────────┼─────│
│ Claude Code   │  ⚠️  │   ❌   │  ✅  │    ⚠️   │    ✅   │ ⚠️  │
│ Cursor         │  ❌  │   ⚠️   │  ⚠️  │    ✅    │    ⚠️   │ ❌  │
└─────────────────────────────────────────────────────────────────┘
```

展开行详情：

```
Claude Code — 环境安全详情
├── 🔴 容器检测 (风险: 高)
│   └── 检测到: cgroup v2 hierarchy, container=1
│       影响: 智能体行为可能被容器逃逸漏洞影响
├── 🟡 虚拟机检测 (风险: 中)
│   └── 检测到: sys/class/dmi/id/product_name="VMware Virtual Platform"
│       说明: 运行在虚拟化环境中，需确保宿主机安全
├── ✅ 特权用户
│   └── 当前用户 uid=1000，未以 root 运行
├── 🟡 网络隔离 (风险: 中)
│   └── 可访问内网段: 192.168.1.0/24, 10.0.0.0/8
│       建议: 配置网络隔离策略
└── ✅ 目录安全
    └── ~/.claude 权限: 0755 (正常)
```

---

### 3.2 配置安全（Configuration Security）

**目标**：发现智能体的不安全配置，防止配置级安全风险。

**核心检查项**：

| 检查维度 | 检查内容 | 实现难度 | 技术手段 |
|---------|---------|---------|---------|
| 硬编码密钥 | 配置文件中含 API Key/Token | 低 | 正则 `sk-[a-zA-Z0-9]+` 等 |
| Prompt 注入风险 | Rules/System Prompt 含动态执行 | 低 | AST 解析或正则 `\${.*}`、`$(.*)` |
| 模型配置 | temperature/top_p 超标 | 低 | 解析 JSON 配置 |
| 工具权限 | 允许执行高危工具（Shell/Bash） | 低 | 扫描 tools 列表 |
| 外部网络 | 允许访问任意 URL | 低 | 检查 allowed_endpoints |
| 配置签名 | 是否开启配置完整性校验 | 低 | 检查配置文件签名字段 |

**数据库扩展**：

```sql
CREATE TABLE agent_config_checks (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  run_at DATETIME,
  hardcoded_secrets TEXT,      -- JSON array
  prompt_injection_risk TEXT,  -- JSON array of risky patterns
  dangerous_tools TEXT,        -- JSON array
  config_signed BOOLEAN,
  risk_score INTEGER,
  details TEXT
);
```

**前端页面**：合并到环境安全详情 Tab「配置安全」

---

### 3.3 运行时安全（Runtime Security）

**目标**：动态监控智能体正在调用的底层资源，高危目录访问、高危命令执行被特别关注。

**核心检测逻辑**：

当前 ClamAI 的 `request_logs` 记录的是**通过网关的模型 API 调用**，而非智能体的**工具调用（Tool Calls）**。智能体的工具调用由智能体框架自身管理（如 Claude Code 的 `tools`、Cursor 的 MCP 工具）。

**可行的实现路径**：

#### 路径 A：智能体日志分析（推荐，无需改造 ClamAI）

```
ClamAI → AgentLogAuditApp → 解析智能体日志文件
                          → 正则匹配工具调用模式
                          → 识别高危行为
```

通过 `handleAgentLogScan` 扫描智能体输出的日志文件，用正则提取工具调用序列：

```
[TOOL_CALL] filesystem.write /etc/passwd
[TOOL_CALL] shell.execute rm -rf /
[TOOL_CALL] http.request https://internal.corp.com/api/keys
```

扩展 `threat_rules` 增加分类 `agent_behavior`：

| 规则名称 | 正则模式 | 严重度 |
|---------|---------|--------|
| 高危文件写入 | `filesystem\.write.*(\/etc\/|\.ssh\/|passwd)` | critical |
| 批处理删除 | `shell\.execute.*rm\s+-rf` | high |
| 内网渗透 | `http\.request.*(192\.168\.|10\.\d+\.|172\.(1[6-9]|2[0-9]|3[01])\.)` | high |
| 凭证访问 | `.*\.(pem|key|secret|token|credentials).*` | high |
| 下载执行 | `curl.*\|.*sh|wget.*-O.*\|.*sh` | critical |

#### 路径 B：MCP 工具调用监控（需要智能体支持 MCP 协议）

如果智能体使用 MCP（Model Context Protocol），可以通过 MCP 客户端日志监控工具调用。此方案需要智能体框架支持 MCP 审计日志。

#### 路径 C：扩展 request_logs 记录工具调用（需智能体主动上报）

在 `RequestLog` 结构体增加 `tool_calls` JSON 字段，智能体框架在调用模型时通过 `X-Tool-Calls` 头传递工具调用序列。

**推荐路径 A**——已有的 `handleAgentLogScan` 框架 + 正则扩展，无需改动 ClamAI 核心架构。

**前端页面**：`/agent-security/runtime`

```
┌──────────────────────────────────────────────────────────────────┐
│ 智能体运行时安全                    时间范围 [近7天 ▾]           │
├──────────────────────────────────────────────────────────────────┤
│ 🔴 高危 (3)   🟡 可疑 (7)   ⚪ 正常 (42)     总计: 52 次工具调用 │
├──────────────────────────────────────────────────────────────────┤
│ 时间          │ Agent     │ 行为类型     │ 目标资源      │ 严重度 │
│───────────────┼───────────┼─────────────┼───────────────┼────────│
│ 05-09 15:04  │Claude    │ 写文件       │ ~/.ssh/       │ 🔴 严重 │
│ 05-09 14:58  │Cursor    │ HTTP请求     │ 192.168.1.99  │ 🟡 高危 │
│ 05-09 14:32  │Claude    │ Shell执行    │ rm -rf /tmp/* │ 🔴 严重 │
│ 05-09 13:21  │Claude    │ 读文件       │ ~/.bashrc     │ ⚪ 正常 │
└──────────────────────────────────────────────────────────────────┘

详情展开:
Claude Code — rm -rf /tmp/*
├── 时间: 2026-05-09 15:04:32
├── Agent: Claude Code (user: test)
├── 工具: shell.execute
├── 参数: {"command": "rm -rf /tmp/claude-*"}
├── 风险: 🔴 严重 — 批处理删除操作，可导致数据丢失
├── 建议: 检查 /tmp 目录是否包含重要缓存文件
└── 关联日志: 见 ThreatAudit 记录 #THR-2026-0512
```

---

### 3.4 模型安全（Model Security）

**目标**：通过实时内容安全策略 + 定期调用日志行为分析发现问题。

**现状**：ClamAI 已完整实现此模块：
- `securityMiddleware`：实时内容审核（关键词/语义/威胁规则）
- `system_analysis`：定期调用日志行为分析
- `threat_rules`：正则驱动的威胁规则引擎

**需扩展的点**：

| 扩展项 | 描述 | 工作量 |
|--------|------|--------|
| Agent Prompt 注入专项规则 | 检测智能体特有的注入手法（如 "ignore all previous instructions"） | 低 |
| 敏感数据泄露检测 | 检测日志中是否泄露了上游 API Key、数据库凭证 | 低 |
| 智能体异常调用模式 | 同一用户短时间大量相同请求（可能是 token 枚举攻击） | 低 |

**新增威胁规则分类** `agent_injection`：

| 规则名 | 模式 | 严重度 |
|--------|------|--------|
| Ignore Previous Instructions | `ignore (all )?previous (instructions|commands|orders)` | high |
|你现在是| `(你现在是|从现在起你是|you are now a)`.*(而不是|instead of) | high |
|角色扮演溢出| `忽略.*(以上|above|prior).*(指令|prompts|instructions)` | critical |
|系统Prompt泄露| `(以下|below).*(system|系统).*(prompt|提示词)` | medium |

此模块**不需要新增前端页面**，已完全覆盖在「防护策略 → 威胁规则」和「威胁挖掘」中。只需新增规则模板即可。

---

### 3.5 日志审计（Log Audit）

**目标**：审计智能体的固有日志，梳理行为，基于智能体日志识别出其风险。

**现状能力**：
- `handleAgentLogScan`：扫描智能体日志目录
- `AgentLogAuditApp.tsx`：基础日志展示界面

**需大幅增强的点**：

| 增强项 | 描述 | 工作量 |
|--------|------|--------|
| 行为时间线可视化 | 将日志解析为「操作序列 + 时间轴」 | 中 |
| 风险自动标记 | 关键词触发 + AI 辅助判断 | 中 |
| 多 Agent 交叉分析 | 同一用户的多个 Agent 行为关联 | 中 |
| 日志导出 | CSV/JSON 导出 | 低 |
| 搜索过滤 | 关键词搜索、行为类型过滤 | 低 |

**前端页面**：升级现有「安全广场 → Agent 日志审计」

```
┌──────────────────────────────────────────────────────────────────┐
│ Agent 日志审计    Agent [Claude Code ▾]   时间 [近24h ▾]         │
├──────────────────────────────────────────────────────────────────┤
│ ┌─ 行为时间线 ───────────────────────────────────────────────┐   │
│ │ 15:04:32  🔴 删除文件     ~/.ssh/authorized_keys          │   │
│ │ 15:04:15  🟡 修改文件     ~/.bashrc                       │   │
│ │ 15:03:01  ⚪ 读取文件     /etc/hostname                   │   │
│ │ 15:02:44  ⚪ 模型调用     gpt-4 → 分析代码片段              │   │
│ │ 15:01:58  ⚪ 工具调用     web-search: "latest vulnerability"│   │
│ │ 15:01:22  ⚪ 读文件      ~/.claude/settings.json          │   │
│ └────────────────────────────────────────────────────────────┘   │
│                                                                  │
│ 风险摘要:  检测到 2 项可疑行为 (1 高危)                           │
│                                                                  │
│ 关联分析:                                                    │
│   用户 (test) 同期有 3 次异常 API 调用                         │
│   涉及 Key: sk-...1deb → 威胁评分: 72                          │
│   同类行为出现在: Cursor (05-08, 05-07)                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 四、界面组织 — 方案 B（独立导航区块）

### 4.1 侧边栏结构

```
├── 首页
│   └── 安全总览 (Dashboard)
├── 防护中心
│   ├── 实时防护
│   ├── 威胁挖掘
│   ├── 安全广场
│   └── 防护策略
├── AI 智能体安全   ⭐ 新增独立区块
│   ├── 环境安全    → Agent 发现 + 8 维度环境检查 + 综合评分
│   ├── 配置安全    → 配置文件扫描 + 硬编码密钥检测 + Prompt 注入
│   ├── 运行时安全  → 工具调用行为分析 + 高危事件告警
│   └── 日志审计    → 智能体日志时间线 + 行为分析
├── 管控中心
│   ├── 模型管理
│   ├── 用户管理
│   ├── 密钥管控
│   └── 流量控制
├── 审计中心
│   ├── API 调用日志
│   └── 系统运行日志
└── 设置中心
    └── 基础设置
```

### 4.2 为什么选方案 B

| 对比维度 | 方案 A（在防护中心下新增） | 方案 B（独立区块） |
|---------|--------------------------|------------------|
| 入口深度 | 需展开「防护中心 → AI 智能体安全」| 侧边栏一级入口，浅 |
| 重要性凸显 | 与现有安全告警混在一起，不突出 | 独立区块，视觉权重高 |
| 功能边界 | 与防护中心其他模块有一定重叠 | 边界清晰，专注 Agent 安全 |
| 开发成本 | 可复用现有安全广场布局 | 需单独设计侧边栏入口 |
| 用户认知 | 对"防护中心"含义有一定混淆 | 概念清晰：AI Agent Security |

### 4.3 页面布局详解

#### 4.3.1 环境安全页面（`/agent-security/environment`）

```
┌─────────────────────────────────────────────────────────────────┐
│ AI Agent 环境安全                               [刷新检测] [批量扫描] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─ Agent 列表 ──────────────────────────────────────────────┐ │
│  │ Agent          │容器│VM │特权│网络│目录│凭证│工具│综合│   │
│  │─────────────────────────────────────────────────────────│ │
│  │ Claude Code    │ ⚠️│ ❌│ ✅ │ ⚠️│ ✅ │ ⚠️│ ⚠️│ ⚠️ │  [展开]│
│  │ Cursor          │ ❌│ ✅ │ ⚠️│ ✅ │ ⚠️│ ✅ │ ❌│ ❌ │  [展开]│
│  │ Windsurf       │ ⚠️│ ✅ │ ✅ │ ⚠️│ ✅ │ ✅ │ ✅ │ ⚠️ │  [展开]│
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Claude Code 环境详情 ────────────────────────────────────┐ │
│  │  Agent: Claude Code     Owner: @admin     最后检测: 05-09 15:00│
│  │  综合风险评分: 62/100 (⚠️ 中高风险)                          │
│  │                                                           │ │
│  │  [环境安全] [配置安全] [运行时安全]                          │ │
│  │  ─────────────────────────────────────────────────────    │ │
│  │  🔴 容器检测: 风险高                                       │ │
│  │     检测到 cgroup v2 容器环境，可能存在容器逃逸风险          │ │
│  │     建议: 在物理机或嵌套虚拟化环境中运行                     │ │
│  │                                                           │ │
│  │  🟡 凭证安全: 风险中                                       │ │
│  │     在配置中检测到 2 处疑似 API Key 硬编码                  │ │
│  │     sk-...xxxx, gl-...xxxx                               │ │
│  │     建议: 使用环境变量或密钥管理服务存储                     │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

#### 4.3.2 运行时安全页面（`/agent-security/runtime`）

```
┌─────────────────────────────────────────────────────────────────┐
│ AI Agent 运行时安全                   [近7天 ▾] [导出CSV]        │
├─────────────────────────────────────────────────────────────────┤
│  🔴 高危: 3   🟡 可疑: 12   ⚪ 正常: 47   智能体: [全部 ▾]     │
├─────────────────────────────────────────────────────────────────┤
│  时间          │ Agent     │ 行为类型   │ 目标          │ 严重度│
│───────────────┼───────────┼────────────┼───────────────┼────────│
│  05-09 15:04  │Claude    │ 高危文件   │ ~/.ssh/       │🔴严重│
│  05-09 14:58  │Cursor    │ 内网渗透   │ 192.168.1.99 │🟡高危│
│  05-09 14:32  │Claude    │ 批处理删除  │ /tmp/claude-  │🔴严重│
│  05-09 13:55  │Claude    │ 凭证访问   │ .env         │🟡高危│
│  05-09 12:01  │Claude    │ 读文件     │ /etc/hosts   │⚪正常│
└─────────────────────────────────────────────────────────────────┘
```

#### 4.3.3 日志审计页面（`/agent-security/logs`）

```
┌─────────────────────────────────────────────────────────────────┐
│ AI Agent 日志审计    Agent [Claude Code ▾]   [近24h ▾] [搜索]  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─ 行为时间线 ───────────────────────────────────────────────┐ │
│  │ 🕐 15:04:32  🔴 删除文件      ~/.ssh/authorized_keys      │ │
│  │ 🕐 15:04:15  🟡 修改文件      ~/.bashrc                   │ │
│  │ 🕐 15:03:01  ⚪ 读取文件      /etc/hostname               │ │
│  │ 🕐 15:02:44  ⚪ 模型调用      gpt-4                       │ │
│  │ 🕐 15:01:58  ⚪ 工具调用      web-search                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ⚠️ 风险摘要: 检测到 2 项可疑行为                                │
│                                                                 │
│  🔴 [高危] 写文件 ~/.ssh/ — 可用于 SSH 后门植入                  │
│  🟡 [可疑] 读取 .env — 可能提取敏感环境变量                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、实现优先级与工作量估算

| 模块 | 功能点 | 工作量 | 依赖关系 | 推荐优先级 |
|------|-------|--------|---------|-----------|
| 日志审计增强 | 行为时间线 + 风险自动标记 + 搜索过滤 | 中 | 已有 AgentLogAuditApp | 🥇 P0 |
| 运行时安全 | 扩展 threat_rules + 正则工具调用 + 前端展示 | 中 | request_logs 可用 | 🥇 P0 |
| 环境安全 | Go 侧环境检测 + 前端评分展示 | 中 | 需跨平台兼容 | 🥈 P1 |
| 配置安全 | 配置文件解析 + 正则扫描 | 中 | 环境安全详情页 Tab | 🥈 P1 |
| 模型安全扩展 | 新增 agent_injection 规则 | 低 | 复用 threat_rules | 🥉 P2 |

---

## 六、技术架构扩展

### 6.1 数据库新增表

```sql
-- Agent 环境安全检查记录
CREATE TABLE agent_env_checks (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  run_at DATETIME,
  is_container BOOLEAN,
  is_vm BOOLEAN,
  is_root BOOLEAN,
  network_subnets TEXT,       -- JSON
  suspicious_env TEXT,       -- JSON
  risk_score INTEGER,
  details TEXT,
  created_by TEXT,
  INDEX idx_agent_name (agent_name),
  INDEX idx_run_at (run_at)
);

-- Agent 配置安全检查记录
CREATE TABLE agent_config_checks (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  run_at DATETIME,
  hardcoded_secrets TEXT,    -- JSON array
  injection_risks TEXT,        -- JSON array
  dangerous_tools TEXT,       -- JSON array
  config_signed BOOLEAN,
  risk_score INTEGER,
  details TEXT,
  created_by TEXT
);

-- Agent 运行时行为事件
CREATE TABLE agent_runtime_events (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  event_at DATETIME,
  event_type TEXT,            -- file_write/shell_execute/http_request/...
  event_target TEXT,          -- 目标资源
  severity TEXT,              -- critical/high/medium/low
  details TEXT,                -- JSON with full event data
  log_source TEXT,             -- 来源日志文件
  created_by TEXT,
  INDEX idx_agent_event (agent_name, event_at),
  INDEX idx_severity (severity)
);
```

### 6.2 后端新增接口

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/v1/agent/list` | 发现所有已知 Agent |
| POST | `/api/v1/agent/env-scan/{name}` | 执行单 Agent 环境检测 |
| POST | `/api/v1/agent/env-scan-all` | 批量环境检测 |
| GET | `/api/v1/agent/env-history` | 环境检测历史 |
| POST | `/api/v1/agent/config-scan/{name}` | 执行单 Agent 配置检测 |
| POST | `/api/v1/agent/config-scan-all` | 批量配置检测 |
| GET | `/api/v1/agent/runtime-events` | 查询运行时事件（分页 + 筛选） |
| POST | `/api/v1/agent/logs/parse` | 解析智能体日志文件，提取行为事件 |

### 6.3 前端路由

```
/agent-security/environment  — 环境安全
/agent-security/config      — 配置安全
/agent-security/runtime     — 运行时安全
/agent-security/logs        — 日志审计
```

### 6.4 复用现有组件

| 复用组件 | 用途 |
|---------|------|
| `AgentEnvCheckApp.tsx` | Agent 发现和环境扫描 UI |
| `AgentLogAuditApp.tsx` | 日志审计 UI |
| `SkillsDetectionApp.tsx` | Skills 检测结果展示 |
| `Threats.tsx` 威胁表格 | 运行时事件列表（可复用表格布局） |
| `threat_rules` 引擎 | 运行时行为正则检测 |

---

## 七、与现有模块的关系

```
AI 智能体安全
├── 环境安全      ← 新增（基于 handleAgentEnvCheck 扩展）
├── 配置安全      ← 新增（扩展 threat_rules + 配置文件解析）
├── 运行时安全    ← 复用 system_analysis + threat_rules + request_logs
├── 模型安全      ← 复用 securityMiddleware + threat_rules（已实现）
└── 日志审计      ← 升级 AgentLogAuditApp（基于 handleAgentLogScan）

与防护中心的关系:
- 智能体安全的"运行时安全"检测到的高危事件 → 写入 security_alerts
- threat_rules 新增 agent_* 类型规则 → 威胁规则管理页面统一管理
- 智能体日志中的敏感信息泄露 → 触发内容安全告警

与审计中心的关系:
- AI Agent 运行时安全事件（高危）→ 可跳转至 API 调用日志关联查询
- Agent 日志审计 → 日志原文可导出到 CSV
```

---

## 八、实施计划建议

### Phase 1: 核心框架 + 日志审计（1-2 周）

1. 创建 `agent_security.go` 作为智能体安全核心模块
2. 新增 `/api/v1/agent/list`、`/api/v1/agent/logs/parse` 接口
3. 升级 `AgentLogAuditApp.tsx` 增加时间线和风险标记
4. 升级 `threat_rules` 增加 `agent_behavior` 规则集

### Phase 2: 运行时安全（1 周）

1. 扩展 `request_logs` 分析能力（客户端日志工具调用正则提取）
2. 新增 `/api/v1/agent/runtime-events` 接口
3. 创建 `RuntimeSecurity.tsx` 页面
4. 与 security_alerts 告警通道打通

### Phase 3: 环境安全（1 周）

1. Go 侧实现 `detectContainer()`、`detectVM()`、`checkEnvVars()` 等检测函数
2. 新增 `/api/v1/agent/env-scan/{name}` 接口
3. 创建 `AgentEnvironment.tsx` 页面（8 维度雷达评分）

### Phase 4: 配置安全（0.5 周）

1. 配置文件解析（Claude Code settings.json、Cursor config 等）
2. 正则扫描硬编码密钥和注入风险
3. 合并为环境安全详情页的 Tab
