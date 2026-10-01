// Barra de título personalizada (a janela não tem moldura do Windows).
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Preset } from "../core/layout";
import { store } from "../core/store";
import type { ToolKind, View } from "../core/types";
import { esc, h } from "./dom";
import { ICON } from "./icons";
import { logo } from "./logo";
import { availableUpdate, onUpdateAvailable, showUpdate } from "./updater";
import { openUsage, renderRings } from "./usage";

export interface TitlebarHost {
  setView(v: View): void;
  preset(kind: Preset | "equal" | "undo"): void;
  openSettings(anchor: HTMLElement): void;
  openHelp(anchor: HTMLElement): void;
  newWindow(): void;
  openAbout(): void;
  openMonitors(anchor: HTMLElement): void;
  projectMenu(anchor: HTMLElement): void;
  clearProject(): void;
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
      <button class="brand" data-x="about" title="Sobre o Polvo">${logo(24, "still")}<span class="bn">Polvo</span> <small class="wname"></small></button>
      <div class="seg views">
        <button data-v="tiles" title="Painéis (Ctrl+Shift+1)">${ICON.tiles}<span class="lbl-v">Painéis</span></button>
        <button data-v="board" title="Quadro por status (Ctrl+Shift+2)">${ICON.board}<span class="lbl-v">Quadro</span></button>
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
      <button class="pchip" data-x="unfocus" hidden></button>
      <div class="rings"></div>
      <button class="ibtn" data-x="window" title="Nova janela (abre em outro monitor, se houver)">${ICON.window}</button>
      <button class="ibtn" data-pop data-x="monitor" title="Levar esta janela para outro monitor">${ICON.monitor}</button>
      <button class="ibtn" data-pop data-x="help" title="Dicas e atalhos">${ICON.help}</button>
      <button class="ibtn" data-pop data-x="settings" title="Ajustes">${ICON.gear}</button>
      <button class="upd-pill" data-x="update" hidden></button>
      <button class="primary new-btn" data-x="projects" title="Abrir projeto, novo projeto, clonar repositório · Ctrl+Shift+N abre sessão no projeto em foco">+<span class="lbl-n"> Projeto</span></button>
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
      if (x?.dataset.x === "window") return host.newWindow();
      if (x?.dataset.x === "about") return host.openAbout();
      if (x?.dataset.x === "update") return showUpdate();
      if (x?.dataset.x === "monitor") return host.openMonitors(x);
      if (x?.dataset.x === "projects") return host.projectMenu(x);
      if (x?.dataset.x === "unfocus") return host.clearProject();
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
    onUpdateAvailable(() => this.renderUpdate());
    this.renderUpdate();
  }

  /** Selo "Atualizar para vX" quando há versão nova. */
  private renderUpdate(): void {
    const pill = this.el.querySelector<HTMLButtonElement>(".upd-pill")!;
    const v = availableUpdate();
    pill.hidden = !v;
    if (v) {
      pill.innerHTML = `${ICON.update}<span>Atualizar para v${v}</span>`;
      pill.title = `Polvo ${v} disponível — clique para ver as novidades e atualizar`;
    }
  }

  render(): void {
    this.views.querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.v === store.view));
    this.tools.style.visibility = store.view === "tiles" ? "visible" : "hidden";
    renderRings(this.rings);
    const chip = this.el.querySelector<HTMLElement>(".pchip")!;
    chip.hidden = !store.project;
    if (store.project) {
      chip.innerHTML = `${ICON.focus}<span>${esc(store.projectName)}</span>${ICON.close}`;
      chip.title = "Mostrando só este projeto — clique para ver todos";
    }
    const many = store.windows.length > 1;
    this.el.querySelector<HTMLElement>(".wname")!.textContent = many ? `· ${store.myName}` : "";
  }
}
