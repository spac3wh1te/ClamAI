import { Globe, Fingerprint } from "lucide-react";

export default function KeyControl() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">密钥管控</h1>
        <p className="text-sm text-muted-foreground mt-1">API 密钥安全管控、熔断策略与封禁管理</p>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card rounded-xl p-5 border border-border">
            <h3 className="text-sm font-semibold mb-1">动态黑名单</h3>
            <p className="text-xs text-muted-foreground">基于安全事件自动封禁 API 密钥</p>
          </div>
          <div className="bg-card rounded-xl p-5 border border-border">
            <h3 className="text-sm font-semibold mb-1">熔断策略</h3>
            <p className="text-xs text-muted-foreground">异常调用频率自动触发临时封禁</p>
          </div>
          <div className="bg-card rounded-xl p-5 border border-border">
            <h3 className="text-sm font-semibold mb-1">手动管控</h3>
            <p className="text-xs text-muted-foreground">手动拉黑 / 解封密钥</p>
          </div>
        </div>
        <div className="bg-card rounded-xl p-8 border border-border text-center">
          <Fingerprint className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">密钥管控功能开发中，可在「安全设置 → 安全配置」中开启自动封禁</p>
        </div>
      </div>
    </div>
  );
}
