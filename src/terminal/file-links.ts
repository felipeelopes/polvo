// Caminhos de arquivos e pastas no terminal viram links (como no VS Code):
// Ctrl + clique abre a pasta no Explorer, mostra o arquivo selecionado nele ou,
// se for Markdown, abre no visualizador do Polvo. Só sublinha o que existe.
import type { IBufferCellPosition, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { ipc } from "../core/ipc";
import { t } from "../i18n";
import { findPaths, MD_EXT, resolvePath } from "../docs/paths";
import { toast } from "../ui/feedback";

export interface FileLinkHost {
  /** Pasta da sessão, base dos caminhos relativos. */
  cwd(): string | undefined;
  open(path: string): void;
}

/** 0 não existe, 1 arquivo, 2 pasta (como `paths_kind` no backend). */
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

/** Abre conforme o tipo: pasta no Explorer, Markdown no Polvo, outro arquivo selecionado no Explorer. */
export function openPath(host: FileLinkHost, path: string, kind: Kind): void {
  if (kind === 2) ipc.folderOpen(path).catch((e) => toast(String(e)));
  else if (MD_EXT.test(path)) host.open(path);
  else if (kind === 1) ipc.fileReveal(path).catch((e) => toast(String(e)));
}

let hint: HTMLDivElement | null = null;

function showHint(e: MouseEvent, path: string, kind: Kind): void {
  hideHint();
  const what = kind === 2 ? "openInExplorer" : MD_EXT.test(path) ? "openInPolvo" : "revealInExplorer";
  hint = document.createElement("div");
  hint.className = "tip";
  hint.innerHTML = `<kbd>Ctrl</kbd> + ${t("terminal.ctrlClick.click")} <span>${t(`terminal.ctrlClick.${what}`)}</span>`;
  hint.style.left = `${e.clientX + 12}px`;
  hint.style.top = `${e.clientY + 16}px`;
  document.body.appendChild(hint);
}

function hideHint(): void {
  hint?.remove();
  hint = null;
}

/** Texto da linha lógica (juntando quebras automáticas) e a célula de cada caractere. */
function logicalLine(term: Terminal, row: number): { text: string; cells: IBufferCellPosition[] } {
  const buf = term.buffer.active;
  let start = row;
  while (start > 0 && buf.getLine(start)?.isWrapped) start--;
  let end = row;
  while (end + 1 < buf.length && buf.getLine(end + 1)?.isWrapped) end++;
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

export function pathLinkProvider(term: Terminal, host: FileLinkHost): ILinkProvider {
  return {
    provideLinks(row, callback) {
      const cwd = host.cwd();
      if (!cwd) return callback(undefined);
      const { text, cells } = logicalLine(term, row - 1);
      const matches = findPaths(text);
      if (!matches.length) return callback(undefined);
      const resolved = matches.map((m) => resolvePath(cwd, m.path));
      void kindsOf(resolved).then((found) => {
        const links: ILink[] = [];
        matches.forEach((m, i) => {
          const kind = found[i];
          if (!kind) return;
          const from = cells[m.index];
          const to = cells[m.index + m.length - 1];
          if (!from || !to || (from.y !== row && to.y !== row && !(from.y < row && to.y > row))) return;
          links.push({
            range: { start: from, end: to },
            text: text.slice(m.index, m.index + m.length),
            decorations: { pointerCursor: true, underline: true },
            // Quem abre é o `mousedown` de `installCtrlClick`: aqui o xterm só
            // ativaria no `mouseup`, e o redesenho do CLI ao ganhar foco
            // apaga o link no meio do clique.
            activate: hideHint,
            hover: (e) => showHint(e, resolved[i], kind),
            leave: hideHint,
          });
        });
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
 * Ctrl + clique abre o caminho já no `mousedown`, sem depender do estado de
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
      const { text, cells } = logicalLine(term, at.y - 1);
      const m = findPaths(text).find((m) => cells.slice(m.index, m.index + m.length).some((c) => c.x === at.x && c.y === at.y));
      if (!m) return;
      const path = resolvePath(cwd, m.path);
      // Já visto ao passar o mouse: abre e não deixa o clique ir para o CLI.
      const seen = kinds.get(path)?.kind;
      if (seen) {
        e.preventDefault();
        e.stopPropagation();
        hideHint();
        openPath(host, path, seen);
        return;
      }
      void kindsOf([path]).then(([kind]) => kind && openPath(host, path, kind));
    },
    true,
  );
}
