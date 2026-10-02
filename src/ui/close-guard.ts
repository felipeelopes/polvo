// Proteção ao fechar: com chats trabalhando ou aguardando você, pergunta antes.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { store } from "../core/store";
import { t, tn } from "../i18n";
import { esc, h } from "./dom";
import { TOOLS, toolIcon } from "./icons";
import { logo } from "./logo";

const BUSY = new Set(["working", "waiting", "starting"]);
let allow = false;

export function installCloseGuard(): void {
  // Só a janela principal encerra o app; fechar uma janela extra não para nada.
  if (!store.isMain) return;
  const win = getCurrentWindow();
  void win.onCloseRequested((event) => {
    const busy = store.sessions.filter((s) => BUSY.has(s.runtime.status));
    if (allow || !busy.length) return;
    event.preventDefault();
    confirmClose(busy.map((s) => ({ title: s.title, tool: s.tool, status: s.runtime.status })), () => {
      allow = true;
      void win.close();
    });
  });
}

function confirmClose(busy: { title: string; tool: keyof typeof TOOLS; status: string }[], onConfirm: () => void): void {
  document.querySelector(".modal.close-guard")?.remove();
  const modal = h("div", "modal close-guard");
  const list = busy
    .slice(0, 6)
    .map((b) => `<li>${toolIcon(b.tool, 14)}<span>${esc(b.title)}</span><em>${b.status === "waiting" ? t("guard.waiting") : t("guard.working")}</em></li>`)
    .join("");
  modal.innerHTML = `<div class="mbox guard">
    <div class="hero">${logo(56, "idle", { look: true })}<div><h2>${t("guard.title")}</h2><div class="sub" style="margin:0">${tn("guard.busy", busy.length)} ${t("guard.explain")}</div></div></div>
    <ul class="busy">${list}${busy.length > 6 ? `<li><span>${t("guard.more", { n: busy.length - 6 })}</span></li>` : ""}</ul>
    <div class="mfoot"><span class="hk"></span><button class="ghost" data-stay>${t("guard.stay")}</button><button class="danger" data-close>${t("guard.close")}</button></div>
  </div>`;
  modal.addEventListener("click", (e) => {
    const tg = e.target as Element;
    if (tg.closest("[data-stay]") || tg === modal) modal.remove();
    if (tg.closest("[data-close]")) {
      modal.remove();
      onConfirm();
    }
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modal.remove();
  });
  document.body.append(modal);
  modal.querySelector<HTMLButtonElement>("[data-stay]")!.focus();
}
