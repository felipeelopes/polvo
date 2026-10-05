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
import { resolvePath } from "../docs/paths";
import { fileLinkProvider, installCtrlClick, openFileLink, type FileLinkHost } from "./file-links";
import { clipboardImage, installPasteFiles, pasteFiles } from "./paste-files";
import { cssVar, isLightTerminal, onThemeChange } from "../ui/theme";

/** Cores ANSI do terminal escuro e do claro; fundo e texto vêm dos tokens --term-bg e --term-fg. */
const DARK_ANSI: ITheme = {
  black: "#26282d",
  red: "#f07178",
  green: "#4cb782",
  yellow: "#e0a642",
  blue: "#7aa5ff",
  magenta: "#c792ea",
  cyan: "#56c7d9",
  white: "#d5d7e0",
  brightBlack: "#6e717a",
  brightRed: "#ff8a8f",
  brightGreen: "#6fd4a3",
  brightYellow: "#f2c46d",
  brightBlue: "#a5b9ff",
  brightMagenta: "#ddb6f5",
  brightCyan: "#8ee0ec",
  brightWhite: "#ffffff",
};
const LIGHT_ANSI: ITheme = {
  black: "#1b1d22",
  red: "#c93a33",
  green: "#1f8a5b",
  yellow: "#9a6700",
  blue: "#1f5fd6",
  magenta: "#8a3ffc",
  cyan: "#0f7b8a",
  white: "#6e717a",
  brightBlack: "#8b909a",
  brightRed: "#d1453b",
  brightGreen: "#23935f",
  brightYellow: "#b07a12",
  brightBlue: "#2f6fe0",
  brightMagenta: "#9b51e0",
  brightCyan: "#11869a",
  brightWhite: "#3a3d44",
};

function terminalTheme(): ITheme {
  const light = isLightTerminal();
  const bg = cssVar("--term-bg") || (light ? "#ffffff" : "#1b1c20");
  const fg = cssVar("--term-fg") || (light ? "#24262b" : "#d9dade");
  return { ...(light ? LIGHT_ANSI : DARK_ANSI), background: bg, foreground: fg, cursor: fg, cursorAccent: bg, selectionBackground: light ? "#1f5fd633" : "#7aa5ff44" };
}

/** No terminal claro, o xterm escurece o texto que os CLIs desenham em cores feitas para fundo escuro. */
const contrast = () => (isLightTerminal() ? 4.5 : 1);

/** Terminais vivos: trocam de cores junto com o tema. */
const live = new Set<SessionTerminal>();
onThemeChange(() => {
  const theme = terminalTheme();
  for (const t of live) {
    t.term.options.theme = theme;
    t.term.options.minimumContrastRatio = contrast();
  }
});

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
  private connectRequest = 0;
  private disposed = false;
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
    private files?: FileLinkHost,
  ) {
    this.host.className = "term-host";
    live.add(this);
    this.term = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.12,
      cursorBlink: true,
      scrollback: 10_000,
      theme: terminalTheme(),
      minimumContrastRatio: contrast(),
      // Hiperlinks OSC 8 (alguns CLIs marcam arquivos e URLs assim).
      linkHandler: {
        allowNonHttpProtocols: true,
        activate: (e, uri) => {
          if (/^https?:/i.test(uri)) ipc.openUrl(uri).catch(() => {});
          else if (files && /^file:/i.test(uri) && (e.ctrlKey || e.metaKey)) {
            openFileLink(files, resolvePath(files.cwd() ?? "C:\\", uri.split(/[?#]/)[0]), e.shiftKey);
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
      this.term.registerLinkProvider(fileLinkProvider(this.term, files));
      installCtrlClick(this.term, this.host, files);
      installPasteFiles(this.term, this.host, files, tool);
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
    if (this.disposed || this.connectedTo === since) return;
    const request = ++this.connectRequest;
    this.connected = false;
    this.connectedTo = since;
    this.stimulus();
    this.pending = [];
    try {
      const history = await ipc.ptyAttach(this.id, (bytes) => {
        if (request === this.connectRequest) this.onBytes(bytes);
      });
      if (request !== this.connectRequest) return;
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
      if (request !== this.connectRequest) return;
      this.connected = false;
      this.connectedTo = -1;
    } finally {
      if (request === this.connectRequest) this.pending = null;
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
    if (this.disposed) return;
    this.disposed = true;
    this.connectRequest++;
    this.connected = false;
    this.pending = null;
    clearTimeout(this.fitTimer);
    live.delete(this);
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
    // Shift+Enter quebra a linha: o xterm mandaria só "\r" (= Enter). Envia ESC+CR,
    // o mesmo que o VS Code manda, que os CLIs tratam como nova linha sem enviar.
    if (key === "enter" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      this.term.input("\x1b\r");
      e.preventDefault();
      return false;
    }
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
      .catch(() => "")
      .then(async (text) => {
        if (text) this.term.paste(text);
        else if (this.files) await pasteFiles(this.term, this.files, this.tool, await clipboardImage());
      });
  }
}
