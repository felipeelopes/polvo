// Projetos: abrir uma pasta, criar uma nova ou clonar um repositório.
// Cada projeto aparece na barra lateral; o "+" ao lado do nome inicia direto.
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import type { ToolKind } from "../core/types";
import { basename, esc, h } from "./dom";
import { closePopover, popover, toast } from "./feedback";
import { ICON, TOOLS, toolIcon } from "./icons";

export interface ProjectHost {
  /** Inicia uma sessão no projeto recém-aberto. */
  start(cwd: string, tool: ToolKind): void;
  /** Diálogo completo de nova sessão (qualquer pasta, qualquer ferramenta). */
  openDialog(): void;
}

/** Ferramenta padrão para começar num projeto novo. */
export function defaultTool(): ToolKind {
  return (["claude", "codex", "opencode", "shell"] as ToolKind[]).find((t) => store.toolEnabled(t)) ?? "shell";
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
      el.innerHTML = `<div class="mh">Projeto</div>
        <button data-p="open">${ICON.folder} Abrir projeto…<small>pasta existente</small></button>
        <button data-p="new">${ICON.plus} Novo projeto…<small>cria a pasta</small></button>
        <button data-p="clone">${ICON.branch} Clonar repositório…<small>git clone</small></button>
        <hr><button data-p="session">${ICON.terminal} Nova sessão…<small>qualquer pasta e agente</small></button>`;
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
  const picked = await open({ directory: true, title: "Abrir projeto", defaultPath: suggestedParent() || undefined });
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
    .filter((t) => !store.settings.disabledTools.includes(t))
    .map(
      (t) =>
        `<button class="tool${t === selected ? " on" : ""}" data-t="${t}" style="--acc:${TOOLS[t].color}" ${store.tools[t] ? "" : "disabled"}><span class="ic">${toolIcon(t, 17)}</span><b>${TOOLS[t].short}</b><small>${store.tools[t] ? TOOLS[t].vendor : "não instalado"}</small></button>`,
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
      box.innerHTML = `<h2>Novo projeto</h2><div class="sub">Cria a pasta do projeto e já abre um agente nela.</div>
        <span class="lbl">Nome</span><input class="txt" data-name placeholder="ex.: minha-api" value="${esc(name)}" autocomplete="off" spellcheck="false">
        <span class="lbl">Criar dentro de</span><div class="path"><input class="txt" data-parent value="${esc(parent)}" spellcheck="false"><button class="ghost" data-browse>Procurar…</button></div>
        <label class="chk"><input type="checkbox" data-git checked> Iniciar repositório git</label>
        <span class="lbl">Começar com</span>${toolPicker(tool)}
        <div class="err"></div>
        <div class="mfoot"><span class="hk">Enter cria · Esc cancela</span><button class="ghost" data-cancel>Cancelar</button><button class="primary" data-create>Criar projeto</button></div>`;
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
      const t = e.target as Element;
      const tb = t.closest<HTMLButtonElement>("[data-t]");
      if (tb && !tb.disabled) {
        tool = tb.dataset.t as ToolKind;
        box.querySelectorAll(".tool").forEach((x) => x.classList.toggle("on", x === tb));
      }
      if (t.closest("[data-browse]")) {
        const picked = await open({ directory: true, title: "Criar projeto dentro de…" });
        if (typeof picked === "string") box.querySelector<HTMLInputElement>("[data-parent]")!.value = picked;
      }
      if (t.closest("[data-cancel]")) close();
      if (t.closest("[data-create]")) void create();
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
    box.innerHTML = `<h2>Clonar repositório</h2><div class="sub">Baixa o repositório com git clone e já abre um agente nele.</div>
      <span class="lbl">Endereço</span><input class="txt" data-url placeholder="https://github.com/usuario/repositorio.git" autocomplete="off" spellcheck="false">
      <span class="lbl">Clonar dentro de</span><div class="path"><input class="txt" data-parent value="${esc(suggestedParent())}" spellcheck="false"><button class="ghost" data-browse>Procurar…</button></div>
      <span class="lbl">Começar com</span>${toolPicker(tool)}
      <div class="err"></div>
      <div class="mfoot"><span class="hk">Enter clona · Esc cancela</span><button class="ghost" data-cancel>Cancelar</button><button class="primary" data-create>Clonar</button></div>`;
    const create = async () => {
      const url = box.querySelector<HTMLInputElement>("[data-url]")!.value.trim();
      const parent = box.querySelector<HTMLInputElement>("[data-parent]")!.value.trim();
      const btn = box.querySelector<HTMLButtonElement>("[data-create]")!;
      btn.disabled = true;
      btn.textContent = "Clonando…";
      try {
        const p = await ipc.projectClone(url, parent);
        close();
        toast(`“${basename(p.path)}” clonado`);
        host.start(p.path, tool);
      } catch (e) {
        box.querySelector<HTMLElement>(".err")!.textContent = String(e);
        btn.disabled = false;
        btn.textContent = "Clonar";
      }
    };
    box.addEventListener("click", async (e) => {
      const t = e.target as Element;
      const tb = t.closest<HTMLButtonElement>("[data-t]");
      if (tb && !tb.disabled) {
        tool = tb.dataset.t as ToolKind;
        box.querySelectorAll(".tool").forEach((x) => x.classList.toggle("on", x === tb));
      }
      if (t.closest("[data-browse]")) {
        const picked = await open({ directory: true, title: "Clonar dentro de…" });
        if (typeof picked === "string") box.querySelector<HTMLInputElement>("[data-parent]")!.value = picked;
      }
      if (t.closest("[data-cancel]")) close();
      if (t.closest("[data-create]")) void create();
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void create();
      }
    });
  });
}
