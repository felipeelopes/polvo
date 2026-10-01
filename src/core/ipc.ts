// Acesso tipado aos comandos e eventos do backend (src-tauri).
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DisplayInfo,
  LayoutNode,
  Runtime,
  Session,
  Settings,
  Snapshot,
  StartMode,
  ToolKind,
  UsageSnapshot,
  View,
} from "./types";

export const ipc = {
  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSet: (settings: Settings) => invoke<Settings>("settings_set", { settings }),
  toolsAvailable: () => invoke<Record<ToolKind, boolean>>("tools_available"),
  displayInfo: () => invoke<DisplayInfo>("display_info"),
  windowFocus: (label: string) => invoke<void>("window_focus", { label }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),

  snapshot: (window: string) => invoke<Snapshot>("workspace_snapshot", { window }),
  layoutSave: (window: string, layout: LayoutNode | null, view: View) =>
    invoke<void>("layout_save", { window, layout, view }),

  sessionCreate: (req: { tool: ToolKind; cwd: string; title?: string; mode: StartMode; window: string }) =>
    invoke<string>("session_create", { req }),
  sessionStart: (id: string) => invoke<void>("session_start", { id }),
  sessionUpdate: (id: string, patch: { title?: string; minimized?: boolean; window?: string }) =>
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
};

function toBytes(data: ArrayBuffer | number[] | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

export const events = {
  onSessions: (fn: (sessions: Session[]) => void): Promise<UnlistenFn> =>
    listen<Session[]>("sessions-changed", (e) => fn(e.payload)),
  onRuntime: (fn: (id: string, runtime: Runtime) => void): Promise<UnlistenFn> =>
    listen<{ id: string; runtime: Runtime }>("session-runtime", (e) => fn(e.payload.id, e.payload.runtime)),
};
