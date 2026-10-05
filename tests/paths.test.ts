import { describe, expect, it } from "vitest";
import { findMdPaths, findPaths, resolvePath } from "../src/docs/paths";

describe("findMdPaths", () => {
  it("acha caminhos relativos e absolutos", () => {
    const text = "⏺ Atualizei docs/ARCHITECTURE.md e D:\\Projetos\\api\\README.md.";
    expect(findMdPaths(text).map((m) => m.path)).toEqual(["docs/ARCHITECTURE.md", "D:\\Projetos\\api\\README.md"]);
  });

  it("marca o trecho certo e ignora o sufixo de linha", () => {
    const text = "Write(notes/plan.md:12)";
    const [m] = findMdPaths(text);
    expect(m.path).toBe("notes/plan.md");
    expect(text.slice(m.index, m.index + m.length)).toBe("notes/plan.md:12");
  });

  it("aceita espaços entre crases", () => {
    const [m] = findMdPaths("veja `Minhas Notas/ideia boa.md` depois");
    expect(m.path).toBe("Minhas Notas/ideia boa.md");
  });

  it("não pega outras extensões", () => {
    expect(findMdPaths("src/app.ts e README.mdx2 e x.md5")).toEqual([]);
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

describe("findPaths", () => {
  const paths = (text: string) => findPaths(text).map((m) => m.path);

  it("acha arquivos e pastas com separador ou extensão", () => {
    const dir = String.raw`D:\Projetos\api` + "\\";
    expect(paths(`⏺ Update(src/ui/sidebar.ts) e a pasta ${dir} e README.md.`)).toEqual(["src/ui/sidebar.ts", dir, "README.md"]);
  });

  it("marca o trecho com :linha e tira o ponto final", () => {
    const text = "veja src/app.ts:12:4.";
    const [m] = findPaths(text);
    expect(m.path).toBe("src/app.ts");
    expect(text.slice(m.index, m.index + m.length)).toBe("src/app.ts:12:4");
  });

  it("aceita espaços entre aspas e ignora palavras soltas e URLs", () => {
    expect(paths(String.raw`abra "C:\Program Files\Git" agora`)).toEqual([String.raw`C:\Program Files\Git`]);
    expect(paths("rodando os testes agora")).toEqual([]);
    expect(paths("https://github.com/x/y.md")).toEqual([]);
  });

  it("não engole as molduras do CLI", () => {
    expect(paths("│src/x.ts│ ⎿ docs/a.md")).toEqual(["src/x.ts", "docs/a.md"]);
  });
});
