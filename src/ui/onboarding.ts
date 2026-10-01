// Onboarding da primeira execução e a tela de ajustes (mesmas opções).
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import type { Settings, ToolKind } from "../core/types";
import { h } from "./dom";
import { toast } from "./feedback";
import { ICON, TOOLS, toolIcon } from "./icons";
import { logo } from "./logo";
import { openAbout } from "./about";

const monitorHint = `<span style="display:inline-flex;vertical-align:-3px">${ICON.window}</span>`;

type Step = "welcome" | "autostart" | "resume" | "done";
const STEPS: Step[] = ["welcome", "autostart", "resume", "done"];

export function openOnboarding(onFinish: () => void): void {
  const draft: Settings = { ...store.settings, autostart: false, autoResume: true, disabledTools: [] };
  let step = 0;
  const modal = h("div", "modal");
  const box = h("div", "mbox onb");
  modal.append(box);
  const bubbles = '<div class="bubbles"><i></i><i></i><i></i><i></i><i></i></div>';

  const opt = (key: string, value: string, on: boolean, title: string, text: string, art = "") =>
    `<button class="opt${on ? " on" : ""}" data-k="${key}" data-v="${value}">${art}<b>${title}</b><small>${text}</small></button>`;

  const render = () => {
    const s = STEPS[step];
    let body = "";
    if (s === "welcome") {
      body = `${bubbles}<div class="hero">${logo(76, "wave")}<div><h2>Bem-vindo ao Polvo</h2><div class="sub" style="margin:0">Um braço para cada agente: Claude Code, Codex, OpenCode e shells lado a lado.</div></div></div>
        <span class="lbl">Quais fornecedores você quer usar?</span>
        <div class="detected">${providerToggles(draft)}</div>
        <div class="sub" style="margin-top:12px">Desligue os que não quer ver (mesmo instalados). Depois são só 2 perguntas rápidas; tudo pode mudar em Ajustes.</div>`;
    } else if (s === "autostart") {
      body = `<div class="step">Pergunta 1 de 2</div><h2>Abrir o Polvo junto com o Windows?</h2><div class="sub">Suas sessões já ficam prontas quando você liga o computador.</div>
        <div class="opts">${opt("autostart", "1", draft.autostart, "Sim, abrir ao iniciar", "Abre em segundo plano assim que você entrar no Windows.")}${opt("autostart", "0", !draft.autostart, "Não, eu abro quando quiser", "Você inicia o Polvo pelo menu Iniciar.")}</div>`;
    } else if (s === "resume") {
      body = `<div class="step">Pergunta 2 de 2</div><h2>Retomar as últimas sessões automaticamente?</h2><div class="sub">Ao reabrir o Polvo, todas as janelas voltam no mesmo monitor e cada sessão continua de onde parou (claude --resume, codex resume, opencode --session).</div>
        <div class="opts">${opt("autoResume", "1", draft.autoResume, "Sim, retomar tudo", "Janelas e conversas voltam sozinhas, no mesmo lugar.")}${opt("autoResume", "0", !draft.autoResume, "Não, deixar pausadas", "O layout volta igual; você retoma cada sessão com um clique.")}</div>`;
    } else {
      body = `${bubbles}<div class="hero">${logo(76, "wave")}<div><h2>Tudo pronto!</h2><div class="sub" style="margin:0">Dica: abra quantas janelas quiser (botão ${monitorHint} na barra) e coloque cada uma no monitor que preferir.</div></div></div>
        <div class="rows">
          <div class="row" data-toggle="claudeUsageBridge"><div><b>Mostrar limites do Claude Code</b><small>Lê os limites de 5h e semanal pela statusline. A sua statusline atual continua igual.</small></div><span class="switch${draft.claudeUsageBridge ? " on" : ""}"></span></div>
          <div class="row" data-toggle="checkUpdates"><div><b>Atualizar automaticamente</b><small>Procura novas versões no GitHub e avisa quando houver.</small></div><span class="switch${draft.checkUpdates ? " on" : ""}"></span></div>
        </div>`;
    }
    box.innerHTML = `${body}<div class="mfoot" style="margin-top:20px"><div class="dots">${STEPS.map((_, i) => `<i class="${i === step ? "on" : ""}"></i>`).join("")}</div>
      ${step > 0 ? '<button class="ghost" data-back>Voltar</button>' : ""}<button class="primary" data-next>${step === STEPS.length - 1 ? "Começar a usar" : step === 0 ? "Vamos lá" : "Continuar"}</button></div>`;
  };

  box.addEventListener("click", async (e) => {
    const t = e.target as Element;
    const o = t.closest<HTMLElement>(".opt");
    if (o) {
      const k = o.dataset.k!;
      if (k === "autostart") draft.autostart = o.dataset.v === "1";
      if (k === "autoResume") draft.autoResume = o.dataset.v === "1";
      render();
      return;
    }
    const tool = t.closest<HTMLElement>("[data-tool]")?.dataset.tool as ToolKind | undefined;
    if (tool) {
      draft.disabledTools = toggleTool(draft.disabledTools, tool);
      render();
      return;
    }
    const tg = t.closest<HTMLElement>("[data-toggle]")?.dataset.toggle as "claudeUsageBridge" | "checkUpdates" | undefined;
    if (tg) {
      draft[tg] = !draft[tg];
      render();
      return;
    }
    if (t.closest("[data-back]")) {
      step--;
      render();
    }
    if (t.closest("[data-next]")) {
      if (step < STEPS.length - 1) {
        step++;
        render();
        return;
      }
      try {
        store.settings = await ipc.settingsSet({ ...draft, onboarded: true });
        store.emit("settings");
      } catch (err) {
        toast(String(err));
      }
      modal.remove();
      onFinish();
    }
  });
  render();
  document.body.append(modal);
}

const toggleTool = (list: ToolKind[], t: ToolKind) => (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]);

/** Fornecedores com chave liga/desliga. Os não instalados aparecem desligados. */
function providerToggles(s: Settings): string {
  return (Object.keys(TOOLS) as ToolKind[])
    .filter((t) => t !== "shell")
    .map((t) => {
      const installed = store.tools[t];
      const on = installed && !s.disabledTools.includes(t);
      return `<div class="prov${installed ? "" : " off"}" ${installed ? `data-tool="${t}"` : ""}>${toolIcon(t, 16)}<span>${TOOLS[t].name}<small>${installed ? (on ? "ativo" : "desativado") : "não instalado"}</small></span><span class="switch${on ? " on" : ""}"></span></div>`;
    })
    .join("");
}

/** Tela de ajustes: as mesmas escolhas do onboarding, aplicadas na hora. */
export function openSettings(): void {
  const modal = h("div", "modal");
  const box = h("div", "mbox onb");
  modal.append(box);

  const row = (key: keyof Settings, title: string, text: string) =>
    `<div class="row" data-toggle="${key}"><div><b>${title}</b><small>${text}</small></div><span class="switch${store.settings[key] ? " on" : ""}"></span></div>`;

  const render = () => {
    box.innerHTML = `<h2>Ajustes</h2><div class="sub">As mudanças valem na hora.</div>
      <span class="lbl">Fornecedores</span>
      <div class="detected">${providerToggles(store.settings)}</div>
      <div class="rows" style="margin-top:12px">
        ${row("autostart", "Abrir junto com o Windows", "Inicia o Polvo quando você entra no Windows.")}
        <div class="row" style="cursor:default"><div><b>Janelas</b><small>${store.windows.length} ${store.windows.length === 1 ? "aberta" : "abertas"} · ${store.display.monitors} ${store.display.monitors > 1 ? "monitores" : "monitor"}. Todas reabrem no mesmo lugar.</small></div>
          <button class="ghost" data-newwin>+ Nova janela</button></div>
        ${row("autoResume", "Retomar sessões ao abrir", "Reabre cada sessão exatamente onde parou.")}
        ${row("claudeUsageBridge", "Limites do Claude Code", "Lidos pela statusline (planos Pro/Max). Vale para sessões novas ou retomadas.")}
        ${row("checkUpdates", "Atualizações automáticas", "Procura novas versões no GitHub.")}
      </div>
      <div class="mfoot" style="margin-top:16px"><button class="ghost" data-about>Sobre o Polvo ${__APP_VERSION__}</button><span class="hk"></span><button class="primary" data-close>Pronto</button></div>`;
  };

  const save = async (patch: Partial<Settings>) => {
    try {
      store.settings = await ipc.settingsSet({ ...store.settings, ...patch });
      store.emit("settings");
    } catch (err) {
      toast(String(err));
    }
    render();
  };

  box.addEventListener("click", (e) => {
    const t = e.target as Element;
    const key = t.closest<HTMLElement>("[data-toggle]")?.dataset.toggle as keyof Settings | undefined;
    if (key) void save({ [key]: !store.settings[key] });
    const tool = t.closest<HTMLElement>("[data-tool]")?.dataset.tool as ToolKind | undefined;
    if (tool) void save({ disabledTools: toggleTool(store.settings.disabledTools, tool) });
    if (t.closest("[data-about]")) {
      modal.remove();
      openAbout();
    }
    if (t.closest("[data-newwin]")) {
      void ipc.windowNew().then(() => {
        modal.remove();
      });
    }
    if (t.closest("[data-close]")) modal.remove();
  });
  modal.addEventListener("pointerdown", (e) => {
    if (e.target === modal) modal.remove();
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modal.remove();
  });
  render();
  document.body.append(modal);
}
