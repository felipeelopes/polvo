// Estado da janela atual. As sessões vêm do backend (fonte da verdade
// compartilhada entre janelas); layout, visão e foco são desta janela.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ipc } from "./ipc";
import { t } from "../i18n";
import { clone } from "./layout";
import type { GitSummary } from "../git/api";
import type { DisplayInfo, LayoutNode, ProjectRecord, RepoInfo, Runtime, Session, Settings, ToolKind, ToolVersion, UsageSnapshot, View, WindowRecord } from "./types";

export type Topic = "sessions" | "runtime" | "layout" | "view" | "active" | "settings" | "usage" | "windows" | "context" | "git" | "projects" | "project";

/** Caminho normalizado, para comparar pastas no Windows. */
export const normPath = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

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
  settings: Settings = { onboarded: false, autostart: false, autoResume: true, claudeUsageBridge: true, checkUpdates: true, disabledTools: [], explorerMenu: true, claudeBypassPermissions: true, language: "auto" };
  /** Versões dos CLIs (instalada, publicada, comando de atualização). */
  versions: Partial<Record<ToolKind, ToolVersion>> = {};
  /** Informações de git por pasta de sessão (para agrupar a barra lateral). */
  git: Record<string, RepoInfo | null> = {};
  /** Selos de git por worktree (caminho normalizado). */
  gitSummary: Record<string, GitSummary> = {};
  /** Percentual de contexto usado por sessão. */
  context: Record<string, number> = {};
  windows: WindowRecord[] = [];
  /** Projetos salvos (Abrir/Novo/Clonar). */
  projects: ProjectRecord[] = [];
  /** Filtro "só este projeto" desta janela (chave normalizada) ou null. */
  project: string | null = readProject(getCurrentWindow().label);
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
    const name = this.windows.find((w) => w.label === label)?.name ?? (label === "main" ? "Janela 1" : null);
    if (name === null) return t("windows.other");
    // O backend grava o nome no idioma da época ("Janela 2", "Window 2", "ウィンドウ 2"…):
    // as janelas não são renomeadas pelo usuário, então mostra o número no idioma atual.
    const n = /^\D{0,24}?(\d+)\D{0,8}$/.exec(name)?.[1];
    return n ? t("windows.numbered", { n }) : name;
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

  /** Projeto de uma sessão: o repositório principal (worktrees incluídos) ou a pasta. */
  projectKey(s: Session): string {
    return normPath(this.git[s.cwd]?.project ?? s.cwd);
  }

  /** Projeto salvo de uma chave de projeto (o da própria pasta tem preferência a um worktree). */
  projectRecord(key: string): ProjectRecord | undefined {
    const matches = this.projects.filter((p) => normPath(this.git[p.path]?.project ?? p.path) === key);
    return matches.find((p) => normPath(p.path) === key) ?? matches[0];
  }

  /** Projeto salvo ao qual a sessão pertence (para herdar cor e ícone). */
  projectOf(s: Session): ProjectRecord | undefined {
    return this.projects.length ? this.projectRecord(this.projectKey(s)) : undefined;
  }

  /** A sessão passa pelo filtro de projeto desta janela? */
  inProject(s: Session): boolean {
    return !this.project || this.projectKey(s) === this.project;
  }

  /** Nome amigável do projeto filtrado. */
  get projectName(): string {
    const key = this.project;
    if (!key) return "";
    const s = this.sessions.find((x) => this.projectKey(x) === key);
    const path = s ? (this.git[s.cwd]?.project ?? s.cwd) : (this.projects.find((p) => normPath(p.path) === key)?.path ?? key);
    return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
  }

  /** Chave da disposição de painéis: cada filtro de projeto guarda a sua. */
  get layoutKey(): string {
    return this.project ? `${this.label}::${this.project}` : this.label;
  }

  /** Liga/desliga o filtro de projeto e carrega a disposição de painéis dele. */
  async setProject(key: string | null): Promise<void> {
    if (key === this.project) return;
    clearTimeout(this.saveTimer);
    await ipc.layoutSave(this.layoutKey, clone(this.tree), this.view).catch(() => {});
    this.project = key;
    try {
      if (key) localStorage.setItem(`polvo.project.${this.label}`, key);
      else localStorage.removeItem(`polvo.project.${this.label}`);
    } catch {
      /* ignora */
    }
    const snap = await ipc.snapshot(this.layoutKey).catch(() => null);
    this.tree = snap?.layout ?? null;
    this.undoStack = [];
    this.zoom = null;
    this.emit("project");
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
      ipc.layoutSave(this.layoutKey, clone(this.tree), this.view).catch(() => {});
    }, 300);
  }
}

function readProject(label: string): string | null {
  try {
    return localStorage.getItem(`polvo.project.${label}`);
  } catch {
    return null;
  }
}

export const store = new Store();
