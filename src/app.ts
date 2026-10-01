// Controlador da janela: monta a interface, liga eventos do backend e
// implementa as ações sobre sessões (recolher, mover de tela, encerrar…).
import { events, ipc } from "./core/ipc";
import { clone, insertAt, leaves, removeLeaf, smartInsert, type Preset } from "./core/layout";
import { store } from "./core/store";
import type { Side, ToolKind, View } from "./core/types";
import { Terminals } from "./terminal/terminals";
import { BoardView } from "./ui/board";
import { esc, h } from "./ui/dom";
import { closePopover, popover, toast } from "./ui/feedback";
import { openAbout } from "./ui/about";
import { ICON } from "./ui/icons";
import { openHelp } from "./ui/help";
import { openNewSession, type NewSessionTarget } from "./ui/new-session";
import { openSettings } from "./ui/onboarding";
import type { PaneAction, PaneHandlers } from "./ui/pane";
import { Sidebar } from "./ui/sidebar";
import { TilesView } from "./ui/tiles";
import { Titlebar } from "./ui/titlebar";
import { isZoomKey, zoomKey } from "./ui/zoom";
import { refreshUsage, refreshUsagePopovers } from "./ui/usage";

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Atalhos do app: o terminal os ignora para que cheguem aqui. */
export function isAppShortcut(e: KeyboardEvent): boolean {
  if (isZoomKey(e)) return true;
  if (e.ctrlKey && e.shiftKey && !e.altKey && ["KeyN", "KeyT", "Digit1", "Digit2", "KeyZ", "KeyM"].includes(e.code)) return true;
  return e.ctrlKey && e.altKey && e.key in ARROWS;
}

export class App {
  readonly terms = new Terminals(isAppShortcut);
  private titlebar: Titlebar;
  private rail: Sidebar;
  private tiles: TilesView;
  private board: BoardView;
  private placements = new Map<string, NewSessionTarget>();

  constructor(root: HTMLElement) {
    const handlers: PaneHandlers = {
      action: (a, id, extra, anchor) => this.action(a, id, extra, anchor),
      activate: (id) => store.setActive(id),
    };
    this.titlebar = new Titlebar({
      setView: (v) => this.setView(v),
      preset: (k) => (k === "undo" ? this.tiles.undo() : this.tiles.applyPreset(k as Preset | "equal")),
      openSettings: () => openSettings(),
      openHelp: (a) => openHelp(a),
      newWindow: () => void this.newWindow(),
      openMonitors: (a) => void this.openMonitors(a),
      openAbout: () => openAbout(),
    });
    this.rail = new Sidebar({
      sessionDown: (e, id) => {
        if (store.view === "tiles") this.tiles.startDrag(e, id, true);
        else this.board.select(id);
      },
      newIn: (cwd, tool) => void this.newIn(cwd, tool),
      openDialog: () => this.newSession(),
      resized: () => this.tiles.layout(),
    });
    this.tiles = new TilesView({ terms: this.terms, handlers, rail: () => this.rail.el, minimize: (id) => this.minimize(id) });
    this.board = new BoardView({ terms: this.terms, handlers, focusWindow: (l) => void ipc.windowFocus(l) });

    const content = h("div", "content");
    content.append(this.tiles.el, this.board.el);
    const main = h("div", "main");
    main.append(this.rail.el, content);
    root.append(this.titlebar.el, main);

    document.addEventListener("click", (e) => {
      const el = (e.target as Element).closest<HTMLElement>("[data-new]");
      // Botões da barra lateral tratam o próprio "data-new" (com pasta e ferramenta).
      if (el && el.dataset.new === "") this.quickNew(e.shiftKey);
    });
    document.addEventListener("keydown", (e) => this.onKey(e), true);
    window.addEventListener("focus", () => void refreshUsage());
    store.on((topic) => this.onStore(topic));
  }

  async start(): Promise<void> {
    await events.onSessions((list) => store.setSessions(list));
    await events.onWindows((list) => store.setWindows(list));
    // "Abrir no Polvo" pelo Explorer (Shift + clique direito numa pasta).
    if (store.isMain) {
      await events.onOpenFolder((folder) => this.openFolder(folder));
      const pending = await ipc.openFolderTake().catch(() => null);
      if (pending) this.openFolder(pending);
    }
    await events.onRuntime((id, rt) => store.setRuntime(id, rt));
    this.terms.sync();
    this.rail.render();
    this.applyView();
    requestAnimationFrame(() => this.tiles.reconcile());
    void this.refreshContext();
    window.setInterval(() => void this.refreshContext(), 4000);
    void this.refreshGit();
    window.setInterval(() => void this.refreshGit(), 30_000);
  }

  /** Repositório e worktrees de cada pasta, para agrupar a barra lateral. */
  private async refreshGit(): Promise<void> {
    const paths = [...new Set(store.mine.map((s) => s.cwd))];
    if (!paths.length) return;
    try {
      const info = await ipc.gitInfo(paths);
      if (JSON.stringify(info) !== JSON.stringify(Object.fromEntries(paths.map((p) => [p, store.git[p] ?? null])))) {
        Object.assign(store.git, info);
        store.emit("git");
      }
    } catch {
      /* git indisponível: agrupa só por pasta */
    }
  }

  /** Nova sessão direto numa pasta, sem diálogo, ao lado da sessão ativa. */
  async newIn(cwd: string, tool: ToolKind): Promise<void> {
    closePopover();
    const near = store.active && store.session(store.active)?.window === store.label ? store.active : null;
    const r = near ? this.tiles.geo.leaves.get(near) : undefined;
    try {
      const id = await ipc.sessionCreate({ tool, cwd, mode: "new", window: store.label });
      this.onCreated(id, near && store.view === "tiles" ? { id: near, side: r && r.w >= r.h ? "right" : "bottom" } : undefined);
    } catch (e) {
      toast(String(e));
    }
  }

  /** "+ Nova sessão": com um chat em foco, abre direto no mesmo projeto e ferramenta. */
  quickNew(forceDialog = false): void {
    const s = store.session(store.active);
    if (!forceDialog && s && s.window === store.label) void this.newIn(s.cwd, store.toolEnabled(s.tool) ? s.tool : "shell");
    else this.newSession();
  }

  /** Contexto usado: backend (Claude/Codex) e, na falta, o que a tela mostra. */
  private async refreshContext(): Promise<void> {
    let fromBackend: Record<string, number> = {};
    try {
      fromBackend = await ipc.context();
    } catch {
      /* ignora */
    }
    const next: Record<string, number> = {};
    for (const s of store.sessions) {
      const v = fromBackend[s.id] ?? this.terms.screenContext.get(s.id);
      if (v !== undefined) next[s.id] = v;
    }
    if (JSON.stringify(next) !== JSON.stringify(store.context)) {
      store.context = next;
      store.emit("context");
    }
  }

  async newWindow(): Promise<string | null> {
    try {
      return await ipc.windowNew();
    } catch (e) {
      toast(String(e));
      return null;
    }
  }

  private async openMonitors(anchor: HTMLElement): Promise<void> {
    const monitors = await ipc.monitorsList();
    popover(
      "monitors",
      anchor,
      (el) => {
        el.innerHTML = `<div class="mh">Levar esta janela para</div>${monitors
          .map(
            (m) =>
              `<button data-m="${m.index}" class="${m.current ? "cur" : ""}">${ICON.monitor} Monitor ${m.index + 1}${m.primary ? " (principal)" : ""}<small>${m.width}×${m.height}${m.current ? " · aqui" : ""}</small></button>`,
          )
          .join("")}<hr><button data-new>${ICON.window} Nova janela<small>outro monitor</small></button>`;
        el.onclick = (e) => {
          const b = (e.target as Element).closest<HTMLElement>("[data-m]");
          if (b) {
            closePopover();
            void ipc.windowToMonitor(Number(b.dataset.m));
          }
        };
      },
      "menu",
    );
  }

  private openMoveMenu(id: string, anchor?: HTMLElement): void {
    if (!anchor) return;
    const others = store.windows.filter((w) => w.label !== store.label);
    popover(
      `move:${id}`,
      anchor,
      (el) => {
        el.innerHTML = `<div class="mh">Mover sessão para</div>${others
          .map((w) => `<button data-w="${esc(w.label)}">${ICON.window} ${esc(w.name)}</button>`)
          .join("")}${others.length ? "<hr>" : ""}<button data-w="__new">${ICON.window} Nova janela<small>abre em outro monitor</small></button>`;
        el.onclick = async (e) => {
          const target = (e.target as Element).closest<HTMLElement>("[data-w]")?.dataset.w;
          if (!target) return;
          closePopover();
          const label = target === "__new" ? await this.newWindow() : target;
          if (label) this.moveTo(id, label);
        };
      },
      "menu",
    );
  }

  newSession(target?: NewSessionTarget): void {
    closePopover();
    openNewSession((id, t) => this.onCreated(id, t), target);
  }

  /** Pergunta com qual agente abrir a pasta vinda do Explorer. */
  openFolder(folder: string): void {
    closePopover();
    document.querySelectorAll(".modal").forEach((m) => m.remove());
    openNewSession((id, t) => this.onCreated(id, t), undefined, { cwd: folder });
  }

  // ------------------------------------------------------------ estado

  private onStore(topic: string): void {
    switch (topic) {
      case "git":
        this.rail.render();
        break;
      case "sessions":
        void this.refreshGit();
        this.terms.sync();
        this.placeNew();
        this.tiles.reconcile();
        this.rail.render();
        this.titlebar.render();
        this.board.render();
        this.board.renderDrawer();
        break;
      case "runtime":
        this.terms.sync();
        this.rail.render();
        this.tiles.updatePanes();
        this.board.render();
        break;
      case "layout":
        this.tiles.layout();
        break;
      case "view":
        this.applyView();
        break;
      case "active":
        this.rail.render();
        this.tiles.layout();
        break;
      case "settings":
        this.tiles.updatePanes();
        this.titlebar.render();
        break;
      case "windows":
        this.titlebar.render();
        this.board.render();
        this.board.renderDrawer();
        break;
      case "context":
        this.rail.render();
        this.tiles.updatePanes();
        this.board.render();
        break;
      case "usage":
        this.titlebar.render();
        refreshUsagePopovers();
        this.board.render();
        break;
    }
  }

  /** Sessões criadas com posição escolhida ("nova sessão ao lado"). */
  private placeNew(): void {
    for (const [id, target] of this.placements) {
      const s = store.session(id);
      if (!s) continue;
      this.placements.delete(id);
      if (s.window === store.label && !s.minimized) {
        // A reconciliação pode já ter encaixado a sessão; reposiciona ao lado do alvo.
        let tree = clone(store.tree);
        if (leaves(tree).includes(id)) tree = removeLeaf(tree, id);
        store.setTree(insertAt(tree, target.id, id, target.side), { undo: false });
      }
    }
  }

  private onCreated(id: string, target?: NewSessionTarget): void {
    if (target) this.placements.set(id, target);
    if (store.session(id)) this.placeNew();
    store.setActive(id);
    if (store.view === "board") {
      store.selected = id;
      this.board.renderDrawer();
    }
    window.setTimeout(() => {
      this.tiles.flash(id);
      this.terms.get(id)?.focus();
    }, 300);
  }

  private setView(v: View): void {
    if (v === "board" && !store.selected) {
      store.selected = (store.sessions.find((s) => s.runtime.status === "waiting") ?? store.session(store.active) ?? store.sessions[0])?.id ?? null;
    }
    store.setView(v);
  }

  private applyView(): void {
    const board = store.view === "board";
    this.tiles.el.hidden = board;
    this.board.el.hidden = !board;
    if (board) {
      this.board.render();
      this.board.renderDrawer();
    } else {
      this.board.leave();
      this.tiles.layout();
    }
    this.titlebar.render();
  }

  // ------------------------------------------------------------ ações

  private action(a: PaneAction, id: string, extra?: string, anchor?: HTMLElement): void {
    switch (a) {
      case "split": {
        const r = this.tiles.geo.leaves.get(id);
        const side: Side = r && r.w >= r.h ? "right" : "bottom";
        this.newSession({ id, side });
        break;
      }
      case "terminal":
        void this.openTerminalHere(id);
        break;
      case "move":
        this.openMoveMenu(id, anchor);
        break;
      case "min":
        this.minimize(id);
        break;
      case "zoom":
        store.zoom = store.zoom === id ? null : id;
        store.setActive(id);
        this.tiles.layout();
        break;
      case "close":
        void ipc.sessionClose(id);
        break;
      case "open":
        this.openInTiles(id);
        break;
      case "dclose":
        store.selected = null;
        this.board.render();
        this.board.renderDrawer();
        break;
      case "start": {
        const s = store.session(id);
        if (s) {
          s.runtime = { ...s.runtime, status: "starting", error: null, exitCode: null };
          store.emit("runtime");
        }
        void ipc.sessionStart(id);
        break;
      }
      case "rename":
        if (extra) {
          store.patchLocal(id, { title: extra, titleLocked: true });
          void ipc.sessionUpdate(id, { title: extra });
        }
        break;
    }
  }

  /** Abre um PowerShell na pasta da sessão, colado ao lado dela. */
  private async openTerminalHere(id: string): Promise<void> {
    const s = store.session(id);
    if (!s) return;
    const r = this.tiles.geo.leaves.get(id);
    const side: Side = r && r.w >= r.h ? "right" : "bottom";
    try {
      const newId = await ipc.sessionCreate({ tool: "shell", cwd: s.cwd, title: `Terminal · ${s.title}`, mode: "new", window: store.label });
      if (store.view === "tiles") this.onCreated(newId, { id, side });
      else this.onCreated(newId);
    } catch (e) {
      toast(String(e));
    }
  }

  private minimize(id: string): void {
    store.pushUndo();
    if (store.zoom === id) store.zoom = null;
    store.patchLocal(id, { minimized: true });
    store.setTree(removeLeaf(clone(store.tree), id), { undo: false });
    void ipc.sessionUpdate(id, { minimized: true });
    this.rail.render();
    toast(`“${store.session(id)?.title}” foi para o trilho`, { label: "Desfazer", run: () => this.tiles.undo() });
  }

  private openInTiles(id: string): void {
    const s = store.session(id);
    if (!s) return;
    if (s.window !== store.label) {
      void ipc.windowFocus(s.window);
      return;
    }
    if (store.view !== "tiles") store.setView("tiles");
    if (s.minimized) {
      store.pushUndo();
      store.patchLocal(id, { minimized: false });
      store.setTree(smartInsert(clone(store.tree), this.tiles.geo.leaves, id), { undo: false });
      void ipc.sessionUpdate(id, { minimized: false });
    } else if (store.zoom && store.zoom !== id) {
      store.zoom = id;
      this.tiles.layout();
    }
    store.setActive(id);
    this.tiles.flash(id);
    this.terms.get(id)?.focus();
  }

  private moveTo(id: string, label: string): void {
    store.patchLocal(id, { window: label, minimized: false });
    store.setTree(removeLeaf(clone(store.tree), id), { undo: false });
    ipc
      .sessionUpdate(id, { window: label, minimized: false })
      .then(() => toast(`Sessão movida para a ${store.windowName(label)}`))
      .catch((e) => toast(String(e)));
  }

  // ------------------------------------------------------------ teclado

  private onKey(e: KeyboardEvent): void {
    if (!isAppShortcut(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (zoomKey(e)) return;
    if (e.ctrlKey && e.altKey) {
      const [dx, dy] = ARROWS[e.key];
      if (store.view === "tiles") this.tiles.focusNeighbor(dx, dy, e.shiftKey);
      return;
    }
    switch (e.code) {
      case "KeyN":
        this.quickNew();
        break;
      case "KeyT":
        if (store.active) void this.openTerminalHere(store.active);
        break;
      case "Digit1":
        this.setView("tiles");
        break;
      case "Digit2":
        this.setView("board");
        break;
      case "KeyZ":
        this.tiles.undo();
        break;
      case "KeyM":
        if (store.active) this.action("zoom", store.active);
        break;
    }
  }
}
