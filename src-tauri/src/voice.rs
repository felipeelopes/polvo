//! Ditado por voz: a transcrição roda no webview (Whisper via WebGPU/WASM);
//! aqui só liberamos o microfone para as janelas do próprio Polvo, senão o
//! WebView2 mostra o pedido de permissão dele.

use crate::error::AppResult;

/// Responde "permitir" aos pedidos de microfone desta janela. A interface
/// chama uma vez por carregamento da página.
#[tauri::command]
pub async fn voice_allow_mic(webview: tauri::Webview) -> AppResult<()> {
    #[cfg(windows)]
    allow_mic(&webview)?;
    #[cfg(not(windows))]
    let _ = webview;
    Ok(())
}

#[cfg(windows)]
fn allow_mic(webview: &tauri::Webview) -> AppResult<()> {
    use std::sync::mpsc;
    use std::time::Duration;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    // O handler precisa estar registrado antes do getUserMedia: espera a
    // thread da interface terminar.
    let (tx, rx) = mpsc::channel();
    webview.with_webview(move |wv| {
        let result = unsafe {
            wv.controller().CoreWebView2().and_then(|core| {
                let mut token = 0i64;
                core.add_PermissionRequested(
                    &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                        let Some(args) = args else { return Ok(()) };
                        let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                        args.PermissionKind(&mut kind)?;
                        if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                            args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                        }
                        Ok(())
                    })),
                    &mut token,
                )
            })
        };
        let _ = tx.send(result.map_err(|e| e.to_string()));
    })?;
    rx.recv_timeout(Duration::from_secs(3))
        .map_err(|e| e.to_string())??;
    Ok(())
}
