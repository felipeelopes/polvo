// Aparência de sessões e projetos (funções puras, sem DOM nem Tauri).
import type { Status } from "./types";

/** Cores aceitas pelo `/color` do Claude Code (e do Polvo), também usadas nos projetos. */
export const SESSION_COLORS: Record<string, string> = {
  red: "#F07178",
  orange: "#F78C6C",
  yellow: "#E5C07B",
  green: "#3FB27F",
  cyan: "#56C7D9",
  blue: "#7C9CFF",
  purple: "#C792EA",
  pink: "#FF7AB2",
};

/** Nome do `/color` ou #hex → cor; null quando não é uma cor conhecida. */
export function colorValue(c: string | null | undefined): string | null {
  const v = c?.trim().toLowerCase();
  if (!v) return null;
  if (SESSION_COLORS[v]) return SESSION_COLORS[v];
  return /^#[0-9a-f]{3,8}$/.test(v) ? v : null;
}

/** Hierarquia da cor de destaque: a da sessão, senão a do projeto, senão a da ferramenta. */
export function resolveColor(session: string | null | undefined, project: string | null | undefined, tool: string): string {
  return colorValue(session) ?? colorValue(project) ?? tool;
}

/** Iniciais para o trilho: "API Cardápio" → "AC", "PDV" → "PDV", "polvo" → "Po". */
export function initials(name: string): string {
  const words = name
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length > 1) return words.slice(0, 2).map((w) => [...w][0].toUpperCase()).join("");
  const w = words[0];
  if ([...w].length <= 3 && w === w.toUpperCase()) return w;
  const [a, b = ""] = [...w];
  return a.toUpperCase() + b.toLowerCase();
}

// Mesma ordem das colunas do Quadro (aguardando, trabalhando, ocioso); entre os
// ociosos, erro e encerrada vêm antes porque pedem atenção.
const URGENCY: Status[] = ["waiting", "working", "starting", "error", "exited", "idle", "paused"];

/** Status que representa um grupo de sessões (o mais urgente); null sem sessões. */
export function urgentStatus(statuses: Status[]): Status | null {
  let best: Status | null = null;
  for (const s of statuses) if (best === null || URGENCY.indexOf(s) < URGENCY.indexOf(best)) best = s;
  return best;
}
