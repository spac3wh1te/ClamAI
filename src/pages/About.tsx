import { useQuery } from "@tanstack/react-query";
import { configApi } from "../api/config";
import { Shield, ExternalLink, RefreshCw, Github } from "lucide-react";
import { useSetup } from "../context/SetupContext";

export default function About() {
  const { connected } = useSetup();

  const { data: appInfo } = useQuery({
    queryKey: ["app-info"],
    queryFn: () => configApi.appInfo(),
    enabled: connected,
    staleTime: 60000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">关于</h1>
        <p className="text-sm text-muted-foreground mt-1">ClamAI 网关程序信息</p>
      </div>

      <div className="bg-card rounded-lg border border-border p-8">
        <div className="flex flex-col items-center text-center max-w-md mx-auto space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center">
            <Shield size={32} className="text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">ClamAI</h2>
            <p className="text-sm text-muted-foreground mt-1">AI 模型安全网关</p>
          </div>
          {appInfo && (
            <div className="bg-secondary rounded-lg px-4 py-2">
              <span className="text-sm font-mono">v{appInfo.version}</span>
              <span className="text-xs text-muted-foreground ml-2">({appInfo.deploy_mode === "server" ? "服务器模式" : "PC 本地模式"})</span>
            </div>
          )}
          <div className="w-full border-t border-border pt-4 space-y-2 text-left">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">版本</span>
              <span className="font-mono">{appInfo?.version || "-"}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">部署模式</span>
              <span>{appInfo?.deploy_mode === "server" ? "服务器模式" : "PC 本地模式"}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">作者</span>
              <span>chenflux</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">项目地址</span>
              <a href="https://github.com/chenflux/ClamAI" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline">
                <Github size={12} />
                <span>chenflux/ClamAI</span>
                <ExternalLink size={10} />
              </a>
            </div>
          </div>
          <div className="w-full border-t border-border pt-4 flex justify-center gap-3">
            <button onClick={() => window.open("https://github.com/chenflux/ClamAI/releases", "_blank")}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm">
              <RefreshCw size={16} />
              获取更新
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
