// Limites de uso por provedor: anéis compactos na barra de título + detalhe.
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import type { ToolKind, UsageSnapshot } from "../core/types";
import { ago, until } from "./dom";
import { popover, refreshPopover } from "./feedback";
import { TOOLS, toolIcon } from "./icons";

const PROVIDERS: ToolKind[] = ["claude", "codex", "opencode"];

const SOURCE: Record<string, string> = {
  claude: "Lido pela statusline do Claude Code (planos Pro/Max).",
  codex: "Lido dos arquivos de sessão do Codex.",
  opencode: "Via opencode stats (chaves de API próprias, sem limite de plano).",
};

export const levelColor = (tool: ToolKind, p: number) => (p >= 85 ? "#E5534B" : p >= 75 ? "#E5A33A" : TOOLS[tool].color);

export function ring(p: number, color: string, size = 26, sw = 3, track = "rgba(255,255,255,.14)"): string {
  const r = (size - sw) / 2;
  const len = 2 * Math.PI * r;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${sw}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(len * Math.min(100, Math.max(0, p))) / 100} ${len}"/></svg>`;
}

export async function refreshUsage(): Promise<void> {
  try {
    store.usage = await ipc.usage();
    store.emit("usage");
  } catch {
    /* sem dados ainda */
  }
}

/** Provedores exibidos: os que têm dados ou sessões abertas. */
function visibleProviders(): ToolKind[] {
  return PROVIDERS.filter((p) => store.usage.some((u) => u.provider === p) || store.sessions.some((s) => s.tool === p));
}

export function renderRings(container: HTMLElement): void {
  container.innerHTML = visibleProviders()
    .map((p) => {
      const u = store.usage.find((x) => x.provider === p);
      const w = u?.windows.find((x) => x.usedPercent !== null);
      const t = TOOLS[p];
      if (w) {
        const pct = Math.round(w.usedPercent!);
        return `<button class="ur" data-pop data-p="${p}">${ring(pct, levelColor(p, pct))}<div><b>${t.short}</b><span>${pct}% · ${w.short}</span></div></button>`;
      }
      const value = u?.windows[0]?.value;
      return `<button class="ur${value ? "" : " none"}" data-pop data-p="${p}">${ring(0, t.color)}<div><b>${t.short}</b><span>${value ? `${value} ${u!.windows[0].short}` : "sem dados"}</span></div></button>`;
    })
    .join("");
}

export function openUsage(provider: ToolKind, anchor: HTMLElement): void {
  popover(`usage:${provider}`, anchor, (el) => paint(el, provider));
}

export function refreshUsagePopovers(): void {
  for (const p of PROVIDERS) refreshPopover(`usage:${p}`, (el) => paint(el, p));
}

function paint(el: HTMLElement, provider: ToolKind): void {
  const t = TOOLS[provider];
  const u: UsageSnapshot | undefined = store.usage.find((x) => x.provider === provider);
  const sessions = store.sessions.filter((s) => s.tool === provider);
  const rows = u
    ? u.windows
        .map((w) => {
          const pct = w.usedPercent;
          return `<div class="pr"><div class="pl"><span>${w.label}</span><b>${pct !== null ? `${Math.round(pct)}%` : (w.value ?? "—")}</b></div>
            ${pct !== null ? `<span class="bar"><i style="width:${pct}%;background:${levelColor(provider, pct)}"></i></span>` : ""}
            ${w.resetsAt ? `<div class="prs">reinicia em ${until(w.resetsAt)}</div>` : ""}</div>`;
        })
        .join("")
    : `<p class="prs">Ainda sem dados. ${provider === "claude" ? "Os limites aparecem depois da primeira resposta numa sessão do Claude Code aberta pelo Polvo (planos Pro/Max)." : "Abra e use uma sessão para começar a medir."}</p>`;
  el.innerHTML = `<div class="poph" style="--acc:${t.color}"><span class="ic">${toolIcon(provider, 16)}</span><div><b>${t.name}</b><span>${u?.plan ?? t.vendor}</span></div></div>
    ${rows}
    <div class="pf">${sessions.length} ${sessions.length === 1 ? "sessão" : "sessões"} · ${u ? `atualizado ${ago(u.observedAt)}` : "—"}<br>${SOURCE[provider]}</div>`;
}
