use crate::error::{ClamAIError, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::fs;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ServiceConfig {
    pub deploy_mode: DeployMode,
    pub setup_complete: bool,
    pub remote_service_url: Option<String>,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            deploy_mode: DeployMode::PC,
            setup_complete: false,
            remote_service_url: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: String,
    pub providers: HashMap<String, ProviderConfig>,
    pub mappings: HashMap<String, ModelMapping>,
    pub gateway: GatewayConfig,
    pub ui: UiConfig,
    pub advanced: AdvancedConfig,
    #[serde(default)]
    pub service: ServiceConfig,
    #[serde(default = "default_active_profile")]
    pub active_profile: String,
    #[serde(default)]
    pub profiles: HashMap<String, ConfigProfile>,
}

fn default_active_profile() -> String {
    "default".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub provider_type: ProviderType,
    #[serde(default)]
    pub auth_type: AuthType,  // API Key 或 OAuth, 默认ApiKey
    pub enabled: bool,
    pub base_url: String,
    pub api_keys: Vec<ApiKeyInfo>,
    pub models: Vec<String>,
    pub disabled_models: Option<Vec<String>>,
    pub oauth_config: Option<OAuthConfig>,
    pub rate_limits: Option<RateLimits>,
    pub priority: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyInfo {
    pub id: String,
    #[serde(alias = "key_hash")]
    pub key_value: String,
    pub name: String,
    pub is_active: bool,
    #[serde(default)]
    pub allowed_models: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub last_used: Option<DateTime<Utc>>,
    pub usage_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthConfig {
    pub provider_type: OAuthProviderType,
    pub client_id: String,
    pub redirect_uri: String,
    pub scopes: Vec<String>,
    pub tokens: Option<TokenStorage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenStorage {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: DateTime<Utc>,
    pub token_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimits {
    pub requests_per_minute: Option<i32>,
    pub requests_per_day: Option<i32>,
    pub tokens_per_minute: Option<i32>,
    pub concurrent_requests: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMapping {
    pub alias: String,
    pub provider_id: String,
    pub model: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfig {
    pub port: u16,
    pub host: String,
    pub api_key: String,
    pub log_level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    pub theme: String,
    pub language: String,
    #[serde(default = "default_timezone")]
    pub timezone: String,
    pub auto_start: bool,
    pub minimize_to_tray: bool,
    pub show_notifications: bool,
}

fn default_timezone() -> String {
    "Asia/Shanghai".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedConfig {
    pub proxy_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigProfile {
    pub name: String,
    pub providers: HashMap<String, ProviderConfig>,
    pub mappings: HashMap<String, ModelMapping>,
    pub gateway: GatewayConfig,
    pub advanced: AdvancedConfig,
    #[serde(default)]
    pub service: ServiceConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderType {
    OpenAI,
    Anthropic,
    Gemini,
    DeepSeek,
    MiniMax,
    SiliconFlow,
    Glm,
    Doubao,
    Qwen,
    Moonshot,
    Yi,
    OpenRouter,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AuthType {
    #[default]
    ApiKey,
    OAuth,
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

#[derive(Debug)]
pub struct ConfigManager {
    config_path: PathBuf,
    config: AppConfig,
}

impl ConfigManager {
    pub async fn new() -> Result<Self> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| ClamAIError::Config("无法获取配置目录".to_string()))?;

        let app_config_dir = config_dir.join("clamai");
        fs::create_dir_all(&app_config_dir).await?;

        let config_path = app_config_dir.join("config.json");

        let config = if config_path.exists() {
            let mut c = Self::load_config(&config_path).await?;
            if !c.service.setup_complete && (!c.providers.is_empty() || c.gateway.port > 0) {
                c.service.setup_complete = true;
                c.service.deploy_mode = DeployMode::PC;
            }
            if c.profiles.is_empty() {
                c.profiles.insert(
                    "default".to_string(),
                    ConfigProfile {
                        name: "默认".to_string(),
                        providers: c.providers.clone(),
                        mappings: c.mappings.clone(),
                        gateway: c.gateway.clone(),
                        advanced: c.advanced.clone(),
                        service: c.service.clone(),
                    },
                );
                c.active_profile = "default".to_string();
            }
            let _ = Self::save_config(&config_path, &c).await;
            c
        } else {
            let default_config = Self::default_config();
            Self::save_config(&config_path, &default_config).await?;
            default_config
        };

        Ok(Self {
            config_path,
            config,
        })
    }

    async fn load_config(path: &PathBuf) -> Result<AppConfig> {
        let content = fs::read_to_string(path).await?;
        let config: AppConfig = serde_json::from_str(&content)?;
        Ok(config)
    }

    async fn save_config(path: &PathBuf, config: &AppConfig) -> Result<()> {
        let content = serde_json::to_string_pretty(config)?;
        fs::write(path, content).await?;
        Ok(())
    }

    fn default_config() -> AppConfig {
        AppConfig {
            version: "1.0.0".to_string(),
            providers: HashMap::new(),
            mappings: HashMap::new(),
            gateway: GatewayConfig {
                port: 8080,
                host: "127.0.0.1".to_string(),
                api_key: "".to_string(),
                log_level: "info".to_string(),
            },
            ui: UiConfig {
                theme: "dark".to_string(),
                language: "zh-CN".to_string(),
                timezone: "Asia/Shanghai".to_string(),
                auto_start: false,
                minimize_to_tray: true,
                show_notifications: true,
            },
            advanced: AdvancedConfig {
                proxy_url: None,
            },
            service: ServiceConfig::default(),
            active_profile: "default".to_string(),
            profiles: HashMap::new(),
        }
    }

    pub fn get_config(&self) -> AppConfig {
        self.config.clone()
    }

    pub async fn update_config(&mut self, config: AppConfig) -> Result<()> {
        Self::save_config(&self.config_path, &config).await?;
        self.config = config;
        Ok(())
    }

    pub fn get_providers(&self) -> Vec<ProviderConfig> {
        self.config.providers.values().cloned().collect()
    }

    pub fn get_provider(&self, id: &str) -> Option<ProviderConfig> {
        self.config.providers.get(id).cloned()
    }

    pub async fn add_provider(&mut self, provider: ProviderConfig) -> Result<()> {
        self.config.providers.insert(provider.id.clone(), provider);
        self.update_config(self.config.clone()).await?;
        Ok(())
    }

    pub async fn remove_provider(&mut self, id: &str) -> Result<()> {
        self.config.providers.remove(id);
        self.update_config(self.config.clone()).await?;
        Ok(())
    }

    pub async fn update_provider(&mut self, provider: ProviderConfig) -> Result<()> {
        self.config.providers.insert(provider.id.clone(), provider);
        self.update_config(self.config.clone()).await?;
        Ok(())
    }

    pub fn get_mappings(&self) -> Vec<ModelMapping> {
        self.config.mappings.values().cloned().collect()
    }

    pub async fn add_mapping(&mut self, mapping: ModelMapping) -> Result<()> {
        self.config.mappings.insert(mapping.alias.clone(), mapping);
        self.update_config(self.config.clone()).await?;
        Ok(())
    }

    pub async fn remove_mapping(&mut self, alias: &str) -> Result<()> {
        self.config.mappings.remove(alias);
        self.update_config(self.config.clone()).await?;
        Ok(())
    }

    pub fn get_gateway_config(&self) -> GatewayConfig {
        self.config.gateway.clone()
    }

    pub async fn update_gateway_config(&mut self, config: GatewayConfig) -> Result<()> {
        self.config.gateway = config;
        self.update_config(self.config.clone()).await?;
        Ok(())
    }

    pub fn get_active_profile(&self) -> &str {
        &self.config.active_profile
    }

    pub fn list_profiles(&self) -> Vec<(String, String)> {
        self.config
            .profiles
            .iter()
            .map(|(id, p)| (id.clone(), p.name.clone()))
            .collect()
    }

    pub async fn save_current_as_profile(&mut self, profile_id: String, display_name: String) -> Result<()> {
        let snapshot = ConfigProfile {
            name: display_name,
            providers: self.config.providers.clone(),
            mappings: self.config.mappings.clone(),
            gateway: self.config.gateway.clone(),
            advanced: self.config.advanced.clone(),
            service: self.config.service.clone(),
        };
        self.config.profiles.insert(profile_id, snapshot);
        self.update_config(self.config.clone()).await?;
        Ok(())
    }

    pub async fn load_profile(&mut self, profile_id: &str) -> Result<()> {
        let snapshot = self
            .config
            .profiles
            .get(profile_id)
            .ok_or_else(|| ClamAIError::Config(format!("配置档案 {} 不存在", profile_id)))?
            .clone();

        self.config.providers = snapshot.providers;
        self.config.mappings = snapshot.mappings;
        self.config.gateway = snapshot.gateway;
        self.config.advanced = snapshot.advanced;
        self.config.service = snapshot.service;
        self.config.active_profile = profile_id.to_string();
        self.update_config(self.config.clone()).await?;
        Ok(())
    }

    pub async fn delete_profile(&mut self, profile_id: &str) -> Result<()> {
        if profile_id == self.config.active_profile {
            return Err(ClamAIError::Config("不能删除当前正在使用的配置档案".to_string()));
        }
        self.config.profiles.remove(profile_id);
        self.update_config(self.config.clone()).await?;
        Ok(())
    }

    pub async fn rename_profile(&mut self, profile_id: &str, new_name: String) -> Result<()> {
        let profile = self
            .config
            .profiles
            .get_mut(profile_id)
            .ok_or_else(|| ClamAIError::Config(format!("配置档案 {} 不存在", profile_id)))?;
        profile.name = new_name;
        self.update_config(self.config.clone()).await?;
        Ok(())
    }
}
