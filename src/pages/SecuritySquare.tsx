import { useState } from "react";
import { getSecurityApps } from "../features/security";
import { Shield } from "lucide-react";

export default function SecuritySquare() {
  const apps = getSecurityApps();
  const [activeTab, setActiveTab] = useState(apps[0]?.id || "");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
          <Shield size={20} className="text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">安全工具</h1>
          <p className="text-xs text-muted-foreground">AI 安全分析工具集 — 选择工具开始扫描</p>
        </div>
      </div>

      <div className="flex gap-2">
        {apps.map((app) => {
          const Icon = app.icon;
          const isActive = activeTab === app.id;
          return (
            <button
              key={app.id}
              onClick={() => setActiveTab(app.id)}
              className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-sm transition-all ${
                isActive
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "bg-secondary text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/80"
              }`}
              title={app.description}
            >
              <Icon className={`w-4 h-4 ${isActive ? "text-primary" : ""}`} />
              <span className={`font-medium ${isActive ? "text-[13px]" : "text-xs"}`}>{app.name}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-card rounded-xl p-6 border border-border min-h-[500px]">
        {apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
              <Shield className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">暂无可用安全工具</p>
          </div>
        ) : (
          apps.map((app) => {
            const Comp = app.component;
            return (
              <div key={app.id} className={activeTab === app.id ? "" : "hidden"}>
                <Comp />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
