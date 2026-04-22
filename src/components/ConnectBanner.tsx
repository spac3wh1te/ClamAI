import React, { useState } from "react";
import { Wifi, WifiOff, Loader2, User, Lock, X } from "lucide-react";
import { useSetup } from "../context/SetupContext";

export default function ConnectBanner() {
  const { deployMode, reconnect } = useSetup();
  const [showDialog, setShowDialog] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isPC = deployMode === "pc";

  const handleConnect = async () => {
    setLoading(true);
    setError("");
    try {
      if (isPC) {
        await reconnect();
      } else {
        if (!username || !password) {
          setError("请输入用户名和密码");
          setLoading(false);
          return;
        }
        await reconnect(username, password);
      }
      setShowDialog(false);
      setUsername("");
      setPassword("");
    } catch (e: any) {
      setError(e?.toString?.() || "连接失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-yellow-500 text-sm">
          <WifiOff size={16} />
          <span className="font-medium">后端服务未连接</span>
          <span className="text-yellow-500/70">— 数据不可用，请先连接服务</span>
        </div>
        <div className="flex gap-2">
          {isPC && (
            <button
              onClick={handleConnect}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1 bg-yellow-500 text-black rounded-md text-sm font-medium hover:bg-yellow-400 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Wifi size={14} />
              )}
              {loading ? "连接中..." : "快速连接"}
            </button>
          )}
          {!isPC && (
            <button
              onClick={() => setShowDialog(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-yellow-500 text-black rounded-md text-sm font-medium hover:bg-yellow-400 transition-colors"
            >
              <Wifi size={14} />
              连接服务
            </button>
          )}
        </div>
      </div>

      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">连接远程服务</h2>
              <button
                onClick={() => setShowDialog(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">用户名</label>
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
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">密码</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="输入密码"
                    autoComplete="current-password"
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        username &&
                        password &&
                        !loading
                      ) {
                        handleConnect();
                      }
                    }}
                  />
                </div>
              </div>

              {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                  {error}
                </div>
              )}

              <button
                onClick={handleConnect}
                disabled={!username || !password || loading}
                className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                {loading ? "连接中..." : "连接"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
