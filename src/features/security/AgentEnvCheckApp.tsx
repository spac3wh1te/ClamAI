import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentApi } from "../../api/analysis";
import { proxyApi } from "../../api/stats";
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
  Brain,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  HardDrive,
  Send,
  CheckCheck,
} from "lucide-react";
import { registerSecurityApp } from "./registry";

interface CheckItem {
  category: string;
  name: string;
  status: "pass" | "warn" | "fail" | "info";
  detail: string;
  items?: string[];
}

interface DeepCheckResult {
  checks: CheckItem[];
  score: number;
  scan_time: string;
  agent: string;
  dir: string;
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

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  pass: { bg: "bg-green-500/10", text: "text-green-500", label: "通过" },
  warn: { bg: "bg-orange-500/10", text: "text-orange-500", label: "警告" },
  fail: { bg: "bg-red-500/10", text: "text-red-500", label: "未通过" },
  info: { bg: "bg-muted", text: "text-muted-foreground", label: "信息" },
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

const TAG_STYLE = "text-xs px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 font-medium whitespace-nowrap";

interface TagDef {
  emoji: string;
  label: string;
  show: boolean;
}

function AgentTags({ agent, result }: { agent: AgentInfo; result?: DeepCheckResult }) {
  const tags: TagDef[] = [
    { emoji: "⚙️", label: "配置", show: !!agent.config_path },
    { emoji: "🧠", label: "Skills", show: !!agent.has_skills },
    { emoji: "📄", label: "日志", show: agent.session_count > 0 },
  ];

  if (result) {
    const hasCreds = result.checks.some(
      (c) => c.name === "凭据泄露风险" && c.status === "fail",
    );
    const hasSensitive = result.checks.some(
      (c) => c.name === "敏感命名文件" && c.status === "fail",
    );
    if (hasCreds) tags.push({ emoji: "🔑", label: "凭据泄露", show: true });
    if (hasSensitive) tags.push({ emoji: "⚠️", label: "敏感文件", show: true });
  }

  return (
    <>
      {tags.filter((t) => t.show).map((t) => (
        <span key={t.label} className={TAG_STYLE}>
          {t.emoji} {t.label}
        </span>
      ))}
    </>
  );
}

function scoreColor(score: number) {
  if (score >= 80) return "text-green-500";
  if (score >= 50) return "text-orange-500";
  return "text-red-500";
}

function scoreBg(score: number) {
  if (score >= 80) return "bg-green-500/10 border-green-500/20";
  if (score >= 50) return "bg-orange-500/10 border-orange-500/20";
  return "bg-red-500/10 border-red-500/20";
}

function scoreLabel(score: number) {
  if (score >= 80) return "安全";
  if (score >= 50) return "需注意";
  return "有风险";
}

function CheckItemRow({ item }: { item: CheckItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasItems = item.items && item.items.length > 0;
  const Icon = STATUS_ICON[item.status] || Monitor;
  const style = STATUS_STYLE[item.status] || STATUS_STYLE.info;

  return (
    <div>
      <div className="px-4 py-3 flex items-start gap-3">
        <div className={`p-1 rounded ${style.bg} mt-0.5`}>
          <Icon className={`w-4 h-4 ${style.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{item.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
              {style.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
        </div>
        {hasItems && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-primary hover:underline shrink-0"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {expanded ? "收起" : `${item.items!.length} 项`}
          </button>
        )}
      </div>
      {hasItems && expanded && (
        <div className="pl-14 pr-4 pb-3">
          <div className="bg-muted/40 rounded-md border border-border divide-y divide-border">
            {item.items!.map((it, idx) => (
              <div key={idx} className="px-3 py-1.5 text-xs text-muted-foreground font-mono break-all">
                {it}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CheckResultView({
  result,
  models,
  onPushSkills,
  pushSkillsPending,
  pushedAgent,
  pushedFiles,
}: {
  result: DeepCheckResult;
  models: string[];
  onPushSkills: (model: string) => void;
  pushSkillsPending: boolean;
  pushedAgent: boolean;
  pushedFiles?: { file_name: string; task_no: string }[];
}) {
  const [pushModel, setPushModel] = useState("");
  const hasSkillsFiles = result.checks.some(
    (c) => c.name === "Skills/规则文件" && c.status === "info" && (c.items?.length ?? 0) > 0,
  );

  const grouped = result.checks.reduce(
    (acc, c) => {
      const cat = c.category || "other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(c);
      return acc;
    },
    {} as Record<string, CheckItem[]>,
  );

  const scoringItems = result.checks.filter((c) => c.status !== "info");
  const passCount = scoringItems.filter((c) => c.status === "pass").length;
  const warnCount = scoringItems.filter((c) => c.status === "warn").length;
  const failCount = scoringItems.filter((c) => c.status === "fail").length;

  return (
    <div className="space-y-3">
      <div className={`rounded-lg border p-4 ${scoreBg(result.score)}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{result.agent}</span>
              <span className="text-xs text-muted-foreground">{result.dir}</span>
            </div>
            <div className="flex items-center gap-3 mt-2 text-xs">
              {passCount > 0 && <span className="text-green-500">{passCount} 通过</span>}
              {warnCount > 0 && <span className="text-orange-500">{warnCount} 警告</span>}
              {failCount > 0 && <span className="text-red-500">{failCount} 未通过</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {new Date(result.scan_time).toLocaleString("zh-CN")}
            </p>
          </div>
          <div className="text-center">
            <div className={`text-4xl font-bold ${scoreColor(result.score)}`}>{result.score}</div>
            <div className={`text-xs font-medium ${scoreColor(result.score)}`}>{scoreLabel(result.score)}</div>
          </div>
        </div>
      </div>

      {hasSkillsFiles && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm">🧠</span>
            <span className="text-xs text-muted-foreground">
              检测到 Skills/规则文件，可推送至 Skills 文档检测进行深度安全分析
            </span>
          </div>
          <div className="flex items-center gap-2 pl-6">
            {pushedAgent ? (
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs text-green-500">
                  <CheckCheck className="w-3.5 h-3.5" />
                  已创建 {pushedFiles?.length || 0} 个 Skills 检测任务（待执行），切换至 Skills 检测手动启动
                </span>
                {pushedFiles && pushedFiles.length > 0 && (
                  <div className="space-y-0.5 pl-5">
                    {pushedFiles.map((f, i) => (
                      <div key={i} className="text-xs text-muted-foreground font-mono">
                        #{f.task_no} {f.file_name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <select
                  value={pushModel}
                  onChange={(e) => setPushModel(e.target.value)}
                  className="px-2 py-1.5 bg-background border border-border rounded-lg text-xs flex-1 max-w-[280px]"
                >
                  <option value="">选择分析模型...</option>
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <button
                  onClick={() => onPushSkills(pushModel)}
                  disabled={pushSkillsPending || !pushModel}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {pushSkillsPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  {pushSkillsPending ? "创建中..." : "推送至 Skills 检测"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {Object.entries(grouped).map(([category, items]) => {
        const catLabel = CATEGORY_LABEL[category] || category;
        const CatIcon = CATEGORY_ICON[category] || Monitor;
        const catScoring = items.filter((i) => i.status !== "info");
        const catPass = catScoring.filter((i) => i.status === "pass").length;
        return (
          <div key={category} className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-muted/20">
              <CatIcon className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">{catLabel}</span>
              {catScoring.length > 0 ? (
                <span className="text-xs text-muted-foreground ml-auto">
                  {catPass}/{catScoring.length} 通过
                </span>
              ) : (
                <span className="text-xs text-muted-foreground ml-auto">仅信息</span>
              )}
            </div>
            <div className="divide-y divide-border">
              {items.map((item, i) => (
                <CheckItemRow key={i} item={item} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgentEnvCheckApp() {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [globalModel, setGlobalModel] = useState("");
  const [results, setResults] = useState<Record<string, DeepCheckResult>>({});
  const [pushedAgents, setPushedAgents] = useState<Set<string>>(new Set());
  const [pushedTasks, setPushedTasks] = useState<Record<string, { file_name: string; task_no: string }[]>>({});
  const queryClient = useQueryClient();

  const { data: agentsData } = useQuery({
    queryKey: ["discover-agents"],
    queryFn: async () => {
      const result = await agentApi.discover();
      return (result.agents || []) as AgentInfo[];
    },
  });

  const { data: proxyModels } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => proxyApi.getModels(),
  });

  const deepMutation = useMutation({
    mutationFn: async ({ agent, model }: { agent: string; model: string }) => {
      return (await agentApi.deepCheck(agent, model)) as unknown as DeepCheckResult;
    },
    onSuccess: (data) => {
      setResults((prev) => ({ ...prev, [data.agent]: data }));
    },
  });

  const pushSkillsMutation = useMutation({
    mutationFn: async ({ agentName, model }: { agentName: string; model: string }) => {
      return agentApi.pushSkills(agentName, model);
    },
    onSuccess: (data, variables) => {
      setPushedAgents((prev) => new Set(prev).add(variables.agentName));
      setPushedTasks((prev) => ({ ...prev, [variables.agentName]: data.tasks }));
      queryClient.invalidateQueries({ queryKey: ["skills-tasks"] });
    },
  });

  const agents = agentsData || [];
  const models = proxyModels || [];

  const runCheck = (agentName: string) => {
    setExpandedAgent(agentName);
    deepMutation.mutate({ agent: agentName, model: globalModel });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Shield className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">智能体环境安全检查</h2>
      </div>

      <div className="bg-muted/30 rounded-lg p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">
            对本机已安装的 AI 智能体进行安全配置检查，包括凭据泄露、目录权限、Skills 文件风险等。
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">AI 分析模型:</span>
            <select
              value={globalModel}
              onChange={(e) => setGlobalModel(e.target.value)}
              className="px-2 py-1.5 bg-background border border-border rounded-lg text-xs"
            >
              <option value="">不使用 AI 分析</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {agents.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          未发现本机安装的 AI 智能体
        </div>
      )}

      <div className="space-y-3">
        {agents.map((agent) => {
          const isOpen = expandedAgent === agent.name;
          const result = results[agent.name];
          const isChecking = deepMutation.isPending && deepMutation.variables?.agent === agent.name;
          const score = result?.score;

          return (
            <div key={agent.name} className="bg-card rounded-lg border border-border overflow-hidden">
              <div
                className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-muted/20"
                onClick={() => setExpandedAgent(isOpen ? null : agent.name)}
              >
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
                <Brain className="w-5 h-5 text-primary" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{agent.name}</span>
                    <AgentTags agent={agent} result={result} />
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <FolderOpen className="w-3 h-3" />
                      <span className="truncate max-w-[300px]" title={agent.dir}>{agent.dir}</span>
                    </span>
                    {agent.session_count > 0 && (
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-3 h-3" />
                        {agent.session_count} 文件
                      </span>
                    )}
                  </div>
                </div>

                {score !== undefined && (
                  <div className={`text-lg font-bold ${scoreColor(score)}`}>{score}</div>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    runCheck(agent.name);
                  }}
                  disabled={isChecking}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs hover:bg-primary/90 disabled:opacity-50"
                >
                  {isChecking ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Shield className="w-3.5 h-3.5" />
                  )}
                  {isChecking ? "检查中..." : result ? "重新检查" : "安全检查"}
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-border">
                  {isChecking && !result && (
                    <div className="py-8 flex flex-col items-center gap-2">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      <span className="text-xs text-muted-foreground">正在扫描安全配置...</span>
                    </div>
                  )}
                  {result && (
                    <div className="p-4">
                      <CheckResultView
                        result={result}
                        models={models}
                        onPushSkills={(model) => pushSkillsMutation.mutate({ agentName: agent.name, model })}
                        pushSkillsPending={pushSkillsMutation.isPending && pushSkillsMutation.variables?.agentName === agent.name}
                        pushedAgent={pushedAgents.has(agent.name)}
                        pushedFiles={pushedTasks[agent.name]}
                      />
                    </div>
                  )}
                  {!isChecking && !result && (
                    <div className="py-6 text-center text-xs text-muted-foreground">
                      点击右侧"安全检查"按钮开始扫描
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

registerSecurityApp({
  id: "agent-env-check",
  name: "智能体环境安全检查",
  description: "检查智能体运行环境的安全状况，包括配置缺陷、凭据泄露、权限问题等",
  icon: Shield,
  component: AgentEnvCheckApp,
  order: 4,
  adminOnly: true,
});

export default AgentEnvCheckApp;
