// Diff unificado: leitura do texto do git e montagem de patches parciais
// (incluir, tirar ou descartar só algumas linhas/trechos).

export type LineKind = " " | "+" | "-";

export interface DiffLine {
  kind: LineKind;
  text: string;
  old: number | null;
  new: number | null;
  /** Seguida de "\ No newline at end of file". */
  noEol?: boolean;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Texto após o segundo @@ (geralmente a função onde o trecho está). */
  section: string;
  lines: DiffLine[];
}

export interface FileDiff {
  /** Linhas de cabeçalho (diff --git, index, ---, +++…), usadas para montar patches. */
  header: string[];
  oldPath: string | null;
  newPath: string | null;
  binary: boolean;
  hunks: Hunk[];
  added: number;
  removed: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

function unquote(p: string): string {
  return p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1).replace(/\\(.)/g, "$1") : p;
}

function pathOf(line: string): string | null {
  const p = unquote(line.slice(4).trim());
  if (p === "/dev/null") return null;
  return p.replace(/^[ab]\//, "");
}

export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let o = 0;
  let n = 0;
  // O "\r" de arquivos CRLF faz parte do conteúdo (o patch precisa dele).
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ") || (line.startsWith("diff --") && !hunk)) {
      file = { header: [line], oldPath: null, newPath: null, binary: false, hunks: [], added: 0, removed: 0 };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    const m = HUNK.exec(line);
    if (m) {
      hunk = { oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], section: m[5] ?? "", lines: [] };
      file.hunks.push(hunk);
      o = hunk.oldStart;
      n = hunk.newStart;
      continue;
    }
    if (!hunk) {
      file.header.push(line);
      if (line.startsWith("--- ")) file.oldPath = pathOf(line);
      else if (line.startsWith("+++ ")) file.newPath = pathOf(line);
      else if (line.startsWith("Binary files") || line === "GIT binary patch") file.binary = true;
      continue;
    }
    const c = line[0];
    if (c === "\\") {
      const last = hunk.lines[hunk.lines.length - 1];
      if (last) last.noEol = true;
    } else if (c === "+") {
      hunk.lines.push({ kind: "+", text: line.slice(1), old: null, new: n++ });
      file.added++;
    } else if (c === "-") {
      hunk.lines.push({ kind: "-", text: line.slice(1), old: o++, new: null });
      file.removed++;
    } else if (c === " " || line === "") {
      // Uma linha vazia no fim do texto não é contexto.
      if (line === "" && o >= hunk.oldStart + hunk.oldLines && n >= hunk.newStart + hunk.newLines) continue;
      hunk.lines.push({ kind: " ", text: line.slice(1), old: o++, new: n++ });
    }
  }
  return files;
}

/** Chave de uma linha selecionável: `trecho:linha`. */
export const lineKey = (h: number, i: number) => `${h}:${i}`;

/**
 * Patch só com as linhas escolhidas.
 * - `reverse = false`: para aplicar como está (ex.: incluir linhas no índice).
 * - `reverse = true`: para `git apply --reverse` (tirar do índice, descartar da pasta).
 * Devolve null se nada foi escolhido.
 */
export function buildPatch(file: FileDiff, selected: Set<string>, reverse: boolean): string | null {
  const out: string[] = [];
  let delta = 0;
  let any = false;
  file.hunks.forEach((h, hi) => {
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    let changed = false;
    h.lines.forEach((l, li) => {
      const on = selected.has(lineKey(hi, li));
      let kind: LineKind | null = l.kind;
      if (l.kind === "+" && !on) kind = reverse ? " " : null;
      else if (l.kind === "-" && !on) kind = reverse ? null : " ";
      if (kind === null) return;
      if (kind !== " ") changed = true;
      if (kind !== "+") oldCount++;
      if (kind !== "-") newCount++;
      body.push(kind + l.text);
      if (l.noEol) body.push("\\ No newline at end of file");
    });
    if (!changed) return;
    any = true;
    let oldStart = h.oldStart;
    let newStart = h.newStart;
    if (reverse) {
      // O lado novo (o que está no disco/índice agora) não muda; o antigo se desloca.
      const pos = (h.newLines === 0 ? h.newStart + 1 : h.newStart) - delta;
      oldStart = oldCount === 0 ? pos - 1 : pos;
    } else {
      const pos = (h.oldLines === 0 ? h.oldStart + 1 : h.oldStart) + delta;
      newStart = newCount === 0 ? pos - 1 : pos;
    }
    delta += newCount - oldCount;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${h.section ? ` ${h.section}` : ""}`, ...body);
  });
  if (!any) return null;
  return [...file.header, ...out].join("\n") + "\n";
}

/** Todas as linhas alteradas de um trecho (para os botões "incluir/descartar trecho"). */
export function hunkSelection(file: FileDiff, hi: number): Set<string> {
  const s = new Set<string>();
  file.hunks[hi]?.lines.forEach((l, li) => {
    if (l.kind !== " ") s.add(lineKey(hi, li));
  });
  return s;
}
