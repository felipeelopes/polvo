// Utilitários de DOM e formatação.

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const basename = (p: string): string => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

export function ago(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
}

export function until(ts: number): string {
  const ms = ts - Date.now();
  if (ms <= 0) return "agora";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}min` : `${m}min`;
}

export function inside(e: { clientX: number; clientY: number }, r: DOMRect): boolean {
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: number | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  };
}

/** Tooltip leve usado no trilho e em ícones. */
let tipEl: HTMLDivElement | null = null;
export function showTip(anchor: HTMLElement, html: string, side: "right" | "bottom" = "right"): void {
  hideTip();
  tipEl = h("div", "tip", html);
  document.body.appendChild(tipEl);
  const r = anchor.getBoundingClientRect();
  if (side === "right") {
    tipEl.style.left = `${r.right + 10}px`;
    tipEl.style.top = `${r.top + r.height / 2 - tipEl.offsetHeight / 2}px`;
  } else {
    tipEl.style.left = `${Math.max(8, r.left + r.width / 2 - tipEl.offsetWidth / 2)}px`;
    tipEl.style.top = `${r.bottom + 8}px`;
  }
}
export function hideTip(): void {
  tipEl?.remove();
  tipEl = null;
}
