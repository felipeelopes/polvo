// Avisos rápidos (toast) e popovers ancorados.
import { h } from "./dom";

let toastEl: HTMLDivElement | null = null;
let toastTimer: number | undefined;

export function toast(message: string, action?: { label: string; run: () => void }): void {
  if (!toastEl) {
    toastEl = h("div", "toast");
    document.body.appendChild(toastEl);
  }
  toastEl.innerHTML = "";
  toastEl.append(h("span", "", ""));
  toastEl.firstElementChild!.textContent = message;
  if (action) {
    const b = h("button");
    b.textContent = action.label;
    b.onclick = () => {
      action.run();
      toastEl?.classList.remove("on");
    };
    toastEl.append(b);
  }
  toastEl.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove("on"), action ? 6000 : 3200);
}

let popEl: HTMLDivElement | null = null;
let popKey: string | null = null;
let popClose: (() => void) | null = null;

/** Abre um popover abaixo de `anchor`. Clicar de novo na mesma chave fecha. */
export function popover(key: string, anchor: HTMLElement, render: (el: HTMLDivElement) => void, cls = "", onClose?: () => void): void {
  if (popKey === key) return closePopover();
  closePopover();
  popEl = h("div", `pop ${cls}`);
  document.body.appendChild(popEl);
  render(popEl);
  popKey = key;
  popClose = onClose ?? null;
  const r = anchor.getBoundingClientRect();
  // Abre para cima quando não cabe abaixo; nunca sai da janela.
  const hgt = popEl.offsetHeight;
  const below = r.bottom + 8;
  const top = below + hgt <= innerHeight - 12 ? below : r.top - 8 - hgt;
  popEl.style.top = `${Math.max(12, Math.min(innerHeight - hgt - 12, top))}px`;
  popEl.style.left = `${Math.max(12, Math.min(innerWidth - popEl.offsetWidth - 12, r.right - popEl.offsetWidth))}px`;
}

export function refreshPopover(key: string, render: (el: HTMLDivElement) => void): void {
  if (popKey === key && popEl) render(popEl);
}

export function closePopover(): void {
  popEl?.remove();
  popEl = null;
  popKey = null;
  const cb = popClose;
  popClose = null;
  cb?.();
}

export const popoverOpen = (key?: string) => (key ? popKey === key : popKey !== null);

document.addEventListener("pointerdown", (e) => {
  if (popEl && !(e.target as Element).closest(".pop,[data-pop]")) closePopover();
});
