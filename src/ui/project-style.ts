// Aparência do projeto: cor (paleta do `/color`) e ícone. Aparece no clique
// direito do projeto na barra lateral e nos diálogos de novo projeto/clonar.
import { colorValue, SESSION_COLORS } from "../core/appearance";
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import { t } from "../i18n";
import { esc, h } from "./dom";
import { closePopover, popover, popoverOpen, refreshPopover, toast } from "./feedback";
import { PROJECT_ICON_IDS, projectIcon } from "./icons";

export interface ProjectStyle {
  color: string | null;
  icon: string | null;
}

/** Botões de cor e ícone (`data-color` / `data-icon`); vazio = padrão. */
export function styleFields(st: ProjectStyle): string {
  const colors = [null, ...Object.keys(SESSION_COLORS)]
    .map((c) => `<button type="button" class="ps-sw${c === st.color ? " on" : ""}${c ? "" : " auto"}" data-color="${c ?? ""}" style="--c:${c ? SESSION_COLORS[c] : "transparent"}" title="${esc(c ?? t("projects.style.auto"))}"></button>`)
    .join("");
  // A pasta é o ícone padrão: escolhê-la limpa o ícone.
  const icons = PROJECT_ICON_IDS.map((id) => {
    const v = id === "folder" ? null : id;
    return `<button type="button" class="ps-ic${v === st.icon ? " on" : ""}" data-icon="${v ?? ""}">${projectIcon(id, 16)}</button>`;
  }).join("");
  return `<div class="ps" style="--pc:${colorValue(st.color) ?? "var(--muted)"}"><span class="ps-l">${t("projects.style.color")}</span><div class="ps-row">${colors}</div><span class="ps-l">${t("projects.style.icon")}</span><div class="ps-row">${icons}</div></div>`;
}

/** Aplica um clique dentro de `styleFields`; devolve true se mudou algo. */
export function pickStyle(target: Element, st: ProjectStyle): boolean {
  const c = target.closest<HTMLElement>("[data-color]");
  if (c) {
    st.color = c.dataset.color || null;
    return true;
  }
  const i = target.closest<HTMLElement>("[data-icon]");
  if (i) {
    st.icon = i.dataset.icon || null;
    return true;
  }
  return false;
}

/** Clique direito num projeto: escolhe cor e ícone, aplicados na hora. */
export function openProjectStyle(e: MouseEvent, key: string, path: string, name: string): void {
  e.preventDefault();
  // Clique direito em outro projeto com o menu aberto: troca de projeto em vez de só fechar.
  if (popoverOpen("project-style")) closePopover();
  const rec = store.projectRecord(key);
  const st: ProjectStyle = { color: rec?.color ?? null, icon: rec?.icon ?? null };
  // Grava no projeto salvo (que pode ser um worktree); sem projeto salvo, na pasta do grupo.
  const target = rec?.path ?? path;
  const at = h("div", "pop-at");
  at.style.left = `${e.clientX}px`;
  at.style.top = `${e.clientY}px`;
  document.body.append(at);
  const render = (el: HTMLDivElement) => {
    el.innerHTML = `<div class="mh">${esc(name)}</div>${styleFields(st)}<div class="ps-hint">${t("projects.style.hint")}</div>`;
    el.onclick = (ev) => {
      if (!pickStyle(ev.target as Element, st)) return;
      refreshPopover("project-style", render);
      ipc.projectStyle(target, st.color, st.icon).catch((err) => toast(String(err)));
    };
  };
  popover("project-style", at, render, "menu pstyle", () => at.remove(), "right");
}
