// Diagramas mermaid com zoom e arrastar: no documento (Ctrl + roda, arrastar,
// botões) e em tela cheia (roda, arrastar, + − 0, Esc).
import { t } from "../i18n";
import { esc, h } from "../ui/dom";
import { toast } from "../ui/feedback";
import { cssVar, isLight, onThemeChange } from "../ui/theme";

type Mermaid = typeof import("mermaid").default;
let loading: Promise<Mermaid> | null = null;

/**
 * Cores do mermaid no tema atual. Ele precisa de cores concretas (calcula
 * tons derivados), então os neutros vêm dos tokens já resolvidos e só os
 * tingidos (nós, notas) ficam aqui, um conjunto por tema.
 */
function config(): Parameters<Mermaid["initialize"]>[0] {
  const light = isLight();
  const text = cssVar("--text") || (light ? "#1b1d22" : "#e6e7ea");
  const muted = cssVar("--muted") || (light ? "#5d626d" : "#a0a3ab");
  const accent = cssVar("--accent") || (light ? "#1f5fd6" : "#7aa5ff");
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
    themeVariables: {
      darkMode: !light,
      background: "transparent",
      fontSize: "14px",
      textColor: text,
      primaryTextColor: text,
      primaryBorderColor: accent,
      lineColor: muted,
      ...(light
        ? { primaryColor: "#edf2fc", secondaryColor: "#f3effb", tertiaryColor: "#f6f7f9", edgeLabelBackground: "#f6f7f9", noteBkgColor: "#fdf3dc", noteTextColor: "#5c4410", noteBorderColor: "#e3c47e" }
        : { primaryColor: "#25272d", secondaryColor: "#2b2733", tertiaryColor: "#1f2024", edgeLabelBackground: "#141518", noteBkgColor: "#3a3220", noteTextColor: "#f2e6c8", noteBorderColor: "#7a6332" }),
    },
  };
}

function mermaid(): Promise<Mermaid> {
  loading ??= import("mermaid").then(({ default: m }) => {
    m.initialize(config());
    return m;
  });
  return loading;
}

/** SVG já desenhado por código-fonte (re-renderizar no modo dividido é caro). */
const cache = new Map<string, string>();
let seq = 0;
/** Quem reenquadra cada bloco ao redimensionar (trocado quando o bloco é redesenhado). */
const observers = new WeakMap<HTMLElement, ResizeObserver>();

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 12;

const ICONS = {
  minus: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 8h10M8 3v10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  fit: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>',
  full: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9.5 2H14v4.5M6.5 14H2V9.5M14 2 9 7M2 14l5-5"/></svg>',
  code: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 4-4 4 4 4M10.5 4l4 4-4 4"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

/** Transformação de zoom/arrastar sobre um SVG dentro de um palco. */
class PanZoom {
  scale = 1;
  x = 0;
  y = 0;
  /** O usuário mexeu: não reenquadrar sozinho ao redimensionar. */
  touched = false;
  private natural = { w: 1, h: 1 };

  constructor(
    readonly stage: HTMLElement,
    readonly svg: SVGSVGElement,
    private opts: { wheelNeedsCtrl: boolean; onChange?: () => void },
  ) {
    const vb = svg.viewBox.baseVal;
    const box = vb && vb.width ? { w: vb.width, h: vb.height } : { w: svg.getBBox().width || 400, h: svg.getBBox().height || 300 };
    this.natural = box;
    svg.removeAttribute("style");
    svg.setAttribute("width", String(box.w));
    svg.setAttribute("height", String(box.h));
    svg.style.transformOrigin = "0 0";
    svg.style.position = "absolute";
    svg.style.left = svg.style.top = "0";
    svg.style.maxWidth = "none";

    stage.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    stage.addEventListener("pointerdown", (e) => this.onDown(e));
    stage.addEventListener("dblclick", () => this.fit());
  }

  get size() {
    return this.natural;
  }

  fit(maxScale = 1): void {
    const W = this.stage.clientWidth;
    const H = this.stage.clientHeight;
    if (!W || !H) return;
    const pad = 16;
    this.scale = Math.min((W - pad * 2) / this.natural.w, (H - pad * 2) / this.natural.h, maxScale);
    this.x = (W - this.natural.w * this.scale) / 2;
    this.y = (H - this.natural.h * this.scale) / 2;
    this.touched = false;
    this.apply();
  }

  zoomAt(factor: number, cx = this.stage.clientWidth / 2, cy = this.stage.clientHeight / 2): void {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.scale * factor));
    const k = next / this.scale;
    this.x = cx - (cx - this.x) * k;
    this.y = cy - (cy - this.y) * k;
    this.scale = next;
    this.touched = true;
    this.apply();
  }

  private apply(): void {
    this.svg.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    this.opts.onChange?.();
  }

  private onWheel(e: WheelEvent): void {
    if (this.opts.wheelNeedsCtrl && !e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    const r = this.stage.getBoundingClientRect();
    this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey && Math.abs(e.deltaY) < 50 ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    e.preventDefault();
    const sx = e.clientX - this.x;
    const sy = e.clientY - this.y;
    this.stage.classList.add("panning");
    this.stage.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      this.x = ev.clientX - sx;
      this.y = ev.clientY - sy;
      this.touched = true;
      this.apply();
    };
    const up = () => {
      this.stage.classList.remove("panning");
      this.stage.removeEventListener("pointermove", move);
      this.stage.removeEventListener("pointerup", up);
      this.stage.removeEventListener("pointercancel", up);
    };
    this.stage.addEventListener("pointermove", move);
    this.stage.addEventListener("pointerup", up);
    this.stage.addEventListener("pointercancel", up);
  }
}

function toolbar(pz: () => PanZoom | null, extra: string): HTMLElement {
  const bar = h(
    "div",
    "mmd-bar",
    `<button data-z="out" title="${esc(t("docs.mermaid.zoomOut"))}">${ICONS.minus}</button><span class="mmd-pct">100%</span><button data-z="in" title="${esc(t("docs.mermaid.zoomIn"))}">${ICONS.plus}</button><button data-z="fit" title="${esc(t("docs.mermaid.fit"))}">${ICONS.fit}</button>${extra}`,
  );
  bar.addEventListener("click", (e) => {
    const z = (e.target as Element).closest<HTMLElement>("[data-z]")?.dataset.z;
    const p = pz();
    if (!p || !z) return;
    if (z === "in") p.zoomAt(1.25);
    else if (z === "out") p.zoomAt(0.8);
    else if (z === "fit") p.fit(bar.closest(".mmd-lightbox") ? 4 : 1);
  });
  return bar;
}

/** Desenha todos os blocos `.mmd` ainda vazios dentro de `root`. */
export async function renderDiagrams(root: HTMLElement): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>(".mmd:not(.ready)")];
  if (!blocks.length) return;
  const m = await mermaid();
  for (const block of blocks) {
    const src = decodeURIComponent(block.dataset.src ?? "");
    block.classList.add("ready");
    try {
      let svg = cache.get(src);
      if (!svg) {
        const out = await m.render(`mmd-${++seq}`, src);
        svg = out.svg;
        cache.set(src, svg);
        if (cache.size > 200) cache.delete(cache.keys().next().value!);
      }
      mount(block, svg, src);
    } catch (e) {
      document.getElementById(`dmmd-${seq}`)?.remove();
      block.classList.add("mmd-err");
      block.innerHTML = `<b>${esc(t("docs.mermaid.invalid"))}</b><pre></pre>`;
      block.querySelector("pre")!.textContent = String((e as Error)?.message ?? e).slice(0, 600);
    }
  }
}

function mount(block: HTMLElement, svgText: string, src: string): void {
  const stage = h("div", "mmd-stage");
  stage.innerHTML = svgText;
  const svg = stage.querySelector("svg");
  if (!svg) return;
  let pz: PanZoom | null = null;
  const bar = toolbar(() => pz, `<button data-act="code" title="${esc(t("docs.mermaid.copyCode"))}">${ICONS.code}</button><button data-act="full" title="${esc(t("docs.mermaid.fullscreen"))}">${ICONS.full}</button>`);
  const pct = bar.querySelector<HTMLElement>(".mmd-pct")!;
  block.replaceChildren(stage, bar, h("div", "mmd-hint", esc(t("docs.mermaid.hint"))));
  pz = new PanZoom(stage, svg, { wheelNeedsCtrl: true, onChange: () => (pct.textContent = `${Math.round(pz!.scale * 100)}%`) });
  const { w, h: hh } = pz.size;
  const sizeStage = () => {
    const width = stage.clientWidth || 600;
    stage.style.height = `${Math.round(Math.min(Math.max(hh * Math.min(1, (width - 32) / w) + 32, 140), 620))}px`;
  };
  sizeStage();
  pz.fit();
  observers.get(block)?.disconnect();
  const ro = new ResizeObserver(() => {
    if (pz!.touched) return;
    sizeStage();
    pz!.fit();
  });
  ro.observe(block);
  observers.set(block, ro);
  bar.addEventListener("click", (e) => {
    const act = (e.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "full") openLightbox(svgText);
    if (act === "code") navigator.clipboard.writeText(src).then(() => toast(t("docs.mermaid.codeCopied")), () => {});
  });
}

function openLightbox(svgText: string): void {
  const box = h("div", "mmd-lightbox");
  const stage = h("div", "mmd-stage");
  stage.innerHTML = svgText;
  const svg = stage.querySelector("svg")!;
  let pz: PanZoom | null = null;
  const bar = toolbar(() => pz, `<button data-act="close" title="${esc(t("docs.mermaid.close"))}">${ICONS.close}</button>`);
  const pct = bar.querySelector<HTMLElement>(".mmd-pct")!;
  box.append(stage, bar, h("div", "mmd-hint", esc(t("docs.mermaid.hintFull"))));
  document.body.append(box);
  pz = new PanZoom(stage, svg, { wheelNeedsCtrl: false, onChange: () => (pct.textContent = `${Math.round(pz!.scale * 100)}%`) });
  pz.fit(4);
  const close = () => {
    box.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = { Escape: close, "+": () => pz!.zoomAt(1.25), "=": () => pz!.zoomAt(1.25), "-": () => pz!.zoomAt(0.8), "0": () => pz!.fit(4) };
    const fn = keys[e.key];
    if (!fn || e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  document.addEventListener("keydown", onKey, true);
  bar.addEventListener("click", (e) => {
    if ((e.target as Element).closest('[data-act="close"]')) close();
  });
  box.addEventListener("pointerdown", (e) => {
    if (e.target === box) close();
  });
}

/** Tema trocado: os diagramas já desenhados voltam com as cores novas. */
let lightNow = isLight();
onThemeChange(() => {
  if (lightNow === isLight() || !loading) return;
  lightNow = isLight();
  cache.clear();
  void loading.then(async (m) => {
    m.initialize(config());
    const roots = new Set<HTMLElement>();
    for (const block of document.querySelectorAll<HTMLElement>(".mmd.ready")) {
      block.classList.remove("ready", "mmd-err");
      roots.add(block.parentElement ?? block);
    }
    // Um de cada vez: o mermaid não gosta de renderizações simultâneas.
    for (const root of roots) await renderDiagrams(root);
  });
});
