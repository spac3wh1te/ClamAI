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

    let config_manager = Arc::new(Mutex::new(ConfigManager::new().await?));
    info!("配置管理器初始化完成");

    let service_manager = Arc::new(Mutex::new(ServiceManager::new(config_manager.clone())));
    info!("服务管理器初始化完成");

    let app_state = AppState {
        config_manager,
        service_manager,
        token_store: Arc::new(Mutex::new(TokenStore::default())),
    };

    {
        let config = app_state.config_manager.lock().await.get_config();
        if config.setup_complete && config.deploy_mode == DeployMode::PC {
            let mut service_manager = app_state.service_manager.lock().await;
            if let Err(e) = service_manager.start_proxy_service().await {
                tracing::warn!("自动启动本地服务失败（非致命）: {}", e);
            }
        } else if config.setup_complete && config.deploy_mode == DeployMode::Server {
            let mut service_manager = app_state.service_manager.lock().await;
            if let Err(e) = service_manager.start_proxy_service().await {
                tracing::warn!("自动连接远程服务失败（非致命）: {}", e);
            }
        } else {
            info!("首次运行或未配置，等待安装向导...");
        }
    }

    info!("✅ ClamAI ready!");

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
            // OAuth命令
            start_oauth_flow,
            complete_oauth_flow,
            refresh_oauth_token,

            // 代理服务命令
            get_proxy_status,
            get_service_url,
            get_proxy_url_cmd,
            get_proxy_models,
            start_proxy_service,
            stop_proxy_service,
            restart_proxy_service,
            test_proxy_connectivity,

            // 设置/安装向导命令
            check_port_available,
            check_service_connection,
            complete_setup_with_config,
            update_gateway_ports,
            switch_deploy_mode,
            disconnect_service,

            // 系统命令
            get_app_info,
            open_log_folder,
            tauri_fetch,
        ])
        .run(tauri::generate_context!())?;

    Ok(())
}
