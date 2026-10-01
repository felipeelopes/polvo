// Diálogo de nova sessão: ferramenta, pasta, nome e modo de início.
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import type { Side, StartMode, ToolKind } from "../core/types";
import { basename, esc, h } from "./dom";
import { TOOLS, toolIcon } from "./icons";

export interface NewSessionTarget {
  id: string;
  side: Side;
}

let lastTool: ToolKind = "claude";

export function openNewSession(onCreated: (id: string, target?: NewSessionTarget) => void, target?: NewSessionTarget): void {
  const modal = h("div", "modal");
  const box = h("div", "mbox");
  modal.append(box);
  const near = target ? store.session(target.id) : undefined;
  let tool: ToolKind = store.tools[lastTool] ? lastTool : ((Object.keys(TOOLS) as ToolKind[]).find((t) => store.tools[t]) ?? "shell");
  let cwd = near?.cwd ?? store.recentDirs[0] ?? "";
  let mode: StartMode = "new";

  const render = () => {
    box.innerHTML = `
      <h2>Nova sessão</h2>
      <div class="sub">${near ? `Abre ${target!.side === "right" ? "à direita" : "abaixo"} de “${esc(near.title)}”.` : "Entra no maior espaço livre. Depois é só arrastar."}</div>
      <div class="tools">${(Object.keys(TOOLS) as ToolKind[])
        .map(
          (k) =>
            `<button class="tool${k === tool ? " on" : ""}" data-t="${k}" style="--acc:${TOOLS[k].color}" ${store.tools[k] ? "" : 'disabled title="Não encontrado no PATH"'}><span class="ic">${toolIcon(k, 17)}</span><b>${TOOLS[k].short}</b><small>${store.tools[k] ? TOOLS[k].vendor : "não instalado"}</small></button>`,
        )
        .join("")}</div>
      <span class="lbl">Pasta do projeto</span>
      <div class="path"><input class="txt" data-cwd placeholder="C:\\caminho\\do\\projeto" value="${esc(cwd)}" spellcheck="false"><button class="ghost" data-browse>Procurar…</button></div>
      ${store.recentDirs.length ? `<div class="chips">${store.recentDirs.slice(0, 8).map((d) => `<button data-dir="${esc(d)}" class="${d === cwd ? "on" : ""}" title="${esc(d)}">${esc(basename(d))}</button>`).join("")}</div>` : ""}
      <span class="lbl">Nome (opcional)</span>
      <input class="txt" data-name placeholder="ex.: Migração do banco" autocomplete="off">
      ${tool === "shell" ? "" : `<span class="lbl">Começar</span><div class="chips"><button data-mode="new" class="${mode === "new" ? "on" : ""}">Conversa nova</button><button data-mode="continue" class="${mode === "continue" ? "on" : ""}">Continuar a última desta pasta</button></div>`}
      <div class="err"></div>
      <div class="mfoot"><span class="hk">Enter cria · Esc cancela</span><button class="ghost" data-cancel>Cancelar</button><button class="primary" data-create>Criar sessão</button></div>`;
    box.querySelector<HTMLInputElement>("[data-name]")!.focus();
  };

  const close = () => modal.remove();
  const create = async () => {
    const err = box.querySelector<HTMLElement>(".err")!;
    cwd = box.querySelector<HTMLInputElement>("[data-cwd]")!.value.trim();
    if (!cwd) {
      err.textContent = "Escolha a pasta do projeto.";
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
    const t = e.target as Element;
    const toolBtn = t.closest<HTMLButtonElement>("[data-t]");
    if (toolBtn && !toolBtn.disabled) {
      tool = toolBtn.dataset.t as ToolKind;
      cwd = box.querySelector<HTMLInputElement>("[data-cwd]")!.value;
      render();
    }
    const dir = t.closest<HTMLElement>("[data-dir]")?.dataset.dir;
    if (dir) {
      cwd = dir;
      render();
    }
    const m = t.closest<HTMLElement>("[data-mode]")?.dataset.mode as StartMode | undefined;
    if (m) {
      mode = m;
      cwd = box.querySelector<HTMLInputElement>("[data-cwd]")!.value;
      render();
    }
    if (t.closest("[data-browse]")) {
      const picked = await open({ directory: true, defaultPath: cwd || undefined, title: "Pasta do projeto" });
      if (typeof picked === "string") {
        cwd = picked;
        render();
      }
    }
    if (t.closest("[data-cancel]")) close();
    if (t.closest("[data-create]")) void create();
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
