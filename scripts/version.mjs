// Atualiza a versão nos três lugares: package.json, tauri.conf.json e Cargo.toml.
//   pnpm version:set 0.2.0
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Uso: pnpm version:set X.Y.Z");
  process.exit(1);
}
const json = (file, fn) => {
  const data = JSON.parse(readFileSync(file, "utf8"));
  fn(data);
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
};
json("package.json", (d) => (d.version = version));
json("src-tauri/tauri.conf.json", (d) => (d.version = version));
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").replace(/^version = ".+"/m, `version = "${version}"`);
writeFileSync("src-tauri/Cargo.toml", cargo);
console.log(`versão ${version} aplicada (rode cargo check para atualizar o Cargo.lock)`);
