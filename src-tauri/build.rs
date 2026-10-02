fn main() {
    // IDs públicos dos apps OAuth do "Meu trabalho" (ver CONTRIBUTING.md).
    println!("cargo:rerun-if-env-changed=POLVO_GITHUB_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=POLVO_ENTRA_CLIENT_ID");
    tauri_build::build()
}
