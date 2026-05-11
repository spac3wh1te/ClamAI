import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { configApi } from "../api/config";
import { Shield, ExternalLink, RefreshCw, Github, BookOpen, Zap, Key, Settings, ShieldCheck, Brain, Info, Sparkles } from "lucide-react";
import { useSetup } from "../context/SetupContext";

const quickStart = [
  { icon: Settings, title: "1. 配置 Provider", desc: "在「模型管理」中添加 OpenAI、Claude 等 AI 服务商的 API Key，完成模型接入。" },
  { icon: Key, title: "2. 创建 API Key", desc: "在「密钥管控」中生成 ClamAI API Key，下发给下游应用（IDE、CLI、Agent 等）使用。" },
  { icon: Zap, title: "3. 开始代理", desc: "下游应用将 API Base URL 指向 ClamAI 代理地址，所有请求自动经过安全检测。" },
  { icon: ShieldCheck, title: "4. 开启防护", desc: "在「安全设置」中配置关键词过滤、语义检测、向量检测等防护策略。" },
  { icon: Brain, title: "5. 安全分析", desc: "在「安全广场」中使用调用者行为分析、Skills 检测等工具进行深度安全审计。" },
];

const TABS = [
  { id: "about", label: "关于", icon: Info },
  { id: "guide", label: "快速上手", icon: BookOpen },
  { id: "features", label: "核心功能", icon: Sparkles },
] as const;

export default function About() {
  const { connected } = useSetup();
  const [tab, setTab] = useState<string>("about");

  const { data: appInfo } = useQuery({
    queryKey: ["app-info"],
    queryFn: () => configApi.appInfo(),
    enabled: connected,
    staleTime: 60000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">关于</h1>
        <p className="text-sm text-muted-foreground mt-1">ClamAI 程序信息与使用指引</p>
      </div>

      <div className="flex gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              <Icon size={14} className={isActive ? "text-primary-foreground" : ""} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="bg-card rounded-xl p-6 border border-border min-h-[400px]">
        {tab === "about" && (
          <div className="flex flex-col items-center text-center max-w-md mx-auto space-y-4 pt-4">
            <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center">
              <Shield size={32} className="text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">ClamAI</h2>
              <p className="text-sm text-muted-foreground mt-1">AI 安全护栏</p>
            </div>
            {appInfo && (
              <div className="bg-secondary rounded-lg px-4 py-2">
                <span className="text-sm font-mono">v{appInfo.version}</span>
                <span className="text-xs text-muted-foreground ml-2">({appInfo.deploy_mode === "server" ? "服务器模式" : "PC 本地模式"})</span>
              </div>
            )}
            <div className="w-full border-t border-border pt-4 space-y-2 text-left">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">版本</span>
                <span className="font-mono">{appInfo?.version || "-"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">部署模式</span>
                <span>{appInfo?.deploy_mode === "server" ? "服务器模式" : "PC 本地模式"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">作者</span>
                <span>chenflux</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">项目地址</span>
                <a href="https://github.com/chenflux/ClamAI" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline">
                  <Github size={12} />
                  <span>chenflux/ClamAI</span>
                  <ExternalLink size={10} />
                </a>
              </div>
            </div>
            <div className="w-full border-t border-border pt-4 flex justify-center gap-3">
              <button onClick={() => window.open("https://github.com/chenflux/ClamAI/releases", "_blank")}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm">
                <RefreshCw size={16} />
                获取更新
              </button>
              <button onClick={() => window.open("https://github.com/chenflux/ClamAI", "_blank")}
                className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors text-sm">
                <BookOpen size={16} />
                使用文档
              </button>
            </div>
          </div>
        )}

        {tab === "guide" && (
          <div className="space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">快速上手</h2>
              </div>
              <p className="text-sm text-muted-foreground">ClamAI 是一个 AI 安全网关，通过代理方式对 AI 模型的输入输出进行安全检测和防护。以下步骤帮助你快速开始：</p>
            </div>
            <div className="space-y-3">
              {quickStart.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={i} className="flex gap-4 p-4 rounded-lg bg-secondary/30 border border-border">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold">{step.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-4 bg-primary/5 border border-primary/10 rounded-lg">
              <p className="text-sm">
                <span className="text-primary font-medium">代理地址格式：</span>
                <code className="ml-1 text-xs bg-secondary px-2 py-0.5 rounded font-mono">
                  {"{host}:{proxy_port}"}/{/*{provider}*/}{"{provider}"}/v1/...
                </code>
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                ClamAI 通过<strong>厂商前缀路由</strong>分发请求。每个 AI 服务商有独立路径前缀，请求格式为：
              </p>
              <div className="mt-2 space-y-1.5">
                {[
                  { prefix: "openai", name: "OpenAI", example: "gpt-4o" },
                  { prefix: "anthropic", name: "Anthropic", example: "claude-sonnet-4-20250514" },
                  { prefix: "deepseek", name: "DeepSeek", example: "deepseek-chat" },
                  { prefix: "qwen", name: "通义千问", example: "qwen-max" },
                  { prefix: "glm", name: "智谱", example: "glm-4" },
                  { prefix: "doubao", name: "豆包", example: "doubao-pro-32k" },
                  { prefix: "moonshot", name: "Moonshot", example: "moonshot-v1-8k" },
                  { prefix: "siliconflow", name: "SiliconFlow", example: "Qwen/Qwen2.5-72B" },
                  { prefix: "openrouter", name: "OpenRouter", example: "openai/gpt-4o" },
                ].map((p) => (
                  <div key={p.prefix} className="flex items-center gap-2 text-xs">
                    <code className="bg-secondary px-1.5 py-0.5 rounded font-mono w-44 shrink-0">/{p.prefix}/v1/chat/completions</code>
                    <span className="text-muted-foreground">{p.name}</span>
                    <span className="text-muted-foreground">例: {p.example}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                <p><span className="text-foreground font-medium">认证方式：</span>使用 ClamAI 在「密钥管控」中生成的 API Key，通过 <code className="bg-secondary px-1 rounded">Authorization: Bearer sk-...</code> 传入。</p>
                <p><span className="text-foreground font-medium">模型列表：</span>访问 <code className="bg-secondary px-1 rounded">{"{host}:{port}"}/v1/models</code> 查看所有可用模型（格式：<code className="bg-secondary px-1 rounded">{"{provider}:{model}"}</code>）。</p>
                <p><span className="text-foreground font-medium">路由原理：</span>请求路径中的 <code className="bg-secondary px-1 rounded">/{"{provider}"}/v1/</code> 前缀决定转发给哪个服务商，安全检测在转发前自动执行。</p>
              </div>
            </div>
          </div>
        )}

        {tab === "features" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">核心功能</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { title: "内容安全检测", desc: "关键词过滤、语义分析、向量相似度检测，实时拦截恶意输入输出" },
                { title: "威胁规则引擎", desc: "自定义正则规则检测 Prompt 注入、信息泄露等威胁模式" },
                { title: "密钥管控", desc: "API Key 全生命周期管理，支持自动封禁与小黑屋机制" },
                { title: "流量控制", desc: "全局 / Key / 模型 / Provider 多维度限流" },
                { title: "安全审计", desc: "完整的日志记录、安全告警、威胁评分与行为分析" },
                { title: "AI 智能体防护", desc: "Agent 环境安全检测、运行时行为监控与日志审计" },
              ].map((f, i) => (
                <div key={i} className="p-4 rounded-lg border border-border">
                  <h3 className="text-sm font-medium">{f.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
