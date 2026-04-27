import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import { logInfo, logError } from "../utils/log";
import {
  Plus,
  Trash2,
  Edit,
  TestTube,
  Check,
  X,
  Server,
  Key,
} from "lucide-react";

interface ProviderConfig {
  id: string;
  name: string;
  provider_type: string;
  auth_type: "apikey";
  enabled: boolean;
  base_url: string;
  api_keys: Array<{
    id: string;
    key_value: string;
    name: string;
    is_active: boolean;
    created_at: string;
    last_used: string | null;
    usage_count: number;
  }>;
  models: string[];
  disabled_models: string[];
  oauth_config: any;
  rate_limits: any;
  priority: number;
  created_at: string;
  updated_at: string;
}

interface TestProviderResult {
  success: boolean;
  message: string;
  latency_ms: number;
  available_models: string[];
}

export default function Providers() {
  const queryClient = useQueryClient();
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editProvider, setEditProvider] = useState<ProviderConfig | null>(null);

  const { data: providers, isLoading } = useQuery({
    queryKey: ["providers"],
    queryFn: () => invoke<ProviderConfig[]>("get_providers"),
  });

  const addMutation = useMutation({
    mutationFn: async (provider: ProviderConfig) => {
      logInfo("Providers", "add_provider called", { name: provider.name, type: provider.provider_type });
      const result = await invoke("add_provider", { provider });
      try {
        const activeKey = provider.api_keys.find((k) => k.is_active);
        if (activeKey && activeKey.key_value) {
          await invoke("sync_provider_key", {
            providerName: provider.provider_type,
            apiKey: activeKey.key_value,
          });
        }
      } catch (e) {
        console.warn("同步provider key到代理服务失败:", e);
      }
      try {
        await invoke("fetch_provider_models", { providerId: provider.id });
      } catch (e) {
        console.warn("自动拉取模型失败:", e);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      setShowAddDialog(false);
    },
    onError: (error) => {
      logError("Providers", "add_provider failed", error);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (provider: ProviderConfig) => {
      logInfo("Providers", "update_provider called", { id: provider.id, name: provider.name });
      const result = await invoke("update_provider", { provider });
      try {
        const activeKey = provider.api_keys.find((k) => k.is_active);
        if (activeKey && activeKey.key_value) {
          await invoke("sync_provider_key", {
            providerName: provider.provider_type,
            apiKey: activeKey.key_value,
          });
        }
      } catch (e) {
        console.warn("同步provider key到代理服务失败:", e);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["proxy-models"] });
      setEditProvider(null);
    },
    onError: (error) => {
      logError("Providers", "update_provider failed", error);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => {
      logInfo("Providers", "remove_provider called", { id });
      return invoke("remove_provider", { id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["proxy-models"] });
    },
    onError: (error) => {
      logError("Providers", "remove_provider failed", error);
    },
  });

  const testMutation = useMutation<TestProviderResult, Error, string>({
    mutationFn: (providerId: string) =>
      invoke<TestProviderResult>("test_provider", { providerId }),
  });

  const getProviderIcon = (type: string) => {
    return <Server className="w-5 h-5" />;
  };

  const getProviderTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      openai: "OpenAI",
      anthropic: "Anthropic",
      gemini: "Google Gemini",
      deepseek: "DeepSeek",
      minimax: "MiniMax",
      siliconflow: "SiliconFlow",
      glm: "智谱GLM",
      doubao: "字节豆包",
      qwen: "阿里通义",
      moonshot: "月之暗面Kimi",
      yi: "零一万物",
      openrouter: "OpenRouter",
    };
    return labels[type] || type;
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">提供商管理</h1>
          <p className="text-muted-foreground mt-2">
            添加和管理你的AI服务提供商
          </p>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus size={20} />
          <span>添加提供商</span>
        </button>
      </div>

      {/* 提供商列表 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">加载提供商...</p>
          </div>
        </div>
      ) : providers && providers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className={`bg-card rounded-lg p-6 border transition-all hover:shadow-lg ${
                provider.enabled ? "border-border" : "border-border opacity-60"
              }`}
            >
              {/* 提供商头部 */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    {getProviderIcon(provider.provider_type)}
                  </div>
                  <div>
                    <h3 className="font-semibold">{provider.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {getProviderTypeLabel(provider.provider_type)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => testMutation.mutate(provider.id)}
                    className="p-1 hover:bg-secondary rounded transition-colors"
                    title="测试连接"
                  >
                    <TestTube size={16} />
                  </button>
                  <button
                    onClick={() => setEditProvider(provider)}
                    className="p-1 hover:bg-secondary rounded transition-colors"
                    title="编辑"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={() => removeMutation.mutate(provider.id)}
                    className="p-1 hover:bg-destructive hover:text-destructive-foreground rounded transition-colors"
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* 提供商信息 */}
              <div className="space-y-3">
                {/* 状态 */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">状态</span>
                  <div className="flex items-center gap-1">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        provider.enabled ? "bg-green-500" : "bg-gray-400"
                      }`}
                    ></span>
                    <span className="text-sm">
                      {provider.enabled ? "已启用" : "已禁用"}
                    </span>
                  </div>
                </div>

                {/* API密钥 */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">API密钥</span>
                  <div className="flex items-center gap-1">
                    <Key size={16} />
                    <span className="text-sm">
                      {provider.api_keys.length} 个
                    </span>
                  </div>
                </div>

                {/* 模型数量 */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    可用模型
                  </span>
                  <span className="text-sm">{provider.models.length} 个</span>
                </div>

                {/* 基础URL */}
                <div className="text-xs text-muted-foreground truncate">
                  {provider.base_url}
                </div>
              </div>

              {/* 测试结果 */}
              {testMutation.data && testMutation.variables === provider.id && (
                <div
                  className={`mt-4 p-3 rounded-lg text-sm ${
                    testMutation.data.success
                      ? "bg-green-500/10 text-green-500"
                      : "bg-red-500/10 text-red-500"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {testMutation.data.success ? (
                      <Check size={16} />
                    ) : (
                      <X size={16} />
                    )}
                    <span>{testMutation.data.message}</span>
                  </div>
                  {!testMutation.data.success && (
                    <p className="text-xs mt-1">{testMutation.data.message}</p>
                  )}
                  {testMutation.data.success && (
                    <p className="text-xs mt-1">
                      延迟: {testMutation.data.latency_ms}ms
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <Server className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">暂无提供商</h3>
          <p className="text-muted-foreground mb-4">
            添加你的第一个AI服务提供商开始使用
          </p>
          <button
            onClick={() => setShowAddDialog(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            添加提供商
          </button>
        </div>
      )}

      {/* 添加提供商对话框 */}
      {showAddDialog && (
        <AddProviderDialog
          onClose={() => setShowAddDialog(false)}
          onAdd={(provider) => addMutation.mutate(provider)}
          isLoading={addMutation.isPending}
        />
      )}

      {/* 编辑提供商对话框 */}
      {editProvider && (
        <EditProviderDialog
          provider={editProvider}
          onClose={() => setEditProvider(null)}
          onSave={(provider) => updateMutation.mutate(provider)}
          isLoading={updateMutation.isPending}
        />
      )}
    </div>
  );
}

// 添加提供商对话框组件
function AddProviderDialog({
  onClose,
  onAdd,
  isLoading,
}: {
  onClose: () => void;
  onAdd: (provider: ProviderConfig) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    name: "",
    provider_type: "openai",
    auth_type: "apikey" as const,
    base_url: "https://api.openai.com",
    api_key: "",
    priority: 0,
  });
  const [addError, setAddError] = useState("");

  const providerTypes = [
    {
      value: "openai",
      label: "OpenAI",
      baseUrl: "https://api.openai.com",
      models: [
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4-turbo",
        "gpt-3.5-turbo",
        "o1-preview",
        "o1-mini",
        "o3-mini",
      ],
    },
    {
      value: "anthropic",
      label: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      models: [
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
      ],
    },
    {
      value: "gemini",
      label: "Google Gemini",
      baseUrl: "https://generativelanguage.googleapis.com",
      models: [
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
        "gemini-2.0-flash",
      ],
    },
    {
      value: "deepseek",
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      models: ["deepseek-chat", "deepseek-coder", "deepseek-chat-v3"],
    },
    {
      value: "siliconflow",
      label: "SiliconFlow",
      baseUrl: "https://api.siliconflow.cn",
      models: [
        "Qwen/Qwen2.5-7B-Instruct",
        "Qwen/Qwen2.5-14B-Instruct",
        "Qwen/Qwen2.5-72B-Instruct",
        "deepseek-ai/DeepSeek-V2.5",
        "THUDM/glm-4-9b-chat",
        "THUDM/glm-4-plus",
        "01-ai/Yi-1.5-34B-Chat-16K",
        "moonshot/v1-8k",
        "moonshot/v1-32k",
      ],
    },
    {
      value: "glm",
      label: "智谱GLM",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      models: ["glm-4", "glm-4-plus", "glm-4v", "glm-3-turbo"],
    },
    {
      value: "moonshot",
      label: "月之暗面Kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    },
    {
      value: "yi",
      label: "零一万物Yi",
      baseUrl: "https://api.lingyiwanwu.com/v1",
      models: ["yi-large", "yi-medium", "yi-large-rag", "yi-1.5-34b-chat"],
    },
    {
      value: "openrouter",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      models: [
        "openai/gpt-4o",
        "anthropic/claude-3.5-sonnet",
        "google/gemini-2.0-flash-exp",
      ],
    },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    logInfo("Providers", "handleSubmit", { name: formData.name, type: formData.provider_type });

    const now = new Date().toISOString();
    const provider: ProviderConfig = {
      id: Date.now().toString(),
      name: formData.name,
      provider_type: formData.provider_type,
      auth_type: formData.auth_type,
      enabled: true,
      base_url: formData.base_url,
      api_keys:
        formData.auth_type === "apikey"
          ? [
              {
                id: Date.now().toString(),
                key_value: formData.api_key,
                name: "默认密钥",
                is_active: true,
                created_at: now,
                last_used: null,
                usage_count: 0,
              },
            ]
          : [],
      models: [],
      disabled_models: [],
      oauth_config: null,
      rate_limits: null,
      priority: formData.priority,
      created_at: now,
      updated_at: now,
    };

    onAdd(provider);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">添加提供商</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 名称 */}
          <div>
            <label className="block text-sm font-medium mb-1">名称</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="我的OpenAI"
              required
            />
          </div>

          {/* 提供商类型 */}
          <div>
            <label className="block text-sm font-medium mb-1">提供商类型</label>
            <select
              value={formData.provider_type}
              onChange={(e) => {
                const selected = providerTypes.find(
                  (t) => t.value === e.target.value,
                );
                setFormData({
                  ...formData,
                  provider_type: e.target.value,
                  base_url: selected?.baseUrl || formData.base_url,
                });
              }}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {providerTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* 基础URL */}
          <div>
            <label className="block text-sm font-medium mb-1">基础URL</label>
            <input
              type="url"
              value={formData.base_url}
              onChange={(e) =>
                setFormData({ ...formData, base_url: e.target.value })
              }
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          {/* API密钥 */}
          {formData.auth_type === "apikey" && (
            <div>
              <label className="block text-sm font-medium mb-1">API密钥</label>
              <input
                type="password"
                value={formData.api_key}
                onChange={(e) =>
                  setFormData({ ...formData, api_key: e.target.value })
                }
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="sk-..."
                required
              />
            </div>
          )}

          {/* 优先级 */}
          <div>
            <label className="block text-sm font-medium mb-1">优先级</label>
            <input
              type="number"
              value={formData.priority}
              onChange={(e) =>
                setFormData({ ...formData, priority: parseInt(e.target.value) })
              }
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              min="0"
              max="100"
            />
          </div>

          {/* 按钮 */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90"
              disabled={isLoading}
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
              disabled={isLoading}
            >
              {isLoading ? "添加中..." : "添加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// 编辑提供商对话框组件
function EditProviderDialog({
  provider,
  onClose,
  onSave,
  isLoading,
}: {
  provider: ProviderConfig;
  onClose: () => void;
  onSave: (provider: ProviderConfig) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    name: provider.name,
    base_url: provider.base_url,
    auth_type: provider.auth_type || "apikey",
    api_key: provider.api_keys.find((k) => k.is_active)?.key_value || "",
    priority: provider.priority,
    enabled: provider.enabled,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const updated: ProviderConfig = {
      ...provider,
      name: formData.name,
      base_url: formData.base_url,
      auth_type: formData.auth_type,
      enabled: formData.enabled,
      priority: formData.priority,
      updated_at: new Date().toISOString(),
      api_keys:
        formData.auth_type === "apikey" &&
        formData.api_key !==
          (provider.api_keys.find((k) => k.is_active)?.key_value || "")
          ? [
              {
                id: provider.api_keys[0]?.id || Date.now().toString(),
                key_value: formData.api_key,
                name: "默认密钥",
                is_active: true,
                created_at:
                  provider.api_keys[0]?.created_at || new Date().toISOString(),
                last_used: null,
                usage_count: 0,
              },
            ]
          : formData.auth_type === "apikey"
            ? provider.api_keys
            : [],
      oauth_config: null,
    };

    onSave(updated);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">编辑提供商</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">名称</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">基础URL</label>
            <input
              type="url"
              value={formData.base_url}
              onChange={(e) =>
                setFormData({ ...formData, base_url: e.target.value })
              }
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          {/* API密钥 */}
          <div>
            <label className="block text-sm font-medium mb-1">API密钥</label>
            <input
              type="password"
              value={formData.api_key}
              onChange={(e) =>
                setFormData({ ...formData, api_key: e.target.value })
              }
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="留空保持不变"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">启用状态</label>
            <button
              type="button"
              onClick={() =>
                setFormData({ ...formData, enabled: !formData.enabled })
              }
              className={`relative w-12 h-6 rounded-full transition-colors ${formData.enabled ? "bg-green-500" : "bg-gray-500"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${formData.enabled ? "translate-x-6" : ""}`}
              />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">优先级</label>
            <input
              type="number"
              value={formData.priority}
              onChange={(e) =>
                setFormData({ ...formData, priority: parseInt(e.target.value) })
              }
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              min="0"
              max="100"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90"
              disabled={isLoading}
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
              disabled={isLoading}
            >
              {isLoading ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
