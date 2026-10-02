export type ToolKind = "claude" | "codex" | "opencode" | "shell";

/** Ciclo de vida: paused → starting → working/waiting/idle → exited (ou error). */
export type Status = "paused" | "starting" | "working" | "waiting" | "idle" | "exited" | "error";

export interface Runtime {
  status: Status;
  since: number;
  exitCode: number | null;
  error: string | null;
  preview: string[];
  /** Versão do CLI com que o processo foi iniciado. */
  version: string | null;
}

/** Versões de um CLI: instalada, mais recente publicada e como atualizar. */
export interface ToolVersion {
  installed: string | null;
  latest: string | null;
  updateCommand: string | null;
}

export interface Session {
  id: string;
  tool: ToolKind;
  cwd: string;
  title: string;
  sessionId: string | null;
  /** Rótulo da janela dona da sessão (`main` ou `w-…`). */
  window: string;
  minimized: boolean;
  createdAt: number;
  /** Renomeada pelo usuário: o título do terminal não substitui mais o nome. */
  titleLocked: boolean;
  /** Cor da sessão (`/color` do CLI); null usa a cor da ferramenta. */
  color: string | null;
  runtime: Runtime;
}

export type SplitDir = "row" | "col";
export type LayoutNode =
  | { type: "leaf"; id: string }
  | { type: "split"; dir: SplitDir; sizes: number[]; children: LayoutNode[] };

export type View = "tiles" | "board";
export type Side = "left" | "right" | "top" | "bottom";
export type StartMode = "new" | "resume" | "continue";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Settings {
  onboarded: boolean;
  autostart: boolean;
  autoResume: boolean;
  claudeUsageBridge: boolean;
  checkUpdates: boolean;
  /** Fornecedores escondidos pelo usuário, mesmo que instalados. */
  disabledTools: ToolKind[];
  /** "Abrir no Polvo" no menu do Explorer (clique direito numa pasta). */
  explorerMenu: boolean;
  /** Iniciar o Claude Code em modo bypass de permissões. */
  claudeBypassPermissions: boolean;
  /** Idioma da interface: "auto" (o do Windows) ou um código ("en", "pt"…). */
  language: string;
}

export interface Worktree {
  path: string;
  branch: string | null;
  main: boolean;
}

/** Repositório git de uma pasta: raiz, projeto (worktree principal) e worktrees. */
export interface RepoInfo {
  root: string;
  project: string;
  branch: string | null;
  worktrees: Worktree[];
}

export interface UsageWindow {
  label: string;
  short: string;
  usedPercent: number | null;
  resetsAt: number | null;
  value: string | null;
}

export interface UsageSnapshot {
  provider: ToolKind;
  plan: string | null;
  windows: UsageWindow[];
  observedAt: number;
}

/** Projeto salvo na barra lateral (aparece mesmo sem sessões). */
export interface ProjectRecord {
  path: string;
  name: string;
  addedAt: number;
  /** Cor do projeto (nome do `/color` ou #hex); as sessões sem cor própria herdam. */
  color?: string | null;
  /** Ícone do projeto (id de `PROJECT_ICONS`); sem ícone, usa a pasta. */
  icon?: string | null;
}

export interface Snapshot {
  sessions: Session[];
  layout: LayoutNode | null;
  view: View;
  recentDirs: string[];
}

/** Uma janela do Polvo ("instância"). `main` é a principal. */
export interface WindowRecord {
  label: string;
  name: string;
}

export interface MonitorInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  primary: boolean;
  current: boolean;
}

export interface DisplayInfo {
  monitors: number;
  mica: boolean;
}
