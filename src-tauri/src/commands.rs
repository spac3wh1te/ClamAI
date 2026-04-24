use crate::AppState;
use crate::config::ProviderConfig;
use crate::config::DeployMode;
use crate::TokenPair;
use crate::oauth::{OAuthCallback, OAuthState};
use crate::services::ServiceStatus;
use serde::{Deserialize, Serialize};

// ==================== 配置管理命令 ====================

#[tauri::command]
pub async fn get_config(state: tauri::State<'_, AppState>) -> Result<crate::config::AppConfig, String> {
    Ok(state.config_manager.lock().await.get_config())
}

#[tauri::command]
pub async fn save_config(
    state: tauri::State<'_, AppState>,
    config: crate::config::AppConfig,
) -> Result<(), String> {
    let mut manager = state.config_manager.lock().await;
    manager.update_config(config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_config(state: tauri::State<'_, AppState>) -> Result<(), String> {
    {
        let mut service_manager = state.service_manager.lock().await;
        let _ = service_manager.stop_proxy_service().await;
    }

    let default_config = crate::config::AppConfig {
        version: "1.0.0".to_string(),
        providers: std::collections::HashMap::new(),
        mappings: std::collections::HashMap::new(),
        gateway: crate::config::GatewayConfig {
            port: 8080,
            host: "127.0.0.1".to_string(),
            api_key: "".to_string(),
            log_level: "info".to_string(),
        },
        ui: crate::config::UiConfig {
            theme: "dark".to_string(),
            language: "zh-CN".to_string(),
            timezone: "Asia/Shanghai".to_string(),
            auto_start: false,
            minimize_to_tray: true,
            show_notifications: true,
        },
        advanced: crate::config::AdvancedConfig {
            proxy_url: None,
        },
        service: crate::config::ServiceConfig::default(),
        active_profile: "default".to_string(),
        profiles: std::collections::HashMap::new(),
    };

    let mut manager = state.config_manager.lock().await;
    manager.update_config(default_config).await.map_err(|e| e.to_string())
}

// ==================== 配置档案管理命令 ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileInfo {
    pub id: String,
    pub name: String,
    pub active: bool,
}

#[tauri::command]
pub async fn list_profiles(state: tauri::State<'_, AppState>) -> Result<Vec<ProfileInfo>, String> {
    let manager = state.config_manager.lock().await;
    let active = manager.get_active_profile().to_string();
    let profiles = manager.list_profiles();
    Ok(profiles
        .into_iter()
        .map(|(id, name)| ProfileInfo {
            active: id == active,
            id,
            name,
        })
        .collect())
}

#[tauri::command]
pub async fn save_current_as_profile(
    state: tauri::State<'_, AppState>,
    profile_id: String,
    display_name: String,
) -> Result<(), String> {
    let mut manager = state.config_manager.lock().await;
    manager
        .save_current_as_profile(profile_id, display_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_profile(
    state: tauri::State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
    {
        let mut manager = state.config_manager.lock().await;
        manager.load_profile(&profile_id).await.map_err(|e| e.to_string())?;
    }
    sync_all_providers_to_service_inner(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn delete_profile(
    state: tauri::State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
    let mut manager = state.config_manager.lock().await;
    manager.delete_profile(&profile_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_profile(
    state: tauri::State<'_, AppState>,
    profile_id: String,
    new_name: String,
) -> Result<(), String> {
    let mut manager = state.config_manager.lock().await;
    manager.rename_profile(&profile_id, new_name).await.map_err(|e| e.to_string())
}

// ==================== 提供商管理命令 ====================

#[tauri::command]
pub async fn get_providers(state: tauri::State<'_, AppState>) -> Result<Vec<ProviderConfig>, String> {
    let manager = state.config_manager.lock().await;
    Ok(manager.get_providers())
}

#[tauri::command]
pub async fn add_provider(
    state: tauri::State<'_, AppState>,
    provider: ProviderConfig,
) -> Result<(), String> {
    let mut manager = state.config_manager.lock().await;
    manager.add_provider(provider).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_provider(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut manager = state.config_manager.lock().await;
    manager.remove_provider(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_provider(
    state: tauri::State<'_, AppState>,
    provider: ProviderConfig,
) -> Result<(), String> {
    let mut manager = state.config_manager.lock().await;
    manager.update_provider(provider).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_model(
    state: tauri::State<'_, AppState>,
    provider_id: String,
    model_name: String,
    enabled: bool,
) -> Result<(), String> {
    let mut manager = state.config_manager.lock().await;
    let mut provider = manager.get_provider(&provider_id)
        .ok_or_else(|| format!("提供商 {} 不存在", provider_id))?;

    let mut disabled = provider.disabled_models.take().unwrap_or_default();
    if enabled {
        disabled.retain(|m| m != &model_name);
    } else {
        if !disabled.contains(&model_name) {
            disabled.push(model_name);
        }
    }
    provider.disabled_models = Some(disabled);

    manager.update_provider(provider).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_provider(
    state: tauri::State<'_, AppState>,
    provider_id: String,
) -> Result<TestProviderResult, String> {
    let manager = state.config_manager.lock().await;
    let provider = manager.get_provider(&provider_id)
        .ok_or_else(|| format!("提供商 {} 不存在", provider_id))?;

    let api_key = provider.api_keys.iter()
        .find(|k| k.is_active)
        .map(|k| k.key_value.clone())
        .unwrap_or_default();

    if api_key.is_empty() {
        return Ok(TestProviderResult {
            success: false,
            message: "没有可用的API密钥".to_string(),
            latency_ms: 0,
            available_models: vec![],
        });
    }

    let test_url = match provider.provider_type {
        crate::config::ProviderType::OpenAI => format!("{}/v1/models", provider.base_url),
        crate::config::ProviderType::Anthropic => format!("{}/v1/models", provider.base_url),
        crate::config::ProviderType::DeepSeek => format!("{}/v1/models", provider.base_url),
        crate::config::ProviderType::Gemini => format!("{}?key={}", provider.base_url, api_key),
        crate::config::ProviderType::SiliconFlow => format!("{}/v1/models", provider.base_url),
        crate::config::ProviderType::Qwen => format!("{}/models", provider.base_url),
        crate::config::ProviderType::Moonshot => format!("{}/models", provider.base_url),
        crate::config::ProviderType::Yi => format!("{}/models", provider.base_url),
        crate::config::ProviderType::OpenRouter => format!("{}/models", provider.base_url),
        crate::config::ProviderType::Glm => format!("{}/models", provider.base_url),
        crate::config::ProviderType::Doubao => format!("{}/models", provider.base_url),
        crate::config::ProviderType::MiniMax => format!("{}/v1/models", provider.base_url),
        crate::config::ProviderType::Custom => format!("{}/v1/models", provider.base_url),
    };

    let client = https_client()?;
    let start = std::time::Instant::now();

    let mut req = client.get(&test_url)
        .timeout(std::time::Duration::from_secs(15));

    match provider.provider_type {
        crate::config::ProviderType::Anthropic => {
            req = req.header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01");
        }
        crate::config::ProviderType::Gemini => {}
        _ => {
            req = req.header("Authorization", format!("Bearer {}", api_key));
        }
    }

    match send_and_log("GET", &test_url, req).await {
        Ok(resp) => {
            let latency = start.elapsed().as_millis() as u64;
            let status = resp.status();
            if status.is_success() {
                Ok(TestProviderResult {
                    success: true,
                    message: format!("连接成功 (HTTP {})", status.as_u16()),
                    latency_ms: latency,
                    available_models: provider.models.clone(),
                })
            } else {
                let body = resp.text().await.unwrap_or_default();
                Ok(TestProviderResult {
                    success: false,
                    message: format!("认证失败 (HTTP {}): {}", status.as_u16(),
                        if body.len() > 200 { &body[..200] } else { &body }),
                    latency_ms: latency,
                    available_models: vec![],
                })
            }
        }
        Err(e) => {
            let latency = start.elapsed().as_millis() as u64;
            Ok(TestProviderResult {
                success: false,
                message: format!("连接失败: {}", e),
                latency_ms: latency,
                available_models: vec![],
            })
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestProviderResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: u64,
    pub available_models: Vec<String>,
}

#[tauri::command]
pub async fn fetch_provider_models(
    state: tauri::State<'_, AppState>,
    provider_id: String,
) -> Result<Vec<String>, String> {
    let manager = state.config_manager.lock().await;
    let provider = manager.get_provider(&provider_id)
        .ok_or_else(|| format!("提供商 {} 不存在", provider_id))?;

    let api_key = provider.api_keys.iter()
        .find(|k| k.is_active)
        .map(|k| k.key_value.clone())
        .unwrap_or_default();

    if api_key.is_empty() {
        return Err("没有可用的API密钥".to_string());
    }

    let models_url = match provider.provider_type {
        crate::config::ProviderType::OpenAI => format!("{}/v1/models", provider.base_url),
        crate::config::ProviderType::Anthropic => format!("{}/v1/models", provider.base_url),
        crate::config::ProviderType::DeepSeek => format!("{}/v1/models", provider.base_url),
        crate::config::ProviderType::SiliconFlow => format!("{}/v1/models", provider.base_url),
        crate::config::ProviderType::Qwen => format!("{}/models", provider.base_url),
        crate::config::ProviderType::Moonshot => format!("{}/models", provider.base_url),
        crate::config::ProviderType::Yi => format!("{}/models", provider.base_url),
        crate::config::ProviderType::OpenRouter => format!("{}/models", provider.base_url),
        crate::config::ProviderType::Glm => format!("{}/models", provider.base_url),
        crate::config::ProviderType::Doubao => format!("{}/models", provider.base_url),
        crate::config::ProviderType::MiniMax => format!("{}/v1/models", provider.base_url),
        crate::config::ProviderType::Gemini => format!("{}/v1beta/models?key={}", provider.base_url, api_key),
        crate::config::ProviderType::Custom => format!("{}/v1/models", provider.base_url),
    };

    let client = https_client()?;
    let mut req = client.get(&models_url)
        .timeout(std::time::Duration::from_secs(30));

    match provider.provider_type {
        crate::config::ProviderType::Anthropic => {
            req = req.header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01");
        }
        crate::config::ProviderType::Gemini => {}
        _ => {
            req = req.header("Authorization", format!("Bearer {}", api_key));
        }
    }

    let resp = send_and_log("GET", &models_url, req).await.map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("获取模型列表失败 (HTTP {}): {}", status.as_u16(),
            if body.len() > 300 { &body[..300] } else { &body }));
    }

    let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    let models = parse_models_from_response(&body, &provider.provider_type);

    if models.is_empty() {
        return Err(format!("解析模型列表为空，原始响应前200字符: {}", &body[..body.len().min(200)]));
    }

    let mut provider = provider.clone();
    provider.models = models.clone();
    drop(manager);

    let mut mgr = state.config_manager.lock().await;
    mgr.update_provider(provider).await.map_err(|e| e.to_string())?;

    Ok(models)
}

fn parse_models_from_response(body: &str, provider_type: &crate::config::ProviderType) -> Vec<String> {
    let json: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    match provider_type {
        crate::config::ProviderType::Gemini => {
            if let Some(models) = json.get("models").and_then(|m| m.as_array()) {
                return models.iter()
                    .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                    .collect();
            }
            vec![]
        }
        _ => {
            if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
                return data.iter()
                    .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(|s| s.to_string()))
                    .collect();
            }
            vec![]
        }
    }
}

// ==================== OAuth命令 ====================

#[tauri::command]
pub async fn start_oauth_flow(
    state: tauri::State<'_, AppState>,
    provider_type: crate::config::OAuthProviderType,
    redirect_uri: String,
) -> Result<OAuthState, String> {
    let oauth_manager = crate::oauth::OAuthManager::new(state.config_manager.clone());
    oauth_manager.start_oauth_flow(provider_type, redirect_uri).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn complete_oauth_flow(
    state: tauri::State<'_, AppState>,
    callback: OAuthCallback,
) -> Result<crate::config::TokenStorage, String> {
    let oauth_manager = crate::oauth::OAuthManager::new(state.config_manager.clone());
    oauth_manager.complete_oauth_flow(callback).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn refresh_oauth_token(
    state: tauri::State<'_, AppState>,
    token_storage: crate::config::TokenStorage,
) -> Result<crate::config::TokenStorage, String> {
    let oauth_manager = crate::oauth::OAuthManager::new(state.config_manager.clone());
    oauth_manager.refresh_token(&token_storage).await.map_err(|e| e.to_string())
}

// ==================== 代理服务命令 ====================

#[tauri::command]
pub async fn get_proxy_status(state: tauri::State<'_, AppState>) -> Result<ServiceStatus, String> {
    let service_manager = state.service_manager.lock().await;
    Ok(service_manager.get_service_status().await)
}

#[tauri::command]
pub async fn start_proxy_service(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut service_manager = state.service_manager.lock().await;
    service_manager.start_proxy_service().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_proxy_service(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut service_manager = state.service_manager.lock().await;
    service_manager.stop_proxy_service().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restart_proxy_service(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut service_manager = state.service_manager.lock().await;
    service_manager.restart_proxy_service().await.map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyTestResult {
    pub success: bool,
    pub message: String,
    pub initialized: Option<bool>,
}

#[tauri::command]
pub async fn test_proxy_connectivity(
    state: tauri::State<'_, AppState>,
    proxy_url: Option<String>,
) -> Result<ProxyTestResult, String> {
    let (url, auth) = get_proxy_url(&state, "proxy/test").await?;
    let client = https_client()?;
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(15));
    if let Some(ref proxy) = proxy_url {
        req = req.query(&[("url", proxy)]);
    }
    if let Some(key) = &auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let resp = send_and_log("GET", &url, req).await.map_err(|e| format!("请求失败: {}", e))?;
    let result: ProxyTestResult = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
    Ok(result)
}

// ==================== 统计监控命令 ====================

#[tauri::command]
#[allow(unused_variables)]
pub async fn get_usage_stats(
    state: tauri::State<'_, AppState>,
    provider_id: Option<String>,
    period: u32,
) -> Result<UsageStats, String> {
    tracing::info!("====== get_usage_stats called, period={} ======", period);

    let (url, auth) = get_proxy_url(&state, &format!("stats/usage?period={}", period)).await.map_err(|e| {
        tracing::error!("get_usage_stats: get_proxy_url failed: {}", e);
        e
    })?;
    tracing::info!("get_usage_stats: url={}, has_auth={}", url, auth.is_some());

    let client = https_client()?;

    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let resp = send_and_log("GET", &url, req).await.map_err(|e| {
        tracing::error!("get_usage_stats: HTTP request failed: {}", e);
        e
    })?;

    let status = resp.status();
    tracing::info!("get_usage_stats: HTTP status={}", status);

    if status.is_success() {
        let body_text = resp.text().await.map_err(|e| {
            tracing::error!("get_usage_stats: read body failed: {}", e);
            e.to_string()
        })?;
        tracing::info!("get_usage_stats: response body={}", &body_text[..body_text.len().min(500)]);

        let stats: UsageStats = serde_json::from_str(&body_text).map_err(|e| {
            tracing::error!("get_usage_stats: JSON parse failed: {}, body={}", e, &body_text[..body_text.len().min(200)]);
            format!("解析失败: {}", e)
        })?;
        tracing::info!("get_usage_stats: parsed total_requests={}, success_rate={}", stats.total_requests, stats.success_rate);
        Ok(stats)
    } else {
        let body = resp.text().await.unwrap_or_default();
        tracing::error!("get_usage_stats: HTTP error {}: {}", status, body);
        Ok(UsageStats::default())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AlertDailyStat {
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub total: i32,
    #[serde(default)]
    pub input_block: i32,
    #[serde(default)]
    pub output_block: i32,
    #[serde(default)]
    pub keyword: i32,
    #[serde(default)]
    pub semantic: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AlertStats {
    #[serde(default)]
    pub daily: Vec<AlertDailyStat>,
    #[serde(default)]
    pub hourly: Vec<AlertDailyStat>,
    #[serde(default)]
    pub minute: Vec<AlertDailyStat>,
    #[serde(default)]
    pub granularity: String,
}

#[tauri::command]
pub async fn get_alert_stats(
    state: tauri::State<'_, AppState>,
    period: u32,
) -> Result<AlertStats, String> {
    let (url, auth) = get_proxy_url(&state, &format!("stats/alerts?period={}", period)).await.map_err(|e| e.to_string())?;
    let client = https_client()?;
    let mut req = client.get(&url)
        .timeout(std::time::Duration::from_secs(5));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let resp = send_and_log("GET", &url, req).await?;
    if resp.status().is_success() {
        let stats: AlertStats = resp.json().await.map_err(|e| e.to_string())?;
        Ok(stats)
    } else {
        Ok(AlertStats::default())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentSafetyResult {
    pub success: bool,
    pub blocked: bool,
    pub message: String,
    #[serde(default)]
    pub keywords_found: Vec<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub confidence: f64,
}

#[tauri::command]
pub async fn check_content_safety(
    state: tauri::State<'_, AppState>,
    content: String,
) -> Result<ContentSafetyResult, String> {
    let (url, auth) = get_proxy_url(&state, "security/check").await.map_err(|e| e.to_string())?;
    let client = https_client()?;
    let mut req = client.post(&url)
        .timeout(std::time::Duration::from_secs(30))
        .header("Content-Type", "application/json");
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let body = serde_json::json!({ "content": content });
    let resp = send_and_log("POST", &url, req.json(&body)).await?;
    if resp.status().is_success() {
        let result: ContentSafetyResult = resp.json().await.map_err(|e| e.to_string())?;
        Ok(result)
    } else {
        Err(format!("HTTP {}", resp.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageStats {
    #[serde(default)]
    pub total_requests: u64,
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub total_tokens: u64,
    #[serde(default)]
    pub total_cost: f64,
    #[serde(default)]
    pub average_latency_ms: f64,
    #[serde(default)]
    pub success_rate: f64,
    #[serde(default)]
    pub success_requests: u64,
    #[serde(default)]
    pub error_requests: u64,
    #[serde(default)]
    pub by_provider: std::collections::HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub by_model: std::collections::HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub tokens_by_provider: std::collections::HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub daily_breakdown: std::collections::HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub hourly_breakdown: std::collections::HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub minute_breakdown: std::collections::HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub granularity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ProviderStats {
    pub provider_id: String,
    pub requests: u64,
    pub tokens: u64,
    pub cost: f64,
    pub success_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct DailyStats {
    pub date: String,
    pub requests: u64,
    pub tokens: u64,
    pub cost: f64,
}

#[tauri::command]
pub async fn get_request_logs(
    state: tauri::State<'_, AppState>,
    limit: usize,
    _offset: usize,
) -> Result<Vec<RequestLog>, String> {
    let (url, auth) = get_proxy_url(&state, &format!("stats/logs?limit={}", limit)).await?;
    tracing::debug!("get_request_logs: url={}, has_auth={}, limit={}", url, auth.is_some(), limit);
    let client = https_client()?;

    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = &auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let resp = send_and_log("GET", &url, req).await?;
    tracing::debug!("get_request_logs: status={}", resp.status());

    if resp.status().is_success() {
        #[derive(Debug, Deserialize)]
        struct LogsResponse {
            logs: Vec<RequestLog>,
        }
        let body: LogsResponse = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;
        tracing::debug!("get_request_logs: success, got {} logs", body.logs.len());
        Ok(body.logs)
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::warn!("get_request_logs: failed status={}, body={}", status, body);
        Err(format!("获取日志失败: HTTP {} - {}", status, body))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestLog {
    pub id: i64,
    pub timestamp: String,
    pub provider: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub latency_ms: i64,
    pub success: bool,
    pub error_message: Option<String>,
    pub client_ip: String,
    pub api_key_used: String,
    #[serde(default)]
    pub request_content: String,
    #[serde(default)]
    pub response_content: String,
}

#[tauri::command]
pub async fn export_logs(
    state: tauri::State<'_, AppState>,
    format: String,
    _start_date: String,
    _end_date: String,
) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, &format!("stats/logs?limit=10000")).await?;
    let client = https_client()?;
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(30));
    if let Some(key) = &auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (status, body_text) = send_and_log_full("GET", &url, req).await?;
    if status < 200 || status >= 300 {
        return Err(format!("获取日志失败: HTTP {}", status));
    }
    let body: serde_json::Value = serde_json::from_str(&body_text).map_err(|e| format!("解析失败: {}", e))?;
    let logs = body.get("logs").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let output = match format.as_str() {
        "json" => {
            serde_json::to_string_pretty(&logs).unwrap_or_default()
        }
        _ => {
            let mut csv = String::from("timestamp,provider,model,input_tokens,output_tokens,latency_ms,success,error_message,client_ip\n");
            for log in &logs {
                csv.push_str(&format!(
                    "{},{},{},{},{},{},{},{},{}\n",
                    log.get("timestamp").and_then(|v| v.as_str()).unwrap_or(""),
                    log.get("provider").and_then(|v| v.as_str()).unwrap_or(""),
                    log.get("model").and_then(|v| v.as_str()).unwrap_or(""),
                    log.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0),
                    log.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0),
                    log.get("latency_ms").and_then(|v| v.as_i64()).unwrap_or(0),
                    log.get("success").and_then(|v| v.as_bool()).unwrap_or(false),
                    log.get("error_message").and_then(|v| v.as_str()).unwrap_or("").replace(',', " "),
                    log.get("client_ip").and_then(|v| v.as_str()).unwrap_or(""),
                ));
            }
            csv
        }
    };

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe_path.parent().ok_or("无法获取程序目录")?;
    let filename = format!("logs_export_{}.{}", chrono::Utc::now().format("%Y%m%d_%H%M%S"), format);
    let file_path = dir.join(&filename);
    std::fs::write(&file_path, &output).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

// ==================== API Key管理命令 ====================

#[allow(dead_code)]
async fn get_proxy_port(state: &tauri::State<'_, AppState>) -> u16 {
    state.service_manager.lock().await.get_port()
}

async fn get_service_base_url(state: &tauri::State<'_, AppState>) -> String {
    state.service_manager.lock().await.get_service_url()
}

async fn ensure_server_token(state: &tauri::State<'_, AppState>) -> Result<(), String> {
    let config = state.config_manager.lock().await.get_config();
    if config.service.deploy_mode != DeployMode::Server {
        return Ok(());
    }
    drop(config);

    let needs_refresh = {
        let store = state.token_store.lock().await;
        match &store.tokens {
            None => true,
            Some(pair) => chrono::Utc::now() > pair.expires_at - chrono::Duration::minutes(5),
        }
    };

    if !needs_refresh {
        return Ok(());
    }

    let refresh_token = {
        let store = state.token_store.lock().await;
        store.tokens.as_ref()
            .map(|t| t.refresh_token.clone())
            .ok_or("No refresh token available, please reconnect")?
    };

    let base_url = get_service_base_url(state).await;
    let url = format!("{}/api/v1/auth/refresh", base_url.trim_end_matches('/'));
    let client = https_client_for_url(&base_url)?;

    let resp = send_and_log("POST", &url, client.post(&url)
        .json(&serde_json::json!({ "refresh_token": refresh_token }))
        .timeout(std::time::Duration::from_secs(10)))
        .await
        .map_err(|e| format!("Refresh failed: {}", e))?;

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if body["success"].as_bool() == Some(true) {
        let mut store = state.token_store.lock().await;
        store.tokens = Some(TokenPair {
            access_token: body["access_token"].as_str().unwrap_or("").to_string(),
            refresh_token: body["refresh_token"].as_str().unwrap_or("").to_string(),
            expires_at: chrono::Utc::now() + chrono::Duration::seconds(body["expires_in"].as_i64().unwrap_or(7200)),
        });
        tracing::debug!("Server token refreshed successfully");
        Ok(())
    } else {
        let mut store = state.token_store.lock().await;
        store.tokens = None;
        Err("Session expired, please reconnect".to_string())
    }
}

async fn get_server_access_token(state: &tauri::State<'_, AppState>) -> Option<String> {
    let store = state.token_store.lock().await;
    store.tokens.as_ref().map(|t| t.access_token.clone())
}

async fn get_proxy_url(state: &tauri::State<'_, AppState>, path: &str) -> Result<(String, Option<String>), String> {
    let base_url = get_service_base_url(state).await;
    let config = state.config_manager.lock().await.get_config();
    let url = format!("{}/api/v1/{}", base_url.trim_end_matches('/'), path);
    let auth = match config.service.deploy_mode {
        DeployMode::Server => {
            ensure_server_token(state).await.map_err(|e| format!("AUTH_EXPIRED: {}", e))?;
            get_server_access_token(state).await
        }
        DeployMode::PC => None,
    };
    Ok((url, auth))
}

async fn get_proxy_url_no_prefix(state: &tauri::State<'_, AppState>, path: &str) -> Result<(String, Option<String>), String> {
    let base_url = get_service_base_url(state).await;
    let config = state.config_manager.lock().await.get_config();
    let url = format!("{}/{}", base_url.trim_end_matches('/'), path);
    let auth = match config.service.deploy_mode {
        DeployMode::Server => {
            ensure_server_token(state).await.map_err(|e| format!("AUTH_EXPIRED: {}", e))?;
            get_server_access_token(state).await
        }
        DeployMode::PC => None,
    };
    Ok((url, auth))
}

fn log_http_response(method: &str, url: &str, status: u16, body: &str) {
    let truncated = if body.len() > 50000 { &body[..50000] } else { body };
    tracing::info!("[HTTP] <-- {} {} {} body={}", method, url, status, truncated);
}

async fn send_and_log(method: &str, url: &str, req: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    tracing::info!("[HTTP] --> {} {}", method, url);
    let resp = req.send().await.map_err(|e| {
        tracing::warn!("[HTTP] <-- {} {} ERROR: {}", method, url, e);
        e.to_string()
    })?;
    let status = resp.status().as_u16();
    tracing::info!("[HTTP] <-- {} {} {}", method, url, status);
    Ok(resp)
}

async fn send_and_log_full(method: &str, url: &str, req: reqwest::RequestBuilder) -> Result<(u16, String), String> {
    tracing::info!("[HTTP] --> {} {}", method, url);
    let resp = req.send().await.map_err(|e| {
        tracing::warn!("[HTTP] <-- {} {} ERROR: {}", method, url, e);
        e.to_string()
    })?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    log_http_response(method, url, status, &body);
    Ok((status, body))
}

fn https_client() -> Result<reqwest::Client, String> {
    let exe_path = std::env::current_exe().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let cert_path = exe_path.parent().unwrap_or(std::path::Path::new(".")).join("clamai-cert.pem");

    let client = if cert_path.exists() {
        let cert_pem = std::fs::read(&cert_path).map_err(|e| format!("Read cert failed: {}", e))?;
        let cert = reqwest::Certificate::from_pem(&cert_pem).map_err(|e| format!("Parse cert failed: {}", e))?;
        reqwest::Client::builder()
            .add_root_certificate(cert)
            .danger_accept_invalid_certs(true)
            .build()
            .map_err(|e| format!("Build HTTPS client failed: {}", e))?
    } else {
        reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .map_err(|e| format!("Build HTTP client failed: {}", e))?
    };
    Ok(client)
}

pub(crate) fn https_client_for_url(remote_url: &str) -> Result<reqwest::Client, String> {
    let exe_path = std::env::current_exe().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let local_cert_path = exe_path.parent().unwrap_or(std::path::Path::new(".")).join("clamai-cert.pem");

    if remote_url.starts_with("https://127.0.0.1") || remote_url.starts_with("https://localhost") {
        if local_cert_path.exists() {
            let cert_pem = std::fs::read(&local_cert_path).map_err(|e| format!("Read cert failed: {}", e))?;
            let cert = reqwest::Certificate::from_pem(&cert_pem).map_err(|e| format!("Parse cert failed: {}", e))?;
            return Ok(reqwest::Client::builder()
                .add_root_certificate(cert)
                .danger_accept_invalid_certs(true)
                .build()
                .map_err(|e| format!("Build HTTPS client failed: {}", e))?);
        }
    }

    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Build HTTP client failed: {}", e))
}

async fn sync_provider_key_internal(state: &tauri::State<'_, AppState>, provider_name: &str, api_key: &str) -> Result<(), String> {
    let (url, auth) = get_proxy_url(state, &format!("providers/{}/key", provider_name)).await?;
    tracing::debug!("sync_provider_key_internal: url={}, provider={}", url, provider_name);
    let client = https_client()?;

    let mut req = client.put(&url)
        .timeout(std::time::Duration::from_secs(5))
        .json(&serde_json::json!({ "api_key": api_key }));

    if let Some(key) = &auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let (status, body_text) = send_and_log_full("PUT", &url, req).await?;
    if status >= 200 && status < 300 {
        tracing::info!("sync_provider_key_internal: successfully synced provider {}", provider_name);
        Ok(())
    } else {
        tracing::warn!("sync_provider_key_internal: failed status={}, body={}", status, body_text);
        Err(format!("同步提供商密钥失败: HTTP {} - {}", status, body_text))
    }
}

#[allow(dead_code)]
async fn proxy_request(state: &tauri::State<'_, AppState>, method: &str, path: &str) -> Result<reqwest::Response, String> {
    let (url, auth) = get_proxy_url(state, path).await?;
    let client = https_client()?;

    let req_builder = match method {
        "GET" => client.get(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(format!("Unsupported method: {}", method)),
    };

    let req_builder = req_builder.timeout(std::time::Duration::from_secs(5));

    let req_builder = if let Some(key) = auth {
        req_builder.header("Authorization", format!("Bearer {}", key))
    } else {
        req_builder
    };

    send_and_log(method, &url, req_builder).await
}

#[tauri::command]
pub async fn list_api_keys(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let (url, auth) = get_proxy_url(&state, "keys").await?;
    tracing::debug!("list_api_keys: url={}, has_auth={}", url, auth.is_some());
    let client = https_client()?;

    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = &auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let resp = send_and_log("GET", &url, req).await?;
    tracing::debug!("list_api_keys: status={}", resp.status());

    if resp.status().is_success() {
        let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        Ok(data)
    } else {
        Err(format!("请求失败: HTTP {}", resp.status()))
    }
}

#[tauri::command]
pub async fn create_api_key(state: tauri::State<'_, AppState>, name: String, allowed_models: Vec<String>) -> Result<serde_json::Value, String> {
    let (url, auth) = get_proxy_url(&state, "keys").await?;
    tracing::debug!("create_api_key: url={}, has_auth={}, name={}, allowed_models={:?}", url, auth.is_some(), name, allowed_models);
    let client = https_client()?;

    let mut req = client.post(&url)
        .timeout(std::time::Duration::from_secs(5))
        .json(&serde_json::json!({"name": name, "allowed_models": allowed_models}));

    if let Some(key) = &auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let (status, body_text) = send_and_log_full("POST", &url, req).await?;
    if status >= 200 && status < 300 {
        let data: serde_json::Value = serde_json::from_str(&body_text).map_err(|e| e.to_string())?;
        tracing::debug!("create_api_key: success, id={}", data.get("id").map(|v| v.to_string()).unwrap_or_default());
        Ok(data)
    } else {
        tracing::warn!("create_api_key: failed status={}, body={}", status, body_text);
        Err(format!("创建失败: HTTP {} - {}", status, body_text))
    }
}

#[tauri::command]
pub async fn update_api_key(state: tauri::State<'_, AppState>, id: String, allowed_models: Vec<String>) -> Result<(), String> {
    let (url, auth) = get_proxy_url(&state, &format!("keys/{}", id)).await?;
    tracing::debug!("update_api_key: url={}, id={}, allowed_models={:?}", url, id, allowed_models);
    let client = https_client()?;

    let mut req = client.put(&url)
        .timeout(std::time::Duration::from_secs(5))
        .json(&serde_json::json!({"allowed_models": allowed_models}));

    if let Some(key) = &auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let (status, body_text) = send_and_log_full("PUT", &url, req).await?;
    if status < 200 || status >= 300 {
        return Err(format!("更新失败: HTTP {} - {}", status, body_text));
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_api_key(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let (url, auth) = get_proxy_url(&state, &format!("keys/{}", id)).await?;
    tracing::debug!("delete_api_key: url={}, has_auth={}, id={}", url, auth.is_some(), id);
    let client = https_client()?;

    let mut req = client.delete(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = &auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let (status, _body_text) = send_and_log_full("DELETE", &url, req).await?;
    if status >= 200 && status < 300 {
        Ok(())
    } else {
        Err(format!("删除失败: HTTP {}", status))
    }
}

#[tauri::command]
pub async fn get_api_key(state: tauri::State<'_, AppState>, id: String) -> Result<serde_json::Value, String> {
    let (url, auth) = get_proxy_url(&state, &format!("keys/{}/reveal", id)).await?;
    tracing::debug!("get_api_key: url={}, has_auth={}, id={}", url, auth.is_some(), id);
    let client = https_client()?;

    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = &auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let (status, body_text) = send_and_log_full("GET", &url, req).await?;
    if status >= 200 && status < 300 {
        let data: serde_json::Value = serde_json::from_str(&body_text).map_err(|e| e.to_string())?;
        Ok(data)
    } else {
        Err(format!("获取密钥失败: HTTP {} - {}", status, body_text))
    }
}

#[tauri::command]
pub async fn sync_provider_key(state: tauri::State<'_, AppState>, provider_name: String, api_key: String) -> Result<(), String> {
    let (url, auth) = get_proxy_url(&state, &format!("providers/{}/key", provider_name)).await?;
    tracing::debug!("sync_provider_key: url={}, has_auth={}, provider={}", url, auth.is_some(), provider_name);
    let client = https_client()?;

    let mut req = client.put(&url)
        .timeout(std::time::Duration::from_secs(5))
        .json(&serde_json::json!({ "api_key": api_key }));

    if let Some(key) = &auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let (status, body_text) = send_and_log_full("PUT", &url, req).await?;

    if status >= 200 && status < 300 {
        tracing::info!("sync_provider_key: successfully synced provider {} to proxy", provider_name);
        Ok(())
    } else {
        tracing::warn!("sync_provider_key: failed status={}, body={}", status, body_text);
        Err(format!("同步提供商密钥失败: HTTP {} - {}", status, body_text))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub success: bool,
    pub message: String,
    pub response: Option<serde_json::Value>,
    pub latency_ms: u64,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

fn detect_model_type(model_name: &str) -> &'static str {
    let lower = model_name.to_lowercase();
    if lower.contains("vision") || lower.contains("vl-") || lower.contains("gpt-4v") || lower.contains("claude-3-opus") || lower.contains("claude-3-sonnet") || lower.contains("gemini-1.5-pro") || lower.contains("doubao-v") {
        "multimodal"
    } else if lower.contains("o1") || lower.contains("o3") || lower.contains("o4") || lower.contains("reasoning") || lower.contains("deepseek-r1") || lower.contains("qwq") {
        "reasoning"
    } else if lower.contains("embedding") || lower.contains("embed") {
        "embedding"
    } else {
        "chat"
    }
}

fn build_test_body(model: &str, message: &str, model_type: &str, provider_type: &str) -> serde_json::Value {
    match model_type {
        "multimodal" => {
            if provider_type == "openai" {
                serde_json::json!({
                    "model": model,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": message},
                            {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}}
                        ]
                    }],
                    "max_tokens": 100
                })
            } else {
                serde_json::json!({
                    "model": model,
                    "messages": [{"role": "user", "content": message}],
                    "max_tokens": 100
                })
            }
        }
        "reasoning" => {
            serde_json::json!({
                "model": model,
                "messages": [{"role": "user", "content": message}],
                "max_tokens": 500
            })
        }
        _ => {
            serde_json::json!({
                "model": model,
                "messages": [{"role": "user", "content": message}],
                "max_tokens": 100
            })
        }
    }
}

#[tauri::command]
pub async fn test_chat_request(
    state: tauri::State<'_, AppState>,
    test_mode: String,
    _provider_id: Option<String>,
    base_url: String,
    api_key: String,
    model: String,
    message: String,
    provider_type: String,
) -> Result<TestResult, String> {
    let model_type = detect_model_type(&model);
    let start = std::time::Instant::now();

    if test_mode == "proxy" {
        let service_manager = state.service_manager.lock().await;
        let _port = service_manager.get_port();
        drop(service_manager);

        let provider_name_from_model = if model.contains(":") {
            model.split(":").next().map(|s| s.to_string())
        } else {
            None
        };

        tracing::debug!("sync_provider_key: model={}, extracted provider={}", model, provider_name_from_model.as_ref().unwrap_or(&"<none>".to_string()));

        if let Some(ref pname) = provider_name_from_model {
            let manager = state.config_manager.lock().await;
            let mut api_key_to_sync: Option<String> = None;

            // 遍历所有 providers 找匹配的 provider_type
            let providers = manager.get_providers();
            tracing::debug!("sync_provider_key: checking {} providers", providers.len());
            for provider in &providers {
                let provider_type_str = format!("{:?}", provider.provider_type).to_lowercase();
                tracing::debug!("sync_provider_key: comparing {} with {}", provider_type_str, pname);
                if provider_type_str == *pname {
                    if let Some(k) = provider.api_keys.iter().find(|k| k.is_active) {
                        api_key_to_sync = Some(k.key_value.clone());
                        tracing::debug!("sync_provider_key: found matching provider {} (id={}) with active key", provider.name, provider.id);
                        break;
                    }
                }
            }

            if let Some(key) = api_key_to_sync {
                tracing::info!("sync_provider_key: syncing provider {} to proxy", pname);
                drop(manager);
                let result = sync_provider_key_internal(&state, pname, &key).await;
                if let Err(e) = result {
                    tracing::error!("sync_provider_key: failed: {}", e);
                }
            } else {
                tracing::warn!("sync_provider_key: no active API key found for provider type {}", pname);
                // 列出所有 providers 看看有什么
                for provider in &providers {
                    tracing::warn!("sync_provider_key: available provider: id={}, type={:?}, name={}, keys={}",
                        provider.id, provider.provider_type, provider.name, provider.api_keys.len());
                }
            }
        } else {
            tracing::warn!("sync_provider_key: could not determine provider name from model {}", model);
        }

        let base_url = get_service_base_url(&state).await;
        let proxy_url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
        let client = https_client()?;
        let body = build_test_body(&model, &message, model_type, &provider_type);

        let resp = send_and_log("POST", &proxy_url, client.post(&proxy_url)
            .timeout(std::time::Duration::from_secs(120))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body))
            .await;

        let latency_ms = start.elapsed().as_millis() as u64;
        match resp {
            Ok(r) => {
                let status = r.status();
                let security_block = r.headers().get("X-Security-Block").is_some();
                let resp_body: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
                let (input_tokens, output_tokens) = extract_tokens(&resp_body);

                if security_block {
                    let block_msg = extract_block_message(&resp_body, status.as_u16());
                    Ok(TestResult {
                        success: false,
                        message: format!("安全策略拦截: {}", block_msg),
                        response: None,
                        latency_ms,
                        input_tokens: 0,
                        output_tokens: 0,
                    })
                } else if status.is_success() {
                    Ok(TestResult {
                        success: true,
                        message: format!("代理测试成功 (HTTP {})", status.as_u16()),
                        response: Some(resp_body),
                        latency_ms,
                        input_tokens,
                        output_tokens,
                    })
                } else {
                    let err_msg = extract_error_message(&resp_body);
                    Ok(TestResult {
                        success: false,
                        message: format!("请求失败 (HTTP {}): {}", status.as_u16(), err_msg),
                        response: None,
                        latency_ms,
                        input_tokens: 0,
                        output_tokens: 0,
                    })
                }
            }
            Err(e) => Ok(TestResult {
                success: false,
                message: format!("连接代理失败: {}", e),
                response: None,
                latency_ms,
                input_tokens: 0,
                output_tokens: 0,
            })
        }
    } else {
        let base = base_url.trim_end_matches('/');
        let client = https_client()?;

        let chat_url = match provider_type.as_str() {
            "openai" | "deepseek" | "siliconflow" | "minimax" | "custom" => {
                format!("{}/v1/chat/completions", base)
            }
            "glm" | "doubao" | "qwen" | "moonshot" | "yi" | "openrouter" => {
                format!("{}/chat/completions", base)
            }
            "anthropic" => {
                let body = build_test_body(&model, &message, model_type, &provider_type);
                let resp = send_and_log("POST", &format!("{}/v1/messages", base), client.post(format!("{}/v1/messages", base))
                    .timeout(std::time::Duration::from_secs(120))
                    .header("x-api-key", &api_key)
                    .header("anthropic-version", "2023-06-01")
                    .header("Content-Type", "application/json")
                    .json(&body))
                    .await;

                let latency_ms = start.elapsed().as_millis() as u64;
                match resp {
                    Ok(r) => {
                        let status = r.status();
                        let resp_body: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
                        let (input_tokens, output_tokens) = extract_tokens(&resp_body);
                        if status.is_success() {
                            return Ok(TestResult {
                                success: true,
                                message: format!("直接测试成功 (HTTP {})", status.as_u16()),
                                response: Some(resp_body),
                                latency_ms,
                                input_tokens,
                                output_tokens,
                            });
                        } else {
                            return Ok(TestResult {
                                success: false,
                                message: format!("请求失败 (HTTP {}): {}", status.as_u16(), extract_error_message(&resp_body)),
                                response: None,
                                latency_ms,
                                input_tokens: 0,
                                output_tokens: 0,
                            });
                        }
                    }
                    Err(e) => return Ok(TestResult {
                        success: false,
                        message: format!("连接失败: {}", e),
                        response: None,
                        latency_ms,
                        input_tokens: 0,
                        output_tokens: 0,
                    }),
                }
            }
            "gemini" => {
                return Err("Gemini 暂不支持直接测试，请使用「代理测试」模式".to_string());
            }
            _ => format!("{}/v1/chat/completions", base),
        };

        let body = build_test_body(&model, &message, model_type, &provider_type);
        let resp = send_and_log("POST", &chat_url, client.post(&chat_url)
            .timeout(std::time::Duration::from_secs(120))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body))
            .await;

        let latency_ms = start.elapsed().as_millis() as u64;
        match resp {
            Ok(r) => {
                let status = r.status();
                let resp_body: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
                let (input_tokens, output_tokens) = extract_tokens(&resp_body);
                if status.is_success() {
                    Ok(TestResult {
                        success: true,
                        message: format!("直接测试成功 (HTTP {})", status.as_u16()),
                        response: Some(resp_body),
                        latency_ms,
                        input_tokens,
                        output_tokens,
                    })
                } else {
                    Ok(TestResult {
                        success: false,
                        message: format!("请求失败 (HTTP {}): {}", status.as_u16(), extract_error_message(&resp_body)),
                        response: None,
                        latency_ms,
                        input_tokens: 0,
                        output_tokens: 0,
                    })
                }
            }
            Err(e) => Ok(TestResult {
                success: false,
                message: format!("连接失败: {}", e),
                response: None,
                latency_ms,
                input_tokens: 0,
                output_tokens: 0,
            })
        }
    }
}

fn extract_tokens(resp: &serde_json::Value) -> (i64, i64) {
    let usage = resp.get("usage");
    if let Some(u) = usage {
        let input = u.get("prompt_tokens").or_else(|| u.get("input_tokens")).and_then(|v| v.as_i64()).unwrap_or(0);
        let output = u.get("completion_tokens").or_else(|| u.get("output_tokens")).and_then(|v| v.as_i64()).unwrap_or(0);
        return (input, output);
    }
    (0, 0)
}

fn extract_error_message(resp: &serde_json::Value) -> String {
    if let Some(error) = resp.get("error") {
        if let Some(msg) = error.get("message").and_then(|v| v.as_str()) {
            return msg.to_string();
        }
        return error.to_string();
    }
    resp.to_string()
}

fn extract_block_message(resp: &serde_json::Value, status_code: u16) -> String {
    if let Some(error) = resp.get("error") {
        if let Some(msg) = error.get("message").and_then(|v| v.as_str()) {
            return msg.to_string();
        }
    }
    if let Some(choices) = resp.get("choices").and_then(|v| v.as_array()) {
        if let Some(choice) = choices.first() {
            if let Some(msg) = choice.get("message").and_then(|m| m.get("content")).and_then(|v| v.as_str()) {
                return msg.to_string();
            }
        }
    }
    format!("HTTP {}", status_code)
}

// ==================== 代理模型命令 ====================

#[tauri::command]
pub async fn get_proxy_models(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let config = state.config_manager.lock().await.get_config();
    tracing::info!("[DIAG-MODELS] deploy_mode={:?}, providers_count={}", config.service.deploy_mode, config.providers.len());

    if config.service.deploy_mode == DeployMode::Server {
        let remote_url = config.service.remote_service_url.clone()
            .unwrap_or_default();
        let provider_configs = config.providers.clone();
        drop(config);
        tracing::info!("[DIAG-MODELS] Server mode, remote_url={}", remote_url);
        if remote_url.is_empty() {
            tracing::warn!("[DIAG-MODELS] remote_url is empty, returning []");
            return Ok(vec![]);
        }
        let remote_url = remote_url.trim_end_matches('/').to_string();
        ensure_server_token(&state).await.map_err(|e| format!("刷新token失败: {}", e))?;
        let auth = get_server_access_token(&state).await;
        let client = https_client()?;
        let url = format!("{}/v1/models", remote_url);
        let mut req = client.get(&url).timeout(std::time::Duration::from_secs(10));
        if let Some(token) = auth {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        let resp = send_and_log("GET", &url, req).await.map_err(|e| {
            tracing::error!("[DIAG-MODELS] HTTP request to {} failed: {}", url, e);
            format!("请求远程models失败: {}", e)
        })?;
        let status = resp.status();
        if !status.is_success() {
            tracing::warn!("[DIAG-MODELS] /v1/models returned {}, returning []", status);
            return Ok(vec![]);
        }
        let body: serde_json::Value = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
        let raw_count = body.get("data").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
        tracing::info!("[DIAG-MODELS] Go /v1/models returned {} raw models from data array", raw_count);

        let mut all_models: Vec<String> = Vec::new();
        let mut disabled_count = 0;
        if let Some(data) = body.get("data").and_then(|v| v.as_array()) {
            for m in data {
                if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                    let parts: Vec<&str> = id.splitn(2, ':').collect();
                    if parts.len() == 2 {
                        let provider_type = parts[0];
                        let model_name = parts[1];
                        let mut is_disabled = false;
                        for (_, pc) in &provider_configs {
                            if format!("{:?}", pc.provider_type).to_lowercase() == provider_type {
                                if !pc.enabled {
                                    is_disabled = true;
                                    break;
                                }
                                if let Some(ref disabled) = pc.disabled_models {
                                    if disabled.contains(&model_name.to_string()) {
                                        is_disabled = true;
                                        break;
                                    }
                                }
                            }
                        }
                        if !is_disabled {
                            all_models.push(id.to_string());
                        } else {
                            disabled_count += 1;
                        }
                    } else {
                        all_models.push(id.to_string());
                    }
                }
            }
        }
        tracing::info!("[DIAG-MODELS] After filter: {} models kept, {} disabled by provider config", all_models.len(), disabled_count);
        if all_models.len() <= 5 {
            tracing::info!("[DIAG-MODELS] Final list: {:?}", all_models);
        } else {
            tracing::info!("[DIAG-MODELS] First 5: {:?}", &all_models[..5]);
        }
        return Ok(all_models);
    }
    drop(config);

    let manager = state.config_manager.lock().await;
    let providers = manager.get_providers();
    tracing::info!("[DIAG-MODELS] PC mode, {} providers from config", providers.len());

    let mut all_models: Vec<String> = Vec::new();
    for provider in providers {
        if !provider.enabled {
            tracing::info!("[DIAG-MODELS] SKIP disabled provider {:?}", provider.provider_type);
            continue;
        }
        let provider_name = format!("{:?}", provider.provider_type).to_lowercase();
        let disabled = provider.disabled_models.as_deref().unwrap_or(&[]);
        tracing::info!("[DIAG-MODELS] Provider {} has {} models, {} disabled", provider_name, provider.models.len(), disabled.len());
        for model in &provider.models {
            if disabled.contains(model) {
                continue;
            }
            let model_id = format!("{}:{}", provider_name, model);
            if !all_models.contains(&model_id) {
                all_models.push(model_id);
            }
        }
    }
    tracing::info!("[DIAG-MODELS] PC mode final: {} models", all_models.len());
    Ok(all_models)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub provider: String,
    pub provider_type: String,
}

#[tauri::command]
pub async fn get_proxy_models_with_info(state: tauri::State<'_, AppState>) -> Result<Vec<ModelInfo>, String> {
    let config = state.config_manager.lock().await.get_config();
    if config.service.deploy_mode == DeployMode::Server {
        let remote_url = config.service.remote_service_url.clone().unwrap_or_default();
        drop(config);
        if remote_url.is_empty() {
            return Ok(vec![]);
        }
        ensure_server_token(&state).await.map_err(|e| format!("刷新token失败: {}", e))?;
        let auth = get_server_access_token(&state).await;
        let client = https_client()?;
        let url = format!("{}/v1/models", remote_url.trim_end_matches('/'));
        let mut req = client.get(&url).timeout(std::time::Duration::from_secs(10));
        if let Some(token) = auth {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        let resp = send_and_log("GET", &url, req).await.map_err(|e| format!("{}", e))?;
        if !resp.status().is_success() {
            return Ok(vec![]);
        }
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let mut models: Vec<ModelInfo> = Vec::new();
        if let Some(data) = body.get("data").and_then(|v| v.as_array()) {
            for m in data {
                if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                    let parts: Vec<&str> = id.splitn(2, ':').collect();
                    if parts.len() == 2 {
                        let prov = parts[0].to_string();
                        let ptype = prov.clone();
                        models.push(ModelInfo { id: id.to_string(), provider: prov, provider_type: ptype });
                    }
                }
            }
        }
        return Ok(models);
    }
    let providers = config.providers.clone();
    drop(config);
    let mut models: Vec<ModelInfo> = Vec::new();
    for (_, pc) in &providers {
        if !pc.enabled { continue; }
        let provider_name = format!("{:?}", pc.provider_type).to_lowercase();
        let disabled = pc.disabled_models.as_deref().unwrap_or(&[]);
        for model in &pc.models {
            if disabled.contains(model) { continue; }
            models.push(ModelInfo {
                id: format!("{}:{}", provider_name, model),
                provider: provider_name.clone(),
                provider_type: provider_name.clone(),
            });
        }
    }
    Ok(models)
}

// ==================== 系统命令 ====================

#[tauri::command]
pub async fn get_app_info() -> AppInfo {
    AppInfo {
        name: "ClamAI".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        description: "智能大模型网关".to_string(),
        homepage: "https://github.com/yourusername/clamai".to_string(),
        repository: "https://github.com/yourusername/clamai".to_string(),
        authors: "ClamAI Team".to_string(),
        license: "MIT".to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub description: String,
    pub homepage: String,
    pub repository: String,
    pub authors: String,
    pub license: String,
}

#[tauri::command]
pub async fn open_log_folder() -> Result<(), String> {
    let exe_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("无法获取程序目录".to_string())?
        .to_path_buf();

    let log_dir = exe_dir.join("output");

    open::that(&log_dir).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn check_updates() -> Result<UpdateInfo, String> {
    // 检查应用更新
    Ok(UpdateInfo {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        latest_version: env!("CARGO_PKG_VERSION").to_string(),
        has_update: false,
        download_url: "https://github.com/yourusername/aiproxy/releases".to_string(),
        release_notes: "Latest version".to_string(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub download_url: String,
    pub release_notes: String,
}

// ==================== 安全管理命令 ====================

#[tauri::command]
pub async fn get_security_config(state: tauri::State<'_, AppState>) -> Result<String, String> {
    tracing::info!("====== get_security_config called ======");
    let (url, auth) = get_proxy_url(&state, "security/config").await.map_err(|e| {
        tracing::error!("get_security_config: get_proxy_url failed: {}", e);
        e
    })?;
    tracing::info!("get_security_config: url={}, has_auth={}", url, auth.is_some());
    let client = https_client()?;
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (status, body_text) = send_and_log_full("GET", &url, req).await?;
    tracing::info!("get_security_config: status={}", status);
    tracing::info!("get_security_config: body={}", &body_text[..body_text.len().min(500)]);
    Ok(body_text)
}

#[tauri::command]
pub async fn save_security_config(state: tauri::State<'_, AppState>, payload: String) -> Result<String, String> {
    tracing::info!("====== save_security_config called, payload len={} ======", payload.len());
    let (url, auth) = get_proxy_url(&state, "security/config").await?;
    tracing::info!("save_security_config: url={}", url);
    let client = https_client()?;
    let config_value: serde_json::Value = serde_json::from_str(&payload).map_err(|e| {
        tracing::error!("save_security_config: JSON parse failed: {}", e);
        e.to_string()
    })?;
    let mut req = client.put(&url).timeout(std::time::Duration::from_secs(5)).json(&config_value);
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let resp = send_and_log("PUT", &url, req).await.map_err(|e| {
        tracing::error!("save_security_config: HTTP failed: {}", e);
        e
    })?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    tracing::info!("save_security_config: response={}", &body[..body.len().min(200)]);
    Ok(body)
}

#[tauri::command]
pub async fn get_security_alerts(state: tauri::State<'_, AppState>, limit: Option<u32>, offset: Option<u32>) -> Result<String, String> {
    let l = limit.unwrap_or(50);
    let o = offset.unwrap_or(0);
    let (url, auth) = get_proxy_url(&state, &format!("security/alerts?limit={}&offset={}", l, o)).await?;
    let client = https_client()?;
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("GET", &url, req).await?;
    Ok(body)
}

#[tauri::command]
pub async fn resolve_security_alert(state: tauri::State<'_, AppState>, id: u64) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, &format!("security/alerts/{}/resolve", id)).await?;
    let client = https_client()?;
    let mut req = client.put(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("PUT", &url, req).await?;
    Ok(body)
}

// ==================== 向量样本管理命令 ====================

#[tauri::command]
pub async fn get_vector_samples(state: tauri::State<'_, AppState>, limit: Option<u32>, offset: Option<u32>) -> Result<String, String> {
    let l = limit.unwrap_or(50);
    let o = offset.unwrap_or(0);
    let (url, auth) = get_proxy_url(&state, &format!("security/vector/samples?limit={}&offset={}", l, o)).await?;
    let client = https_client()?;
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(10));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("GET", &url, req).await?;
    Ok(body)
}

#[tauri::command]
pub async fn add_vector_sample(state: tauri::State<'_, AppState>, content: String, category: String, source: String) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, "security/vector/samples").await?;
    let client = https_client()?;
    let mut req = client.post(&url)
        .timeout(std::time::Duration::from_secs(60))
        .json(&serde_json::json!({
            "content": content,
            "category": category,
            "source": source,
        }));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("POST", &url, req).await?;
    Ok(body)
}

#[tauri::command]
pub async fn delete_vector_sample(state: tauri::State<'_, AppState>, id: u64) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, &format!("security/vector/samples/{}", id)).await?;
    let client = https_client()?;
    let mut req = client.delete(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("DELETE", &url, req).await?;
    Ok(body)
}

#[tauri::command]
pub async fn get_vector_config(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, "security/vector/config").await?;
    let client = https_client()?;
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("GET", &url, req).await?;
    Ok(body)
}

// ==================== 认证命令 ====================

#[tauri::command]
pub async fn get_caller_top10(state: tauri::State<'_, AppState>, period: Option<u32>) -> Result<String, String> {
    let p = period.unwrap_or(60 * 24 * 7);
    let (url, auth) = get_proxy_url(&state, &format!("stats/callers?period={}", p)).await?;
    let client = https_client()?;
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("GET", &url, req).await?;
    Ok(body)
}

#[tauri::command]
pub async fn get_security_token_stats(state: tauri::State<'_, AppState>, period: Option<u32>) -> Result<String, String> {
    let p = period.unwrap_or(60 * 24 * 7);
    let (url, auth) = get_proxy_url(&state, &format!("stats/security-tokens?period={}", p)).await?;
    let client = https_client()?;
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("GET", &url, req).await?;
    Ok(body)
}

#[tauri::command]
pub async fn get_auth_status(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let config = state.config_manager.lock().await.get_config();
    let base_url = match config.service.deploy_mode {
        DeployMode::PC => format!("https://127.0.0.1:{}", config.gateway.port),
        DeployMode::Server => config.service.remote_service_url.clone()
            .unwrap_or_default().trim_end_matches('/').to_string(),
    };
    let url = format!("{}/api/v1/auth/status", base_url);
    drop(config);
    let client = https_client()?;
    let (_, body) = send_and_log_full("GET", &url, client.get(&url).timeout(std::time::Duration::from_secs(5))).await?;
    Ok(body)
}

#[tauri::command]
pub async fn setup_admin(state: tauri::State<'_, AppState>, username: String, password: String) -> Result<String, String> {
    let config = state.config_manager.lock().await.get_config();
    let base_url = match config.service.deploy_mode {
        DeployMode::PC => format!("https://127.0.0.1:{}", config.gateway.port),
        DeployMode::Server => config.service.remote_service_url.clone()
            .unwrap_or_default().trim_end_matches('/').to_string(),
    };
    let url = format!("{}/api/v1/auth/setup", base_url);
    let client = https_client()?;
    let (_, body) = send_and_log_full("POST", &url, client.post(&url).timeout(std::time::Duration::from_secs(5)).json(&serde_json::json!({"username": username, "password": password}))).await?;
    let parsed: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
    if parsed.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
        if let (Some(at), Some(rt), Some(ei)) = (
            parsed.get("access_token").and_then(|v| v.as_str()),
            parsed.get("refresh_token").and_then(|v| v.as_str()),
            parsed.get("expires_in").and_then(|v| v.as_i64()),
        ) {
            let mut store = state.token_store.lock().await;
            store.tokens = Some(TokenPair {
                access_token: at.to_string(),
                refresh_token: rt.to_string(),
                expires_at: chrono::Utc::now() + chrono::Duration::seconds(ei),
            });
        }
        Ok(body)
    } else {
        Err(parsed.get("error").and_then(|v| v.as_str()).unwrap_or("Setup failed").to_string())
    }
}

#[tauri::command]
pub async fn login_admin(state: tauri::State<'_, AppState>, username: String, password: String) -> Result<String, String> {
    let config = state.config_manager.lock().await.get_config();
    let base_url = match config.service.deploy_mode {
        DeployMode::PC => format!("https://127.0.0.1:{}", config.gateway.port),
        DeployMode::Server => config.service.remote_service_url.clone()
            .unwrap_or_default().trim_end_matches('/').to_string(),
    };
    let url = format!("{}/api/v1/auth/login", base_url);
    let client = https_client()?;
    let (_, body) = send_and_log_full("POST", &url, client.post(&url).timeout(std::time::Duration::from_secs(5)).json(&serde_json::json!({"username": username, "password": password}))).await?;
    let parsed: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
    if parsed.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
        if let (Some(at), Some(rt), Some(ei)) = (
            parsed.get("access_token").and_then(|v| v.as_str()),
            parsed.get("refresh_token").and_then(|v| v.as_str()),
            parsed.get("expires_in").and_then(|v| v.as_i64()),
        ) {
            let mut store = state.token_store.lock().await;
            store.tokens = Some(TokenPair {
                access_token: at.to_string(),
                refresh_token: rt.to_string(),
                expires_at: chrono::Utc::now() + chrono::Duration::seconds(ei),
            });
        }
        Ok(body)
    } else {
        Err(parsed.get("error").and_then(|v| v.as_str()).unwrap_or("Login failed").to_string())
    }
}

#[tauri::command]
pub async fn change_admin_password(state: tauri::State<'_, AppState>, old_password: String, new_password: String) -> Result<String, String> {
    let (url, _auth) = get_proxy_url(&state, "auth/change-password").await?;
    let client = https_client()?;
    let (_, body) = send_and_log_full("POST", &url, client.post(&url).timeout(std::time::Duration::from_secs(5)).json(&serde_json::json!({"old_password": old_password, "new_password": new_password}))).await?;
    Ok(body)
}

#[tauri::command]
pub async fn get_admin_token(state: tauri::State<'_, AppState>, password: String) -> Result<String, String> {
    let (url, _auth) = get_proxy_url(&state, "auth/token").await?;
    let client = https_client()?;
    let (_, body) = send_and_log_full("POST", &url, client.post(&url).timeout(std::time::Duration::from_secs(5)).json(&serde_json::json!({"password": password}))).await?;
    let parsed: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
    if parsed.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
        if let (Some(at), Some(rt), Some(ei)) = (
            parsed.get("access_token").and_then(|v| v.as_str()),
            parsed.get("refresh_token").and_then(|v| v.as_str()),
            parsed.get("expires_in").and_then(|v| v.as_i64()),
        ) {
            let mut store = state.token_store.lock().await;
            store.tokens = Some(TokenPair {
                access_token: at.to_string(),
                refresh_token: rt.to_string(),
                expires_at: chrono::Utc::now() + chrono::Duration::seconds(ei),
            });
        }
        Ok(body)
    } else {
        Ok(body)
    }
}

// ==================== 限流配置命令 ====================

#[tauri::command]
pub async fn get_ratelimit_config(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, "ratelimit/config").await?;
    let client = https_client()?;
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("GET", &url, req).await?;
    Ok(body)
}

#[tauri::command]
pub async fn save_ratelimit_config(state: tauri::State<'_, AppState>, payload: String) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, "ratelimit/config").await?;
    let client = https_client()?;
    let config_value: serde_json::Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    let mut req = client.put(&url).timeout(std::time::Duration::from_secs(5)).json(&config_value);
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("PUT", &url, req).await?;
    Ok(body)
}

// ==================== 安全广场分析命令 ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub success: bool,
    pub message: String,
    pub analysis: Option<String>,
    #[serde(default)]
    pub risk_level: String,
}

#[tauri::command]
pub async fn analyze_user_profile(
    state: tauri::State<'_, AppState>,
    model: String,
    api_key_id: String,
    time_range: String,
) -> Result<AnalysisResult, String> {
    tracing::info!("analyze_user_profile: model={}, api_key_id={}, time_range={}", model, api_key_id, time_range);

    if model.contains(":") {
        let provider_name = model.split(":").next().unwrap_or("").to_string();
        let manager = state.config_manager.lock().await;
        let providers = manager.get_providers();
        for provider in &providers {
            let provider_type_str = format!("{:?}", provider.provider_type).to_lowercase();
            if provider_type_str == provider_name {
                if let Some(k) = provider.api_keys.iter().find(|k| k.is_active) {
                    let key_to_sync = k.key_value.clone();
                    drop(manager);
                    tracing::info!("analyze_user_profile: syncing provider {} key", provider_name);
                    if let Err(e) = sync_provider_key_internal(&state, &provider_name, &key_to_sync).await {
                        tracing::warn!("analyze_user_profile: sync provider key failed: {}", e);
                    }
                    break;
                }
            }
        }
    }

    let (url, auth) = get_proxy_url_no_prefix(&state, "analysis/v1/chat/completions").await?;
    tracing::info!("analyze_user_profile: url={}", url);
    let client = https_client()?;
    let body = serde_json::json!({
        "analysis_type": "user_profile",
        "model": model,
        "api_key_id": api_key_id,
        "time_range": time_range
    });
    let mut req = client.post(&url)
        .timeout(std::time::Duration::from_secs(90))
        .header("Content-Type", "application/json");
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    tracing::info!("analyze_user_profile: sending request to Go proxy");
    let resp = send_and_log("POST", &url, req.json(&body)).await.map_err(|e| {
        tracing::error!("analyze_user_profile: request failed: {}", e);
        e
    })?;
    let status = resp.status();
    tracing::info!("analyze_user_profile: got status={}", status);
    let resp_body: serde_json::Value = resp.json().await.unwrap_or_default();
    if status.is_success() {
        let analysis = resp_body.get("choices")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|msg| msg.get("content"))
            .and_then(|c| c.as_str())
            .map(|s| s.to_string());
        Ok(AnalysisResult {
            success: true,
            message: "分析完成".to_string(),
            analysis,
            risk_level: "unknown".to_string(),
        })
    } else {
        let err_msg = resp_body.get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("分析请求失败")
            .to_string();
        Ok(AnalysisResult {
            success: false,
            message: err_msg,
            analysis: None,
            risk_level: "unknown".to_string(),
        })
    }
}

#[tauri::command]
pub async fn check_skills_content(
    state: tauri::State<'_, AppState>,
    model: String,
    source_type: String,
    content: String,
    api_key_id: Option<String>,
) -> Result<AnalysisResult, String> {
    tracing::info!("check_skills_content: model={}, source_type={}, content_len={}", model, source_type, content.len());

    if model.contains(":") {
        let provider_name = model.split(":").next().unwrap_or("").to_string();
        let manager = state.config_manager.lock().await;
        let providers = manager.get_providers();
        for provider in &providers {
            let provider_type_str = format!("{:?}", provider.provider_type).to_lowercase();
            if provider_type_str == provider_name {
                if let Some(k) = provider.api_keys.iter().find(|k| k.is_active) {
                    let key_to_sync = k.key_value.clone();
                    drop(manager);
                    tracing::info!("check_skills_content: syncing provider {} key", provider_name);
                    if let Err(e) = sync_provider_key_internal(&state, &provider_name, &key_to_sync).await {
                        tracing::warn!("check_skills_content: sync provider key failed: {}", e);
                    }
                    break;
                }
            }
        }
    }

    let (url, auth) = get_proxy_url_no_prefix(&state, "analysis/v1/chat/completions").await?;
    tracing::info!("check_skills_content: url={}", url);
    let client = https_client()?;
    let mut body_map = serde_json::Map::new();
    body_map.insert("analysis_type".to_string(), serde_json::Value::String("skills_detection".to_string()));
    body_map.insert("model".to_string(), serde_json::Value::String(model));
    body_map.insert("source_type".to_string(), serde_json::Value::String(source_type));
    body_map.insert("content".to_string(), serde_json::Value::String(content));
    if let Some(kid) = api_key_id {
        body_map.insert("api_key_id".to_string(), serde_json::Value::String(kid));
    }
    let body = serde_json::Value::Object(body_map);
    let mut req = client.post(&url)
        .timeout(std::time::Duration::from_secs(90))
        .header("Content-Type", "application/json");
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    tracing::info!("check_skills_content: sending request to Go proxy");
    let resp = send_and_log("POST", &url, req.json(&body)).await.map_err(|e| {
        tracing::error!("check_skills_content: request failed: {}", e);
        e
    })?;
    let status = resp.status();
    tracing::info!("check_skills_content: got status={}", status);
    let resp_body: serde_json::Value = resp.json().await.unwrap_or_default();
    if status.is_success() {
        let analysis = resp_body.get("choices")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|msg| msg.get("content"))
            .and_then(|c| c.as_str())
            .map(|s| s.to_string());
        let risk_level = if let Some(a) = &analysis {
            if a.contains("极高") || a.contains("high risk") {
                "high"
            } else if a.contains("高风险") {
                "high"
            } else if a.contains("中风险") || a.contains("medium risk") {
                "medium"
            } else if a.contains("低风险") || a.contains("low risk") {
                "low"
            } else {
                "unknown"
            }
        } else {
            "unknown"
        };
        Ok(AnalysisResult {
            success: true,
            message: "检测完成".to_string(),
            analysis,
            risk_level: risk_level.to_string(),
        })
    } else {
        let err_msg = resp_body.get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("检测请求失败")
            .to_string();
        Ok(AnalysisResult {
            success: false,
            message: err_msg,
            analysis: None,
            risk_level: "unknown".to_string(),
        })
    }
}

#[tauri::command]
pub async fn get_skills_detection_history(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<String, String> {
    let l = limit.unwrap_or(50);
    let o = offset.unwrap_or(0);
    let (url, auth) = get_proxy_url(&state, &format!("skills/history?limit={}&offset={}", l, o)).await?;
    let client = https_client()?;
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("GET", &url, req).await?;
    Ok(body)
}

#[tauri::command]
pub async fn get_profile_analysis_history(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<String, String> {
    let l = limit.unwrap_or(50);
    let o = offset.unwrap_or(0);
    let (url, auth) = get_proxy_url(&state, &format!("profile/history?limit={}&offset={}", l, o)).await?;
    let client = https_client()?;
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("GET", &url, req).await?;
    Ok(body)
}

// ==================== 分析任务管理命令 ====================

#[tauri::command]
pub async fn create_analysis_task(
    state: tauri::State<'_, AppState>,
    name: String,
    api_key_id: String,
    model: String,
    time_range: Option<String>,
    schedule_type: Option<String>,
    interval_minutes: Option<u32>,
) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, "analysis/tasks").await?;
    let client = https_client()?;
    let body = serde_json::json!({
        "name": name,
        "api_key_id": api_key_id,
        "model": model,
        "time_range": time_range.unwrap_or_else(|| "7d".to_string()),
        "schedule_type": schedule_type.unwrap_or_else(|| "once".to_string()),
        "interval_minutes": interval_minutes.unwrap_or(60),
    });
    let mut req = client.post(&url)
        .timeout(std::time::Duration::from_secs(10))
        .header("Content-Type", "application/json")
        .json(&body);
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (status, resp_body) = send_and_log_full("POST", &url, req).await?;
    if status >= 400 {
        return Err(format!("API error {}: {}", status, resp_body));
    }
    Ok(resp_body)
}

#[tauri::command]
pub async fn list_analysis_tasks(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, "analysis/tasks").await?;
    let client = https_client()?;
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(10));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("GET", &url, req).await?;
    Ok(body)
}

#[tauri::command]
pub async fn delete_analysis_task(state: tauri::State<'_, AppState>, task_id: String) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, &format!("analysis/tasks/{}", task_id)).await?;
    let client = https_client()?;
    let mut req = client.delete(&url).timeout(std::time::Duration::from_secs(10));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("DELETE", &url, req).await?;
    Ok(body)
}

#[tauri::command]
pub async fn update_analysis_task(
    state: tauri::State<'_, AppState>,
    task_id: String,
    name: String,
    api_key_id: String,
    model: String,
    time_range: Option<String>,
    schedule_type: Option<String>,
    interval_minutes: Option<u32>,
) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, &format!("analysis/tasks/{}", task_id)).await?;
    let client = https_client()?;
    let body = serde_json::json!({
        "name": name,
        "api_key_id": api_key_id,
        "model": model,
        "time_range": time_range.unwrap_or_else(|| "7d".to_string()),
        "schedule_type": schedule_type.unwrap_or_else(|| "once".to_string()),
        "interval_minutes": interval_minutes.unwrap_or(60),
    });
    let mut req = client.put(&url)
        .timeout(std::time::Duration::from_secs(10))
        .header("Content-Type", "application/json")
        .json(&body);
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, resp_body) = send_and_log_full("PUT", &url, req).await?;
    Ok(resp_body)
}

#[tauri::command]
pub async fn start_analysis_task(state: tauri::State<'_, AppState>, task_id: String) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, &format!("analysis/tasks/{}/start", task_id)).await?;
    let client = https_client()?;
    let mut req = client.post(&url).timeout(std::time::Duration::from_secs(10));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("POST", &url, req).await?;
    Ok(body)
}

#[tauri::command]
pub async fn stop_analysis_task(state: tauri::State<'_, AppState>, task_id: String) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, &format!("analysis/tasks/{}/stop", task_id)).await?;
    let client = https_client()?;
    let mut req = client.post(&url).timeout(std::time::Duration::from_secs(10));
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, body) = send_and_log_full("POST", &url, req).await?;
    Ok(body)
}

// ==================== 智能体安全命令 ====================

#[tauri::command]
pub async fn scan_agent_logs(
    state: tauri::State<'_, AppState>,
    scan_path: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, "agent/scan-logs").await?;
    let client = https_client()?;
    let body = serde_json::json!({
        "path": scan_path.unwrap_or_default(),
        "model": model.unwrap_or_default(),
    });
    let mut req = client.post(&url)
        .timeout(std::time::Duration::from_secs(120))
        .header("Content-Type", "application/json")
        .json(&body);
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, resp_body) = send_and_log_full("POST", &url, req).await?;
    Ok(resp_body)
}

#[tauri::command]
pub async fn check_agent_env(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, "agent/env-check").await?;
    let client = https_client()?;
    let mut req = client.post(&url)
        .timeout(std::time::Duration::from_secs(30))
        .header("Content-Type", "application/json")
        .body("{}");
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, resp_body) = send_and_log_full("POST", &url, req).await?;
    Ok(resp_body)
}

#[tauri::command]
pub async fn create_skills_task(state: tauri::State<'_, AppState>, name: String, model: String, source_type: String, source_info: String) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, "skills/tasks").await?;
    let client = https_client()?;
    let body = serde_json::json!({
        "name": name,
        "model": model,
        "source_type": source_type,
        "source_info": source_info,
    });
    let mut req = client.post(&url)
        .timeout(std::time::Duration::from_secs(15))
        .header("Content-Type", "application/json")
        .body(body.to_string());
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, resp_body) = send_and_log_full("POST", &url, req).await?;
    Ok(resp_body)
}

#[tauri::command]
pub async fn list_skills_tasks(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, "skills/tasks").await?;
    let client = https_client()?;
    let mut req = client.get(&url)
        .timeout(std::time::Duration::from_secs(15))
        .header("Content-Type", "application/json");
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, resp_body) = send_and_log_full("GET", &url, req).await?;
    Ok(resp_body)
}

#[tauri::command]
pub async fn delete_skills_task(state: tauri::State<'_, AppState>, id: String) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, &format!("skills/tasks/{}", id)).await?;
    let client = https_client()?;
    let mut req = client.delete(&url)
        .timeout(std::time::Duration::from_secs(15))
        .header("Content-Type", "application/json");
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, resp_body) = send_and_log_full("DELETE", &url, req).await?;
    Ok(resp_body)
}

#[tauri::command]
pub async fn start_skills_task(state: tauri::State<'_, AppState>, id: String) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, &format!("skills/tasks/{}/start", id)).await?;
    let client = https_client()?;
    let mut req = client.post(&url)
        .timeout(std::time::Duration::from_secs(15))
        .header("Content-Type", "application/json")
        .body("{}");
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, resp_body) = send_and_log_full("POST", &url, req).await?;
    Ok(resp_body)
}

#[tauri::command]
pub async fn discover_agents(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, "agent/discover").await?;
    let client = https_client()?;
    let mut req = client.get(&url)
        .timeout(std::time::Duration::from_secs(15))
        .header("Content-Type", "application/json");
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, resp_body) = send_and_log_full("GET", &url, req).await?;
    Ok(resp_body)
}

#[tauri::command]
pub async fn deep_check_agent(state: tauri::State<'_, AppState>, agent: String, model: String) -> Result<String, String> {
    let (url, auth) = get_proxy_url(&state, "agent/deep-check").await?;
    let client = https_client()?;
    let body = serde_json::json!({
        "agent_name": agent,
        "model": model,
    });
    let mut req = client.post(&url)
        .timeout(std::time::Duration::from_secs(60))
        .header("Content-Type", "application/json")
        .body(body.to_string());
    if let Some(key) = auth {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let (_, resp_body) = send_and_log_full("POST", &url, req).await?;
    Ok(resp_body)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupState {
    pub setup_complete: bool,
    pub deploy_mode: String,
    pub service_url: String,
    pub connected: bool,
}

#[tauri::command]
pub async fn get_setup_state(state: tauri::State<'_, AppState>) -> Result<SetupState, String> {
    let config = state.config_manager.lock().await.get_config();
    let service_manager = state.service_manager.lock().await;
    let status = service_manager.get_service_status().await;

    let deploy_mode = match config.service.deploy_mode {
        DeployMode::PC => "pc",
        DeployMode::Server => "server",
    };

    Ok(SetupState {
        setup_complete: config.service.setup_complete,
        deploy_mode: deploy_mode.to_string(),
        service_url: status.service_url,
        connected: status.proxy_running,
    })
}

#[tauri::command]
pub async fn check_service_connection(
    service_url: String,
) -> Result<ProxyTestResult, String> {
    let client = https_client_for_url(&service_url)?;
    let url = format!("{}/api/v1/auth/status", service_url.trim_end_matches('/'));
    let resp = send_and_log("GET", &url, client.get(&url)
        .timeout(std::time::Duration::from_secs(5)))
        .await;

    match resp {
        Ok(r) => {
            if r.status().is_success() {
                let body = r.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
                let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| format!("解析JSON失败: {}", e))?;
                let initialized = parsed.get("initialized").and_then(|v| v.as_bool());
                Ok(ProxyTestResult {
                    success: true,
                    message: "服务连接成功".to_string(),
                    initialized,
                })
            } else if r.status() == 401 || r.status() == 403 {
                Ok(ProxyTestResult {
                    success: false,
                    message: "服务需要认证".to_string(),
                    initialized: Some(false),
                })
            } else {
                Ok(ProxyTestResult {
                    success: false,
                    message: format!("服务返回状态码: {}", r.status()),
                    initialized: None,
                })
            }
        }
        Err(e) => Ok(ProxyTestResult {
            success: false,
            message: format!("连接失败: {}", e),
            initialized: None,
        }),
    }
}

#[tauri::command]
pub async fn complete_setup(
    state: tauri::State<'_, AppState>,
    deploy_mode: String,
    remote_url: Option<String>,
    port: Option<u16>,
) -> Result<(), String> {
    let mut config_manager = state.config_manager.lock().await;
    let mut config = config_manager.get_config();

    config.service.deploy_mode = match deploy_mode.as_str() {
        "server" => DeployMode::Server,
        _ => DeployMode::PC,
    };
    config.service.remote_service_url = remote_url;
    if let Some(p) = port {
        config.gateway.port = p;
    }
    config.service.setup_complete = true;

    config_manager.update_config(config).await.map_err(|e| e.to_string())?;
    drop(config_manager);

    let mut service_manager = state.service_manager.lock().await;
    service_manager.start_proxy_service().await.map_err(|e| e.to_string())?;

    tracing::info!("✅ 安装向导完成，模式: {}", deploy_mode);
    Ok(())
}

#[tauri::command]
pub async fn connect_service(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut service_manager = state.service_manager.lock().await;
    service_manager.start_proxy_service().await.map_err(|e| e.to_string())?;
    drop(service_manager);

    sync_all_providers_to_service_inner(&state).await;
    Ok(())
}

pub(crate) async fn sync_all_providers_to_service_inner(state: &tauri::State<'_, AppState>) {
    let base_url = state.service_manager.lock().await.get_service_url();
    let providers = state.config_manager.lock().await.get_providers();
    let client = match https_client_for_url(&base_url) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("sync_all_providers: 创建HTTP客户端失败: {}", e);
            return;
        }
    };

    let _ = ensure_server_token(state).await;
    let auth = get_server_access_token(state).await;

    for provider in providers {
        if !provider.enabled {
            continue;
        }
        if let Some(api_key) = provider.api_keys.iter().find(|k| k.is_active) {
            let provider_name = format!("{:?}", provider.provider_type).to_lowercase();
            let api_key_value = api_key.key_value.clone();
            let url = format!("{}/api/v1/providers/{}/key", base_url.trim_end_matches('/'), provider_name);
            let mut req = client.put(&url)
                .timeout(std::time::Duration::from_secs(5))
                .json(&serde_json::json!({ "api_key": api_key_value }));
            if let Some(ref token) = auth {
                req = req.header("Authorization", format!("Bearer {}", token));
            }
            match send_and_log("PUT", &url, req).await {
                Ok(resp) if resp.status().is_success() => {
                    tracing::info!("同步提供商 {} 密钥成功", provider_name);
                }
                Ok(resp) => {
                    tracing::warn!("同步提供商 {} 密钥失败: HTTP {}", provider_name, resp.status());
                }
                Err(e) => {
                    tracing::warn!("同步提供商 {} 密钥失败: {}", provider_name, e);
                }
            }
        }
    }
}

#[tauri::command]
pub async fn init_remote_server(
    state: tauri::State<'_, AppState>,
    username: String,
    password: String,
) -> Result<(), String> {
    let config = state.config_manager.lock().await.get_config();
    let remote_url = config.service.remote_service_url
        .as_ref()
        .ok_or_else(|| "未配置远程服务地址".to_string())?
        .trim_end_matches('/');

    let client = https_client_for_url(remote_url)?;
    let url = format!("{}/api/v1/auth/setup", remote_url);
    let body = serde_json::json!({"username": username, "password": password});
    let resp = send_and_log("POST", &url, client.post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10)))
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let msg = resp.text().await.unwrap_or_default();
        return Err(format!("远程服务初始化失败 ({}): {}", status, msg));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
    let access_token = body.get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "响应中缺少access_token".to_string())?;
    let refresh_token = body.get("refresh_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "响应中缺少refresh_token".to_string())?;

    let mut store = state.token_store.lock().await;
    store.tokens = Some(crate::TokenPair {
        access_token: access_token.to_string(),
        refresh_token: refresh_token.to_string(),
        expires_at: chrono::Utc::now() + chrono::Duration::seconds(
            body.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(7200)
        ),
    });
    tracing::info!("[init_remote_server] 远程服务器初始化成功");
    Ok(())
}

#[tauri::command]
pub async fn disconnect_service(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut service_manager = state.service_manager.lock().await;
    service_manager.stop_proxy_service().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn switch_deploy_mode(
    state: tauri::State<'_, AppState>,
    deploy_mode: String,
    remote_url: Option<String>,
    port: Option<u16>,
) -> Result<(), String> {
    let mut service_manager = state.service_manager.lock().await;
    let _ = service_manager.stop_proxy_service().await;
    drop(service_manager);

    {
        let mut store = state.token_store.lock().await;
        store.tokens = None;
    }

    let mut config_manager = state.config_manager.lock().await;
    let mut config = config_manager.get_config();

    config.service.deploy_mode = match deploy_mode.as_str() {
        "server" => DeployMode::Server,
        _ => DeployMode::PC,
    };
    config.service.remote_service_url = remote_url;
    if let Some(p) = port {
        config.gateway.port = p;
    }

    config_manager.update_config(config).await.map_err(|e| e.to_string())?;
    drop(config_manager);

    let mut service_manager = state.service_manager.lock().await;
    service_manager.start_proxy_service().await.map_err(|e| e.to_string())?;

    tracing::info!("✅ 已切换到 {} 模式", deploy_mode);
    Ok(())
}
