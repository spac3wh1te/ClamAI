import { useState } from "react";
import Providers from "./Providers";
import Models from "./Models";
import ApiKeys from "./ApiKeys";
import { Server, Layers, Key } from "lucide-react";
import { useCurrentUser } from "../context/UserContext";

const TABS = [
  { id: "providers", label: "服务商管理", icon: Server },
  { id: "models", label: "模型管理", icon: Layers },
  { id: "keys", label: "授权密钥", icon: Key },
] as const;

export default function ModelManagement() {
  const [tab, setTab] = useState<string>("providers");
  const { isAdmin } = useCurrentUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">模型管理</h1>
        <p className="text-sm text-muted-foreground mt-1">
          管理服务商、模型配置与授权密钥
          {!isAdmin && " · 仅显示您创建的资源"}
        </p>
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
        {tab === "providers" && <Providers />}
        {tab === "models" && <Models />}
        {tab === "keys" && <ApiKeys />}
      </div>
    </div>
  );
}
