// Barra de título personalizada (a janela não tem moldura do Windows).
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Preset } from "../core/layout";
import { normPath, store } from "../core/store";
import type { ToolKind, View } from "../core/types";
import { t } from "../i18n";
import { esc, h } from "./dom";
import { ICON } from "./icons";
import { mountBrand } from "./brand";
import { logo } from "./logo";
import { availableUpdate, onUpdateAvailable, showUpdate } from "./updater";
import { openUsage, renderRings } from "./usage";

export interface TitlebarHost {
  setView(v: View): void;
  preset(kind: Preset | "equal" | "undo"): void;
  openSettings(anchor: HTMLElement): void;
  openHelp(anchor: HTMLElement): void;
  openAbout(): void;
  openMonitors(anchor: HTMLElement): void;
  projectMenu(anchor: HTMLElement): void;
  clearProject(): void;
  openGit(): void;
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
      <button class="brand" data-x="about" title="${t("titlebar.about")}">${logo(24, "still")}<span class="bn">Polvo</span> <small class="wname"></small></button>
      <div class="seg views">
        <button data-v="tiles" title="${t("titlebar.tilesHint")}">${ICON.tiles}<span class="lbl-v">${t("titlebar.tiles")}</span></button>
        <button data-v="board" title="${t("titlebar.boardHint")}">${ICON.board}<span class="lbl-v">${t("titlebar.board")}</span></button>
        <button data-v="work" title="${t("titlebar.workHint")}">${ICON.work}<span class="lbl-v">${t("titlebar.work")}</span></button>
      </div>
      <div class="tg layout-tools">
        <button data-p="grid" title="${t("titlebar.presets.grid")}">${ICON.grid}</button>
        <button data-p="main" title="${t("titlebar.presets.main")}">${ICON.main}</button>
        <button data-p="cols" title="${t("titlebar.presets.cols")}">${ICON.cols}</button>
        <button data-p="rows" title="${t("titlebar.presets.rows")}">${ICON.rows}</button>
        <button data-p="equal" title="${t("titlebar.presets.equal")}">${ICON.equal}</button>
        <button data-p="undo" title="${t("titlebar.presets.undo")}">${ICON.undo}</button>
      </div>
      <div class="sp"></div>
      <button class="pchip" data-x="unfocus" hidden></button>
      <button class="gchip" data-x="git" hidden></button>
      <div class="rings"></div>
      <button class="ibtn" data-pop data-x="monitor" title="${t("titlebar.monitor")}">${ICON.monitor}</button>
      <button class="ibtn" data-pop data-x="help" title="${t("titlebar.help")}">${ICON.help}</button>
      <button class="ibtn" data-pop data-x="settings" title="${t("titlebar.settings")}">${ICON.gear}</button>
      <button class="upd-pill" data-x="update" hidden></button>
      <button class="primary new-btn" data-x="projects" title="${t("titlebar.projects")}">${ICON.plus}<span class="lbl-n">${t("titlebar.projectBtn")}</span></button>
      <div class="wc">
        <button data-w="min" title="${t("titlebar.minimize")}">${ICON.winMin}</button>
        <button data-w="max" title="${t("titlebar.maximize")}">${ICON.winMax}</button>
        <button data-w="close" class="x" title="${t("titlebar.close")}">${ICON.winClose}</button>
      </div>`;
    this.views = this.el.querySelector(".views")!;
    this.tools = this.el.querySelector(".layout-tools")!;
    this.rings = this.el.querySelector(".rings")!;
    this.maxBtn = this.el.querySelector('[data-w="max"]')!;
    mountBrand(this.el.querySelector(".brand")!);

    this.el.addEventListener("click", (e) => {
      const tg = e.target as Element;
      const v = tg.closest<HTMLElement>("[data-v]")?.dataset.v as View | undefined;
      if (v) return host.setView(v);
      const p = tg.closest<HTMLElement>("[data-p]");
      if (p && this.tools.contains(p)) return host.preset(p.dataset.p as Preset | "equal" | "undo");
      const ring = tg.closest<HTMLElement>(".ur");
      if (ring) return openUsage(ring.dataset.p as ToolKind, ring);
      const x = tg.closest<HTMLElement>("[data-x]");
      if (x?.dataset.x === "help") return host.openHelp(x);
      if (x?.dataset.x === "settings") return host.openSettings(x);
      if (x?.dataset.x === "about") return host.openAbout();
      if (x?.dataset.x === "update") return showUpdate();
      if (x?.dataset.x === "monitor") return host.openMonitors(x);
      if (x?.dataset.x === "projects") return host.projectMenu(x);
      if (x?.dataset.x === "unfocus") return host.clearProject();
      if (x?.dataset.x === "git") return host.openGit();
      const w = tg.closest<HTMLElement>("[data-w]")?.dataset.w;
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
      this.maxBtn.title = max ? t("titlebar.restore") : t("titlebar.maximize");
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
      pill.innerHTML = `${ICON.update}<span>${t("titlebar.updatePill", { version: v })}</span>`;
      pill.title = t("titlebar.updatePillHint", { version: v });
    }
  }

  /** Branch e selos de git da sessão em foco (clique abre o painel Git). */
  private renderGit(): void {
    const chip = this.el.querySelector<HTMLElement>(".gchip")!;
    const s = store.session(store.active);
    const info = s ? store.git[s.cwd] : null;
    const sum = info ? store.gitSummary[normPath(info.root)] : undefined;
    chip.hidden = false;
    if (!info) {
      chip.className = "gchip";
      chip.innerHTML = `${ICON.branch}<span class="gchip-b">Git</span>`;
      chip.title = t("git.tabHint");
      return;
    }
    const branch = sum?.branch ?? info.branch ?? "HEAD";
    const parts = [sum?.changed ? `<i class="c">●${sum.changed}</i>` : "", sum?.ahead ? `<i class="a">↑${sum.ahead}</i>` : "", sum?.behind ? `<i class="b">↓${sum.behind}</i>` : ""].join("");
    chip.className = `gchip${sum?.conflicts ? " bad" : ""}`;
    chip.innerHTML = `${ICON.branch}<span class="gchip-b">${esc(branch)}</span>${parts}`;
    chip.title = `${t("git.tabHint")}
${info.root}`;
  }

  render(): void {
    this.views.querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.v === store.view));
    this.tools.style.visibility = store.view === "tiles" ? "visible" : "hidden";
    renderRings(this.rings);
    const chip = this.el.querySelector<HTMLElement>(".pchip")!;
    chip.hidden = !store.project;
    if (store.project) {
      chip.innerHTML = `${ICON.focus}<span>${esc(store.projectName)}</span>${ICON.close}`;
      chip.title = t("titlebar.projectChip");
    }
    this.renderGit();
    const many = store.windows.length > 1;
    this.el.querySelector<HTMLElement>(".wname")!.textContent = many ? `· ${store.myName}` : "";
  }
}
