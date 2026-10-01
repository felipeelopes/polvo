// Barra de título personalizada (a janela não tem moldura do Windows).
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Preset } from "../core/layout";
import { store } from "../core/store";
import type { ToolKind, View } from "../core/types";
import { h } from "./dom";
import { ICON } from "./icons";
import { openUsage, renderRings } from "./usage";

export interface TitlebarHost {
  setView(v: View): void;
  preset(kind: Preset | "equal" | "undo"): void;
  openSettings(anchor: HTMLElement): void;
  openHelp(anchor: HTMLElement): void;
}

export class Titlebar {
  readonly el = h("header", "tb");
  private views: HTMLElement;
  private tools: HTMLElement;
  private rings: HTMLElement;
  private maxBtn: HTMLButtonElement;

  constructor(host: TitlebarHost) {
    const win = getCurrentWindow();
    this.el.innerHTML = `
      <div class="brand"><img src="/polvo.png" alt="">Polvo${store.isMain ? "" : " <small>Tela 2</small>"}</div>
      <div class="seg views">
        <button data-v="tiles" title="Painéis (Ctrl+Shift+1)">${ICON.tiles}Painéis</button>
        <button data-v="board" title="Quadro por status (Ctrl+Shift+2)">${ICON.board}Quadro</button>
      </div>
      <div class="tg layout-tools">
        <button data-p="grid" title="Organizar em grade">${ICON.grid}</button>
        <button data-p="main" title="Principal + pilha">${ICON.main}</button>
        <button data-p="cols" title="Colunas">${ICON.cols}</button>
        <button data-p="rows" title="Linhas">${ICON.rows}</button>
        <button data-p="equal" title="Igualar tamanhos">${ICON.equal}</button>
        <button data-p="undo" title="Desfazer layout (Ctrl+Shift+Z)">${ICON.undo}</button>
      </div>
      <div class="sp"></div>
      <div class="rings"></div>
      <button class="ibtn" data-pop data-x="help" title="Dicas e atalhos">${ICON.help}</button>
      <button class="ibtn" data-pop data-x="settings" title="Ajustes">${ICON.gear}</button>
      <button class="primary" data-new title="Ctrl+Shift+N">+ Nova sessão</button>
      <div class="wc">
        <button data-w="min" title="Minimizar">${ICON.winMin}</button>
        <button data-w="max" title="Maximizar">${ICON.winMax}</button>
        <button data-w="close" class="x" title="Fechar">${ICON.winClose}</button>
      </div>`;
    this.views = this.el.querySelector(".views")!;
    this.tools = this.el.querySelector(".layout-tools")!;
    this.rings = this.el.querySelector(".rings")!;
    this.maxBtn = this.el.querySelector('[data-w="max"]')!;

    this.el.addEventListener("click", (e) => {
      const t = e.target as Element;
      const v = t.closest<HTMLElement>("[data-v]")?.dataset.v as View | undefined;
      if (v) return host.setView(v);
      const p = t.closest<HTMLElement>("[data-p]");
      if (p && this.tools.contains(p)) return host.preset(p.dataset.p as Preset | "equal" | "undo");
      const ring = t.closest<HTMLElement>(".ur");
      if (ring) return openUsage(ring.dataset.p as ToolKind, ring);
      const x = t.closest<HTMLElement>("[data-x]");
      if (x?.dataset.x === "help") return host.openHelp(x);
      if (x?.dataset.x === "settings") return host.openSettings(x);
      const w = t.closest<HTMLElement>("[data-w]")?.dataset.w;
      if (w === "min") void win.minimize();
      if (w === "max") void win.toggleMaximize();
      if (w === "close") void win.close();
    });

    // Arrastar a janela pela barra (fora dos botões) e duplo clique para maximizar.
    this.el.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || (e.target as Element).closest("button")) return;
      if (e.detail === 2) void win.toggleMaximize();
      else void win.startDragging();
    });
    const syncMax = async () => {
      const max = await win.isMaximized();
      this.maxBtn.innerHTML = max ? ICON.winRestore : ICON.winMax;
      this.maxBtn.title = max ? "Restaurar" : "Maximizar";
    };
    void win.onResized(() => void syncMax());
    void syncMax();
  }

  render(): void {
    this.views.querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.v === store.view));
    this.tools.style.visibility = store.view === "tiles" ? "visible" : "hidden";
    renderRings(this.rings);
  }
}
