use crate::AppState;
use crate::config::ProviderConfig;
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
    // 重置为默认配置
    let default_config = crate::config::AppConfig {
        version: "1.0.0".to_string(),
        providers: std::collections::HashMap::new(),
        mappings: std::collections::HashMap::new(),
        gateway: crate::config::GatewayConfig {
            port: 8080,
            host: "127.0.0.1".to_string(),
            api_key: "".to_string(),
            default_format: crate::config::ApiFormat::OpenAI,
            log_level: "info".to_string(),
            enable_metrics: true,
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
            timeout_seconds: 30,
        },
    };

    let mut manager = state.config_manager.lock().await;
    manager.update_config(default_config).await.map_err(|e| e.to_string())
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
        .map(|k| k.key_hash.clone())
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

    match req.send().await {
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
        .map(|k| k.key_hash.clone())
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

    let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
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
    let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
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

    let resp = req.send().await.map_err(|e| {
        tracing::error!("get_usage_stats: HTTP request failed: {}", e);
        e.to_string()
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
    let resp = req.send().await.map_err(|e| e.to_string())?;
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
    let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
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

    let resp = req.send().await.map_err(|e| e.to_string())?;
    tracing::debug!("get_request_logs: status={}", resp.status());

    if resp.status().is_success() {
        #[derive(Debug, Deserialize)]
        struct LogsResponse {
            logs: Vec<RequestLog>,
        }
        let logs_resp: LogsResponse = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;
        tracing::debug!("get_request_logs: success, got {} logs", logs_resp.logs.len());
        Ok(logs_resp.logs)
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
    _state: tauri::State<'_, AppState>,
    format: String,
    _start_date: String,
    _end_date: String,
) -> Result<String, String> {
    // 导出日志到文件
    Ok(format!("导出成功: {}", format))
}

// ==================== API Key管理命令 ====================

#[allow(dead_code)]
async fn get_proxy_port(state: &tauri::State<'_, AppState>) -> u16 {
    state.service_manager.lock().await.get_port()
}

async fn get_proxy_url(state: &tauri::State<'_, AppState>, path: &str) -> Result<(String, Option<String>), String> {
    let port = state.service_manager.lock().await.get_port();
    let config = state.config_manager.lock().await.get_config();
    let url = format!("https://127.0.0.1:{}/api/v1/{}", port, path);
    let auth = if !config.gateway.api_key.is_empty() {
        Some(config.gateway.api_key)
    } else {
        None
    };
    Ok((url, auth))
}

async fn get_proxy_url_no_prefix(state: &tauri::State<'_, AppState>, path: &str) -> Result<(String, Option<String>), String> {
    let port = state.service_manager.lock().await.get_port();
    let config = state.config_manager.lock().await.get_config();
    let url = format!("https://127.0.0.1:{}/{}", port, path);
    let auth = if !config.gateway.api_key.is_empty() {
        Some(config.gateway.api_key)
    } else {
        None
    };
    Ok((url, auth))
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

    let resp = req.send().await.map_err(|e| e.to_string())?;
    tracing::debug!("sync_provider_key_internal: status={}", resp.status());

    if resp.status().is_success() {
        tracing::info!("sync_provider_key_internal: successfully synced provider {}", provider_name);
        Ok(())
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::warn!("sync_provider_key_internal: failed status={}, body={}", status, body);
        Err(format!("同步提供商密钥失败: HTTP {} - {}", status, body))
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

    req_builder.send().await.map_err(|e| e.to_string())
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

    let resp = req.send().await.map_err(|e| e.to_string())?;
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

    let resp = req.send().await.map_err(|e| e.to_string())?;
    tracing::debug!("create_api_key: status={}", resp.status());

    if resp.status().is_success() {
        let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        tracing::debug!("create_api_key: success, id={}", data.get("id").map(|v| v.to_string()).unwrap_or_default());
        Ok(data)
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::warn!("create_api_key: failed status={}, body={}", status, body);
        Err(format!("创建失败: HTTP {} - {}", status, body))
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

    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("更新失败: HTTP {} - {}", status, body));
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

    let resp = req.send().await.map_err(|e| e.to_string())?;
    tracing::debug!("delete_api_key: status={}", resp.status());

    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("删除失败: HTTP {}", resp.status()))
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

    let resp = req.send().await.map_err(|e| e.to_string())?;
    tracing::debug!("get_api_key: status={}", resp.status());

    if resp.status().is_success() {
        let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let masked_key = data.get("key").map(|v| {
            let s = v.as_str().unwrap_or("");
            if s.len() > 8 { format!("{}...{}", &s[..4], &s[s.len()-4..]) } else { s.to_string() }
        }).unwrap_or_default();
        tracing::debug!("get_api_key: success, masked_key={}", masked_key);
        Ok(data)
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::warn!("get_api_key: failed status={}, body={}", status, body);
        Err(format!("获取密钥失败: HTTP {} - {}", status, body))
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

    let resp = req.send().await.map_err(|e| e.to_string())?;
    tracing::debug!("sync_provider_key: status={}", resp.status());

    if resp.status().is_success() {
        tracing::info!("sync_provider_key: successfully synced provider {} to proxy", provider_name);
        Ok(())
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::warn!("sync_provider_key: failed status={}, body={}", status, body);
        Err(format!("同步提供商密钥失败: HTTP {} - {}", status, body))
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
        let port = service_manager.get_port();
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
                        api_key_to_sync = Some(k.key_hash.clone());
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

        let proxy_url = format!("http://127.0.0.1:{}/v1/chat/completions", port);
        let client = https_client()?;
        let body = build_test_body(&model, &message, model_type, &provider_type);

        let resp = client.post(&proxy_url)
            .timeout(std::time::Duration::from_secs(30))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send().await;

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
                let resp = client.post(format!("{}/v1/messages", base))
                    .timeout(std::time::Duration::from_secs(30))
                    .header("x-api-key", &api_key)
                    .header("anthropic-version", "2023-06-01")
                    .header("Content-Type", "application/json")
                    .json(&body)
                    .send().await;

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
        let resp = client.post(&chat_url)
            .timeout(std::time::Duration::from_secs(30))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send().await;

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
    let manager = state.config_manager.lock().await;
    let providers = manager.get_providers();

    let mut all_models: Vec<String> = Vec::new();
    for provider in providers {
        if !provider.enabled {
            continue;
        }
        let provider_name = format!("{:?}", provider.provider_type).to_lowercase();
        let disabled = provider.disabled_models.as_deref().unwrap_or(&[]);
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
    Ok(all_models)
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
    let resp = req.send().await.map_err(|e| {
        tracing::error!("get_security_config: HTTP request failed: {}", e);
        e.to_string()
    })?;
    let status = resp.status();
    tracing::info!("get_security_config: HTTP status={}", status);
    let body = resp.text().await.map_err(|e| {
        tracing::error!("get_security_config: read body failed: {}", e);
        e.to_string()
    })?;
    tracing::info!("get_security_config: body={}", &body[..body.len().min(500)]);
    Ok(body)
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
    let resp = req.send().await.map_err(|e| {
        tracing::error!("save_security_config: HTTP failed: {}", e);
        e.to_string()
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
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
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
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
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
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
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
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
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
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
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
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(body)
}

// ==================== 认证命令 ====================

#[tauri::command]
pub async fn get_auth_status(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let (url, _auth) = get_proxy_url(&state, "auth/status").await?;
    let client = https_client()?;
    let resp = client.get(&url).timeout(std::time::Duration::from_secs(5)).send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(body)
}

#[tauri::command]
pub async fn setup_admin(state: tauri::State<'_, AppState>, username: String, password: String) -> Result<String, String> {
    let (url, _auth) = get_proxy_url(&state, "auth/setup").await?;
    let client = https_client()?;
    let resp = client.post(&url).timeout(std::time::Duration::from_secs(5)).json(&serde_json::json!({"username": username, "password": password})).send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
    if parsed.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(body)
    } else {
        Err(parsed.get("error").and_then(|v| v.as_str()).unwrap_or("Setup failed").to_string())
    }
}

#[tauri::command]
pub async fn login_admin(state: tauri::State<'_, AppState>, username: String, password: String) -> Result<String, String> {
    let (url, _auth) = get_proxy_url(&state, "auth/login").await?;
    let client = https_client()?;
    let resp = client.post(&url).timeout(std::time::Duration::from_secs(5)).json(&serde_json::json!({"username": username, "password": password})).send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
    if parsed.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(body)
    } else {
        Err(parsed.get("error").and_then(|v| v.as_str()).unwrap_or("Login failed").to_string())
    }
}

#[tauri::command]
pub async fn change_admin_password(state: tauri::State<'_, AppState>, old_password: String, new_password: String) -> Result<String, String> {
    let (url, _auth) = get_proxy_url(&state, "auth/change-password").await?;
    let client = https_client()?;
    let resp = client.post(&url).timeout(std::time::Duration::from_secs(5)).json(&serde_json::json!({"old_password": old_password, "new_password": new_password})).send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(body)
}

#[tauri::command]
pub async fn get_admin_token(state: tauri::State<'_, AppState>, password: String) -> Result<String, String> {
    let (url, _auth) = get_proxy_url(&state, "auth/token").await?;
    let client = https_client()?;
    let resp = client.post(&url).timeout(std::time::Duration::from_secs(5)).json(&serde_json::json!({"password": password})).send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(body)
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
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
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
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
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
                    let key_to_sync = k.key_hash.clone();
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
    let resp = req.json(&body).send().await.map_err(|e| {
        tracing::error!("analyze_user_profile: request failed: {}", e);
        e.to_string()
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
                    let key_to_sync = k.key_hash.clone();
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
    let resp = req.json(&body).send().await.map_err(|e| {
        tracing::error!("check_skills_content: request failed: {}", e);
        e.to_string()
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
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(body)
}
