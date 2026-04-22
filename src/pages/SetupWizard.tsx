import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Activity,
  Monitor,
  Globe,
  CheckCircle,
  XCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Shield,
  Wifi,
  WifiOff,
} from "lucide-react";

interface ProxyTestResult {
  success: boolean;
  message: string;
  initialized?: boolean;
}

interface SetupWizardProps {
  onComplete: () => void;
}

type WizardStep = "mode" | "connection" | "verify";

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>("mode");
  const [deployMode, setDeployMode] = useState<"pc" | "server">("pc");
  const [port, setPort] = useState(8080);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");
  const [remoteUsername, setRemoteUsername] = useState("");
  const [remotePassword, setRemotePassword] = useState("");
  const [remoteConfirmPassword, setRemoteConfirmPassword] = useState("");
  const [remoteInitError, setRemoteInitError] = useState("");

  const testConnection = async (url: string) => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await invoke<ProxyTestResult>("check_service_connection", {
        serviceUrl: url,
      });
      setTestResult(result);
    } catch (e: any) {
      setTestResult({ success: false, message: e?.toString() || "测试失败" });
    } finally {
      setTesting(false);
    }
  };

  const handleModeTest = async () => {
    if (deployMode === "pc") {
      await testConnection(`https://127.0.0.1:${port}`);
    } else {
      if (!remoteUrl.trim()) {
        setError("请输入远程服务地址");
        return;
      }
      let url = remoteUrl.trim();
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = `https://${url}`;
      }
      setRemoteUrl(url);
      await testConnection(url);
    }
  };

  const handleComplete = async () => {
    setCompleting(true);
    setError("");
    try {
      let url: string | null = null;
      if (deployMode === "server") {
        url = remoteUrl.trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          url = `https://${url}`;
        }
      }
      await invoke("complete_setup", {
        deployMode,
        remoteUrl: url,
        port: deployMode === "pc" ? port : null,
      });
      onComplete();
    } catch (e: any) {
      setError(e?.toString() || "配置失败");
    } finally {
      setCompleting(false);
    }
  };

  const canProceed = () => {
    if (step === "mode") return true;
    if (step === "connection") return testResult?.success === true;
    if (step === "verify") return testResult?.success === true;
    return false;
  };

  const steps: { key: WizardStep; label: string; num: number }[] = [
    { key: "mode", label: "选择模式", num: 1 },
    { key: "connection", label: "连接服务", num: 2 },
    { key: "verify", label: "验证完成", num: 3 },
  ];

  const currentStepIdx = steps.findIndex((s) => s.key === step);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-lg">
        <div className="bg-card border border-border rounded-xl p-8 shadow-lg">
          <div className="flex flex-col items-center mb-6">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Activity className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">ClamAI 初始设置</h1>
            <p className="text-muted-foreground mt-1">
              首次使用，请完成以下配置
            </p>
          </div>

          {/* 进度条 */}
          <div className="flex items-center justify-between mb-8 px-4">
            {steps.map((s, i) => (
              <React.Fragment key={s.key}>
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                      i <= currentStepIdx
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {i < currentStepIdx ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      s.num
                    )}
                  </div>
                  <span className="text-xs mt-1 text-muted-foreground">
                    {s.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 ${
                      i < currentStepIdx ? "bg-primary" : "bg-border"
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* 步骤1：选择模式 */}
          {step === "mode" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">选择工作模式</h2>
              <p className="text-sm text-muted-foreground">
                ClamAI 支持两种工作模式，请根据您的使用场景选择
              </p>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <button
                  onClick={() => setDeployMode("pc")}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    deployMode === "pc"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <Monitor className="w-8 h-8 mb-2 text-primary" />
                  <h3 className="font-semibold">PC 本地模式</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    在本机启动代理服务，适合个人开发和测试使用
                  </p>
                </button>
                <button
                  onClick={() => setDeployMode("server")}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    deployMode === "server"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <Globe className="w-8 h-8 mb-2 text-primary" />
                  <h3 className="font-semibold">服务器模式</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    连接到远程已部署的代理服务，适合团队共享使用
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* 步骤2：连接服务 */}
          {step === "connection" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">
                {deployMode === "pc" ? "启动本地服务" : "连接远程服务"}
              </h2>

              {deployMode === "pc" ? (
                <div>
                  <p className="text-sm text-muted-foreground mb-4">
                    配置本地代理服务端口，然后点击"测试连接"启动并验证服务
                  </p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        监听端口
                      </label>
                      <input
                        type="number"
                        value={port}
                        onChange={(e) => {
                          setPort(parseInt(e.target.value) || 8080);
                          setTestResult(null);
                        }}
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                        min="1024"
                        max="65535"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        服务将启动在 https://127.0.0.1:{port}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-muted-foreground mb-4">
                    输入远程 ClamAI 服务的完整地址（包括协议和端口）
                  </p>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      远程服务地址
                    </label>
                    <input
                      type="text"
                      value={remoteUrl}
                      onChange={(e) => {
                        setRemoteUrl(e.target.value);
                        setTestResult(null);
                      }}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="https://your-server.com:8080"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      支持带端口的地址，例如 https://192.168.1.100:8080
                    </p>
                  </div>

                  {testResult?.initialized === false && (
                    <div className="mt-4 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                      <p className="text-sm font-medium mb-3">
                        首次使用，需要初始化远程服务器管理员
                      </p>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            用户名
                          </label>
                          <input
                            type="text"
                            value={remoteUsername}
                            onChange={(e) => setRemoteUsername(e.target.value)}
                            className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="admin"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            密码
                          </label>
                          <input
                            type="password"
                            value={remotePassword}
                            onChange={(e) => setRemotePassword(e.target.value)}
                            className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="至少6个字符"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            确认密码
                          </label>
                          <input
                            type="password"
                            value={remoteConfirmPassword}
                            onChange={(e) =>
                              setRemoteConfirmPassword(e.target.value)
                            }
                            className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="再次输入密码"
                          />
                        </div>
                        {remoteInitError && (
                          <div className="text-sm text-red-500">
                            {remoteInitError}
                          </div>
                        )}
                        <button
                          onClick={async () => {
                            setRemoteInitError("");
                            if (remotePassword.length < 6) {
                              setRemoteInitError("密码至少6个字符");
                              return;
                            }
                            if (remotePassword !== remoteConfirmPassword) {
                              setRemoteInitError("两次密码不一致");
                              return;
                            }
                            try {
                              await invoke("init_remote_server", {
                                username: remoteUsername,
                                password: remotePassword,
                              });
                              const result = await invoke<ProxyTestResult>(
                                "check_service_connection",
                                {
                                  serviceUrl: remoteUrl,
                                },
                              );
                              setTestResult(result);
                            } catch (e: any) {
                              setRemoteInitError(
                                e?.toString?.() || "初始化失败",
                              );
                            }
                          }}
                          disabled={!remoteUsername || !remotePassword}
                          className="w-full py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors text-sm"
                        >
                          初始化远程服务器
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 测试连接按钮 */}
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={handleModeTest}
                  disabled={
                    testing || (deployMode === "server" && !remoteUrl.trim())
                  }
                  className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors disabled:opacity-50"
                >
                  {testing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Wifi size={16} />
                  )}
                  <span>{testing ? "测试中..." : "测试连接"}</span>
                </button>
                {testResult && (
                  <div
                    className={`flex items-center gap-2 text-sm ${
                      testResult.success ? "text-green-500" : "text-red-500"
                    }`}
                  >
                    {testResult.success ? (
                      <CheckCircle size={16} />
                    ) : (
                      <XCircle size={16} />
                    )}
                    <span>{testResult.message}</span>
                  </div>
                )}
              </div>

              {testResult && !testResult.success && deployMode === "pc" && (
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg text-sm">
                  <p className="text-muted-foreground">
                    本地服务未启动是正常的，点击"下一步"将自动启动服务。
                    如果启动失败，请检查端口是否被占用。
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 步骤3：验证完成 */}
          {step === "verify" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">配置确认</h2>
              <p className="text-sm text-muted-foreground">
                请确认以下配置，点击"完成设置"启动服务并进入系统
              </p>

              <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">工作模式</span>
                  <span className="font-medium">
                    {deployMode === "pc" ? "PC 本地模式" : "服务器模式"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">服务地址</span>
                  <span className="font-medium font-mono text-sm">
                    {deployMode === "pc"
                      ? `https://127.0.0.1:${port}`
                      : remoteUrl}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">连接状态</span>
                  <span
                    className={`font-medium ${
                      testResult?.success ? "text-green-500" : "text-yellow-500"
                    }`}
                  >
                    {testResult?.success ? "已连接" : "待验证"}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium">下一步</p>
                  <p className="text-muted-foreground">
                    完成设置后，系统将创建管理员账号。首次登录时请设置用户名和密码。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive mt-4">
              {error}
            </div>
          )}

          {/* 导航按钮 */}
          <div className="flex justify-between mt-8">
            <button
              onClick={() => {
                if (step === "connection") setStep("mode");
                else if (step === "verify") setStep("connection");
              }}
              disabled={step === "mode"}
              className="flex items-center gap-2 px-4 py-2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
            >
              <ArrowLeft size={16} />
              <span>上一步</span>
            </button>

            {step === "verify" ? (
              <button
                onClick={handleComplete}
                disabled={completing}
                className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {completing ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : null}
                <span>{completing ? "配置中..." : "完成设置"}</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  if (step === "mode") setStep("connection");
                  else if (step === "connection") {
                    handleModeTest();
                    setStep("verify");
                  }
                }}
                className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <span>下一步</span>
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          ClamAI - 智能大模型网关
        </p>
      </div>
    </div>
  );
}
