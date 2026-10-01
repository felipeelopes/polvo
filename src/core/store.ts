// Estado da janela atual. As sessões vêm do backend (fonte da verdade
// compartilhada entre janelas); layout, visão e foco são desta janela.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ipc } from "./ipc";
import { clone } from "./layout";
import type { DisplayInfo, LayoutNode, Runtime, Session, Settings, ToolKind, UsageSnapshot, View } from "./types";

export type Topic = "sessions" | "runtime" | "layout" | "view" | "active" | "settings" | "usage";

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
  settings: Settings = { onboarded: false, autostart: false, screens: 1, autoResume: true, claudeUsageBridge: true, checkUpdates: true };
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

  get isMain(): boolean {
    return this.label === "main";
  }

  get otherWindow(): string {
    return this.isMain ? "screen-2" : "main";
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
  patchLocal(id: string, patch: Partial<Pick<Session, "minimized" | "window" | "title">>): void {
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
