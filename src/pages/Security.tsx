import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import { useState, useEffect } from "react";
import { securityApi, type SecurityConfig, type DirectionConfig } from "../api/security";
import {
  Shield,
  ShieldCheck,
  Plus,
  X,
  Save,
  Database,
  Trash2,
  BookOpen,
  Brain,
} from "lucide-react";

const CATEGORIES = [
  { id: "pornography", label: "涉黄", color: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/30" },
  { id: "violence", label: "涉暴", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
  { id: "politics", label: "涉政", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  { id: "terrorism", label: "涉恐", color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  { id: "sensitive_data", label: "敏感数据", color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30" },
] as const;

const LEVELS = [
  { id: "critical", label: "严重", color: "text-red-400" },
  { id: "high", label: "高危", color: "text-orange-400" },
  { id: "medium", label: "中危", color: "text-yellow-400" },
  { id: "low", label: "低危", color: "text-green-400" },
] as const;

const defaultConfig: SecurityConfig = {
  enabled: false,
  input: {
    enabled: true,
    mode: "block",
    keyword_enabled: true,
    keyword_categories: ["pornography", "violence", "politics", "terrorism", "sensitive_data"],
    semantic_enabled: false,
    vector_enabled: false,
  },
  output: {
    enabled: true,
    mode: "block",
    keyword_enabled: true,
    keyword_categories: ["pornography", "violence", "politics", "terrorism", "sensitive_data"],
    semantic_enabled: false,
    vector_enabled: false,
  },
  keywords: [],
  keyword_by_level: {},
  keyword_by_category: {
    pornography: { critical: [], high: [], medium: [], low: [] },
    violence: { critical: [], high: [], medium: [], low: [] },
    politics: { critical: [], high: [], medium: [], low: [] },
    terrorism: { critical: [], high: [], medium: [], low: [] },
    sensitive_data: { critical: [], high: [], medium: [], low: [] },
  },
  keyword_levels: ["critical", "high", "medium", "low"],
  keyword_whitelist: [],
  block_message: "抱歉，您的内容涉及敏感信息，已被安全策略拦截。",
  semantic_model: "",
  semantic_threshold: 0.8,
  semantic_prompt: "",
  auto_ban_key: false,
};

export default function Security({ initialTab }: { initialTab?: "config" | "keyword" | "semantic" | "vector" }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"config" | "keyword" | "semantic" | "vector">(initialTab || "config");
  const [draft, setDraft] = useState<SecurityConfig | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  const [kwTab, setKwTab] = useState<string>("pornography");
  const [newSample, setNewSample] = useState({
    content: "",
    category: "general",
  });
  const [newSampleSource, setNewSampleSource] = useState("manual");

  const { data: remoteConfig, isLoading, isError, error } = useQuery({
    queryKey: ["security-config"],
    queryFn: () => securityApi.getConfig() as unknown as Promise<SecurityConfig>,
    staleTime: 0,
    retry: 1,
    retryDelay: 1000,
  });

  const { data: proxyModels } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => invoke<string[]>("get_proxy_models"),
  });

  const { data: vectorSamplesData, refetch: refetchVectorSamples } = useQuery({
    queryKey: ["vector-samples"],
    queryFn: async () => {
      const raw = await invoke<string>("get_vector_samples", { limit: 100 });
      return JSON.parse(raw) as {
        samples: {
          id: number;
          content: string;
          category: string;
          source: string;
          created_at: string;
          auto_added: boolean;
        }[];
        total: number;
      };
    },
    staleTime: 0,
    enabled: tab === "vector",
  });

  const saveMutation = useMutation({
    mutationFn: (cfg: SecurityConfig) => securityApi.saveConfig(cfg as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["security-config"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (isLoading) return <div className="p-6">加载安全配置中...</div>;
  if (isError) return <div className="p-6 text-red-500">加载安全配置失败: {String(error)}</div>;

  const cfg = draft || remoteConfig || defaultConfig;

  const getKCat = () => {
    if (!cfg.keyword_by_category) return {};
    return cfg.keyword_by_category[kwTab] || {};
  };

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

  const toggleCategory = (cat: string, direction: "input" | "output") => {
    const current = direction === "input" ? cfg.input.keyword_categories : cfg.output.keyword_categories;
    const next = current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat];
    if (direction === "input") {
      updateInput({ keyword_categories: next });
    } else {
      updateOutput({ keyword_categories: next });
    }
  };

  const addKeywordToCat = (level: string, kw: string) => {
    if (!kw.trim()) return;
    const kcat = { ...getKCat() };
    const existing = kcat[level] || [];
    if (existing.includes(kw.trim())) return;
    kcat[level] = [...existing, kw.trim()];
    const newKBC = { ...cfg.keyword_by_category, [kwTab]: kcat };
    updateDraft({ keyword_by_category: newKBC });
  };

  const removeKeywordFromCat = (level: string, kw: string) => {
    const kcat = { ...getKCat() };
    kcat[level] = (kcat[level] || []).filter((k: string) => k !== kw);
    const newKBC = { ...cfg.keyword_by_category, [kwTab]: kcat };
    updateDraft({ keyword_by_category: newKBC });
  };

  const addWhitelistKeyword = (kw: string) => {
    const trimmed = kw.trim();
    if (!trimmed) return;
    const existing = cfg.keyword_whitelist || [];
    if (existing.includes(trimmed)) return;
    updateDraft({ keyword_whitelist: [...existing, trimmed] });
  };

  const removeWhitelistKeyword = (kw: string) => {
    updateDraft({ keyword_whitelist: (cfg.keyword_whitelist || []).filter((k) => k !== kw) });
  };

  const getCatKwCount = (cat: string) => {
    const catMap = cfg.keyword_by_category?.[cat] || {};
    return Object.values(catMap).reduce((s: number, v: any) => s + (v?.length || 0), 0);
  };

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

  const TABS = [
    { id: "config" as const, label: "安全配置", icon: Shield },
    { id: "keyword" as const, label: "关键词词库", icon: BookOpen },
    { id: "semantic" as const, label: "语义检测", icon: Brain },
    { id: "vector" as const, label: "向量样本库", icon: Database },
  ];

  return (
    <div className="space-y-6">
      {!initialTab && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">防护策略</h1>
            <p className="text-muted-foreground mt-2">
              内容安全策略与检测规则配置
            </p>
          </div>
          <div className="flex items-center gap-3">
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
      )}

      {!initialTab && (
        <div className="flex gap-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${tab === t.id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {initialTab && (
        <div className="flex items-center justify-end">
          <button
            onClick={() => saveMutation.mutate(cfg)}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            <Save size={16} />
            {saveMutation.isPending ? "保存中..." : saved ? "已保存" : "保存配置"}
          </button>
        </div>
      )}

      {/* ===== Tab 1: 安全配置 ===== */}
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

          {/* 输入检测 */}
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
                      onChange={(e) => updateInput({ keyword_enabled: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">关键词检测</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.input.semantic_enabled}
                      onChange={(e) => updateInput({ semantic_enabled: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">语义安全检测</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.input.vector_enabled}
                      onChange={(e) => updateInput({ vector_enabled: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">向量相似度检测</span>
                  </label>
                </div>
              </>
            )}
          </div>

          {/* 输出检测 */}
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
                      onChange={(e) => updateOutput({ keyword_enabled: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">关键词检测</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.output.semantic_enabled}
                      onChange={(e) => updateOutput({ semantic_enabled: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">语义安全检测</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.output.vector_enabled}
                      onChange={(e) => updateOutput({ vector_enabled: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">向量相似度检测</span>
                  </label>
                </div>
                {cfg.output.mode === "detect" && (
                  <label className="flex items-center gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.auto_ban_key}
                      onChange={(e) => updateDraft({ auto_ban_key: e.target.checked })}
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

          {/* 拦截后回复 */}
          <div className="bg-card rounded-lg p-6 border border-border">
            <h3 className="text-lg font-semibold mb-4">拦截后回复内容</h3>
            <textarea
              value={cfg.block_message}
              onChange={(e) => updateDraft({ block_message: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>
        </div>
      )}

      {/* ===== Tab 2: 关键词词库 ===== */}
      {tab === "keyword" && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg p-6 border border-border">
            <h3 className="text-lg font-semibold mb-2">全局白名单</h3>
            <p className="text-xs text-muted-foreground mb-3">
              黑名单关键词命中后，如果同一段内容也命中白名单，则本次关键词命中会被豁免。
            </p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="添加白名单关键词..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const input = e.currentTarget;
                    addWhitelistKeyword(input.value);
                    input.value = "";
                  }
                }}
                className="flex-1 px-2 py-1.5 bg-background border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {(cfg.keyword_whitelist || []).map((kw) => (
                <span
                  key={kw}
                  className="flex items-center gap-0.5 px-2 py-0.5 rounded text-xs border bg-green-500/10 text-green-400 border-green-500/30"
                >
                  {kw}
                  <button
                    onClick={() => removeWhitelistKeyword(kw)}
                    className="hover:opacity-70 ml-0.5"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              {(cfg.keyword_whitelist || []).length === 0 && (
                <span className="text-xs text-muted-foreground">暂无</span>
              )}
            </div>
          </div>

          <div className="bg-card rounded-lg p-6 border border-border">
            <h3 className="text-lg font-semibold mb-4">黑名单词库</h3>

            <div className="flex flex-wrap gap-2 mb-4 border-b border-border pb-3">
              {CATEGORIES.map((cat) => {
                const count = getCatKwCount(cat.id);
                const active = kwTab === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setKwTab(cat.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 border transition-colors ${active ? `${cat.bg} ${cat.color} border-current` : "bg-secondary text-secondary-foreground border-border hover:bg-secondary/80"}`}
                  >
                    {cat.label}
                    {count > 0 && <span className={`text-xs ${active ? "opacity-70" : "text-muted-foreground"}`}>({count})</span>}
                  </button>
                );
              })}
            </div>

            <div className="space-y-3">
              {(() => {
                const curCat = CATEGORIES.find((c) => c.id === kwTab) || CATEGORIES[0];
                return LEVELS.map((level) => {
                const catMap = getKCat();
                const kws: string[] = catMap[level.id] || [];
                const levelEnabled = (cfg.keyword_levels || []).includes(level.id);
                return (
                  <div key={level.id} className={`border rounded-lg p-3 ${levelEnabled ? "border-border" : "border-border/50 opacity-60"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-medium ${level.color}`}>[{level.label}]</span>
                      <span className="text-xs text-muted-foreground">{kws.length} 个词</span>
                    </div>
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        placeholder={`添加${level.label}级关键词...`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const input = e.currentTarget;
                            addKeywordToCat(level.id, input.value);
                            input.value = "";
                          }
                        }}
                        className="flex-1 px-2 py-1.5 bg-background border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {kws.map((kw) => (
                        <span
                          key={kw}
                          className={`flex items-center gap-0.5 px-2 py-0.5 rounded text-xs border ${catMap[level.id]?.includes(kw) ? `${curCat.bg} ${curCat.color} border-current` : "bg-secondary text-secondary-foreground border-border"}`}
                        >
                          {kw}
                          <button
                            onClick={() => removeKeywordFromCat(level.id, kw)}
                            className="hover:opacity-70 ml-0.5"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                      {kws.length === 0 && (
                        <span className="text-xs text-muted-foreground">暂无</span>
                      )}
                    </div>
                  </div>
                );
              });
              })()}
            </div>

            <p className="text-xs text-muted-foreground mt-3">
              分类分级说明：严重级匹配最严格，低危级最宽松。请求进来时根据输入/输出检测配置中启用的分类进行检查。
            </p>
          </div>

          {/* 分类启用配置 */}
          <div className="bg-card rounded-lg p-6 border border-border">
            <h3 className="text-lg font-semibold mb-3">分类启用配置</h3>
            <p className="text-xs text-muted-foreground mb-3">控制哪些分类在输入检测和输出检测中被启用</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="pb-2 pr-4">分类</th>
                    <th className="pb-2 px-2">输入检测</th>
                    <th className="pb-2 px-2">输出检测</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORIES.map((cat) => (
                    <tr key={cat.id} className="border-b border-border/50">
                      <td className={`py-2 pr-4 font-medium ${cat.color}`}>{cat.label}</td>
                      <td className="px-2 text-center">
                        <input
                          type="checkbox"
                          checked={(cfg.input.keyword_categories || []).includes(cat.id)}
                          onChange={() => toggleCategory(cat.id, "input")}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="px-2 text-center">
                        <input
                          type="checkbox"
                          checked={(cfg.output.keyword_categories || []).includes(cat.id)}
                          onChange={() => toggleCategory(cat.id, "output")}
                          className="w-4 h-4"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== Tab 3: 语义检测 ===== */}
      {tab === "semantic" && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg p-6 border border-border space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">语义安全检测</h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={`inline-block w-2 h-2 rounded-full ${cfg.input.semantic_enabled || cfg.output.semantic_enabled ? "bg-green-500" : "bg-gray-400"}`} />
                {cfg.input.semantic_enabled || cfg.output.semantic_enabled ? "已启用" : "未启用"}
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              使用 LLM 对内容进行语义级别的安全分类。需在"安全配置"页签中为输入/输出检测勾选"语义安全检测"才会实际生效。
            </p>

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
              <label className="text-sm font-medium">分析模型</label>
              <select
                value={cfg.semantic_model}
                onChange={(e) => updateDraft({ semantic_model: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">选择分析模型...</option>
                {(proxyModels || []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                使用已配置的提供商中的模型
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
                onChange={(e) => updateDraft({ semantic_threshold: parseFloat(e.target.value) })}
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

      {/* ===== Tab 4: 向量样本库 ===== */}
      {tab === "vector" && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg p-6 border border-border space-y-4">
            <h3 className="text-lg font-semibold">添加恶意样本</h3>
            <p className="text-sm text-muted-foreground">
              添加已知恶意内容到向量库，用于相似度检测。系统会自动调用 Embedding
              API 生成向量。
            </p>
            <textarea
              value={newSample.content}
              onChange={(e) => setNewSample({ ...newSample, content: e.target.value })}
              placeholder="输入恶意内容样本..."
              rows={4}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
            <div className="flex gap-3 items-center">
              <select
                value={newSample.category}
                onChange={(e) => setNewSample({ ...newSample, category: e.target.value })}
                className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="general">通用恶意</option>
                <option value="prompt_injection">提示注入</option>
                <option value="data_exfiltration">数据窃取</option>
                <option value="jailbreak">越狱攻击</option>
                <option value="phishing">钓鱼社工</option>
                <option value="sensitive_data">敏感数据</option>
                <option value="pornography">涉黄</option>
                <option value="violence">涉暴</option>
                <option value="politics">涉政</option>
              </select>
              <button
                onClick={async () => {
                  if (!newSample.content.trim()) return;
                  await invoke("add_vector_sample", {
                    content: newSample.content,
                    category: newSample.category,
                    source: newSampleSource,
                  });
                  setNewSample({ content: "", category: "general" });
                  refetchVectorSamples();
                }}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm"
              >
                <Plus size={16} />
                添加样本
              </button>
            </div>
          </div>

          <div className="bg-card rounded-lg border border-border">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">样本列表</h3>
                <p className="text-sm text-muted-foreground">
                  共 {vectorSamplesData?.total || 0} 个样本
                </p>
              </div>
            </div>
            {!vectorSamplesData?.samples || vectorSamplesData.samples.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>暂无向量样本</p>
                <p className="text-xs mt-1">
                  添加恶意内容样本以启用向量相似度检测
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {vectorSamplesData.samples.map((sample) => (
                  <div key={sample.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-teal-500/10 text-teal-400">
                            {sample.category}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">
                            {sample.source}
                          </span>
                          {sample.auto_added && (
                            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-400">
                              自动积累
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {new Date(sample.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-3">
                          {sample.content}
                        </p>
                      </div>
                      <button
                        onClick={async () => {
                          await invoke("delete_vector_sample", { id: sample.id });
                          refetchVectorSamples();
                        }}
                        className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}