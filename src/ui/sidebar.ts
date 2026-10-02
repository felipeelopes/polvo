// Barra lateral: sessões agrupadas por projeto (repositório), com os worktrees
// de cada um. Recolhida, vira o trilho de projetos.
import { colorValue, initials, urgentStatus } from "../core/appearance";
import { normPath, store } from "../core/store";
import type { Session, ToolKind } from "../core/types";
import { basename, esc, h, hideTip, showTip } from "./dom";
import { closePopover, popover, popoverOpen, refreshPopover } from "./feedback";
import { ICON, projectIcon, sessionColor, TOOLS, toolIcon } from "./icons";
import { statusPill } from "./pane";
import { openProjectStyle } from "./project-style";
import { t, tn } from "../i18n";
import "../styles/git-badges.css";

const COLLAPSED_KEY = "polvo.sidebar.collapsed";
const CLOSED_KEY = "polvo.sidebar.closedGroups";

export interface SidebarHost {
  /** Clique ou arraste numa sessão. */
  sessionDown(e: PointerEvent, id: string): void;
  /** Nova sessão direto numa pasta (sem perguntar). */
  newIn(cwd: string, tool: ToolKind): void;
  /** Liga ("só este projeto") ou desliga o filtro de projeto. */
  focusProject(key: string | null): void;
  /** Tira um projeto salvo (sem sessões) da barra. */
  removeProject(path: string): void;
  /** A largura mudou (recolher/expandir). */
  resized(): void;
  /** Abre o painel Git num repositório/worktree. */
  openGit(path: string): void;
}

/** Botão que abre o painel Git num projeto/worktree. */
const gitBtn = (path: string) => `<button class="sb-tool" data-git="${esc(path)}" title="${esc(t("git.badge.open"))}">${ICON.branch}</button>`;

/** Selo de git de um worktree: alterados, para enviar, para puxar, conflitos. */
function gitBadge(path: string): string {
  const g = store.gitSummary[norm(path)];
  if (!g || (!g.changed && !g.ahead && !g.behind)) return "";
  const tip = [
    g.conflicts ? t("git.badge.conflicts") : "",
    g.changed ? tn("git.badge.changed", g.changed) : "",
    g.ahead ? t("git.badge.ahead", { n: g.ahead }) : "",
    g.behind ? t("git.badge.behind", { n: g.behind }) : "",
    t("git.badge.open"),
  ]
    .filter(Boolean)
    .join("\n");
  return `<span class="sb-git${g.conflicts ? " bad" : ""}" data-git="${esc(path)}" title="${esc(tip)}">${g.changed ? `<i class="c">●${g.changed}</i>` : ""}${g.ahead ? `<i class="a">↑${g.ahead}</i>` : ""}${g.behind ? `<i class="b">↓${g.behind}</i>` : ""}</span>`;
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
  /** Projeto salvo (Abrir/Novo/Clonar), mesmo sem sessões. */
  saved: boolean;
  /** É um repositório git (mostra branches e worktrees). */
  git: boolean;
}

const readJson = <T>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
};

const norm = normPath;

/** Agrupa as sessões desta janela por projeto e worktree (e inclui os projetos salvos). */
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
        saved: false,
        git: !!info,
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
  for (const p of store.projects) {
    const info = store.git[p.path];
    const key = norm(info?.project ?? p.path);
    const g = groups.get(key);
    if (g) {
      g.saved = true;
      g.git ||= !!info;
      continue;
    }
    groups.set(key, {
      key,
      name: p.name || basename(p.path),
      path: info?.project ?? p.path,
      branch: info?.branch ?? null,
      worktrees: (info?.worktrees ?? [{ path: p.path, branch: null, main: true }]).map((w) => ({ path: w.path, label: w.branch ?? basename(w.path), main: w.main, sessions: [] })),
      saved: true,
      git: !!info,
    });
  }
  return [...groups.values()];
}

/** Ferramenta usada mais recentemente no grupo (para o "+" rápido). */
const lastTool = (sessions: Session[]): ToolKind => {
  const last = [...sessions].sort((a, b) => b.createdAt - a.createdAt).find((s) => store.toolEnabled(s.tool))?.tool;
  return last ?? (["claude", "codex", "opencode", "shell"] as ToolKind[]).find((t) => store.toolEnabled(t)) ?? "shell";
};

export class Sidebar {
  readonly el = h("nav", "rail sidebar");
  private body = h("div", "sb-body");
  private collapsed = readJson<boolean>(COLLAPSED_KEY, false);
  private closed = new Set(readJson<string[]>(CLOSED_KEY, []));
  /** Popover de sessões aberto a partir do trilho (atualiza junto com a barra). */
  private railPop: { key: string; render: (el: HTMLDivElement) => void } | null = null;

  constructor(private host: SidebarHost) {
    const foot = h("div", "sb-foot");
    foot.innerHTML = `<button class="sb-toggle" data-toggle title="${t("sidebar.toggle")}"></button>`;
    this.el.append(this.body, foot);
    this.el.addEventListener("pointerdown", (e) => this.onDown(e));
    this.el.addEventListener("click", (e) => this.onClick(e));
    this.el.addEventListener("contextmenu", (e) => this.onMenu(e));
    this.el.addEventListener("pointerover", (e) => this.onOver(e));
    this.el.addEventListener("pointerleave", hideTip);
    this.applyCollapsed();
  }

  render(): void {
    const mine = store.mine;
    this.body.innerHTML = this.collapsed ? this.renderIcons(mine) : this.renderGroups(mine);
    if (this.railPop && popoverOpen(this.railPop.key)) refreshPopover(this.railPop.key, this.railPop.render);
  }

  /** Trilho recolhido: um item por projeto (ícone ou iniciais na cor do projeto). */
  private renderIcons(mine: Session[]): string {
    return `<div class="ritems">${groupSessions(mine)
      .map((g) => {
        const all = g.worktrees.flatMap((w) => w.sessions);
        const rec = store.projectRecord(g.key);
        const pc = colorValue(rec?.color);
        const st = urgentStatus(all.map((s) => s.runtime.status));
        const on = all.some((s) => s.id === store.active);
        const out = !!store.project && store.project !== g.key;
        const face = rec?.icon ? projectIcon(rec.icon, 19) : `<span class="rp-ini">${esc(initials(g.name))}</span>`;
        return `<div class="rp${on ? " on" : ""}${pc ? "" : " plain"}${all.length ? "" : " none"}${out ? " out" : ""}" data-project="${esc(g.key)}" data-pop style="--pc:${pc ?? "var(--muted)"};--acc:${pc ?? "var(--accent)"}">${face}${all.length ? `<span class="rp-n">${all.length}</span>` : ""}${st ? `<i class="sd ${st}"></i>` : ""}</div>`;
      })
      .join("")}</div>`;
  }

  /** Clique num projeto do trilho: as sessões dele (clicar ou arrastar) e "nova sessão". */
  private openRailProject(item: HTMLElement, key: string): void {
    hideTip();
    const render = (el: HTMLDivElement) => {
      const g = groupSessions(store.mine).find((x) => x.key === key);
      if (!g) return closePopover();
      const all = g.worktrees.flatMap((w) => w.sessions);
      const tool = lastTool(all);
      const rows = all
        .map((s) => `<div class="si${s.minimized ? " min" : ""}${store.active === s.id ? " on" : ""}" data-sid="${s.id}" style="--acc:${sessionColor(s)}">${toolIcon(s.tool, 14)}<span class="si-t">${esc(s.title)}</span><i class="sd ${s.runtime.status}"></i></div>`)
        .join("");
      el.innerHTML = `<div class="mh">${esc(g.name)}</div>${rows || `<div class="rp-empty">${t("sidebar.noSessions")}</div>`}<hr><button data-add="${esc(g.path)}" data-tool="${tool}">${ICON.plusSm}<span>${t("sidebar.newInProject", { tool: TOOLS[tool].short })}</span></button>`;
      el.onpointerdown = (e) => {
        const row = (e.target as Element).closest<HTMLElement>("[data-sid]");
        if (!row || e.button !== 0) return;
        closePopover();
        this.host.sessionDown(e, row.dataset.sid!);
      };
      el.onclick = (e) => {
        const add = (e.target as Element).closest<HTMLElement>("[data-add]");
        if (!add) return;
        closePopover();
        this.host.newIn(add.dataset.add!, add.dataset.tool as ToolKind);
      };
    };
    const popKey = `rail:${key}`;
    this.railPop = { key: popKey, render };
    // Trocar de projeto fecha o popover anterior: só limpa se ainda for este.
    popover(popKey, item, render, "menu rpop", () => this.railPop?.key === popKey && (this.railPop = null), "right");
  }

  private renderGroups(mine: Session[]): string {
    if (!mine.length && !store.projects.length) return `<div class="sb-empty">${t("sidebar.empty.title")}<br>${t("sidebar.empty.hint")}</div>`;
    const agents = (["claude", "codex", "opencode"] as ToolKind[]).filter((t) => store.toolEnabled(t));
    // Com um só agente configurado, o "+" já basta (sem ícones repetidos).
    const tools = (cwd: string) =>
      (agents.length <= 1 ? [] : ([...agents, "shell"] as ToolKind[]))
        .map((k) => `<button class="sb-tool" data-new="${esc(cwd)}" data-tool="${k}" title="${t("sidebar.newToolHere", { tool: TOOLS[k].short })}">${toolIcon(k, 13)}</button>`)
        .join("");
    return groupSessions(mine)
          .map((g) => {
            const closed = this.closed.has(g.key);
            const all = g.worktrees.flatMap((w) => w.sessions);
            const tree = g.git;
            const focused = store.project === g.key;
            const out = !!store.project && !focused;
            const focusBtn = `<button class="sb-tool sb-focus${focused ? " on" : ""}" data-focus="${esc(g.key)}" title="${focused ? t("sidebar.showAll") : t("sidebar.focusProject")}">${ICON.focus}</button>`;
            const removeBtn = g.saved && !all.length ? `<button class="sb-tool" data-remove="${esc(g.path)}" title="${t("sidebar.remove")}">${ICON.close}</button>` : "";
            const rec = store.projectRecord(g.key);
            const pc = colorValue(rec?.color);
            const head = `<div class="pg-h${closed ? " closed" : ""}${pc ? " styled" : ""}" data-group="${esc(g.key)}" title="${esc(g.path)}"${pc ? ` style="--pc:${pc}"` : ""}>
                <span class="chev">${ICON.chevron}</span>${projectIcon(rec?.icon)}<b>${esc(g.name)}</b>${focused ? `<span class="pg-flag">${t("sidebar.onlyThis")}</span>` : ""}${closed && tree ? gitBadge(g.path) : ""}<span class="cnt">${all.length}</span>
                <span class="pg-acts">${tools(g.path)}${tree ? gitBtn(g.path) : ""}${focusBtn}${removeBtn}<button class="sb-add" data-new="${esc(g.path)}" data-tool="${lastTool(all)}" title="${t("sidebar.newInProject", { tool: TOOLS[lastTool(all)].short })}">${ICON.plusSm}</button></span></div>`;
            const cls = `pg${focused ? " focus" : ""}${out ? " out" : ""}`;
            if (closed) return `<div class="${cls}">${head}</div>`;
            // Repositório: branch principal primeiro, depois os worktrees, todos sempre visíveis.
            const body = [...g.worktrees]
              .sort((a, b) => Number(b.main) - Number(a.main))
              .map((w) => {
                const rows = w.sessions.map((s) => this.row(s)).join("");
                if (!tree) return rows;
                const tool = lastTool(w.sessions.length ? w.sessions : all);
                return `<div class="wt"><div class="wt-h" title="${esc(w.path)}">${ICON.branch}<span>${esc(w.label)}</span>${w.main ? "" : `<em>${t("sidebar.worktree")}</em>`}${gitBadge(w.path)}
                  <span class="pg-acts">${tools(w.path)}${gitBtn(w.path)}<button class="sb-add" data-new="${esc(w.path)}" data-tool="${tool}" title="${t("sidebar.newInWorktree", { tool: TOOLS[tool].short, branch: esc(w.label) })}">${ICON.plusSm}</button></span></div>${rows || `<div class="wt-none">${t("sidebar.noSessions")}</div>`}</div>`;
              })
              .join("");
            return `<div class="${cls}">${head}${body || (all.length ? "" : `<div class="pg-none">${t("sidebar.noSessionsHint")}</div>`)}</div>`;
          })
          .join("");
  }

  private row(s: Session): string {
    return `<div class="si${s.minimized ? " min" : ""}${store.active === s.id ? " on" : ""}${s.color ? " colored" : ""}" data-id="${s.id}" style="--acc:${sessionColor(s)}">
      ${toolIcon(s.tool, 14)}<span class="si-t">${esc(s.title)}</span>${store.context[s.id] !== undefined ? `<span class="si-ctx">${Math.round(store.context[s.id])}%</span>` : ""}<i class="sd ${s.runtime.status}"></i></div>`;
  }

  private onDown(e: PointerEvent): void {
    const item = (e.target as Element).closest<HTMLElement>(".si");
    if (!item || (e.target as Element).closest("button")) return;
    hideTip();
    this.host.sessionDown(e, item.dataset.id!);
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as Element;
    const gitPath = t.closest<HTMLElement>("[data-git]")?.dataset.git;
    if (gitPath) {
      e.stopPropagation();
      return this.host.openGit(gitPath);
    }
    const add = t.closest<HTMLElement>("[data-new]");
    if (add) {
      e.stopPropagation();
      this.host.newIn(add.dataset.new!, add.dataset.tool as ToolKind);
      return;
    }
    const focus = t.closest<HTMLElement>("[data-focus]")?.dataset.focus;
    if (focus !== undefined) {
      e.stopPropagation();
      return this.host.focusProject(store.project === focus ? null : focus);
    }
    const remove = t.closest<HTMLElement>("[data-remove]")?.dataset.remove;
    if (remove) {
      e.stopPropagation();
      return this.host.removeProject(remove);
    }
    const railItem = t.closest<HTMLElement>("[data-project]");
    if (railItem) return this.openRailProject(railItem, railItem.dataset.project!);
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

  /** Clique direito num projeto (barra ou trilho): cor e ícone. */
  private onMenu(e: MouseEvent): void {
    const item = (e.target as Element).closest<HTMLElement>("[data-group],[data-project]");
    const key = item?.dataset.group ?? item?.dataset.project;
    const g = key ? groupSessions(store.mine).find((x) => x.key === key) : undefined;
    if (!g) return;
    hideTip();
    openProjectStyle(e, g.key, g.path, g.name);
  }

  private onOver(e: PointerEvent): void {
    const rail = (e.target as Element).closest<HTMLElement>("[data-project]");
    if (rail) {
      if (popoverOpen()) return;
      const g = groupSessions(store.mine).find((x) => x.key === rail.dataset.project);
      const st = g && urgentStatus(g.worktrees.flatMap((w) => w.sessions).map((s) => s.runtime.status));
      const acc = colorValue(store.projectRecord(rail.dataset.project!)?.color) ?? "var(--accent)";
      if (g) showTip(rail, `<b>${esc(g.name)}</b> <span>· ${esc(g.path)}</span>${st ? `<div class="st ${st}" style="margin-top:6px;--acc:${acc}">${statusPill(st)}</div>` : ""}`);
      return;
    }
    const item = (e.target as Element).closest<HTMLElement>(".si");
    const s = store.session(item?.dataset.id ?? null);
    if (!item || !s) return;
    showTip(
      item,
      `<b>${esc(s.title)}</b> <span>· ${TOOLS[s.tool].short} · ${esc(basename(s.cwd))}${s.minimized ? ` · ${t("sidebar.minimized")}` : ""}</span><div class="st ${s.runtime.status}" style="margin-top:6px;--acc:${sessionColor(s)}">${statusPill(s.runtime.status)}</div>`,
    );
  }

  private applyCollapsed(): void {
    this.el.classList.toggle("collapsed", this.collapsed);
    this.el.querySelector<HTMLElement>("[data-toggle]")!.innerHTML = this.collapsed ? ICON.sidebarOpen : ICON.sidebarClose;
    this.render();
  }
}
