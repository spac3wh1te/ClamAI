import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Plus, Trash2, Save, Gauge, HelpCircle } from "lucide-react";

interface RateLimitConfig {
  global_rpm: number;
  key_rpm: number;
  model_rpm: Record<string, number>;
  provider_rpm: Record<string, number>;
}

interface Provider {
  id: string;
  name: string;
  provider_type: string;
  enabled: boolean;
  models: string[];
}

const defaultConfig: RateLimitConfig = {
  global_rpm: 0,
  key_rpm: 0,
  model_rpm: {},
  provider_rpm: {},
};

const rpmPresets = [
  { label: "3 RPM（个人测试）", value: 3 },
  { label: "10 RPM（轻量使用）", value: 10 },
  { label: "30 RPM（中等负载）", value: 30 },
  { label: "60 RPM（1 RPS）", value: 60 },
  { label: "120 RPM（较高并发）", value: 120 },
  { label: "300 RPM（高并发）", value: 300 },
  { label: "600 RPM（10 RPS）", value: 600 },
  { label: "自定义", value: 0 },
];

export default function RateLimit() {
  const [config, setConfig] = useState<RateLimitConfig>(defaultConfig);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [allModels, setAllModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [newModelRpm, setNewModelRpm] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [customProvider, setCustomProvider] = useState("");
  const [newProviderRpm, setNewProviderRpm] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    loadConfig();
    loadProviders();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const data = await invoke<string>("get_ratelimit_config");
      const parsed = JSON.parse(data);
      setConfig({
        global_rpm: parsed.global_rpm || 0,
        key_rpm: parsed.key_rpm || 0,
        model_rpm: parsed.model_rpm || {},
        provider_rpm: parsed.provider_rpm || {},
      });
    } catch (e) {
      console.error("Failed to load rate limit config:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadProviders = async () => {
    try {
      const data = await invoke<Provider[]>("get_providers");
      setProviders(data || []);
      const models: string[] = [];
      for (const p of data || []) {
        for (const m of p.models || []) {
          const full = `${p.provider_type}:${m}`;
          if (!models.includes(full)) models.push(full);
        }
      }
      setAllModels(models.sort());
    } catch (e) {
      console.error("Failed to load providers:", e);
    }
  };

  const handleSave = async () => {
    try {
      await invoke("save_ratelimit_config", {
        payload: JSON.stringify(config),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Failed to save rate limit config:", e);
    }
  };

  const getModelInput = () =>
    selectedModel === "__custom__" ? customModel : selectedModel;

  const addModelLimit = () => {
    const key = getModelInput();
    if (key && newModelRpm) {
      setConfig({
        ...config,
        model_rpm: { ...config.model_rpm, [key]: parseInt(newModelRpm) },
      });
      setSelectedModel("");
      setCustomModel("");
      setNewModelRpm("");
    }
  };

  const removeModelLimit = (key: string) => {
    const updated = { ...config.model_rpm };
    delete updated[key];
    setConfig({ ...config, model_rpm: updated });
  };

  const getProviderInput = () =>
    selectedProvider === "__custom__" ? customProvider : selectedProvider;

  const addProviderLimit = () => {
    const key = getProviderInput();
    if (key && newProviderRpm) {
      setConfig({
        ...config,
        provider_rpm: {
          ...config.provider_rpm,
          [key]: parseInt(newProviderRpm),
        },
      });
      setSelectedProvider("");
      setCustomProvider("");
      setNewProviderRpm("");
    }
  };

  const removeProviderLimit = (key: string) => {
    const updated = { ...config.provider_rpm };
    delete updated[key];
    setConfig({ ...config, provider_rpm: updated });
  };

  const existingModelKeys = new Set(Object.keys(config.model_rpm));
  const existingProviderKeys = new Set(Object.keys(config.provider_rpm));
  const availableModels = allModels.filter((m) => !existingModelKeys.has(m));
  const availableProviders = providers.filter(
    (p) => !existingProviderKeys.has(p.provider_type),
  );

  if (loading) {
    return (
      <div className="text-muted-foreground py-8 text-center">加载中...</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Gauge className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">限流配置</h2>
            <p className="text-sm text-muted-foreground">
              控制请求速率，防止上游 API 过载被封
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHelp(!showHelp)}
            className={`p-2 rounded-lg transition-colors ${showHelp ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
            title="帮助说明"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${saved ? "bg-green-600 text-white" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
          >
            <Save className="w-4 h-4" />
            {saved ? "已保存" : "保存配置"}
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="bg-card border border-primary/30 rounded-lg p-5 space-y-3">
          <h3 className="font-semibold text-primary">什么是 RPM？如何配置？</h3>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong className="text-foreground">
                RPM (Requests Per Minute)
              </strong>{" "}
              即每分钟允许通过的最大请求数。超过限制的请求会返回{" "}
              <code className="bg-secondary px-1 rounded">
                429 Too Many Requests
              </code>
              ，客户端需等待后重试。
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div className="bg-background rounded-lg p-3 border border-border">
                <p className="font-medium text-foreground mb-1">
                  为什么需要限流？
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  <li>
                    上游 API（如 OpenAI）有 RPM 限制，超限返回 429 甚至封号
                  </li>
                  <li>防止单个用户/模型占用全部配额</li>
                  <li>多用户共享时公平分配资源</li>
                </ul>
              </div>
              <div className="bg-background rounded-lg p-3 border border-border">
                <p className="font-medium text-foreground mb-1">
                  如何设置合适的值？
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  <li>个人使用：全局 60 RPM、Key 30 RPM 通常够用</li>
                  <li>多人共享：Key 10~20 RPM，全局按上游限制设</li>
                  <li>昂贵模型（如 GPT-4）：单独限 3~10 RPM</li>
                  <li>
                    设为 <strong>0</strong> 表示不限制
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-semibold mb-1">全局限流</h3>
          <p className="text-xs text-muted-foreground mb-3">
            网关整体每分钟最大请求数，0 = 不限制
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              value={config.global_rpm || ""}
              onChange={(e) =>
                setConfig({
                  ...config,
                  global_rpm: parseInt(e.target.value) || 0,
                })
              }
              className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="0"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              RPM
            </span>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-semibold mb-1">API Key 限流</h3>
          <p className="text-xs text-muted-foreground mb-3">
            每个 API Key 每分钟最大请求数，0 = 不限制
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              value={config.key_rpm || ""}
              onChange={(e) =>
                setConfig({ ...config, key_rpm: parseInt(e.target.value) || 0 })
              }
              className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="0"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              RPM
            </span>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="font-semibold mb-1">按模型限流</h3>
        <p className="text-xs text-muted-foreground mb-3">
          为特定模型单独设置 RPM 上限（如昂贵模型限制更严）
        </p>

        {Object.keys(config.model_rpm).length > 0 && (
          <div className="space-y-2 mb-3">
            {Object.entries(config.model_rpm).map(([model, rpm]) => (
              <div
                key={model}
                className="flex items-center gap-2 p-2 bg-secondary rounded-lg"
              >
                <span className="flex-1 text-sm font-mono truncate">
                  {model}
                </span>
                <span className="text-sm font-medium">{rpm} RPM</span>
                <button
                  onClick={() => removeModelLimit(model)}
                  className="p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="flex-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">选择模型...</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="__custom__">手动输入...</option>
          </select>
          {selectedModel === "__custom__" && (
            <input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="provider:model-name"
            />
          )}
          <input
            type="number"
            min="1"
            value={newModelRpm}
            onChange={(e) => setNewModelRpm(e.target.value)}
            className="w-24 px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="RPM"
          />
          <button
            onClick={addModelLimit}
            disabled={!getModelInput() || !newModelRpm}
            className="p-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="font-semibold mb-1">按提供商限流</h3>
        <p className="text-xs text-muted-foreground mb-3">
          为特定提供商设置 RPM 上限（如某提供商免费额度有限）
        </p>

        {Object.keys(config.provider_rpm).length > 0 && (
          <div className="space-y-2 mb-3">
            {Object.entries(config.provider_rpm).map(([provider, rpm]) => (
              <div
                key={provider}
                className="flex items-center gap-2 p-2 bg-secondary rounded-lg"
              >
                <span className="flex-1 text-sm font-mono">{provider}</span>
                <span className="text-sm font-medium">{rpm} RPM</span>
                <button
                  onClick={() => removeProviderLimit(provider)}
                  className="p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="flex-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">选择提供商...</option>
            {availableProviders.map((p) => (
              <option key={p.provider_type} value={p.provider_type}>
                {p.name} ({p.provider_type})
              </option>
            ))}
            <option value="__custom__">手动输入...</option>
          </select>
          {selectedProvider === "__custom__" && (
            <input
              type="text"
              value={customProvider}
              onChange={(e) => setCustomProvider(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="provider-name"
            />
          )}
          <input
            type="number"
            min="1"
            value={newProviderRpm}
            onChange={(e) => setNewProviderRpm(e.target.value)}
            className="w-24 px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="RPM"
          />
          <button
            onClick={addProviderLimit}
            disabled={!getProviderInput() || !newProviderRpm}
            className="p-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
