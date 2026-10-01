// Heurísticas para saber o que um agente está fazendo, a partir da tela.
// Cada CLI tem seus próprios textos; mantenha as regras pequenas e testáveis.
import type { Status, ToolKind } from "../core/types";

/** Texto exibido pelos CLIs enquanto processam ("esc to interrupt"). */
const WORKING = /esc to interrupt|esc interrupt|ctrl\+c to (interrupt|cancel)/i;

const WAITING: Record<ToolKind, RegExp[]> = {
  claude: [/Do you want to /i, /Would you like to /i, /❯\s*1\.\s*Yes/],
  codex: [/Allow command\?/i, /Would you like to (run|make|apply)/i, /\bApprove\b/i, /Yes, proceed/i],
  opencode: [/Allow once/i, /Allow always/i, /Permission required/i],
  shell: [],
};
const GENERIC_WAITING = [/\[y\/n\]/i, /\(y\/n\)/i, /Press any key/i];

export function detectStatus(tool: ToolKind, screen: string[], msSinceOutput: number, msSinceInput: number): Status {
  const tail = screen.slice(-24).join("\n");
  if ([...WAITING[tool], ...GENERIC_WAITING].some((r) => r.test(tail))) return "waiting";
  if (WORKING.test(tail)) return "working";
  // Saída recente que não é só o eco do que o usuário digitou.
  if (msSinceOutput < 1500 && msSinceInput > 700) return "working";
  return "idle";
}

const DECORATION = /^[\s─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║╔╗╚╝>›❯·•*✻✳✶✢…\-_=]*$/;

/** Últimas linhas com conteúdo, para a prévia nos cartões do Quadro. */
export function previewLines(screen: string[], max = 6): string[] {
  return screen
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l && !DECORATION.test(l))
    .slice(-max)
    .map((l) => (l.length > 140 ? `${l.slice(0, 139)}…` : l));
}
