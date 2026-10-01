// Um terminal xterm.js ligado ao pseudo-terminal de uma sessão.
// O elemento é movido entre painéis (e a gaveta do Quadro) sem recriar nada.
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ipc } from "../core/ipc";
import type { ToolKind } from "../core/types";
import { MD_EXT, resolvePath } from "../docs/paths";
import { installCtrlClick, mdLinkProvider, type FileLinkHost } from "./file-links";

const THEME: ITheme = {
  background: "#00000000",
  foreground: "#e6e7ee",
  cursor: "#e6e7ee",
  cursorAccent: "#0d0e16",
  selectionBackground: "#8aa2ff55",
  black: "#1b1d2a",
  red: "#f07178",
  green: "#3fb27f",
  yellow: "#e5a33a",
  blue: "#7c9cff",
  magenta: "#c792ea",
  cyan: "#56c7d9",
  white: "#d5d7e0",
  brightBlack: "#6b7086",
  brightRed: "#ff8a8f",
  brightGreen: "#6fd4a3",
  brightYellow: "#f2c46d",
  brightBlue: "#a5b9ff",
  brightMagenta: "#ddb6f5",
  brightCyan: "#8ee0ec",
  brightWhite: "#ffffff",
};

/** Contêiner fora da tela para terminais de sessões recolhidas. */
const parking = document.createElement("div");
parking.className = "parking";
document.body.appendChild(parking);

const MAX_WEBGL = 12;
/** Por quanto tempo a saída depois de um estímulo é considerada redesenho. */
const REDRAW_WINDOW_MS = 1200;
let webglCount = 0;

export class SessionTerminal {
  readonly host = document.createElement("div");
  readonly term: Terminal;
  lastOutput = 0;
  /** Última saída que não foi provocada por um estímulo (digitar, clicar, redimensionar…). */
  lastSpontaneous = 0;
  /** Último estímulo: os CLIs redesenham a tela em seguida, e isso não é "trabalho". */
  private lastStimulus = 0;
  connected = false;
  /** `runtime.since` do início ao qual este terminal está conectado. */
  connectedTo = -1;

  private fitAddon = new FitAddon();
  private webgl: WebglAddon | null = null;
  private pending: Uint8Array[] | null = null;
  private cols = 0;
  private rows = 0;
  private fitTimer: number | undefined;
  private observer: ResizeObserver;

  constructor(
    readonly id: string,
    readonly tool: ToolKind,
    isAppShortcut: (e: KeyboardEvent) => boolean,
    onTitle?: (title: string) => void,
    private onCommand?: (cmd: "rename" | "color", arg: string) => void,
    files?: FileLinkHost,
  ) {
    this.host.className = "term-host";
    this.term = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.12,
      cursorBlink: true,
      scrollback: 10_000,
      theme: THEME,
      // Hiperlinks OSC 8 (alguns CLIs marcam arquivos e URLs assim).
      linkHandler: {
        allowNonHttpProtocols: true,
        activate: (e, uri) => {
          if (/^https?:/i.test(uri)) ipc.openUrl(uri).catch(() => {});
          else if (files && /^file:/i.test(uri) && MD_EXT.test(uri.split(/[?#]/)[0]) && (e.ctrlKey || e.metaKey)) {
            files.open(resolvePath(files.cwd() ?? "C:\\", uri));
          }
        },
      },
    });
    this.term.loadAddon(this.fitAddon);
    const unicode = new Unicode11Addon();
    this.term.loadAddon(unicode);
    this.term.unicode.activeVersion = "11";
    this.term.loadAddon(new WebLinksAddon((_e, url) => ipc.openUrl(url).catch(() => {})));
    if (files) {
      this.term.registerLinkProvider(mdLinkProvider(this.term, files));
      installCtrlClick(this.term, this.host, files);
    }

    // onData também recebe cliques do mouse e relatórios de foco enviados ao CLI.
    this.term.onData((data) => {
      this.stimulus();
      this.trackInput(data);
      ipc.ptyWrite(this.id, data).catch(() => {});
    });
    this.host.addEventListener("pointerdown", () => this.stimulus(), true);
    this.term.attachCustomKeyEventHandler((e) => this.onKey(e, isAppShortcut));
    if (onTitle) this.term.onTitleChange(onTitle);
    this.host.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.copyOrPaste();
    });

    parking.appendChild(this.host);
    this.term.open(this.host);
    this.observer = new ResizeObserver(() => this.scheduleFit());
    this.observer.observe(this.host);
  }

  /** Coloca o terminal dentro de um painel visível. */
  mount(container: HTMLElement): void {
    if (this.host.parentElement !== container) {
      this.stimulus();
      container.appendChild(this.host);
    }
    this.enableWebgl();
    this.scheduleFit(0);
  }

  park(): void {
    if (this.host.parentElement !== parking) parking.appendChild(this.host);
  }

  focus(): void {
    this.stimulus();
    this.term.focus();
  }

  private line = "";

  /** Acompanha a linha digitada para reconhecer `/rename …` e `/color …`. */
  private trackInput(data: string): void {
    if (data.startsWith("\x1b")) return; // setas e outras teclas especiais
    for (const ch of data) {
      if (ch === "\r" || ch === "\n") {
        const m = /^\/(rename|color)\s+(.+)$/i.exec(this.line.trim());
        if (m) this.onCommand?.(m[1].toLowerCase() as "rename" | "color", m[2].trim());
        this.line = "";
      } else if (ch === "\x7f" || ch === "\b") this.line = this.line.slice(0, -1);
      else if (ch === "\x15" || ch === "\x03") this.line = "";
      else if (ch >= " ") this.line += ch;
    }
    if (this.line.length > 300) this.line = this.line.slice(-300);
  }

  /** Marca que o que vier a seguir do terminal é reação a algo que fizemos. */
  private stimulus(): void {
    this.lastStimulus = performance.now();
  }

  /** Conecta à saída do processo, reproduzindo o histórico antes dos dados ao vivo. */
  async connect(since: number): Promise<void> {
    if (this.connectedTo === since) return;
    this.connectedTo = since;
    this.stimulus();
    this.pending = [];
    try {
      const history = await ipc.ptyAttach(this.id, (bytes) => this.onBytes(bytes));
      this.term.reset();
      // O CLI pode já ter escrito tudo e estar parado esperando (ex.: Codex
      // retomado antes de a janela abrir): o histórico também conta como saída,
      // senão o status nunca sairia de "iniciando".
      if (history.length) {
        this.term.write(history);
        this.lastOutput = performance.now();
      }
      for (const chunk of this.pending ?? []) this.term.write(chunk);
      this.connected = true;
      this.cols = this.rows = 0;
      this.scheduleFit(0);
    } catch {
      this.connected = false;
      this.connectedTo = -1;
    } finally {
      this.pending = null;
    }
  }

  /** Linhas visíveis na tela (para detectar status e montar prévias). */
  screen(): string[] {
    const buf = this.term.buffer.active;
    const lines: string[] = [];
    for (let i = buf.baseY; i < buf.baseY + this.term.rows; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
    return lines;
  }

  dispose(): void {
    this.observer.disconnect();
    if (this.webgl) webglCount--;
    this.term.dispose();
    this.host.remove();
  }

  private onBytes(bytes: Uint8Array): void {
    const now = performance.now();
    this.lastOutput = now;
    if (now - this.lastStimulus > REDRAW_WINDOW_MS) this.lastSpontaneous = now;
    if (this.pending) this.pending.push(bytes);
    else this.term.write(bytes);
  }

  private scheduleFit(delay = 40): void {
    clearTimeout(this.fitTimer);
    this.fitTimer = window.setTimeout(() => this.fit(), delay);
  }

  private fit(): void {
    if (this.host.parentElement === parking || !this.host.offsetWidth || !this.host.offsetHeight) return;
    try {
      this.fitAddon.fit();
    } catch {
      return;
    }
    if (this.term.cols !== this.cols || this.term.rows !== this.rows) {
      this.cols = this.term.cols;
      this.rows = this.term.rows;
      this.stimulus();
      if (this.connected) ipc.ptyResize(this.id, this.cols, this.rows).catch(() => {});
    }
  }

  private enableWebgl(): void {
    if (this.webgl || webglCount >= MAX_WEBGL) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon.dispose();
        this.webgl = null;
        webglCount--;
      });
      this.term.loadAddon(addon);
      this.webgl = addon;
      webglCount++;
    } catch {
      this.webgl = null;
    }
  }

  private onKey(e: KeyboardEvent, isAppShortcut: (e: KeyboardEvent) => boolean): boolean {
    if (e.type !== "keydown") return true;
    if (isAppShortcut(e)) return false;
    const key = e.key.toLowerCase();
    // Ctrl+C copia quando há seleção; sem seleção, envia ^C normalmente.
    if (e.ctrlKey && !e.altKey && key === "c" && (e.shiftKey || this.term.hasSelection())) {
      this.copySelection();
      e.preventDefault();
      return false;
    }
    // Ctrl+V / Ctrl+Shift+V: deixa o navegador disparar o "paste" que o xterm já trata.
    if (e.ctrlKey && !e.altKey && key === "v") return false;
    return true;
  }

  private copySelection(): void {
    const text = this.term.getSelection();
    if (text) navigator.clipboard.writeText(text).catch(() => {});
    this.term.clearSelection();
  }

  private copyOrPaste(): void {
    if (this.term.hasSelection()) return this.copySelection();
    navigator.clipboard
      .readText()
      .then((text) => text && this.term.paste(text))
      .catch(() => {});
  }
}
