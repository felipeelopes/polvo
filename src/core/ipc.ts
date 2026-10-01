// Acesso tipado aos comandos e eventos do backend (src-tauri).
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DisplayInfo,
  LayoutNode,
  Runtime,
  Session,
  MonitorInfo,
  ProjectRecord,
  RepoInfo,
  Settings,
  Snapshot,
  StartMode,
  ToolKind,
  ToolVersion,
  UsageSnapshot,
  View,
  WindowRecord,
} from "./types";

export const ipc = {
  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSet: (settings: Settings) => invoke<Settings>("settings_set", { settings }),
  toolsAvailable: () => invoke<Record<ToolKind, boolean>>("tools_available"),
  displayInfo: () => invoke<DisplayInfo>("display_info"),
  windowFocus: (label: string) => invoke<void>("window_focus", { label }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  windowNew: () => invoke<string>("window_new"),
  windowsList: () => invoke<WindowRecord[]>("windows_list"),
  monitorsList: () => invoke<MonitorInfo[]>("monitors_list"),
  windowToMonitor: (index: number) => invoke<void>("window_to_monitor", { index }),

  snapshot: (window: string) => invoke<Snapshot>("workspace_snapshot", { window }),
  layoutSave: (window: string, layout: LayoutNode | null, view: View) =>
    invoke<void>("layout_save", { window, layout, view }),

  sessionCreate: (req: { tool: ToolKind; cwd: string; title?: string; mode: StartMode; window: string }) =>
    invoke<string>("session_create", { req }),
  sessionStart: (id: string) => invoke<void>("session_start", { id }),
  sessionUpdate: (id: string, patch: { title?: string; autoTitle?: string; color?: string; minimized?: boolean; window?: string }) =>
    invoke<void>("session_update", { id, patch }),
  sessionClose: (id: string) => invoke<void>("session_close", { id }),
  sessionReport: (id: string, status: string, preview: string[]) =>
    invoke<void>("session_report", { id, status, preview }),

  /** Conecta à saída do terminal: devolve o histórico recente e passa a enviar dados ao vivo. */
  ptyAttach: async (id: string, onData: (bytes: Uint8Array) => void): Promise<Uint8Array> => {
    const channel = new Channel<ArrayBuffer | number[]>();
    channel.onmessage = (data) => onData(toBytes(data));
    const history = await invoke<ArrayBuffer | number[]>("pty_attach", { id, channel });
    return toBytes(history);
  },
  ptyWrite: (id: string, data: string) => invoke<void>("pty_write", { id, data }),
  ptyResize: (id: string, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),

  usage: () => invoke<UsageSnapshot[]>("usage_get"),

  projectsList: () => invoke<ProjectRecord[]>("projects_list"),
  projectAdd: (path: string) => invoke<ProjectRecord>("project_add", { path }),
  projectCreate: (parent: string, name: string, gitInit: boolean) =>
    invoke<ProjectRecord>("project_create", { parent, name, gitInit }),
  projectClone: (url: string, parent: string) => invoke<ProjectRecord>("project_clone", { url, parent }),
  projectRemove: (path: string) => invoke<void>("project_remove", { path }),
  /** Versões instalada/publicada de cada CLI. */
  toolsVersions: () => invoke<Partial<Record<ToolKind, ToolVersion>>>("tools_versions"),
  /** Pasta pedida pelo "Abrir no Polvo" ao iniciar o app (uma vez só). */
  openFolderTake: () => invoke<string | null>("open_folder_take"),
  /** Repositório, branch e worktrees de cada pasta (null se não for git). */
  gitInfo: (paths: string[]) => invoke<Record<string, RepoInfo | null>>("git_info", { paths }),
  /** Contexto, nome e cor definidos no CLI, por sessão (Claude e Codex). */
  sessionMeta: () => invoke<Record<string, { context: number | null; customTitle: string | null; aiTitle: string | null; color: string | null }>>("session_meta"),
};

function toBytes(data: ArrayBuffer | number[] | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

export const events = {
  onSessions: (fn: (sessions: Session[]) => void): Promise<UnlistenFn> =>
    listen<Session[]>("sessions-changed", (e) => fn(e.payload)),
  onOpenFolder: (fn: (folder: string) => void): Promise<UnlistenFn> =>
    listen<string>("open-folder", (e) => fn(e.payload)),
  onProjects: (fn: (projects: ProjectRecord[]) => void): Promise<UnlistenFn> =>
    listen<ProjectRecord[]>("projects-changed", (e) => fn(e.payload)),
  onWindows: (fn: (windows: WindowRecord[]) => void): Promise<UnlistenFn> =>
    listen<WindowRecord[]>("windows-changed", (e) => fn(e.payload)),
  onRuntime: (fn: (id: string, runtime: Runtime) => void): Promise<UnlistenFn> =>
    listen<{ id: string; runtime: Runtime }>("session-runtime", (e) => fn(e.payload.id, e.payload.runtime)),
};
