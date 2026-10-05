// Controlador da janela: monta a interface, liga eventos do backend e
// implementa as ações sobre sessões (recolher, mover de tela, encerrar…).
import { events, ipc } from "./core/ipc";
import { clone, insertAt, leaves, removeLeaf, smartInsert, type Preset } from "./core/layout";
import { normPath, store } from "./core/store";
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
import { openProjectMenu, type ProjectHost } from "./ui/projects";
import { Sidebar } from "./ui/sidebar";
import { TilesView } from "./ui/tiles";
import { Titlebar } from "./ui/titlebar";
import { isZoomKey, zoomKey } from "./ui/zoom";
import { outdatedSessions, refreshUsage, refreshUsagePopovers, versionActions } from "./ui/usage";
import { TOOLS } from "./ui/icons";
import type { DocsPanel } from "./docs/panel";
import type { GitView } from "./git/view";
import type { WorkView } from "./work/view";
import { git as gitApi } from "./git/api";
import { defaultTool } from "./ui/projects";
import { t, tn } from "./i18n";

/** O painel de documentos estava aberto nesta janela (reabre ao iniciar). */
function docsWereOpen(): boolean {
  try {
    return !!JSON.parse(localStorage.getItem(`polvo.docs.${store.label}`) ?? "{}").open;
  } catch {
    return false;
  }
}

/** O Git era a aba visível do painel. */
function gitWasOpen(): boolean {
  try {
    return !!JSON.parse(localStorage.getItem(`polvo.docs.${store.label}`) ?? "{}").git;
  } catch {
    return false;
  }
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Atalhos do app: o terminal os ignora para que cheguem aqui. */
export function isAppShortcut(e: KeyboardEvent): boolean {
  if (isZoomKey(e)) return true;
  if (e.ctrlKey && e.shiftKey && !e.altKey && ["KeyN", "KeyT", "Digit1", "Digit2", "Digit3", "KeyZ", "KeyM", "KeyG"].includes(e.code)) return true;
  return e.ctrlKey && e.altKey && e.key in ARROWS;
}

export class App {
  readonly terms = new Terminals(isAppShortcut, (path) => this.openDoc(path));
  private titlebar: Titlebar;
  private rail: Sidebar;
  private tiles: TilesView;
  private board: BoardView;
  private placements = new Map<string, NewSessionTarget>();
  /** Visualizador de Markdown, carregado no primeiro uso. */
  private docs: Promise<DocsPanel> | null = null;
  private docsMount: (panel: DocsPanel) => void = () => {};
  /** Sessão recém-criada a revelar (desliga o filtro se for de outro projeto). */
  private reveal: string | null = null;
  private projectHost: ProjectHost = {
    start: (cwd, tool) => void this.newIn(cwd, tool),
    openDialog: () => this.newSession(),
  };

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
      openMonitors: (a) => void this.openMonitors(a),
      openAbout: () => openAbout(),
      projectMenu: (a) => openProjectMenu(a, this.projectHost),
      openGit: () => this.openGit(),
      clearProject: () => void store.setProject(null),
    });
    this.rail = new Sidebar({
      sessionDown: (e, id) => {
        const s = store.session(id);
        // Sessão de outro projeto: sai do filtro para mostrá-la.
        if (s && !store.inProject(s)) {
          void store.setProject(null).then(() => (store.view === "tiles" ? this.openInTiles(id) : this.board.select(id)));
          return;
        }
        if (store.view === "tiles") this.tiles.startDrag(e, id, true);
        else if (store.view === "work") this.openInTiles(id);
        else this.board.select(id);
      },
      newIn: (cwd, tool) => void this.newIn(cwd, tool),
      focusProject: (key) => void store.setProject(key),
      removeProject: (path) => void ipc.projectRemove(path),
      closeSession: (id) => void ipc.sessionClose(id),
      openGit: (path) => this.openGit(path),
      resized: () => this.tiles.layout(),
    });
    this.tiles = new TilesView({ terms: this.terms, handlers, rail: () => this.rail.el, minimize: (id) => this.minimize(id) });
    this.board = new BoardView({ terms: this.terms, handlers, focusWindow: (l) => void ipc.windowFocus(l) });

    const content = h("div", "content");
    content.append(this.tiles.el, this.board.el);
    this.content = content;
    const main = h("div", "main");
    main.append(this.rail.el, content);
    this.docsMount = (panel) => main.append(panel.el);
    this.docsContent = content;
    if (docsWereOpen()) void this.docsPanel().then((p) => gitWasOpen() && p.showTool());
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

  private docsContent: HTMLElement | null = null;
  private content!: HTMLElement;
  /** Tela "Meu trabalho", carregada no primeiro uso. */
  private work: Promise<WorkView> | null = null;
  private workView: WorkView | null = null;

  private workPanel(): Promise<WorkView> {
    return (this.work ??= import("./work/view").then(({ WorkView }) => {
      const view = new WorkView({
        repos: () => this.knownRepos(),
        askAgent: (cwd, prompt, tool) => this.askAgent(cwd, prompt, tool),
        openSession: (id) => this.openInTiles(id),
        openBoard: () => this.setView("board"),
        newSession: (cwd) => void this.newIn(cwd, defaultTool()),
        openTerminal: (cwd) => void this.newIn(cwd, "shell"),
      });
      view.el.hidden = true;
      this.content.append(view.el);
      this.workView = view;
      return view;
    }));
  }

  /** Raízes dos repositórios git conhecidos: projetos salvos e pastas das sessões. */
  private knownRepos(): string[] {
    const roots = new Map<string, string>();
    for (const p of [...store.projects.map((x) => x.path), ...store.sessions.map((s) => s.cwd)]) {
      const info = store.git[p];
      if (!info) continue;
      roots.set(normPath(info.project), info.project);
    }
    return [...roots.values()];
  }

  private gitView: GitView | null = null;

  private docsPanel(): Promise<DocsPanel> {
    return (this.docs ??= Promise.all([import("./docs/panel"), import("./git/view")]).then(([{ DocsPanel }, { GitView }]) => {
      const panel = new DocsPanel(this.docsContent!);
      this.gitView = new GitView({
        newSession: (cwd, tool) => void this.newIn(cwd, tool ?? defaultTool()),
        askAgent: (cwd, prompt) => void this.askAgent(cwd, prompt),
        openTerminal: (cwd) => void this.newIn(cwd, "shell"),
        openDoc: (path) => this.openDoc(path),
        gitChanged: () => {
          void this.refreshGit();
          void this.refreshSummaries();
        },
      });
      panel.attachTool(this.gitView);
      this.docsMount(panel);
      return panel;
    }));
  }

  /** Abre (ou fecha) o painel Git; com `path`, mostra aquele repositório. */
  openGit(path?: string, toggle = false): void {
    this.docsPanel()
      .then((p) => {
        if (path) this.gitView?.setRepo(path);
        if (toggle && !path) p.toggleTool();
        else p.showTool();
      })
      .catch((e) => toast(String(e)));
  }

  /** Abre um agente na pasta e envia um pedido assim que ele estiver pronto. */
  private async askAgent(cwd: string, prompt: string, prefer?: ToolKind): Promise<string | null> {
    const tool = prefer && store.toolEnabled(prefer) ? prefer : (["claude", "codex", "opencode"] as ToolKind[]).find((k) => store.toolEnabled(k));
    if (!tool) {
      toast(t("git.noAgent"));
      return null;
    }
    const id = await this.newIn(cwd, tool);
    if (!id) return null;
    // Espera o CLI sair de "iniciando" (ou até 20 s) antes de digitar.
    const start = Date.now();
    while (Date.now() - start < 20_000) {
      const st = store.session(id)?.runtime.status;
      if (st && st !== "starting" && st !== "paused") break;
      await new Promise((r) => setTimeout(r, 400));
    }
    await new Promise((r) => setTimeout(r, 900));
    // Pedido com várias linhas vai como "colar" (bracketed paste); senão cada
    // quebra de linha enviaria uma mensagem.
    await ipc.ptyWrite(id, prompt.includes("\n") ? `\x1b[200~${prompt}\x1b[201~` : prompt).catch(() => {});
    await new Promise((r) => setTimeout(r, 350));
    await ipc.ptyWrite(id, "\r").catch(() => {});
    return id;
  }

  /** Selos de git (alterados, à frente, atrás) dos worktrees desta janela. */
  private async refreshSummaries(): Promise<void> {
    const roots = new Set<string>();
    for (const s of store.mine) {
      const info = store.git[s.cwd];
      if (!info) continue;
      roots.add(info.root);
      for (const w of info.worktrees) roots.add(w.path);
    }
    if (!roots.size) return;
    try {
      const res = await gitApi.summaries([...roots]);
      const next = Object.fromEntries(Object.entries(res).map(([k, v]) => [normPath(k), v]));
      if (JSON.stringify(next) !== JSON.stringify(store.gitSummary)) {
        store.gitSummary = next;
        store.emit("git");
      }
    } catch {
      /* ignora */
    }
  }

  /** Abre um arquivo Markdown no painel de documentos (Ctrl + clique no terminal). */
  openDoc(path: string): void {
    this.docsPanel()
      .then((p) => p.open(path))
      .catch((e) => toast(String(e)));
  }

  async start(): Promise<void> {
    await events.onSessions((list) => store.setSessions(list));
    await events.onWindows((list) => store.setWindows(list));
    await events.onProjects((list) => {
      store.projects = list;
      store.emit("projects");
    });
    // "Abrir no Polvo" pelo Explorer (clique direito numa pasta).
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
    window.setInterval(() => document.hasFocus() && void this.refreshSummaries(), 6000);
    window.addEventListener("focus", () => void this.refreshSummaries());
    versionActions.restart = (tool) => this.restartOutdated(tool);
    versionActions.update = (tool) => void this.runToolUpdate(tool);
    void this.refreshVersions();
    window.setInterval(() => void this.refreshVersions(), 10 * 60_000);
    window.addEventListener("focus", () => void this.refreshVersions());
  }

  /** Versões instaladas/publicadas dos CLIs (para o popup de limites). */
  private async refreshVersions(): Promise<void> {
    try {
      store.versions = await ipc.toolsVersions();
      store.emit("usage");
    } catch {
      /* sem npm ou sem rede: ignora */
    }
  }

  /** Reinicia (retomando a conversa) as sessões que rodam uma versão antiga do CLI. */
  private restartOutdated(tool: ToolKind): void {
    const old = outdatedSessions(tool);
    closePopover();
    for (const s of old) {
      s.runtime = { ...s.runtime, status: "starting" };
      void ipc.sessionStart(s.id);
    }
    store.emit("runtime");
    toast(tn("app.restarted", old.length, { tool: TOOLS[tool].name, version: store.versions[tool]?.installed ?? "" }));
  }

  /** Roda o atualizador do CLI num PowerShell ao lado. */
  private async runToolUpdate(tool: ToolKind): Promise<void> {
    const cmd = store.versions[tool]?.updateCommand;
    if (!cmd) return;
    closePopover();
    const cwd = store.session(store.active)?.cwd ?? store.mine[0]?.cwd ?? store.recentDirs[0];
    if (!cwd) return toast(t("app.openProjectFirst"));
    try {
      const id = await ipc.sessionCreate({ tool: "shell", cwd, title: t("app.updateTitle", { tool: TOOLS[tool].name }), mode: "new", window: store.label });
      this.onCreated(id);
      // Espera o PowerShell abrir e digita o comando de atualização.
      window.setTimeout(() => void ipc.ptyWrite(id, `${cmd}\r`), 2500);
      toast(t("app.updating", { tool: TOOLS[tool].name }));
    } catch (e) {
      toast(String(e));
    }
  }

  /** Repositório e worktrees de cada pasta, para agrupar a barra lateral. */
  private async refreshGit(): Promise<void> {
    const paths = [...new Set([...store.mine.map((s) => s.cwd), ...store.projects.map((p) => p.path)])];
    if (!paths.length) return;
    try {
      const info = await ipc.gitInfo(paths);
      // Pasta ainda não consultada conta como mudança: a barra só fixa a ordem de um projeto já resolvido.
      if (paths.some((p) => !(p in store.git)) || JSON.stringify(info) !== JSON.stringify(Object.fromEntries(paths.map((p) => [p, store.git[p] ?? null])))) {
        Object.assign(store.git, info);
        store.emit("git");
        void this.refreshSummaries();
      }
    } catch {
      /* git indisponível: agrupa só por pasta */
    }
  }

  /** Nova sessão direto numa pasta, sem diálogo, ao lado da sessão ativa. */
  async newIn(cwd: string, tool: ToolKind): Promise<string | null> {
    closePopover();
    // Filtro ligado em outro projeto: desliga para a nova sessão aparecer.
    if (store.project && normPath(store.git[cwd]?.project ?? cwd) !== store.project) await store.setProject(null);
    const near = store.active && store.session(store.active)?.window === store.label ? store.active : null;
    const r = near ? this.tiles.geo.leaves.get(near) : undefined;
    try {
      const id = await ipc.sessionCreate({ tool, cwd, mode: "new", window: store.label });
      this.onCreated(id, near && store.view === "tiles" ? { id: near, side: r && r.w >= r.h ? "right" : "bottom" } : undefined);
      return id;
    } catch (e) {
      toast(String(e));
      return null;
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
    const fromBackend: Record<string, number> = {};
    try {
      for (const [id, m] of Object.entries(await ipc.sessionMeta())) if (m.context !== null) fromBackend[id] = m.context;
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
        el.innerHTML = `<div class="mh">${t("app.monitors.title")}</div>${monitors
          .map(
            (m) =>
              `<button data-m="${m.index}" class="${m.current ? "cur" : ""}">${ICON.monitor} ${t("app.monitors.monitor", { n: m.index + 1 })}${m.primary ? t("app.monitors.primary") : ""}<small>${m.width}×${m.height}${m.current ? t("app.monitors.here") : ""}</small></button>`,
          )
          .join("")}<hr><button data-new>${ICON.window} ${t("app.monitors.newWindow")}<small>${t("app.monitors.otherMonitor")}</small></button>`;
        el.onclick = (e) => {
          const b = (e.target as Element).closest<HTMLElement>("[data-m]");
          if (b) {
            closePopover();
            void ipc.windowToMonitor(Number(b.dataset.m));
          }
          if ((e.target as Element).closest("[data-new]")) {
            closePopover();
            void this.newWindow();
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
        el.innerHTML = `<div class="mh">${t("app.move.title")}</div>${others
          .map((w) => `<button data-w="${esc(w.label)}">${ICON.window} ${esc(store.windowName(w.label))}</button>`)
          .join("")}${others.length ? "<hr>" : ""}<button data-w="__new">${ICON.window} ${t("app.move.newWindow")}<small>${t("app.move.newWindowHint")}</small></button>`;
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
        this.titlebar.render();
        // Sessões em worktree/subpasta só acham o projeto (e a cor dele) com o git.
        this.tiles.updatePanes();
        if (store.project) {
          this.tiles.reconcile();
          this.board.render();
        }
        break;
      case "projects":
        void this.refreshGit();
        this.rail.render();
        // A cor do projeto chega às sessões que não têm cor própria.
        this.tiles.updatePanes();
        this.board.render();
        break;
      case "project":
        this.workView?.rerender();
        this.tiles.reconcile();
        this.tiles.layout();
        this.rail.render();
        this.titlebar.render();
        this.board.render();
        this.board.renderDrawer();
        break;
      case "sessions":
        void this.refreshGit();
        if (this.reveal) {
          const s = store.session(this.reveal);
          if (s) {
            this.reveal = null;
            if (!store.inProject(s)) void store.setProject(null);
          }
        }
        this.terms.sync();
        this.placeNew();
        this.tiles.reconcile();
        this.rail.render();
        this.titlebar.render();
        this.board.render();
        this.board.renderDrawer();
        break;
      case "runtime":
        this.workView?.sessionsChanged();
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
        this.titlebar.render();
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
    const created = store.session(id);
    if (created && !store.inProject(created)) void store.setProject(null);
    else if (!created) this.reveal = id;
    if (created) this.placeNew();
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
      const visible = store.sessions.filter((s) => store.inProject(s));
      const active = store.session(store.active);
      store.selected = (visible.find((s) => s.runtime.status === "waiting") ?? (active && store.inProject(active) ? active : undefined) ?? visible[0])?.id ?? null;
    }
    store.setView(v);
  }

  private applyView(): void {
    const board = store.view === "board";
    const work = store.view === "work";
    this.tiles.el.hidden = board || work;
    this.board.el.hidden = !board;
    if (this.workView) this.workView.el.hidden = !work;
    if (board) {
      this.board.render();
      this.board.renderDrawer();
    } else {
      this.board.leave();
      if (!work) this.tiles.layout();
    }
    if (work)
      void this.workPanel()
        .then((v) => {
          if (store.view !== "work") return;
          v.el.hidden = false;
          return v.show();
        })
        .catch((e) => toast(String(e)));
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
      case "git": {
        const s = store.session(id);
        store.setActive(id);
        if (s) this.openGit(store.git[s.cwd]?.root ?? s.cwd);
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
      case "dmax":
        this.board.toggleMaximize();
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
      const newId = await ipc.sessionCreate({ tool: "shell", cwd: s.cwd, title: t("app.terminalTitle", { title: s.title }), mode: "new", window: store.label });
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
    toast(t("app.minimized", { title: store.session(id)?.title ?? "" }), { label: t("app.undo"), run: () => this.tiles.undo() });
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
      .then(() => toast(t("app.movedTo", { window: store.windowName(label) })))
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
      case "Digit3":
        this.setView("work");
        break;
      case "KeyZ":
        this.tiles.undo();
        break;
      case "KeyM":
        if (store.view === "board") this.board.toggleMaximize();
        else if (store.view === "tiles" && store.active) this.action("zoom", store.active);
        break;
      case "KeyG":
        this.openGit(undefined, true);
        break;
    }
  }
}
