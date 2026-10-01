export type ToolKind = "claude" | "codex" | "opencode" | "shell";

/** Ciclo de vida: paused → starting → working/waiting/idle → exited (ou error). */
export type Status = "paused" | "starting" | "working" | "waiting" | "idle" | "exited" | "error";

export interface Runtime {
  status: Status;
  since: number;
  exitCode: number | null;
  error: string | null;
  preview: string[];
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
  /** "Abrir no Polvo" no menu do Explorer (Shift + clique direito). */
  explorerMenu: boolean;
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
