import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Activity, Lock, User, Shield, Eye, EyeOff, UserPlus } from "lucide-react";

export default function Login() {
  const { login, setup, register, initialized, registrationOpen } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");

  const isSetup = !initialized;
  const isRegister = mode === "register" && !isSetup;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (isSetup || isRegister) {
      if (password.length < 6) {
        setError("密码至少需要6个字符");
        return;
      }
      if (password !== confirmPassword) {
        setError("两次输入的密码不一致");
        return;
      }
    }

    setLoading(true);
    try {
      if (isSetup) {
        await setup(username, password);
      } else if (isRegister) {
        await register(username, password, displayName || undefined);
      } else {
        await login(username, password);
      }
    } catch (err: any) {
      setError(err?.toString?.() || (isSetup ? "初始化失败" : isRegister ? "注册失败" : "登录失败"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="bg-card border border-border rounded-xl p-8 shadow-lg">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Activity className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">ClamAI</h1>
            <p className="text-muted-foreground mt-1">
              {isSetup ? "初始管理员设置" : isRegister ? "注册新账号" : "登录"}
            </p>
          </div>

          {isSetup && (
            <div className="mb-6 p-3 bg-primary/5 border border-primary/20 rounded-lg">
              <div className="flex items-start gap-2">
                <Shield className="w-5 h-5 text-primary mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">首次使用</p>
                  <p className="text-muted-foreground">
                    请设置管理员账号和密码。密码至少6个字符。
                  </p>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">用户名</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="admin"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  required
                />
              </div>
            </div>

            {isRegister && (
              <div>
                <label className="block text-sm font-medium mb-1.5">显示名称</label>
                <div className="relative">
                  <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="可选"
                    autoComplete="off"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1.5">密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder={isSetup || isRegister ? "至少6个字符" : "输入密码"}
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {(isSetup || isRegister) && (
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  确认密码
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="再次输入密码"
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirm ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "处理中..." : isSetup ? "创建管理员" : isRegister ? "注册" : "登录"}
            </button>
          </form>

          {!isSetup && registrationOpen && (
            <div className="mt-4 text-center text-sm">
              {isRegister ? (
                <span className="text-muted-foreground">
                  已有账号？{" "}
                  <button
                    onClick={() => { setMode("login"); setError(""); }}
                    className="text-primary hover:underline"
                  >
                    去登录
                  </button>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  没有账号？{" "}
                  <button
                    onClick={() => { setMode("register"); setError(""); }}
                    className="text-primary hover:underline"
                  >
                    注册新账号
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          ClamAI - 智能大模型网关
        </p>
      </div>
    </div>
  );
}
