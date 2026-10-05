import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `danger` é um modificador (texto vermelho) usado em menus, opções e botões
// do Git; o botão sólido é `primary danger`. Se `.danger` sozinho voltar a
// pintar o fundo, o rótulo vermelho some no fundo vermelho.
const dir = join(__dirname, "../src/styles");
const rules = readdirSync(dir)
  .filter((f) => f.endsWith(".css"))
  .flatMap((f) =>
    [...readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      file: f,
      selectors: m[1].split(",").map((s) => s.trim()),
      body: m[2],
    })),
  );

describe("estilos de botão", () => {
  it("`.danger` sozinho não pinta fundo", () => {
    const bare = rules.filter((r) => r.selectors.some((s) => /(^|[\s>+~])\.danger(:[\w-]+)*$/.test(s)) && /background/.test(r.body));
    expect(bare.map((r) => `${r.file}: ${r.selectors.join(", ")}`)).toEqual([]);
  });

  it("o botão sólido de ação destrutiva tem texto branco legível", () => {
    const solid = rules.find((r) => r.selectors.includes(".primary.danger"));
    expect(solid?.body).toContain("var(--bad-solid)");
  });

  it("todo modificador `.danger` com texto vermelho fica sobre fundo claro ou transparente", () => {
    for (const r of rules.filter((r) => r.selectors.some((s) => /\.danger\b/.test(s)) && /color:\s*var\(--bad\)/.test(r.body))) {
      expect(r.body, `${r.file}: ${r.selectors.join(", ")}`).not.toMatch(/background:\s*var\(--bad/);
    }
  });
});
