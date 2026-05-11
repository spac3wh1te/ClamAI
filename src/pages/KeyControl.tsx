import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { keysApi } from "../api/keys";
import { securityApi } from "../api/security";
import {
  Key,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  Shield,
  ShieldOff,
  Lock,
  Unlock,
  AlertTriangle,
  Ban,
} from "lucide-react";

function KeyControl() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyModels, setNewKeyModels] = useState("");
  const [revealedKeyId, setRevealedKeyId] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createdKeyId, setCreatedKeyId] = useState<string | null>(null);
  const [copiedCreated, setCopiedCreated] = useState(false);

  const { data: keysData, isLoading, refetch } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => keysApi.list(),
  });
  const keys = keysData?.keys || [];

  const { data: alertsData } = useQuery({
    queryKey: ["ban-alerts"],
    queryFn: () => securityApi.getLogs({ limit: 50, trigger_type: "semantic_output" }),
  });
  const banAlerts = (alertsData?.alerts || []).filter((a) => a.api_key_used);

  const createMutation = useMutation({
    mutationFn: () => {
      const models = newKeyModels
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      return keysApi.create(newKeyName, models) as Promise<{ id: string; key: string }>;
    },
    onSuccess: (data) => {
      setShowCreate(false);
      setNewKeyName("");
      setNewKeyModels("");
      setCreatedKey(data.key);
      setCreatedKeyId(data.id);
      refetch();
    },
    onError: (e: any) => alert("创建失败: " + (e?.message || e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => keysApi.delete(id),
    onSuccess: () => refetch(),
    onError: (e: any) => alert("删除失败: " + (e?.message || e)),
  });

  const revealMutation = useMutation({
    mutationFn: (id: string) => keysApi.reveal(id) as Promise<{ id: string; key: string; name: string }>,
    onSuccess: (data) => {
      setRevealedKey(data.key);
      setRevealedKeyId(data.id);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => keysApi.toggle(id, active),
    onSuccess: () => refetch(),
    onError: (e: any) => alert("操作失败: " + (e?.message || e)),
  });

  const handleToggleReveal = (k: { id: string }) => {
    if (revealedKeyId === k.id) {
      setRevealedKeyId(null);
      setRevealedKey(null);
    } else {
      revealMutation.mutate(k.id);
    }
  };

  const copyToClipboard = (text: string, id?: string) => {
    navigator.clipboard.writeText(text);
    if (id) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      setCopiedCreated(true);
      setTimeout(() => setCopiedCreated(false), 2000);
    }
  };

  const formatDate = (d: string) => {
    if (!d) return "-";
    try {
      return new Date(d).toLocaleString("zh-CN");
    } catch {
      return d;
    }
  };

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  };

  const disabledKeys = keys.filter((k) => !k.active);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">密钥管控</h1>
          <p className="text-sm text-muted-foreground mt-1">管理 API 密钥的创建、启用、禁用和撤销</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent"
          >
            <RefreshCw className="w-4 h-4" /> 刷新
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" /> 创建密钥
          </button>
        </div>
      </div>

      {createdKey && (
        <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-400">密钥创建成功</p>
              <p className="text-xs text-emerald-400/70 mt-1">请立即复制，此密钥仅显示一次</p>
            </div>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-emerald-900/50 px-3 py-1.5 rounded font-mono break-all max-w-md">{createdKey}</code>
              <button onClick={() => copyToClipboard(createdKey)} className="p-1.5 hover:bg-emerald-900/50 rounded">
                {copiedCreated ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-emerald-400" />}
              </button>
              <button onClick={() => { setCreatedKey(null); setCreatedKeyId(null); }} className="p-1.5 hover:bg-emerald-900/50 rounded">
                <EyeOff className="w-4 h-4 text-emerald-400/50" />
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="bg-card rounded-xl p-5 border border-border">
          <h3 className="text-sm font-semibold mb-3">创建新密钥</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">名称</label>
              <input
                className="w-full mt-1 px-3 py-2 text-sm bg-background border border-border rounded-lg"
                placeholder="例如：生产环境密钥"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">允许的模型（留空=全部，逗号分隔）</label>
              <input
                className="w-full mt-1 px-3 py-2 text-sm bg-background border border-border rounded-lg"
                placeholder="例如：gpt-4, claude-3-opus"
                value={newKeyModels}
                onChange={(e) => setNewKeyModels(e.target.value)}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => createMutation.mutate()}
                disabled={!newKeyName || createMutation.isPending}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "创建"}
              </button>
              <button onClick={() => { setShowCreate(false); setNewKeyName(""); setNewKeyModels(""); }} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Key className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">API 密钥列表</span>
          <span className="text-xs text-muted-foreground ml-auto">{keys.length} 个密钥</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : keys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Key className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">暂无 API 密钥</p>
            <p className="text-xs mt-1">点击「创建密钥」生成第一个 API Key</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {keys.map((k) => (
              <div key={k.id} className={`px-5 py-3.5 hover:bg-accent/30 transition-colors ${!k.active ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${k.active ? "bg-emerald-500" : "bg-zinc-500"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{k.name || "未命名"}</span>
                        {!k.active && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">已禁用</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <code className="text-xs text-muted-foreground font-mono">
                          {revealedKeyId === k.id && revealedKey ? revealedKey : k.key_preview}
                        </code>
                        <span className="text-xs text-muted-foreground">
                          {formatCount(k.request_count)} 次调用
                        </span>
                        {k.created_by_name && (
                          <span className="text-xs text-muted-foreground">by {k.created_by_name}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    <button
                      onClick={() => handleToggleReveal(k)}
                      className="p-1.5 hover:bg-accent rounded"
                      title={revealedKeyId === k.id ? "隐藏密钥" : "显示密钥"}
                    >
                      {revealedKeyId === k.id ? (
                        copiedId === k.id ? <Check className="w-4 h-4 text-emerald-500" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <Eye className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                    {revealedKeyId === k.id && revealedKey && (
                      <button onClick={() => copyToClipboard(revealedKey, k.id)} className="p-1.5 hover:bg-accent rounded" title="复制">
                        <Copy className="w-4 h-4 text-muted-foreground" />
                      </button>
                    )}
                    <button
                      onClick={() => toggleMutation.mutate({ id: k.id, active: !k.active })}
                      className={`p-1.5 rounded ${k.active ? "hover:bg-amber-500/10" : "hover:bg-emerald-500/10"}`}
                      title={k.active ? "禁用密钥" : "启用密钥"}
                    >
                      {k.active
                        ? <Lock className="w-4 h-4 text-amber-500/70" />
                        : <Unlock className="w-4 h-4 text-emerald-500/70" />
                      }
                    </button>
                    <button onClick={() => { if (confirm("确认删除此密钥？")) deleteMutation.mutate(k.id); }} className="p-1.5 hover:bg-destructive/10 rounded" title="删除">
                      <Trash2 className="w-4 h-4 text-destructive/70" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                  <span>创建: {formatDate(k.created_at)}</span>
                  {k.last_used && <span>最后使用: {formatDate(k.last_used)}</span>}
                  {k.allowed_models && k.allowed_models.length > 0 && (
                    <span>模型: {k.allowed_models.join(", ")}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {disabledKeys.length > 0 && (
        <div className="bg-card rounded-xl border border-red-500/20 overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2 bg-red-500/5">
            <Ban className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold text-red-400">小黑屋</span>
            <span className="text-xs text-muted-foreground ml-auto">{disabledKeys.length} 个密钥已禁用</span>
          </div>
          <div className="divide-y divide-border">
            {disabledKeys.map((k) => {
              const relatedAlerts = banAlerts.filter((a) => {
                if (a.api_key_used === k.key_preview) return true;
                if (a.api_key_used && k.key_preview && a.api_key_used.includes(k.key_preview.replace(/\*/g, ""))) return true;
                return false;
              });
              const latestAlert = relatedAlerts[0];
              return (
                <div key={k.id} className="px-5 py-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <Ban className="w-4 h-4 text-red-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{k.name || "未命名"}</span>
                          <code className="text-[10px] text-muted-foreground font-mono bg-secondary px-1.5 py-0.5 rounded">{k.key_preview}</code>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                          <span>创建: {formatDate(k.created_at)}</span>
                          {k.last_used && <span>最后使用: {formatDate(k.last_used)}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-3">
                      <button
                        onClick={() => toggleMutation.mutate({ id: k.id, active: true })}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-500/10 text-emerald-500 rounded-lg hover:bg-emerald-500/20"
                      >
                        <Unlock className="w-3 h-3" /> 解禁
                      </button>
                      <button onClick={() => { if (confirm("确认删除此密钥？")) deleteMutation.mutate(k.id); }} className="p-1.5 hover:bg-destructive/10 rounded" title="删除">
                        <Trash2 className="w-4 h-4 text-destructive/70" />
                      </button>
                    </div>
                  </div>
                  {latestAlert && (
                    <div className="mt-2 ml-7 p-2.5 bg-red-500/5 border border-red-500/10 rounded-lg">
                      <div className="flex items-center gap-2 text-xs">
                        <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                        <span className="text-red-400 font-medium">
                          {latestAlert.trigger_type === "semantic_output" ? "语义检测触发自动封禁" : `安全事件: ${latestAlert.trigger_type}`}
                        </span>
                        <span className="text-muted-foreground">{formatDate(latestAlert.timestamp)}</span>
                      </div>
                      {latestAlert.trigger_detail && (
                        <p className="text-xs text-muted-foreground mt-1 ml-5 truncate">{latestAlert.trigger_detail}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1 ml-5 text-[10px] text-muted-foreground">
                        <span>来源IP: {latestAlert.client_ip || "-"}</span>
                        <span>模型: {latestAlert.model || "-"}</span>
                        <span>封禁类型: 永久</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default KeyControl;
