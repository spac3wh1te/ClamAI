import React, { useState, useEffect } from "react";
import { setupApi, type ConnectionTestResult } from "../api/setup";
import {
  Activity, Monitor, Globe, CheckCircle, XCircle, Loader2,
  ArrowRight, ArrowLeft, Shield, Wifi, Lock, Unlock, Server,
} from "lucide-react";

type TestResult = ConnectionTestResult;
interface SetupWizardProps { onComplete: () => void }
type WizardStep = "mode" | "service" | "admin";

function ensureProtocol(url: string): string {
  let u = url.trim();
  if (!u.startsWith("http://") && !u.startsWith("https://")) u = `https://${u}`;
  return u;
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>("mode");
  const [deployMode, setDeployMode] = useState<"pc" | "server">("pc");

  // Local mode
  const [protocol, setProtocol] = useState<"http" | "https">("http");
  const [host, setHost] = useState<"127.0.0.1" | "0.0.0.0">("127.0.0.1");
  const [proxyPort, setProxyPort] = useState(8080);
  const [adminPort, setAdminPort] = useState(8081);
  const [proxyPortOk, setProxyPortOk] = useState<boolean | null>(null);
  const [adminPortOk, setAdminPortOk] = useState<boolean | null>(null);
  const [checkingPort, setCheckingPort] = useState(false);

  // Remote mode
  const [remoteAdminUrl, setRemoteAdminUrl] = useState("");
  const [remoteProxyUrl, setRemoteProxyUrl] = useState("");
  const [remoteTestResult, setRemoteTestResult] = useState<TestResult | null>(null);
  const [remoteTesting, setRemoteTesting] = useState(false);

  // Admin
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState("");

  // Port check
  useEffect(() => {
    if (deployMode !== "pc") return;
    const t = setTimeout(async () => {
      setCheckingPort(true);
      try {
        const p1 = await setupApi.checkPort(proxyPort);
        const p2 = await setupApi.checkPort(adminPort);
        setProxyPortOk(p1);
        setAdminPortOk(p2);
      } catch { setProxyPortOk(null); setAdminPortOk(null); }
      setCheckingPort(false);
    }, 300);
    return () => clearTimeout(t);
  }, [proxyPort, adminPort, deployMode]);

  useEffect(() => {
    if (proxyPort + 1 !== adminPort) return;
    setAdminPort(proxyPort + 1);
    setAdminPortOk(null);
  }, [proxyPort]);

  const testRemote = async () => {
    if (!remoteAdminUrl.trim()) return;
    setRemoteTesting(true);
    setRemoteTestResult(null);
    try {
      const url = ensureProtocol(remoteAdminUrl);
      setRemoteAdminUrl(url);
      const result = await setupApi.checkConnection(url);
      setRemoteTestResult(result);
    } catch (e: any) {
      setRemoteTestResult({ success: false, message: e?.toString() || "测试失败" });
    } finally { setRemoteTesting(false); }
  };

  const handleComplete = async () => {
    if (deployMode === "pc") {
      if (password.length < 6) { setAdminError("密码至少6个字符"); return; }
      if (password !== confirmPassword) { setAdminError("两次密码不一致"); return; }
    } else {
      if (!remoteTestResult?.success) { setAdminError("管理面连接未验证通过"); return; }
      if (remoteTestResult.initialized === false) {
        if (password.length < 6) { setAdminError("密码至少6个字符"); return; }
        if (password !== confirmPassword) { setAdminError("两次密码不一致"); return; }
      }
    }
    setCompleting(true);
    setCompleteError("");
    try {
      if (deployMode === "pc") {
        let adminBaseUrl: string;
        try {
          adminBaseUrl = await setupApi.completeSetup({
            deploy_mode: "pc", port: proxyPort, admin_port: adminPort, use_tls: protocol === "https", host,
            remote_url: null, remote_proxy_url: null,
          });
        } catch (e1: any) {
          throw new Error(`步骤1失败 [启动本地服务]: ${e1?.message || e1}`);
        }
        try {
          await setupApi.setupAdmin(username, password, adminBaseUrl);
        } catch (e2: any) {
          throw new Error(`步骤2失败 [创建管理员账号]: ${e2?.message || e2}`);
        }
      } else {
        const adminUrl = ensureProtocol(remoteAdminUrl);
        const proxyUrl = remoteProxyUrl.trim() ? ensureProtocol(remoteProxyUrl) : null;
        try {
          await setupApi.completeSetup({
            deploy_mode: "server", remote_url: adminUrl, remote_proxy_url: proxyUrl,
            port: null, admin_port: null, use_tls: true, host: "127.0.0.1",
          });
        } catch (e1: any) {
          throw new Error(`步骤1失败 [连接远程服务]: ${e1?.message || e1}`);
        }
        if (remoteTestResult?.initialized === false) {
          try {
            await setupApi.initRemote(username, password, adminUrl);
          } catch (e2: any) {
            throw new Error(`步骤2失败 [初始化远程管理员]: ${e2?.message || e2}`);
          }
        }
      }
      onComplete();
    } catch (e: any) {
      const msg = e?.message || e?.toString() || "配置失败";
      console.error("[SetupWizard] Setup FAILED:", msg, e);
      setCompleteError(msg);
    }
    finally { setCompleting(false); }
  };

  const canGoNext = () => {
    if (step === "mode") return true;
    if (step === "service") {
      if (deployMode === "pc") return proxyPortOk === true && adminPortOk === true;
      return remoteTestResult?.success === true;
    }
    return false;
  };

  const steps: { key: WizardStep; label: string; num: number }[] = [
    { key: "mode", label: "选择模式", num: 1 },
    { key: "service", label: "服务配置", num: 2 },
    { key: "admin", label: "初始化", num: 3 },
  ];
  const currentIdx = steps.findIndex(s => s.key === step);

  const PortBadge = ({ ok }: { ok: boolean | null }) => {
    if (ok === null) return null;
    return ok
      ? <span className="flex items-center gap-1 text-xs text-green-500"><CheckCircle className="w-3.5 h-3.5" />可用</span>
      : <span className="flex items-center gap-1 text-xs text-red-500"><XCircle className="w-3.5 h-3.5" />占用</span>;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-lg">
        <div className="bg-card border border-border rounded-xl p-8 shadow-lg">
          {/* Header */}
          <div className="flex flex-col items-center mb-6">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Activity className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">ClamAI 初始设置</h1>
            <p className="text-muted-foreground mt-1">首次使用，请完成以下配置</p>
          </div>
          {/* Progress */}
          <div className="flex items-center justify-between mb-8 px-4">
            {steps.map((s, i) => (
              <React.Fragment key={s.key}>
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    i <= currentIdx ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                  }`}>{i < currentIdx ? <CheckCircle className="w-5 h-5" /> : s.num}</div>
                  <span className="text-xs mt-1 text-muted-foreground">{s.label}</span>
                </div>
                {i < steps.length - 1 && <div className={`flex-1 h-0.5 mx-2 ${i < currentIdx ? "bg-primary" : "bg-border"}`} />}
              </React.Fragment>
            ))}
          </div>

          {/* ====== Step 1: Mode ====== */}
          {step === "mode" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">选择工作模式</h2>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <button onClick={() => setDeployMode("pc")} className={`p-4 rounded-lg border-2 text-left transition-all ${
                  deployMode === "pc" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                }`}>
                  <Monitor className="w-8 h-8 mb-2 text-primary" />
                  <h3 className="font-semibold">本地模式</h3>
                  <p className="text-xs text-muted-foreground mt-1">在本机启动代理服务，适合个人开发测试</p>
                </button>
                <button onClick={() => setDeployMode("server")} className={`p-4 rounded-lg border-2 text-left transition-all ${
                  deployMode === "server" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                }`}>
                  <Globe className="w-8 h-8 mb-2 text-primary" />
                  <h3 className="font-semibold">远程模式</h3>
                  <p className="text-xs text-muted-foreground mt-1">连接到远程已部署的代理服务，适合团队共享</p>
                </button>
              </div>
            </div>
          )}

          {/* ====== Step 2: Service ====== */}
          {step === "service" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">{deployMode === "pc" ? "本地服务配置" : "远程服务连接"}</h2>

              {deployMode === "pc" ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    网关启动后监听两个端口：<b>模型代理端口</b>供下游 AI 工具调用模型，<b>管理端口</b>供本应用内部管理通信。
                  </p>

                  {/* Protocol + Host row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1.5">协议</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setProtocol("http")} className={`flex items-center gap-1.5 p-2.5 rounded-lg border text-xs transition-all ${
                          protocol === "http" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                        }`}>
                          <Unlock className="w-3.5 h-3.5" />
                          <div><div className="font-medium">HTTP</div><div className="text-muted-foreground">推荐</div></div>
                        </button>
                        <button onClick={() => setProtocol("https")} className={`flex items-center gap-1.5 p-2.5 rounded-lg border text-xs transition-all ${
                          protocol === "https" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                        }`}>
                          <Lock className="w-3.5 h-3.5" />
                          <div><div className="font-medium">HTTPS</div><div className="text-muted-foreground">自签证书</div></div>
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">监听地址</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setHost("127.0.0.1")} className={`p-2.5 rounded-lg border text-xs text-left transition-all ${
                          host === "127.0.0.1" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                        }`}><div className="font-medium">127.0.0.1</div><div className="text-muted-foreground">仅本机</div></button>
                        <button onClick={() => setHost("0.0.0.0")} className={`p-2.5 rounded-lg border text-xs text-left transition-all ${
                          host === "0.0.0.0" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                        }`}><div className="font-medium">0.0.0.0</div><div className="text-muted-foreground">局域网</div></button>
                      </div>
                    </div>
                  </div>

                  {/* Proxy Port */}
                  <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">模型代理端口</span>
                      <span className="text-xs text-muted-foreground">下游 AI 工具连接用</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input type="number" value={proxyPort} onChange={(e) => { setProxyPort(parseInt(e.target.value) || 8080); setProxyPortOk(null); }}
                        className="w-28 px-3 py-1.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm" min="1024" max="65535" />
                      {checkingPort ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /> : <PortBadge ok={proxyPortOk} />}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      在 AI 工具中配置代理地址为：
                      <code className="ml-1 bg-background px-1.5 py-0.5 rounded">
                        {protocol}://{host === "0.0.0.0" ? "127.0.0.1" : host}:{proxyPort}/v1/chat/completions
                      </code>
                    </p>
                  </div>

                  {/* Admin Port */}
                  <div className="p-4 rounded-lg border border-border space-y-2">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">管理端口</span>
                      <span className="text-xs text-muted-foreground">本应用内部通信用</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input type="number" value={adminPort} onChange={(e) => { setAdminPort(parseInt(e.target.value) || 8081); setAdminPortOk(null); }}
                        className="w-28 px-3 py-1.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm" min="1024" max="65535" />
                      {checkingPort ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /> : <PortBadge ok={adminPortOk} />}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      管理地址：<code className="bg-secondary px-1 py-0.5 rounded">{protocol}://127.0.0.1:{adminPort}</code>，默认为代理端口+1
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    分别配置远程服务的管理面地址和模型代理地址。两者可能不同（管理面用于本应用管理，代理面供 AI 工具调用模型）。
                  </p>

                  {/* Remote Admin URL */}
                  <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">管理面地址</span>
                    </div>
                    <p className="text-xs text-muted-foreground">ClamAI 应用连接远程服务进行管理的地址</p>
                    <div className="flex gap-2">
                      <input type="text" value={remoteAdminUrl} onChange={(e) => { setRemoteAdminUrl(e.target.value); setRemoteTestResult(null); }}
                        className="flex-1 px-3 py-1.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm" placeholder="https://server.com:8081" />
                      <button onClick={testRemote} disabled={remoteTesting || !remoteAdminUrl.trim()}
                        className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 text-sm shrink-0">
                        {remoteTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
                        验证
                      </button>
                    </div>
                    {remoteTestResult && (
                      <div className={`flex items-center gap-2 text-xs ${remoteTestResult.success ? "text-green-500" : "text-red-500"}`}>
                        {remoteTestResult.success ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        {remoteTestResult.message}
                      </div>
                    )}
                  </div>

                  {/* Remote Proxy URL */}
                  <div className="p-4 rounded-lg border border-border space-y-2">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">模型代理地址</span>
                    </div>
                    <p className="text-xs text-muted-foreground">AI 工具调用模型的地址，如果与管理面相同可留空</p>
                    <input type="text" value={remoteProxyUrl} onChange={(e) => setRemoteProxyUrl(e.target.value)}
                      className="w-full px-3 py-1.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm" placeholder="https://server.com:8080（可留空）" />
                  </div>

                  <p className="text-xs text-muted-foreground">提示：http:// 连 https:// 服务或反过来都会验证失败</p>
                </>
              )}
            </div>
          )}

          {/* ====== Step 3: Admin ====== */}
          {step === "admin" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">{deployMode === "pc" ? "启动服务并创建管理员" : "初始化账号"}</h2>
              <div className="bg-secondary/50 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">工作模式</span>
                  <span className="font-medium">{deployMode === "pc" ? "本地模式" : "远程模式"}</span>
                </div>
                {deployMode === "pc" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">模型代理</span>
                      <code className="text-xs">{protocol}://{host === "0.0.0.0" ? "127.0.0.1" : host}:{proxyPort}</code>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">管理地址</span>
                      <code className="text-xs">{protocol}://127.0.0.1:{adminPort}</code>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">管理面</span>
                      <code className="text-xs">{remoteAdminUrl}</code>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">模型代理</span>
                      <code className="text-xs">{remoteProxyUrl || remoteAdminUrl}</code>
                    </div>
                  </>
                )}
              </div>

              {(deployMode === "pc" || remoteTestResult?.initialized === false) ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                    <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <p className="text-sm">{deployMode === "pc" ? "系统将启动本地服务并创建管理员账号" : "首次使用此远程服务，需要初始化管理员"}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">管理员用户名</label>
                    <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" placeholder="admin" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">密码</label>
                    <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setAdminError(""); }}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" placeholder="至少6个字符" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">确认密码</label>
                    <input type="password" value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setAdminError(""); }}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" placeholder="再次输入密码" />
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-green-500">远程服务已就绪</p>
                    <p className="text-muted-foreground">服务已有管理员账号，可直接连接</p>
                  </div>
                </div>
              )}
              {adminError && <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">{adminError}</div>}
              {completeError && <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive whitespace-pre-wrap break-all">{completeError}</div>}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8">
            <button onClick={() => { if (step === "service") setStep("mode"); else if (step === "admin") setStep("service"); }}
              disabled={step === "mode"} className="flex items-center gap-2 px-4 py-2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30">
              <ArrowLeft size={16} /><span>上一步</span>
            </button>
            {step === "admin" ? (
              <button onClick={handleComplete} disabled={completing || (deployMode === "pc" && (!username || password.length < 6 || password !== confirmPassword))}
                className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {completing && <Loader2 size={16} className="animate-spin" />}
                <span>{completing ? "启动中..." : deployMode === "pc" ? "启动服务并创建管理员" : "完成设置"}</span>
              </button>
            ) : (
              <button onClick={() => { if (step === "mode") setStep("service"); else if (step === "service") { if (deployMode === "server") testRemote(); setStep("admin"); } }}
                disabled={step === "service" && !canGoNext()}
                className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
                <span>下一步</span><ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-4">ClamAI - AI 安全护栏</p>
      </div>
    </div>
  );
}
