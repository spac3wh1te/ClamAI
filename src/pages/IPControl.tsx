import { Globe } from "lucide-react";

export default function IPControl() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">IP 访问控制</h1>
        <p className="text-sm text-muted-foreground mt-1">管理 IP 黑白名单，控制访问来源</p>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-card rounded-xl p-5 border border-border">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><Globe size={16} className="text-red-400" /> 黑名单模式</h3>
            <p className="text-xs text-muted-foreground">阻止指定 IP 或网段的访问请求。命中黑名单的请求将直接返回 403。</p>
          </div>
          <div className="bg-card rounded-xl p-5 border border-border">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><Globe size={16} className="text-emerald-400" /> 白名单模式</h3>
            <p className="text-xs text-muted-foreground">仅允许白名单内的 IP 访问。适用于内网部署或限定合作伙伴场景。</p>
          </div>
        </div>
        <div className="bg-card rounded-xl p-8 border border-border text-center">
          <Globe className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">IP 访问控制功能开发中，敬请期待</p>
        </div>
      </div>
    </div>
  );
}
