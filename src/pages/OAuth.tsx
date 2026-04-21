import { useQuery, useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import { Shield, Key, ExternalLink, Check, AlertCircle } from "lucide-react";

interface OAuthConfig {
  provider_type: string;
  client_id?: string;
  redirect_uri?: string;
  tokens?: {
    access_token: string;
    expires_at: string;
  };
}

interface ProviderConfig {
  id: string;
  name: string;
  provider_type: string;
  enabled: boolean;
  base_url: string;
  api_keys: Array<{
    id: string;
    name: string;
    is_active: boolean;
  }>;
  models: string[];
  priority: number;
  oauth_config?: OAuthConfig;
}

interface OAuthState {
  state_id: string;
  provider_type: string;
  auth_url: string;
  redirect_uri: string;
  code_verifier?: string;
  created_at: string;
}

export default function OAuth() {
  const { data: providers } = useQuery<ProviderConfig[]>({
    queryKey: ["providers"],
    queryFn: () => invoke<ProviderConfig[]>("get_providers"),
  });

  const oauthProviders = [
    {
      id: "gemini-cli",
      name: "Google Gemini CLI",
      description: "Google官方Gemini API访问",
      icon: "🔷",
      type: "GeminiCli" as const,
      requires_client_id: true,
    },
    {
      id: "antigravity",
      name: "Antigravity",
      description: "Google内部Gemini 3和Claude访问",
      icon: "⚡",
      type: "Antigravity" as const,
      requires_client_id: true,
    },
    {
      id: "qwen-code",
      name: "Qwen Code",
      description: "通义千问代码模型",
      icon: "🔶",
      type: "QwenCode" as const,
      requires_client_id: false,
    },
    {
      id: "iflow",
      name: "iFlow",
      description: "iFlow AI服务",
      icon: "🌊",
      type: "IFlow" as const,
      requires_client_id: true,
    },
  ];

  const startOAuthMutation = useMutation<
    OAuthState,
    Error,
    { providerType: string; redirectUri: string }
  >({
    mutationFn: ({ providerType, redirectUri }) =>
      invoke<OAuthState>("start_oauth_flow", {
        providerType,
        redirectUri,
      }),
    onSuccess: (result) => {
      window.open(result.auth_url, "_blank");
    },
  });

  const handleStartOAuth = async (provider: (typeof oauthProviders)[0]) => {
    const redirectUri = "http://localhost:8080/oauth/callback";
    await startOAuthMutation.mutateAsync({
      providerType: provider.type,
      redirectUri: redirectUri,
    });
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-3xl font-bold">OAuth认证管理</h1>
        <p className="text-muted-foreground mt-2">
          配置OAuth认证以访问需要授权的AI服务
        </p>
      </div>

      {/* OAuth提供商列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {oauthProviders.map((provider) => {
          const hasToken = providers?.some(
            (p) => p.oauth_config?.provider_type === provider.type,
          );

          return (
            <div
              key={provider.id}
              className="bg-card rounded-lg p-6 border border-border hover:shadow-lg transition-all"
            >
              {/* 提供商信息 */}
              <div className="flex items-start gap-4 mb-4">
                <div className="text-4xl">{provider.icon}</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{provider.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {provider.description}
                  </p>
                </div>
                {hasToken ? (
                  <div className="flex items-center gap-1 text-green-500">
                    <Check size={20} />
                    <span className="text-sm">已认证</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <AlertCircle size={20} />
                    <span className="text-sm">未认证</span>
                  </div>
                )}
              </div>

              {/* OAuth详情 */}
              <div className="space-y-2 mb-4">
                {provider.requires_client_id && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">需要配置:</span>
                    <span className="ml-2">Client ID</span>
                  </div>
                )}
                <div className="text-sm">
                  <span className="text-muted-foreground">认证方式:</span>
                  <span className="ml-2">OAuth 2.0</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">回调地址:</span>
                  <span className="ml-2 font-mono text-xs">
                    http://localhost:8080/oauth/callback
                  </span>
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-2">
                {hasToken ? (
                  <>
                    <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors">
                      <Key size={16} />
                      <span>管理Token</span>
                    </button>
                    <button className="px-4 py-2 bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 transition-colors">
                      移除
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleStartOAuth(provider)}
                    disabled={startOAuthMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    <ExternalLink size={16} />
                    <span>
                      {startOAuthMutation.isPending ? "启动中..." : "开始认证"}
                    </span>
                  </button>
                )}
              </div>

              {/* 错误状态 */}
              {startOAuthMutation.error && (
                <div className="mt-4 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={16} />
                    <span>OAuth流程启动失败</span>
                  </div>
                  <p className="text-xs mt-1">
                    {startOAuthMutation.error.message}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* OAuth说明 */}
      <div className="bg-card rounded-lg p-6 border border-border">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Shield size={20} />
          OAuth认证说明
        </h3>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            OAuth认证允许ClamAI访问需要授权的AI服务提供商，而无需你手动提供API密钥。
          </p>
          <ol className="list-decimal list-inside space-y-2">
            <li>点击提供商的"开始认证"按钮</li>
            <li>在浏览器中完成授权流程</li>
            <li>授权成功后，ClamAI会自动保存访问令牌</li>
            <li>令牌会定期自动刷新，保持访问权限</li>
          </ol>
          <div className="mt-4 p-3 bg-secondary rounded-lg">
            <p className="text-xs">
              <strong>注意:</strong> 确保你的回调地址{" "}
              <code>http://localhost:8080/oauth/callback</code> 能够正常访问。
              某些提供商可能需要额外的配置步骤。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
