// Aparência de sessões e projetos (funções puras, sem DOM nem Tauri).

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
