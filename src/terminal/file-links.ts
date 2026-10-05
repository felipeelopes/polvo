// Caminhos de arquivos e pastas no terminal viram links. Ctrl + clique abre:
// Markdown no visualizador do Polvo, imagens numa prévia em tela cheia, pastas
// no Explorer e o resto no programa padrão. Ctrl + Shift + clique mostra no
// Explorer. Só sublinha o que existe, mesmo que o CLI tenha quebrado o
// caminho em várias linhas.
import type { IBufferCellPosition, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { ipc } from "../core/ipc";
import { t } from "../i18n";
import { openImage } from "../docs/image-viewer";
import { findPathsAcross, IMAGE_EXT, MD_EXT, resolvePath } from "../docs/paths";
import { toast } from "../ui/feedback";

export interface FileLinkHost {
  /** Pasta da sessão, base dos caminhos relativos. */
  cwd(): string | undefined;
  open(path: string): void;
}

/** 0 não existe, 1 arquivo, 2 pasta. */
type Kind = 0 | 1 | 2;

const KIND_TTL = 5000;
const kinds = new Map<string, { kind: Kind; at: number }>();

async function kindsOf(paths: string[]): Promise<Kind[]> {
  const now = Date.now();
  const missing = [...new Set(paths.filter((p) => !(now - (kinds.get(p)?.at ?? 0) < KIND_TTL)))];
  if (missing.length) {
    const res = await ipc.pathsKind(missing).catch(() => missing.map(() => 0));
    missing.forEach((p, i) => kinds.set(p, { kind: (res[i] ?? 0) as Kind, at: now }));
  }
  return paths.map((p) => kinds.get(p)?.kind ?? 0);
}

/** Tipos já conhecidos de todos os caminhos, ou `null` se falta perguntar algum ao disco. */
function cachedKinds(paths: string[]): Kind[] | null {
  const now = Date.now();
  const out: Kind[] = [];
  for (const p of paths) {
    const k = kinds.get(p);
    if (!k || now - k.at >= KIND_TTL) return null;
    out.push(k.kind);
  }
  return out;
}

/** O que o Ctrl + clique faz com este caminho. */
function actionOf(path: string, kind: Kind): "openInPolvo" | "preview" | "openFolder" | "open" {
  if (kind === 2) return "openFolder";
  if (MD_EXT.test(path)) return "openInPolvo";
  if (IMAGE_EXT.test(path)) return "preview";
  return "open";
}

/** Abre (ou, com Shift, mostra no Explorer) um caminho que existe. */
function activate(host: FileLinkHost, path: string, kind: Kind, reveal: boolean): void {
  hideHint();
  const fail = (e: unknown) => toast(String((e as Error)?.message ?? e));
  if (reveal) return void ipc.fileReveal(path).catch(fail);
  const action = actionOf(path, kind);
  if (action === "openInPolvo") host.open(path);
  else if (action === "preview") void openImage(path);
  else void ipc.fileOpen(path).then((opened) => opened || toast(t("terminal.ctrlClick.runnable")), fail);
}

/** Hiperlink `file://` (OSC 8): mesma regra do Ctrl + clique. */
export function openFileLink(host: FileLinkHost, path: string, reveal: boolean): void {
  void kindsOf([path]).then(([kind]) => kind && activate(host, path, kind, reveal));
}

let hint: HTMLDivElement | null = null;

function showHint(e: MouseEvent, action: ReturnType<typeof actionOf>): void {
  hideHint();
  hint = document.createElement("div");
  hint.className = "tip";
  const click = t("terminal.ctrlClick.click");
  hint.innerHTML = `<kbd>Ctrl</kbd> + ${click} <span>${t(`terminal.ctrlClick.${action}`)}</span> · <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + ${click} <span>${t("terminal.ctrlClick.reveal")}</span>`;
  hint.style.left = `${e.clientX + 12}px`;
  hint.style.top = `${e.clientY + 16}px`;
  document.body.appendChild(hint);
}

function hideHint(): void {
  hint?.remove();
  hint = null;
}

interface Line {
  text: string;
  /** Célula (1-based) de cada caractere de `text`. */
  cells: IBufferCellPosition[];
}

/** Primeira e última linha do buffer da linha lógica (quebras automáticas do xterm) de `row`. */
function logicalRange(term: Terminal, row: number): [number, number] {
  const buf = term.buffer.active;
  let start = row;
  while (start > 0 && buf.getLine(start)?.isWrapped) start--;
  let end = row;
  while (end + 1 < buf.length && buf.getLine(end + 1)?.isWrapped) end++;
  return [start, end];
}

function readLine(term: Terminal, start: number, end: number): Line {
  const buf = term.buffer.active;
  let text = "";
  const cells: IBufferCellPosition[] = [];
  for (let y = start; y <= end; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) continue;
      const chars = cell.getChars() || " ";
      for (let i = 0; i < chars.length; i++) cells.push({ x: x + 1, y: y + 1 });
      text += chars;
    }
  }
  return { text, cells };
}

/** Quantas linhas lógicas acima e abaixo entram na busca (caminho quebrado pelo CLI). */
const REACH = 3;

/** A linha lógica de `row` (0-based) e as vizinhas. */
function linesAround(term: Terminal, row: number): Line[] {
  const buf = term.buffer.active;
  const [start, end] = logicalRange(term, row);
  const lines = [readLine(term, start, end)];
  for (let i = 0, top = start; i < REACH && top > 0; i++) {
    const [s, e] = logicalRange(term, top - 1);
    lines.unshift(readLine(term, s, e));
    top = s;
  }
  for (let i = 0, bottom = end; i < REACH && bottom + 1 < buf.length; i++) {
    const [s, e] = logicalRange(term, bottom + 1);
    lines.push(readLine(term, s, e));
    bottom = e;
  }
  return lines;
}

interface Candidate {
  path: string;
  /** Posição linear para comparar sobreposição. */
  from: number;
  to: number;
  cells: IBufferCellPosition[];
  text: string;
}

interface Found extends Candidate {
  kind: Kind;
}

function candidates(lines: Line[], cwd: string): Candidate[] {
  const pos = (line: number, col: number) => line * 1_000_000 + col;
  return findPathsAcross(lines.map((l) => l.text)).map((m) => {
    const cells: IBufferCellPosition[] = [];
    let text = "";
    for (let line = m.start.line; line <= m.end.line; line++) {
      // Sem o recuo da continuação nem os espaços do fim da linha quebrada.
      const l = lines[line];
      const a = line === m.start.line ? m.start.col : l.text.length - l.text.trimStart().length;
      const b = line === m.end.line ? m.end.col + 1 : l.text.trimEnd().length;
      cells.push(...l.cells.slice(a, b));
      text += l.text.slice(a, b);
    }
    return { path: resolvePath(cwd, m.path), from: pos(m.start.line, m.start.col), to: pos(m.end.line, m.end.col), cells, text };
  });
}

/** Fica com os que existem, preferindo o trecho mais longo quando se sobrepõem. */
function pick(cands: Candidate[], found: Kind[]): Found[] {
  const ok = cands.map((c, i) => ({ ...c, kind: found[i] })).filter((c) => c.kind);
  ok.sort((a, b) => b.to - b.from - (a.to - a.from));
  const out: Found[] = [];
  for (const c of ok) if (!out.some((o) => c.from <= o.to && c.to >= o.from)) out.push(c);
  return out;
}

export function fileLinkProvider(term: Terminal, host: FileLinkHost): ILinkProvider {
  return {
    provideLinks(row, callback) {
      const cwd = host.cwd();
      if (!cwd) return callback(undefined);
      const cands = candidates(linesAround(term, row - 1), cwd);
      if (!cands.length) return callback(undefined);
      void kindsOf(cands.map((c) => c.path)).then((found) => {
        const links: ILink[] = pick(cands, found)
          .filter((f) => f.cells.some((c) => c.y === row))
          .map((f) => ({
            range: { start: f.cells[0], end: f.cells[f.cells.length - 1] },
            text: f.text,
            decorations: { pointerCursor: true, underline: true },
            // Quem abre é o `mousedown` de `installCtrlClick`: aqui o xterm só
            // ativaria no `mouseup`, e o redesenho do CLI ao ganhar foco
            // apaga o link no meio do clique.
            activate: hideHint,
            hover: (e) => showHint(e, actionOf(f.path, f.kind)),
            leave: hideHint,
          }));
        callback(links.length ? links : undefined);
      });
    },
  };
}

/** Célula (1-based, coordenadas do buffer) sob o mouse. */
function cellAt(term: Terminal, e: MouseEvent): { x: number; y: number } | null {
  const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
  if (!screen || !term.cols || !term.rows) return null;
  const r = screen.getBoundingClientRect();
  const col = Math.floor(((e.clientX - r.left) / r.width) * term.cols);
  const row = Math.floor(((e.clientY - r.top) / r.height) * term.rows);
  if (col < 0 || row < 0 || col >= term.cols || row >= term.rows) return null;
  return { x: col + 1, y: row + 1 + term.buffer.active.viewportY };
}

/**
 * Ctrl (+ Shift) + clique abre o arquivo já no `mousedown`, sem depender do estado de
 * links do xterm (que se perde quando o CLI redesenha a tela ao ganhar foco).
 */
export function installCtrlClick(term: Terminal, el: HTMLElement, host: FileLinkHost): void {
  el.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
      const cwd = host.cwd();
      const at = cellAt(term, e);
      if (!cwd || !at) return;
      const cands = candidates(linesAround(term, at.y - 1), cwd);
      if (!cands.length) return;
      const under = (list: Found[]) => list.find((f) => f.cells.some((c) => c.x === at.x && c.y === at.y));
      const reveal = e.shiftKey;
      // Já visto ao passar o mouse: abre e não deixa o clique ir para o CLI.
      const cached = cachedKinds(cands.map((c) => c.path));
      if (cached) {
        const f = under(pick(cands, cached));
        if (!f) return;
        e.preventDefault();
        e.stopPropagation();
        activate(host, f.path, f.kind, reveal);
        return;
      }
      void kindsOf(cands.map((c) => c.path)).then((found) => {
        const f = under(pick(cands, found));
        if (f) activate(host, f.path, f.kind, reveal);
      });
    },
    true,
  );
}
