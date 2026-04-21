use crate::config::{OAuthProviderType, TokenStorage};
use crate::error::{ClamAIError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthState {
    pub state_id: String,
    pub provider_type: OAuthProviderType,
    pub auth_url: String,
    pub redirect_uri: String,
    pub code_verifier: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthCallback {
    pub state_id: String,
    pub code: String,
    pub state_param: Option<String>,
}

pub struct OAuthManager {
    pending_flows: Mutex<HashMap<String, OAuthState>>,
    #[allow(dead_code)]
    config_manager: std::sync::Arc<tokio::sync::Mutex<crate::config::ConfigManager>>,
}

impl OAuthManager {
    pub fn new(config_manager: std::sync::Arc<tokio::sync::Mutex<crate::config::ConfigManager>>) -> Self {
        Self {
            pending_flows: Mutex::new(HashMap::new()),
            config_manager,
        }
    }

    /// 开始OAuth认证流程
    pub async fn start_oauth_flow(
        &self,
        provider_type: OAuthProviderType,
        redirect_uri: String,
    ) -> Result<OAuthState> {
        let state_id = uuid::Uuid::new_v4().to_string();

        match provider_type {
            OAuthProviderType::GeminiCli => {
                self.start_gemini_oauth(state_id, redirect_uri).await
            }
            OAuthProviderType::Antigravity => {
                self.start_antigravity_oauth(state_id, redirect_uri).await
            }
            OAuthProviderType::QwenCode => {
                self.start_qwen_oauth(state_id, redirect_uri).await
            }
            OAuthProviderType::IFlow => {
                self.start_iflow_oauth(state_id, redirect_uri).await
            }
            OAuthProviderType::Custom => {
                Err(ClamAIError::OAuth("不支持的OAuth提供商".to_string()))
            }
        }
    }

    async fn start_gemini_oauth(&self, state_id: String, redirect_uri: String) -> Result<OAuthState> {
        // Google OAuth 2.0 流程
        let auth_url = format!(
            "https://accounts.google.com/o/oauth2/v2/auth?\
             client_id={}&\
             redirect_uri={}\
             response_type=code\
             scope={}&\
             state={}",
            "your-client-id", // 实际应用中从配置读取
            urlencoding::encode(&redirect_uri),
            urlencoding::encode("https://www.googleapis.com/auth/generative.language.tts"),
            state_id
        );

        let oauth_state = OAuthState {
            state_id: state_id.clone(),
            provider_type: OAuthProviderType::GeminiCli,
            auth_url,
            redirect_uri,
            code_verifier: None,
            created_at: chrono::Utc::now(),
        };

        // 保存状态
        let mut flows = self.pending_flows.lock().await;
        flows.insert(state_id.clone(), oauth_state.clone());

        // 打开浏览器
        open::that(&oauth_state.auth_url)?;

        Ok(oauth_state)
    }

    async fn start_antigravity_oauth(&self, state_id: String, redirect_uri: String) -> Result<OAuthState> {
        // Antigravity OAuth (基于Google内部API)
        let auth_url = format!(
            "https://accounts.google.com/o/oauth2/v2/auth?\
             client_id={}&\
             redirect_uri={}\
             response_type=code\
             scope={}&\
             state={}",
            "antigravity-client-id",
            urlencoding::encode(&redirect_uri),
            urlencoding::encode("openid email profile"),
            state_id
        );

        let oauth_state = OAuthState {
            state_id: state_id.clone(),
            provider_type: OAuthProviderType::Antigravity,
            auth_url,
            redirect_uri,
            code_verifier: None,
            created_at: chrono::Utc::now(),
        };

        let mut flows = self.pending_flows.lock().await;
        flows.insert(state_id.clone(), oauth_state.clone());

        open::that(&oauth_state.auth_url)?;

        Ok(oauth_state)
    }

    async fn start_qwen_oauth(&self, state_id: String, redirect_uri: String) -> Result<OAuthState> {
        // Qwen Code OAuth Device Flow
        let oauth_state = OAuthState {
            state_id: state_id.clone(),
            provider_type: OAuthProviderType::QwenCode,
            auth_url: "https://qwen-api.aliyun.com/device/code".to_string(),
            redirect_uri,
            code_verifier: None,
            created_at: chrono::Utc::now(),
        };

        let mut flows = self.pending_flows.lock().await;
        flows.insert(state_id.clone(), oauth_state.clone());

        Ok(oauth_state)
    }

    async fn start_iflow_oauth(&self, state_id: String, redirect_uri: String) -> Result<OAuthState> {
        // iFlow OAuth (需要本地回调服务器)
        let oauth_state = OAuthState {
            state_id: state_id.clone(),
            provider_type: OAuthProviderType::IFlow,
            auth_url: format!("https://iflow-api.com/oauth/authorize?redirect_uri={}&state={}",
                urlencoding::encode(&redirect_uri), state_id),
            redirect_uri,
            code_verifier: None,
            created_at: chrono::Utc::now(),
        };

        let mut flows = self.pending_flows.lock().await;
        flows.insert(state_id.clone(), oauth_state.clone());

        open::that(&oauth_state.auth_url)?;

        Ok(oauth_state)
    }

    /// 完成OAuth流程，用code换取token
    pub async fn complete_oauth_flow(&self, callback: OAuthCallback) -> Result<TokenStorage> {
        let flows = self.pending_flows.lock().await;
        let oauth_state = flows.get(&callback.state_id)
            .ok_or_else(|| ClamAIError::OAuth("无效的state ID".to_string()))?;

        match oauth_state.provider_type {
            OAuthProviderType::GeminiCli => {
                self.exchange_gemini_token(oauth_state, &callback.code).await
            }
            OAuthProviderType::Antigravity => {
                self.exchange_antigravity_token(oauth_state, &callback.code).await
            }
            OAuthProviderType::QwenCode => {
                self.exchange_qwen_token(oauth_state, &callback.code).await
            }
            OAuthProviderType::IFlow => {
                self.exchange_iflow_token(oauth_state, &callback.code).await
            }
            OAuthProviderType::Custom => {
                Err(ClamAIError::OAuth("不支持的OAuth提供商".to_string()))
            }
        }
    }

    async fn exchange_gemini_token(&self, state: &OAuthState, code: &str) -> Result<TokenStorage> {
        // 调用Google token endpoint交换access token
        let client = reqwest::Client::new();
        let response = client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("code", code),
                ("client_id", "your-client-id"),
                ("client_secret", "your-client-secret"),
                ("redirect_uri", &state.redirect_uri),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?;

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            refresh_token: String,
            expires_in: u64,
            token_type: String,
        }

        let token_response: TokenResponse = response.json().await?;

        Ok(TokenStorage {
            access_token: token_response.access_token,
            refresh_token: token_response.refresh_token,
            expires_at: chrono::Utc::now() + chrono::Duration::seconds(token_response.expires_in as i64),
            token_type: token_response.token_type,
        })
    }

    async fn exchange_antigravity_token(&self, state: &OAuthState, code: &str) -> Result<TokenStorage> {
        // Antigravity token exchange (类似Gemini但使用不同的endpoint)
        let client = reqwest::Client::new();
        let response = client
            .post("https://antigravity-api.googleapis.com/token")
            .form(&[
                ("code", code),
                ("client_id", "antigravity-client-id"),
                ("client_secret", "antigravity-client-secret"),
                ("redirect_uri", &state.redirect_uri),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?;

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            refresh_token: String,
            expires_in: u64,
            token_type: String,
        }

        let token_response: TokenResponse = response.json().await?;

        Ok(TokenStorage {
            access_token: token_response.access_token,
            refresh_token: token_response.refresh_token,
            expires_at: chrono::Utc::now() + chrono::Duration::seconds(token_response.expires_in as i64),
            token_type: token_response.token_type,
        })
    }

    async fn exchange_qwen_token(&self, _state: &OAuthState, code: &str) -> Result<TokenStorage> {
        // Qwen token exchange
        let client = reqwest::Client::new();
        let response = client
            .post("https://qwen-api.aliyun.com/oauth/token")
            .form(&[
                ("code", code),
                ("client_id", "qwen-client-id"),
                ("client_secret", "qwen-client-secret"),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?;

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            refresh_token: String,
            expires_in: u64,
        }

        let token_response: TokenResponse = response.json().await?;

        Ok(TokenStorage {
            access_token: token_response.access_token,
            refresh_token: token_response.refresh_token,
            expires_at: chrono::Utc::now() + chrono::Duration::seconds(token_response.expires_in as i64),
            token_type: "Bearer".to_string(),
        })
    }

    async fn exchange_iflow_token(&self, state: &OAuthState, code: &str) -> Result<TokenStorage> {
        // iFlow token exchange
        let client = reqwest::Client::new();
        let response = client
            .post("https://iflow-api.com/oauth/token")
            .form(&[
                ("code", code),
                ("client_id", "iflow-client-id"),
                ("client_secret", "iflow-client-secret"),
                ("redirect_uri", &state.redirect_uri),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?;

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            refresh_token: String,
            expires_in: u64,
        }

        let token_response: TokenResponse = response.json().await?;

        Ok(TokenStorage {
            access_token: token_response.access_token,
            refresh_token: token_response.refresh_token,
            expires_at: chrono::Utc::now() + chrono::Duration::seconds(token_response.expires_in as i64),
            token_type: "Bearer".to_string(),
        })
    }

    /// 刷新过期的token
    pub async fn refresh_token(&self, token_storage: &TokenStorage) -> Result<TokenStorage> {
        // 这里可以实现通用的token刷新逻辑
        // 大多数OAuth提供商都使用标准的refresh token流程

        let client = reqwest::Client::new();
        let response = client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("refresh_token", &token_storage.refresh_token),
                ("client_id", &"your-client-id".to_string()),
                ("client_secret", &"your-client-secret".to_string()),
                ("grant_type", &"refresh_token".to_string()),
            ])
            .send()
            .await?;

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            refresh_token: Option<String>,
            expires_in: u64,
            token_type: String,
        }

        let token_response: TokenResponse = response.json().await?;

        Ok(TokenStorage {
            access_token: token_response.access_token,
            refresh_token: token_response.refresh_token.unwrap_or_else(|| token_storage.refresh_token.clone()),
            expires_at: chrono::Utc::now() + chrono::Duration::seconds(token_response.expires_in as i64),
            token_type: token_response.token_type,
        })
    }
}
