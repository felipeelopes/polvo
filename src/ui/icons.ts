// Ícones (SVG inline) e metadados visuais das ferramentas.
import type { ToolKind } from "../core/types";

export const TOOLS: Record<ToolKind, { name: string; short: string; color: string; vendor: string }> = {
  claude: { name: "Claude Code", short: "Claude", color: "#D97757", vendor: "Anthropic" },
  codex: { name: "Codex CLI", short: "Codex", color: "#10A37F", vendor: "OpenAI" },
  opencode: { name: "OpenCode", short: "OpenCode", color: "#4F8CFF", vendor: "Open source · qualquer modelo" },
  shell: { name: "PowerShell", short: "Shell", color: "#A78BFA", vendor: "Terminal comum" },
};

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
  gear: svg('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7L3.4 3.4"/>'),
  help: svg('<circle cx="8" cy="8" r="6.5"/><path d="M6.3 6.2a1.8 1.8 0 113 1.4c-.6.4-1.3.8-1.3 1.6M8 11.6v.1"/>'),
  window: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M1.5 5.5h13M10 9.5h3M11.5 8v3"/>'),
  monitor: svg('<rect x="1.5" y="2" width="13" height="9" rx="1.5"/><path d="M6 14h4M8 11v3"/>'),
  chevron: svg('<path d="M6 4l4 4-4 4"/>', 12),
  branch: svg('<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="5.5" r="1.6"/><path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-2.3 3-7 3.6"/>', 13),
  update: svg('<path d="M8 12.5V3.5M4.5 7L8 3.5 11.5 7"/><path d="M3 13.5h10"/>', 13),
  terminal: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M4.5 6.5l2 1.75-2 1.75M8.5 10.5h3"/>', 14),
  folder: svg('<path d="M1.5 4.5a1 1 0 011-1h3.2l1.5 1.5h6.3a1 1 0 011 1v6.5a1 1 0 01-1 1h-11a1 1 0 01-1-1z"/>', 14),
  winMin: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor"/></svg>',
  winMax: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg>',
  winRestore: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"><rect x=".5" y="2.5" width="7" height="7"/><path d="M2.5 2.5v-2h7v7h-2"/></svg>',
  winClose: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg>',
};
