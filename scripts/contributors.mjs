// Gera src/generated/contributors.json a partir do histórico do git (autores e
// coautores de commits) e atualiza a lista de colaboradores dos READMEs.
// Roda antes do dev e do build.
//
// Identidades: o `.mailmap` junta os e-mails de uma mesma pessoa num e-mail
// canônico. Quando ele é o e-mail "noreply" do GitHub (`id+login@users.noreply…`),
// o login vira o link do perfil. Pessoas com o mesmo nome também se juntam.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

/** `.mailmap`: e-mail do commit (minúsculo) → { name, email } canônicos. */
function readMailmap() {
  const map = new Map();
  if (!existsSync(".mailmap")) return map;
  for (const raw of readFileSync(".mailmap", "utf8").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    // "Nome <canônico> <do commit>" | "<canônico> <do commit>" | "Nome <e-mail>"
    const m = /^([^<]*?)\s*<([^>]*)>(?:\s*[^<]*<([^>]*)>)?$/.exec(line);
    if (!m) continue;
    const [, name, proper, commit] = m;
    map.set((commit ?? proper).toLowerCase(), { name: name || null, email: proper });
  }
  return map;
}

const mailmap = readMailmap();

let lines = [];
try {
  lines = execSync('git log --format="%an%x09%ae%n%(trailers:key=Co-authored-by,valueonly,separator=%x0A)"', {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).split("\n");
} catch {
  // fora de um repositório git (ex.: tarball): lista vazia
}

const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const loginOf = (email) => /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email)?.[1] ?? null;

const people = new Map();
for (const raw of lines) {
  const line = raw.trim();
  if (!line) continue;
  // "Nome<TAB>email" (autor) ou "Nome <email>" (coautor)
  const m = line.includes("\t") ? line.split("\t") : /^(.*?)\s*<([^>]*)>$/.exec(line)?.slice(1);
  if (!m) continue;
  let [name, email] = m.map((s) => s.trim());
  // Assistentes de IA e bots não entram na lista de colaboradores.
  if (/noreply@anthropic\.com|\[bot\]|@users\.noreply\.github\.com$/i.test(email) && /claude|bot/i.test(`${name} ${email}`)) continue;
  const canon = mailmap.get(email.toLowerCase());
  if (canon) {
    name = canon.name ?? name;
    email = canon.email;
  }
  const login = loginOf(email);
  const key = login ? `@${login.toLowerCase()}` : fold(name) || email.toLowerCase();
  const prev = people.get(key);
  people.set(key, { name: prev?.name ?? name, login: prev?.login ?? login, commits: (prev?.commits ?? 0) + 1 });
}

// Mesmo nome com identidades diferentes (ex.: e-mail fora do .mailmap): uma pessoa só.
const byName = new Map();
for (const p of people.values()) {
  const k = fold(p.name);
  const prev = byName.get(k);
  if (!prev) byName.set(k, { ...p });
  else {
    prev.commits += p.commits;
    prev.login ??= p.login;
  }
}

const contributors = [...byName.values()]
  .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
  // Já em ordem de participação; a contagem em si não é mostrada.
  .map(({ name, login }) => (login ? { name, login } : { name }));
mkdirSync("src/generated", { recursive: true });
writeFileSync("src/generated/contributors.json", JSON.stringify(contributors, null, 2) + "\n");

// READMEs: substitui o trecho entre os marcadores pela grade de avatares.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cell = (c) => {
  const inner = c.login
    ? `<a href="https://github.com/${c.login}"><img src="https://github.com/${c.login}.png?size=120" width="60" height="60" alt="@${esc(c.login)}"><br><sub><b>${esc(c.name)}</b></sub></a>`
    : `<sub><b>${esc(c.name)}</b></sub>`;
  return `<td align="center">${inner}</td>`;
};
const rows = [];
for (let i = 0; i < contributors.length; i += 7) rows.push(`  <tr>${contributors.slice(i, i + 7).map(cell).join("")}</tr>`);
const block = `<!-- contributors:start (gerado por scripts/contributors.mjs) -->\n<table>\n${rows.join("\n")}\n</table>\n<!-- contributors:end -->`;
let touched = 0;
if (contributors.length) {
  for (const f of readdirSync(".").filter((f) => /^README(\..+)?\.md$/.test(f))) {
    const text = readFileSync(f, "utf8");
    const next = text.replace(/<!-- contributors:start[\s\S]*?<!-- contributors:end -->/, block);
    if (next !== text) {
      writeFileSync(f, next);
      touched++;
    }
  }
}
console.log(`contributors: ${contributors.length}${touched ? ` (${touched} READMEs atualizados)` : ""}`);
