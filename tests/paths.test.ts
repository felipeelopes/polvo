import { describe, expect, it } from "vitest";
import { findFilePaths, findPathsAcross, resolvePath } from "../src/docs/paths";

describe("findFilePaths", () => {
  const paths = (text: string) => findFilePaths(text).map((m) => m.path);

  it("acha caminhos relativos e absolutos de qualquer extensão", () => {
    const text = "⏺ Atualizei docs/ARCHITECTURE.md, src/app.ts e D:\\Projetos\\api\\logo.png.";
    expect(paths(text)).toEqual(["docs/ARCHITECTURE.md", "src/app.ts", "D:\\Projetos\\api\\logo.png"]);
  });

  it("marca o trecho certo e ignora o sufixo de linha", () => {
    const text = "Write(notes/plan.md:12)";
    const [m] = findFilePaths(text);
    expect(m.path).toBe("notes/plan.md");
    expect(text.slice(m.index, m.index + m.length)).toBe("notes/plan.md:12");
  });

  it("aceita espaços entre crases e pastas", () => {
    expect(paths("veja `Minhas Notas/ideia boa.md` depois")).toEqual(["Minhas Notas/ideia boa.md"]);
    expect(paths("criei src/terminal/ e ./build")).toEqual(["src/terminal/", "./build"]);
  });

  it("ignora palavras, versões e URLs", () => {
    expect(paths("versão 0.3.5 pronta, veja https://github.com/a/b.png e etc.")).toEqual([]);
    expect(paths("https://github.com/x/y.md")).toEqual([]);
    expect(paths("rodando os testes agora")).toEqual([]);
  });

  it("acha pastas com barra no fim e tira o ponto final", () => {
    const dir = String.raw`D:\Projetos\api` + "\\";
    expect(paths(`⏺ Update(src/ui/sidebar.ts) e a pasta ${dir} e README.md.`)).toEqual(["src/ui/sidebar.ts", dir, "README.md"]);
    const text = "veja src/app.ts:12:4.";
    const [m] = findFilePaths(text);
    expect(m.path).toBe("src/app.ts");
    expect(text.slice(m.index, m.index + m.length)).toBe("src/app.ts:12:4");
  });

  it("aceita espaços entre aspas", () => {
    expect(paths(String.raw`abra "C:\Program Files\Git" agora`)).toEqual([String.raw`C:\Program Files\Git`]);
  });

  it("não engole as molduras e setas do CLI", () => {
    expect(paths("│src/x.ts│ ⎿ docs/a.md")).toEqual(["src/x.ts", "docs/a.md"]);
  });

  it("aceita file:// e limita os candidatos por linha", () => {
    expect(paths("file:///D:/x/a.md")).toEqual(["file:///D:/x/a.md"]);
    expect(findFilePaths(Array.from({ length: 60 }, (_, i) => `a${i}.ts`).join(" "))).toHaveLength(40);
  });
});

describe("findPathsAcross", () => {
  const spans = (lines: string[]) => findPathsAcross(lines).filter((m) => m.start.line !== m.end.line);

  it("junta um caminho que o CLI quebrou em duas linhas (com recuo)", () => {
    const lines = ["⏺ Atualizei D:\\Projetos\\SplitAITerminal\\src\\termi   ", "  nal\\file-links.ts com a junção."];
    const [m] = spans(lines);
    expect(m.path).toBe("D:\\Projetos\\SplitAITerminal\\src\\terminal\\file-links.ts");
    expect(m.start).toEqual({ line: 0, col: 12 });
    expect(m.end).toEqual({ line: 1, col: 18 });
  });

  it("atravessa mais de duas linhas", () => {
    const [m] = spans(["veja docs/arquitetura/", "  terminal/links/", "  quebra.md"]);
    expect(m.path).toBe("docs/arquitetura/terminal/links/quebra.md");
    expect(m.end).toEqual({ line: 2, col: 10 });
  });

  it("mantém os caminhos de cada linha sozinha como candidatos", () => {
    const all = findPathsAcross(["editei o arquivo", "  src/a.ts e b.ts"]).map((m) => m.path);
    expect(all).toContain("src/a.ts");
    expect(all).toContain("b.ts");
    // A junção errada também vira candidato; quem chama descarta por não existir.
    expect(all).toContain("arquivosrc/a.ts");
  });

  it("não junta através de linha em branco", () => {
    expect(spans(["veja docs/a", "", "b.md"])).toEqual([]);
  });
});

describe("resolvePath", () => {
  const base = "D:\\Projetos\\api";
  it("resolve relativo à pasta", () => {
    expect(resolvePath(base, "docs/a.md")).toBe("D:\\Projetos\\api\\docs\\a.md");
    expect(resolvePath(base, "../web/b.md")).toBe("D:\\Projetos\\web\\b.md");
    expect(resolvePath(base, "./c.md")).toBe("D:\\Projetos\\api\\c.md");
  });

  it("mantém absolutos e converte outros formatos", () => {
    expect(resolvePath(base, "C:/x/y.md")).toBe("C:\\x\\y.md");
    expect(resolvePath(base, "/d/Projetos/z.md")).toBe("D:\\Projetos\\z.md");
    expect(resolvePath(base, "file:///D:/Meus%20Docs/z.md")).toBe("D:\\Meus Docs\\z.md");
    expect(resolvePath(base, "\\raiz.md")).toBe("D:\\raiz.md");
  });
});
