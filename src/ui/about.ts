// Tela "Sobre": versão, links, colaboradores (gerados do git) e atualizações.
import contributors from "../generated/contributors.json";
import { ipc } from "../core/ipc";
import { t, tn } from "../i18n";
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
        `<li title="${esc(tn("about.commits", c.commits))}"><span class="av" style="--h:${hue(c.name)}">${esc(initials(c.name))}</span>${esc(c.name)}</li>`,
    )
    .join("");
  box.innerHTML = `
    <div class="bubbles"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="about-hero">${appIcon(104, "wave")}<div><h2>Polvo</h2><div class="ver">${t("about.version", { version: __APP_VERSION__ })}</div>
      <p>${t("about.tagline")}</p></div></div>
    <div class="about-links">
      <button class="ghost" data-url="${REPO}">GitHub</button>
      <button class="ghost" data-url="${REPO}/issues/new/choose">${t("about.reportIssue")}</button>
      <button class="ghost" data-url="${REPO}/blob/main/LICENSE">${t("about.license")}</button>
      <button class="ghost" data-update>${t("about.checkUpdates")}</button>
    </div>
    <span class="lbl">${t("about.contributors")}</span>
    <ul class="people">${people || "<li>—</li>"}</ul>
    <p class="hk">${t("about.contribute")}</p>
    <div class="mfoot"><span class="hk"></span><button class="primary" data-close>${t("about.close")}</button></div>`;
  box.addEventListener("click", async (e) => {
    const tg = e.target as Element;
    const url = tg.closest<HTMLElement>("[data-url]")?.dataset.url;
    if (url) void ipc.openUrl(url);
    const upd = tg.closest<HTMLButtonElement>("[data-update]");
    if (upd) {
      upd.disabled = true;
      upd.textContent = t("about.checking");
      const found = await checkForUpdates(true);
      upd.textContent = found ? t("about.found") : t("about.upToDate");
    }
    if (tg.closest("[data-close]")) modal.remove();
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
