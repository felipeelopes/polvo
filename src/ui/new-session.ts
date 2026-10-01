// Diálogo de nova sessão: ferramenta, pasta, nome e modo de início.
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import type { Side, StartMode, ToolKind } from "../core/types";
import { basename, esc, h } from "./dom";
import { TOOLS, toolIcon } from "./icons";
import { t } from "../i18n";

export interface NewSessionTarget {
  id: string;
  side: Side;
}

let lastTool: ToolKind = "claude";

export interface NewSessionOptions {
  /** Pasta já escolhida (ex.: "Abrir no Polvo" pelo Explorer). */
  cwd?: string;
}

export function openNewSession(
  onCreated: (id: string, target?: NewSessionTarget) => void,
  target?: NewSessionTarget,
  opts: NewSessionOptions = {},
): void {
  const modal = h("div", "modal");
  const box = h("div", "mbox");
  modal.append(box);
  const near = target ? store.session(target.id) : undefined;
  const choices = (Object.keys(TOOLS) as ToolKind[]).filter((t) => !store.settings.disabledTools.includes(t));
  let tool: ToolKind = store.toolEnabled(lastTool) ? lastTool : (choices.find((t) => store.tools[t]) ?? "shell");
  let cwd = opts.cwd ?? near?.cwd ?? store.recentDirs[0] ?? "";
  let mode: StartMode = "new";

  const render = () => {
    box.innerHTML = `
      <h2>${opts.cwd ? t("newSession.openIn", { name: esc(basename(opts.cwd)) }) : t("newSession.title")}</h2>
      <div class="sub">${opts.cwd ? t("newSession.openInSub") : near ? t(target!.side === "right" ? "newSession.nearRight" : "newSession.nearBelow", { title: esc(near.title) }) : t("newSession.freeSpace")}</div>
      <div class="tools" style="grid-template-columns:repeat(${choices.length},1fr)">${choices
        .map(
          (k) =>
            `<button class="tool${k === tool ? " on" : ""}" data-t="${k}" style="--acc:${TOOLS[k].color}" ${store.tools[k] ? "" : `disabled title="${t("newSession.notInPath")}"`}><span class="ic">${toolIcon(k, 17)}</span><b>${TOOLS[k].short}</b><small>${store.tools[k] ? TOOLS[k].vendor : t("newSession.notInstalled")}</small></button>`,
        )
        .join("")}</div>
      <span class="lbl">${t("newSession.folder")}</span>
      <div class="path"><input class="txt" data-cwd placeholder="${esc(t("newSession.folderPlaceholder"))}" value="${esc(cwd)}" spellcheck="false"><button class="ghost" data-browse>${t("newSession.browse")}</button></div>
      ${store.recentDirs.length ? `<div class="chips">${store.recentDirs.slice(0, 8).map((d) => `<button data-dir="${esc(d)}" class="${d === cwd ? "on" : ""}" title="${esc(d)}">${esc(basename(d))}</button>`).join("")}</div>` : ""}
      <span class="lbl">${t("newSession.name")}</span>
      <input class="txt" data-name placeholder="${esc(t("newSession.namePlaceholder"))}" autocomplete="off">
      ${tool === "shell" ? "" : `<span class="lbl">${t("newSession.start")}</span><div class="chips"><button data-mode="new" class="${mode === "new" ? "on" : ""}">${t("newSession.modeNew")}</button><button data-mode="continue" class="${mode === "continue" ? "on" : ""}">${t("newSession.modeContinue")}</button></div>`}
      <div class="err"></div>
      <div class="mfoot"><span class="hk">${t("newSession.hint")}</span><button class="ghost" data-cancel>${t("newSession.cancel")}</button><button class="primary" data-create>${t("newSession.create")}</button></div>`;
    box.querySelector<HTMLInputElement>("[data-name]")!.focus();
  };

  const close = () => modal.remove();
  const create = async () => {
    const err = box.querySelector<HTMLElement>(".err")!;
    cwd = box.querySelector<HTMLInputElement>("[data-cwd]")!.value.trim();
    if (!cwd) {
      err.textContent = t("newSession.folderRequired");
      return;
    }
    const btn = box.querySelector<HTMLButtonElement>("[data-create]")!;
    btn.disabled = true;
    try {
      lastTool = tool;
      const title = box.querySelector<HTMLInputElement>("[data-name]")!.value.trim() || undefined;
      const id = await ipc.sessionCreate({ tool, cwd, title, mode, window: store.label });
      if (!store.recentDirs.includes(cwd)) store.recentDirs.unshift(cwd);
      close();
      onCreated(id, target);
    } catch (e) {
      err.textContent = String(e);
      btn.disabled = false;
    }
  };

  box.addEventListener("click", async (e) => {
    const target = e.target as Element;
    const toolBtn = target.closest<HTMLButtonElement>("[data-t]");
    if (toolBtn && !toolBtn.disabled) {
      tool = toolBtn.dataset.t as ToolKind;
      cwd = box.querySelector<HTMLInputElement>("[data-cwd]")!.value;
      render();
    }
    const dir = target.closest<HTMLElement>("[data-dir]")?.dataset.dir;
    if (dir) {
      cwd = dir;
      render();
    }
    const m = target.closest<HTMLElement>("[data-mode]")?.dataset.mode as StartMode | undefined;
    if (m) {
      mode = m;
      cwd = box.querySelector<HTMLInputElement>("[data-cwd]")!.value;
      render();
    }
    if (target.closest("[data-browse]")) {
      const picked = await open({ directory: true, defaultPath: cwd || undefined, title: t("newSession.folder") });
      if (typeof picked === "string") {
        cwd = picked;
        render();
      }
    }
    if (target.closest("[data-cancel]")) close();
    if (target.closest("[data-create]")) void create();
  });
  modal.addEventListener("pointerdown", (e) => {
    if (e.target === modal) close();
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter") {
      e.preventDefault();
      void create();
    }
  });
  render();
  document.body.append(modal);
}
