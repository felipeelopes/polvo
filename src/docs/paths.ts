// Caminhos do Windows no frontend: achar arquivos no texto do terminal e
// resolvê-los em relação à pasta da sessão ou do documento aberto.

export const MD_EXT = /\.(?:md|markdown|mdx)$/i;
export const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i;

export interface PathMatch {
  /** Índice no texto e tamanho do trecho sublinhado. */
  index: number;
  length: number;
  path: string;
}

/** Caractere de um nome (sem espaços, aspas, `:`… nem as molduras e setas dos CLIs). */
const SEG = String.raw`[^\s"'${"`"}<>|*?()[\]{}:,;\\/←-⇿⎰-⏿─-▟]`;
/** Qualquer trecho com cara de caminho: unidade, `./`, `/`, pastas, um nome e talvez `:linha`. */
const ANY = new RegExp(String.raw`(?:file:\/\/\/?)?(?:[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/]|[\\/])?(?:${SEG}+[\\/])*${SEG}+[\\/]?(?::\d+(?::\d+)?)?`, "g");
/** Entre aspas ou crases, o caminho pode ter espaços. */
const ANY_QUOTED = /[`"']([^`"'\n]{2,260}?)(?::\d+(?::\d+)?)?[`"']/g;
const URL = /\b[a-z][\w+.-]*:\/\/\S+/gi;
/** Teto de candidatos por linha (cada um vira uma consulta ao disco). */
const MAX_PATHS = 40;
/** Extensão com ao menos uma letra (`a.ts`, `foto.PNG`; não `0.3.5`). */
const HAS_EXT = /\.(?=[\d_-]*[A-Za-z])[\w-]{1,10}$/;

/** Vale perguntar ao disco: tem uma pasta no meio ou uma extensão. */
function pathLike(p: string): boolean {
  const s = p.replace(/[\\/]+$/, "");
  if (s.length < 3 || /^\.+$/.test(s)) return false;
  return /[\\/]/.test(s) || HAS_EXT.test(s);
}

/**
 * Possíveis caminhos de arquivos ou pastas (qualquer extensão) numa linha de
 * texto. Quem chama confere no disco quais existem.
 */
export function findFilePaths(text: string): PathMatch[] {
  // URLs ficam com o link da web (WebLinksAddon); `file://` é nosso.
  const urls = [...text.matchAll(URL)].filter((m) => !/^file:/i.test(m[0])).map((m) => [m.index!, m.index! + m[0].length]);
  const found: PathMatch[] = [];
  const free = (a: number, b: number) => !urls.some(([x, y]) => a < y && b > x) && !found.some((f) => a < f.index + f.length && b > f.index);
  for (const m of text.matchAll(ANY_QUOTED)) {
    const start = m.index! + 1;
    if (m[1] === m[1].trim() && pathLike(m[1]) && free(start, start + m[0].length - 2)) found.push({ index: start, length: m[0].length - 2, path: m[1] });
  }
  for (const m of text.matchAll(ANY)) {
    const start = m.index!;
    // Pontuação de fim de frase não faz parte do caminho.
    const raw = m[0].replace(/[.!]+$/, "");
    const path = raw.replace(/:\d+(?::\d+)?$/, "");
    if (!pathLike(path) || !free(start, start + raw.length)) continue;
    found.push({ index: start, length: raw.length, path });
    if (found.length >= MAX_PATHS) break;
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Posição de um caractere: linha (índice em `lines`) e coluna no texto dela. */
export interface Spot {
  line: number;
  col: number;
}

/** Caminho que pode atravessar linhas; `end` é o último caractere (inclusivo). */
export interface SpanMatch {
  path: string;
  start: Spot;
  end: Spot;
}

/**
 * Candidatos a caminho em linhas seguidas do terminal. Os CLIs quebram o texto
 * com quebras de linha de verdade (e recuo), cortando caminhos longos ao meio:
 * além de cada linha sozinha, junta as vizinhas sem o recuo e sem os espaços
 * do fim. Junções erradas ("arquivo" + "src/a.ts") não existem no disco, e
 * quem chama fica só com o que existe.
 */
export function findPathsAcross(lines: string[]): SpanMatch[] {
  const out: SpanMatch[] = [];
  lines.forEach((text, line) => {
    for (const m of findFilePaths(text)) {
      out.push({ path: m.path, start: { line, col: m.index }, end: { line, col: m.index + m.length - 1 } });
    }
  });
  // Trechos de linhas seguidas não vazias.
  let first = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && lines[i].trim()) continue;
    if (i - first >= 2) out.push(...joined(lines, first, i - 1));
    first = i + 1;
  }
  return out;
}

function joined(lines: string[], from: number, to: number): SpanMatch[] {
  let text = "";
  const map: Spot[] = [];
  for (let line = from; line <= to; line++) {
    const s = lines[line];
    const a = line === from ? 0 : s.length - s.trimStart().length;
    const b = line === to ? s.length : s.trimEnd().length;
    for (let col = a; col < b; col++) map.push({ line, col });
    text += s.slice(a, b);
  }
  return findFilePaths(text)
    .map((m) => ({ path: m.path, start: map[m.index], end: map[m.index + m.length - 1] }))
    .filter((m) => m.start.line !== m.end.line);
}

export const isAbsolute = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]{2}/.test(p);

/** Pasta de um caminho de arquivo. */
export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : p;
}

/** Resolve `p` (relativo, absoluto, `file://`, estilo Git Bash) contra a pasta `base`. */
export function resolvePath(base: string, p: string): string {
  let path = p.trim();
  if (/^file:/i.test(path)) {
    path = path.replace(/^file:\/\/\/?/i, "");
    try {
      path = decodeURIComponent(path);
    } catch {
      /* mantém como está */
    }
  }
  // /d/Projetos/x.md (Git Bash, WSL-like) → D:\Projetos\x.md
  const bash = /^\/([A-Za-z])(\/.*)?$/.exec(path);
  if (bash) path = `${bash[1].toUpperCase()}:${bash[2] ?? "\\"}`;
  if (!isAbsolute(path)) {
    if (/^[\\/]/.test(path)) path = (/^[A-Za-z]:/.exec(base)?.[0] ?? "") + path;
    else path = `${base.replace(/[\\/]+$/, "")}\\${path}`;
  }
  return normalize(path);
}

function normalize(p: string): string {
  const unc = /^[\\/]{2}/.test(p);
  const out: string[] = [];
  for (const part of p.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length > 1) out.pop();
    } else out.push(part);
  }
  if (/^[a-z]:$/.test(out[0] ?? "")) out[0] = out[0].toUpperCase();
  return (unc ? "\\\\" : "") + out.join("\\");
}
