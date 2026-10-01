// Trilho lateral: todas as sessões desta janela, abertas ou recolhidas.
import { store } from "../core/store";
import { esc, h, hideTip, showTip } from "./dom";
import { TOOLS, toolIcon } from "./icons";
import { statusPill } from "./pane";

export class Rail {
  readonly el = h("nav", "rail");
  private items = h("div", "ritems");

  constructor(onPointerDown: (e: PointerEvent, id: string) => void) {
    const add = h("button", "ri add", "+");
    add.dataset.new = "";
    add.title = "Nova sessão (Ctrl+Shift+N)";
    this.el.append(this.items, add);
    this.items.addEventListener("pointerdown", (e) => {
      const item = (e.target as Element).closest<HTMLElement>(".ri");
      if (item) {
        hideTip();
        onPointerDown(e, item.dataset.id!);
      }
    });
    this.items.addEventListener("pointerover", (e) => {
      const item = (e.target as Element).closest<HTMLElement>(".ri");
      const s = store.session(item?.dataset.id ?? null);
      if (!item || !s) return;
      showTip(item, `<b>${esc(s.title)}</b> <span>· ${TOOLS[s.tool].short}${s.minimized ? " · recolhida" : ""}</span><div class="st ${s.runtime.status}" style="margin-top:6px;--acc:${TOOLS[s.tool].color}">${statusPill(s.runtime.status)}</div>`);
    });
    this.items.addEventListener("pointerleave", hideTip);
  }

  render(): void {
    this.items.innerHTML = store.mine
      .map(
        (s) =>
          `<div class="ri${s.minimized ? " min" : ""}${store.active === s.id ? " on" : ""}" data-id="${s.id}" style="--acc:${TOOLS[s.tool].color}">${toolIcon(s.tool, 19)}<i class="sd ${s.runtime.status}"></i></div>`,
      )
      .join("");
  }
}
