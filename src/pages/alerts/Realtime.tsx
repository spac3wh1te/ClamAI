import SecurityAlerts from "../SecurityAlerts";
import { ShieldAlert } from "lucide-react";

export default function AlertRealtime() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
          <ShieldAlert size={20} className="text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">实时防护</h1>
          <p className="text-sm text-muted-foreground mt-1">安全事件的告警及拦截情况展示</p>
        </div>
      </div>
      <SecurityAlerts hideHeader />
    </div>
  );
}
