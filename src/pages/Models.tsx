import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Layers,
  ArrowRight,
  Star,
  Zap,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { logInfo, logError } from "../utils/log";

interface ModelMapping {
  alias: string;
  provider_id: string;
  model: string;
  description?: string;
}

interface ProviderConfig {
  id: string;
  name: string;
  provider_type: string;
  enabled: boolean;
  models: string[];
  disabled_models: string[];
}

export default function Models() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});

  const { data: providers, isLoading } = useQuery({
    queryKey: ["providers"],
    queryFn: () => invoke<ProviderConfig[]>("get_providers"),
  });

  const { data: mappings } = useQuery({
    queryKey: ["model-mappings"],
    queryFn: () => invoke<ModelMapping[]>("get_mappings"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({
      providerId,
      modelName,
      enabled,
    }: {
      providerId: string;
      modelName: string;
      enabled: boolean;
    }) => {
      logInfo("Models", "toggle_model", { providerId, modelName, enabled });
      return invoke("toggle_model", { providerId, modelName, enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (error) => { logError("Models", "toggle_model failed", error); },
  });

  const fetchModelsMutation = useMutation({
    mutationFn: (providerId: string) => {
      logInfo("Models", "fetch_provider_models", { providerId });
      return invoke<string[]>("fetch_provider_models", { providerId });
    },
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      setFetchErrors((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
    },
    onError: (error: Error, providerId: string) => {
      logError("Models", "fetch_provider_models failed", error);
      setFetchErrors((prev) => ({ ...prev, [providerId]: error.message }));
    },
  });

  const refreshAllMutation = useMutation({
    mutationFn: async () => {
      logInfo("Models", "refresh_all_models");
      if (!providers) return;
      for (const p of providers) {
        if (p.enabled) {
          try {
            await invoke<string[]>("fetch_provider_models", {
              providerId: p.id,
            });
          } catch (e) {
            console.warn(`刷新 ${p.name} 失败:`, e);
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (error) => { logError("Models", "refresh_all_models failed", error); },
  });

  const allModels =
    providers?.flatMap((provider) => {
      const models = provider.models || [];
      const disabledModels = provider.disabled_models || [];
      return models.map((model) => ({
        id: `${provider.id}/${model}`,
        name: model,
        provider: provider.name,
        providerId: provider.id,
        enabled: !disabledModels.includes(model),
      }));
    }) || [];

  const enabledCount = allModels.filter((m) => m.enabled).length;

  const filteredModels = allModels.filter(
    (model) =>
      model.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      model.provider.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">模型管理</h1>
          <p className="text-muted-foreground mt-2">
            从提供商API获取模型列表，控制模型开关
          </p>
        </div>
        <button
          onClick={() => refreshAllMutation.mutate()}
          disabled={refreshAllMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            size={18}
            className={refreshAllMutation.isPending ? "animate-spin" : ""}
          />
          <span>
            {refreshAllMutation.isPending ? "刷新中..." : "刷新全部模型"}
          </span>
        </button>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">总模型数</p>
              <p className="text-2xl font-bold">{allModels.length}</p>
            </div>
            <Layers className="text-primary" size={24} />
          </div>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">已启用</p>
              <p className="text-2xl font-bold text-green-500">
                {enabledCount}
              </p>
            </div>
            <Zap className="text-green-500" size={24} />
          </div>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">提供商数</p>
              <p className="text-2xl font-bold">{providers?.length || 0}</p>
            </div>
            <Star className="text-yellow-500" size={24} />
          </div>
        </div>
      </div>

      {/* 搜索 */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索模型..."
          className="w-full px-4 py-2 pl-10 bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* 模型列表 */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">加载中...</div>
      ) : (
        <>
          {providers && providers.length > 0 ? (
            <>
              {searchTerm ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    找到 {filteredModels.length} 个匹配的模型
                  </p>
                  {filteredModels.map((model) => (
                    <div
                      key={model.id}
                      className={`bg-card rounded-lg p-4 border ${
                        model.enabled
                          ? "border-border hover:border-primary"
                          : "border-border/50 opacity-60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4
                            className={`font-medium ${model.enabled ? "" : "line-through text-muted-foreground"}`}
                          >
                            {model.name}
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            提供商: {model.provider}
                          </p>
                        </div>
                        <button
                          onClick={() =>
                            toggleMutation.mutate({
                              providerId: model.providerId,
                              modelName: model.name,
                              enabled: !model.enabled,
                            })
                          }
                          className={`relative w-10 h-5 rounded-full transition-colors ${
                            model.enabled ? "bg-green-500" : "bg-gray-600"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                              model.enabled ? "translate-x-5" : ""
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {providers.map((provider) => {
                    const models = provider.models || [];
                    const disabledModels = provider.disabled_models || [];
                    const fetchError = fetchErrors[provider.id];
                    const isFetching =
                      fetchModelsMutation.isPending &&
                      fetchModelsMutation.variables === provider.id;

                    return (
                      <div
                        key={provider.id}
                        className="bg-card rounded-lg p-6 border border-border"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <h3 className="text-lg font-semibold">
                              {provider.name}
                            </h3>
                            <span
                              className={`text-xs px-2 py-0.5 rounded ${provider.enabled ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500"}`}
                            >
                              {provider.enabled ? "已启用" : "已禁用"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ({models.length} 个模型,{" "}
                              {models.length - disabledModels.length} 已启用)
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() =>
                                fetchModelsMutation.mutate(provider.id)
                              }
                              disabled={isFetching}
                              className="flex items-center gap-1 px-3 py-1 text-xs bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 disabled:opacity-50"
                              title="从提供商API重新获取模型列表"
                            >
                              <RefreshCw
                                size={14}
                                className={isFetching ? "animate-spin" : ""}
                              />
                              {isFetching ? "获取中..." : "刷新模型"}
                            </button>
                            {models.length > 0 && (
                              <button
                                onClick={() => {
                                  const allDisabled =
                                    disabledModels.length === models.length;
                                  models.forEach((model) => {
                                    toggleMutation.mutate({
                                      providerId: provider.id,
                                      modelName: model,
                                      enabled: allDisabled,
                                    });
                                  });
                                }}
                                className="px-3 py-1 text-xs bg-secondary text-secondary-foreground rounded hover:bg-secondary/80"
                              >
                                {disabledModels.length === models.length
                                  ? "全部启用"
                                  : "全部禁用"}
                              </button>
                            )}
                          </div>
                        </div>

                        {fetchError && (
                          <div className="flex items-center gap-2 mb-3 p-2 bg-red-500/10 text-red-400 rounded text-xs">
                            <AlertCircle size={14} />
                            <span>{fetchError}</span>
                          </div>
                        )}

                        {models.length === 0 ? (
                          <div className="text-center py-6 text-muted-foreground">
                            <p className="mb-2">尚未获取模型列表</p>
                            <button
                              onClick={() =>
                                fetchModelsMutation.mutate(provider.id)
                              }
                              disabled={isFetching}
                              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                            >
                              {isFetching ? "获取中..." : "点击获取模型列表"}
                            </button>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {models.map((model) => {
                              const isEnabled = !disabledModels.includes(model);
                              const mapping = mappings?.find(
                                (m) =>
                                  m.provider_id === provider.id &&
                                  m.model === model,
                              );

                              return (
                                <div
                                  key={`${provider.id}/${model}`}
                                  className={`bg-background rounded-lg p-4 border transition-colors ${
                                    isEnabled
                                      ? "border-border hover:border-primary"
                                      : "border-border/50 opacity-60"
                                  }`}
                                >
                                  <div className="flex items-start justify-between mb-2">
                                    <div className="flex-1 min-w-0">
                                      <h4
                                        className={`font-medium text-sm truncate ${isEnabled ? "" : "line-through text-muted-foreground"}`}
                                      >
                                        {model}
                                      </h4>
                                      {mapping?.alias && (
                                        <div className="flex items-center gap-1 mt-1">
                                          <Star
                                            size={12}
                                            className="text-yellow-500"
                                          />
                                          <span className="text-xs text-muted-foreground">
                                            别名: {mapping.alias}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      onClick={() =>
                                        toggleMutation.mutate({
                                          providerId: provider.id,
                                          modelName: model,
                                          enabled: !isEnabled,
                                        })
                                      }
                                      className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ml-2 ${
                                        isEnabled
                                          ? "bg-green-500"
                                          : "bg-gray-600"
                                      }`}
                                      title={
                                        isEnabled
                                          ? "点击禁用此模型"
                                          : "点击启用此模型"
                                      }
                                    >
                                      <span
                                        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                                          isEnabled ? "translate-x-5" : ""
                                        }`}
                                      />
                                    </button>
                                  </div>

                                  <div className="text-xs text-muted-foreground font-mono mt-2">
                                    {provider.id}/{model}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12">
              <Layers className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">暂无可用模型</h3>
              <p className="text-muted-foreground">
                请先在"提供商"页面添加并配置API Key
              </p>
            </div>
          )}
        </>
      )}

      {/* 模型映射 */}
      {mappings && mappings.length > 0 && (
        <div className="bg-card rounded-lg p-6 border border-border">
          <h3 className="font-semibold mb-4">当前模型映射</h3>
          <div className="space-y-2">
            {mappings.map((mapping) => (
              <div
                key={mapping.alias}
                className="flex items-center justify-between p-3 bg-background rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="font-mono text-sm font-medium">
                    {mapping.alias}
                  </div>
                  <ArrowRight size={16} className="text-muted-foreground" />
                  <div className="text-sm text-muted-foreground">
                    {mapping.model}
                  </div>
                </div>
                <button className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
