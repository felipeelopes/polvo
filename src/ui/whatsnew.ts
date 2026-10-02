// "Novidades": depois de atualizar, mostra uma vez o que mudou, no idioma do app.
import { cmpVersion, RELEASES } from "../changelog";
import { locale, t } from "../i18n";
import "../styles/whatsnew.css";
import { esc, h } from "./dom";
import { logo } from "./logo";

const KEY = "polvo.seenVersion";

/** Notas em Markdown simples (negrito e código) → HTML seguro. */
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

/**
 * Chamado ao iniciar. Na primeira execução só lembra a versão; quem já usava
 * uma versão anterior (inclusive antes deste recurso existir) vê as novidades.
 */
export function showWhatsNew(current: string, onboarded: boolean): void {
  let seen: string | null = null;
  try {
    seen = localStorage.getItem(KEY);
    localStorage.setItem(KEY, current);
  } catch {
    return;
  }
  // Instalação nova: nada a mostrar. Sem registro mas já configurado = veio de uma versão antiga.
  if (!seen && !onboarded) return;
  const from = seen ?? "0.0.0";
  if (cmpVersion(current, from) <= 0) return;
  const releases = RELEASES.filter((r) => cmpVersion(r.version, from) > 0 && cmpVersion(r.version, current) <= 0);
  if (!releases.length) return;
  // Sem registro (versão antiga): só a versão atual, para não despejar o histórico todo.
  open(seen ? releases : releases.slice(0, 1));
}

function open(releases: typeof RELEASES): void {
  const lang = locale();
  const modal = h("div", "modal whatsnew");
  const sections = releases
    .map((r) => {
      const notes = r.notes[lang] ?? r.notes.en;
      return `<section><div class="wn-v">v${esc(r.version)}</div><ul>${notes.map((n) => `<li>${inline(n)}</li>`).join("")}</ul></section>`;
    })
    .join("");
  modal.innerHTML = `<div class="mbox wn"><div class="hero">${logo(56, "wave")}<div><div class="step">${esc(t("whatsNew.kicker"))}</div><h2>${esc(t("whatsNew.title", { version: releases[0].version }))}</h2></div></div>
    <div class="wn-body">${sections}</div>
    <div class="mfoot"><span class="hk"></span><button class="primary" data-ok>${esc(t("whatsNew.ok"))}</button></div></div>`;
  const close = () => modal.remove();
  modal.addEventListener("click", (e) => {
    if (e.target === modal || (e.target as Element).closest("[data-ok]")) close();
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Enter") close();
  });
  document.body.append(modal);
  modal.querySelector<HTMLButtonElement>("[data-ok]")!.focus();
}
