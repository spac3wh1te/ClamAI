import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import { useState } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Plus,
  X,
  AlertTriangle,
  CheckCircle,
  Save,
} from "lucide-react";

interface DirectionConfig {
  enabled: boolean;
  mode: "block" | "detect";
  keyword_enabled: boolean;
  semantic_enabled: boolean;
}

interface SecurityConfig {
  enabled: boolean;
  input: DirectionConfig;
  output: DirectionConfig;
  keywords: string[];
  block_message: string;
  semantic_model: string;
  semantic_threshold: number;
  semantic_prompt: string;
  auto_ban_key: boolean;
}

interface Alert {
  id: number;
  timestamp: string;
  direction: string;
  mode: string;
  trigger_type: string;
  trigger_detail: string;
  content_preview: string;
  model: string;
  api_key_used: string;
  client_ip: string;
  action: string;
  resolved: number;
}

const defaultConfig: SecurityConfig = {
  enabled: false,
  input: {
    enabled: true,
    mode: "block",
    keyword_enabled: true,
    semantic_enabled: false,
  },
  output: {
    enabled: true,
    mode: "block",
    keyword_enabled: true,
    semantic_enabled: false,
  },
  keywords: [],
  block_message: "抱歉，您的内容涉及敏感信息，已被安全策略拦截。",
  semantic_model: "",
  semantic_threshold: 0.8,
  semantic_prompt: "",
  auto_ban_key: false,
};

export default function Security() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"config" | "alerts">("config");
  const [newKeyword, setNewKeyword] = useState("");
  const [draft, setDraft] = useState<SecurityConfig | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: remoteConfig, isLoading } = useQuery({
    queryKey: ["security-config"],
    queryFn: async () => {
      const raw = await invoke<string>("get_security_config");
      return JSON.parse(raw) as SecurityConfig;
    },
    staleTime: 0,
  });

  const { data: alertsData } = useQuery({
    queryKey: ["security-alerts"],
    queryFn: async () => {
      const raw = await invoke<string>("get_security_alerts", { limit: 100 });
      return JSON.parse(raw) as { alerts: Alert[]; total: number };
    },
    staleTime: 0,
    refetchInterval: 10000,
  });

  const saveMutation = useMutation({
    mutationFn: (cfg: SecurityConfig) =>
      invoke("save_security_config", { payload: JSON.stringify(cfg) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["security-config"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (isLoading) return <div className="p-6">加载安全配置中...</div>;

  const cfg = draft || remoteConfig || defaultConfig;
  const updateDraft = (patch: Partial<SecurityConfig>) => {
    setSaved(false);
    setDraft({ ...cfg, ...patch });
  };
  const updateInput = (patch: Partial<DirectionConfig>) => {
    updateDraft({ input: { ...cfg.input, ...patch } });
  };
  const updateOutput = (patch: Partial<DirectionConfig>) => {
    updateDraft({ output: { ...cfg.output, ...patch } });
  };

  const addKeyword = () => {
    if (!newKeyword.trim()) return;
    updateDraft({ keywords: [...cfg.keywords, newKeyword.trim()] });
    setNewKeyword("");
  };
  const removeKeyword = (kw: string) => {
    updateDraft({ keywords: cfg.keywords.filter((k) => k !== kw) });
  };

  const alerts = alertsData?.alerts || [];
  const unresolvedCount = alerts.filter((a) => a.resolved === 0).length;

  const defaultPrompt = `你是一个内容安全分类引擎。你的唯一任务是对输入内容进行安全分类评分。

你必须严格回复一个JSON对象，不要回复任何其他内容。格式如下：
{"sensitive_data":{"d":false,"c":0.0},"pornography":{"d":false,"c":0.0},"violence":{"d":false,"c":0.0},"politics":{"d":false,"c":0.0},"terrorism":{"d":false,"c":0.0}}

分类定义：
- sensitive_data: 个人隐私泄露、身份证号、手机号、银行卡号、密码、密钥等敏感数据
- pornography: 色情、裸露、性暗示、性行为描写
- violence: 暴力、血腥、虐待、自残、凶杀
- politics: 政治敏感、颠覆国家、分裂、敏感政治人物或事件
- terrorism: 恐怖主义、极端主义、炸弹制造、煽动恐怖活动

每个字段：d: boolean是否检测到, c: float 0.0-1.0置信度
只输出JSON。`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">安全防护</h1>
          <p className="text-muted-foreground mt-2">
            内容安全策略管理与告警记录
          </p>
        </div>
        <div className="flex items-center gap-3">
          {unresolvedCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              <AlertTriangle size={16} />
              <span>{unresolvedCount} 条未处理</span>
            </div>
          )}
          <button
            onClick={() => saveMutation.mutate(cfg)}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            <Save size={16} />
            {saveMutation.isPending
              ? "保存中..."
              : saved
                ? "已保存"
                : "保存配置"}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab("config")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "config" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
        >
          安全配置
        </button>
        <button
          onClick={() => setTab("alerts")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${tab === "alerts" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
        >
          告警记录
          {unresolvedCount > 0 && (
            <span className="px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">
              {unresolvedCount}
            </span>
          )}
        </button>
      </div>

      {tab === "config" && (
        <div className="space-y-6">
          {/* 全局开关 */}
          <div className="bg-card rounded-lg p-6 border border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {cfg.enabled ? (
                  <ShieldCheck className="w-8 h-8 text-green-500" />
                ) : (
                  <Shield className="w-8 h-8 text-muted-foreground" />
                )}
                <div>
                  <h3 className="text-lg font-semibold">内容安全防护</h3>
                  <p className="text-sm text-muted-foreground">
                    {cfg.enabled ? "已启用" : "已关闭"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => updateDraft({ enabled: !cfg.enabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cfg.enabled ? "bg-green-500" : "bg-gray-300"}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${cfg.enabled ? "translate-x-6" : "translate-x-1"}`}
                />
              </button>
            </div>
          </div>

          {/* ===== 输入检测 ===== */}
          <div className="bg-card rounded-lg p-6 border border-border space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">输入检测（用户请求）</h3>
              <button
                onClick={() => updateInput({ enabled: !cfg.input.enabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cfg.input.enabled ? "bg-green-500" : "bg-gray-300"}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${cfg.input.enabled ? "translate-x-6" : "translate-x-1"}`}
                />
              </button>
            </div>
            {cfg.input.enabled && (
              <>
                <div className="flex gap-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-border hover:bg-secondary/50 flex-1">
                    <input
                      type="radio"
                      name="input_mode"
                      checked={cfg.input.mode === "block"}
                      onChange={() => updateInput({ mode: "block" })}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-medium">拦截模式</p>
                      <p className="text-xs text-muted-foreground">
                        命中则直接拦截，返回拦截回复
                      </p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-border hover:bg-secondary/50 flex-1">
                    <input
                      type="radio"
                      name="input_mode"
                      checked={cfg.input.mode === "detect"}
                      onChange={() => updateInput({ mode: "detect" })}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-medium">检测模式</p>
                      <p className="text-xs text-muted-foreground">
                        放行请求，异步检测并记录告警
                      </p>
                    </div>
                  </label>
                </div>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.input.keyword_enabled}
                      onChange={(e) =>
                        updateInput({ keyword_enabled: e.target.checked })
                      }
                      className="w-4 h-4"
                    />
                    <span className="text-sm">关键词检测</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.input.semantic_enabled}
                      onChange={(e) =>
                        updateInput({ semantic_enabled: e.target.checked })
                      }
                      className="w-4 h-4"
                    />
                    <span className="text-sm">语义安全检测</span>
                  </label>
                </div>
              </>
            )}
          </div>

          {/* ===== 输出检测 ===== */}
          <div className="bg-card rounded-lg p-6 border border-border space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">输出检测（AI响应）</h3>
              <button
                onClick={() => updateOutput({ enabled: !cfg.output.enabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cfg.output.enabled ? "bg-green-500" : "bg-gray-300"}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${cfg.output.enabled ? "translate-x-6" : "translate-x-1"}`}
                />
              </button>
            </div>
            {cfg.output.enabled && (
              <>
                <div className="flex gap-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-border hover:bg-secondary/50 flex-1">
                    <input
                      type="radio"
                      name="output_mode"
                      checked={cfg.output.mode === "block"}
                      onChange={() => updateOutput({ mode: "block" })}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-medium">拦截模式</p>
                      <p className="text-xs text-muted-foreground">
                        缓冲响应，检查后决定是否替换
                      </p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-border hover:bg-secondary/50 flex-1">
                    <input
                      type="radio"
                      name="output_mode"
                      checked={cfg.output.mode === "detect"}
                      onChange={() => updateOutput({ mode: "detect" })}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-medium">检测模式</p>
                      <p className="text-xs text-muted-foreground">
                        直接放行，异步检测并记录告警
                      </p>
                    </div>
                  </label>
                </div>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.output.keyword_enabled}
                      onChange={(e) =>
                        updateOutput({ keyword_enabled: e.target.checked })
                      }
                      className="w-4 h-4"
                    />
                    <span className="text-sm">关键词检测</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.output.semantic_enabled}
                      onChange={(e) =>
                        updateOutput({ semantic_enabled: e.target.checked })
                      }
                      className="w-4 h-4"
                    />
                    <span className="text-sm">语义安全检测</span>
                  </label>
                </div>
                {cfg.output.mode === "detect" && (
                  <label className="flex items-center gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.auto_ban_key}
                      onChange={(e) =>
                        updateDraft({ auto_ban_key: e.target.checked })
                      }
                      className="w-4 h-4"
                    />
                    <div>
                      <p className="font-medium text-red-400 text-sm">
                        检测到恶意输出时自动封禁触发API Key
                      </p>
                    </div>
                  </label>
                )}
              </>
            )}
          </div>

          {/* ===== 关键词词库 ===== */}
          <div className="bg-card rounded-lg p-6 border border-border">
            <h3 className="text-lg font-semibold mb-4">关键词词库</h3>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addKeyword()}
                placeholder="输入关键词后回车添加"
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={addKeyword}
                className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {cfg.keywords.length === 0 && (
                <p className="text-sm text-muted-foreground">暂未配置关键词</p>
              )}
              {cfg.keywords.map((kw) => (
                <span
                  key={kw}
                  className="flex items-center gap-1 px-3 py-1 bg-red-500/10 border border-red-500/30 text-red-400 rounded-full text-sm"
                >
                  {kw}
                  <button
                    onClick={() => removeKeyword(kw)}
                    className="hover:text-red-300"
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* ===== 拦截后回复 ===== */}
          <div className="bg-card rounded-lg p-6 border border-border">
            <h3 className="text-lg font-semibold mb-4">拦截后回复内容</h3>
            <textarea
              value={cfg.block_message}
              onChange={(e) => updateDraft({ block_message: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          {/* ===== 语义安全检测 ===== */}
          <div className="bg-card rounded-lg p-6 border border-border space-y-4">
            <div className="flex flex-wrap gap-2">
              {["敏感数据", "涉黄", "涉暴", "涉政", "涉恐"].map((cat) => (
                <span
                  key={cat}
                  className="px-2 py-1 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full"
                >
                  {cat}
                </span>
              ))}
            </div>
            <div>
              <label className="text-sm font-medium">研判模型</label>
              <input
                type="text"
                value={cfg.semantic_model}
                onChange={(e) =>
                  updateDraft({ semantic_model: e.target.value })
                }
                placeholder="例如: siliconflow:deepseek-ai/DeepSeek-V3"
                className="w-full mt-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                使用已配置的提供商中的模型，格式: provider:model-name
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">
                置信度阈值 ({cfg.semantic_threshold})
              </label>
              <p className="text-xs text-muted-foreground">
                模型判定的置信度达到此阈值才会触发告警
              </p>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.1"
                value={cfg.semantic_threshold}
                onChange={(e) =>
                  updateDraft({
                    semantic_threshold: parseFloat(e.target.value),
                  })
                }
                className="w-full mt-1"
              />
            </div>
            <details>
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                查看语义检测使用的分类提示词
              </summary>
              <pre className="mt-2 p-3 bg-background border border-border rounded-lg text-xs whitespace-pre-wrap text-muted-foreground max-h-60 overflow-y-auto">
                {defaultPrompt}
              </pre>
            </details>
          </div>
        </div>
      )}

      {tab === "alerts" && (
        <div className="bg-card rounded-lg border border-border">
          {alerts.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>暂无安全告警记录</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`p-4 ${alert.resolved ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 ${alert.resolved ? "text-green-500" : "text-red-500"}`}
                      >
                        {alert.resolved ? (
                          <CheckCircle size={18} />
                        ) : (
                          <ShieldAlert size={18} />
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                          <span
                            className={`px-1.5 py-0.5 rounded text-xs font-medium ${alert.direction === "input" ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400"}`}
                          >
                            {alert.direction === "input" ? "输入" : "输出"}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-xs font-medium ${alert.mode === "block" ? "bg-amber-500/10 text-amber-400" : "bg-cyan-500/10 text-cyan-400"}`}
                          >
                            {alert.mode === "block" ? "拦截" : "检测"}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-xs font-medium ${alert.trigger_type === "keyword" ? "bg-orange-500/10 text-orange-400" : "bg-red-500/10 text-red-400"}`}
                          >
                            {alert.trigger_type === "keyword"
                              ? "关键词"
                              : "语义检测"}
                          </span>
                          {alert.trigger_detail && (
                            <code className="text-xs text-muted-foreground">
                              {alert.trigger_detail}
                            </code>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {alert.content_preview}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span>
                            {new Date(alert.timestamp).toLocaleString()}
                          </span>
                          {alert.model && <span>模型: {alert.model}</span>}
                          {alert.api_key_used && (
                            <span>Key: {alert.api_key_used}</span>
                          )}
                          {alert.client_ip && (
                            <span>IP: {alert.client_ip}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {!alert.resolved && (
                      <button
                        onClick={() =>
                          invoke("resolve_security_alert", {
                            id: alert.id,
                          }).then(() =>
                            queryClient.invalidateQueries({
                              queryKey: ["security-alerts"],
                            }),
                          )
                        }
                        className="px-3 py-1 text-xs bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 shrink-0"
                      >
                        标记已处理
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
