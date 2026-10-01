// Visão Quadro: sessões em colunas por status, com a sessão escolhida aberta na
// gaveta. As colunas e a gaveta são redimensionáveis por divisórias, cada coluna
// pode ser recolhida por inteiro e a gaveta pode ser maximizada.
import { store } from "../core/store";
import type { Session, Status } from "../core/types";
import type { Terminals } from "../terminal/terminals";
import { ago, basename, esc, h } from "./dom";
import { ICON, sessionColor, TOOLS, toolIcon } from "./icons";
import { Pane, type PaneHandlers } from "./pane";
import { levelColor } from "./usage";
import { t } from "../i18n";

interface Column {
  key: string;
  title: string;
  color: string;
  sub: string;
  match: (s: Status) => boolean;
}

/** Colunas do Quadro (função: os títulos dependem do idioma atual). */
const columns = (): Column[] => [
  { key: "waiting", title: t("board.columns.waiting.title"), color: "#E5A33A", sub: t("board.columns.waiting.sub"), match: (s) => s === "waiting" },
  { key: "working", title: t("board.columns.working.title"), color: "#8aa2ff", sub: t("board.columns.working.sub"), match: (s) => s === "working" || s === "starting" },
  { key: "idle", title: t("board.columns.idle.title"), color: "#5d6274", sub: t("board.columns.idle.sub"), match: (s) => ["idle", "paused", "exited", "error"].includes(s) },
];

const STATE_KEY = "polvo.board";
const MIN_DRAWER = 360;
const MIN_COLS = 220;

interface BoardLayout {
  /** Peso de cada coluna (largura relativa). */
  weights: Record<string, number>;
  /** Colunas recolhidas. */
  collapsed: string[];
  /** Largura da gaveta em px. */
  drawer: number;
  /** Gaveta ocupando o Quadro inteiro. */
  maximized: boolean;
}

function loadLayout(): BoardLayout {
  const fallback: BoardLayout = { weights: { waiting: 1, working: 1, idle: 1 }, collapsed: [], drawer: 620, maximized: false };
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}") as Partial<BoardLayout>) };
  } catch {
    return fallback;
  }
}

export interface BoardHost {
  terms: Terminals;
  handlers: PaneHandlers;
  focusWindow(label: string): void;
}

export class BoardView {
  readonly el = h("div", "board");
  private cols = h("div", "kcols");
  private split = h("div", "dsplit");
  private drawer = h("aside", "drawer");
  private pane: Pane | null = null;
  private layout = loadLayout();

  constructor(private host: BoardHost) {
    this.split.title = t("board.drawerSplit");
    this.el.append(this.cols, this.split, this.drawer);
    this.cols.addEventListener("click", (e) => {
      const t = e.target as Element;
      const toggle = t.closest<HTMLElement>("[data-collapse]")?.dataset.collapse;
      if (toggle) return this.toggleColumn(toggle);
      const card = t.closest<HTMLElement>(".kc");
      if (card) this.select(card.dataset.id!);
    });
    this.cols.addEventListener("dblclick", (e) => {
      const t = e.target as Element;
      if (t.closest(".ksplit")) return this.resetColumns();
      const card = t.closest<HTMLElement>(".kc");
      if (card) host.handlers.action("open", card.dataset.id!);
    });
    this.cols.addEventListener("pointerdown", (e) => {
      const s = (e.target as Element).closest<HTMLElement>(".ksplit");
      if (s) this.dragColumns(e, Number(s.dataset.i));
    });
    this.split.addEventListener("pointerdown", (e) => this.dragDrawer(e));
    this.split.addEventListener("dblclick", () => this.toggleMaximize());
    this.applyLayout();
  }

  select(id: string): void {
    store.selected = id;
    store.setActive(id);
    this.render();
    this.renderDrawer();
  }

  /** Maximiza a gaveta do chat (ou volta ao Quadro). */
  toggleMaximize(): void {
    this.layout.maximized = !this.layout.maximized;
    this.save();
    this.applyLayout();
  }

  render(): void {
    if (store.view !== "board") return;
    const before = new Map<string, DOMRect>();
    this.cols.querySelectorAll<HTMLElement>(".kc").forEach((c) => before.set(c.dataset.id!, c.getBoundingClientRect()));
    const scrolls = [...this.cols.querySelectorAll(".klist")].map((l) => l.scrollTop);
    const sessions = store.sessions.filter((s) => store.inProject(s));

    const cols = columns();
    this.cols.innerHTML = cols.map((col, i) => {
      const items = sessions.filter((s) => col.match(s.runtime.status)).sort((a, b) => b.runtime.since - a.runtime.since);
      const collapsed = this.layout.collapsed.includes(col.key);
      const splitter = i < cols.length - 1 ? `<div class="ksplit" data-i="${i}" title="${t("board.columnSplit")}"></div>` : "";
      if (collapsed) {
        return `<div class="kcol collapsed" data-collapse="${col.key}" title="${t("board.expand", { title: col.title })}"><i style="background:${col.color}"></i><span class="vt">${col.title}</span><b>${items.length}</b></div>${splitter}`;
      }
      return `<div class="kcol" style="flex:${this.layout.weights[col.key] ?? 1} 1 0"><div class="kch"><i style="background:${col.color}"></i>${col.title} <span>${items.length}</span><em>${col.sub}</em><button class="kmin" data-collapse="${col.key}" title="${t("board.collapse")}">${ICON.min}</button></div>
        <div class="klist">${items.length ? items.map((s) => this.card(s)).join("") : `<div class="knone">${t("board.empty")}</div>`}</div></div>${splitter}`;
    }).join("");

    const lists = this.cols.querySelectorAll(".klist");
    lists.forEach((l, i) => (l.scrollTop = scrolls[i] ?? 0));
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
    const tool = TOOLS[s.tool];
    const usage = store.usage.find((u) => u.provider === s.tool)?.windows.find((w) => w.usedPercent !== null);
    const where = s.window !== store.label ? t("board.where.window", { name: store.windowName(s.window) }) : s.minimized ? t("board.where.rail") : t("board.where.tile");
    const st = s.runtime.status;
    const note = st === "paused" ? t("board.note.paused") : st === "exited" ? t("board.note.exited") : st === "error" ? t("board.note.error") : "";
    return `<div class="kc ${st}${store.selected === s.id ? " sel" : ""}" data-id="${s.id}" style="--acc:${sessionColor(s)}">
      <div class="kh"><span class="ic">${toolIcon(s.tool, 16)}</span><div><b>${esc(s.title)}</b><span>${tool.short} · ${esc(basename(s.cwd))}</span></div><em>${ago(s.runtime.since)}</em></div>
      <div class="kp">${esc(s.runtime.preview.join("\n"))}</div>
      <div class="kf"><span class="tag">${where}</span>${note ? `<span class="tag">${note}</span>` : ""}${store.context[s.id] !== undefined ? `<span class="tag" title="${t("board.context")}">${t("board.ctx", { pct: Math.round(store.context[s.id]) })}</span>` : ""}${
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
      this.drawer.innerHTML = `<div class="dempty"><div>${t("board.drawerEmpty.select")}<br><br>${t("board.drawerEmpty.dblclick")}</div></div>`;
      return;
    }
    if (s.window !== store.label) {
      const other = store.windowName(s.window);
      this.drawer.innerHTML = `<div class="dempty"><div>${t("board.otherWindow.text", { title: esc(s.title), window: other })}<br><button class="primary">${t("board.otherWindow.go", { window: other })}</button></div></div>`;
      this.drawer.querySelector("button")!.onclick = () => this.host.focusWindow(s.window);
      return;
    }
    if (!this.pane) {
      this.pane = new Pane(s.id, "drawer", this.host.handlers);
      this.drawer.replaceChildren(this.pane.el);
    }
    this.pane.update();
    this.pane.setMaximized(this.layout.maximized);
    this.host.terms.get(s.id)?.mount(this.pane.body);
  }

  /** Ao sair do Quadro, a gaveta solta o terminal (os Painéis o remontam). */
  leave(): void {
    this.pane = null;
    this.drawer.replaceChildren();
  }

  // ------------------------------------------------------------ layout

  private save(): void {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(this.layout));
    } catch {
      /* ignora */
    }
  }

  private applyLayout(): void {
    const max = this.layout.maximized;
    this.el.classList.toggle("drawer-max", max);
    this.drawer.style.width = max ? "" : `${this.layout.drawer}px`;
    this.pane?.setMaximized(max);
  }

  private toggleColumn(key: string): void {
    const c = this.layout.collapsed;
    this.layout.collapsed = c.includes(key) ? c.filter((k) => k !== key) : [...c, key];
    this.save();
    this.render();
  }

  private resetColumns(): void {
    this.layout.weights = { waiting: 1, working: 1, idle: 1 };
    this.save();
    this.render();
  }

  /** Divisória entre duas colunas: troca largura entre elas. */
  private dragColumns(e: PointerEvent, i: number): void {
    e.preventDefault();
    const cols = [...this.cols.querySelectorAll<HTMLElement>(".kcol")];
    const a = cols[i];
    const b = cols[i + 1];
    if (!a || !b || a.classList.contains("collapsed") || b.classList.contains("collapsed")) return;
    const keys = columns().map((c) => c.key);
    const ka = keys[i];
    const kb = keys[i + 1];
    const wa = a.getBoundingClientRect().width;
    const wb = b.getBoundingClientRect().width;
    const total = (this.layout.weights[ka] ?? 1) + (this.layout.weights[kb] ?? 1);
    const x0 = e.clientX;
    document.body.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => {
      const dx = Math.max(-(wa - 140), Math.min(wb - 140, ev.clientX - x0));
      const na = wa + dx;
      this.layout.weights[ka] = (total * na) / (wa + wb);
      this.layout.weights[kb] = total - this.layout.weights[ka];
      a.style.flex = `${this.layout.weights[ka]} 1 0`;
      b.style.flex = `${this.layout.weights[kb]} 1 0`;
    };
    addEventListener("pointermove", move);
    addEventListener(
      "pointerup",
      () => {
        removeEventListener("pointermove", move);
        document.body.style.cursor = "";
        this.save();
      },
      { once: true },
    );
  }

  /** Divisória entre as colunas e a gaveta do chat. */
  private dragDrawer(e: PointerEvent): void {
    if (this.layout.maximized) return;
    e.preventDefault();
    const start = this.drawer.getBoundingClientRect().width;
    const x0 = e.clientX;
    const total = this.el.getBoundingClientRect().width;
    document.body.style.cursor = "col-resize";
    this.el.classList.add("resizing");
    const move = (ev: PointerEvent) => {
      const w = Math.max(MIN_DRAWER, Math.min(total - MIN_COLS, start - (ev.clientX - x0)));
      this.layout.drawer = Math.round(w);
      this.drawer.style.width = `${this.layout.drawer}px`;
    };
    addEventListener("pointermove", move);
    addEventListener(
      "pointerup",
      () => {
        removeEventListener("pointermove", move);
        document.body.style.cursor = "";
        this.el.classList.remove("resizing");
        this.save();
      },
      { once: true },
    );
  }
}
