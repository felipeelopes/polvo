// Projetos: abrir uma pasta, criar uma nova ou clonar um repositório.
// Cada projeto aparece na barra lateral; o "+" ao lado do nome inicia direto.
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import type { ToolKind } from "../core/types";
import { basename, esc, h } from "./dom";
import { closePopover, popover, toast } from "./feedback";
import { ICON, TOOLS, toolIcon } from "./icons";
import { t } from "../i18n";

export interface ProjectHost {
  /** Inicia uma sessão no projeto recém-aberto. */
  start(cwd: string, tool: ToolKind): void;
  /** Diálogo completo de nova sessão (qualquer pasta, qualquer ferramenta). */
  openDialog(): void;
}

/** Ferramenta padrão para começar num projeto novo. */
export function defaultTool(): ToolKind {
  return (["claude", "codex", "opencode", "shell"] as ToolKind[]).find((k) => store.toolEnabled(k)) ?? "shell";
}

/** Pasta-mãe sugerida para criar ou clonar: ao lado do projeto em foco ou do mais recente. */
function suggestedParent(): string {
  const focused = store.session(store.active);
  const base = focused ? (store.git[focused.cwd]?.project ?? focused.cwd) : undefined;
  const recent = base ?? store.projects[store.projects.length - 1]?.path ?? store.recentDirs[0] ?? store.sessions[0]?.cwd ?? "";
  return recent ? recent.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "") : "";
}

export function openProjectMenu(anchor: HTMLElement, host: ProjectHost): void {
  popover(
    "projects",
    anchor,
    (el) => {
      el.innerHTML = `<div class="mh">${t("projects.menu.title")}</div>
        <button data-p="open">${ICON.folder} ${t("projects.menu.open")}<small>${t("projects.menu.openSub")}</small></button>
        <button data-p="new">${ICON.plus} ${t("projects.menu.new")}<small>${t("projects.menu.newSub")}</small></button>
        <button data-p="clone">${ICON.branch} ${t("projects.menu.clone")}<small>git clone</small></button>
        <hr><button data-p="session">${ICON.terminal} ${t("projects.menu.session")}<small>${t("projects.menu.sessionSub")}</small></button>`;
      el.onclick = (e) => {
        const p = (e.target as Element).closest<HTMLElement>("[data-p]")?.dataset.p;
        if (!p) return;
        closePopover();
        if (p === "open") void openProject(host);
        if (p === "new") newProjectDialog(host);
        if (p === "clone") cloneDialog(host);
        if (p === "session") host.openDialog();
      };
    },
    "menu",
  );
}

/** Escolhe uma pasta existente, adiciona como projeto e já inicia uma sessão. */
export async function openProject(host: ProjectHost): Promise<void> {
  const picked = await open({ directory: true, title: t("projects.openTitle"), defaultPath: suggestedParent() || undefined });
  if (typeof picked !== "string") return;
  try {
    const p = await ipc.projectAdd(picked);
    host.start(p.path, defaultTool());
  } catch (e) {
    toast(String(e));
  }
}

function toolPicker(selected: ToolKind): string {
  return `<div class="tools">${(Object.keys(TOOLS) as ToolKind[])
    .filter((k) => !store.settings.disabledTools.includes(k))
    .map(
      (k) =>
        `<button class="tool${k === selected ? " on" : ""}" data-t="${k}" style="--acc:${TOOLS[k].color}" ${store.tools[k] ? "" : "disabled"}><span class="ic">${toolIcon(k, 17)}</span><b>${TOOLS[k].short}</b><small>${store.tools[k] ? TOOLS[k].vendor : t("projects.notInstalled")}</small></button>`,
    )
    .join("")}</div>`;
}

function dialog(build: (box: HTMLElement, close: () => void) => void): void {
  const modal = h("div", "modal");
  const box = h("div", "mbox");
  modal.append(box);
  const close = () => modal.remove();
  modal.addEventListener("pointerdown", (e) => {
    if (e.target === modal) close();
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  build(box, close);
  document.body.append(modal);
  box.querySelector<HTMLInputElement>("input")?.focus();
}

/** Cria uma pasta nova (com git opcional) e inicia uma sessão nela. */
export function newProjectDialog(host: ProjectHost): void {
  let tool = defaultTool();
  dialog((box, close) => {
    const render = () => {
      const name = box.querySelector<HTMLInputElement>("[data-name]")?.value ?? "";
      const parent = box.querySelector<HTMLInputElement>("[data-parent]")?.value ?? suggestedParent();
      box.innerHTML = `<h2>${t("projects.newDialog.title")}</h2><div class="sub">${t("projects.newDialog.sub")}</div>
        <span class="lbl">${t("projects.newDialog.name")}</span><input class="txt" data-name placeholder="${esc(t("projects.newDialog.namePlaceholder"))}" value="${esc(name)}" autocomplete="off" spellcheck="false">
        <span class="lbl">${t("projects.newDialog.parent")}</span><div class="path"><input class="txt" data-parent value="${esc(parent)}" spellcheck="false"><button class="ghost" data-browse>${t("projects.browse")}</button></div>
        <label class="chk"><input type="checkbox" data-git checked> ${t("projects.newDialog.git")}</label>
        <span class="lbl">${t("projects.startWith")}</span>${toolPicker(tool)}
        <div class="err"></div>
        <div class="mfoot"><span class="hk">${t("projects.newDialog.hint")}</span><button class="ghost" data-cancel>${t("projects.cancel")}</button><button class="primary" data-create>${t("projects.newDialog.create")}</button></div>`;
    };
    const create = async () => {
      const name = box.querySelector<HTMLInputElement>("[data-name]")!.value.trim();
      const parent = box.querySelector<HTMLInputElement>("[data-parent]")!.value.trim();
      const git = box.querySelector<HTMLInputElement>("[data-git]")!.checked;
      try {
        const p = await ipc.projectCreate(parent, name, git);
        close();
        host.start(p.path, tool);
      } catch (e) {
        box.querySelector<HTMLElement>(".err")!.textContent = String(e);
      }
    };
    box.addEventListener("click", async (e) => {
      const target = e.target as Element;
      const tb = target.closest<HTMLButtonElement>("[data-t]");
      if (tb && !tb.disabled) {
        tool = tb.dataset.t as ToolKind;
        box.querySelectorAll(".tool").forEach((x) => x.classList.toggle("on", x === tb));
      }
      if (target.closest("[data-browse]")) {
        const picked = await open({ directory: true, title: t("projects.newDialog.parentPicker") });
        if (typeof picked === "string") box.querySelector<HTMLInputElement>("[data-parent]")!.value = picked;
      }
      if (target.closest("[data-cancel]")) close();
      if (target.closest("[data-create]")) void create();
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void create();
      }
    });
    render();
  });
}

/** Clona um repositório git e inicia uma sessão nele. */
export function cloneDialog(host: ProjectHost): void {
  let tool = defaultTool();
  dialog((box, close) => {
    box.innerHTML = `<h2>${t("projects.cloneDialog.title")}</h2><div class="sub">${t("projects.cloneDialog.sub")}</div>
      <span class="lbl">${t("projects.cloneDialog.url")}</span><input class="txt" data-url placeholder="${esc(t("projects.cloneDialog.urlPlaceholder"))}" autocomplete="off" spellcheck="false">
      <span class="lbl">${t("projects.cloneDialog.parent")}</span><div class="path"><input class="txt" data-parent value="${esc(suggestedParent())}" spellcheck="false"><button class="ghost" data-browse>${t("projects.browse")}</button></div>
      <span class="lbl">${t("projects.startWith")}</span>${toolPicker(tool)}
      <div class="err"></div>
      <div class="mfoot"><span class="hk">${t("projects.cloneDialog.hint")}</span><button class="ghost" data-cancel>${t("projects.cancel")}</button><button class="primary" data-create>${t("projects.cloneDialog.create")}</button></div>`;
    const create = async () => {
      const url = box.querySelector<HTMLInputElement>("[data-url]")!.value.trim();
      const parent = box.querySelector<HTMLInputElement>("[data-parent]")!.value.trim();
      const btn = box.querySelector<HTMLButtonElement>("[data-create]")!;
      btn.disabled = true;
      btn.textContent = t("projects.cloneDialog.cloning");
      try {
        const p = await ipc.projectClone(url, parent);
        close();
        toast(t("projects.cloneDialog.cloned", { name: basename(p.path) }));
        host.start(p.path, tool);
      } catch (e) {
        box.querySelector<HTMLElement>(".err")!.textContent = String(e);
        btn.disabled = false;
        btn.textContent = t("projects.cloneDialog.create");
      }
    };
    box.addEventListener("click", async (e) => {
      const target = e.target as Element;
      const tb = target.closest<HTMLButtonElement>("[data-t]");
      if (tb && !tb.disabled) {
        tool = tb.dataset.t as ToolKind;
        box.querySelectorAll(".tool").forEach((x) => x.classList.toggle("on", x === tb));
      }
      if (target.closest("[data-browse]")) {
        const picked = await open({ directory: true, title: t("projects.cloneDialog.parentPicker") });
        if (typeof picked === "string") box.querySelector<HTMLInputElement>("[data-parent]")!.value = picked;
      }
      if (target.closest("[data-cancel]")) close();
      if (target.closest("[data-create]")) void create();
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void create();
      }
    });
  });
}
