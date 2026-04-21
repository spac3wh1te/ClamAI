use thiserror::Error;

pub type Result<T> = std::result::Result<T, ClamAIError>;

#[derive(Error, Debug)]
pub enum ClamAIError {
    #[error("配置错误: {0}")]
    Config(String),

    #[error("IO错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("序列化错误: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("数据库错误: {0}")]
    Database(#[from] sqlx::Error),

    #[error("HTTP请求错误: {0}")]
    Http(#[from] reqwest::Error),

    #[error("OAuth错误: {0}")]
    OAuth(String),

    #[error("代理服务错误: {0}")]
    ProxyService(String),

    #[error("加密错误: {0}")]
    Encryption(String),

    #[error("未找到: {0}")]
    NotFound(String),

    #[error("权限错误: {0}")]
    Permission(String),

    #[error("网络错误: {0}")]
    Network(String),

    #[error("未知错误: {0}")]
    Unknown(String),
}

impl serde::Serialize for ClamAIError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
