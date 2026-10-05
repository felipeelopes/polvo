import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";

vi.mock("../src/core/ipc", () => ({
  ipc: { clipboardFiles: vi.fn(), pasteFiles: vi.fn(), pasteImage: vi.fn() },
}));
vi.mock("../src/ui/feedback", () => ({ toast: vi.fn() }));

import { ipc } from "../src/core/ipc";
import { fileRef, pasteFiles } from "../src/terminal/paste-files";
import { toast } from "../src/ui/feedback";

describe("fileRef", () => {
  it("usa @ nos agentes e o caminho puro no shell", () => {
    expect(fileRef("claude", ".polvo/pasted/a.png")).toBe("@.polvo/pasted/a.png");
    expect(fileRef("codex", "src/app.ts")).toBe("@src/app.ts");
    expect(fileRef("shell", "src/app.ts")).toBe("src/app.ts");
  });

  it("põe aspas quando há espaços", () => {
    expect(fileRef("claude", ".polvo/pasted/minha foto.png")).toBe('@".polvo/pasted/minha foto.png"');
    expect(fileRef("shell", "C:\\Meus Docs")).toBe('"C:\\Meus Docs"');
  });
});

describe("pasteFiles (Ctrl + V)", () => {
  const term = () => ({ paste: vi.fn(), input: vi.fn() }) as unknown as Terminal & { paste: ReturnType<typeof vi.fn>; input: ReturnType<typeof vi.fn> };
  const host = { cwd: () => "D:\\proj", open: vi.fn() };
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

  beforeEach(() => vi.clearAllMocks());

  it("copia os arquivos do Explorer e referencia no chat", async () => {
    vi.mocked(ipc.clipboardFiles).mockResolvedValue(["C:\\x\\a.pdf", "D:\\proj\\src\\b.ts"]);
    vi.mocked(ipc.pasteFiles).mockResolvedValue([".polvo/pasted/a.pdf", "src/b.ts"]);
    const t = term();
    expect(await pasteFiles(t, host, "claude", png)).toBe(true);
    expect(ipc.pasteFiles).toHaveBeenCalledWith("D:\\proj", ["C:\\x\\a.pdf", "D:\\proj\\src\\b.ts"]);
    expect(t.paste).toHaveBeenCalledWith("@.polvo/pasted/a.pdf @src/b.ts ");
    expect(ipc.pasteImage).not.toHaveBeenCalled();
  });

  it("imagem solta no Claude vira o Alt + V nativo", async () => {
    vi.mocked(ipc.clipboardFiles).mockResolvedValue([]);
    const t = term();
    expect(await pasteFiles(t, host, "claude", png)).toBe(true);
    expect(t.input).toHaveBeenCalledWith("\x1bv");
    expect(ipc.pasteImage).not.toHaveBeenCalled();
  });

  it("imagem solta nos outros CLIs é salva e referenciada", async () => {
    vi.mocked(ipc.clipboardFiles).mockResolvedValue([]);
    vi.mocked(ipc.pasteImage).mockResolvedValue(".polvo/pasted/image-1.png");
    const t = term();
    expect(await pasteFiles(t, host, "codex", png)).toBe(true);
    expect(ipc.pasteImage).toHaveBeenCalledWith("D:\\proj", btoa(String.fromCharCode(137, 80, 78, 71)), "png");
    expect(t.paste).toHaveBeenCalledWith("@.polvo/pasted/image-1.png ");
  });

  it("sem arquivos nem imagem, deixa o colar normal seguir", async () => {
    vi.mocked(ipc.clipboardFiles).mockResolvedValue([]);
    const t = term();
    expect(await pasteFiles(t, host, "claude", null)).toBe(false);
    expect(t.paste).not.toHaveBeenCalled();
  });

  it("sem pasta da sessão não faz nada", async () => {
    expect(await pasteFiles(term(), { cwd: () => undefined, open: vi.fn() }, "claude", png)).toBe(false);
    expect(ipc.clipboardFiles).not.toHaveBeenCalled();
  });

  it("mostra o erro ao falhar a cópia", async () => {
    vi.mocked(ipc.clipboardFiles).mockResolvedValue(["C:\\x\\a.pdf"]);
    vi.mocked(ipc.pasteFiles).mockRejectedValue(new Error("Acesso negado"));
    const t = term();
    expect(await pasteFiles(t, host, "claude", null)).toBe(true);
    expect(toast).toHaveBeenCalledWith("Acesso negado");
    expect(t.paste).not.toHaveBeenCalled();
  });
});
