import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Shield,
  FileText,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  User,
  Brain,
  Activity,
  Clock,
  Globe,
  Cpu,
  Zap,
  TrendingUp,
  History,
  Trash2,
} from "lucide-react";
import { registerSecurityApp } from "./registry";

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

interface ProfileHistoryRecord {
  id: number;
  analyzed_at: string;
  api_key_id: string;
  time_range: string;
  risk_level: string;
  summary: string;
  result: string;
  model_used: string;
  logs_analyzed: number;
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

function CallerProfileAnalysis() {
  const [analysisModel, setAnalysisModel] = useState("");
  const [auditApiKeyId, setAuditApiKeyId] = useState("");
  const [timeRange, setTimeRange] = useState("7d");
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(
    null,
  );

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

  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ["profile-history"],
    queryFn: () =>
      invoke<{ records: ProfileHistoryRecord[]; total: number }>(
        "get_profile_analysis_history",
        { limit: 20, offset: 0 },
      ),
    enabled: showHistory,
  });

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
      if (showHistory) refetchHistory();
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
            <h4 className="text-sm font-medium">分析历史</h4>
          </div>
          <div className="divide-y divide-border max-h-72 overflow-y-auto">
            {historyData?.records?.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                暂无分析记录
              </div>
            )}
            {historyData?.records?.map((record) => (
              <div key={record.id} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        record.risk_level === "极高" ||
                        record.risk_level === "高"
                          ? "bg-red-500/20 text-red-400"
                          : record.risk_level === "中"
                            ? "bg-orange-500/20 text-orange-400"
                            : record.risk_level === "低"
                              ? "bg-green-500/20 text-green-400"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {record.risk_level === "极高"
                        ? "极高风险"
                        : record.risk_level === "高"
                          ? "高风险"
                          : record.risk_level === "中"
                            ? "中风险"
                            : record.risk_level === "低"
                              ? "低风险"
                              : "未知"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {record.model_used}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {record.time_range}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {record.logs_analyzed}条日志
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(record.analyzed_at).toLocaleString("zh-CN")}
                    </span>
                    <button
                      onClick={() =>
                        setExpandedHistoryId(
                          expandedHistoryId === record.id ? null : record.id,
                        )
                      }
                      className="text-xs text-primary hover:underline"
                    >
                      {expandedHistoryId === record.id ? "收起" : "详情"}
                    </button>
                  </div>
                </div>
                {record.summary && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {record.summary}
                  </p>
                )}
                {expandedHistoryId === record.id && record.result && (
                  <div className="mt-2 p-2 bg-muted/30 rounded text-xs whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {record.result}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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

registerSecurityApp({
  id: "caller-profile",
  name: "调用者画像分析",
  description: "分析 API Key 的调用行为模式，识别潜在安全风险",
  icon: User,
  component: CallerProfileAnalysis,
  order: 1,
});

export default CallerProfileAnalysis;
