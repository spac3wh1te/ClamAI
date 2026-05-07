import { useState } from "react";
import { Users, Globe, Fingerprint, Gauge } from "lucide-react";
import UserManagement from "./UserManagement";
import RateLimit from "./RateLimit";

const TABS = [
  { id: "users", label: "用户管理", icon: Users },
  { id: "ip", label: "IP 访问控制", icon: Globe },
  { id: "keys", label: "密钥管控", icon: Fingerprint },
  { id: "rate", label: "流量控制", icon: Gauge },
] as const;

function IPControlPanel() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card rounded-xl p-5 border border-border">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><Globe size={16} className="text-red-400" /> 黑名单模式</h3>
          <p className="text-xs text-muted-foreground">阻止指定 IP 或网段的访问请求。命中黑名单的请求将直接返回 403。</p>
        </div>
        <div className="bg-card rounded-xl p-5 border border-border">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><Globe size={16} className="text-emerald-400" /> 白名单模式</h3>
          <p className="text-xs text-muted-foreground">仅允许白名单内的 IP 访问。适用于内网部署或限定合作伙伴场景。</p>
        </div>
      </div>
      <div className="bg-card rounded-xl p-8 border border-border text-center">
        <Globe className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
        <p className="text-sm text-muted-foreground">IP 访问控制功能开发中，敬请期待</p>
      </div>
    </div>
  );
}

function KeyControlPanel() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-xl p-5 border border-border">
          <h3 className="text-sm font-semibold mb-1">动态黑名单</h3>
          <p className="text-xs text-muted-foreground">基于安全事件自动封禁 API 密钥</p>
        </div>
        <div className="bg-card rounded-xl p-5 border border-border">
          <h3 className="text-sm font-semibold mb-1">熔断策略</h3>
          <p className="text-xs text-muted-foreground">异常调用频率自动触发临时封禁</p>
        </div>
        <div className="bg-card rounded-xl p-5 border border-border">
          <h3 className="text-sm font-semibold mb-1">手动管控</h3>
          <p className="text-xs text-muted-foreground">手动拉黑 / 解封密钥</p>
        </div>
      </div>
      <div className="bg-card rounded-xl p-8 border border-border text-center">
        <Fingerprint className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
        <p className="text-sm text-muted-foreground">密钥管控功能开发中，可在「防护策略 → 安全配置」中开启自动封禁</p>
      </div>
    </div>
  );
}

export default function AccessControl() {
  const [tab, setTab] = useState<string>("users");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">管控中心</h1>
        <p className="text-sm text-muted-foreground mt-1">用户管理、访问控制、密钥管控与流量控制</p>
      </div>
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>
      <div>
        {tab === "users" && <UserManagement />}
        {tab === "ip" && <IPControlPanel />}
        {tab === "keys" && <KeyControlPanel />}
        {tab === "rate" && <RateLimit />}
      </div>
    </div>
  );
}
