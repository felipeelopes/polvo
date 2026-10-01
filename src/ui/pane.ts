// Moldura de uma sessão: cabeçalho (arrastável), terminal e avisos de estado.
import { store } from "../core/store";
import type { Session, Status } from "../core/types";
import { basename, esc, h } from "./dom";
import { ICON, sessionColor, TOOLS, toolIcon } from "./icons";
import { logo } from "./logo";
import { t } from "../i18n";

export type PaneAction = "split" | "terminal" | "move" | "min" | "zoom" | "close" | "open" | "dmax" | "dclose" | "start" | "rename";

export interface PaneHandlers {
  action(action: PaneAction, id: string, extra?: string, anchor?: HTMLElement): void;
  headerDown?(e: PointerEvent, id: string): void;
  activate?(id: string): void;
}

const statusLabel = (s: Status): string => t(`status.${s}`);

export const statusPill = (s: Status) => `<i></i><span>${statusLabel(s)}</span>`;

export class Pane {
  readonly el: HTMLElement;
  readonly body: HTMLDivElement;
  private nameEl: HTMLElement;
  private stEl: HTMLElement;
  private noteEl: HTMLDivElement;
  private closeArmed: number | undefined;

  constructor(readonly id: string, readonly mode: "tile" | "drawer", private handlers: PaneHandlers) {
    const s = store.session(id)!;
    const tool = TOOLS[s.tool];
    this.el = h(mode === "tile" ? "section" : "div", mode === "tile" ? "pane" : "");
    if (mode === "drawer") this.el.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
    this.el.style.setProperty("--acc", tool.color);
    const acts =
      mode === "tile"
        ? `<button data-a="terminal" title="${t("pane.openTerminal")} (Ctrl+Shift+T)">${ICON.terminal}</button>
           <button data-a="split" title="${t("pane.split")}">${ICON.split}</button>
           <button data-a="move" data-pop title="${t("pane.move")}">${ICON.move}</button>
           <button data-a="min" title="${t("pane.minimize")}">${ICON.min}</button>
           <button data-a="zoom" title="${t("pane.maximize")} (Ctrl+Shift+M)">${ICON.max}</button>
           <button data-a="close" title="${t("pane.close")}">${ICON.close}</button>`
        : `<button data-a="terminal" title="${t("pane.openTerminal")}">${ICON.terminal}</button>
           <button data-a="open" title="${t("pane.openInTiles")}">${ICON.open}</button>
           <button data-a="dmax" title="${t("pane.maximizeChat")} (Ctrl+Shift+M)">${ICON.max}</button>
           <button data-a="dclose" title="${t("pane.closeDrawer")}">${ICON.close}</button>`;
    this.el.innerHTML = `
      <div class="ph">${toolIcon(s.tool, 15)}<div class="pt"><b title="${t("pane.renameHint")}"></b><span></span></div><span class="ctx" hidden></span><span class="st"></span><div class="pacts">${acts}</div></div>
      <div class="pb"><div class="pane-note" hidden></div>${mode === "tile" ? '<div class="psz"></div>' : ""}</div>`;
    this.body = this.el.querySelector(".pb")!;
    this.nameEl = this.el.querySelector(".pt b")!;
    this.stEl = this.el.querySelector(".st")!;
    this.noteEl = this.el.querySelector(".pane-note")!;

    const header = this.el.querySelector<HTMLElement>(".ph")!;
    header.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest("button,[contenteditable=true]")) return;
      handlers.headerDown?.(e, id);
    });
    header.addEventListener("dblclick", (e) => {
      if (mode === "tile" && !(e.target as Element).closest("button,b")) handlers.action("zoom", id);
    });
    this.nameEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.rename();
    });
    this.el.querySelector(".pacts")!.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button");
      const a = btn?.dataset.a as PaneAction | undefined;
      if (!btn || !a) return;
      if (a === "close" && !this.confirmClose(btn)) return;
      handlers.action(a, id, undefined, btn);
    });
    this.noteEl.addEventListener("click", (e) => {
      const a = (e.target as Element).closest<HTMLButtonElement>("button")?.dataset.a as PaneAction | undefined;
      if (a) handlers.action(a, id);
    });
    if (mode === "tile") this.el.addEventListener("pointerdown", () => handlers.activate?.(id), true);
    this.update();
  }

  update(): void {
    const s = store.session(this.id);
    if (!s) return;
    const st = s.runtime.status;
    this.el.style.setProperty("--acc", sessionColor(s));
    if (this.nameEl.contentEditable !== "true") this.nameEl.textContent = s.title;
    const sub = this.el.querySelector<HTMLElement>(".pt span")!;
    sub.textContent = `${TOOLS[s.tool].short} · ${basename(s.cwd)}`;
    sub.title = `${s.cwd}${s.sessionId ? `\n${t("pane.sessionId", { id: s.sessionId })}` : ""}`;
    this.renderContext();
    this.stEl.className = `st ${st}`;
    this.stEl.innerHTML = statusPill(st);
    for (const k of ["working", "waiting", "idle"]) this.el.classList.toggle(`st-${k}`, st === k);
    const zoom = this.el.querySelector<HTMLElement>('[data-a="zoom"]');
    if (zoom) zoom.innerHTML = store.zoom === this.id ? ICON.unmax : ICON.max;
    this.renderNote(s);
  }

  /** Medidor do contexto usado pela conversa (anel + percentual). */
  private renderContext(): void {
    const el = this.el.querySelector<HTMLElement>(".ctx")!;
    const pct = store.context[this.id];
    el.hidden = pct === undefined;
    if (pct === undefined) return;
    const p = Math.round(pct);
    const color = p >= 90 ? "var(--bad)" : p >= 75 ? "var(--warn)" : "var(--acc)";
    const r = 5.5;
    const len = 2 * Math.PI * r;
    el.title = `${t("pane.context", { pct: p })}${p >= 75 ? ` · ${t("pane.nearCompact")}` : ""}`;
    el.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" style="transform:rotate(-90deg)"><circle cx="7" cy="7" r="${r}" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="2"/><circle cx="7" cy="7" r="${r}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${(len * p) / 100} ${len}"/></svg>${p}%`;
  }

  private renderNote(s: Session): void {
    const st = s.runtime.status;
    const n = this.noteEl;
    n.className = "pane-note";
    if (st === "paused") {
      n.innerHTML = `<b>${t("pane.paused.title")}</b><p>${t("pane.toolIn", { tool: esc(TOOLS[s.tool].name), dir: esc(basename(s.cwd)) })}${s.sessionId ? ` · ${t("pane.paused.ready")}` : ""}</p><div><button class="primary" data-a="start">${t("pane.resume")}</button><button class="ghost" data-a="close">${t("pane.end")}</button></div>`;
    } else if (st === "error") {
      n.innerHTML = `<b>${t("pane.error.title")}</b><p>${esc(s.runtime.error ?? t("pane.error.unknown"))}</p><div><button class="primary" data-a="start">${t("pane.error.retry")}</button><button class="ghost" data-a="close">${t("pane.end")}</button></div>`;
    } else if (st === "starting") {
      // O polvo "puxa" a sessão de volta enquanto o CLI não responde.
      const resuming = !!s.sessionId;
      n.classList.add("loading");
      n.innerHTML = `${logo(64, "swim")}<b>${resuming ? t("pane.starting.resuming") : t("pane.starting.starting")}<span class="dots3"></span></b><p>${t("pane.toolIn", { tool: esc(TOOLS[s.tool].name), dir: esc(basename(s.cwd)) })}</p>`;
    } else if (st === "exited") {
      n.classList.add("bottom");
      n.innerHTML = `<b>${s.runtime.exitCode ? t("pane.exited.titleCode", { code: s.runtime.exitCode }) : t("pane.exited.title")}</b><div><button class="primary" data-a="start">${s.sessionId ? t("pane.resume") : t("pane.exited.restart")}</button><button class="ghost" data-a="close">${t("pane.exited.close")}</button></div>`;
    }
    n.hidden = !["paused", "error", "exited", "starting"].includes(st);
  }

  /** Na gaveta do Quadro: alterna o ícone de maximizar/restaurar. */
  setMaximized(max: boolean): void {
    const b = this.el.querySelector<HTMLElement>('[data-a="dmax"]');
    if (!b) return;
    b.innerHTML = max ? ICON.unmax : ICON.max;
    b.title = `${max ? t("pane.backToBoard") : t("pane.maximizeChat")} (Ctrl+Shift+M)`;
  }

  setSizeLabel(text: string): void {
    const el = this.el.querySelector(".psz");
    if (el) el.textContent = text;
  }

  private confirmClose(btn: HTMLButtonElement): boolean {
    const s = store.session(this.id);
    if (!s || !["working", "waiting", "idle", "starting"].includes(s.runtime.status)) return true;
    if (this.closeArmed) {
      clearTimeout(this.closeArmed);
      this.closeArmed = undefined;
      return true;
    }
    btn.classList.add("confirm");
    btn.textContent = t("pane.confirmClose");
    this.closeArmed = window.setTimeout(() => {
      this.closeArmed = undefined;
      btn.classList.remove("confirm");
      btn.innerHTML = ICON.close;
    }, 2500);
    return false;
  }

  private rename(): void {
    const el = this.nameEl;
    el.contentEditable = "true";
    el.focus();
    document.getSelection()?.selectAllChildren(el);
    el.addEventListener(
      "blur",
      () => {
        el.contentEditable = "false";
        const title = el.textContent?.trim();
        if (title) this.handlers.action("rename", this.id, title);
        this.update();
      },
      { once: true },
    );
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        el.blur();
      }
      e.stopPropagation();
    };
  }
}
