// Motor de layout: árvore de divisões (como tmux / grupos de editor do VS Code).
// Funções puras sobre `LayoutNode`, sem DOM — cobertas por tests/layout.test.ts.
import type { LayoutNode, Rect, Side, SplitDir } from "./types";

export const GAP = 8;
export const MIN_W = 280;
export const MIN_H = 160;

type Split = Extract<LayoutNode, { type: "split" }>;

export interface Divider {
  node: Split;
  index: number;
  dir: SplitDir;
  rect: Rect;
}

export interface Geometry {
  leaves: Map<string, Rect>;
  dividers: Divider[];
  nodes: Map<LayoutNode, Rect>;
}

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });

export function leaves(n: LayoutNode | null, out: string[] = []): string[] {
  if (!n) return out;
  if (n.type === "leaf") out.push(n.id);
  else n.children.forEach((c) => leaves(c, out));
  return out;
}

export function findLeaf(n: LayoutNode | null, id: string, parent: Split | null = null): { node: LayoutNode; parent: Split | null } | null {
  if (!n) return null;
  if (n.type === "leaf") return n.id === id ? { node: n, parent } : null;
  for (const c of n.children) {
    const r = findLeaf(c, id, n);
    if (r) return r;
  }
  return null;
}

/** Remove divisões de um filho só e junta divisões na mesma direção. */
export function normalize(n: LayoutNode | null): LayoutNode | null {
  if (!n || n.type === "leaf") return n;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  n.children.forEach((raw, i) => {
    const c = normalize(raw)!;
    if (c.type === "split" && c.dir === n.dir) {
      c.children.forEach((cc, j) => {
        children.push(cc);
        sizes.push(c.sizes[j] * n.sizes[i]);
      });
    } else {
      children.push(c);
      sizes.push(n.sizes[i]);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return { type: "split", dir: n.dir, children, sizes: sizes.map((s) => s / total) };
}

export function removeLeaf(tree: LayoutNode | null, id: string): LayoutNode | null {
  const f = findLeaf(tree, id);
  if (!f) return tree;
  if (!f.parent) return null;
  const i = f.parent.children.indexOf(f.node);
  f.parent.children.splice(i, 1);
  f.parent.sizes.splice(i, 1);
  return normalize(tree);
}

/** Insere `id` ao lado de `target` (ou na borda da área inteira, se `target` for null). */
export function insertAt(tree: LayoutNode | null, target: string | null, id: string, side: Side): LayoutNode {
  const node = leaf(id);
  if (!tree) return node;
  const dir: SplitDir = side === "left" || side === "right" ? "row" : "col";
  const first = side === "left" || side === "top";
  if (target === null) {
    return normalize({ type: "split", dir, children: first ? [node, tree] : [tree, node], sizes: first ? [0.32, 0.68] : [0.68, 0.32] })!;
  }
  const f = findLeaf(tree, target);
  if (!f) return insertAt(tree, null, id, side);
  if (f.parent && f.parent.dir === dir) {
    const p = f.parent;
    const i = p.children.indexOf(f.node);
    const half = p.sizes[i] / 2;
    const at = first ? i : i + 1;
    p.sizes[i] = half;
    p.children.splice(at, 0, node);
    p.sizes.splice(at, 0, half);
    return normalize(tree)!;
  }
  const split: LayoutNode = { type: "split", dir, children: first ? [node, f.node] : [f.node, node], sizes: [0.5, 0.5] };
  if (!f.parent) return split;
  f.parent.children[f.parent.children.indexOf(f.node)] = split;
  return normalize(tree)!;
}

export function swapLeaves(tree: LayoutNode | null, a: string, b: string): LayoutNode | null {
  const A = findLeaf(tree, a)?.node;
  const B = findLeaf(tree, b)?.node;
  if (A?.type === "leaf" && B?.type === "leaf") {
    A.id = b;
    B.id = a;
  }
  return tree;
}

export function replaceLeaf(tree: LayoutNode | null, oldId: string, newId: string): LayoutNode | null {
  const f = findLeaf(tree, oldId)?.node;
  if (f?.type === "leaf") f.id = newId;
  return tree;
}

export function minSize(n: LayoutNode, horizontal: boolean): number {
  if (n.type === "leaf") return horizontal ? MIN_W : MIN_H;
  const mins = n.children.map((c) => minSize(c, horizontal));
  return (n.dir === "row") === horizontal ? mins.reduce((a, b) => a + b, 0) + GAP * (mins.length - 1) : Math.max(...mins);
}

/** Garante o tamanho mínimo de cada painel, tirando espaço de quem tem sobra. */
export function fit(n: LayoutNode, w: number, h: number): void {
  if (n.type === "leaf") return;
  const horizontal = n.dir === "row";
  const len = (horizontal ? w : h) - GAP * (n.children.length - 1);
  const mins = n.children.map((c) => minSize(c, horizontal) / len);
  if (mins.reduce((a, b) => a + b, 0) <= 1) {
    let deficit = 0;
    n.sizes = n.sizes.map((s, i) => {
      if (s < mins[i]) {
        deficit += mins[i] - s;
        return mins[i];
      }
      return s;
    });
    if (deficit > 0) {
      const slack = n.sizes.map((s, i) => Math.max(0, s - mins[i]));
      const total = slack.reduce((a, b) => a + b, 0) || 1;
      n.sizes = n.sizes.map((s, i) => s - (deficit * slack[i]) / total);
    }
  }
  n.children.forEach((c, i) => fit(c, horizontal ? n.sizes[i] * len : w, horizontal ? h : n.sizes[i] * len));
}

export function geometry(tree: LayoutNode | null, area: Rect): Geometry {
  const g: Geometry = { leaves: new Map(), dividers: [], nodes: new Map() };
  const walk = (n: LayoutNode, r: Rect) => {
    g.nodes.set(n, r);
    if (n.type === "leaf") {
      g.leaves.set(n.id, r);
      return;
    }
    const horizontal = n.dir === "row";
    const len = (horizontal ? r.w : r.h) - GAP * (n.children.length - 1);
    let pos = horizontal ? r.x : r.y;
    n.children.forEach((c, i) => {
      const size = len * n.sizes[i];
      walk(c, horizontal ? { x: pos, y: r.y, w: size, h: r.h } : { x: r.x, y: pos, w: r.w, h: size });
      pos += size;
      if (i < n.children.length - 1) {
        g.dividers.push({
          node: n,
          index: i,
          dir: n.dir,
          rect: horizontal ? { x: pos, y: r.y, w: GAP, h: r.h } : { x: r.x, y: pos, w: r.w, h: GAP },
        });
        pos += GAP;
      }
    });
  };
  if (tree) walk(tree, area);
  return g;
}

export const dividerCenter = (d: Divider) => (d.dir === "row" ? d.rect.x : d.rect.y) + GAP / 2;

/** Posição de um par de vizinhos dentro da divisão. */
export function pairInfo(g: Geometry, node: Split, index: number) {
  const r = g.nodes.get(node)!;
  const horizontal = node.dir === "row";
  const len = (horizontal ? r.w : r.h) - GAP * (node.children.length - 1);
  let start = horizontal ? r.x : r.y;
  for (let j = 0; j < index; j++) start += node.sizes[j] * len + GAP;
  return { rect: r, horizontal, len, start, total: node.sizes[index] + node.sizes[index + 1] };
}

/** Move a divisória `index` de `node` para a coordenada `b` (respeitando mínimos). */
export function setBoundary(g: Geometry, node: Split, index: number, b: number): void {
  const { horizontal, len, start, total } = pairInfo(g, node, index);
  const minA = minSize(node.children[index], horizontal) / len;
  const minB = minSize(node.children[index + 1], horizontal) / len;
  if (minA > total - minB) return;
  const a = Math.max(minA, Math.min(total - minB, (b - GAP / 2 - start) / len));
  node.sizes[index] = a;
  node.sizes[index + 1] = total - a;
}

export function equalize(n: LayoutNode | null, deep = true): void {
  if (!n || n.type === "leaf") return;
  n.sizes = n.sizes.map(() => 1 / n.sizes.length);
  if (deep) n.children.forEach((c) => equalize(c));
}

export type Preset = "grid" | "main" | "cols" | "rows";

export function preset(ids: string[], kind: Preset): LayoutNode | null {
  if (!ids.length) return null;
  const split = (dir: SplitDir, ch: LayoutNode[]): LayoutNode =>
    ch.length === 1 ? ch[0] : { type: "split", dir, children: ch, sizes: ch.map(() => 1 / ch.length) };
  switch (kind) {
    case "cols":
      return split("row", ids.map(leaf));
    case "rows":
      return split("col", ids.map(leaf));
    case "main":
      return ids.length === 1
        ? leaf(ids[0])
        : { type: "split", dir: "row", sizes: [0.6, 0.4], children: [leaf(ids[0]), split("col", ids.slice(1).map(leaf))] };
    case "grid": {
      const cols = Math.ceil(Math.sqrt(ids.length));
      const rows: LayoutNode[] = [];
      for (let i = 0; i < ids.length; i += cols) rows.push(split("row", ids.slice(i, i + cols).map(leaf)));
      return split("col", rows);
    }
  }
}

/** Onde colocar um painel novo: divide o maior painel no eixo mais longo. */
export function smartInsert(tree: LayoutNode | null, rects: Map<string, Rect>, id: string): LayoutNode {
  let best: { id: string; r: Rect } | null = null;
  for (const [k, r] of rects) if (!best || r.w * r.h > best.r.w * best.r.h) best = { id: k, r };
  if (!tree || !best) return tree ? insertAt(tree, null, id, "right") : leaf(id);
  return insertAt(tree, best.id, id, best.r.w >= best.r.h * 1.05 ? "right" : "bottom");
}

/** Painel vizinho na direção indicada (para navegar com o teclado). */
export function neighbor(rects: Map<string, Rect>, from: string, dx: number, dy: number): string | null {
  const a = rects.get(from);
  if (!a) return null;
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  let best: { id: string; d: number } | null = null;
  for (const [id, r] of rects) {
    if (id === from) continue;
    const ox = r.x + r.w / 2 - cx;
    const oy = r.y + r.h / 2 - cy;
    if ((dx && Math.sign(ox) !== dx) || (dy && Math.sign(oy) !== dy)) continue;
    if (dx && (r.y >= a.y + a.h || r.y + r.h <= a.y)) continue;
    if (dy && (r.x >= a.x + a.w || r.x + r.w <= a.x)) continue;
    const d = Math.abs(ox) + Math.abs(oy);
    if (!best || d < best.d) best = { id, d };
  }
  return best?.id ?? null;
}

export const clone = (t: LayoutNode | null): LayoutNode | null => (t ? (JSON.parse(JSON.stringify(t)) as LayoutNode) : null);
