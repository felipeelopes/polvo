// Esconde o console extra no Windows em builds de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Modo "ponte de statusline": o Claude Code chama o próprio executável do
    // Polvo para cada atualização da statusline. Sai rápido, sem abrir janela.
    if std::env::args().any(|a| a == polvo_lib::bridge::BRIDGE_FLAG) {
        std::process::exit(polvo_lib::bridge::run());
    }
    polvo_lib::run()
}
