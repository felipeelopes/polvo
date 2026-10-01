// Visão Quadro: sessões em colunas por status, com a sessão escolhida aberta na gaveta.
import { store } from "../core/store";
import type { Session, Status } from "../core/types";
import type { Terminals } from "../terminal/terminals";
import { ago, basename, esc, h } from "./dom";
import { TOOLS, toolIcon } from "./icons";
import { Pane, type PaneHandlers } from "./pane";
import { levelColor } from "./usage";

const COLUMNS: { key: string; title: string; color: string; sub: string; match: (s: Status) => boolean }[] = [
  { key: "waiting", title: "Aguardando você", color: "#E5A33A", sub: "responda para destravar", match: (s) => s === "waiting" },
  { key: "working", title: "Trabalhando", color: "#8aa2ff", sub: "em andamento", match: (s) => s === "working" || s === "starting" },
  { key: "idle", title: "Ocioso", color: "#5d6274", sub: "prontas ou pausadas", match: (s) => ["idle", "paused", "exited", "error"].includes(s) },
];

export interface BoardHost {
  terms: Terminals;
  handlers: PaneHandlers;
  focusWindow(label: string): void;
}

export class BoardView {
  readonly el = h("div", "board");
  private cols = h("div", "kcols");
  private drawer = h("aside", "drawer");
  private pane: Pane | null = null;

  constructor(private host: BoardHost) {
    this.el.append(this.cols, this.drawer);
    this.cols.addEventListener("click", (e) => {
      const card = (e.target as Element).closest<HTMLElement>(".kc");
      if (card) this.select(card.dataset.id!);
    });
    this.cols.addEventListener("dblclick", (e) => {
      const card = (e.target as Element).closest<HTMLElement>(".kc");
      if (card) host.handlers.action("open", card.dataset.id!);
    });
  }

  select(id: string): void {
    store.selected = id;
    store.setActive(id);
    this.render();
    this.renderDrawer();
  }

  render(): void {
    if (store.view !== "board") return;
    const before = new Map<string, DOMRect>();
    this.cols.querySelectorAll<HTMLElement>(".kc").forEach((c) => before.set(c.dataset.id!, c.getBoundingClientRect()));
    const scrolls = [...this.cols.querySelectorAll(".klist")].map((l) => l.scrollTop);

    this.cols.innerHTML = COLUMNS.map((col) => {
      const items = store.sessions.filter((s) => col.match(s.runtime.status)).sort((a, b) => b.runtime.since - a.runtime.since);
      return `<div class="kcol"><div class="kch"><i style="background:${col.color}"></i>${col.title} <span>${items.length}</span><em>${col.sub}</em></div>
        <div class="klist">${items.length ? items.map((s) => this.card(s)).join("") : '<div class="knone">Nada aqui</div>'}</div></div>`;
    }).join("");

    this.cols.querySelectorAll(".klist").forEach((l, i) => (l.scrollTop = scrolls[i] ?? 0));
    // Animação FLIP: cartões deslizam da posição antiga para a nova.
    this.cols.querySelectorAll<HTMLElement>(".kc").forEach((c) => {
      const prev = before.get(c.dataset.id!);
      const now = c.getBoundingClientRect();
      if (!prev) {
        c.animate([{ opacity: 0, transform: "scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "ease-out" });
        return;
      }
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        c.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    });
    this.pane?.update();
  }

  private card(s: Session): string {
    const t = TOOLS[s.tool];
    const usage = store.usage.find((u) => u.provider === s.tool)?.windows.find((w) => w.usedPercent !== null);
    const where = s.window !== store.label ? (store.isMain ? "na Tela 2" : "na Tela 1") : s.minimized ? "no trilho" : "em painel";
    const st = s.runtime.status;
    const note = st === "paused" ? "pausada" : st === "exited" ? "encerrada" : st === "error" ? "erro ao iniciar" : "";
    return `<div class="kc ${st}${store.selected === s.id ? " sel" : ""}" data-id="${s.id}" style="--acc:${t.color}">
      <div class="kh"><span class="ic">${toolIcon(s.tool, 16)}</span><div><b>${esc(s.title)}</b><span>${t.short} · ${esc(basename(s.cwd))}</span></div><em>${ago(s.runtime.since)}</em></div>
      <div class="kp">${esc(s.runtime.preview.join("\n"))}</div>
      <div class="kf"><span class="tag">${where}</span>${note ? `<span class="tag">${note}</span>` : ""}${
        usage
          ? `<span class="um">${usage.short} ${Math.round(usage.usedPercent!)}% <span class="bar"><i style="width:${usage.usedPercent}%;background:${levelColor(s.tool, usage.usedPercent!)}"></i></span></span>`
          : ""
      }</div></div>`;
  }

  renderDrawer(): void {
    if (store.view !== "board") return;
    const s = store.session(store.selected);
    if (this.pane && this.pane.id !== s?.id) {
      this.pane = null;
    }
    if (!s) {
      this.drawer.innerHTML = '<div class="dempty"><div>Selecione um cartão para abrir a sessão aqui.<br><br>Duplo clique leva a sessão para os Painéis.</div></div>';
      return;
    }
    if (s.window !== store.label) {
      const other = s.window === "main" ? "Tela 1" : "Tela 2";
      this.drawer.innerHTML = `<div class="dempty"><div>“${esc(s.title)}” está aberta na ${other}.<br><button class="primary">Ir para a ${other}</button></div></div>`;
      this.drawer.querySelector("button")!.onclick = () => this.host.focusWindow(s.window);
      return;
    }
    if (!this.pane) {
      this.pane = new Pane(s.id, "drawer", this.host.handlers);
      this.drawer.replaceChildren(this.pane.el);
    }
    this.pane.update();
    this.host.terms.get(s.id)?.mount(this.pane.body);
  }

  /** Ao sair do Quadro, a gaveta solta o terminal (os Painéis o remontam). */
  leave(): void {
    this.pane = null;
    this.drawer.replaceChildren();
  }
}
