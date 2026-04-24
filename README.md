# ClamAI

智能大模型网关 - 一个基于 Tauri + React + Go 的桌面应用，支持多 AI 提供商管理、API 密钥管理、用量监控、限流、安全防护和智能体安全分析。

## 功能特性

### 核心网关
- **多提供商支持**: OpenAI、Anthropic、Google Gemini、DeepSeek、MiniMax、SiliconFlow、GLM、豆包、通义千问、月之暗面、零一万物、OpenRouter 等
- **统一 API 接口**: 通过标准 OpenAI / Anthropic 协议调用所有模型，参数透传零丢失
- **OAuth 认证**: 支持 Google Gemini 和阿里云通义 OAuth 登录
- **API 密钥管理**: 创建和管理调用密钥，限制可用模型
- **用量监控**: 实时统计请求数、Token 消耗、延迟、成功率
- **限流控制**: 基于时间窗口的请求频率限制，支持按 Key/模型/提供商配置
- **内容安全**: 关键词过滤 + 语义分析 + 向量相似度三重防护
- **配置方案**: 快照式配置管理，一键保存/切换/重命名/删除

### 安全广场（智能安全分析工具集）
- **调用者行为分析**: 自动分析 API Key 的调用模式，识别异常行为，周期性监控任务管理
- **智能体日志审计**: 自动发现本机 AI 智能体（Claude Code / Cursor / Windsurf 等），扫描会话日志，发现潜在风险
- **智能体环境安全检查**: 检查网关运行环境安全状况，支持对指定智能体做深度安全检查
- **Skills 文档检测**: 检测 AI Agent Skills 文档中的安全威胁，6 维度卡片展示（恶意指令 / 数据投毒 / 隐私泄露 / 后门植入 / 虚假信息 / 提示注入）

## 系统要求

- Windows 10/11 (x64)
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (Windows 11 已内置)
- Node.js 18+
- Rust 1.70+
- Go 1.20+

## 快速开始

### 构建

```powershell
# 安装依赖
npm install

# 构建生产版本 (输出到 outputs/release/)
build.bat
```

### 运行

构建完成后，双击 `outputs\release\x86_64\ClamAI.exe` 启动应用。

### 开发模式

```powershell
npm run tauri:dev
```

## 项目结构

```
ClamAI/
├── build.bat              # 生产构建脚本
├── build-dev.bat          # 开发构建脚本
├── _build-common.bat      # 构建公共逻辑
├── VERSION                # 当前版本号（自动递增）
├── package.json           # 前端依赖
├── src/                   # React 前端源码
│   ├── pages/             # 页面组件
│   ├── security-apps/     # 安全广场应用
│   └── components/         # 公共组件
├── src-tauri/             # Tauri 桌面应用
│   ├── src/               # Rust 命令层
│   ├── proxy-service/     # Go 代理服务
│   ├── Cargo.toml
│   └── tauri.conf.json
└── outputs/release/       # 构建输出目录
    ├── x86_64/            # x86_64 平台输出
    └── arm64/             # ARM64 平台输出
```

## 技术栈

- **前端**: React 18 + TypeScript + Vite + TailwindCSS + TanStack Query
- **桌面**: Tauri v1
- **后端**: Rust (Tauri 命令层) + Go (代理服务)
- **数据库**: SQLite (PC 本地模式) / PostgreSQL (Server 服务器模式)
- **AI 分析**: 通过网关标准接口调用各 Provider 的模型进行安全分析

## 架构说明

ClamAI 采用三层架构：

1. **React 前端** (src/): 提供 Web UI，运行在 Tauri 的 WebView 中
2. **Rust 命令层** (src-tauri/src/): 处理 Tauri 命令，调用 Go 服务，管理配置
3. **Go 代理服务** (src-tauri/proxy-service/): 接收 AI 请求，路由到对应 Provider，记录日志和统计

## 配置

应用配置通过界面修改，主要包括：

- **网关配置**: 监听端口、监听地址
- **界面配置**: 主题、语言、时区
- **网络代理**: HTTP/HTTPS/SOCKS5 代理设置
- **限流规则**: 按 Key、模型、提供商的 RPM 限制

## License

MIT
