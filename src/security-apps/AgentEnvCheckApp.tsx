import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  Search,
  Brain,
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

interface AgentInfo {
  name: string;
  dir: string;
  detected: boolean;
  config_path?: string;
  skills_path?: string;
  has_skills?: boolean;
  session_count: number;
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
  system: "系统信息",
  network: "网络安全",
  files: "文件检查",
  security: "安全检测",
  services: "服务状态",
};

function CheckResultView({ result }: { result: EnvCheckResult }) {
  const score = result.score;
  const scoreColor = score >= 80 ? "text-green-500" : score >= 50 ? "text-orange-500" : "text-red-500";
  const scoreLabel = score >= 80 ? "安全" : score >= 50 ? "需注意" : "有风险";

  const grouped = result.checks.reduce(
    (acc, c) => {
      const cat = c.category || "other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(c);
      return acc;
    },
    {} as Record<string, CheckItem[]>,
  );

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-lg border border-border p-4 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">安全评分</h4>
          <p className="text-xs text-muted-foreground mt-1">
            扫描时间: {new Date(result.scan_time).toLocaleString("zh-CN")}
          </p>
        </div>
        <div className="text-center">
          <div className={`text-4xl font-bold ${scoreColor}`}>{score}</div>
          <div className={`text-xs font-medium ${scoreColor}`}>{scoreLabel}</div>
        </div>
      </div>

      {Object.entries(grouped).map(([category, items]) => {
        const catLabel = CATEGORY_LABEL[category] || category;
        return (
          <div key={category} className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <span className="text-sm font-medium">{catLabel}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {items.filter((i) => i.status === "pass").length}/{items.length} 通过
              </span>
            </div>
            <div className="divide-y divide-border">
              {items.map((item, i) => {
                const Icon = STATUS_ICON[item.status] || Monitor;
                const style = STATUS_STYLE[item.status] || STATUS_STYLE.info;
                return (
                  <div key={i} className="px-4 py-3 flex items-start gap-3">
                    <div className={`p-1 rounded ${style.bg} mt-0.5`}>
                      <Icon className={`w-4 h-4 ${style.text}`} />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{item.name}</div>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgentEnvCheckApp() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [deepCheckModel, setDeepCheckModel] = useState("");
  const [generalResult, setGeneralResult] = useState<EnvCheckResult | null>(null);
  const [deepResult, setDeepResult] = useState<EnvCheckResult | null>(null);

  const { data: agentsData } = useQuery({
    queryKey: ["discover-agents"],
    queryFn: async () => {
      const raw = await invoke<string>("discover_agents");
      const parsed = JSON.parse(raw);
      return (parsed.agents || []) as AgentInfo[];
    },
  });

  const { data: proxyModels } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => invoke<string[]>("get_proxy_models"),
  });

  const generalMutation = useMutation({
    mutationFn: async () => {
      const resp = await invoke<string>("check_agent_env", {});
      const parsed = JSON.parse(resp);
      return parsed as EnvCheckResult;
    },
    onSuccess: (data) => setGeneralResult(data),
  });

  const deepMutation = useMutation({
    mutationFn: async ({ agent, model }: { agent: string; model: string }) => {
      const resp = await invoke<string>("deep_check_agent", { agentName: agent, model });
      const parsed = JSON.parse(resp);
      return parsed as EnvCheckResult & { agent: string; dir: string };
    },
    onSuccess: (data) => setDeepResult(data),
  });

  const agents = agentsData || [];
  const models = proxyModels || [];
  const currentResult = selectedAgent ? deepResult : generalResult;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Shield className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">智能体环境安全检查</h2>
      </div>

      <div className="bg-muted/30 rounded-lg p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          检查智能体运行环境的安全状况，支持网关通用检查和指定智能体深度检查。
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSelectedAgent(null); generalMutation.mutate(); }}
            disabled={generalMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 text-sm"
          >
            {generalMutation.isPending && !selectedAgent ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Shield className="w-4 h-4" />
            )}
            网关通用检查
          </button>
          {generalResult && !selectedAgent && (
            <button
              onClick={() => generalMutation.mutate()}
              className="flex items-center gap-1 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              重新检查
            </button>
          )}
        </div>
      </div>

      {agents.length > 0 && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">已发现的智能体</span>
          </div>
          <div className="divide-y divide-border">
            {agents.map((agent) => (
              <div key={agent.name} className="px-4 py-3 flex items-center gap-3">
                <Brain className="w-5 h-5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{agent.name}</span>
                    {agent.has_skills && (
                      <span className="text-xs px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">有Skills</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{agent.dir}</p>
                  <p className="text-xs text-muted-foreground">
                    会话: {agent.session_count}个
                    {agent.config_path && " | 有配置文件"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedAgent === agent.name ? deepCheckModel : ""}
                    onChange={(e) => {
                      if (e.target.value) {
                        setSelectedAgent(agent.name);
                        setDeepCheckModel(e.target.value);
                      }
                    }}
                    className="px-2 py-1 bg-background border border-border rounded text-xs"
                  >
                    <option value="">选择AI模型</option>
                    {models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      setSelectedAgent(agent.name);
                      if (deepCheckModel) {
                        deepMutation.mutate({ agent: agent.name, model: deepCheckModel });
                      }
                    }}
                    disabled={deepMutation.isPending && selectedAgent === agent.name}
                    className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs hover:bg-primary/90 disabled:opacity-50"
                  >
                    {deepMutation.isPending && selectedAgent === agent.name ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Search className="w-3 h-3" />
                    )}
                    深度检查
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {currentResult && (
        <>
          {selectedAgent && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Brain className="w-4 h-4" />
              <span>
                {selectedAgent} 深度检查
                {(deepResult as any)?.dir ? ` (${(deepResult as any).dir})` : ""}
              </span>
              <button
                onClick={() => {
                  if (deepCheckModel) deepMutation.mutate({ agent: selectedAgent, model: deepCheckModel });
                }}
                className="ml-auto flex items-center gap-1 px-2 py-1 bg-secondary rounded text-xs"
              >
                <RefreshCw className="w-3 h-3" />
                重新检查
              </button>
            </div>
          )}
          <CheckResultView result={currentResult} />
        </>
      )}
    </div>
  );
}

registerSecurityApp({
  id: "agent-env-check",
  name: "智能体环境安全检查",
  description: "检查智能体运行环境的安全状况，支持深度检查",
  icon: Shield,
  component: AgentEnvCheckApp,
  order: 4,
});

export default AgentEnvCheckApp;
