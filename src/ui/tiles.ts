// Visão Painéis: sessões encaixadas numa árvore de divisões, com arrastar e
// soltar, divisórias com ímã e alinhamento, e redimensionamento com mínimos.
import { ipc } from "../core/ipc";
import {
  clone,
  dividerCenter,
  fit,
  geometry,
  insertAt,
  leaves,
  neighbor,
  pairInfo,
  preset,
  removeLeaf,
  replaceLeaf,
  setBoundary,
  smartInsert,
  swapLeaves,
  equalize,
  GAP,
  type Divider,
  type Geometry,
  type Preset,
} from "../core/layout";
import { store } from "../core/store";
import type { LayoutNode, Rect, Side } from "../core/types";
import type { Terminals } from "../terminal/terminals";
import { h, inside } from "./dom";
import { toast } from "./feedback";
import { ICON, TOOLS, toolIcon } from "./icons";
import { logo } from "./logo";
import { Pane, type PaneHandlers } from "./pane";
import { t, tn } from "../i18n";

type DropTarget =
  | { kind: "rail" }
  | { kind: "empty" }
  | { kind: "edge"; side: Side }
  | { kind: "pane"; id: string; side: Side | "center"; rect: Rect };

/** Rótulo do alvo ao soltar sobre um painel (dividir num lado ou trocar). */
const sideLabel = (side: Side | "center"): string => t(`tiles.side.${side}`);
/** Rótulo do alvo ao soltar na borda da área (coluna/linha inteira). */
const edgeLabel = (side: Side): string => t(`tiles.edge.${side}`);

export interface TilesHost {
  terms: Terminals;
  handlers: PaneHandlers;
  rail(): HTMLElement;
  minimize(id: string): void;
}

export class TilesView {
  readonly el = h("div", "tiles");
  geo: Geometry = geometry(null, { x: 0, y: 0, w: 0, h: 0 });

  private panes = new Map<string, Pane>();
  private dividerEls: HTMLDivElement[] = [];
  private drop = h("div", "drop", "<span></span>");
  private compass = h("div", "compass", '<i class="t"></i><i class="l"></i><i class="c"></i><i class="r"></i><i class="b"></i>');
  private hintEl = h("div", "hint");
  private empty = h("div", "empty");
  private badge = h("div", "badge");
  private ghost = h("div", "ghost-chip");
  private guide = h("div", "guide");

  private resize: { node: Divider["node"]; index: number; horizontal: boolean; linked: { node: Divider["node"]; index: number }[]; origin: DOMRect; moved: boolean } | null = null;
  private drag: { id: string; fromRail: boolean; sx: number; sy: number; moved: boolean; target: DropTarget | null } | null = null;

  constructor(private host: TilesHost) {
    this.empty.innerHTML = `<div>${logo(88, "idle", { look: true })}<h3>${t("tiles.empty.title")}</h3>${t("tiles.empty.hint")}<br><button class="primary" data-new>${ICON.plus}${t("tiles.empty.newSession")}</button></div>`;
    this.compass.hidden = true;
    this.badge.hidden = true;
    this.ghost.hidden = true;
    this.guide.hidden = true;
    this.el.append(this.empty, this.drop, this.compass, this.hintEl, this.guide);
    document.body.append(this.badge, this.ghost);
    new ResizeObserver(() => this.layout()).observe(this.el);
    requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.add("anim")));
  }

  private area(): Rect {
    return { x: 0, y: 0, w: this.el.clientWidth, h: this.el.clientHeight };
  }

  /** Mantém a árvore igual ao conjunto de sessões visíveis desta janela. */
  reconcile(): void {
    const visible = store.mine.filter((s) => !s.minimized && store.inProject(s)).map((s) => s.id);
    let tree = clone(store.tree);
    let changed = false;
    for (const id of leaves(tree)) {
      if (!visible.includes(id)) {
        tree = removeLeaf(tree, id);
        changed = true;
      }
    }
    const present = new Set(leaves(tree));
    for (const id of visible) {
      if (present.has(id)) continue;
      const area = this.area();
      if (tree && area.w) fit(tree, area.w, area.h);
      tree = smartInsert(tree, geometry(tree, area).leaves, id);
      changed = true;
    }
    if (changed) store.setTree(tree, { undo: false });
    else this.layout();
  }

  layout(): void {
    const { w: W, h: H } = this.area();
    if (!W || !H) return;
    const tree = store.tree;
    if (tree) fit(tree, W, H);
    this.geo = geometry(tree, { x: 0, y: 0, w: W, h: H });
    if (store.zoom && !this.geo.leaves.has(store.zoom)) store.zoom = null;
    const live = this.el.classList.contains("live");

    for (const [id, p] of this.panes) {
      if (!this.geo.leaves.has(id) || !store.session(id)) {
        p.el.remove();
        this.panes.delete(id);
      }
    }
    for (const [id, base] of this.geo.leaves) {
      if (!store.session(id)) continue;
      let p = this.panes.get(id);
      if (!p) {
        p = new Pane(id, "tile", { ...this.host.handlers, headerDown: (e, pid) => this.startDrag(e, pid, false) });
        this.panes.set(id, p);
        this.el.insertBefore(p.el, this.drop);
      }
      const r = store.zoom === id ? { x: 0, y: 0, w: W, h: H } : base;
      Object.assign(p.el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      p.el.classList.toggle("zoomed", store.zoom === id);
      p.el.classList.toggle("dimmed", !!store.zoom && store.zoom !== id);
      p.el.classList.toggle("active", store.active === id);
      p.update();
      const t = this.host.terms.get(id);
      if (t && store.view === "tiles") t.mount(p.body);
      if (live && t) p.setSizeLabel(`${t.term.cols} × ${t.term.rows}`);
    }
    if (store.view === "tiles") {
      for (const s of store.mine) if (!this.geo.leaves.has(s.id)) this.host.terms.get(s.id)?.park();
    }

    this.geo.dividers.forEach((d, i) => {
      let el = this.dividerEls[i];
      if (!el) {
        el = h("div");
        el.addEventListener("pointerdown", (e) => this.startResize(e, Number(el.dataset.i)));
        el.addEventListener("dblclick", () => this.equalizeNode(Number(el.dataset.i)));
        el.title = t("tiles.dividerHint");
        this.el.appendChild(el);
        this.dividerEls[i] = el;
      }
      el.dataset.i = String(i);
      el.hidden = !!store.zoom;
      const act = this.resize && d.node === this.resize.node && d.index === this.resize.index;
      const linked = this.resize?.linked.some((l) => l.node === d.node && l.index === d.index);
      el.className = `dv dv-${d.dir}${act ? " act" : ""}${linked ? " linked" : ""}`;
      Object.assign(el.style, { left: `${d.rect.x}px`, top: `${d.rect.y}px`, width: `${d.rect.w}px`, height: `${d.rect.h}px` });
    });
    this.dividerEls.splice(this.geo.dividers.length).forEach((el) => el.remove());
    this.empty.hidden = !!tree;
  }

  pane(id: string): Pane | undefined {
    return this.panes.get(id);
  }

  updatePanes(): void {
    this.panes.forEach((p) => p.update());
  }

  flash(id: string): void {
    const el = this.panes.get(id)?.el;
    if (!el) return;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }

  // ------------------------------------------------------------ facilitadores

  applyPreset(kind: Preset | "equal"): void {
    if (!store.tree) return;
    store.zoom = null;
    if (kind === "equal") {
      const tree = clone(store.tree);
      equalize(tree);
      store.setTree(tree);
    } else {
      store.setTree(preset(leaves(store.tree), kind));
    }
  }

  undo(): void {
    const u = store.popUndo();
    if (!u) return toast(t("tiles.nothingToUndo"));
    store.zoom = null;
    for (const s of store.mine) {
      const min = u.minimized.includes(s.id);
      if (s.minimized !== min) {
        store.patchLocal(s.id, { minimized: min });
        ipc.sessionUpdate(s.id, { minimized: min }).catch(() => {});
      }
    }
    store.setTree(u.tree, { undo: false });
    toast(t("tiles.undone"));
  }

  focusNeighbor(dx: number, dy: number, move: boolean): void {
    if (!store.active) return;
    const other = neighbor(this.geo.leaves, store.active, dx, dy);
    if (!other) return;
    if (move) {
      store.setTree(swapLeaves(clone(store.tree), store.active, other));
      this.flash(store.active);
    } else {
      store.setActive(other);
      this.host.terms.get(other)?.focus();
      this.flash(other);
    }
  }

  private equalizeNode(i: number): void {
    const d = this.geo.dividers[i];
    if (!d) return;
    store.pushUndo();
    d.node.sizes = d.node.sizes.map(() => 1 / d.node.sizes.length);
    store.setTree(store.tree, { undo: false });
    toast(t("tiles.equalized"));
  }

  // ------------------------------------------------------------ divisórias

  private startResize(e: PointerEvent, i: number): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const d = this.geo.dividers[i];
    const c = dividerCenter(d);
    const linked = e.altKey
      ? []
      : this.geo.dividers.filter((o) => o !== d && o.dir === d.dir && Math.abs(dividerCenter(o) - c) < 3).map((o) => ({ node: o.node, index: o.index }));
    store.pushUndo();
    this.resize = { node: d.node, index: d.index, horizontal: d.dir === "row", linked, origin: this.el.getBoundingClientRect(), moved: false };
    this.el.classList.add("live");
    document.body.style.cursor = this.resize.horizontal ? "col-resize" : "row-resize";
    if (linked.length) this.hint(tn("tiles.linkedDividers", linked.length + 1));
    const move = (ev: PointerEvent) => this.onResize(ev);
    addEventListener("pointermove", move);
    addEventListener(
      "pointerup",
      () => {
        removeEventListener("pointermove", move);
        this.endResize();
      },
      { once: true },
    );
    this.layout();
  }

  private onResize(e: PointerEvent): void {
    const rs = this.resize!;
    rs.moved = true;
    const p = rs.horizontal ? e.clientX - rs.origin.left : e.clientY - rs.origin.top;
    const { rect, start, len, total } = pairInfo(this.geo, rs.node, rs.index);
    const pair = total * len;
    const candidates = [
      { p: start + pair / 3 + GAP / 2, label: "⅓" },
      { p: start + pair / 2 + GAP / 2, label: "½" },
      { p: start + (pair * 2) / 3 + GAP / 2, label: "⅔" },
    ];
    for (const o of this.geo.dividers) {
      const same = (o.node === rs.node && o.index === rs.index) || rs.linked.some((l) => l.node === o.node && l.index === o.index);
      if (!same && o.dir === (rs.horizontal ? "row" : "col")) candidates.push({ p: dividerCenter(o), label: t("tiles.align") });
    }
    let best: { p: number; label: string; dist: number } | null = null;
    for (const c of candidates) {
      const dist = Math.abs(c.p - p);
      if (dist < 10 && (!best || dist < best.dist)) best = { ...c, dist };
    }
    const b = best ? best.p : p;
    setBoundary(this.geo, rs.node, rs.index, b);
    for (const l of rs.linked) setBoundary(this.geo, l.node, l.index, b);
    this.layout();

    const sum = rs.node.sizes[rs.index] + rs.node.sizes[rs.index + 1];
    const pa = Math.round((rs.node.sizes[rs.index] / sum) * 100);
    this.badge.hidden = false;
    this.badge.innerHTML = `${pa}% <b>|</b> ${100 - pa}%${best ? ` · <b>${best.label}</b>` : ""}`;
    this.badge.style.left = `${e.clientX + 16}px`;
    this.badge.style.top = `${e.clientY + 16}px`;
    this.guide.hidden = !best;
    if (best) {
      this.guide.className = `guide ${rs.horizontal ? "v" : "h"}`;
      Object.assign(
        this.guide.style,
        rs.horizontal
          ? { left: `${b - 1}px`, top: `${rect.y}px`, height: `${rect.h}px`, width: "" }
          : { top: `${b - 1}px`, left: `${rect.x}px`, width: `${rect.w}px`, height: "" },
      );
    }
  }

  private endResize(): void {
    const moved = this.resize?.moved;
    this.resize = null;
    this.el.classList.remove("live");
    document.body.style.cursor = "";
    this.badge.hidden = true;
    this.guide.hidden = true;
    this.hint();
    if (!moved) store.dropUndo();
    store.setTree(store.tree, { undo: false });
  }

  // ------------------------------------------------------------ arrastar painéis

  startDrag(e: PointerEvent, id: string, fromRail: boolean): void {
    if (e.button !== 0) return;
    this.drag = { id, fromRail, sx: e.clientX, sy: e.clientY, moved: false, target: null };
    const move = (ev: PointerEvent) => this.onDrag(ev);
    addEventListener("pointermove", move);
    addEventListener(
      "pointerup",
      () => {
        removeEventListener("pointermove", move);
        this.endDrag();
      },
      { once: true },
    );
  }

  private onDrag(e: PointerEvent): void {
    const d = this.drag!;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
      d.moved = true;
      if (store.zoom) {
        store.zoom = null;
        this.layout();
      }
      const s = store.session(d.id)!;
      this.ghost.style.setProperty("--acc", TOOLS[s.tool].color);
      this.ghost.innerHTML = `${toolIcon(s.tool, 15)}<b></b>`;
      this.ghost.querySelector("b")!.textContent = s.title;
      this.ghost.hidden = false;
      this.panes.get(d.id)?.el.classList.add("lifting");
      document.body.classList.add("grabbing");
      this.hint(t("tiles.dragHint"));
    }
    this.ghost.style.left = `${e.clientX}px`;
    this.ghost.style.top = `${e.clientY}px`;
    d.target = this.hitTest(e);
    this.showDrop(d.target);
  }

  private hitTest(e: PointerEvent): DropTarget | null {
    if (inside(e, this.host.rail().getBoundingClientRect())) return { kind: "rail" };
    const b = this.el.getBoundingClientRect();
    if (!inside(e, b)) return null;
    const px = e.clientX - b.left;
    const py = e.clientY - b.top;
    const others = [...this.geo.leaves.keys()].filter((id) => id !== this.drag!.id);
    if (!others.length) return { kind: "empty" };
    const edge = 22;
    if (px < edge) return { kind: "edge", side: "left" };
    if (px > b.width - edge) return { kind: "edge", side: "right" };
    if (py < edge) return { kind: "edge", side: "top" };
    if (py > b.height - edge) return { kind: "edge", side: "bottom" };
    for (const id of others) {
      const r = this.geo.leaves.get(id)!;
      if (px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) continue;
      const rx = (px - r.x) / r.w;
      const ry = (py - r.y) / r.h;
      const side =
        rx > 0.3 && rx < 0.7 && ry > 0.3 && ry < 0.7
          ? "center"
          : ([["left", rx], ["right", 1 - rx], ["top", ry], ["bottom", 1 - ry]] as [Side, number][]).sort((a, c) => a[1] - c[1])[0][0];
      return { kind: "pane", id, side, rect: r };
    }
    return null;
  }

  private showDrop(dt: DropTarget | null): void {
    const s = store.session(this.drag!.id);
    // Classe própria: "drop" é a camada de pré-visualização e mudaria o layout do trilho.
    this.host.rail().classList.toggle("rail-drop", dt?.kind === "rail" && !s?.minimized);
    this.compass.hidden = dt?.kind !== "pane";
    if (!dt || dt.kind === "rail") {
      this.drop.classList.remove("on");
      return;
    }
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    let r: Rect;
    let label: string;
    if (dt.kind === "empty") {
      r = { x: 0, y: 0, w: W, h: H };
      label = t("tiles.openHere");
    } else if (dt.kind === "edge") {
      const f = 0.32;
      label = edgeLabel(dt.side);
      r = {
        left: { x: 0, y: 0, w: W * f, h: H },
        right: { x: W * (1 - f), y: 0, w: W * f, h: H },
        top: { x: 0, y: 0, w: W, h: H * f },
        bottom: { x: 0, y: H * (1 - f), w: W, h: H * f },
      }[dt.side];
    } else {
      const p = dt.rect;
      label = sideLabel(dt.side);
      r = {
        left: { x: p.x, y: p.y, w: p.w / 2, h: p.h },
        right: { x: p.x + p.w / 2, y: p.y, w: p.w / 2, h: p.h },
        top: { x: p.x, y: p.y, w: p.w, h: p.h / 2 },
        bottom: { x: p.x, y: p.y + p.h / 2, w: p.w, h: p.h / 2 },
        center: p,
      }[dt.side];
      this.compass.style.left = `${p.x + p.w / 2}px`;
      this.compass.style.top = `${p.y + p.h / 2}px`;
      const cls = { top: "t", left: "l", center: "c", right: "r", bottom: "b" }[dt.side];
      this.compass.querySelectorAll("i").forEach((i) => i.classList.toggle("on", i.classList.contains(cls)));
    }
    Object.assign(this.drop.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    this.drop.querySelector("span")!.textContent = label;
    this.drop.classList.add("on");
  }

  private endDrag(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    this.ghost.hidden = true;
    this.compass.hidden = true;
    this.drop.classList.remove("on");
    this.host.rail().classList.remove("rail-drop");
    document.body.classList.remove("grabbing");
    this.hint();
    this.panes.get(d.id)?.el.classList.remove("lifting");
    if (!d.moved) {
      if (d.fromRail) this.host.handlers.action("open", d.id);
      return;
    }
    if (d.target) this.applyDrop(d.id, d.target);
  }

  private applyDrop(id: string, dt: DropTarget): void {
    const s = store.session(id);
    if (!s) return;
    const inTree = leaves(store.tree).includes(id);
    if (dt.kind === "rail") {
      if (inTree) this.host.minimize(id);
      return;
    }
    store.pushUndo();
    store.zoom = null;
    let tree: LayoutNode | null = clone(store.tree);
    if (dt.kind === "empty") {
      tree = { type: "leaf", id };
    } else if (dt.kind === "edge") {
      if (inTree) tree = removeLeaf(tree, id);
      tree = insertAt(tree, null, id, dt.side);
    } else if (dt.side === "center") {
      if (inTree) tree = swapLeaves(tree, id, dt.id);
      else {
        tree = replaceLeaf(tree, dt.id, id);
        store.patchLocal(dt.id, { minimized: true });
        ipc.sessionUpdate(dt.id, { minimized: true }).catch(() => {});
        toast(t("tiles.sentToRail", { title: store.session(dt.id)?.title ?? "" }));
      }
    } else {
      if (inTree) tree = removeLeaf(tree, id);
      tree = insertAt(tree, dt.id, id, dt.side);
    }
    if (s.minimized) {
      store.patchLocal(id, { minimized: false });
      ipc.sessionUpdate(id, { minimized: false }).catch(() => {});
    }
    store.setTree(tree, { undo: false });
    store.setActive(id);
    window.setTimeout(() => this.flash(id), 200);
  }

  private hint(text = ""): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle("on", !!text);
  }
}
