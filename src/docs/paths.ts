// Caminhos do Windows no frontend: achar arquivos e pastas no texto do terminal e
// resolvê-los em relação à pasta da sessão ou do documento aberto.

export const MD_EXT = /\.(?:md|markdown|mdx)$/i;

/** Caminhos soltos (`docs/a.md`, `D:\x\b.md`, `file:///…`, `/d/x/c.md`), opcionalmente com `:linha`. */
const BARE = /(?:file:\/\/\/?)?(?:[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/]|[\\/])?(?:[^\s"'`<>|*?()[\]{}:,;\\/]+[\\/])*[^\s"'`<>|*?()[\]{}:,;\\/]+\.(?:md|markdown|mdx)(?![\w\-]|\.\w)(?::\d+(?::\d+)?)?/gi;
/** Entre aspas ou crases, o caminho pode ter espaços. */
const QUOTED = /[`"']([^`"'\n]*?\.(?:md|markdown|mdx))(?::\d+)?[`"']/gi;

export interface PathMatch {
  /** Índice no texto e tamanho do trecho sublinhado. */
  index: number;
  length: number;
  path: string;
}

/** Encontra menções a arquivos Markdown numa linha de texto. */
export function findMdPaths(text: string): PathMatch[] {
  const found: PathMatch[] = [];
  for (const m of text.matchAll(QUOTED)) {
    const start = m.index! + 1;
    found.push({ index: start, length: m[1].length, path: m[1] });
  }
  for (const m of text.matchAll(BARE)) {
    const start = m.index!;
    if (found.some((f) => start < f.index + f.length && start + m[0].length > f.index)) continue;
    const raw = m[0];
    found.push({ index: start, length: raw.length, path: raw.replace(/:\d+(?::\d+)?$/, "") });
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Caractere de um nome (sem espaços, aspas, `:`… nem as molduras e setas dos CLIs). */
const SEG = String.raw`[^\s"'${"`"}<>|*?()[\]{}:,;\\/\u2190-\u21ff\u23b0-\u23ff\u2500-\u259f]`;
/** Qualquer caminho solto: prefixo opcional, segmentos e `:linha:coluna` no fim. */
const ANY_BARE = new RegExp(String.raw`(?:file:\/\/\/?)?(?:[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/]|[\\/])?(?:${SEG}+[\\/])*${SEG}*(?::\d+(?::\d+)?)?`, "g");
/** Entre aspas ou crases o caminho pode ter espaços. */
const ANY_QUOTED = /[`"']([^`"'\n]{2,260}?)[`"']/g;
const URL = /\b[a-z][\w+.-]*:\/\/\S+/gi;
const LINE_SUFFIX = /:\d+(?::\d+)?$/;
/** Tem separador (`src/ui`, `C:\x`) ou extensão (`README.md`). */
const looksLikePath = (p: string) => /[\\/]/.test(p) || /[^\\/.]\.[A-Za-z0-9]{1,10}$/.test(p);
const MAX_PATHS = 40;

/**
 * Menções a arquivos e pastas numa linha (Ctrl + clique no terminal). São só
 * candidatos: quem confirma é a existência no disco. URLs ficam com o link da web.
 */
export function findPaths(text: string): PathMatch[] {
  const urls = [...text.matchAll(URL)].map((m) => [m.index!, m.index! + m[0].length]);
  const found: PathMatch[] = [];
  const free = (a: number, b: number) => !urls.some(([x, y]) => a < y && b > x) && !found.some((f) => a < f.index + f.length && b > f.index);
  for (const m of text.matchAll(ANY_QUOTED)) {
    const path = m[1].replace(LINE_SUFFIX, "");
    const start = m.index! + 1;
    if (path !== path.trim() || !looksLikePath(path) || !free(start, start + m[1].length)) continue;
    found.push({ index: start, length: m[1].length, path });
  }
  for (const m of text.matchAll(ANY_BARE)) {
    // Ponto final da frase não faz parte do caminho.
    const raw = m[0].replace(/\.+$/, "");
    const path = raw.replace(LINE_SUFFIX, "");
    const start = m.index!;
    if (!/\w/.test(path) || !looksLikePath(path) || !free(start, start + raw.length)) continue;
    found.push({ index: start, length: raw.length, path });
    if (found.length >= MAX_PATHS) break;
  }
  return found.sort((a, b) => a.index - b.index);
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
