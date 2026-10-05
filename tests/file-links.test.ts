// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ILink, Terminal } from "@xterm/xterm";

vi.mock("../src/core/ipc", () => ({
  ipc: { pathsKind: vi.fn(), fileOpen: vi.fn(), fileReveal: vi.fn() },
}));
vi.mock("../src/docs/image-viewer", () => ({ openImage: vi.fn() }));
vi.mock("../src/ui/feedback", () => ({ toast: vi.fn() }));
vi.mock("../src/i18n", () => ({ t: (k: string) => k }));

import { ipc } from "../src/core/ipc";
import { openImage } from "../src/docs/image-viewer";
import { fileLinkProvider, installCtrlClick, openFileLink } from "../src/terminal/file-links";
import { toast } from "../src/ui/feedback";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

/** Caminho novo a cada teste (o cache de tipos dura alguns segundos). */
const path = (name: string) => `D:\\p${++seq}\\${name}`;

describe("openFileLink (Ctrl + clique)", () => {
  const host = { cwd: () => "D:\\p", open: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ipc.fileOpen).mockResolvedValue(true);
    vi.mocked(ipc.fileReveal).mockResolvedValue();
  });

  it("abre Markdown no Polvo", async () => {
    vi.mocked(ipc.pathsKind).mockResolvedValue([1]);
    const p = path("README.md");
    openFileLink(host, p, false);
    await flush();
    expect(host.open).toHaveBeenCalledWith(p);
    expect(ipc.fileOpen).not.toHaveBeenCalled();
  });

  it("mostra imagens na prévia", async () => {
    vi.mocked(ipc.pathsKind).mockResolvedValue([1]);
    const p = path("logo.PNG");
    openFileLink(host, p, false);
    await flush();
    expect(openImage).toHaveBeenCalledWith(p);
  });

  it("abre outros arquivos e pastas no programa padrão", async () => {
    vi.mocked(ipc.pathsKind).mockResolvedValue([1]);
    const file = path("app.ts");
    openFileLink(host, file, false);
    await flush();
    vi.mocked(ipc.pathsKind).mockResolvedValue([2]);
    const dir = path("src");
    openFileLink(host, dir, false);
    await flush();
    expect(ipc.fileOpen).toHaveBeenCalledWith(file);
    expect(ipc.fileOpen).toHaveBeenCalledWith(dir);
  });

  it("Ctrl + Shift mostra no Explorer, até Markdown e imagem", async () => {
    vi.mocked(ipc.pathsKind).mockResolvedValue([1]);
    const p = path("notas.md");
    openFileLink(host, p, true);
    await flush();
    expect(ipc.fileReveal).toHaveBeenCalledWith(p);
    expect(host.open).not.toHaveBeenCalled();
  });

  it("avisa quando um executável só foi mostrado no Explorer", async () => {
    vi.mocked(ipc.pathsKind).mockResolvedValue([1]);
    vi.mocked(ipc.fileOpen).mockResolvedValue(false);
    openFileLink(host, path("setup.exe"), false);
    await flush();
    expect(toast).toHaveBeenCalledWith("terminal.ctrlClick.runnable");
  });

  it("ignora caminhos que não existem", async () => {
    vi.mocked(ipc.pathsKind).mockResolvedValue([0]);
    openFileLink(host, path("sumiu.md"), false);
    await flush();
    expect(host.open).not.toHaveBeenCalled();
    expect(ipc.fileOpen).not.toHaveBeenCalled();
  });
});

/** Terminal falso: cada texto é uma linha do buffer (sem quebra automática do xterm). */
function fakeTerm(rows: string[], cols = 40): Terminal {
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  screen.getBoundingClientRect = () => ({ left: 0, top: 0, width: cols * 10, height: rows.length * 20 }) as DOMRect;
  const element = document.createElement("div");
  element.append(screen);
  const lines = rows.map((text) => ({
    isWrapped: false,
    length: cols,
    getCell: (x: number) => ({ getWidth: () => 1, getChars: () => text[x] ?? "" }),
  }));
  return {
    cols,
    rows: rows.length,
    element,
    buffer: { active: { length: rows.length, viewportY: 0, getLine: (y: number) => lines[y] } },
  } as unknown as Terminal;
}

describe("caminho quebrado pelo CLI em várias linhas", () => {
  // O CLI cortou o caminho no fim da linha e continuou com recuo.
  const rows = ["⏺ Editei src/termi", "  nal/file-links.ts agora", "", "outra coisa"];

  function setup() {
    const cwd = `D:\\proj${++seq}`;
    const full = `${cwd}\\src\\terminal\\file-links.ts`;
    vi.mocked(ipc.pathsKind).mockImplementation(async (ps) => ps.map((p) => (p === full ? 1 : 0)));
    return { host: { cwd: () => cwd, open: vi.fn() }, full };
  }

  const links = (term: Terminal, host: { cwd: () => string; open: () => void }, row: number) =>
    new Promise<ILink[] | undefined>((done) => fileLinkProvider(term, host).provideLinks(row, done));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ipc.fileOpen).mockResolvedValue(true);
  });

  it("sublinha o caminho inteiro nas duas linhas", async () => {
    const { host } = setup();
    const term = fakeTerm(rows);
    for (const row of [1, 2]) {
      const [link, ...rest] = (await links(term, host, row)) ?? [];
      expect(rest).toEqual([]);
      expect(link.range).toEqual({ start: { x: 10, y: 1 }, end: { x: 19, y: 2 } });
      expect(link.text).toBe("src/terminal/file-links.ts");
    }
    expect(await links(term, host, 4)).toBeUndefined();
  });

  it("Ctrl + clique em qualquer das metades abre o arquivo inteiro", async () => {
    const { host, full } = setup();
    const term = fakeTerm(rows);
    const el = document.createElement("div");
    installCtrlClick(term, el, host);
    // Célula (1-based) → ponto na tela (10 × 20 px por célula).
    const click = (x: number, y: number) =>
      el.dispatchEvent(new MouseEvent("mousedown", { button: 0, ctrlKey: true, clientX: (x - 1) * 10 + 5, clientY: (y - 1) * 20 + 10, bubbles: true }));

    click(12, 1); // "src/termi"
    await flush();
    click(5, 2); // "nal/file-links.ts"
    await flush();
    expect(ipc.fileOpen).toHaveBeenCalledTimes(2);
    expect(ipc.fileOpen).toHaveBeenNthCalledWith(1, full);
    expect(ipc.fileOpen).toHaveBeenNthCalledWith(2, full);

    // Fora do caminho (o recuo da segunda linha) não abre nada.
    click(1, 2);
    await flush();
    expect(ipc.fileOpen).toHaveBeenCalledTimes(2);
  });
});
