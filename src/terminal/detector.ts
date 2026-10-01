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
const GENERIC_WAITING = [/\[y\/n\]/i, /\(y\/n\)/i, /Press any key/i, /enter (to )?continue/i];

export interface Detection {
  status: Status;
  /** O próprio CLI deixou claro (texto na tela); não precisa confirmar. */
  certain: boolean;
}

/**
 * `msSinceSpontaneous`: tempo desde a última saída que não foi reação a um
 * estímulo nosso (digitar, clicar, redimensionar, mover o terminal). Redesenhos
 * de tela não contam como trabalho.
 */
export function detectStatus(tool: ToolKind, screen: string[], msSinceSpontaneous: number): Detection {
  const tail = screen.slice(-24).join("\n");
  if ([...WAITING[tool], ...GENERIC_WAITING].some((r) => r.test(tail))) return { status: "waiting", certain: true };
  if (WORKING.test(tail)) return { status: "working", certain: true };
  if (msSinceSpontaneous < 1500) return { status: "working", certain: false };
  return { status: "idle", certain: false };
}

/**
 * Evita piscar: uma mudança sem certeza só vale depois de aparecer em
 * `needed` leituras seguidas.
 */
export class StatusDebouncer {
  private current = new Map<string, Status>();
  private pending = new Map<string, { status: Status; count: number }>();

  constructor(private needed = 2) {}

  next(id: string, d: Detection): Status {
    const cur = this.current.get(id);
    if (cur === undefined || d.certain || d.status === cur) {
      this.pending.delete(id);
      this.current.set(id, d.status);
      return d.status;
    }
    const p = this.pending.get(id);
    const count = p && p.status === d.status ? p.count + 1 : 1;
    if (count >= this.needed) {
      this.pending.delete(id);
      this.current.set(id, d.status);
      return d.status;
    }
    this.pending.set(id, { status: d.status, count });
    return cur;
  }

  forget(id: string): void {
    this.current.delete(id);
    this.pending.delete(id);
  }
}

/**
 * Título que o CLI define no terminal (ex.: o Claude Code usa o assunto da
 * conversa). Remove spinners e ignora títulos genéricos.
 */
export function cleanTitle(raw: string): string | null {
  const t = raw.replace(/^[\s\u2800-\u28ff✳✻✶✢✽·*•◐◓◑◒⏺]+/u, "").trim();
  if (t.length < 2) return null;
  if (/^(claude( code)?|codex( cli)?|opencode|(windows )?powershell|pwsh|cmd|administrador:.*|administrator:.*)$/i.test(t)) return null;
  if (/^[a-z]:\\/i.test(t) || /\.exe$/i.test(t)) return null;
  return t.length > 60 ? `${t.slice(0, 59)}…` : t;
}

/** Percentual de contexto usado, quando o CLI o mostra na tela. */
export function contextFromScreen(screen: string[]): number | null {
  const tail = screen.slice(-12).join("\n");
  const left = /(\d{1,3})%\s*(?:of\s*)?context left/i.exec(tail);
  if (left) return Math.max(0, 100 - Number(left[1]));
  const used = /(\d{1,3})%\s*(?:of\s*)?context(?:\s*used)?|context(?:\s*used)?[:\s]+(\d{1,3})%/i.exec(tail);
  if (used) return Math.min(100, Number(used[1] ?? used[2]));
  return null;
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
