use crate::error::{ClamAIError, Result};
use tokio::process::Child;
use tokio::process::Command;

#[derive(Debug)]
pub struct ProxyStartConfig {
    pub port: u16,
    pub host: String,
    pub api_key: String,
    pub log_level: String,
    pub proxy_url: Option<String>,
}

#[derive(Debug)]
pub struct ProxyService {}

impl ProxyService {
    pub fn new() -> Self {
        Self {}
    }

    pub async fn start(&mut self, config: &ProxyStartConfig) -> Result<Child> {
        tracing::info!("[ProxyService] 开始启动...");
        let proxy_binary = self.get_proxy_binary_path()?;
        tracing::info!("[ProxyService] 代理二进制路径: {}", proxy_binary.display());

        if !proxy_binary.exists() {
            tracing::error!("[ProxyService] 代理二进制文件不存在: {}", proxy_binary.display());
            return Err(ClamAIError::ProxyService(format!("代理二进制文件不存在: {}", proxy_binary.display())));
        }

        tracing::info!("[ProxyService] 构建Command，启动参数: port={}, host={}, api_key={}, log_level={}, proxy={}, mode=pc",
            config.port, config.host, if config.api_key.is_empty() { "(empty)" } else { "(set)" }, config.log_level, config.proxy_url.as_deref().unwrap_or("(none)"));

        let mut cmd = Command::new(&proxy_binary);
        cmd.arg("--port").arg(config.port.to_string())
           .arg("--host").arg(&config.host)
           .arg("--api-key").arg(&config.api_key)
           .arg("--log-level").arg(&config.log_level)
           .arg("--mode").arg("pc");

        if let Some(ref proxy_url) = config.proxy_url {
            if !proxy_url.is_empty() {
                cmd.arg("--proxy").arg(proxy_url);
            }
        }

        // 设置环境变量
        let env_vars = [
            ("OPENAI_API_KEY", "OPENAI_API_KEY"),
            ("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"),
            ("GEMINI_API_KEY", "GEMINI_API_KEY"),
            ("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"),
            ("MINIMAX_API_KEY", "MINIMAX_API_KEY"),
            ("MINIMAX_GROUP_ID", "MINIMAX_GROUP_ID"),
            ("SILICONFLOW_API_KEY", "SILICONFLOW_API_KEY"),
            ("GLM_API_KEY", "GLM_API_KEY"),
            ("DOUBAO_API_KEY", "DOUBAO_API_KEY"),
            ("QWEN_API_KEY", "QWEN_API_KEY"),
            ("MOONSHOT_API_KEY", "MOONSHOT_API_KEY"),
            ("YI_API_KEY", "YI_API_KEY"),
            ("OPENROUTER_API_KEY", "OPENROUTER_API_KEY"),
        ];

        for (env_key, var_name) in env_vars.iter() {
            let value = std::env::var(var_name).unwrap_or_default();
            if !value.is_empty() {
                tracing::info!("[ProxyService] 设置环境变量: {}", env_key);
                cmd.env(env_key, value);
            }
        }

        tracing::info!("[ProxyService] 执行spawn...");
        let child = cmd.spawn()
            .map_err(|e| {
                tracing::error!("[ProxyService] spawn失败: {}", e);
                ClamAIError::ProxyService(format!("启动代理服务失败: {}", e))
            })?;

        tracing::info!("[ProxyService] spawn成功，获取到child id");
        tracing::info!("[ProxyService] 等待2秒让代理服务完全启动...");
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        tracing::info!("[ProxyService] 启动流程完成");

        Ok(child)
    }

    fn get_proxy_binary_path(&self) -> Result<std::path::PathBuf> {
        #[cfg(target_os = "windows")]
        let binary_name = "ClamAI-service.exe";

        #[cfg(not(target_os = "windows"))]
        let binary_name = "ClamAI-service";

        let exe_path = std::env::current_exe()?;
        tracing::info!("[ProxyService] 当前exe路径: {}", exe_path.display());

        let mut path = exe_path.parent().unwrap_or(&exe_path).to_path_buf();
        path.push(binary_name);

        tracing::info!("[ProxyService] 代理二进制完整路径: {}", path.display());
        tracing::info!("[ProxyService] 代理二进制是否存在: {}", path.exists());

        if !path.exists() {
            tracing::warn!("代理二进制文件不存在: {}", path.display());
        }

        Ok(path)
    }
}
