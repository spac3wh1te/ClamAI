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
use services::ServiceManager;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;
use tracing::info;
use tracing_subscriber;
use tracing_subscriber::prelude::*;

#[derive(Debug, Clone)]
pub struct AppState {
    pub config_manager: Arc<Mutex<ConfigManager>>,
    pub service_manager: Arc<Mutex<ServiceManager>>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let exe_dir = std::env::current_exe()?;
    let log_dir = exe_dir.parent().unwrap_or(std::path::Path::new("."));
    let log_path = log_dir.join("clam-running.log");

    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
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
    };

    // 启动Go代理服务
    {
        let mut service_manager = app_state.service_manager.lock().await;
        service_manager.start_proxy_service().await?;
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
        ])
        .run(tauri::generate_context!())?;

    Ok(())
}
