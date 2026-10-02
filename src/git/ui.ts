// Peças compartilhadas do painel Git: contexto do repositório, menus e ícones.
import type { ToolKind } from "../core/types";
import { esc, h } from "../ui/dom";
import { closePopover, popover } from "../ui/feedback";
import type { GitStatus, RemoteOp } from "./api";

/** O que o painel Git pede ao resto do Polvo. */
export interface GitHost {
  newSession(cwd: string, tool?: ToolKind): void;
  askAgent(cwd: string, prompt: string): void;
  openTerminal(cwd: string): void;
  openDoc(path: string): void;
  /** O sidebar e os selos precisam reler o git (worktrees novas, branch trocada). */
  gitChanged(): void;
}

/** Estado compartilhado entre as abas do painel. */
export interface GitCtx {
  readonly repo: string;
  readonly status: GitStatus | null;
  readonly host: GitHost;
  readonly webUrl: string | null;
  /** Relê o status (e avisa as abas). */
  refresh(): Promise<void>;
  /** Roda uma ação mostrando erro/sucesso e relendo o status no fim. */
  act<T>(p: () => Promise<T>, ok?: string | ((v: T) => string)): Promise<T | undefined>;
  checkout(name: string, remote?: boolean): Promise<void>;
  sync(op: RemoteOp): Promise<void>;
  newBranch(from?: string, worktree?: boolean): Promise<void>;
  showHistory(path?: string): void;
}

export type MenuItem = { id: string; label: string; hint?: string; danger?: boolean; disabled?: boolean; icon?: string } | "-" | { header: string };

/** Menu ancorado num elemento (ou no ponto do clique, para o botão direito). */
export function menu(key: string, at: HTMLElement | MouseEvent, items: MenuItem[], onPick: (id: string) => void): void {
  let anchor: HTMLElement;
  let temp: HTMLElement | null = null;
  if (at instanceof MouseEvent) {
    at.preventDefault();
    temp = h("div", "g-anchor");
    temp.style.left = `${at.clientX}px`;
    temp.style.top = `${at.clientY}px`;
    document.body.append(temp);
    anchor = temp;
  } else anchor = at;
  popover(
    key,
    anchor,
    (el) => {
      el.innerHTML = items
        .map((it) => {
          if (it === "-") return "<hr>";
          if ("header" in it) return `<div class="mh">${esc(it.header)}</div>`;
          return `<button data-mi="${esc(it.id)}"${it.disabled ? " disabled" : ""} class="${it.danger ? "danger" : ""}">${it.icon ?? ""}<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ""}</button>`;
        })
        .join("");
      el.onclick = (e) => {
        const b = (e.target as Element).closest<HTMLButtonElement>("[data-mi]");
        if (!b || b.disabled) return;
        closePopover();
        onPick(b.dataset.mi!);
      };
    },
    "menu gmenu",
    () => temp?.remove(),
  );
}

const svg = (d: string, s = 14) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const GI = {
  branch: svg('<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="5.5" r="1.6"/><path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-2.3 3-7 3.6"/>'),
  repo: svg('<path d="M3 2.5h8.5v11H4.5A1.5 1.5 0 0 1 3 12z"/><path d="M3 12a1.5 1.5 0 0 1 1.5-1.5h7"/>'),
  sync: svg('<path d="M13 6.5A5 5 0 0 0 4 4.2L2.5 5.5M3 9.5a5 5 0 0 0 9 2.3l1.5-1.3"/><path d="M2.5 2.5v3h3M13.5 13.5v-3h-3"/>'),
  up: svg('<path d="M8 13V3M4 7l4-4 4 4"/>', 13),
  down: svg('<path d="M8 3v10M4 9l4 4 4-4"/>', 13),
  caret: svg('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>', 12),
  refresh: svg('<path d="M13.5 8A5.5 5.5 0 1 1 11.8 4"/><path d="M13.5 2.5V5.8h-3.3"/>'),
  more: '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
  spark: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.6 4.6L14 7.2l-4.4 1.6L8 13.4 6.4 8.8 2 7.2l4.4-1.6z"/></svg>',
  editor: svg('<path d="m5.5 4-4 4 4 4M10.5 4l4 4-4 4"/>'),
  folder: svg('<path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.4 1.5h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/>'),
  check: svg('<path d="m3 8.5 3 3 7-7"/>', 12),
  stash: svg('<path d="M2.5 9.5h3l1 1.5h3l1-1.5h3M2.5 9.5 4 3.5h8l1.5 6v3h-11z"/>'),
  tag: svg('<path d="M2 2.5h5.5L14 9l-5 5-6.5-6.5z"/><circle cx="5" cy="5.5" r="1"/>', 12),
  pr: svg('<circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="12.5" r="1.6"/><path d="M4 5.1v5.8M12 10.9V6a2 2 0 0 0-2-2H7.5M9 2.5 7.5 4 9 5.5"/>'),
  web: svg('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/>'),
  copy: svg('<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/>'),
  terminal: svg('<path d="m3 5 3 3-3 3M8 11.5h5"/>'),
  warn: svg('<path d="M8 2.5 14 13H2zM8 6.5v3M8 11.3v.2"/>'),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>'),
  person: svg('<circle cx="6.5" cy="5.5" r="2.5"/><path d="M2 13.5c.6-2.4 2.4-3.6 4.5-3.6s3.9 1.2 4.5 3.6M12.5 5v4M10.5 7h4"/>'),
  gear: svg('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>'),
};

/** Letra de status de um arquivo para a lista (A, M, D, R, C, U…). */
export function letterOf(f: { x: string; y: string; untracked: boolean; conflict: boolean }): string {
  if (f.conflict) return "U";
  if (f.untracked) return "A";
  const c = f.y !== "." ? f.y : f.x;
  return c === "?" ? "A" : c;
}

/** Estado da caixa de seleção: no commit, parcial ou fora. */
export function stagedState(f: { x: string; y: string; untracked: boolean }): "on" | "part" | "off" {
  if (f.untracked || f.x === ".") return "off";
  return f.y === "." ? "on" : "part";
}

export function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", name: p } : { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
}

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i;

/** Pasta absoluta de um caminho relativo ao repositório. */
export const absPath = (repo: string, rel: string) => `${repo.replace(/[\\/]+$/, "")}\\${rel.replace(/\//g, "\\")}`;
