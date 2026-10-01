// Ícones (SVG inline) e metadados visuais das ferramentas.
import type { ToolKind } from "../core/types";
import { t } from "../i18n";

export const TOOLS: Record<ToolKind, { name: string; short: string; color: string; vendor: string }> = {
  claude: { name: "Claude Code", short: "Claude", color: "#D97757", vendor: "Anthropic" },
  codex: { name: "Codex CLI", short: "Codex", color: "#10A37F", vendor: "OpenAI" },
  opencode: { name: "OpenCode", short: "OpenCode", color: "#4F8CFF", get vendor() { return t("tools.opencode.vendor"); } },
  shell: { name: "PowerShell", short: "Shell", color: "#A78BFA", get vendor() { return t("tools.shell.vendor"); } },
};

/** Cores aceitas pelo `/color` do Claude Code (e do Polvo). */
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

/** Cor de destaque da sessão: a do `/color`, ou a da ferramenta. */
export function sessionColor(s: { tool: ToolKind; color?: string | null }): string {
  const c = s.color?.trim().toLowerCase();
  if (c && SESSION_COLORS[c]) return SESSION_COLORS[c];
  if (c && /^#[0-9a-f]{3,8}$/i.test(c)) return c;
  return TOOLS[s.tool].color;
}

const TOOL_PATHS: Record<ToolKind, string> = {
  claude: [0, 30, 60, 90, 120, 150].map((a) => `<line x1="12" y1="3.5" x2="12" y2="20.5" transform="rotate(${a} 12 12)"/>`).join(""),
  codex: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><circle cx="12" cy="12" r="2.6" fill="CC" stroke="none"/>',
  opencode: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M10 9l-3 3 3 3M14 9l3 3-3 3"/>',
  shell: '<path d="M5 7l5 5-5 5M12.5 17.5H19"/>',
};

export function toolIcon(tool: ToolKind, size = 16, color = TOOLS[tool].color): string {
  const w = tool === "claude" ? 2.4 : 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${TOOL_PATHS[tool].replace(/CC/g, color)}</svg>`;
}

const svg = (body: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICON = {
  tiles: svg('<rect x="1.5" y="1.5" width="13" height="13" rx="2.5"/><path d="M8 1.5v13M8 8h6.5"/>', 14),
  board: svg('<rect x="1.5" y="1.5" width="3.5" height="13" rx="1.2"/><rect x="6.25" y="1.5" width="3.5" height="9" rx="1.2"/><rect x="11" y="1.5" width="3.5" height="11" rx="1.2"/>', 14),
  grid: svg('<rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.3"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1.3"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1.3"/><rect x="9" y="9" width="5.5" height="5.5" rx="1.3"/>'),
  main: svg('<rect x="1.5" y="1.5" width="7.5" height="13" rx="1.3"/><rect x="10.5" y="1.5" width="4" height="5.75" rx="1.2"/><rect x="10.5" y="8.75" width="4" height="5.75" rx="1.2"/>'),
  cols: svg('<rect x="1.5" y="1.5" width="3.6" height="13" rx="1.2"/><rect x="6.2" y="1.5" width="3.6" height="13" rx="1.2"/><rect x="10.9" y="1.5" width="3.6" height="13" rx="1.2"/>'),
  rows: svg('<rect x="1.5" y="1.5" width="13" height="3.6" rx="1.2"/><rect x="1.5" y="6.2" width="13" height="3.6" rx="1.2"/><rect x="1.5" y="10.9" width="13" height="3.6" rx="1.2"/>'),
  equal: svg('<path d="M2 8h12M5 5L2 8l3 3M11 5l3 3-3 3"/>'),
  undo: svg('<path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.5 6.5h7a4 4 0 010 8H7"/>'),
  split: svg('<rect x="1.5" y="1.5" width="13" height="13" rx="2.5"/><path d="M8 1.5v13M10.5 8h2M11.5 7v2"/>', 14),
  move: svg('<rect x="1" y="3" width="8" height="6" rx="1.2"/><rect x="7" y="7" width="8" height="6" rx="1.2"/>', 14),
  min: svg('<path d="M3 12.5h10"/>', 14),
  max: svg('<path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"/>', 13),
  unmax: svg('<path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5L14 2M6.5 9.5L2 14"/>', 13),
  close: svg('<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>', 12),
  open: svg('<rect x="1.5" y="1.5" width="13" height="13" rx="2.5"/><path d="M8 1.5v13M8 8h6.5"/>', 14),
  gear: svg('<path d="M12.98 6.91 L14.55 7.17 L14.55 8.83 L12.98 9.09 L12.30 10.75 L13.22 12.05 L12.05 13.22 L10.75 12.30 L9.09 12.98 L8.83 14.55 L7.17 14.55 L6.91 12.98 L5.25 12.30 L3.95 13.22 L2.78 12.05 L3.70 10.75 L3.02 9.09 L1.45 8.83 L1.45 7.17 L3.02 6.91 L3.70 5.25 L2.78 3.95 L3.95 2.78 L5.25 3.70 L6.91 3.02 L7.17 1.45 L8.83 1.45 L9.09 3.02 L10.75 3.70 L12.05 2.78 L13.22 3.95 L12.30 5.25Z"/><circle cx="8" cy="8" r="2.2"/>'),
  help: svg('<circle cx="8" cy="8" r="6.5"/><path d="M6.3 6.2a1.8 1.8 0 113 1.4c-.6.4-1.3.8-1.3 1.6M8 11.6v.1"/>'),
  window: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M1.5 5.5h13M10 9.5h3M11.5 8v3"/>'),
  monitor: svg('<rect x="1.5" y="2" width="13" height="9" rx="1.5"/><path d="M6 14h4M8 11v3"/>'),
  chevron: svg('<path d="M6 4l4 4-4 4"/>', 12),
  branch: svg('<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="5.5" r="1.6"/><path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-2.3 3-7 3.6"/>', 13),
  update: svg('<path d="M8 12.5V3.5M4.5 7L8 3.5 11.5 7"/><path d="M3 13.5h10"/>', 13),
  terminal: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M4.5 6.5l2 1.75-2 1.75M8.5 10.5h3"/>', 14),
  plus: svg('<path d="M8 3v10M3 8h10"/>', 14),
  focus: svg('<path d="M2 5V2.5a.5.5 0 01.5-.5H5M11 2h2.5a.5.5 0 01.5.5V5M14 11v2.5a.5.5 0 01-.5.5H11M5 14H2.5a.5.5 0 01-.5-.5V11"/><circle cx="8" cy="8" r="2"/>', 13),
  folder: svg('<path d="M1.5 4.5a1 1 0 011-1h3.2l1.5 1.5h6.3a1 1 0 011 1v6.5a1 1 0 01-1 1h-11a1 1 0 01-1-1z"/>', 14),
  winMin: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor"/></svg>',
  winMax: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg>',
  winRestore: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"><rect x=".5" y="2.5" width="7" height="7"/><path d="M2.5 2.5v-2h7v7h-2"/></svg>',
  winClose: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg>',
};
