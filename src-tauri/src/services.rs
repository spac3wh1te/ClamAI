use crate::config::{ConfigManager, DeployMode};
use crate::error::{ClamAIError, Result};
use crate::proxy::ProxyService;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::process::Child;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

type ConfigManagerHandle = Arc<Mutex<ConfigManager>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub proxy_running: bool,
    pub proxy_port: u16,
    pub uptime_seconds: u64,
    pub active_connections: u32,
    pub total_requests: u64,
    pub deploy_mode: String,
    pub service_url: String,
}

#[derive(Debug)]
pub struct ServiceManager {
    config_manager: ConfigManagerHandle,
    proxy_service: Arc<Mutex<ProxyService>>,
    proxy_process: Arc<Mutex<Option<Child>>>,
    stats: Arc<Mutex<ServiceStats>>,
}

#[derive(Debug, Default)]
struct ServiceStats {
    start_time: Option<chrono::DateTime<chrono::Utc>>,
    total_requests: u64,
    active_connections: u32,
}

impl ServiceManager {
    pub fn new(config_manager: ConfigManagerHandle) -> Self {
        Self {
            config_manager,
            proxy_service: Arc::new(Mutex::new(ProxyService::new())),
            proxy_process: Arc::new(Mutex::new(None)),
            stats: Arc::new(Mutex::new(ServiceStats::default())),
        }
    }

    pub fn get_service_url(&self) -> String {
        match self.config_manager.try_lock() {
            Ok(mgr) => {
                let config = mgr.get_config();
                match config.service.deploy_mode {
                    DeployMode::PC => format!("https://127.0.0.1:{}", config.gateway.port),
                    DeployMode::Server => {
                        config.service.remote_service_url.clone()
                            .unwrap_or_else(|| format!("https://127.0.0.1:{}", config.gateway.port))
                    }
                }
            }
            Err(_) => "https://127.0.0.1:8080".to_string(),
        }
    }

    pub async fn start_proxy_service(&mut self) -> Result<()> {
        let config = self.config_manager.lock().await.get_config();
        match config.service.deploy_mode {
            DeployMode::PC => self.start_local_service(&config).await,
            DeployMode::Server => {
                if config.service.remote_service_url.is_none() {
                    return Err(ClamAIError::ProxyService("Server模式下未配置远程服务地址".to_string()));
                }
                let remote_url = config.service.remote_service_url.as_ref().unwrap().trim_end_matches('/');
                let check_url = format!("{}/health", remote_url);
                tracing::info!("[ServiceManager] Server模式：检查远程服务 {}", check_url);

                let client = crate::commands::https_client_for_url(remote_url)
                    .map_err(|e| ClamAIError::ProxyService(format!("创建HTTP客户端失败: {}", e)))?;

                match timeout(Duration::from_secs(10), client.get(&check_url).send()).await {
                    Ok(Ok(resp)) if resp.status().is_success() => {
                        tracing::info!("[ServiceManager] 远程服务健康检查成功");
                        let mut stats = self.stats.lock().await;
                        stats.start_time = Some(chrono::Utc::now());
                        Ok(())
                    }
                    Ok(Ok(resp)) => {
                        let status = resp.status();
                        if status == 401 || status == 403 {
                            tracing::info!("[ServiceManager] 远程服务存在但需要认证");
                            let mut stats = self.stats.lock().await;
                            stats.start_time = Some(chrono::Utc::now());
                            return Ok(());
                        }
                        Err(ClamAIError::ProxyService(format!("远程服务返回状态码: {}", status)))
                    }
                    Ok(Err(e)) => {
                        Err(ClamAIError::ProxyService(format!("连接远程服务失败: {}", e)))
                    }
                    Err(_) => {
                        Err(ClamAIError::ProxyService("连接远程服务超时".to_string()))
                    }
                }
            }
        }
    }

    async fn start_local_service(&mut self, config: &crate::config::AppConfig) -> Result<()> {
        tracing::info!("[ServiceManager] PC模式：启动本地代理服务...");
        let gateway = &config.gateway;
        tracing::info!("[ServiceManager] 获取网关配置: port={}, host={}", gateway.port, gateway.host);

        {
            let process_guard = self.proxy_process.lock().await;
            if process_guard.is_some() {
                tracing::warn!("[ServiceManager] 代理服务已在运行中，拒绝重复启动");
                return Err(ClamAIError::ProxyService("代理服务已在运行中".to_string()));
            }
        }

        tracing::info!("[ServiceManager] 启动Go代理进程...");

        let start_config = crate::proxy::ProxyStartConfig {
            port: gateway.port,
            host: gateway.host.clone(),
            api_key: gateway.api_key.clone(),
            log_level: gateway.log_level.clone(),
            proxy_url: config.advanced.proxy_url.clone(),
        };
        let mut proxy_service = self.proxy_service.lock().await;
        let child = proxy_service.start(&start_config).await?;
        tracing::info!("[ServiceManager] Go代理进程已启动，获取到child");

        let mut process_guard = self.proxy_process.lock().await;
        *process_guard = Some(child);
        tracing::info!("[ServiceManager] 进程句柄已保存");

        let mut stats = self.stats.lock().await;
        stats.start_time = Some(chrono::Utc::now());

        tracing::info!("✅ 本地代理服务启动成功，监听端口: {}", start_config.port);
        Ok(())
    }

    pub async fn stop_proxy_service(&mut self) -> Result<()> {
        let config = self.config_manager.lock().await.get_config();
        match config.service.deploy_mode {
            DeployMode::PC => {
                let mut process_guard = self.proxy_process.lock().await;
                if let Some(mut child) = process_guard.take() {
                    child.kill().await?;
                    tracing::info!("⏹️ 本地代理服务已停止");
                }
            }
            DeployMode::Server => {
                tracing::info!("⏹️ 已断开远程服务连接");
            }
        }

        let mut stats = self.stats.lock().await;
        stats.start_time = None;
        stats.active_connections = 0;

        Ok(())
    }

    pub async fn restart_proxy_service(&mut self) -> Result<()> {
        self.stop_proxy_service().await?;
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        self.start_proxy_service().await?;
        Ok(())
    }

    pub fn get_port(&self) -> u16 {
        match self.config_manager.try_lock() {
            Ok(mgr) => mgr.get_config().gateway.port,
            Err(_) => 8080,
        }
    }

    pub fn get_deploy_mode(&self) -> DeployMode {
        match self.config_manager.try_lock() {
            Ok(mgr) => mgr.get_config().service.deploy_mode.clone(),
            Err(_) => DeployMode::PC,
        }
    }

    pub async fn get_service_status(&self) -> ServiceStatus {
        let config = self.config_manager.lock().await.get_config();
        let process_guard = self.proxy_process.lock().await;

        let is_running = match config.service.deploy_mode {
            DeployMode::PC => process_guard.is_some(),
            DeployMode::Server => {
                if config.service.remote_service_url.is_none() {
                    false
                } else {
                    let remote_url = config.service.remote_service_url.as_ref().unwrap().trim_end_matches('/');
                    let check_url = format!("{}/health", remote_url);
                    if let Ok(client) = crate::commands::https_client_for_url(remote_url) {
                        match timeout(Duration::from_secs(5), client.get(&check_url).send()).await {
                            Ok(Ok(resp)) if resp.status().is_success() => true,
                            _ => false,
                        }
                    } else {
                        false
                    }
                }
            }
        };

        let stats = self.stats.lock().await;
        let uptime = stats.start_time
            .map(|start| {
                (chrono::Utc::now() - start).num_seconds() as u64
            })
            .unwrap_or(0);

        let service_url = match config.service.deploy_mode {
            DeployMode::PC => format!("https://127.0.0.1:{}", config.gateway.port),
            DeployMode::Server => config.service.remote_service_url.clone()
                .unwrap_or_default(),
        };

        ServiceStatus {
            proxy_running: is_running,
            proxy_port: config.gateway.port,
            uptime_seconds: uptime,
            active_connections: stats.active_connections,
            total_requests: stats.total_requests,
            deploy_mode: match config.service.deploy_mode {
                DeployMode::PC => "pc".to_string(),
                DeployMode::Server => "server".to_string(),
            },
            service_url,
        }
    }

    pub async fn increment_request_count(&self) {
        let mut stats = self.stats.lock().await;
        stats.total_requests += 1;
    }

    pub async fn update_connections(&self, count: u32) {
        let mut stats = self.stats.lock().await;
        stats.active_connections = count;
    }
}
