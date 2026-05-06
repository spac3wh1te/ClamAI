import { useState } from "react";
import { getSecurityApps } from "../features/security";

export default function SecuritySquare() {
  const apps = getSecurityApps();
  const [activeTab, setActiveTab] = useState(apps[0]?.id || "");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">安全广场</h1>
        <p className="text-muted-foreground mt-2">智能安全分析工具集</p>
      </div>

      <div className="flex gap-2 border-b border-border pb-2">
        {apps.map((app) => {
          const Icon = app.icon;
          return (
            <button
              key={app.id}
              onClick={() => setActiveTab(app.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm transition-colors ${
                activeTab === app.id
                  ? "bg-card border border-border border-b-transparent"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={app.description}
            >
              <Icon className="w-4 h-4" />
              {app.name}
            </button>
          );
        })}
      </div>

      <div className="bg-card rounded-lg p-6 border border-border">
        {apps.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            暂无可用安全应用
          </p>
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
