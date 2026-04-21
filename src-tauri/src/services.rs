use crate::config::ConfigManager;
use crate::error::{ClamAIError, Result};
use crate::proxy::ProxyService;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::process::Child;
use tokio::sync::Mutex;

type ConfigManagerHandle = Arc<Mutex<ConfigManager>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub proxy_running: bool,
    pub proxy_port: u16,
    pub uptime_seconds: u64,
    pub active_connections: u32,
    pub total_requests: u64,
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

    pub async fn start_proxy_service(&mut self) -> Result<()> {
        tracing::info!("[ServiceManager] 开始启动代理服务...");
        let config = self.config_manager.lock().await.get_config();
        let gateway = &config.gateway;
        tracing::info!("[ServiceManager] 获取网关配置: port={}, host={}", gateway.port, gateway.host);

        // 检查是否已经在运行
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

        // 保存进程句柄
        let mut process_guard = self.proxy_process.lock().await;
        *process_guard = Some(child);
        tracing::info!("[ServiceManager] 进程句柄已保存");

        // 更新统计信息
        let mut stats = self.stats.lock().await;
        stats.start_time = Some(chrono::Utc::now());

        tracing::info!("✅ 代理服务启动成功，监听端口: {}", start_config.port);
        Ok(())
    }

    pub async fn stop_proxy_service(&mut self) -> Result<()> {
        // 停止进程
        let mut process_guard = self.proxy_process.lock().await;
        if let Some(mut child) = process_guard.take() {
            child.kill().await?;
            tracing::info!("⏹️ 代理服务已停止");
        }

        // 重置统计信息
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

    pub async fn get_service_status(&self) -> ServiceStatus {
        let process_guard = self.proxy_process.lock().await;
        let is_running = process_guard.is_some();

        let stats = self.stats.lock().await;
        let uptime = stats.start_time
            .map(|start| {
                (chrono::Utc::now() - start).num_seconds() as u64
            })
            .unwrap_or(0);

        ServiceStatus {
            proxy_running: is_running,
            proxy_port: self.config_manager.lock().await.get_config().gateway.port,
            uptime_seconds: uptime,
            active_connections: stats.active_connections,
            total_requests: stats.total_requests,
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
