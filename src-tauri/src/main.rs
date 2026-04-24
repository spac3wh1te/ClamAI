// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
pub mod error;
mod services;
mod proxy;
mod oauth;

use commands::*;
use config::ConfigManager;
use config::DeployMode;
use services::ServiceManager;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;
use tracing::info;
use tracing_subscriber;
use tracing_subscriber::prelude::*;

#[derive(Debug, Clone, Default)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Default)]
pub struct TokenStore {
    pub tokens: Option<TokenPair>,
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub config_manager: Arc<Mutex<ConfigManager>>,
    pub service_manager: Arc<Mutex<ServiceManager>>,
    pub token_store: Arc<Mutex<TokenStore>>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let exe_dir = std::env::current_exe()?;
    let log_dir = exe_dir.parent().unwrap_or(std::path::Path::new("."));
    let log_path = log_dir.join("clam-running.log");

    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)?;

    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::sync::Mutex::new(log_file))
        .with_ansi(false)
        .with_target(false);

    let console_layer = tracing_subscriber::fmt::layer()
        .with_target(false);

    tracing_subscriber::registry()
                .with(tracing_subscriber::EnvFilter::new("clamai=debug,info"))
        .with(file_layer)
        .with(console_layer)
        .init();

    info!("====== ClamAI starting up ======");
    info!("日志文件: {}", log_path.display());
    info!("可执行文件路径: {}", exe_dir.display());

    // 初始化配置管理器
    let config_manager = Arc::new(Mutex::new(ConfigManager::new().await?));
    info!("配置管理器初始化完成");

    // 初始化服务管理器
    let service_manager = Arc::new(Mutex::new(ServiceManager::new(config_manager.clone())));
    info!("服务管理器初始化完成");

    let app_state = AppState {
        config_manager,
        service_manager,
        token_store: Arc::new(Mutex::new(TokenStore::default())),
    };

    // 根据部署模式决定是否自动启动服务
    {
        let config = app_state.config_manager.lock().await.get_config();
        if config.service.setup_complete && config.service.deploy_mode == DeployMode::PC {
            let mut service_manager = app_state.service_manager.lock().await;
            if let Err(e) = service_manager.start_proxy_service().await {
                tracing::warn!("自动启动本地服务失败（非致命）: {}", e);
            } else {
                drop(service_manager);
                let providers = app_state.config_manager.lock().await.get_providers();
                let port = app_state.config_manager.lock().await.get_config().gateway.port;
                let base_url = format!("https://127.0.0.1:{}", port);
                let client = crate::commands::https_client_for_url(&base_url);
                if let Ok(client) = client {
                    for provider in providers {
                        if !provider.enabled {
                            continue;
                        }
                        if let Some(api_key) = provider.api_keys.iter().find(|k| k.is_active) {
                            let provider_name = format!("{:?}", provider.provider_type).to_lowercase();
                            let api_key_value = api_key.key_value.clone();
                            let url = format!("{}/api/v1/providers/{}/key", base_url, provider_name);
                            let client = client.clone();
                            tokio::spawn(async move {
                                match client.put(&url)
                                    .timeout(std::time::Duration::from_secs(5))
                                    .json(&serde_json::json!({ "api_key": api_key_value }))
                                    .send().await
                                {
                                    Ok(resp) if resp.status().is_success() => {
                                        tracing::info!("自动同步提供商 {} 密钥成功", provider_name);
                                    }
                                    Ok(resp) => {
                                        tracing::warn!("自动同步提供商 {} 密钥失败: HTTP {}", provider_name, resp.status());
                                    }
                                    Err(e) => {
                                        tracing::warn!("自动同步提供商 {} 密钥失败: {}", provider_name, e);
                                    }
                                }
                            });
                        }
                    }
                }
            }
        } else {
            info!("等待安装向导或手动连接服务...");
        }
    }

    info!("✅ ClamAI ready!");

    // 构建Tauri应用
    let _app_handle = tauri::Builder::default()
        .manage(app_state)
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event.event() {
                let app = event.window().app_handle();
                let app_state = app.state::<AppState>();
                let service_manager = app_state.service_manager.clone();
                tauri::async_runtime::spawn(async move {
                    let mut sm = service_manager.lock().await;
                    let _ = sm.stop_proxy_service().await;
                    tracing::info!("ClamAI exiting, proxy service stopped");
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 配置管理命令
            get_config,
            save_config,
            reset_config,

            // 提供商管理命令
            get_providers,
            add_provider,
            remove_provider,
            update_provider,
            toggle_model,
            test_provider,
            fetch_provider_models,

            // OAuth命令
            start_oauth_flow,
            complete_oauth_flow,
            refresh_oauth_token,

            // 代理服务命令
            get_proxy_status,
            start_proxy_service,
            stop_proxy_service,
            restart_proxy_service,
            test_proxy_connectivity,

            // 统计监控命令
            get_usage_stats,
            get_alert_stats,
            get_request_logs,
            export_logs,
            get_caller_top10,
            get_security_token_stats,

            // API Key管理命令
            list_api_keys,
            create_api_key,
            update_api_key,
            delete_api_key,
            get_api_key,
            sync_provider_key,

            // 测试命令
            test_chat_request,
            get_proxy_models,

            // 系统命令
            get_app_info,
            open_log_folder,
            check_updates,

            // 安全管理命令
            get_security_config,
            save_security_config,
            get_security_alerts,
            resolve_security_alert,
            check_content_safety,

            // 向量样本管理命令
            get_vector_samples,
            add_vector_sample,
            delete_vector_sample,
            get_vector_config,

            // 认证命令
            get_auth_status,
            setup_admin,
            login_admin,
            change_admin_password,
            get_admin_token,

            // 限流命令
            get_ratelimit_config,
            save_ratelimit_config,

            // 安全广场分析命令
            analyze_user_profile,
            check_skills_content,
            get_skills_detection_history,
            get_profile_analysis_history,

            // 分析任务管理命令
            create_analysis_task,
            list_analysis_tasks,
            delete_analysis_task,
            update_analysis_task,
            start_analysis_task,
            stop_analysis_task,

            // 智能体安全命令
            scan_agent_logs,
            check_agent_env,

            // 模型列表增强
            get_proxy_models_with_info,

            // 配置档案命令
            list_profiles,
            save_current_as_profile,
            load_profile,
            delete_profile,
            rename_profile,

            // 安装向导和服务连接命令
            get_setup_state,
            check_service_connection,
            complete_setup,
            connect_service,
            disconnect_service,
            switch_deploy_mode,
            init_remote_server,
        ])
        .run(tauri::generate_context!())?;

    Ok(())
}
