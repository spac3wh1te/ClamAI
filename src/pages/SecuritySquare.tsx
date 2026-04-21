import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Shield,
  Upload,
  Link,
  FileText,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  User,
  Brain,
  History,
  Activity,
  Clock,
  Globe,
  Cpu,
  Zap,
  TrendingUp,
} from "lucide-react";

interface AnalysisResult {
  success: boolean;
  message: string;
  analysis: string | null;
  risk_level: string;
}

interface ApiKey {
  id: string;
  name: string;
  key: string;
  active: boolean;
  allowed_models: string[];
}

interface SkillsHistoryRecord {
  id: number;
  checked_at: string;
  source_type: string;
  source_info: string;
  result: string;
  risk_level: string;
  model_used: string;
}

interface ProfileDimension {
  level: string;
  description: string;
}

interface ProfileAnalysis {
  risk_level: string;
  summary: string;
  details: {
    call_frequency: ProfileDimension;
    model_usage: ProfileDimension;
    success_rate: ProfileDimension;
    request_content: ProfileDimension;
    ip_distribution: ProfileDimension;
    token_usage: ProfileDimension;
  };
  recommendations: string[];
}

function parseAnalysis(text: string): ProfileAnalysis | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.risk_level && parsed.details) return parsed;
    return null;
  } catch {
    return null;
  }
}

const RISK_CONFIG: Record<
  string,
  {
    bg: string;
    border: string;
    text: string;
    label: string;
    icon: typeof XCircle;
  }
> = {
  极高: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-500",
    label: "极高风险",
    icon: XCircle,
  },
  高: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-500",
    label: "高风险",
    icon: XCircle,
  },
  中: {
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    text: "text-orange-500",
    label: "中风险",
    icon: AlertTriangle,
  },
  低: {
    bg: "bg-green-500/10",
    border: "border-green-500/30",
    text: "text-green-500",
    label: "低风险",
    icon: CheckCircle,
  },
};

function getRiskConfig(level: string) {
  return (
    RISK_CONFIG[level] || {
      bg: "bg-muted",
      border: "border-border",
      text: "text-muted-foreground",
      label: "未知",
      icon: Shield,
    }
  );
}

const DIMENSION_ICONS: Record<string, typeof Activity> = {
  call_frequency: Clock,
  model_usage: Cpu,
  success_rate: TrendingUp,
  request_content: FileText,
  ip_distribution: Globe,
  token_usage: Zap,
};

const DIMENSION_LABELS: Record<string, string> = {
  call_frequency: "调用频率",
  model_usage: "模型使用",
  success_rate: "成功率",
  request_content: "请求内容",
  ip_distribution: "IP 分布",
  token_usage: "Token 消耗",
};

const SKILLS_DIM_LABELS: Record<string, string> = {
  malicious_instructions: "恶意指令",
  data_poisoning: "数据投毒",
  privacy_leak: "隐私泄露",
  backdoor: "后门陷阱",
  misinformation: "经验误导",
  prompt_injection: "提示注入",
};

function parseSkillsResult(text: string): {
  conclusion: string;
  summary: string;
  dimensions: Record<string, any>;
  recommendation: string;
} | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.conclusion) return parsed;
    return null;
  } catch {
    return null;
  }
}

function CallerProfileAnalysis() {
  const [analysisModel, setAnalysisModel] = useState("");
  const [auditApiKeyId, setAuditApiKeyId] = useState("");
  const [timeRange, setTimeRange] = useState("7d");
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: apiKeysData } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => invoke<{ keys: ApiKey[] }>("list_api_keys"),
  });

  const { data: proxyModels } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => invoke<string[]>("get_proxy_models"),
  });

  const apiKeys = (apiKeysData?.keys || []).filter((k) => k.active);
  const allModels = proxyModels || [];

  const profileData = rawResult ? parseAnalysis(rawResult) : null;

  const analyzeMutation = useMutation({
    mutationFn: async (params: {
      model: string;
      apiKeyId: string;
      timeRange: string;
    }) => {
      return invoke<AnalysisResult>("analyze_user_profile", params);
    },
    onSuccess: (data) => {
      if (data.success && data.analysis) {
        setRawResult(data.analysis);
      } else {
        setErrorMsg(`分析失败: ${data.message}`);
      }
      setIsAnalyzing(false);
    },
    onError: (err: any) => {
      setErrorMsg(`调用失败: ${err}`);
      setIsAnalyzing(false);
    },
  });

  const handleAnalyze = () => {
    if (!analysisModel || !auditApiKeyId) return;
    setIsAnalyzing(true);
    setRawResult(null);
    setErrorMsg(null);
    analyzeMutation.mutate({
      model: analysisModel,
      apiKeyId: auditApiKeyId,
      timeRange,
    });
  };

  const riskCfg = profileData ? getRiskConfig(profileData.risk_level) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <User className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">调用者画像分析</h2>
      </div>

      <div className="bg-muted/30 rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">分析模型</label>
            <select
              value={analysisModel}
              onChange={(e) => setAnalysisModel(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
            >
              <option value="">选择分析模型...</option>
              {allModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">用于执行AI分析</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              被审计 API Key
            </label>
            <select
              value={auditApiKeyId}
              onChange={(e) => setAuditApiKeyId(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
            >
              <option value="">选择被审计的 Key...</option>
              {apiKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              分析此Key的调用历史
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">时间范围</label>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
            >
              <option value="1d">最近 1 天</option>
              <option value="3d">最近 3 天</option>
              <option value="7d">最近 7 天</option>
              <option value="30d">最近 30 天</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleAnalyze}
              disabled={!analysisModel || !auditApiKeyId || isAnalyzing}
              className="w-full flex items-center justify-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {isAnalyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Brain className="w-4 h-4" />
              )}
              {isAnalyzing ? "分析中..." : "开始分析"}
            </button>
          </div>
        </div>
      </div>

      {profileData && riskCfg && (
        <div className="space-y-4">
          <div
            className={`${riskCfg.bg} border ${riskCfg.border} rounded-lg p-4`}
          >
            <div className="flex items-center gap-3 mb-2">
              {(() => {
                const Icon = riskCfg.icon;
                return <Icon className={`w-6 h-6 ${riskCfg.text}`} />;
              })()}
              <div>
                <div className={`text-lg font-bold ${riskCfg.text}`}>
                  风险等级: {riskCfg.label}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {profileData.summary}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(profileData.details).map(([key, dim]) => {
              const dimCfg = getRiskConfig(dim.level);
              const Icon = DIMENSION_ICONS[key] || Activity;
              const label = DIMENSION_LABELS[key] || key;
              return (
                <div
                  key={key}
                  className={`${dimCfg.bg} border ${dimCfg.border} rounded-lg p-3`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${dimCfg.text}`} />
                    <span className="font-medium text-sm">{label}</span>
                    <span
                      className={`ml-auto text-xs px-2 py-0.5 rounded ${dimCfg.bg} ${dimCfg.text} font-medium`}
                    >
                      {dimCfg.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {dim.description}
                  </p>
                </div>
              );
            })}
          </div>

          {profileData.recommendations &&
            profileData.recommendations.length > 0 && (
              <div className="bg-card rounded-lg border border-border p-4">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  安全建议
                </h4>
                <ul className="space-y-1">
                  {profileData.recommendations.map((rec, i) => (
                    <li
                      key={i}
                      className="text-sm text-muted-foreground flex gap-2"
                    >
                      <span className="text-primary font-medium">{i + 1}.</span>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
        </div>
      )}

      {rawResult && !profileData && (
        <div className="bg-card rounded-lg p-4 border border-border">
          <h4 className="text-sm font-medium mb-3">分析结果</h4>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {rawResult}
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-sm text-red-500">{errorMsg}</p>
        </div>
      )}
    </div>
  );
}

function SkillsDetection() {
  const [selectedModel, setSelectedModel] = useState("");
  const [sourceType, setSourceType] = useState<
    "text" | "url" | "file_path" | "upload"
  >("text");
  const [inputValue, setInputValue] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: proxyModels } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => invoke<string[]>("get_proxy_models"),
  });

  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ["skills-history"],
    queryFn: () =>
      invoke<{ records: SkillsHistoryRecord[]; total: number }>(
        "get_skills_detection_history",
        { limit: 20, offset: 0 },
      ),
    enabled: showHistory,
  });

  const checkMutation = useMutation({
    mutationFn: async (params: {
      model: string;
      sourceType: string;
      content: string;
    }) => {
      return invoke<AnalysisResult>("check_skills_content", params);
    },
    onSuccess: (data) => {
      setResult(data);
      setIsChecking(false);
      if (showHistory) refetchHistory();
    },
    onError: (err: any) => {
      setErrorMsg(`检测失败: ${err}`);
      setResult({
        success: false,
        message: String(err),
        analysis: null,
        risk_level: "unknown",
      });
      setIsChecking(false);
    },
  });

  const handleCheck = () => {
    if (!selectedModel || !inputValue.trim()) return;
    setIsChecking(true);
    setResult(null);
    setErrorMsg(null);
    checkMutation.mutate({
      model: selectedModel,
      sourceType: sourceType === "upload" ? "text" : sourceType,
      content: inputValue,
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setInputValue(ev.target?.result as string);
    reader.readAsText(file);
  };

  const models = proxyModels || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <Brain className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">Skills 文档检测</h2>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="ml-auto flex items-center gap-1 px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <History className="w-4 h-4" />
          {showHistory ? "隐藏历史" : "查看历史"}
        </button>
      </div>

      {showHistory && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h4 className="text-sm font-medium">检测历史</h4>
          </div>
          <div className="divide-y divide-border max-h-64 overflow-y-auto">
            {historyData?.records?.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                暂无检测记录
              </div>
            )}
            {historyData?.records?.map((record) => (
              <div key={record.id} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      record.risk_level === "high"
                        ? "bg-red-500/20 text-red-400"
                        : record.risk_level === "medium"
                          ? "bg-orange-500/20 text-orange-400"
                          : record.risk_level === "low"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {record.risk_level === "high"
                      ? "高风险"
                      : record.risk_level === "medium"
                        ? "中风险"
                        : record.risk_level === "low"
                          ? "低风险"
                          : "未知"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(record.checked_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-1">
                  类型: {record.source_type} | 模型: {record.model_used}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {record.source_info}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-muted/30 rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">分析模型</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
            >
              <option value="">选择分析模型...</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">输入方式</label>
            <div className="flex gap-2">
              {[
                { value: "text", label: "粘贴文本", icon: FileText },
                { value: "url", label: "URL 链接", icon: Link },
                { value: "file_path", label: "文件路径", icon: FileText },
                { value: "upload", label: "文件上传", icon: Upload },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setSourceType(value as typeof sourceType)}
                  className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm border ${
                    sourceType === value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          {sourceType === "url" && (
            <input
              type="url"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="https://example.com/skills.md"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
            />
          )}
          {sourceType === "file_path" && (
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="/path/to/skills.md"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono"
            />
          )}
          {sourceType === "text" && (
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full h-40 px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono resize-none"
              placeholder="粘贴 Skills 文档内容..."
            />
          )}
          {sourceType === "upload" && (
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-3">
                支持 .md, .txt, .json 等文本文件
              </p>
              <input
                type="file"
                accept=".md,.txt,.json,.yaml,.yml"
                onChange={handleFileUpload}
                className="hidden"
                id="skills-upload"
              />
              <label
                htmlFor="skills-upload"
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm cursor-pointer hover:bg-primary/90 inline-block"
              >
                选择文件
              </label>
              {inputValue && (
                <p className="mt-2 text-xs text-muted-foreground">
                  已加载: {inputValue.length} 字符
                </p>
              )}
            </div>
          )}
        </div>

        <button
          onClick={handleCheck}
          disabled={!selectedModel || !inputValue.trim() || isChecking}
          className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          {isChecking ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Shield className="w-4 h-4" />
          )}
          {isChecking ? "检测中..." : "开始检测"}
        </button>
      </div>

      {result &&
        (() => {
          const skillsData = result.analysis
            ? parseSkillsResult(result.analysis)
            : null;
          if (skillsData) {
            const conclusionCfg =
              skillsData.conclusion === "safe"
                ? {
                    bg: "bg-green-500/10",
                    border: "border-green-500/30",
                    text: "text-green-500",
                    icon: CheckCircle,
                    label: "安全",
                  }
                : skillsData.conclusion === "dangerous"
                  ? {
                      bg: "bg-red-500/10",
                      border: "border-red-500/30",
                      text: "text-red-500",
                      icon: XCircle,
                      label: "危险",
                    }
                  : {
                      bg: "bg-muted",
                      border: "border-border",
                      text: "text-muted-foreground",
                      icon: Shield,
                      label: "未知",
                    };
            const ConclusionIcon = conclusionCfg.icon;
            return (
              <div className="space-y-4">
                <div
                  className={`${conclusionCfg.bg} border ${conclusionCfg.border} rounded-lg p-4`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <ConclusionIcon
                      className={`w-6 h-6 ${conclusionCfg.text}`}
                    />
                    <span className={`text-lg font-bold ${conclusionCfg.text}`}>
                      {conclusionCfg.label}
                    </span>
                    <span className="text-sm text-muted-foreground ml-2">
                      {skillsData.summary}
                    </span>
                  </div>
                </div>
                {skillsData.dimensions && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Object.entries(skillsData.dimensions).map(
                      ([key, dim]: [string, any]) => {
                        const dimLabel = SKILLS_DIM_LABELS[key] || key;
                        const dimColor = dim.detected
                          ? "text-red-500"
                          : "text-green-500";
                        return (
                          <div
                            key={key}
                            className={`border rounded-lg p-3 ${dim.detected ? "bg-red-500/5 border-red-500/20" : "bg-card border-border"}`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm">
                                {dimLabel}
                              </span>
                              <span
                                className={`ml-auto text-xs font-medium ${dimColor}`}
                              >
                                {dim.detected
                                  ? `检测到 (${dim.confidence}%)`
                                  : "未检测到"}
                              </span>
                            </div>
                            {dim.detail && (
                              <p className="text-xs text-muted-foreground">
                                {dim.detail}
                              </p>
                            )}
                          </div>
                        );
                      },
                    )}
                  </div>
                )}
                {skillsData.recommendation && (
                  <div className="bg-card rounded-lg border border-border p-4">
                    <h4 className="text-sm font-medium mb-1 flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      处理建议
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      {skillsData.recommendation}
                    </p>
                  </div>
                )}
              </div>
            );
          }
          return (
            <div
              className={`rounded-lg p-4 border ${result.risk_level === "high" ? "bg-red-500/10 border-red-500/30" : result.risk_level === "medium" ? "bg-orange-500/10 border-orange-500/30" : result.risk_level === "low" ? "bg-green-500/10 border-green-500/30" : "bg-muted border-border"}`}
            >
              <div className="flex items-center gap-2 mb-3">
                {result.risk_level === "high" ? (
                  <XCircle className="w-5 h-5 text-red-500" />
                ) : result.risk_level === "medium" ? (
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                ) : result.risk_level === "low" ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <Shield className="w-5 h-5 text-muted-foreground" />
                )}
                <span className="font-semibold">
                  风险等级:{" "}
                  {result.risk_level === "high"
                    ? "高风险"
                    : result.risk_level === "medium"
                      ? "中风险"
                      : result.risk_level === "low"
                        ? "低风险"
                        : "未知"}
                </span>
              </div>
              {result.analysis && (
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {result.analysis}
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
}

export default function SecuritySquare() {
  const [activeTab, setActiveTab] = useState<"profile" | "skills">("profile");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">安全广场</h1>
        <p className="text-muted-foreground mt-2">智能安全分析工具集</p>
      </div>

      <div className="flex gap-2 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab("profile")}
          className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm transition-colors ${
            activeTab === "profile"
              ? "bg-card border border-border border-b-transparent"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <User className="w-4 h-4" />
          调用者画像分析
        </button>
        <button
          onClick={() => setActiveTab("skills")}
          className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm transition-colors ${
            activeTab === "skills"
              ? "bg-card border border-border border-b-transparent"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Brain className="w-4 h-4" />
          Skills 检测
        </button>
      </div>

      <div className="bg-card rounded-lg p-6 border border-border">
        {activeTab === "profile" ? (
          <CallerProfileAnalysis />
        ) : (
          <SkillsDetection />
        )}
      </div>
    </div>
  );
}
