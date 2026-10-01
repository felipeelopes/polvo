// Tela "Sobre": versão, links, colaboradores (gerados do git) e atualizações.
import contributors from "../generated/contributors.json";
import { ipc } from "../core/ipc";
import { esc, h } from "./dom";
import { appIcon } from "./logo";
import { checkForUpdates } from "./updater";

const REPO = "https://github.com/felipeelopes/polvo";

interface Contributor {
  name: string;
  commits: number;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

/** Cor estável por nome, para os avatares. */
function hue(name: string): number {
  let x = 0;
  for (const c of name) x = (x * 31 + c.charCodeAt(0)) % 360;
  return x;
}

export function openAbout(): void {
  const modal = h("div", "modal");
  const box = h("div", "mbox about");
  modal.append(box);
  const people = (contributors as Contributor[])
    .map(
      (c) =>
        `<li title="${c.commits} ${c.commits === 1 ? "commit" : "commits"}"><span class="av" style="--h:${hue(c.name)}">${esc(initials(c.name))}</span>${esc(c.name)}</li>`,
    )
    .join("");
  box.innerHTML = `
    <div class="bubbles"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="about-hero">${appIcon(104, "wave")}<div><h2>Polvo</h2><div class="ver">Versão ${__APP_VERSION__}</div>
      <p>Seus agentes de IA lado a lado. Um braço para cada agente.</p></div></div>
    <div class="about-links">
      <button class="ghost" data-url="${REPO}">GitHub</button>
      <button class="ghost" data-url="${REPO}/issues/new/choose">Reportar problema</button>
      <button class="ghost" data-url="${REPO}/blob/main/LICENSE">Licença MIT</button>
      <button class="ghost" data-update>Procurar atualizações</button>
    </div>
    <span class="lbl">Colaboradores</span>
    <ul class="people">${people || "<li>—</li>"}</ul>
    <p class="hk">Quer aparecer aqui? Contribuições são bem-vindas: veja o CONTRIBUTING.md no GitHub.</p>
    <div class="mfoot"><span class="hk"></span><button class="primary" data-close>Fechar</button></div>`;
  box.addEventListener("click", async (e) => {
    const t = e.target as Element;
    const url = t.closest<HTMLElement>("[data-url]")?.dataset.url;
    if (url) void ipc.openUrl(url);
    const upd = t.closest<HTMLButtonElement>("[data-update]");
    if (upd) {
      upd.disabled = true;
      upd.textContent = "Procurando…";
      const found = await checkForUpdates(true);
      upd.textContent = found ? "Atualização disponível!" : "Você está na versão mais recente";
    }
    if (t.closest("[data-close]")) modal.remove();
  });
  modal.addEventListener("pointerdown", (e) => {
    if (e.target === modal) modal.remove();
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modal.remove();
  });
  document.body.append(modal);
  box.querySelector<HTMLButtonElement>("[data-close]")!.focus();
}
