// Atualização automática a partir das releases do GitHub (tauri-plugin-updater).
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { store } from "../core/store";
import { esc, h } from "./dom";

const SIX_HOURS = 6 * 60 * 60 * 1000;
let banner: HTMLDivElement | null = null;
let dismissed: string | null = null;

export function startUpdateChecks(): void {
  const run = () => {
    if (store.settings.checkUpdates) void checkNow();
  };
  window.setTimeout(run, 8000);
  window.setInterval(run, SIX_HOURS);
}

async function checkNow(): Promise<void> {
  let update: Update | null = null;
  try {
    update = await check();
  } catch {
    return; // sem rede ou nenhuma release publicada ainda
  }
  if (!update || update.version === dismissed || banner) return;
  show(update);
}

function show(update: Update): void {
  banner = h("div", "update");
  banner.innerHTML = `<b>Polvo ${esc(update.version)} disponível</b><p>${esc(update.body?.trim() || "Melhorias e correções.")}</p>
    <div><button class="ghost" data-later>Depois</button><button class="primary" data-install>Atualizar e reiniciar</button></div>`;
  document.body.append(banner);
  banner.querySelector<HTMLButtonElement>("[data-later]")!.onclick = () => {
    dismissed = update.version;
    banner?.remove();
    banner = null;
  };
  banner.querySelector<HTMLButtonElement>("[data-install]")!.onclick = async () => {
    const el = banner!;
    el.innerHTML = `<b>Baixando Polvo ${esc(update.version)}…</b><span class="bar"><i style="width:0%;background:var(--accent)"></i></span><p>As sessões serão retomadas depois de reiniciar.</p>`;
    const fill = el.querySelector<HTMLElement>(".bar i")!;
    let total = 0;
    let done = 0;
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          if (total) fill.style.width = `${Math.min(100, (done / total) * 100)}%`;
        }
      });
      await relaunch();
    } catch (err) {
      el.innerHTML = `<b>Não foi possível atualizar</b><p>${esc(String(err))}</p><div><button class="ghost">Fechar</button></div>`;
      el.querySelector("button")!.onclick = () => {
        el.remove();
        banner = null;
      };
    }
  };
}
