// Proteção ao fechar: com chats trabalhando ou aguardando você, pergunta antes.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { store } from "../core/store";
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
    .map((b) => `<li>${toolIcon(b.tool, 14)}<span>${esc(b.title)}</span><em>${b.status === "waiting" ? "aguardando você" : "trabalhando"}</em></li>`)
    .join("");
  modal.innerHTML = `<div class="mbox guard">
    <div class="hero">${logo(56, "idle")}<div><h2>Fechar o Polvo?</h2><div class="sub" style="margin:0">${busy.length === 1 ? "Há 1 chat em andamento." : `Há ${busy.length} chats em andamento.`} Se fechar agora, eles param e serão retomados quando você abrir o Polvo de novo.</div></div></div>
    <ul class="busy">${list}${busy.length > 6 ? `<li><span>e mais ${busy.length - 6}…</span></li>` : ""}</ul>
    <div class="mfoot"><span class="hk"></span><button class="ghost" data-stay>Continuar usando</button><button class="danger" data-close>Fechar mesmo assim</button></div>
  </div>`;
  modal.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest("[data-stay]") || t === modal) modal.remove();
    if (t.closest("[data-close]")) {
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
