import React, { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  Layers,
  Key,
  Settings,
  FileText,
  Menu,
  X,
  Activity,
  Shield,
  Gauge,
  LogOut,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useSetup } from "../context/SetupContext";

interface LayoutProps {
  children: React.ReactNode;
}

function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const { logout } = useAuth();
  const { connected, deployMode } = useSetup();

  const navigation = [
    { name: "仪表盘", href: "/", icon: LayoutDashboard },
    { name: "模型提供商", href: "/providers", icon: Server },
    { name: "模型服务", href: "/models", icon: Layers },
    { name: "调用密钥", href: "/api-keys", icon: Key },
    { name: "调用记录", href: "/logs", icon: FileText },
    { name: "安全广场", href: "/security-square", icon: Shield },
    { name: "安全防护", href: "/security", icon: Shield },
    { name: "模型限流", href: "/rate-limit", icon: Gauge },
    { name: "基本设置", href: "/settings", icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-background">
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-16"
        } bg-card border-r border-border transition-all duration-300 flex flex-col`}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-border">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary" />
              <span className="text-lg font-bold">ClamAI</span>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 rounded hover:bg-secondary transition-colors"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <NavLink
                key={item.name}
                to={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <item.icon size={20} />
                {sidebarOpen && (
                  <span className="font-medium">{item.name}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {sidebarOpen && (
          <div className="p-4 border-t border-border space-y-2">
            <div className="text-sm text-muted-foreground">
              <p>ClamAI v1.0.0</p>
              <p className="text-xs mt-1">智能大模型网关</p>
            </div>
            <button
              onClick={logout}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              退出登录
            </button>
          </div>
        )}
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6">
          <h1 className="text-xl font-semibold">
            {navigation.find((item) => item.href === location.pathname)?.name ||
              "ClamAI"}
          </h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              {connected ? (
                <>
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  <span className="text-green-500">
                    {deployMode === "pc" ? "本地服务正常" : "远程服务正常"}
                  </span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                  <span className="text-red-500">服务未连接</span>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

export default Layout;
