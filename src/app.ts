// Controlador da janela: monta a interface, liga eventos do backend e
// implementa as ações sobre sessões (recolher, mover de tela, encerrar…).
import { events, ipc } from "./core/ipc";
import { clone, insertAt, leaves, removeLeaf, smartInsert, type Preset } from "./core/layout";
import { store } from "./core/store";
import type { Side, View } from "./core/types";
import { Terminals } from "./terminal/terminals";
import { BoardView } from "./ui/board";
import { h } from "./ui/dom";
import { closePopover, toast } from "./ui/feedback";
import { openHelp } from "./ui/help";
import { openNewSession, type NewSessionTarget } from "./ui/new-session";
import { openSettings } from "./ui/onboarding";
import type { PaneAction, PaneHandlers } from "./ui/pane";
import { Rail } from "./ui/rail";
import { TilesView } from "./ui/tiles";
import { Titlebar } from "./ui/titlebar";
import { refreshUsage, refreshUsagePopovers } from "./ui/usage";

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Atalhos do app: o terminal os ignora para que cheguem aqui. */
export function isAppShortcut(e: KeyboardEvent): boolean {
  if (e.ctrlKey && e.shiftKey && !e.altKey && ["KeyN", "Digit1", "Digit2", "KeyZ", "KeyM"].includes(e.code)) return true;
  return e.ctrlKey && e.altKey && e.key in ARROWS;
}

export class App {
  readonly terms = new Terminals(isAppShortcut);
  private titlebar: Titlebar;
  private rail: Rail;
  private tiles: TilesView;
  private board: BoardView;
  private placements = new Map<string, NewSessionTarget>();

  constructor(root: HTMLElement) {
    const handlers: PaneHandlers = {
      action: (a, id, extra) => this.action(a, id, extra),
      activate: (id) => store.setActive(id),
    };
    this.titlebar = new Titlebar({
      setView: (v) => this.setView(v),
      preset: (k) => (k === "undo" ? this.tiles.undo() : this.tiles.applyPreset(k as Preset | "equal")),
      openSettings: () => openSettings(),
      openHelp: (a) => openHelp(a),
    });
    this.rail = new Rail((e, id) => {
      if (store.view === "tiles") this.tiles.startDrag(e, id, true);
      else this.board.select(id);
    });
    this.tiles = new TilesView({ terms: this.terms, handlers, rail: () => this.rail.el, minimize: (id) => this.minimize(id) });
    this.board = new BoardView({ terms: this.terms, handlers, focusWindow: (l) => void ipc.windowFocus(l) });

    const content = h("div", "content");
    content.append(this.tiles.el, this.board.el);
    const main = h("div", "main");
    main.append(this.rail.el, content);
    root.append(this.titlebar.el, main);

    document.addEventListener("click", (e) => {
      if ((e.target as Element).closest("[data-new]")) this.newSession();
    });
    document.addEventListener("keydown", (e) => this.onKey(e), true);
    window.addEventListener("focus", () => void refreshUsage());
    store.on((topic) => this.onStore(topic));
  }

  async start(): Promise<void> {
    await events.onSessions((list) => store.setSessions(list));
    await events.onRuntime((id, rt) => store.setRuntime(id, rt));
    this.terms.sync();
    this.rail.render();
    this.applyView();
    requestAnimationFrame(() => this.tiles.reconcile());
  }

  newSession(target?: NewSessionTarget): void {
    closePopover();
    openNewSession((id, t) => this.onCreated(id, t), target);
  }

  // ------------------------------------------------------------ estado

  private onStore(topic: string): void {
    switch (topic) {
      case "sessions":
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

  private action(a: PaneAction, id: string, extra?: string): void {
    switch (a) {
      case "split": {
        const r = this.tiles.geo.leaves.get(id);
        const side: Side = r && r.w >= r.h ? "right" : "bottom";
        this.newSession({ id, side });
        break;
      }
      case "move":
        this.moveToOtherScreen(id);
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
      case "start":
        void ipc.sessionStart(id);
        break;
      case "rename":
        if (extra) {
          store.patchLocal(id, { title: extra });
          void ipc.sessionUpdate(id, { title: extra });
        }
        break;
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

  private moveToOtherScreen(id: string): void {
    if (store.settings.screens < 2) return;
    const other = store.otherWindow;
    store.patchLocal(id, { window: other, minimized: false });
    store.setTree(removeLeaf(clone(store.tree), id), { undo: false });
    void ipc.sessionUpdate(id, { window: other, minimized: false });
    toast(`Sessão movida para a ${other === "main" ? "Tela 1" : "Tela 2"}`);
  }

  // ------------------------------------------------------------ teclado

  private onKey(e: KeyboardEvent): void {
    if (!isAppShortcut(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey && e.altKey) {
      const [dx, dy] = ARROWS[e.key];
      if (store.view === "tiles") this.tiles.focusNeighbor(dx, dy, e.shiftKey);
      return;
    }
    switch (e.code) {
      case "KeyN":
        this.newSession();
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
