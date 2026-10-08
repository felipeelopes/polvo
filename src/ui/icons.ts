// Ícones (SVG inline) e metadados visuais das ferramentas.
import { resolveColor } from "../core/appearance";
import { store } from "../core/store";
import type { Session, ToolKind } from "../core/types";
import { t } from "../i18n";

export const TOOLS: Record<ToolKind, { name: string; short: string; color: string; vendor: string }> = {
  claude: { name: "Claude Code", short: "Claude", color: "#D97757", vendor: "Anthropic" },
  codex: { name: "Codex CLI", short: "Codex", color: "#10A37F", vendor: "OpenAI" },
  opencode: { name: "OpenCode", short: "OpenCode", color: "#4F8CFF", get vendor() { return t("tools.opencode.vendor"); } },
  shell: { name: "PowerShell", short: "Shell", color: "#A78BFA", get vendor() { return t("tools.shell.vendor"); } },
};

/** Cor de destaque da sessão: a do `/color`, senão a do projeto, senão a da ferramenta. */
export function sessionColor(s: Session): string {
  return resolveColor(s.color, store.projectOf(s)?.color, TOOLS[s.tool].color);
}

const TOOL_PATHS: Record<ToolKind, string> = {
  claude: [0, 30, 60, 90, 120, 150].map((a) => `<line x1="12" y1="3.5" x2="12" y2="20.5" transform="rotate(${a} 12 12)"/>`).join(""),
  codex: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><circle cx="12" cy="12" r="2.6" fill="CC" stroke="none"/>',
  opencode: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M10 9l-3 3 3 3M14 9l3 3-3 3"/>',
  shell: '<path d="M5 7l5 5-5 5M12.5 17.5H19"/>',
};

export function toolIcon(tool: ToolKind, size = 16, color = TOOLS[tool].color): string {
  // Traço compensado pelo tamanho: o mesmo peso visual (~1,5px) de 13px a 19px.
  const w = Math.max(2, ((tool === "claude" ? 1.7 : 1.5) * 24) / size).toFixed(2);
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${TOOL_PATHS[tool].replace(/CC/g, color)}</svg>`;
}

// O traço acompanha o tamanho para que ícones de 12px e 16px tenham a mesma espessura na tela (1,5px).
const svg = (body: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${+(24 / size).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICON = {
  work: svg('<path d="M2 13.5h12"/><path d="M4 11V7.5M7 11V4M10 11V6M13 11V2.5"/>', 14),
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
  branch: svg('<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="5.5" r="1.6"/><path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-2.3 3-7 3.6"/>', 14),
  update: svg('<path d="M8 12.5V3.5M4.5 7L8 3.5 11.5 7"/><path d="M3 13.5h10"/>', 13),
  mic: svg('<rect x="5.5" y="1.5" width="5" height="8.2" rx="2.5"/><path d="M3 7.6a5 5 0 0010 0M8 12.6v2"/>', 14),
  check: svg('<path d="M3 8.5l3.2 3.2L13 4.8"/>', 13),
  terminal: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M4.5 6.5l2 1.75-2 1.75M8.5 10.5h3"/>', 14),
  plus: svg('<path d="M8 3v10M3 8h10"/>', 14),
  plusSm: svg('<path d="M8 3v10M3 8h10"/>', 12),
  sidebarClose: svg('<rect x="1.5" y="2" width="13" height="12" rx="2.5"/><path d="M6 2v12M11 6l-2 2 2 2"/>', 15),
  sidebarOpen: svg('<rect x="1.5" y="2" width="13" height="12" rx="2.5"/><path d="M6 2v12M9 6l2 2-2 2"/>', 15),
  focus: svg('<path d="M2 5V2.5a.5.5 0 01.5-.5H5M11 2h2.5a.5.5 0 01.5.5V5M14 11v2.5a.5.5 0 01-.5.5H11M5 14H2.5a.5.5 0 01-.5-.5V11"/><circle cx="8" cy="8" r="2"/>', 13),
  folder: svg('<path d="M1.5 4.5a1 1 0 011-1h3.2l1.5 1.5h6.3a1 1 0 011 1v6.5a1 1 0 01-1 1h-11a1 1 0 01-1-1z"/>', 14),
  winMin: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor"/></svg>',
  winMax: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg>',
  winRestore: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"><rect x=".5" y="2.5" width="7" height="7"/><path d="M2.5 2.5v-2h7v7h-2"/></svg>',
  winClose: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg>',
};

/** Ícones que o usuário pode dar a um projeto (a ordem é a da grade de escolha). */
const PROJECT_ICONS: Record<string, string> = {
  folder: '<path d="M1.5 4.5a1 1 0 011-1h3.2l1.5 1.5h6.3a1 1 0 011 1v6.5a1 1 0 01-1 1h-11a1 1 0 01-1-1z"/>',
  code: '<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9.2 2.8l-2.4 10.4"/>',
  globe: '<circle cx="8" cy="8" r="6.5"/><path d="M1.5 8h13M8 1.5c1.8 1.8 2.7 4 2.7 6.5S9.8 12.7 8 14.5M8 1.5C6.2 3.3 5.3 5.5 5.3 8s.9 4.7 2.7 6.5"/>',
  mobile: '<rect x="4" y="1.5" width="8" height="13" rx="1.8"/><path d="M7 12.2h2"/>',
  database: '<ellipse cx="8" cy="3.8" rx="5.5" ry="2.3"/><path d="M2.5 3.8v8.4c0 1.27 2.46 2.3 5.5 2.3s5.5-1.03 5.5-2.3V3.8M2.5 8c0 1.27 2.46 2.3 5.5 2.3s5.5-1.03 5.5-2.3"/>',
  cart: '<path d="M1.5 2h1.8l1.7 8.2h7.4l1.6-5.7H4"/><circle cx="6" cy="13.2" r="1"/><circle cx="11.6" cy="13.2" r="1"/>',
  card: '<rect x="1.5" y="3.5" width="13" height="9" rx="1.8"/><path d="M1.5 6.5h13M4 10h3"/>',
  book: '<path d="M8 4c-1.4-1.3-3.5-1.8-6-1.5v10c2.5-.3 4.6.2 6 1.5 1.4-1.3 3.5-1.8 6-1.5v-10c-2.5-.3-4.6.2-6 1.5zM8 4v10"/>',
  box: '<path d="M8 1.5l6 3v7l-6 3-6-3v-7z"/><path d="M2 4.5l6 3 6-3M8 7.5v7"/>',
  bolt: '<path d="M9.2 1.5L3.2 9h4.3l-.7 5.5 6-7.5H8.5z"/>',
  star: '<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>',
  flask: '<path d="M6 1.5h4M6.6 1.5v4.4L2.7 12.5a1.3 1.3 0 001.1 2h8.4a1.3 1.3 0 001.1-2L9.4 5.9V1.5M4.4 10h7.2"/>',
};

export const PROJECT_ICON_IDS = Object.keys(PROJECT_ICONS);

/** Ícone de um projeto; id desconhecido (ou nenhum) vira a pasta. */
export function projectIcon(id: string | null | undefined, size = 14): string {
  return svg(PROJECT_ICONS[id ?? ""] ?? PROJECT_ICONS.folder, size);
}
