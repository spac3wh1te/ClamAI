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
    pub tls_cert: Option<String>,
    pub tls_key: Option<String>,
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

        if let Some(ref tls_cert) = config.tls_cert {
            if let Some(ref tls_key) = config.tls_key {
                cmd.arg("--tls-cert").arg(tls_cert);
                cmd.arg("--tls-key").arg(tls_key);
                tracing::info!("[ProxyService] TLS enabled: cert={}", tls_cert);
            }
        }

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

    pub fn ensure_self_signed_cert(data_dir: &std::path::Path) -> Result<(String, String)> {
        let cert_path = data_dir.join("clamai-cert.pem");
        let key_path = data_dir.join("clamai-key.pem");

        if cert_path.exists() && key_path.exists() {
            tracing::info!("[ProxyService] TLS cert already exists");
            return Ok((cert_path.to_string_lossy().to_string(), key_path.to_string_lossy().to_string()));
        }

        tracing::info!("[ProxyService] Generating self-signed TLS certificate...");

        let mut params = rcgen::CertificateParams::default();
        params.distinguished_name = rcgen::DistinguishedName::new();
        params.distinguished_name.push(rcgen::DnType::CommonName, "ClamAI Local");
        params.distinguished_name.push(rcgen::DnType::OrganizationName, "ClamAI");
        params.serial_number = Some(rcgen::SerialNumber::from(1));
        params.not_before = rcgen::date_time_ymd(2024, 1, 1);
        params.not_after = rcgen::date_time_ymd(2034, 1, 1);
        params.subject_alt_names = vec![
            rcgen::SanType::IpAddress(std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1))),
            rcgen::SanType::DnsName(rcgen::Ia5String::try_from("localhost").unwrap()),
        ];
        params.key_usages = vec![rcgen::KeyUsagePurpose::DigitalSignature, rcgen::KeyUsagePurpose::KeyCertSign];
        params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];
        params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);

        let key_pair = rcgen::KeyPair::generate()
            .map_err(|e| ClamAIError::ProxyService(format!("KeyPair gen failed: {}", e)))?;
        let cert = params.self_signed(&key_pair)
            .map_err(|e| ClamAIError::ProxyService(format!("Cert gen failed: {}", e)))?;

        let cert_pem = cert.pem();
        let key_pem = key_pair.serialize_pem();

        std::fs::write(&cert_path, cert_pem.as_bytes())
            .map_err(|e| ClamAIError::ProxyService(format!("Write cert failed: {}", e)))?;
        std::fs::write(&key_path, key_pem.as_bytes())
            .map_err(|e| ClamAIError::ProxyService(format!("Write key failed: {}", e)))?;

        tracing::info!("[ProxyService] Self-signed TLS certificate generated: cert={}", cert_path.display());
        Ok((cert_path.to_string_lossy().to_string(), key_path.to_string_lossy().to_string()))
    }
}
