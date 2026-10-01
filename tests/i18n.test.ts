import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keysOf, LOCALES, type Locale } from "../src/i18n";
import pt from "../src/i18n/locales/pt";

type Catalog = { [k: string]: string | Catalog };

function flatten(cat: Catalog, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(cat)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else flatten(v, key, out);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (s: string) => [...s.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]).sort();
const source = flatten(pt as Catalog);
const locales = Object.keys(LOCALES).filter((l) => l !== "pt") as Locale[];

describe("traduções da interface", () => {
  for (const l of locales) {
    it(`${l}: tem todas as chaves, com os mesmos {marcadores} e tags`, async () => {
      const cat = flatten((await import(`../src/i18n/locales/${l}.ts`)).default as Catalog);
      const missing = [...source.keys()].filter((k) => !cat.has(k) && !(k.endsWith(".one") && cat.has(k.replace(/\.one$/, ".other"))));
      expect(missing).toEqual([]);
      for (const [k, v] of cat) {
        const base = source.get(k) ?? source.get(k.replace(/\.(few|many)$/, ".other"));
        if (base === undefined) continue;
        expect(placeholders(v).filter((p) => p !== "n"), `${l}:${k}`).toEqual(placeholders(base).filter((p) => p !== "n"));
        expect(tags(v), `${l}:${k}`).toEqual(tags(base));
      }
    });
  }

  it("não sobra chave só no idioma traduzido", () => {
    for (const l of locales) {
      const extra = keysOf(l).filter((k) => !source.has(k) && !/\.(few|many)$/.test(k));
      expect(extra, l).toEqual([]);
    }
  });
});

describe("traduções do backend", () => {
  const read = (l: string) => JSON.parse(readFileSync(`src-tauri/i18n/${l}.json`, "utf8")) as Record<string, string>;
  const base = read("pt");
  for (const l of locales) {
    it(`${l}: mesmas chaves e marcadores`, () => {
      const cat = read(l);
      expect(Object.keys(cat).sort()).toEqual(Object.keys(base).sort());
      for (const k of Object.keys(base)) expect(placeholders(cat[k]), `${l}:${k}`).toEqual(placeholders(base[k]));
      expect(cat["usage.windowHoursShort"]).toBe("{n}h");
    });
  }
});
