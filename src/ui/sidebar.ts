// Barra lateral: sessões agrupadas por projeto (repositório), com os worktrees
// de cada um. Recolhida, vira o trilho de ícones.
import { store } from "../core/store";
import type { Session, ToolKind } from "../core/types";
import { basename, esc, h, hideTip, showTip } from "./dom";
import { ICON, sessionColor, TOOLS, toolIcon } from "./icons";
import { statusPill } from "./pane";

const COLLAPSED_KEY = "polvo.sidebar.collapsed";
const CLOSED_KEY = "polvo.sidebar.closedGroups";

export interface SidebarHost {
  /** Clique ou arraste numa sessão. */
  sessionDown(e: PointerEvent, id: string): void;
  /** Nova sessão direto numa pasta (sem perguntar). */
  newIn(cwd: string, tool: ToolKind): void;
  /** Diálogo completo de nova sessão. */
  openDialog(): void;
  /** A largura mudou (recolher/expandir). */
  resized(): void;
}

interface WorktreeGroup {
  path: string;
  label: string;
  main: boolean;
  sessions: Session[];
}

interface ProjectGroup {
  key: string;
  name: string;
  path: string;
  branch: string | null;
  worktrees: WorktreeGroup[];
}

const readJson = <T>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
};

const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

/** Agrupa as sessões desta janela por projeto e worktree. */
export function groupSessions(sessions: Session[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const s of sessions) {
    const info = store.git[s.cwd];
    const key = norm(info?.project ?? s.cwd);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name: basename(info?.project ?? s.cwd),
        path: info?.project ?? s.cwd,
        branch: info?.worktrees.find((w) => w.main)?.branch ?? info?.branch ?? null,
        worktrees: (info?.worktrees ?? [{ path: s.cwd, branch: null, main: true }]).map((w) => ({
          path: w.path,
          label: w.branch ?? basename(w.path),
          main: w.main,
          sessions: [],
        })),
      };
      groups.set(key, g);
    }
    const root = norm(info?.root ?? s.cwd);
    let wt = g.worktrees.find((w) => norm(w.path) === root);
    if (!wt) {
      wt = { path: info?.root ?? s.cwd, label: info?.branch ?? basename(s.cwd), main: false, sessions: [] };
      g.worktrees.push(wt);
    }
    wt.sessions.push(s);
  }
  return [...groups.values()];
}

/** Ferramenta usada mais recentemente no grupo (para o "+" rápido). */
const lastTool = (sessions: Session[]): ToolKind =>
  [...sessions].sort((a, b) => b.createdAt - a.createdAt)[0]?.tool ?? "claude";

export class Sidebar {
  readonly el = h("nav", "rail sidebar");
  private body = h("div", "sb-body");
  private collapsed = readJson<boolean>(COLLAPSED_KEY, false);
  private closed = new Set(readJson<string[]>(CLOSED_KEY, []));

  constructor(private host: SidebarHost) {
    const foot = h("div", "sb-foot");
    foot.innerHTML = `<button class="sb-new" data-dialog title="Nova sessão em qualquer pasta (diálogo)">+ <span>Nova sessão…</span></button><button class="sb-toggle" data-toggle title="Recolher / expandir a barra"></button>`;
    this.el.append(this.body, foot);
    this.el.addEventListener("pointerdown", (e) => this.onDown(e));
    this.el.addEventListener("click", (e) => this.onClick(e));
    this.el.addEventListener("pointerover", (e) => this.onOver(e));
    this.el.addEventListener("pointerleave", hideTip);
    this.applyCollapsed();
  }

  render(): void {
    const mine = store.mine;
    this.body.innerHTML = this.collapsed ? this.renderIcons(mine) : this.renderGroups(mine);
  }

  private renderIcons(mine: Session[]): string {
    return `<div class="ritems">${mine
      .map(
        (s) =>
          `<div class="ri${s.minimized ? " min" : ""}${store.active === s.id ? " on" : ""}" data-id="${s.id}" style="--acc:${sessionColor(s)}">${toolIcon(s.tool, 19)}<i class="sd ${s.runtime.status}"></i></div>`,
      )
      .join("")}</div>`;
  }

  private renderGroups(mine: Session[]): string {
    if (!mine.length) return '<div class="sb-empty">Nenhuma sessão nesta janela.<br>Use o “+” abaixo para começar.</div>';
    const tools = (cwd: string) =>
      (["claude", "codex", "opencode", "shell"] as ToolKind[])
        .filter((t) => store.toolEnabled(t))
        .map((t) => `<button class="sb-tool" data-new="${esc(cwd)}" data-tool="${t}" title="Novo ${TOOLS[t].short} aqui">${toolIcon(t, 13)}</button>`)
        .join("");
    return mine.length
      ? groupSessions(mine)
          .map((g) => {
            const closed = this.closed.has(g.key);
            const all = g.worktrees.flatMap((w) => w.sessions);
            const multi = g.worktrees.length > 1;
            const head = `<div class="pg-h${closed ? " closed" : ""}" data-group="${esc(g.key)}" title="${esc(g.path)}">
                <span class="chev">${ICON.chevron}</span>${ICON.folder}<b>${esc(g.name)}</b>${!multi && g.branch ? `<em>${esc(g.branch)}</em>` : ""}<span class="cnt">${all.length}</span>
                <span class="pg-acts">${tools(g.path)}<button class="sb-add" data-new="${esc(g.path)}" data-tool="${lastTool(all)}" title="Nova sessão neste projeto (${TOOLS[lastTool(all)].short})">+</button></span></div>`;
            if (closed) return `<div class="pg">${head}</div>`;
            const body = g.worktrees
              .filter((w) => w.sessions.length || multi)
              .map((w) => {
                const rows = w.sessions.map((s) => this.row(s)).join("");
                if (!multi) return rows;
                return `<div class="wt"><div class="wt-h" title="${esc(w.path)}">${ICON.branch}<span>${esc(w.label)}</span>${w.main ? "" : '<em>worktree</em>'}
                  <span class="pg-acts">${tools(w.path)}<button class="sb-add" data-new="${esc(w.path)}" data-tool="${lastTool(w.sessions.length ? w.sessions : all)}" title="Nova sessão neste worktree">+</button></span></div>${rows}</div>`;
              })
              .join("");
            return `<div class="pg">${head}${body}</div>`;
          })
          .join("")
      : "";
  }

  private row(s: Session): string {
    return `<div class="si${s.minimized ? " min" : ""}${store.active === s.id ? " on" : ""}${s.color ? " colored" : ""}" data-id="${s.id}" style="--acc:${sessionColor(s)}">
      ${toolIcon(s.tool, 14)}<span class="si-t">${esc(s.title)}</span>${store.context[s.id] !== undefined ? `<span class="si-ctx">${Math.round(store.context[s.id])}%</span>` : ""}<i class="sd ${s.runtime.status}"></i></div>`;
  }

  private onDown(e: PointerEvent): void {
    const item = (e.target as Element).closest<HTMLElement>(".si,.ri");
    if (!item || (e.target as Element).closest("button")) return;
    hideTip();
    this.host.sessionDown(e, item.dataset.id!);
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as Element;
    const add = t.closest<HTMLElement>("[data-new]");
    if (add) {
      e.stopPropagation();
      this.host.newIn(add.dataset.new!, add.dataset.tool as ToolKind);
      return;
    }
    if (t.closest("[data-dialog]")) return this.host.openDialog();
    if (t.closest("[data-toggle]")) {
      this.collapsed = !this.collapsed;
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(this.collapsed));
      this.applyCollapsed();
      this.host.resized();
      return;
    }
    const group = t.closest<HTMLElement>("[data-group]")?.dataset.group;
    if (group) {
      if (this.closed.has(group)) this.closed.delete(group);
      else this.closed.add(group);
      localStorage.setItem(CLOSED_KEY, JSON.stringify([...this.closed]));
      this.render();
    }
  }

  private onOver(e: PointerEvent): void {
    const item = (e.target as Element).closest<HTMLElement>(".si,.ri");
    const s = store.session(item?.dataset.id ?? null);
    if (!item || !s) return;
    showTip(
      item,
      `<b>${esc(s.title)}</b> <span>· ${TOOLS[s.tool].short} · ${esc(basename(s.cwd))}${s.minimized ? " · recolhida" : ""}</span><div class="st ${s.runtime.status}" style="margin-top:6px;--acc:${sessionColor(s)}">${statusPill(s.runtime.status)}</div>`,
    );
  }

  private applyCollapsed(): void {
    this.el.classList.toggle("collapsed", this.collapsed);
    this.el.querySelector<HTMLElement>("[data-toggle]")!.innerHTML = this.collapsed ? "»" : "«";
    this.render();
  }
}
