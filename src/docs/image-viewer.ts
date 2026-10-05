// Imagem em tela cheia (Ctrl + clique num caminho de imagem no terminal):
// zoom e arrastar como nos diagramas, mais abrir, mostrar no Explorer e copiar.
import { ipc } from "../core/ipc";
import { t } from "../i18n";
import { esc, h } from "../ui/dom";
import { toast } from "../ui/feedback";
import { ICONS, PanZoom, toolbar } from "./mermaid";

export const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" };

const I = {
  open: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg>',
  folder: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M1.5 4.5a1 1 0 011-1h3.2l1.5 1.5h6.3a1 1 0 011 1v6.5a1 1 0 01-1 1h-11a1 1 0 01-1-1z"/></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2"/></svg>',
  path: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.8.8M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8a3 3 0 0 0 4.2 4.2l.8-.8"/></svg>',
};

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** PNG da imagem (a área de transferência só aceita PNG). */
async function toPng(img: HTMLImageElement, blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("png"))), "image/png"));
}

let current: (() => void) | null = null;

export async function openImage(path: string): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await ipc.fileBytes(path);
  } catch (e) {
    toast(t("docs.image.loadError", { error: String((e as Error)?.message ?? e) }));
    return;
  }
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const blob = new Blob([bytes as BlobPart], { type: IMAGE_MIME[ext] ?? "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.draggable = false;
  img.alt = fileName(path);
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    toast(t("docs.image.loadError", { error: fileName(path) }));
    return;
  }
  current?.();

  const box = h("div", "mmd-lightbox img-lightbox");
  const stage = h("div", "mmd-stage");
  stage.append(img);
  let pz: PanZoom | null = null;
  const btn = (act: string, title: string, icon: string) => `<button data-act="${act}" title="${esc(title)}">${icon}</button>`;
  const bar = toolbar(
    () => pz,
    `<i class="mmd-sep"></i>${btn("open", t("docs.image.open"), I.open)}${btn("reveal", t("docs.image.reveal"), I.folder)}${btn("copy", t("docs.image.copy"), I.copy)}${btn("path", t("docs.image.copyPath"), I.path)}<i class="mmd-sep"></i>${btn("close", t("docs.mermaid.close"), ICONS.close)}`,
  );
  const pct = bar.querySelector<HTMLElement>(".mmd-pct")!;
  const info = h(
    "div",
    "img-info",
    `<b>${esc(fileName(path))}</b><span>${img.naturalWidth} × ${img.naturalHeight} · ${fmtSize(bytes.length)}</span><span class="img-hint">${esc(t("docs.mermaid.hintFull"))}</span>`,
  );
  info.title = path;
  box.append(stage, bar, info);
  document.body.append(box);
  // Imagens pequenas (ícones) crescem até caber bem; as grandes não passam de 100%.
  const fitMax = Math.max(1, Math.min(8, 320 / Math.max(img.naturalWidth, img.naturalHeight, 1)));
  pz = new PanZoom(stage, img, {
    wheelNeedsCtrl: false,
    fitMax,
    onChange: () => {
      pct.textContent = `${Math.round(pz!.scale * 100)}%`;
      img.classList.toggle("pixelated", pz!.scale >= 3);
    },
  });
  pz.fit();

  const close = () => {
    box.remove();
    URL.revokeObjectURL(url);
    document.removeEventListener("keydown", onKey, true);
    current = null;
  };
  current = close;
  const run = async (act: string) => {
    if (act === "close") close();
    else if (act === "open") await ipc.fileOpen(path);
    else if (act === "reveal") await ipc.fileReveal(path);
    else if (act === "path") {
      await navigator.clipboard.writeText(path);
      toast(t("docs.image.pathCopied"));
    } else if (act === "copy") {
      const png = await toPng(img, blob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      toast(t("docs.image.copied"));
    }
  };
  const onKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = { Escape: close, "+": () => pz!.zoomAt(1.25), "=": () => pz!.zoomAt(1.25), "-": () => pz!.zoomAt(0.8), "0": () => pz!.fit(), "1": () => pz!.zoomAt(1 / pz!.scale) };
    let fn = e.ctrlKey ? undefined : keys[e.key];
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "c") fn = () => void run("copy").catch(() => toast(t("docs.image.copyError")));
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  document.addEventListener("keydown", onKey, true);
  bar.addEventListener("click", (e) => {
    const act = (e.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act) void run(act).catch((err) => toast(act === "copy" ? t("docs.image.copyError") : String((err as Error)?.message ?? err)));
  });
}
