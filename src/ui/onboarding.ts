// Onboarding da primeira execução e a tela de ajustes (mesmas opções).
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import type { Settings, ToolKind } from "../core/types";
import { h } from "./dom";
import { toast } from "./feedback";
import { TOOLS, toolIcon } from "./icons";

type Step = "welcome" | "autostart" | "screens" | "resume" | "done";
const STEPS: Step[] = ["welcome", "autostart", "screens", "resume", "done"];

const monitors = (n: number) => `<div class="art">${'<span class="mon"></span>'.repeat(n)}</div>`;

export function openOnboarding(onFinish: () => void): void {
  const draft: Settings = { ...store.settings, autostart: false, screens: store.display.monitors > 1 ? 2 : 1, autoResume: true };
  let step = 0;
  const modal = h("div", "modal");
  const box = h("div", "mbox onb");
  modal.append(box);

  const opt = (key: string, value: string, on: boolean, title: string, text: string, art = "") =>
    `<button class="opt${on ? " on" : ""}" data-k="${key}" data-v="${value}">${art}<b>${title}</b><small>${text}</small></button>`;

  const render = () => {
    const s = STEPS[step];
    let body = "";
    if (s === "welcome") {
      body = `<div class="hero"><img src="/polvo.png" alt=""><div><h2>Bem-vindo ao Polvo</h2><div class="sub" style="margin:0">Um braço para cada agente: Claude Code, Codex, OpenCode e shells lado a lado.</div></div></div>
        <span class="lbl">Encontramos no seu computador</span>
        <div class="detected">${(Object.keys(TOOLS) as ToolKind[])
          .map((t) => `<div>${toolIcon(t, 16)}${TOOLS[t].name}<em class="${store.tools[t] ? "yes" : "no"}">${store.tools[t] ? "✓ pronto" : "não instalado"}</em></div>`)
          .join("")}</div>
        <div class="sub" style="margin-top:12px">São só 3 perguntas rápidas. Dá para mudar tudo depois em Ajustes.</div>`;
    } else if (s === "autostart") {
      body = `<div class="step">Pergunta 1 de 3</div><h2>Abrir o Polvo junto com o Windows?</h2><div class="sub">Suas sessões já ficam prontas quando você liga o computador.</div>
        <div class="opts">${opt("autostart", "1", draft.autostart, "Sim, abrir ao iniciar", "Abre em segundo plano assim que você entrar no Windows.")}${opt("autostart", "0", !draft.autostart, "Não, eu abro quando quiser", "Você inicia o Polvo pelo menu Iniciar.")}</div>`;
    } else if (s === "screens") {
      const n = store.display.monitors;
      body = `<div class="step">Pergunta 2 de 3</div><h2>Quantas telas você quer usar?</h2><div class="sub">${n > 1 ? `Detectamos ${n} monitores.` : "Detectamos 1 monitor. Com duas telas, a segunda janela abre aqui e você a arrasta quando conectar o outro."}</div>
        <div class="opts">${opt("screens", "1", draft.screens === 1, "Uma tela", "Todas as sessões numa janela só.", monitors(1))}${opt("screens", "2", draft.screens === 2, "Duas telas", "Uma janela em cada monitor. Mova sessões entre elas com um clique.", monitors(2))}</div>`;
    } else if (s === "resume") {
      body = `<div class="step">Pergunta 3 de 3</div><h2>Retomar as últimas sessões automaticamente?</h2><div class="sub">Ao reabrir o Polvo, cada sessão volta exatamente onde parou (claude --resume, codex resume, opencode --session).</div>
        <div class="opts">${opt("autoResume", "1", draft.autoResume, "Sim, retomar tudo", "As conversas voltam sozinhas, no mesmo lugar da tela.")}${opt("autoResume", "0", !draft.autoResume, "Não, deixar pausadas", "O layout volta igual; você retoma cada sessão com um clique.")}</div>`;
    } else {
      body = `<div class="hero"><img src="/polvo.png" alt=""><div><h2>Tudo pronto!</h2><div class="sub" style="margin:0">Últimos ajustes opcionais:</div></div></div>
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
      if (k === "screens") draft.screens = Number(o.dataset.v);
      if (k === "autoResume") draft.autoResume = o.dataset.v === "1";
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

/** Tela de ajustes: as mesmas escolhas do onboarding, aplicadas na hora. */
export function openSettings(): void {
  const modal = h("div", "modal");
  const box = h("div", "mbox onb");
  modal.append(box);

  const row = (key: keyof Settings, title: string, text: string) =>
    `<div class="row" data-toggle="${key}"><div><b>${title}</b><small>${text}</small></div><span class="switch${store.settings[key] ? " on" : ""}"></span></div>`;

  const render = () => {
    const s = store.settings;
    box.innerHTML = `<h2>Ajustes</h2><div class="sub">As mudanças valem na hora.</div>
      <div class="rows">
        ${row("autostart", "Abrir junto com o Windows", "Inicia o Polvo quando você entra no Windows.")}
        <div class="row" style="cursor:default"><div><b>Telas</b><small>${store.display.monitors} ${store.display.monitors > 1 ? "monitores detectados" : "monitor detectado"}</small></div>
          <div class="seg2"><button data-screens="1" class="${s.screens === 1 ? "on" : ""}">Uma</button><button data-screens="2" class="${s.screens === 2 ? "on" : ""}">Duas</button></div></div>
        ${row("autoResume", "Retomar sessões ao abrir", "Reabre cada sessão exatamente onde parou.")}
        ${row("claudeUsageBridge", "Limites do Claude Code", "Lidos pela statusline (planos Pro/Max). Vale para sessões novas ou retomadas.")}
        ${row("checkUpdates", "Atualizações automáticas", "Procura novas versões no GitHub.")}
      </div>
      <div class="mfoot" style="margin-top:16px"><span class="hk">Polvo ${__APP_VERSION__}</span><button class="primary" data-close>Pronto</button></div>`;
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
    const screens = t.closest<HTMLElement>("[data-screens]")?.dataset.screens;
    if (screens) void save({ screens: Number(screens) });
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
