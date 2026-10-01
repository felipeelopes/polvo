// Limites de uso por provedor: anéis compactos na barra de título + detalhe.
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import type { ToolKind, UsageSnapshot, UsageWindow } from "../core/types";
import { ago, until } from "./dom";
import { popover, refreshPopover } from "./feedback";
import { TOOLS, toolIcon } from "./icons";
import { t, tn } from "../i18n";

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

const source = (tool: ToolKind): string => (PROVIDERS.includes(tool) ? t(`usage.source.${tool}`) : "");

/** O backend manda os rótulos das janelas em português; traduz os conhecidos. */
function winLabel(w: UsageWindow): string {
  const fixed: Record<string, string> = {
    "Sessão (janela de 5h)": "usage.window.session5h",
    Semanal: "usage.window.weekly",
    "Gasto hoje": "usage.window.spentToday",
    "Gasto em 30 dias": "usage.window.spent30d",
  };
  if (fixed[w.label]) return t(fixed[w.label]);
  const days = /^Janela de (\d+) dias$/.exec(w.label);
  if (days) return t("usage.window.days", { n: days[1] });
  const hours = /^Janela de (\d+)h$/.exec(w.label);
  if (hours) return t("usage.window.hours", { n: hours[1] });
  return w.label;
}

function winShort(w: UsageWindow): string {
  if (w.short === "sem") return t("usage.short.week");
  if (w.short === "hoje") return t("usage.short.today");
  return w.short;
}

const planLabel = (plan: string): string => (plan === "Chaves de API próprias" ? t("usage.plan.ownKeys") : plan);

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
      const info = TOOLS[p];
      const { short, long } = split(u);
      if (short && long) {
        const s5 = Math.round(short.usedPercent!);
        const sl = Math.round(long.usedPercent!);
        return `<button class="ur${versionAction(p) ? " has-update" : ""}" data-pop data-p="${p}" title="${t("usage.ringsTitle", { outer: winLabel(long), inner: winLabel(short) })}">${doubleRing(sl, s5, p)}<div><b>${info.short}</b><span>${winShort(short)} ${s5}% · ${winShort(long)} ${sl}%</span></div></button>`;
      }
      if (w) {
        const pct = Math.round(w.usedPercent!);
        return `<button class="ur${versionAction(p) ? " has-update" : ""}" data-pop data-p="${p}">${ring(pct, levelColor(p, pct))}<div><b>${info.short}</b><span>${pct}% · ${winShort(w)}</span></div></button>`;
      }
      const value = u?.windows[0]?.value;
      return `<button class="ur${value ? "" : " none"}${versionAction(p) ? " has-update" : ""}" data-pop data-p="${p}">${ring(0, info.color)}<div><b>${info.short}</b><span>${value ? `${value} ${winShort(u!.windows[0])}` : t("usage.noData")}</span></div></button>`;
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
  const info = TOOLS[provider];
  const u: UsageSnapshot | undefined = store.usage.find((x) => x.provider === provider);
  const sessions = store.sessions.filter((s) => s.tool === provider);
  const rows = u
    ? u.windows
        .map((w) => {
          const pct = w.usedPercent;
          return `<div class="pr"><div class="pl"><span>${winLabel(w)}</span><b>${pct !== null ? `${Math.round(pct)}%` : (w.value ?? "—")}</b></div>
            ${pct !== null ? `<span class="bar"><i style="width:${pct}%;background:${levelColor(provider, pct)}"></i></span>` : ""}
            ${w.resetsAt ? `<div class="prs">${t("usage.resetsIn", { time: until(w.resetsAt) })}</div>` : ""}</div>`;
        })
        .join("")
    : `<p class="prs">${t("usage.empty")} ${provider === "claude" ? t("usage.emptyClaude") : t("usage.emptyOther")}</p>`;
  el.innerHTML = `<div class="poph" style="--acc:${info.color}"><span class="ic">${toolIcon(provider, 16)}</span><div><b>${info.name}</b><span>${u?.plan ? planLabel(u.plan) : info.vendor}</span></div></div>
    ${rows}
    ${versionSection(provider)}
    <div class="pf">${tn("usage.sessions", sessions.length)} · ${u ? t("usage.updated", { ago: ago(u.observedAt) }) : "—"}<br>${source(provider)}</div>`;
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
    <div class="pl"><span>${t("usage.installed")}</span><b>v${v.installed}</b></div>
    ${newer ? `<div class="pv-row"><span>${t("usage.newer", { version: newer })}</span><button class="primary sm" data-va="update">${t("usage.update")}</button></div>` : `<div class="prs">${t("usage.latest")}</div>`}
    ${old.length ? `<div class="pv-row"><span>${tn("usage.running", old.length, { versions: oldVersions })}</span><button class="primary sm" data-va="restart">${t("usage.restart", { version: v.installed })}</button></div>` : ""}
  </div>`;
}
