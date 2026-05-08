import { useState } from "react";
import "../features/security";
import { getSecurityApps } from "../features/security/registry";
import { useCurrentUser } from "../context/UserContext";
import { Shield, Search } from "lucide-react";

export default function SecurityTools() {
  const { isAdmin } = useCurrentUser();
  const apps = getSecurityApps(isAdmin);
  const [activeTab, setActiveTab] = useState(apps[0]?.id || "");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">安全工具</h1>
        <p className="text-sm text-muted-foreground mt-1">AI 安全分析工具集 — 选择工具开始扫描</p>
      </div>
      <div className="flex gap-2">
        {apps.map((app) => {
          const Icon = app.icon;
          const isActive = activeTab === app.id;
          return (
            <button
              key={app.id}
              onClick={() => setActiveTab(app.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              <Icon size={14} className={isActive ? "text-primary-foreground" : ""} />
              {app.name}
            </button>
          );
        })}
      </div>
      <div className="bg-card rounded-xl p-6 border border-border min-h-[400px]">
        {apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Shield className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
            <p className="text-muted-foreground text-sm">暂无可用安全工具</p>
          </div>
        ) : (
          apps.map((app) => (
            <div key={app.id} className={activeTab === app.id ? "" : "hidden"}>
              <app.component />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
