use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapConfig {
    pub port: u16,
    pub admin_port: u16,
    pub use_tls: bool,
    pub host: String,
    pub deploy_mode: DeployMode,
    pub setup_complete: bool,
    pub remote_service_url: Option<String>,
    pub remote_proxy_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DeployMode {
    PC,
    Server,
}

impl Default for DeployMode {
    fn default() -> Self {
        DeployMode::PC
    }
}

impl Default for BootstrapConfig {
    fn default() -> Self {
        Self {
            port: 8080,
            admin_port: 8081,
            use_tls: false,
            host: "127.0.0.1".to_string(),
            deploy_mode: DeployMode::PC,
            setup_complete: false,
            remote_service_url: None,
            remote_proxy_url: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum OAuthProviderType {
    GeminiCli,
    Antigravity,
    QwenCode,
    IFlow,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenStorage {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub token_type: String,
}

#[derive(Debug)]
pub struct ConfigManager {
    config_path: PathBuf,
    config: BootstrapConfig,
}

impl ConfigManager {
    pub async fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let config_dir = dirs::config_dir()
            .ok_or("无法获取配置目录")?;
        let app_config_dir = config_dir.join("clamai");
        fs::create_dir_all(&app_config_dir).await?;
        let config_path = app_config_dir.join("config.json");

        let config = if config_path.exists() {
            let content = fs::read_to_string(&config_path).await?;
            let mut c: BootstrapConfig = serde_json::from_str(&content)?;
            if c.admin_port == 0 {
                c.admin_port = c.port + 1;
            }
            c
        } else {
            let c = BootstrapConfig::default();
            let content = serde_json::to_string_pretty(&c)?;
            fs::write(&config_path, content).await?;
            c
        };

        Ok(Self { config_path, config })
    }

    pub fn get_config(&self) -> BootstrapConfig {
        self.config.clone()
    }

    pub async fn update_config(
        &mut self,
        config: BootstrapConfig,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let content = serde_json::to_string_pretty(&config)?;
        fs::write(&self.config_path, content).await?;
        self.config = config;
        Ok(())
    }
}
