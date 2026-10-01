use serde::{Serialize, Serializer};

/// Erro único exposto aos comandos Tauri. É serializado como texto simples
/// para o frontend mostrar direto ao usuário.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

impl AppError {
    pub fn msg(m: impl Into<String>) -> Self {
        AppError::Msg(m.into())
    }
}

impl From<String> for AppError {
    fn from(m: String) -> Self {
        AppError::Msg(m)
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Converte erros de bibliotecas que usam `anyhow` (ex.: portable-pty).
pub trait Context<T> {
    fn ctx(self, what: &str) -> AppResult<T>;
}

impl<T, E: std::fmt::Display> Context<T> for Result<T, E> {
    fn ctx(self, what: &str) -> AppResult<T> {
        self.map_err(|e| AppError::Msg(format!("{what}: {e}")))
    }
}
