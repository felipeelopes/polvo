import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cmpVersion, RELEASES } from "../src/changelog";
import { LOCALES } from "../src/i18n";

describe("novidades por versão", () => {
  it("a versão do package.json tem novidades", () => {
    const version = JSON.parse(readFileSync("package.json", "utf8")).version as string;
    expect(RELEASES.map((r) => r.version)).toContain(version);
  });

  it("cada versão tem as notas em todos os idiomas, com o mesmo número de itens", () => {
    for (const r of RELEASES) {
      const counts = Object.keys(LOCALES).map((l) => r.notes[l as keyof typeof LOCALES]?.length ?? 0);
      expect(new Set(counts).size, r.version).toBe(1);
      expect(counts[0], r.version).toBeGreaterThan(0);
    }
  });

  it("compara versões", () => {
    expect(cmpVersion("0.2.0", "0.1.6")).toBeGreaterThan(0);
    expect(cmpVersion("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(cmpVersion("1.0.0", "1.0.0")).toBe(0);
  });
});
