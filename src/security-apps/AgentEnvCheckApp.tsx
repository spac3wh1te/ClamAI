import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Shield,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Monitor,
  Wifi,
  FileText,
  Lock,
  Server,
  RefreshCw,
} from "lucide-react";
import { registerSecurityApp } from "./registry";

interface CheckItem {
  category: string;
  name: string;
  status: "pass" | "warn" | "fail" | "info";
  detail: string;
}

interface EnvCheckResult {
  checks: CheckItem[];
  score: number;
  scan_time: string;
}

const STATUS_ICON: Record<string, typeof CheckCircle> = {
  pass: CheckCircle,
  warn: AlertTriangle,
  fail: XCircle,
  info: Monitor,
};

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  pass: { bg: "bg-green-500/10", text: "text-green-500" },
  warn: { bg: "bg-orange-500/10", text: "text-orange-500" },
  fail: { bg: "bg-red-500/10", text: "text-red-500" },
  info: { bg: "bg-blue-500/10", text: "text-blue-500" },
};

const CATEGORY_ICON: Record<string, typeof Monitor> = {
  system: Monitor,
  network: Wifi,
  files: FileText,
  security: Lock,
  services: Server,
};

const CATEGORY_LABEL: Record<string, string> = {
  system: "系统环境",
  network: "网络安全",
  files: "文件权限",
  security: "安全配置",
  services: "服务状态",
};

function AgentEnvCheckApp() {
  const [lastResult, setLastResult] = useState<EnvCheckResult | null>(null);

  const checkMutation = useMutation({
    mutationFn: async () => {
      const resp = await invoke<string>("check_agent_env", {});
      const parsed = JSON.parse(resp);
      return parsed as EnvCheckResult;
    },
    onSuccess: (data) => setLastResult(data),
  });

  const checks = lastResult?.checks || [];
  const score = lastResult?.score || 0;

  const scoreColor =
    score >= 80
      ? "text-green-500"
      : score >= 50
        ? "text-orange-500"
        : "text-red-500";
  const scoreLabel = score >= 80 ? "安全" : score >= 50 ? "需注意" : "有风险";

  const grouped = checks.reduce(
    (acc, c) => {
      const cat = c.category || "other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(c);
      return acc;
    },
    {} as Record<string, CheckItem[]>,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <Shield className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">智能体环境安全检查</h2>
        <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-500">
          PC模式
        </span>
      </div>

      <div className="bg-muted/30 rounded-lg p-4 space-y-4">
        <p className="text-xs text-muted-foreground">
          检查智能体运行环境的安全状况，包括系统配置、网络安全、文件权限、API密钥暴露风险等。
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {checkMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Shield className="w-4 h-4" />
            )}
            {checkMutation.isPending ? "检查中..." : "开始检查"}
          </button>
          {lastResult && (
            <button
              onClick={() => checkMutation.mutate()}
              className="flex items-center gap-1 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              重新检查
            </button>
          )}
        </div>
      </div>

      {lastResult && (
        <div className="space-y-4">
          <div className="bg-card rounded-lg border border-border p-4 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium">安全评分</h4>
              <p className="text-xs text-muted-foreground mt-1">
                扫描时间:{" "}
                {new Date(lastResult.scan_time).toLocaleString("zh-CN")}
              </p>
            </div>
            <div className="text-center">
              <div className={`text-4xl font-bold ${scoreColor}`}>{score}</div>
              <div className={`text-xs font-medium ${scoreColor}`}>
                {scoreLabel}
              </div>
            </div>
          </div>

          {Object.entries(grouped).map(([category, items]) => {
            const catIcon = CATEGORY_ICON[category] || Monitor;
            const catLabel = CATEGORY_LABEL[category] || category;
            return (
              <div
                key={category}
                className="bg-card rounded-lg border border-border overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  {(() => {
                    const I = catIcon;
                    return <I className="w-4 h-4 text-primary" />;
                  })()}
                  <span className="text-sm font-medium">{catLabel}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {items.filter((i) => i.status === "pass").length}/
                    {items.length} 通过
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {items.map((item, i) => {
                    const Icon = STATUS_ICON[item.status] || Monitor;
                    const style =
                      STATUS_STYLE[item.status] || STATUS_STYLE.info;
                    return (
                      <div key={i} className="px-4 py-3 flex items-start gap-3">
                        <div className={`p-1 rounded ${style.bg} mt-0.5`}>
                          <Icon className={`w-4 h-4 ${style.text}`} />
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium">{item.name}</div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {item.detail}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

registerSecurityApp({
  id: "agent-env-check",
  name: "智能体环境安全检查",
  description: "检查智能体运行环境的安全状况，发现潜在风险",
  icon: Shield,
  component: AgentEnvCheckApp,
  order: 4,
});

export default AgentEnvCheckApp;
