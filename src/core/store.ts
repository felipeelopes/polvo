// Estado da janela atual. As sessões vêm do backend (fonte da verdade
// compartilhada entre janelas); layout, visão e foco são desta janela.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ipc } from "./ipc";
import { clone } from "./layout";
import type { DisplayInfo, LayoutNode, RepoInfo, Runtime, Session, Settings, ToolKind, ToolVersion, UsageSnapshot, View, WindowRecord } from "./types";

export type Topic = "sessions" | "runtime" | "layout" | "view" | "active" | "settings" | "usage" | "windows" | "context" | "git";

const RUNNING = new Set(["starting", "working", "waiting", "idle"]);
export const isRunning = (s: Session) => RUNNING.has(s.runtime.status);

class Store {
  readonly label = getCurrentWindow().label;
  sessions: Session[] = [];
  tree: LayoutNode | null = null;
  view: View = "tiles";
  active: string | null = null;
  zoom: string | null = null;
  selected: string | null = null;
  recentDirs: string[] = [];
  settings: Settings = { onboarded: false, autostart: false, autoResume: true, claudeUsageBridge: true, checkUpdates: true, disabledTools: [], explorerMenu: true, claudeBypassPermissions: true };
  /** Versões dos CLIs (instalada, publicada, comando de atualização). */
  versions: Partial<Record<ToolKind, ToolVersion>> = {};
  /** Informações de git por pasta de sessão (para agrupar a barra lateral). */
  git: Record<string, RepoInfo | null> = {};
  /** Percentual de contexto usado por sessão. */
  context: Record<string, number> = {};
  windows: WindowRecord[] = [];
  tools: Record<ToolKind, boolean> = { claude: false, codex: false, opencode: false, shell: true };
  display: DisplayInfo = { monitors: 1, mica: true };
  usage: UsageSnapshot[] = [];

  private listeners = new Set<(topic: Topic) => void>();
  private undoStack: string[] = [];
  private saveTimer: number | undefined;

  on(fn: (topic: Topic) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(topic: Topic): void {
    this.listeners.forEach((fn) => fn(topic));
  }

  /** Ferramenta instalada e não desativada pelo usuário. */
  toolEnabled(t: ToolKind): boolean {
    return this.tools[t] && !this.settings.disabledTools.includes(t);
  }

  get isMain(): boolean {
    return this.label === "main";
  }

  /** Nome amigável de uma janela ("Janela 1", "Janela 2"…). */
  windowName(label: string): string {
    return this.windows.find((w) => w.label === label)?.name ?? (label === "main" ? "Janela 1" : "outra janela");
  }

  get myName(): string {
    return this.windowName(this.label);
  }

  setWindows(list: WindowRecord[]): void {
    this.windows = list;
    this.emit("windows");
  }

  /** Sessões desta janela, na ordem do registro. */
  get mine(): Session[] {
    return this.sessions.filter((s) => s.window === this.label);
  }

  session(id: string | null): Session | undefined {
    return id ? this.sessions.find((s) => s.id === id) : undefined;
  }

  setSessions(list: Session[]): void {
    this.sessions = list;
    if (this.active && !this.session(this.active)) this.active = null;
    if (this.zoom && !this.session(this.zoom)) this.zoom = null;
    this.emit("sessions");
  }

  setRuntime(id: string, runtime: Runtime): void {
    const s = this.session(id);
    if (!s) return;
    s.runtime = runtime;
    this.emit("runtime");
  }

  /** Atualização otimista: aplica já e deixa o backend confirmar pelo evento. */
  patchLocal(id: string, patch: Partial<Pick<Session, "minimized" | "window" | "title" | "titleLocked" | "color">>): void {
    const s = this.session(id);
    if (s) Object.assign(s, patch);
  }

  setTree(tree: LayoutNode | null, opts: { undo?: boolean } = {}): void {
    if (opts.undo !== false) this.pushUndo();
    this.tree = tree;
    this.persist();
    this.emit("layout");
  }

  setView(view: View): void {
    this.view = view;
    this.persist();
    this.emit("view");
  }

  setActive(id: string | null): void {
    if (this.active === id) return;
    this.active = id;
    this.emit("active");
  }

  pushUndo(): void {
    const minimized = this.mine.filter((s) => s.minimized).map((s) => s.id);
    this.undoStack.push(JSON.stringify({ tree: this.tree, minimized }));
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  popUndo(): { tree: LayoutNode | null; minimized: string[] } | null {
    const raw = this.undoStack.pop();
    return raw ? JSON.parse(raw) : null;
  }

  dropUndo(): void {
    this.undoStack.pop();
  }

  private persist(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      ipc.layoutSave(this.label, clone(this.tree), this.view).catch(() => {});
    }, 300);
  }
}

export const store = new Store();
