import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import { configApi } from "../api/config";
import { proxyApi } from "../api/stats";
import {
  Save,
  RotateCcw,
  Wifi,
  WifiOff,
  CheckCircle,
  XCircle,
  Loader2,
  Monitor,
  Globe,
  RefreshCw,
  FolderOpen,
  Plus,
  Trash2,
  Pencil,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useCurrentUser } from "../context/UserContext";
import { useApp } from "../context/AppContext";
import { useSetup } from "../context/SetupContext";
import { useTheme, THEMES } from "../context/ThemeContext";
import { User, Lock, Palette } from "lucide-react";
import { logInfo, logError, setFrontendLogLevel } from "../utils/log";

interface AppConfig {
  gateway: {
    port: number;
    admin_port: number;
    use_tls: boolean;
    host: string;
    api_key: string;
    log_level: string;
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
  };
}

interface ProxyTestResult {
  success: boolean;
  message: string;
}

interface ProfileInfo {
  id: string;
  name: string;
  active: boolean;
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

export default function BasicSettings() {
  const queryClient = useQueryClient();
  const [hasChanges, setHasChanges] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const { changePassword } = useAuth();
  const { isAdmin } = useCurrentUser();
  const { setTheme, setLocale, setTimezone } = useApp();
  const { theme: currentTheme, setTheme: setUITheme } = useTheme();
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const [proxyTestResult, setProxyTestResult] = useState<ProxyTestResult | null>(null);
  const [proxyTesting, setProxyTesting] = useState(false);
  const {
    checkSetup,
    deployMode: currentMode,
    connected: currentConnected,
    reconnect,
  } = useSetup();
  const [switchMode, setSwitchMode] = useState<"pc" | "server">("pc");
  const [switchRemoteUrl, setSwitchRemoteUrl] = useState("");
  const [switchRemoteProxyUrl, setSwitchRemoteProxyUrl] = useState("");
  const [switchPort, setSwitchPort] = useState(8080);
  const [switching, setSwitching] = useState(false);
  const [connectTestResult, setConnectTestResult] = useState<ProxyTestResult | null>(null);
  const [connectTesting, setConnectTesting] = useState(false);
  const [showSwitchPanel, setShowSwitchPanel] = useState(false);
  const [reconnectUser, setReconnectUser] = useState("");
  const [reconnectPwd, setReconnectPwd] = useState("");
  const [reconnectLoading, setReconnectLoading] = useState(false);
  const [reconnectError, setReconnectError] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [portRestarting, setPortRestarting] = useState(false);

  const { data: currentConfig, isLoading } = useQuery<AppConfig>({
    queryKey: ["config"],
    queryFn: () => configApi.get() as Promise<AppConfig>,
  });

  const { data: profilesData, refetch: refetchProfiles } = useQuery<ProfileInfo[]>({
    queryKey: ["profiles"],
    queryFn: () => configApi.listProfiles(),
  });

  useEffect(() => {
    if (currentConfig && !config) {
      setConfig(currentConfig);
      if (currentConfig.gateway?.log_level) setFrontendLogLevel(currentConfig.gateway.log_level);
    }
  }, [currentConfig]);

  const saveMutation = useMutation({
    mutationFn: (newConfig: AppConfig) => {
      logInfo("Settings", "save_config");
      return configApi.save(newConfig as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
      setHasChanges(false);
      if (config?.ui.theme) setTheme(config.ui.theme);
      if (config?.ui.language) setLocale(config.ui.language as any);
      if (config?.ui.timezone) setTimezone(config.ui.timezone);
      if (config?.gateway.log_level) setFrontendLogLevel(config.gateway.log_level);
    },
    onError: (error) => { logError("Settings", "save_config failed", error); },
  });

  const resetMutation = useMutation({
    mutationFn: () => {
      logInfo("Settings", "reset_config");
      return configApi.reset();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
      setHasChanges(false);
      setTheme("dark");
      setLocale("zh-CN");
      setTimezone("Asia/Shanghai");
    },
    onError: (error) => { logError("Settings", "reset_config failed", error); },
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
      const result = await proxyApi.testConnectivity(config?.advanced.proxy_url || undefined);
      setProxyTestResult(result);
    } catch (e: any) {
      setProxyTestResult({ success: false, message: e?.toString() || "测试失败" });
    } finally {
      setProxyTesting(false);
    }
  };

  const handleChangePassword = async () => {
    setPwdMsg("");
    if (newPwd.length < 6) { setPwdMsg("新密码至少6个字符"); return; }
    if (newPwd !== confirmPwd) { setPwdMsg("两次输入不一致"); return; }
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
    return <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  const proxyType = detectProxyType(config.advanced.proxy_url || "");

  const handleSwitchTest = async () => {
    setConnectTesting(true);
    setConnectTestResult(null);
    try {
      const url = switchMode === "pc" ? `https://127.0.0.1:${switchPort}` : switchRemoteUrl.trim() || "";
      if (!url) { setConnectTestResult({ success: false, message: "请输入服务地址" }); setConnectTesting(false); return; }
      const result = await invoke<ProxyTestResult>("check_service_connection", { serviceUrl: url });
      setConnectTestResult(result);
    } catch (e: any) {
      setConnectTestResult({ success: false, message: e?.toString() || "测试失败" });
    } finally {
      setConnectTesting(false);
    }
  };

  const handleSwitch = async () => {
    setSwitching(true);
    try {
      const remoteUrl = switchMode === "server" ? switchRemoteUrl.trim() || null : null;
      const remoteProxyUrl = switchMode === "server" && switchRemoteProxyUrl.trim() ? switchRemoteProxyUrl.trim() : null;
      await invoke("switch_deploy_mode", { deployMode: switchMode, remoteUrl, remoteProxyUrl, port: switchMode === "pc" ? switchPort : null });
      setShowSwitchPanel(false);
      await checkSetup();
    } catch (e: any) {
      alert("切换失败: " + (e?.toString() || "未知错误"));
    } finally {
      setSwitching(false);
    }
  };

  const handleDisconnect = async () => {
    try { await invoke("disconnect_service"); await checkSetup(); } catch (e: any) { alert("断开失败: " + (e?.toString() || "未知错误")); }
  };

  const handleReconnect = async () => {
    setReconnectLoading(true);
    setReconnectError("");
    try {
      if (currentMode === "pc") { await reconnect(); } else {
        if (!reconnectUser || !reconnectPwd) { setReconnectError("请输入用户名和密码"); setReconnectLoading(false); return; }
        await reconnect(reconnectUser, reconnectPwd);
        setReconnectUser(""); setReconnectPwd("");
      }
      await checkSetup();
    } catch (e: any) { setReconnectError(e?.toString?.() || "连接失败"); } finally { setReconnectLoading(false); }
  };

  const handleSaveProfile = async () => {
    if (!newProfileName.trim()) return;
    try {
      const id = "profile_" + Date.now();
      await configApi.saveAsProfile(id, newProfileName.trim());
      setNewProfileName(""); setShowNewProfile(false); refetchProfiles();
    } catch (e: any) { alert("保存失败: " + (e?.toString() || "未知错误")); }
  };

  const handleLoadProfile = async (profileId: string) => {
    if (!confirm("切换配置方案将替换当前所有配置（Providers、网关、服务等）。确定继续？")) return;
    try {
      await configApi.loadProfile(profileId);
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["proxy-models"] });
      refetchProfiles();
      await checkSetup();
    } catch (e: any) { alert("切换失败: " + (e?.toString() || "未知错误")); }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (!confirm("确定删除此配置方案？")) return;
    try { await configApi.deleteProfile(profileId); refetchProfiles(); } catch (e: any) { alert("删除失败: " + (e?.toString() || "未知错误")); }
  };

  const handleRenameProfile = async (profileId: string) => {
    if (!renameValue.trim()) return;
    try { await configApi.renameProfile(profileId, renameValue.trim()); setRenamingId(null); refetchProfiles(); } catch (e: any) { alert("重命名失败: " + (e?.toString() || "未知错误")); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">基础设置</h1>
        <p className="text-sm text-muted-foreground mt-1">网关配置、服务连接、主题与密码管理</p>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button onClick={() => { if (confirm("确定要重置为默认配置吗？")) resetMutation.mutate(); }} disabled={resetMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors disabled:opacity-50">
          <RotateCcw size={20} /><span>重置</span>
        </button>
        <button onClick={() => config && saveMutation.mutate(config)} disabled={!hasChanges || saveMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
          <Save size={20} /><span>{saveMutation.isPending ? "保存中..." : "保存"}</span>
        </button>
      </div>

      {isAdmin && (<>
      <div className="bg-card rounded-lg p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-primary" />
            配置方案
            <span className="text-sm font-normal text-muted-foreground">({profilesData?.length ?? 0} 个方案)</span>
          </h2>
          <button onClick={() => setShowNewProfile(!showNewProfile)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
            <Plus size={14} />保存当前为新方案
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          配置方案保存了完整的 Provider、模型映射、网关和服务设置。程序使用过程中的一切操作（添加 Provider、修改端口等）会自动保存到当前方案。
        </p>
        {showNewProfile && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-secondary/30 rounded-lg border border-border">
            <input type="text" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)}
              className="flex-1 px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              placeholder="输入方案名称，如：工作环境、测试环境..."
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveProfile(); }} />
            <button onClick={handleSaveProfile} disabled={!newProfileName.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 text-sm">保存</button>
            <button onClick={() => { setShowNewProfile(false); setNewProfileName(""); }}
              className="px-3 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 text-sm">取消</button>
          </div>
        )}
        <div className="space-y-2">
          {profilesData?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">暂无配置方案，点击上方按钮保存当前配置</p>}
          {profilesData?.map((profile) => (
            <div key={profile.id}
              className={`flex items-center justify-between p-3 rounded-lg border ${profile.active ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"}`}>
              <div className="flex items-center gap-3">
                {renamingId === profile.id ? (
                  <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                    className="px-2 py-1 bg-background border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary" autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") handleRenameProfile(profile.id); if (e.key === "Escape") setRenamingId(null); }}
                    onBlur={() => setRenamingId(null)} />
                ) : <span className="font-medium text-sm">{profile.name}</span>}
                {profile.active && <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">当前使用</span>}
              </div>
              <div className="flex items-center gap-1">
                {!profile.active && <button onClick={() => handleLoadProfile(profile.id)} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors">切换</button>}
                <button onClick={() => { setRenamingId(profile.id); setRenameValue(profile.name); }} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" title="重命名"><Pencil size={14} /></button>
                {!profile.active && <button onClick={() => handleDeleteProfile(profile.id)} className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors" title="删除"><Trash2 size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
      </div>
      </>)}

      <div className="bg-card rounded-lg p-6 border border-border">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">主题风格</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">选择界面配色方案，即时生效</p>
        <div className="grid grid-cols-4 gap-3">
          {THEMES.map((t) => (
            <button key={t.id} onClick={() => setUITheme(t.id)}
              className={`relative p-3 rounded-xl border-2 transition-all text-left ${currentTheme === t.id ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/40"}`}>
              <div className="flex gap-1.5 mb-2.5">
                <div className="w-6 h-6 rounded-md" style={{ background: t.preview.bg, border: "1px solid " + t.preview.primary }} />
                <div className="w-6 h-6 rounded-md" style={{ background: t.preview.card, border: "1px solid " + t.preview.primary }} />
                <div className="w-4 h-6 rounded-md" style={{ background: t.preview.primary }} />
                <div className="w-4 h-6 rounded-md" style={{ background: t.preview.fg }} />
              </div>
              <p className="text-sm font-semibold text-foreground">{t.name}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t.desc}</p>
              {currentTheme === t.id && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary sidebar-glow-dot" />}
            </button>
          ))}
        </div>
      </div>

      {isAdmin && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-lg p-6 border border-border lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">服务连接</h2>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${currentConnected ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${currentConnected ? "bg-green-500" : "bg-red-500"}`} />
                {currentConnected ? "已连接" : "未连接"}
              </span>
              <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded-md">{currentMode === "pc" ? "PC 本地模式" : "服务器模式"}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <code className="text-sm bg-secondary px-3 py-1.5 rounded-md font-mono">
              {currentMode === "pc" ? `管理: :${config.gateway.admin_port} | 代理: :${config.gateway.port}` : "远程服务"}
            </code>
            <div className="flex gap-2">
              {currentConnected && <button onClick={handleDisconnect} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 transition-colors"><WifiOff size={14} /><span>断开</span></button>}
              <button onClick={() => setShowSwitchPanel(!showSwitchPanel)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors"><RefreshCw size={14} /><span>切换模式</span></button>
            </div>
          </div>
          {!currentConnected && (
            <div className="border border-border rounded-lg p-4 bg-secondary/30 space-y-4">
              <h3 className="text-sm font-medium">连接服务</h3>
              {currentMode === "pc" ? (
                <>
                  <p className="text-xs text-muted-foreground">点击连接按钮启动本地代理服务</p>
                  {reconnectError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">{reconnectError}</div>}
                  <button onClick={handleReconnect} disabled={reconnectLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {reconnectLoading && <Loader2 size={14} className="animate-spin" />}
                    <Wifi size={14} /><span>{reconnectLoading ? "启动中..." : "启动并连接"}</span>
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">输入用户名和密码连接到远程服务</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">用户名</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input type="text" value={reconnectUser} onChange={(e) => setReconnectUser(e.target.value)}
                          className="w-full pl-10 pr-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          placeholder="admin" autoComplete="off" data-1p-ignore data-lpignore="true" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">密码</label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input type="password" value={reconnectPwd} onChange={(e) => setReconnectPwd(e.target.value)}
                          className="w-full pl-10 pr-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          placeholder="输入密码"
                          onKeyDown={(e) => { if (e.key === "Enter" && reconnectUser && reconnectPwd && !reconnectLoading) handleReconnect(); }} />
                      </div>
                    </div>
                  </div>
                  {reconnectError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">{reconnectError}</div>}
                  <button onClick={handleReconnect} disabled={!reconnectUser || !reconnectPwd || reconnectLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {reconnectLoading && <Loader2 size={14} className="animate-spin" />}
                    <Wifi size={14} /><span>{reconnectLoading ? "连接中..." : "连接"}</span>
                  </button>
                </>
              )}
            </div>
          )}
          {showSwitchPanel && (
            <div className="border border-border rounded-lg p-4 bg-secondary/30 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setSwitchMode("pc")}
                  className={`p-3 rounded-lg border text-left text-sm transition-all ${switchMode === "pc" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
                  <Monitor className="w-5 h-5 mb-1 text-primary" /><div className="font-medium">PC 本地模式</div>
                </button>
                <button onClick={() => setSwitchMode("server")}
                  className={`p-3 rounded-lg border text-left text-sm transition-all ${switchMode === "server" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
                  <Globe className="w-5 h-5 mb-1 text-primary" /><div className="font-medium">服务器模式</div>
                </button>
              </div>
              {switchMode === "pc" ? (
                <div>
                  <label className="block text-sm font-medium mb-1">端口</label>
                  <input type="number" value={switchPort} onChange={(e) => setSwitchPort(parseInt(e.target.value) || 8080)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" min="1024" max="65535" />
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">管理面地址</label>
                    <input type="text" value={switchRemoteUrl} onChange={(e) => setSwitchRemoteUrl(e.target.value)}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="https://your-server.com:8081" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">模型代理地址 <span className="text-muted-foreground font-normal">（可留空同管理面）</span></label>
                    <input type="text" value={switchRemoteProxyUrl} onChange={(e) => setSwitchRemoteProxyUrl(e.target.value)}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="https://your-server.com:8080（留空则同管理面）" />
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <button onClick={handleSwitchTest} disabled={connectTesting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors disabled:opacity-50">
                  {connectTesting ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}测试连接
                </button>
                {connectTestResult && (
                  <span className={`text-sm flex items-center gap-1 ${connectTestResult.success ? "text-green-500" : "text-red-500"}`}>
                    {connectTestResult.success ? <CheckCircle size={14} /> : <XCircle size={14} />}{connectTestResult.message}
                  </span>
                )}
                <div className="flex-1" />
                <button onClick={handleSwitch} disabled={switching}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                  {switching && <Loader2 size={14} className="animate-spin" />}确认切换
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="bg-card rounded-lg p-6 border border-border">
          <h2 className="text-xl font-semibold mb-4">网关端口配置</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">模型服务端口</label>
              <p className="text-xs text-muted-foreground mb-1">下游应用（IDE、CLI、Agent 等）通过此端口连接网关调用模型 API。</p>
              <div className="flex items-center gap-3 mb-2">
                <code className="text-sm bg-secondary px-3 py-1.5 rounded-md font-mono">https://127.0.0.1:{config.gateway.port}/v1/chat/completions</code>
              </div>
              <input type="number" value={config.gateway.port} onChange={(e) => updateConfig("gateway", "port", parseInt(e.target.value) || 8080)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" min="1024" max="65535" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">管理端口 <span className="text-muted-foreground font-normal">（内部）</span></label>
              <p className="text-xs text-muted-foreground mb-1">桌面应用与网关服务内部通信端口，默认为模型端口 +1。通常无需修改。</p>
              <input type="number" value={config.gateway.admin_port} onChange={(e) => updateConfig("gateway", "admin_port", parseInt(e.target.value) || 8081)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" min="1024" max="65535" />
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button onClick={async () => {
                if (!confirm("修改端口将重启代理服务，确定继续？")) return;
                setPortRestarting(true);
                try {
                  const result = await invoke<string>("update_gateway_ports", { port: config.gateway.port, adminPort: config.gateway.admin_port });
                  await checkSetup(); queryClient.invalidateQueries({ queryKey: ["config"] }); alert(result);
                } catch (e: any) { alert("端口更新失败: " + (e?.toString() || "未知错误")); } finally { setPortRestarting(false); }
              }} disabled={portRestarting}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors text-sm">
                {portRestarting && <Loader2 size={14} className="animate-spin" />}
                {portRestarting ? "重启中..." : "应用端口变更"}
              </button>
              <span className="text-xs text-muted-foreground">修改端口后需点击此按钮重启服务才能生效</span>
            </div>
            <div className="pt-2">
              <label className="block text-sm font-medium mb-1">日志级别</label>
              <select value={config.gateway.log_level} onChange={(e) => updateConfig("gateway", "log_level", e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="debug">Debug（开发调试）</option><option value="info">Info（正常运行）</option>
                <option value="warn">Warning（仅警告）</option><option value="error">Error（仅错误）</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg p-6 border border-border">
          <h2 className="text-xl font-semibold mb-4">界面配置</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">主题</label>
              <select value={config.ui.theme} onChange={(e) => updateConfig("ui", "theme", e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="dark">深色</option><option value="light">浅色</option><option value="system">跟随系统</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">语言</label>
              <select value={config.ui.language} onChange={(e) => updateConfig("ui", "language", e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="zh-CN">中文</option><option value="en-US">English</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">时区</label>
              <select value={config.ui.timezone} onChange={(e) => updateConfig("ui", "timezone", e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option><option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
                <option value="America/New_York">America/New_York (UTC-5)</option><option value="Europe/London">Europe/London (UTC+0)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg p-6 border border-border lg:col-span-2">
          <h2 className="text-xl font-semibold mb-4">网络代理</h2>
          <p className="text-xs text-muted-foreground mb-4">如果网络环境需要通过代理访问外网，在此填写代理地址。支持 HTTP / HTTPS / SOCKS4 / SOCKS5 协议。留空则直连</p>
          <div className="flex gap-4 items-start">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <input type="text" value={config.advanced.proxy_url || ""} onChange={(e) => { updateConfig("advanced", "proxy_url", e.target.value || null); setProxyTestResult(null); }}
                  className="flex-1 px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080" autoComplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
                  readOnly onFocus={(e) => e.target.removeAttribute("readonly")} />
                {proxyType && <span className="shrink-0 px-2 py-1 text-xs font-mono bg-secondary rounded-md">{proxyType}</span>}
              </div>
              {proxyTestResult && (
                <div className={`flex items-center gap-2 text-sm ${proxyTestResult.success ? "text-green-500" : "text-red-500"}`}>
                  {proxyTestResult.success ? <CheckCircle size={16} /> : <XCircle size={16} />}
                  <span>{proxyTestResult.message}</span>
                </div>
              )}
            </div>
            <button onClick={handleTestProxy} disabled={!config.advanced.proxy_url || proxyTesting}
              className="shrink-0 flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors disabled:opacity-50">
              {proxyTesting ? <Loader2 size={16} className="animate-spin" /> : config.advanced.proxy_url ? <Wifi size={16} /> : <WifiOff size={16} />}
              <span>{proxyTesting ? "测试中..." : "测试连接"}</span>
            </button>
          </div>
        </div>
      </div>
      )}

      {!isAdmin && (
      <div className="bg-card rounded-lg p-6 border border-border">
        <h2 className="text-xl font-semibold mb-4">界面配置</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">语言</label>
            <select value={config.ui.language} onChange={(e) => updateConfig("ui", "language", e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="zh-CN">中文</option><option value="en-US">English</option>
            </select>
          </div>
        </div>
      </div>
      )}

      <form className="bg-card rounded-lg p-6 border border-border" onSubmit={(e) => { e.preventDefault(); handleChangePassword(); }} autoComplete="off">
        <h2 className="text-xl font-semibold mb-4">修改密码</h2>
        <div className="space-y-4 max-w-md">
          <input type="text" name="username" autoComplete="off" tabIndex={-1} className="hidden" aria-hidden="true" />
          <div>
            <label className="block text-sm font-medium mb-1">当前密码</label>
            <input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" autoComplete="off" data-1p-ignore data-lpignore="true" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">新密码</label>
            <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" autoComplete="new-password" data-1p-ignore data-lpignore="true" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">确认新密码</label>
            <input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" autoComplete="new-password" data-1p-ignore data-lpignore="true" />
          </div>
          <div className="flex items-center gap-4 pt-2">
            <button type="submit" disabled={!oldPwd || !newPwd || !confirmPwd}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">修改密码</button>
            {pwdMsg && <span className={`text-sm ${pwdMsg.includes("成功") ? "text-green-500" : "text-destructive"}`}>{pwdMsg}</span>}
          </div>
        </div>
      </form>

      {saveMutation.isSuccess && <div className="fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg">配置保存成功</div>}
    </div>
  );
}
