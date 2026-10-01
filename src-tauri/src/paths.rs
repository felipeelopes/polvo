//! Caminhos de dados do Polvo e utilitários de arquivo.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// `%APPDATA%\Polvo` — configurações, workspace e dados de uso.
/// `POLVO_DATA_DIR` usa outra pasta (testes, demonstrações, perfis separados).
pub fn data_dir() -> PathBuf {
    let dir = std::env::var_os("POLVO_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::data_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("Polvo")
        });
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn usage_dir() -> PathBuf {
    let dir = data_dir().join("usage");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_default()
}

/// Escreve primeiro num arquivo temporário e renomeia, para nunca deixar um
/// JSON pela metade se o app for fechado no meio da gravação.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(tmp, path)
}

pub fn now_ms() -> i64 {
    to_ms(SystemTime::now())
}

pub fn to_ms(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Compara caminhos do Windows ignorando caixa, barras e barra final.
pub fn same_path(a: &str, b: &str) -> bool {
    fn norm(p: &str) -> String {
        p.trim()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    }
    norm(a) == norm(b)
}
