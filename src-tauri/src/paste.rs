//! Ctrl + V com arquivos no terminal: lê os arquivos copiados no Explorer e
//! os traz para `.polvo/pasted` do projeto, para o agente poder referenciá-los.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;

use crate::error::{AppError, AppResult};

/// Pasta (relativa ao projeto) onde ficam os arquivos colados.
const DIR: &str = ".polvo/pasted";

/// Caminhos copiados no Explorer (formato CF_HDROP), se houver.
#[tauri::command]
pub fn clipboard_files() -> Vec<String> {
    imp::files()
}

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows_sys::Win32::System::Ole::CF_HDROP;
    use windows_sys::Win32::UI::Shell::DragQueryFileW;

    pub fn files() -> Vec<String> {
        // SAFETY: a área de transferência é aberta, lida e fechada aqui; o
        // HDROP só é usado enquanto ela está aberta.
        unsafe {
            if IsClipboardFormatAvailable(CF_HDROP as u32) == 0 {
                return Vec::new();
            }
            // Outro programa pode estar com ela aberta por um instante.
            let mut opened = false;
            for _ in 0..5 {
                if OpenClipboard(std::ptr::null_mut()) != 0 {
                    opened = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            if !opened {
                return Vec::new();
            }
            let mut out = Vec::new();
            let drop = GetClipboardData(CF_HDROP as u32);
            if !drop.is_null() {
                let n = DragQueryFileW(drop, u32::MAX, std::ptr::null_mut(), 0);
                for i in 0..n {
                    let len = DragQueryFileW(drop, i, std::ptr::null_mut(), 0);
                    let mut buf = vec![0u16; len as usize + 1];
                    let got = DragQueryFileW(drop, i, buf.as_mut_ptr(), buf.len() as u32);
                    out.push(String::from_utf16_lossy(&buf[..got as usize]));
                }
            }
            CloseClipboard();
            out
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn files() -> Vec<String> {
        Vec::new()
    }
}

/// Caminho relativo a `base`, com `/`, se `p` estiver dentro dela (sem diferenciar maiúsculas).
fn relative_to(base: &Path, p: &Path) -> Option<String> {
    let base = base
        .to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_lowercase();
    let full = p.to_string_lossy();
    let lower = full.to_lowercase();
    // Só compara com segurança quando minúsculas não mudam o tamanho do texto.
    if lower.len() != full.len() {
        return None;
    }
    let rest = lower.strip_prefix(&base)?;
    if !rest.starts_with(['\\', '/']) {
        return None;
    }
    Some(full[base.len() + 1..].replace('\\', "/"))
}

/// Nome livre na pasta: `a.png`, `a (2).png`, `a (3).png`…
fn unique(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("sempre há um nome livre")
}

/// Cria `.polvo/pasted` com um `.gitignore` que esconde tudo do Git.
fn target_dir(cwd: &Path) -> AppResult<PathBuf> {
    let dir = cwd.join(DIR);
    std::fs::create_dir_all(&dir)?;
    let ignore = cwd.join(".polvo").join(".gitignore");
    if !ignore.exists() {
        std::fs::write(ignore, "*\n")?;
    }
    Ok(dir)
}

fn check_cwd(cwd: &str) -> AppResult<PathBuf> {
    let cwd = PathBuf::from(cwd);
    if !cwd.is_dir() {
        return Err(AppError::msg(crate::i18n::tr("paste.noFolder", &[])));
    }
    Ok(cwd)
}

/// Traz os arquivos para o projeto e devolve como referenciá-los: relativo ao
/// projeto quando já estão nele (ou foram copiados), absoluto para pastas de fora.
fn import_files(cwd: &Path, paths: &[String]) -> AppResult<Vec<String>> {
    let mut out = Vec::new();
    for p in paths.iter().map(PathBuf::from) {
        if let Some(rel) = relative_to(cwd, &p) {
            out.push(rel);
        } else if p.is_dir() {
            out.push(p.to_string_lossy().into_owned());
        } else {
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned());
            let name = name.ok_or_else(|| AppError::msg(crate::i18n::tr("files.notAFile", &[])))?;
            let dest = unique(&target_dir(cwd)?, &name);
            std::fs::copy(&p, &dest)?;
            out.push(
                relative_to(cwd, &dest).unwrap_or_else(|| dest.to_string_lossy().into_owned()),
            );
        }
    }
    Ok(out)
}

/// Grava a imagem em `.polvo/pasted` e devolve o caminho relativo.
fn save_image(cwd: &Path, bytes: &[u8], ext: &str) -> AppResult<String> {
    let ext: String = ext
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(5)
        .collect();
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = format!("image-{secs}.{}", if ext.is_empty() { "png" } else { &ext });
    let dest = unique(&target_dir(cwd)?, &name);
    std::fs::write(&dest, bytes)?;
    Ok(relative_to(cwd, &dest).unwrap_or_else(|| dest.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn paste_files(cwd: String, paths: Vec<String>) -> AppResult<Vec<String>> {
    blocking(move || import_files(&check_cwd(&cwd)?, &paths)).await
}

/// Imagem da área de transferência (base64), para os CLIs sem colar de imagem.
#[tauri::command]
pub async fn paste_image(cwd: String, data: String, ext: String) -> AppResult<String> {
    blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|e| AppError::msg(e.to_string()))?;
        save_image(&check_cwd(&cwd)?, &bytes, &ext)
    })
    .await
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::{import_files, relative_to, save_image, unique};
    use std::path::{Path, PathBuf};

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("polvo-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn imports_outside_files_and_references_inside_ones() {
        let root = temp("import");
        let proj = root.join("proj");
        let outside = root.join("fora");
        std::fs::create_dir_all(proj.join("src")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(proj.join("src").join("b.ts"), b"b").unwrap();
        std::fs::write(outside.join("a.pdf"), b"a").unwrap();
        // Já existe um a.pdf colado antes: o novo ganha outro nome.
        std::fs::create_dir_all(proj.join(".polvo").join("pasted")).unwrap();
        std::fs::write(proj.join(".polvo").join("pasted").join("a.pdf"), b"old").unwrap();

        let paths = [
            outside.join("a.pdf"),
            proj.join("src").join("b.ts"),
            outside.clone(),
        ]
        .map(|p| p.to_string_lossy().into_owned());
        let refs = import_files(&proj, &paths).unwrap();

        assert_eq!(refs[0], ".polvo/pasted/a (2).pdf");
        assert_eq!(refs[1], "src/b.ts");
        assert_eq!(refs[2], outside.to_string_lossy());
        assert_eq!(
            std::fs::read(proj.join(".polvo/pasted/a (2).pdf")).unwrap(),
            b"a"
        );
        assert_eq!(
            std::fs::read_to_string(proj.join(".polvo/.gitignore")).unwrap(),
            "*\n"
        );
        // O original não é tocado.
        assert!(outside.join("a.pdf").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn saves_image_with_safe_extension() {
        let proj = temp("image");
        let rel = save_image(&proj, b"png", "p/n..g").unwrap();
        assert!(
            rel.starts_with(".polvo/pasted/image-") && rel.ends_with(".png"),
            "{rel}"
        );
        assert_eq!(std::fs::read(proj.join(&rel)).unwrap(), b"png");
        let rel = save_image(&proj, b"x", "").unwrap();
        assert!(rel.ends_with(".png"), "{rel}");
        std::fs::remove_dir_all(proj).unwrap();
    }

    #[test]
    fn relative_inside_project_only() {
        let base = Path::new(r"D:\Proj\api");
        assert_eq!(
            relative_to(base, Path::new(r"D:\proj\API\src\a.ts")).as_deref(),
            Some("src/a.ts")
        );
        assert_eq!(relative_to(base, Path::new(r"D:\Proj\api2\a.ts")), None);
        assert_eq!(relative_to(base, Path::new(r"C:\x\a.ts")), None);
    }

    #[test]
    fn unique_names() {
        let dir = temp("unique");
        std::fs::write(dir.join("a.png"), b"x").unwrap();
        assert_eq!(unique(&dir, "a.png"), dir.join("a (2).png"));
        assert_eq!(unique(&dir, "b.png"), dir.join("b.png"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
