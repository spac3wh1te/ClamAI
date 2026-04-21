import { useState } from "react";
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
  Brain,
  History,
} from "lucide-react";
import { registerSecurityApp } from "./registry";

interface AnalysisResult {
  success: boolean;
  message: string;
  analysis: string | null;
  risk_level: string;
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

registerSecurityApp({
  id: "skills-detection",
  name: "Skills 文档检测",
  description: "检测 AI Agent Skills 文档中的安全风险",
  icon: Brain,
  component: SkillsDetection,
  order: 2,
});

export default SkillsDetection;
