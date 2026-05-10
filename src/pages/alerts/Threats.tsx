import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { systemAnalysisApi, type KeyResult, type ThreatSignal } from "../../api/analysis";
import {
  Shield, ShieldAlert, ShieldCheck, Play, Activity,
  Zap, ShieldX, ShieldAlert as ShieldAlertIcon, AlertTriangle, Loader2, Search, X,
} from "lucide-react";

const RISK_CONFIG: Record<string, { color: string; bg: string; border: string; icon: typeof ShieldX; label: string }> = {
  "极高": { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", icon: ShieldX, label: "极高" },
  "高": { color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", icon: ShieldAlertIcon, label: "高危" },
  "中": { color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", icon: AlertTriangle, label: "可疑" },
  "低": { color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20", icon: ShieldCheck, label: "一般" },
};

const DIM_LABELS: Record<string, string> = {
  call_frequency: "调用频率", model_usage: "模型使用", success_rate: "成功率",
  request_content: "请求内容", ip_distribution: "IP 分布", token_usage: "Token 消耗",
};

const SEVERITY_OPTIONS = [
  { value: "", label: "全部级别" },
  { value: "极高", label: "极高" },
  { value: "高", label: "高危" },
  { value: "中", label: "可疑" },
  { value: "低", label: "一般" },
];

function StatCard({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
        <p className="text-xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function tryExtractReport(raw: string): string {
  const jsonStr = raw.trim();
  try {
    const obj = JSON.parse(jsonStr);
    const lines: string[] = [];
    if (obj.risk_level) lines.push(`风险等级: ${obj.risk_level}`);
    if (obj.summary) lines.push(`摘要: ${obj.summary}`);
    if (obj.details && typeof obj.details === "object") {
      for (const [k, v] of Object.entries(obj.details)) {
        const d = v as any;
        const label = DIM_LABELS[k] || k;
        lines.push(`\n【${label}】${d.level ? " (" + d.level + ")" : ""}`);
        if (d.description) lines.push(d.description);
      }
    }
    if (obj.recommendations) {
      const recs = Array.isArray(obj.recommendations) ? obj.recommendations : [obj.recommendations];
      lines.push("\n建议:");
      recs.forEach((r: string, i: number) => lines.push(`  ${i + 1}. ${r}`));
    }
    return lines.length > 0 ? lines.join("\n") : raw;
  } catch {
    return raw;
  }
}

function ThreatRow({ result }: { result: KeyResult }) {
  const [expanded, setExpanded] = useState(false);
  const displayRisk = !result.analyzed
    ? (result.threat_score >= 35 ? "高" : result.threat_score >= 20 ? "中" : "低")
    : (result.risk_level || "低");
  const cfg = RISK_CONFIG[displayRisk] || RISK_CONFIG["低"];

  let signals: ThreatSignal[] = [];
  try { const p = JSON.parse(result.threat_signals || "[]"); if (Array.isArray(p)) signals = p; } catch {}

  let dimensions: Record<string, { level: string; description: string }> = {};
  try {
    const raw = JSON.parse(result.dimensions || "{}");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "object" && v !== null && "level" in v && "description" in v) {
          dimensions[k] = v as { level: string; description: string };
        }
      }
    }
  } catch {}

  let aiReport = "";
  if (result.detail && result.analyzed) {
    const extracted = tryExtractReport(result.detail);
    aiReport = extracted;
  }

  const scoreColor = result.threat_score >= 35 ? "text-red-400 bg-red-500/10" :
                      result.threat_score >= 20 ? "text-orange-400 bg-orange-500/10" :
                      result.threat_score >= 10 ? "text-yellow-400 bg-yellow-500/10" : "text-green-400 bg-green-500/10";

  const fmtTime = (ts: string | null | undefined) => {
    if (!ts) return "-";
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  return (
    <div className={result.analyzed ? "" : "opacity-60"}>
      <div
        className="grid grid-cols-[150px_60px_50px_minmax(80px,1fr)_minmax(120px,2fr)_55px_50px] gap-1.5 px-4 py-2.5 items-center text-sm cursor-pointer hover:bg-secondary/30"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[11px] text-muted-foreground truncate" title={result.run_at ? new Date(result.run_at).toLocaleString("zh-CN") : ""}>
          {fmtTime(result.run_at)}
        </span>
        <span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
            {cfg.label}
          </span>
        </span>
        <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${scoreColor}`}>
          {result.threat_score}
        </span>
        <span className="text-[11px] truncate font-mono">{result.api_key_name || result.api_key_id}</span>
        <span className="text-[11px] text-muted-foreground truncate" title={result.summary || ""}>{result.summary || "-"}</span>
        <span className="text-[11px] text-muted-foreground text-center">{result.logs_count || 0}</span>
        <button
          className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          详情
        </button>
      </div>
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border/50 space-y-3">
          {result.summary && (
            <p className="text-xs text-muted-foreground bg-muted/30 rounded p-2">{result.summary}</p>
          )}
          {signals.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] text-muted-foreground font-medium">威胁指标</span>
              {signals.map((s, i) => (
                <div key={i} className={`text-[10px] px-2 py-1 rounded ${
                  s.severity === "critical" ? "bg-red-500/10 text-red-400" :
                  s.severity === "high" ? "bg-orange-500/10 text-orange-400" :
                  s.severity === "medium" ? "bg-yellow-500/10 text-yellow-400" :
                  "bg-green-500/10 text-green-400"
                }`}>
                  <span className="font-medium">[{s.rule}]</span> {s.detail}
                </div>
              ))}
            </div>
          )}
          {Object.keys(dimensions).length > 0 && (
            <div>
              <span className="text-[10px] text-muted-foreground font-medium">维度分析</span>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-1">
                {Object.entries(dimensions).map(([key, dim]) => {
                  const dcfg = RISK_CONFIG[dim.level] || RISK_CONFIG["低"];
                  const DIcon = dcfg.icon;
                  return (
                    <div key={key} className={`${dcfg.bg} rounded-lg p-2`}>
                      <div className="flex items-center gap-1 mb-0.5">
                        <DIcon className={`w-3 h-3 ${dcfg.color}`} />
                        <span className="text-[10px] font-medium">{DIM_LABELS[key] || key}</span>
                        <span className={`ml-auto text-[10px] px-1 py-0.5 rounded ${dcfg.bg} ${dcfg.color}`}>{dim.level}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">{dim.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {aiReport && (
            <div>
              <span className="text-[10px] text-muted-foreground font-medium">AI 分析报告</span>
              <pre className="mt-1 p-3 bg-muted/30 rounded text-xs whitespace-pre-wrap max-h-40 overflow-auto font-mono leading-relaxed">{aiReport}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AlertThreats() {
  const queryClient = useQueryClient();
  const [riskFilter, setRiskFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [triggering, setTriggering] = useState(false);

  const { data: config } = useQuery({
    queryKey: ["system-analysis-config"],
    queryFn: () => systemAnalysisApi.getConfig(),
    staleTime: 0,
  });

  const { data: tasksData } = useQuery({
    queryKey: ["system-analysis-tasks"],
    queryFn: () => systemAnalysisApi.listTasks(),
    staleTime: 0,
  });

  const { data: statusData } = useQuery({
    queryKey: ["system-analysis-status"],
    queryFn: () => systemAnalysisApi.getStatus(),
    staleTime: 0,
    refetchInterval: 3000,
  });

  const { data: keyResultsData, refetch: refetchResults } = useQuery({
    queryKey: ["system-analysis-key-results"],
    queryFn: () => systemAnalysisApi.getKeyResults(),
    staleTime: 0,
    refetchInterval: 10000,
  });

  const tasks: any[] = tasksData?.tasks || [];
  const systemTask = tasks.find((t) => t.id);
  const keyResults: Record<string, KeyResult[]> = keyResultsData?.results || {};
  const isRunning = statusData?.running || false;

  const allResults = Object.values(keyResults).flat().filter(r => !r.skipped);

  const highRiskCount = allResults.filter(r => {
    const risk = r.risk_level || (r.threat_score >= 35 ? "高" : r.threat_score >= 20 ? "中" : "低");
    return risk === "极高" || risk === "高";
  }).length;

  const filteredResults = allResults
    .filter(r => {
      if (riskFilter && r.risk_level !== riskFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const matchKey = (r.api_key_name || r.api_key_id || "").toLowerCase().includes(q);
        const matchSummary = (r.summary || "").toLowerCase().includes(q);
        if (!matchKey && !matchSummary) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const timeA = a.run_at ? new Date(a.run_at).getTime() : 0;
      const timeB = b.run_at ? new Date(b.run_at).getTime() : 0;
      return timeB - timeA;
    });

  const handleSearch = () => { setSearch(searchInput); };
  const clearFilters = () => { setRiskFilter(""); setSearch(""); setSearchInput(""); };
  const hasFilters = riskFilter || search;

  const handleTrigger = async () => {
    if (triggering || isRunning) return;
    setTriggering(true);
    try {
      await systemAnalysisApi.trigger();
      setTimeout(() => {
        refetchResults();
        queryClient.invalidateQueries({ queryKey: ["system-analysis-status"] });
      }, 2000);
    } finally {
      setTimeout(() => setTriggering(false), 3000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
            <ShieldAlert size={20} className="text-orange-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">威胁挖掘</h1>
            <p className="text-sm text-muted-foreground mt-1">AI 威胁分析实时告警记录</p>
          </div>
        </div>
        <button
          onClick={handleTrigger}
          disabled={triggering || isRunning}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition-colors ${
            triggering || isRunning ? "bg-secondary text-muted-foreground cursor-not-allowed" : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
          }`}
        >
          {triggering || isRunning ? <><Loader2 size={14} className="animate-spin" /> 分析执行中...</> : <><Play size={14} /> 立即执行</>}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={Activity} label="分析引擎" value={config?.enabled ? "运行中" : "已停止"} sub={`${config?.model || "未配置"} · ${config?.interval_minutes || 60}min`} color="bg-blue-500/10 text-blue-400" />
        <StatCard icon={ShieldAlert} label="高危威胁" value={highRiskCount} sub="严重 + 高危 (24h)" color="bg-red-500/10 text-red-400" />
        <StatCard icon={Zap} label="总会话数" value={allResults.length} sub={`AI分析 ${allResults.filter(r => r.analyzed).length} · 评分 ${allResults.filter(r => !r.analyzed).length}`} color="bg-amber-500/10 text-amber-400" />
        <StatCard icon={Shield} label="综合风险" value={systemTask?.result_risk_level || "-"} sub={systemTask?.result_risk_level ? "系统整体评估" : "尚未分析"} color="bg-purple-500/10 text-purple-400" />
      </div>

      <div className="bg-card rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search size={14} />
          <span>筛选条件</span>
          {hasFilters && (
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <X size={12} />清除筛选
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={riskFilter}
            onChange={(e) => { setRiskFilter(e.target.value); }}
            className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
          >
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="搜索 API Key、摘要..."
                className="w-full bg-secondary border border-border rounded-md pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <button onClick={handleSearch} className="px-3 py-1.5 bg-primary/20 text-primary rounded-md text-sm hover:bg-primary/30">搜索</button>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border">
        {filteredResults.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>暂无威胁分析告警</p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[150px_60px_50px_minmax(80px,1fr)_minmax(120px,2fr)_55px_50px] gap-1.5 px-4 py-2.5 text-[10px] text-muted-foreground font-medium border-b border-border items-center uppercase tracking-wider">
              <span>时间</span>
              <span>级别</span>
              <span>评分</span>
              <span>API Key</span>
              <span>描述</span>
              <span>日志</span>
              <span></span>
            </div>
            <div className="divide-y divide-border">
              {filteredResults.map((result) => (
                <ThreatRow key={result.id} result={result} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
