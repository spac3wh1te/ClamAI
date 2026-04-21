# ClamAI

智能大模型网关 - 一个基于 Tauri + React + Go 的桌面应用，支持多 AI 提供商管理、API 密钥管理、用量监控、限流和安全防护。

## 功能特性

- **多提供商支持**: OpenAI、Anthropic、Google Gemini、DeepSeek、MiniMax、SiliconFlow、GLM、豆包、通义千问、月之暗面、零一万物、OpenRouter 等
- **统一 API 接口**: 通过标准 OpenAI 格式调用所有支持的模型
- **OAuth 认证**: 支持 Google Gemini 和阿里云通义 OAuth 登录
- **API 密钥管理**: 创建和管理调用密钥，限制可用模型
- **用量监控**: 实时统计请求数、Token 消耗、延迟等
- **限流控制**: 基于时间窗口的请求频率限制
- **内容安全**: 关键词过滤 + 语义分析双重防护
- **代理支持**: 支持 HTTP/HTTPS/SOCKS5 代理配置

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
npm run build
```

### 运行

构建完成后，双击 `outputs\release\ClamAI.exe` 启动应用。

### 开发模式

```powershell
npm run tauri:dev
```

## 项目结构

```
ClamAI/
├── build.bat              # 构建脚本
├── package.json           # 前端依赖
├── src/                   # React 前端源码
├── src-tauri/             # Rust 后端
│   ├── src/               # Rust 源码
│   ├── proxy-service/     # Go 代理服务
│   ├── Cargo.toml
│   └── tauri.conf.json
└── outputs/release/       # 构建输出
```

## 技术栈

- **前端**: React 18 + TypeScript + Vite + TailwindCSS
- **桌面**: Tauri v1
- **后端**: Rust (Tauri) + Go (代理服务)
- **数据库**: SQLite (PC模式) / PostgreSQL (Server模式)

## 配置

应用配置位于 `src-tauri/src/config.rs`，可通过界面修改以下配置：

- 网关端口和监听地址
- 主题、语言、时区
- HTTP/SOCKS5 代理设置
- 请求超时和重试策略

## License

MIT
