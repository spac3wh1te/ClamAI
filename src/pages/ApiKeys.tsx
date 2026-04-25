import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  Shield,
  Send,
  Loader2,
  CheckCircle,
  XCircle,
  Settings,
} from "lucide-react";
import { useApiKeySecrets } from "../context/ApiKeySecretsContext";

interface ApiKey {
  id: string;
  name: string;
  key: string;
  created_at: string;
  active: boolean;
  request_count: number;
  last_used: string | null;
  allowed_models: string[];
}

interface ProviderConfig {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  enabled: boolean;
  disabled_models?: string[];
  api_keys: Array<{ id: string; key_value: string; is_active: boolean }>;
  models: string[];
}

interface TestResultData {
  success: boolean;
  message: string;
  response?: any;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
}

function formatTestResult(data: TestResultData): {
  success: boolean;
  message: string;
} {
  const lines: string[] = [];

  if (data.success) {
    lines.push(data.message);
    const msg = data.response?.choices?.[0]?.message;
    const content =
      msg?.content ||
      msg?.reasoning_content ||
      data.response?.content?.[0]?.text ||
      data.response?.choices?.[0]?.text ||
      data.response?.output?.text ||
      "";
    if (content) {
      lines.push("");
      lines.push(typeof content === "string" ? content : JSON.stringify(content, null, 2));
    } else if (data.response && typeof data.response === "object") {
      const respKeys = Object.keys(data.response);
      if (respKeys.length === 0 || (respKeys.length === 1 && respKeys[0] === "id")) {
        lines.push("");
        lines.push("(模型返回了空响应)");
      } else {
        const dump = data.response?.choices?.[0] || data.response;
        lines.push("");
        lines.push(JSON.stringify(dump, null, 2));
      }
    }
    if (data.input_tokens > 0 || data.output_tokens > 0) {
      lines.push("");
      lines.push(
        `Token统计: 输入 ${data.input_tokens} / 输出 ${data.output_tokens}`,
      );
    }
    if (data.latency_ms > 0) {
      lines.push(`延迟: ${data.latency_ms}ms`);
    }
  } else {
    lines.push(data.message);
    if (data.latency_ms > 0) {
      lines.push(`延迟: ${data.latency_ms}ms`);
    }
  }

  return { success: data.success, message: lines.join("\n") };
}

export default function ApiKeys() {
  const queryClient = useQueryClient();
  const {
    secrets: apiKeySecrets,
    revealKey,
    setSecret,
    clearSecret,
  } = useApiKeySecrets();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyAllowedModels, setNewKeyAllowedModels] = useState<string[]>([]);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editingAllowedModels, setEditingAllowedModels] = useState<string[]>(
    [],
  );

  // 测试相关
  const [testMode, setTestMode] = useState<"direct" | "proxy">("direct");
  const [testProxyKey, setTestProxyKey] = useState("");
  const [testProviderId, setTestProviderId] = useState("");
  const [testModel, setTestModel] = useState("");
  const [testMessage, setTestMessage] =
    useState("你好，请用一句话介绍你自己。");
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latency_ms?: number;
    input_tokens?: number;
    output_tokens?: number;
  } | null>(null);

  const { data: proxyModels, isLoading: isProxyModelsLoading } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => invoke<string[]>("get_proxy_models"),
    enabled: testMode === "proxy",
    refetchInterval: 10000,
  });

  const { data: keysData, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const data = await invoke("list_api_keys");
      return data as { keys: ApiKey[] };
    },
    refetchInterval: 5000,
  });

  const { data: providers } = useQuery({
    queryKey: ["providers"],
    queryFn: () => invoke<ProviderConfig[]>("get_providers"),
  });

  const keys = keysData?.keys || [];

  const editingKeyIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (editingKeyId && editingKeyId !== editingKeyIdRef.current) {
      const key = keys.find((k) => k.id === editingKeyId);
      if (key) {
        setEditingAllowedModels([...(key.allowed_models || [])]);
        editingKeyIdRef.current = editingKeyId;
      }
    }
    if (!editingKeyId) {
      editingKeyIdRef.current = null;
    }
  }, [editingKeyId, keys]);

  const allAvailableModels =
    providers?.flatMap((provider) => {
      const disabled = provider.disabled_models || [];
      const providerType = provider.provider_type.toLowerCase();
      return (provider.models || [])
        .filter((model) => !disabled.includes(model))
        .map((model) => ({
          id: `${providerType}:${model}`,
          name: model,
          provider: provider.name,
          providerId: provider.id,
        }));
    }) || [];

  const createMutation = useMutation({
    mutationFn: ({
      name,
      allowedModels,
    }: {
      name: string;
      allowedModels: string[];
    }) => invoke("create_api_key", { name, allowedModels }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      setCreatedKey(data.key);
      setSecret(data.id, data.key);
      setNewKeyName("");
      setNewKeyAllowedModels([]);
      setShowCreate(false);
    },
    onError: (err: any) => {
      alert("创建密钥失败: " + String(err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      allowedModels,
    }: {
      id: string;
      allowedModels: string[];
    }) => invoke("update_api_key", { id, allowedModels }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      setEditingKeyId(null);
      setEditingAllowedModels([]);
    },
    onError: (err: any) => {
      alert("更新密钥失败: " + String(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => invoke("delete_api_key", { id }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      clearSecret(id);
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (testMode === "direct") {
        const provider = providers?.find((p) => p.id === testProviderId);
        if (!provider) throw new Error("请选择提供商");
        const apiKey =
          provider.api_keys.find((k) => k.is_active)?.key_value || "";
        if (!apiKey) throw new Error("该提供商没有配置API Key");
        if (!testModel) throw new Error("请选择模型");

        const result = await invoke("test_chat_request", {
          testMode: "direct",
          providerId: testProviderId,
          baseUrl: provider.base_url,
          apiKey: apiKey,
          model: testModel,
          message: testMessage,
          providerType: provider.provider_type,
        });
        return result as TestResultData;
      } else {
        if (!testProxyKey) throw new Error("请选择ClamAI API密钥");
        if (!testModel) throw new Error("请选择模型");

        const selectedKey = keys.find((k) => k.id === testProxyKey);
        let realApiKey = testProxyKey;

        if (selectedKey && apiKeySecrets[selectedKey.id]) {
          realApiKey = apiKeySecrets[selectedKey.id];
        } else if (selectedKey) {
          try {
            const revealedKey = await invoke<{ id: string; key: string }>(
              "get_api_key",
              { id: selectedKey.id },
            );
            realApiKey = revealedKey.key;
            setSecret(revealedKey.id, revealedKey.key);
          } catch (e) {
            console.warn("无法获取真实密钥，使用屏蔽版本:", e);
          }
        }

        const provider = providers?.find((p) => p.id === testProviderId);
        const providerType = provider?.provider_type || "custom";

        const result = await invoke("test_chat_request", {
          testMode: "proxy",
          providerId: testProviderId,
          baseUrl: "",
          apiKey: realApiKey,
          model: testModel,
          message: testMessage,
          providerType: providerType,
        });
        return result as TestResultData;
      }
    },
    onSuccess: (data) => {
      setTestResult(formatTestResult(data));
    },
    onError: (err: any) => {
      setTestResult({ success: false, message: String(err) });
    },
  });

  const toggleReveal = async (id: string) => {
    if (revealedKeys.has(id)) {
      setRevealedKeys((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      if (!apiKeySecrets[id]) {
        try {
          const revealedKey = await invoke<{ id: string; key: string }>(
            "get_api_key",
            { id },
          );
          setSecret(revealedKey.id, revealedKey.key);
        } catch (e) {
          console.warn("无法获取密钥:", e);
          return;
        }
      }
      setRevealedKeys((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return "****";
    return key.slice(0, 4) + "..." + key.slice(-4);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const selectedProvider = providers?.find((p) => p.id === testProviderId);
  const directModels = selectedProvider?.models || [];

  const selectedApiKey = keys.find((k) => k.id === testProxyKey);
  const allowedModelsForKey = selectedApiKey?.allowed_models || [];

  const proxyModelsList = (proxyModels || []).filter((model) => {
    if (allowedModelsForKey.length === 0) return true;
    return allowedModelsForKey.includes(model);
  });
  console.log(
    "[DIAG-MODELS] proxyModels raw:",
    proxyModels?.length,
    proxyModels?.slice(0, 5),
  );
  console.log(
    "[DIAG-MODELS] testProxyKey:",
    testProxyKey,
    "selectedApiKey:",
    selectedApiKey?.id,
    "allowedModelsForKey:",
    allowedModelsForKey,
  );
  console.log(
    "[DIAG-MODELS] proxyModelsList after filter:",
    proxyModelsList.length,
    proxyModelsList.slice(0, 5),
  );

  const editingModelsList = (() => {
    const allowedSet = new Set(editingAllowedModels);
    return allAvailableModels.map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      isSelected: allowedSet.has(model.id),
    }));
  })();

  const isModelDisabled = (modelName: string, providerId?: string) => {
    let actualModel = modelName;
    let providerType: string | undefined;
    if (!providerId) {
      if (modelName.includes(":")) {
        const parts = modelName.split(":");
        if (parts.length === 2) {
          providerType = parts[0];
          actualModel = parts[1];
        }
      }
    }
    const provider = providers?.find(
      (p) =>
        p.id === (providerId || testProviderId) ||
        p.provider_type === providerType,
    );
    if (!provider) return false;
    return provider.disabled_models?.includes(actualModel) || false;
  };

  const modelOptions = testMode === "direct" ? directModels : proxyModelsList;
  const enabledModelOptions = modelOptions.filter((m) => !isModelDisabled(m));

  const canTestDirect = testMode === "direct" && testProviderId && testModel;
  const canTestProxy = testMode === "proxy" && testProxyKey && testModel;
  const canTest = canTestDirect || canTestProxy;

  const detectModelType = (modelName: string) => {
    let actualModel = modelName;
    if (modelName.includes(":")) {
      const parts = modelName.split(":");
      actualModel = parts[1] || modelName;
    } else if (modelName.includes("/")) {
      const parts = modelName.split("/");
      actualModel = parts[parts.length - 1];
    }
    const lower = actualModel.toLowerCase();
    if (
      lower.includes("vision") ||
      lower.includes("vl-") ||
      lower.includes("gpt-4v") ||
      lower.includes("claude-3-opus") ||
      lower.includes("claude-3-sonnet") ||
      lower.includes("gemini-1.5-pro") ||
      lower.includes("doubao-v")
    ) {
      return { type: "多模态", color: "text-purple-400" };
    }
    if (
      lower.includes("o1") ||
      lower.includes("o3") ||
      lower.includes("o4") ||
      lower.includes("reasoning") ||
      lower.includes("deepseek-r1") ||
      lower.includes("qwq")
    ) {
      return { type: "推理", color: "text-blue-400" };
    }
    if (lower.includes("embedding") || lower.includes("embed")) {
      return { type: "Embedding", color: "text-orange-400" };
    }
    return { type: "对话", color: "text-green-400" };
  };

  const modelTypeInfo = testModel ? detectModelType(testModel) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">API密钥管理</h1>
          <p className="text-muted-foreground mt-2">
            管理对外API密钥，供外部服务调用网关
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          <Plus size={20} />
          <span>创建密钥</span>
        </button>
      </div>

      {/* 新创建的密钥提示 */}
      {createdKey && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
          <p className="text-sm text-green-500 font-medium mb-2">
            密钥创建成功！请立即复制，此后将无法再次查看完整密钥。
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-background px-3 py-2 rounded text-xs font-mono break-all">
              {createdKey}
            </code>
            <button
              onClick={() => copyToClipboard(createdKey)}
              className="px-3 py-2 bg-green-500 text-white rounded text-xs hover:bg-green-600"
            >
              <Copy size={14} className="inline mr-1" />
              复制
            </button>
            <button
              onClick={() => setCreatedKey(null)}
              className="px-3 py-2 bg-secondary text-secondary-foreground rounded text-xs"
            >
              我已保存
            </button>
          </div>
        </div>
      )}

      {/* 创建对话框 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">创建API密钥</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  密钥名称
                </label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="例如：生产环境、测试环境"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  允许调用的模型（留空则允许所有）
                </label>
                <div className="max-h-40 overflow-y-auto border border-border rounded-lg p-2 space-y-1">
                  {allAvailableModels.map((model) => (
                    <label
                      key={model.id}
                      className="flex items-center gap-2 text-sm hover:bg-secondary rounded px-2 py-1 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={newKeyAllowedModels.includes(model.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewKeyAllowedModels([
                              ...newKeyAllowedModels,
                              model.id,
                            ]);
                          } else {
                            setNewKeyAllowedModels(
                              newKeyAllowedModels.filter((m) => m !== model.id),
                            );
                          }
                        }}
                        className="rounded"
                      />
                      <span>{model.id}</span>
                      <span className="text-muted-foreground text-xs">
                        ({model.provider})
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCreate(false)}
                  className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    createMutation.mutate({
                      name: newKeyName || "默认密钥",
                      allowedModels: newKeyAllowedModels,
                    });
                  }}
                  disabled={createMutation.isPending}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
                >
                  {createMutation.isPending ? "创建中..." : "创建"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 编辑密钥权限对话框 */}
      {editingKeyId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">编辑密钥权限</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  允许调用的模型（留空则允许所有）
                </label>
                <div className="max-h-60 overflow-y-auto border border-border rounded-lg p-2 space-y-1">
                  {editingModelsList.map((model) => (
                    <label
                      key={model.id}
                      className="flex items-center gap-2 text-sm hover:bg-secondary rounded px-2 py-1 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={editingAllowedModels.includes(model.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setEditingAllowedModels([
                              ...editingAllowedModels,
                              model.id,
                            ]);
                          } else {
                            setEditingAllowedModels(
                              editingAllowedModels.filter(
                                (m) => m !== model.id,
                              ),
                            );
                          }
                        }}
                        className="rounded"
                      />
                      <span>{model.id}</span>
                      <span className="text-muted-foreground text-xs">
                        ({model.provider})
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setEditingKeyId(null)}
                  className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    updateMutation.mutate({
                      id: editingKeyId!,
                      allowedModels: editingAllowedModels,
                    });
                  }}
                  disabled={updateMutation.isPending}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
                >
                  {updateMutation.isPending ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 密钥列表 */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">加载中...</div>
      ) : keys.length > 0 ? (
        <div className="space-y-3">
          {keys.map((key) => (
            <div
              key={key.id}
              className="bg-card rounded-lg p-4 border border-border"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <Key size={18} className="text-primary" />
                    <h3 className="font-medium">{key.name}</h3>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${key.active ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500"}`}
                    >
                      {key.active ? "活跃" : "已禁用"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                    <span>
                      创建于 {new Date(key.created_at).toLocaleString("zh-CN")}
                    </span>
                    <span>调用 {key.request_count} 次</span>
                    {key.last_used && (
                      <span>
                        最后使用{" "}
                        {new Date(key.last_used).toLocaleString("zh-CN")}
                      </span>
                    )}
                  </div>
                  {key.allowed_models && key.allowed_models.length > 0 && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <Shield size={14} className="text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        允许模型：
                      </span>
                      {key.allowed_models.slice(0, 5).map((m) => (
                        <span
                          key={m}
                          className="text-xs bg-secondary px-2 py-0.5 rounded"
                        >
                          {m}
                        </span>
                      ))}
                      {key.allowed_models.length > 5 && (
                        <span className="text-xs text-muted-foreground">
                          +{key.allowed_models.length - 5} 更多
                        </span>
                      )}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <code className="text-xs font-mono bg-background px-2 py-1 rounded">
                      {revealedKeys.has(key.id) && apiKeySecrets[key.id]
                        ? apiKeySecrets[key.id]
                        : maskKey(key.key)}
                    </code>
                    <button
                      onClick={() => toggleReveal(key.id)}
                      className="p-1 hover:bg-secondary rounded"
                    >
                      {revealedKeys.has(key.id) ? (
                        <EyeOff size={14} />
                      ) : (
                        <Eye size={14} />
                      )}
                    </button>
                    {revealedKeys.has(key.id) && (
                      <button
                        onClick={() =>
                          copyToClipboard(apiKeySecrets[key.id] || key.key)
                        }
                        className="p-1 hover:bg-secondary rounded"
                      >
                        <Copy size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingKeyId(key.id);
                    }}
                    className="p-2 hover:bg-secondary rounded-lg transition-colors"
                    title="编辑权限"
                  >
                    <Settings size={18} />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("确定要删除此密钥吗？")) deleteMutation.mutate(key.id);
                    }}
                    className="p-2 hover:bg-destructive/10 text-destructive rounded-lg transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <Key className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">暂无API密钥</h3>
          <p className="text-muted-foreground mb-4">
            创建API密钥供外部服务调用网关
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg"
          >
            创建第一个密钥
          </button>
        </div>
      )}

      {/* 模型测试面板 */}
      <div className="bg-card rounded-lg p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Send size={20} className="text-primary" />
            <h2 className="text-xl font-bold">模型调用测试</h2>
          </div>
          <div className="flex bg-secondary rounded-lg p-1">
            <button
              onClick={() => {
                setTestMode("direct");
                setTestModel("");
              }}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${testMode === "direct" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              直接测试
            </button>
            <button
              onClick={() => {
                setTestMode("proxy");
                setTestModel("");
                setTestProviderId("");
              }}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${testMode === "proxy" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              代理测试
            </button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          {testMode === "direct"
            ? "直接调用提供商API，验证API密钥和模型可用性"
            : "通过ClamAI代理网关测试，验证完整代理链路（需要Go代理配置对应提供商的API Key）"}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
          {testMode === "direct" ? (
            <div>
              <label className="block text-sm font-medium mb-1">提供商</label>
              <select
                value={testProviderId}
                onChange={(e) => {
                  setTestProviderId(e.target.value);
                  setTestModel("");
                }}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">选择提供商</option>
                {providers
                  ?.filter(
                    (p) => p.enabled && p.api_keys.some((k) => k.is_active),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.provider_type})
                    </option>
                  ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">
                ClamAI密钥
              </label>
              <select
                value={testProxyKey}
                onChange={(e) => setTestProxyKey(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">选择API密钥</option>
                {keys
                  .filter((k) => k.active)
                  .map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">
              模型
              {testMode === "proxy" && (
                <span className="text-xs text-muted-foreground ml-1">
                  (来自代理网关)
                </span>
              )}
            </label>
            <select
              value={testModel}
              onChange={(e) => setTestModel(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={testMode === "direct" ? !testProviderId : !testProxyKey}
            >
              <option value="">
                {testMode === "direct"
                  ? enabledModelOptions.length > 0
                    ? "选择模型"
                    : "该提供商无已启用模型"
                  : isProxyModelsLoading
                    ? "加载中..."
                    : enabledModelOptions.length > 0
                      ? "选择模型"
                      : "无可用模型"}
              </option>
              {enabledModelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-sm font-medium mb-1">测试消息</label>
            <input
              type="text"
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="输入测试消息"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !canTest}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {testMutation.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  测试中...
                </>
              ) : (
                <>
                  <Send size={16} />
                  {testMode === "direct" ? "直接测试" : "代理测试"}
                </>
              )}
            </button>
          </div>
        </div>

        {testModel && modelTypeInfo && (
          <div className="flex items-center gap-2 mb-4 text-sm">
            <span className="text-muted-foreground">模型类型:</span>
            <span className={`font-medium ${modelTypeInfo.color}`}>
              {modelTypeInfo.type}
            </span>
          </div>
        )}

        {testResult && (
          <div
            className={`rounded-lg p-4 text-sm whitespace-pre-wrap ${testResult.success ? "bg-green-500/10 border border-green-500/30 text-green-400" : "bg-red-500/10 border border-red-500/30 text-red-400"}`}
          >
            {testResult.success ? (
              <CheckCircle size={16} className="inline mr-1" />
            ) : (
              <XCircle size={16} className="inline mr-1" />
            )}
            {testResult.message}
          </div>
        )}

        {testMode === "proxy" &&
          !isProxyModelsLoading &&
          proxyModelsList.length === 0 && (
            <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-400">
              ⚠️
              代理模型列表为空。请确保Go代理服务正在运行，并且已配置环境变量（OPENAI_API_KEY、DEEPSEEK_API_KEY等）。
            </div>
          )}
      </div>
    </div>
  );
}
