import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Save,
  RotateCcw,
  Wifi,
  WifiOff,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApp } from "../context/AppContext";

interface AppConfig {
  gateway: {
    port: number;
    host: string;
    api_key: string;
    default_format: string;
    log_level: string;
    enable_metrics: boolean;
  };
  ui: {
    theme: string;
    language: string;
    timezone: string;
    auto_start: boolean;
    minimize_to_tray: boolean;
    show_notifications: boolean;
  };
  advanced: {
    proxy_url: string | null;
    timeout_seconds: number;
  };
}

interface ProxyTestResult {
  success: boolean;
  message: string;
}

function detectProxyType(url: string): string {
  if (!url) return "";
  const lower = url.toLowerCase();
  if (lower.startsWith("socks5://")) return "SOCKS5";
  if (lower.startsWith("socks4://")) return "SOCKS4";
  if (lower.startsWith("https://")) return "HTTPS";
  if (lower.startsWith("http://")) return "HTTP";
  return "未知";
}

export default function Settings() {
  const queryClient = useQueryClient();
  const [hasChanges, setHasChanges] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const { changePassword } = useAuth();
  const { setTheme, setLocale, setTimezone } = useApp();
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const [proxyTestResult, setProxyTestResult] =
    useState<ProxyTestResult | null>(null);
  const [proxyTesting, setProxyTesting] = useState(false);

  const { data: currentConfig, isLoading } = useQuery<AppConfig>({
    queryKey: ["config"],
    queryFn: () => invoke<AppConfig>("get_config"),
  });

  useEffect(() => {
    if (currentConfig && !config) {
      setConfig(currentConfig);
    }
  }, [currentConfig]);

  const saveMutation = useMutation({
    mutationFn: (newConfig: AppConfig) =>
      invoke("save_config", { config: newConfig }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
      setHasChanges(false);
      if (config?.ui.theme) setTheme(config.ui.theme);
      if (config?.ui.language) setLocale(config.ui.language as any);
      if (config?.ui.timezone) setTimezone(config.ui.timezone);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => invoke("reset_config"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
      setHasChanges(false);
      setTheme("dark");
      setLocale("zh-CN");
      setTimezone("Asia/Shanghai");
    },
  });

  const updateConfig = (section: keyof AppConfig, key: string, value: any) => {
    setConfig((prev) => {
      if (!prev) return null;
      const newConfig = { ...prev };
      // @ts-ignore
      newConfig[section] = { ...prev[section], [key]: value };
      setHasChanges(true);
      return newConfig;
    });
  };

  const handleTestProxy = async () => {
    setProxyTesting(true);
    setProxyTestResult(null);
    try {
      const result = await invoke<ProxyTestResult>("test_proxy_connectivity", {
        proxyUrl: config?.advanced.proxy_url || null,
      });
      setProxyTestResult(result);
    } catch (e: any) {
      setProxyTestResult({
        success: false,
        message: e?.toString() || "测试失败",
      });
    } finally {
      setProxyTesting(false);
    }
  };

  const handleChangePassword = async () => {
    setPwdMsg("");
    if (newPwd.length < 6) {
      setPwdMsg("新密码至少6个字符");
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdMsg("两次输入不一致");
      return;
    }
    try {
      await changePassword(oldPwd, newPwd);
      setPwdMsg("密码修改成功");
      setOldPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (e: any) {
      setPwdMsg(e?.toString?.() || "修改失败");
    }
  };

  if (isLoading || !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const proxyType = detectProxyType(config.advanced.proxy_url || "");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => {
            if (confirm("确定要重置为默认配置吗？")) resetMutation.mutate();
          }}
          disabled={resetMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors disabled:opacity-50"
        >
          <RotateCcw size={20} />
          <span>重置</span>
        </button>
        <button
          onClick={() => config && saveMutation.mutate(config)}
          disabled={!hasChanges || saveMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Save size={20} />
          <span>{saveMutation.isPending ? "保存中..." : "保存"}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-lg p-6 border border-border">
          <h2 className="text-xl font-semibold mb-4">网关配置</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">监听端口</label>
              <p className="text-xs text-muted-foreground mb-1">
                代理服务监听的本地端口，外部程序通过此端口调用 API
              </p>
              <input
                type="number"
                value={config.gateway.port}
                onChange={(e) =>
                  updateConfig("gateway", "port", parseInt(e.target.value))
                }
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                min="1"
                max="65535"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                请求超时 (秒)
              </label>
              <p className="text-xs text-muted-foreground mb-1">
                等待上游 API 响应的最长时间，超时后返回错误
              </p>
              <input
                type="number"
                value={config.advanced.timeout_seconds}
                onChange={(e) =>
                  updateConfig(
                    "advanced",
                    "timeout_seconds",
                    parseInt(e.target.value),
                  )
                }
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                min="10"
                max="300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">日志级别</label>
              <select
                value={config.gateway.log_level}
                onChange={(e) =>
                  updateConfig("gateway", "log_level", e.target.value)
                }
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="debug">Debug（开发调试）</option>
                <option value="info">Info（正常运行）</option>
                <option value="warn">Warning（仅警告）</option>
                <option value="error">Error（仅错误）</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg p-6 border border-border">
          <h2 className="text-xl font-semibold mb-4">界面配置</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">主题</label>
              <select
                value={config.ui.theme}
                onChange={(e) => updateConfig("ui", "theme", e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="dark">深色</option>
                <option value="light">浅色</option>
                <option value="system">跟随系统</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">语言</label>
              <select
                value={config.ui.language}
                onChange={(e) => updateConfig("ui", "language", e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">时区</label>
              <select
                value={config.ui.timezone}
                onChange={(e) => updateConfig("ui", "timezone", e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
                <option value="America/New_York">
                  America/New_York (UTC-5)
                </option>
                <option value="Europe/London">Europe/London (UTC+0)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg p-6 border border-border lg:col-span-2">
          <h2 className="text-xl font-semibold mb-4">网络代理</h2>
          <p className="text-xs text-muted-foreground mb-4">
            如果网络环境需要通过代理访问外网，在此填写代理地址。支持 HTTP /
            HTTPS / SOCKS4 / SOCKS5 协议。留空则直连
          </p>
          <div className="flex gap-4 items-start">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <input
                  type="text"
                  value={config.advanced.proxy_url || ""}
                  onChange={(e) => {
                    updateConfig(
                      "advanced",
                      "proxy_url",
                      e.target.value || null,
                    );
                    setProxyTestResult(null);
                  }}
                  className="flex-1 px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                />
                {proxyType && (
                  <span className="shrink-0 px-2 py-1 text-xs font-mono bg-secondary rounded-md">
                    {proxyType}
                  </span>
                )}
              </div>
              {proxyTestResult && (
                <div
                  className={`flex items-center gap-2 text-sm ${proxyTestResult.success ? "text-green-500" : "text-red-500"}`}
                >
                  {proxyTestResult.success ? (
                    <CheckCircle size={16} />
                  ) : (
                    <XCircle size={16} />
                  )}
                  <span>{proxyTestResult.message}</span>
                </div>
              )}
            </div>
            <button
              onClick={handleTestProxy}
              disabled={!config.advanced.proxy_url || proxyTesting}
              className="shrink-0 flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors disabled:opacity-50"
            >
              {proxyTesting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : config.advanced.proxy_url ? (
                <Wifi size={16} />
              ) : (
                <WifiOff size={16} />
              )}
              <span>{proxyTesting ? "测试中..." : "测试连接"}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg p-6 border border-border">
        <h2 className="text-xl font-semibold mb-4">修改密码</h2>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium mb-1">当前密码</label>
            <input
              type="password"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">新密码</label>
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">确认新密码</label>
            <input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
            />
          </div>
          <div className="flex items-center gap-4 pt-2">
            <button
              onClick={handleChangePassword}
              disabled={!oldPwd || !newPwd || !confirmPwd}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              修改密码
            </button>
            {pwdMsg && (
              <span
                className={`text-sm ${pwdMsg.includes("成功") ? "text-green-500" : "text-destructive"}`}
              >
                {pwdMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      {saveMutation.isSuccess && (
        <div className="fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg">
          配置保存成功
        </div>
      )}
    </div>
  );
}
