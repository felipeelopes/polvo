// Release local (sem GitHub Actions): compila, assina, gera o latest.json do
// atualizador e publica a release no GitHub com o `gh`.
//
//   pnpm release            → publica vX.Y.Z (versão do package.json)
//   pnpm release --draft    → cria como rascunho
//   pnpm release --no-build → reaproveita os instaladores já gerados
//   pnpm release --no-build --bundle-dir <pasta> → usa os artefatos do build-signed.ps1
//
// Precisa da chave privada de assinatura: TAURI_SIGNING_PRIVATE_KEY (conteúdo
// ou caminho) ou o arquivo padrão ~/.tauri/polvo.key.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = "felipeelopes/polvo";
const argv = process.argv.slice(2);
const args = new Set(argv);
const bundleIndex = argv.indexOf("--bundle-dir");
if (bundleIndex !== -1 && (!args.has("--no-build") || !argv[bundleIndex + 1] || argv[bundleIndex + 1].startsWith("--"))) {
  console.error("Use --bundle-dir <pasta> junto de --no-build.");
  process.exit(1);
}
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version = "(.+)"/m)?.[1];
if (conf.version !== version || cargo !== version) {
  console.error(`Versões diferentes: package.json ${version}, tauri.conf.json ${conf.version}, Cargo.toml ${cargo}.\nUse: pnpm version:set ${version}`);
  process.exit(1);
}
const tag = `v${version}`;

if (!args.has("--no-build")) {
  let key = process.env.TAURI_SIGNING_PRIVATE_KEY;
  const keyFile = join(homedir(), ".tauri", "polvo.key");
  if (!key && existsSync(keyFile)) key = readFileSync(keyFile, "utf8");
  if (!key) {
    console.error("Chave de assinatura não encontrada (TAURI_SIGNING_PRIVATE_KEY ou ~/.tauri/polvo.key).");
    process.exit(1);
  }
  run("pnpm tauri build", {
    TAURI_SIGNING_PRIVATE_KEY: key,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
  });
}

const bundle = bundleIndex === -1 ? "src-tauri/target/release/bundle" : argv[bundleIndex + 1];
const setup = `${bundle}/nsis/Polvo_${version}_x64-setup.exe`;
const msi = `${bundle}/msi/Polvo_${version}_x64_en-US.msi`;
for (const f of [setup, `${setup}.sig`, msi, `${msi}.sig`]) {
  if (!existsSync(f)) {
    console.error(`Arquivo não encontrado: ${f}`);
    process.exit(1);
  }
}

// Só publique pacotes que o atualizador aceita com a chave pública do app.
execFileSync(process.execPath, ["scripts/verify-updater-signature.mjs", "src-tauri/tauri.conf.json", setup, msi], { stdio: "inherit" });

// Notas: seção da versão no CHANGELOG.md, se existir.
let notes = `Polvo ${tag}`;
if (existsSync("CHANGELOG.md")) {
  const section = readFileSync("CHANGELOG.md", "utf8").split(/^## /m).find((s) => s.startsWith(`${version}`) || s.startsWith(`[${version}]`));
  if (section) notes = section.split("\n").slice(1).join("\n").trim();
}

const download = (file) => `https://github.com/${REPO}/releases/download/${tag}/${file.split("/").pop()}`;
const nsis = { signature: readFileSync(`${setup}.sig`, "utf8").trim(), url: download(setup) };
const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": nsis,
    "windows-x86_64-nsis": nsis,
    "windows-x86_64-msi": { signature: readFileSync(`${msi}.sig`, "utf8").trim(), url: download(msi) },
  },
};
const latestFile = `${bundle}/latest.json`;
writeFileSync(latestFile, JSON.stringify(latest, null, 2));
writeFileSync(`${bundle}/release-notes.md`, `${notes}\n\nBaixe o **Polvo_${version}_x64-setup.exe** (recomendado) ou o **.msi**. Quem já tem o Polvo instalado recebe esta versão automaticamente.\n`);

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const ghArgs = ["release", "create", tag, setup, `${setup}.sig`, msi, `${msi}.sig`, latestFile, "--repo", REPO, "--target", commit, "--title", `Polvo ${tag}`, "--notes-file", `${bundle}/release-notes.md`];
if (args.has("--draft")) ghArgs.push("--draft");
execFileSync("gh", ghArgs, { stdio: "inherit" });
console.log(`\nRelease ${tag} publicada: https://github.com/${REPO}/releases/tag/${tag}`);
