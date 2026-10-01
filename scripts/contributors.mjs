// Gera src/generated/contributors.json a partir do histórico do git
// (autores e coautores de commits). Roda antes do dev e do build.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

let lines = [];
try {
  lines = execSync('git log --format="%an%x09%ae%n%(trailers:key=Co-authored-by,valueonly,separator=%x0A)"', {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).split("\n");
} catch {
  // fora de um repositório git (ex.: tarball): lista vazia
}

const counts = new Map();
for (const raw of lines) {
  const line = raw.trim();
  if (!line) continue;
  // "Nome<TAB>email" (autor) ou "Nome <email>" (coautor)
  const m = line.includes("\t") ? line.split("\t") : /^(.*?)\s*<([^>]*)>$/.exec(line)?.slice(1);
  if (!m) continue;
  const [name, email] = m.map((s) => s.trim());
  const key = (email || name).toLowerCase();
  const prev = counts.get(key);
  // Assistentes de IA e bots não entram na lista de colaboradores.
  if (/noreply@anthropic\.com|\[bot\]|@users\.noreply\.github\.com$/i.test(email) && /claude|bot/i.test(`${name} ${email}`)) continue;
  counts.set(key, { name: prev?.name ?? name, commits: (prev?.commits ?? 0) + 1 });
}

const contributors = [...counts.values()].sort((a, b) => b.commits - a.commits);
mkdirSync("src/generated", { recursive: true });
writeFileSync("src/generated/contributors.json", JSON.stringify(contributors, null, 2) + "\n");
console.log(`contributors: ${contributors.length}`);
