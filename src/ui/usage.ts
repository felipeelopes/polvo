// Limites de uso por provedor: anéis compactos na barra de título + detalhe.
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import type { ToolKind, UsageSnapshot } from "../core/types";
import { ago, until } from "./dom";
import { popover, refreshPopover } from "./feedback";
import { TOOLS, toolIcon } from "./icons";

const PROVIDERS: ToolKind[] = ["claude", "codex", "opencode"];

/** Compara versões "x.y.z": positivo se a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const RUNNING = new Set(["starting", "working", "waiting", "idle"]);

/** Sessões rodando uma versão diferente da instalada (o CLI foi atualizado). */
export function outdatedSessions(tool: ToolKind) {
  const installed = store.versions[tool]?.installed;
  if (!installed) return [];
  return store.sessions.filter((s) => s.tool === tool && RUNNING.has(s.runtime.status) && s.runtime.version && s.runtime.version !== installed);
}

const newerAvailable = (tool: ToolKind): string | null => {
  const v = store.versions[tool];
  return v?.installed && v.latest && compareVersions(v.latest, v.installed) > 0 ? v.latest : null;
};

/** Há algo a fazer (atualizar o CLI ou reiniciar sessões)? */
export const versionAction = (tool: ToolKind) => outdatedSessions(tool).length > 0 || !!newerAvailable(tool);

/** Ações registradas pelo App (reiniciar sessões, rodar o atualizador). */
export const versionActions = {
  restart: (_tool: ToolKind) => {},
  update: (_tool: ToolKind) => {},
};

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

/** Provedores exibidos: ativos e com dados ou sessões abertas. */
function visibleProviders(): ToolKind[] {
  return PROVIDERS.filter(
    (p) => !store.settings.disabledTools.includes(p) && (store.usage.some((u) => u.provider === p) || store.sessions.some((s) => s.tool === p)),
  );
}

/** Dois anéis concêntricos: fora = janela longa (semanal), dentro = 5h. */
export function doubleRing(outer: number, inner: number, tool: ToolKind, size = 30): string {
  const c = size / 2;
  const arc = (r: number, p: number, color: string, sw: number) => {
    const len = 2 * Math.PI * r;
    return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="${sw}"/><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(len * Math.min(100, Math.max(0, p))) / 100} ${len}"/>`;
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">${arc(c - 2, outer, levelColor(tool, outer), 3)}${arc(c - 7.5, inner, levelColor(tool, inner), 3)}</svg>`;
}

/** Janelas com percentual, separadas em curta (5h) e longa (semanal…). */
function split(u: UsageSnapshot | undefined) {
  const pct = (u?.windows ?? []).filter((w) => w.usedPercent !== null);
  const short = pct.find((w) => w.short === "5h");
  const long = pct.find((w) => w !== short);
  return { short, long };
}

export function renderRings(container: HTMLElement): void {
  container.innerHTML = visibleProviders()
    .map((p) => {
      const u = store.usage.find((x) => x.provider === p);
      const w = u?.windows.find((x) => x.usedPercent !== null);
      const t = TOOLS[p];
      const { short, long } = split(u);
      if (short && long) {
        const s5 = Math.round(short.usedPercent!);
        const sl = Math.round(long.usedPercent!);
        return `<button class="ur${versionAction(p) ? " has-update" : ""}" data-pop data-p="${p}" title="Anel de fora: ${long.label} · anel de dentro: ${short.label}">${doubleRing(sl, s5, p)}<div><b>${t.short}</b><span>5h ${s5}% · ${long.short} ${sl}%</span></div></button>`;
      }
      if (w) {
        const pct = Math.round(w.usedPercent!);
        return `<button class="ur${versionAction(p) ? " has-update" : ""}" data-pop data-p="${p}">${ring(pct, levelColor(p, pct))}<div><b>${t.short}</b><span>${pct}% · ${w.short}</span></div></button>`;
      }
      const value = u?.windows[0]?.value;
      return `<button class="ur${value ? "" : " none"}${versionAction(p) ? " has-update" : ""}" data-pop data-p="${p}">${ring(0, t.color)}<div><b>${t.short}</b><span>${value ? `${value} ${u!.windows[0].short}` : "sem dados"}</span></div></button>`;
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
    ${versionSection(provider)}
    <div class="pf">${sessions.length} ${sessions.length === 1 ? "sessão" : "sessões"} · ${u ? `atualizado ${ago(u.observedAt)}` : "—"}<br>${SOURCE[provider]}</div>`;
  el.onclick = (e) => {
    const a = (e.target as Element).closest<HTMLElement>("[data-va]")?.dataset.va;
    if (a === "restart") versionActions.restart(provider);
    if (a === "update") versionActions.update(provider);
  };
}

function versionSection(tool: ToolKind): string {
  const v = store.versions[tool];
  if (!v?.installed) return "";
  const old = outdatedSessions(tool);
  const newer = newerAvailable(tool);
  const oldVersions = [...new Set(old.map((s) => s.runtime.version))].join(", ");
  return `<div class="pv">
    <div class="pl"><span>Versão instalada</span><b>v${v.installed}</b></div>
    ${newer ? `<div class="pv-row"><span>Nova versão <b>v${newer}</b> disponível</span><button class="primary sm" data-va="update">Atualizar</button></div>` : '<div class="prs">Você está na versão mais recente.</div>'}
    ${old.length ? `<div class="pv-row"><span>${old.length} ${old.length === 1 ? "sessão rodando" : "sessões rodando"} v${oldVersions}</span><button class="primary sm" data-va="restart">Reiniciar na v${v.installed}</button></div>` : ""}
  </div>`;
}
