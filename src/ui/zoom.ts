// Zoom da interface inteira, como no VS Code: Ctrl + / Ctrl − / Ctrl 0.
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { toast } from "./feedback";
import { t } from "../i18n";

const KEY = "polvo.zoom";
const MIN = 0.5;
const MAX = 2.5;
const STEP = 0.1;

let level = 1;

function load(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= MIN && v <= MAX ? v : 1;
  } catch {
    return 1;
  }
}

async function apply(next: number, announce: boolean): Promise<void> {
  level = Math.round(Math.min(MAX, Math.max(MIN, next)) * 10) / 10;
  try {
    await getCurrentWebview().setZoom(level);
    localStorage.setItem(KEY, String(level));
  } catch {
    /* sem permissão de zoom: ignora */
  }
  if (announce) toast(t("app.zoom", { pct: Math.round(level * 100) }));
}

/** Aplica o zoom salvo ao abrir a janela. */
export function initZoom(): void {
  const saved = load();
  if (saved !== 1) void apply(saved, false);
}

/** Atalhos de zoom: devolve true se a tecla foi tratada. */
export function zoomKey(e: KeyboardEvent): boolean {
  if (!e.ctrlKey || e.altKey) return false;
  if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") void apply(level + STEP, true);
  else if (e.key === "-" || e.code === "NumpadSubtract") void apply(level - STEP, true);
  else if (e.key === "0" || e.code === "Numpad0") void apply(1, true);
  else return false;
  return true;
}

export const isZoomKey = (e: KeyboardEvent): boolean =>
  e.ctrlKey && !e.altKey && (["+", "=", "-", "0"].includes(e.key) || ["NumpadAdd", "NumpadSubtract", "Numpad0"].includes(e.code));
