import { describe, expect, it } from "vitest";
import { fit, geometry, insertAt, leaves, MIN_W, normalize, preset, removeLeaf, setBoundary, smartInsert, swapLeaves } from "../src/core/layout";
import type { LayoutNode } from "../src/core/types";

const L = (id: string): LayoutNode => ({ type: "leaf", id });
const area = { x: 0, y: 0, w: 1200, h: 800 };

describe("layout", () => {
  it("insere ao lado criando uma divisão", () => {
    const t = insertAt(L("a"), "a", "b", "right");
    expect(t).toMatchObject({ type: "split", dir: "row", sizes: [0.5, 0.5] });
    expect(leaves(t)).toEqual(["a", "b"]);
  });

  it("reaproveita a divisão quando a direção é a mesma", () => {
    let t = insertAt(L("a"), "a", "b", "right");
    t = insertAt(t, "b", "c", "right");
    expect(t.type === "split" && t.children.length).toBe(3);
    expect(leaves(t)).toEqual(["a", "b", "c"]);
  });

  it("insere na borda da área inteira", () => {
    const t = insertAt(insertAt(L("a"), "a", "b", "bottom"), null, "c", "left");
    expect(t).toMatchObject({ type: "split", dir: "row" });
    expect(leaves(t)).toEqual(["c", "a", "b"]);
  });

  it("remove e colapsa divisões de um filho só", () => {
    const t = insertAt(insertAt(L("a"), "a", "b", "right"), "b", "c", "bottom");
    const r = removeLeaf(t, "c");
    expect(r).toMatchObject({ type: "split", dir: "row" });
    expect(leaves(r)).toEqual(["a", "b"]);
    expect(removeLeaf(removeLeaf(r, "a"), "b")).toBeNull();
  });

  it("normaliza divisões aninhadas na mesma direção", () => {
    const t = normalize({ type: "split", dir: "row", sizes: [0.5, 0.5], children: [L("a"), { type: "split", dir: "row", sizes: [0.5, 0.5], children: [L("b"), L("c")] }] });
    expect(t).toMatchObject({ type: "split", sizes: [0.5, 0.25, 0.25] });
  });

  it("troca dois painéis de lugar", () => {
    const t = swapLeaves(insertAt(L("a"), "a", "b", "right"), "a", "b");
    expect(leaves(t)).toEqual(["b", "a"]);
  });

  it("garante tamanho mínimo ao encaixar", () => {
    const t: LayoutNode = { type: "split", dir: "row", sizes: [0.9, 0.05, 0.05], children: [L("a"), L("b"), L("c")] };
    fit(t, area.w, area.h);
    const g = geometry(t, area);
    for (const r of g.leaves.values()) expect(r.w).toBeGreaterThanOrEqual(MIN_W - 0.5);
  });

  it("a divisória respeita o mínimo dos vizinhos", () => {
    const t = insertAt(L("a"), "a", "b", "right");
    const g = geometry(t, area);
    const d = g.dividers[0];
    setBoundary(g, d.node, d.index, 10);
    const g2 = geometry(t, area);
    expect(g2.leaves.get("a")!.w).toBeGreaterThanOrEqual(MIN_W - 0.5);
  });

  it("presets organizam todas as sessões", () => {
    const ids = ["a", "b", "c", "d", "e"];
    for (const k of ["grid", "main", "cols", "rows"] as const) expect(leaves(preset(ids, k)).sort()).toEqual(ids);
  });

  it("nova sessão divide o maior painel", () => {
    const t = insertAt(L("a"), "a", "b", "right");
    const g = geometry(t, area);
    const r = smartInsert(t, g.leaves, "c");
    expect(leaves(r)).toHaveLength(3);
  });
});
