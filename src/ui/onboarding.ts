// Onboarding da primeira execução e a tela de ajustes (mesmas opções).
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import type { Settings, Theme, ToolKind } from "../core/types";
import { h } from "./dom";
import { toast } from "./feedback";
import { ICON, TOOLS, toolIcon } from "./icons";
import { logo } from "./logo";
import { openAbout } from "./about";
import { LOCALES, t, tn } from "../i18n";
import { MODEL_MB } from "../voice/engine";

/** Seletor de idioma: "Automático" segue o idioma do Windows. */
function languageSelect(current: string): string {
  const opts = [["auto", t("onboarding.languageAuto")], ...Object.entries(LOCALES)]
    .map(([code, name]) => `<option value="${code}"${code === current ? " selected" : ""}>${name}</option>`)
    .join("");
  return `<select class="lang-sel" data-lang>${opts}</select>`;
}

/** Salva o idioma; as janelas recarregam sozinhas (evento settings-changed). */
async function saveLanguage(settings: Settings, language: string): Promise<void> {
  try {
    store.settings = await ipc.settingsSet({ ...settings, language });
  } catch (err) {
    toast(String(err));
  }
}

const THEMES: Theme[] = ["auto", "light", "dark"];
const themeLabel = (v: Theme) => t(v === "auto" ? "settings.themeAuto" : v === "light" ? "settings.themeLight" : "settings.themeDark");

/** Salva o tema na hora: o Rust troca o tema de todas as janelas (e o Mica junto). */
async function saveTheme(settings: Settings, theme: Theme): Promise<void> {
  try {
    store.settings = await ipc.settingsSet({ ...settings, theme });
    store.emit("settings");
  } catch (err) {
    toast(String(err));
  }
}

const monitorHint = `<span style="display:inline-flex;vertical-align:-3px">${ICON.monitor}</span>`;

type Step = "welcome" | "theme" | "autostart" | "resume" | "done";
const STEPS: Step[] = ["welcome", "theme", "autostart", "resume", "done"];

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
      body = `${bubbles}<div class="hero">${logo(76, "wave", { look: true })}<div><h2>${t("onboarding.welcome.title")}</h2><div class="sub" style="margin:0">${t("onboarding.welcome.tagline")}</div></div></div>
        <div class="lang-row"><span class="lbl">${t("onboarding.language")}</span>${languageSelect(store.settings.language)}</div>
        <span class="lbl">${t("onboarding.welcome.providers")}</span>
        <div class="detected">${providerToggles(draft)}</div>
        <div class="sub" style="margin-top:12px">${t("onboarding.welcome.hint")}</div>`;
    } else if (s === "theme") {
      const topt = (v: Theme, text: string) =>
        `<button class="opt topt${draft.theme === v ? " on" : ""}" data-theme="${v}"><span class="tprev ${v}"><span class="lt"><i></i></span><span class="dk"><i></i></span></span><b>${themeLabel(v)}${v === "auto" ? ` <em>${t("onboarding.theme.recommended")}</em>` : ""}</b><small>${text}</small></button>`;
      body = `<div class="step">${t("onboarding.step", { n: 1, total: 3 })}</div><h2>${t("onboarding.theme.title")}</h2><div class="sub">${t("onboarding.theme.sub")}</div>
        <div class="opts opts3">${topt("auto", t("onboarding.theme.autoText"))}${topt("light", t("onboarding.theme.lightText"))}${topt("dark", t("onboarding.theme.darkText"))}</div>`;
    } else if (s === "autostart") {
      body = `<div class="step">${t("onboarding.step", { n: 2, total: 3 })}</div><h2>${t("onboarding.autostart.title")}</h2><div class="sub">${t("onboarding.autostart.sub")}</div>
        <div class="opts">${opt("autostart", "1", draft.autostart, t("onboarding.autostart.yes"), t("onboarding.autostart.yesText"))}${opt("autostart", "0", !draft.autostart, t("onboarding.autostart.no"), t("onboarding.autostart.noText"))}</div>`;
    } else if (s === "resume") {
      body = `<div class="step">${t("onboarding.step", { n: 3, total: 3 })}</div><h2>${t("onboarding.resume.title")}</h2><div class="sub">${t("onboarding.resume.sub", { commands: "claude --resume, codex resume, opencode --session" })}</div>
        <div class="opts">${opt("autoResume", "1", draft.autoResume, t("onboarding.resume.yes"), t("onboarding.resume.yesText"))}${opt("autoResume", "0", !draft.autoResume, t("onboarding.resume.no"), t("onboarding.resume.noText"))}</div>`;
    } else {
      body = `${bubbles}<div class="hero">${logo(76, "wave")}<div><h2>${t("onboarding.done.title")}</h2><div class="sub" style="margin:0">${t("onboarding.done.tip", { icon: monitorHint })}</div></div></div>
        <div class="rows">
          <div class="row" data-toggle="claudeUsageBridge"><div><b>${t("onboarding.done.usageBridge")}</b><small>${t("onboarding.done.usageBridgeText")}</small></div><span class="switch${draft.claudeUsageBridge ? " on" : ""}"></span></div>
          <div class="row" data-toggle="claudeBypassPermissions"><div><b>${t("onboarding.done.bypass")}</b><small>${t("onboarding.done.bypassText", { flag: "--permission-mode bypassPermissions" })}</small></div><span class="switch${draft.claudeBypassPermissions ? " on" : ""}"></span></div>
          <div class="row" data-toggle="explorerMenu"><div><b>${t("onboarding.done.explorer")}</b><small>${t("onboarding.done.explorerText")}</small></div><span class="switch${draft.explorerMenu ? " on" : ""}"></span></div>
          <div class="row" data-toggle="checkUpdates"><div><b>${t("onboarding.done.updates")}</b><small>${t("onboarding.done.updatesText")}</small></div><span class="switch${draft.checkUpdates ? " on" : ""}"></span></div>
        </div>`;
    }
    box.innerHTML = `${body}<div class="mfoot" style="margin-top:20px"><div class="dots">${STEPS.map((_, i) => `<i class="${i === step ? "on" : ""}"></i>`).join("")}</div>
      ${step > 0 ? `<button class="ghost" data-back>${t("onboarding.back")}</button>` : ""}<button class="primary" data-next>${step === STEPS.length - 1 ? t("onboarding.finish") : step === 0 ? t("onboarding.start") : t("onboarding.next")}</button></div>`;
  };

  box.addEventListener("change", (e) => {
    const sel = (e.target as Element).closest<HTMLSelectElement>("[data-lang]");
    if (sel) void saveLanguage({ ...store.settings, ...draft }, sel.value);
  });
  box.addEventListener("click", async (e) => {
    const target = e.target as Element;
    const th = target.closest<HTMLElement>("[data-theme]")?.dataset.theme as Theme | undefined;
    if (th) {
      draft.theme = th;
      render();
      void saveTheme({ ...store.settings, ...draft }, th);
      return;
    }
    const o = target.closest<HTMLElement>(".opt");
    if (o) {
      const k = o.dataset.k!;
      if (k === "autostart") draft.autostart = o.dataset.v === "1";
      if (k === "autoResume") draft.autoResume = o.dataset.v === "1";
      render();
      return;
    }
    const tool = target.closest<HTMLElement>("[data-tool]")?.dataset.tool as ToolKind | undefined;
    if (tool) {
      draft.disabledTools = toggleTool(draft.disabledTools, tool);
      render();
      return;
    }
    const tg = target.closest<HTMLElement>("[data-toggle]")?.dataset.toggle as "claudeUsageBridge" | "checkUpdates" | "explorerMenu" | "claudeBypassPermissions" | undefined;
    if (tg) {
      draft[tg] = !draft[tg];
      render();
      return;
    }
    if (target.closest("[data-back]")) {
      step--;
      render();
    }
    if (target.closest("[data-next]")) {
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

const toggleTool = (list: ToolKind[], k: ToolKind) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);

/** Fornecedores com chave liga/desliga. Os não instalados aparecem desligados. */
function providerToggles(s: Settings): string {
  return (Object.keys(TOOLS) as ToolKind[])
    .filter((k) => k !== "shell")
    .map((k) => {
      const installed = store.tools[k];
      const on = installed && !s.disabledTools.includes(k);
      return `<div class="prov${installed ? "" : " off"}" ${installed ? `data-tool="${k}"` : ""}>${toolIcon(k, 16)}<span>${TOOLS[k].name}<small>${installed ? (on ? t("onboarding.provider.on") : t("onboarding.provider.off")) : t("onboarding.provider.missing")}</small></span><span class="switch${on ? " on" : ""}"></span></div>`;
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

  const seg = (key: "voiceLanguage", value: string, label: string) =>
    `<button data-seg="${key}" data-v="${value}" class="${store.settings[key] === value ? "on" : ""}">${label}</button>`;

  const render = () => {
    box.innerHTML = `<h2>${t("settings.title")}</h2><div class="sub">${t("settings.sub")}</div>
      <div class="lang-row"><span class="lbl">${t("settings.language")}</span>${languageSelect(store.settings.language)}</div>
      <div class="lang-row"><span class="lbl">${t("settings.theme")}</span><div class="seg2" title="${t("settings.themeText")}">${THEMES.map((v) => `<button data-theme="${v}" class="${store.settings.theme === v ? "on" : ""}">${themeLabel(v)}</button>`).join("")}</div></div>
      <span class="lbl">${t("settings.providers")}</span>
      <div class="detected">${providerToggles(store.settings)}</div>
      <div class="rows" style="margin-top:12px">
        ${row("terminalDark", t("settings.terminalDark"), t("settings.terminalDarkText"))}
        ${row("autostart", t("settings.autostart"), t("settings.autostartText"))}
        <div class="row" style="cursor:default"><div><b>${t("settings.windows")}</b><small>${t("settings.windowsText", { windows: tn("settings.windowsOpen", store.windows.length), monitors: tn("settings.monitors", store.display.monitors) })}</small></div>
          <button class="ghost" data-newwin>${t("settings.newWindow")}</button></div>
        ${row("autoResume", t("settings.autoResume"), t("settings.autoResumeText"))}
        ${row("claudeBypassPermissions", t("settings.bypass"), t("settings.bypassText", { flag: "--permission-mode bypassPermissions" }))}
        ${row("claudeUsageBridge", t("settings.usageBridge"), t("settings.usageBridgeText"))}
        ${row("explorerMenu", t("settings.explorer"), t("settings.explorerText"))}
        ${row("checkUpdates", t("settings.updates"), t("settings.updatesText"))}
        <div class="row voice-row" style="cursor:default"><div><b>${t("settings.voice")}</b><small>${t("settings.voiceText")}</small>
          <div class="voice-opts">
            <select class="lang-sel" data-voicemodel title="${t("settings.voiceModel")}">${(["auto", "turbo", "small", "base"] as const)
              .map((m) => `<option value="${m}"${store.settings.voiceModel === m ? " selected" : ""}>${t(`settings.voiceModels.${m}`, { mb: m === "auto" ? MODEL_MB.turbo.gpu : MODEL_MB[m].gpu })}</option>`)
              .join("")}</select>
            <div class="seg2" title="${t("settings.voiceLanguage")}">${seg("voiceLanguage", "app", t("settings.voiceLangApp"))}${seg("voiceLanguage", "auto", t("settings.voiceLangAuto"))}</div>
          </div>
          <input class="voice-vocab" data-vocab spellcheck="false" maxlength="400" placeholder="${t("settings.voiceVocabPlaceholder")}" title="${t("settings.voiceVocab")}">
        </div></div>
      </div>
      <div class="mfoot" style="margin-top:16px"><button class="ghost" data-about>${t("settings.about", { version: __APP_VERSION__ })}</button><span class="hk"></span><button class="primary" data-close>${t("settings.done")}</button></div>`;
    box.querySelector<HTMLInputElement>("[data-vocab]")!.value = store.settings.voiceVocabulary ?? "";
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

  box.addEventListener("change", (e) => {
    const sel = (e.target as Element).closest<HTMLSelectElement>("[data-lang]");
    if (sel) void saveLanguage(store.settings, sel.value);
    const vm = (e.target as Element).closest<HTMLSelectElement>("[data-voicemodel]");
    if (vm) void save({ voiceModel: vm.value as Settings["voiceModel"] });
    const vocab = (e.target as Element).closest<HTMLInputElement>("[data-vocab]");
    if (vocab && vocab.value.trim() !== store.settings.voiceVocabulary) void save({ voiceVocabulary: vocab.value.trim() });
  });
  box.addEventListener("click", (e) => {
    const target = e.target as Element;
    const key = target.closest<HTMLElement>("[data-toggle]")?.dataset.toggle as keyof Settings | undefined;
    if (key) void save({ [key]: !store.settings[key] });
    const th = target.closest<HTMLElement>("[data-theme]")?.dataset.theme as Theme | undefined;
    if (th && th !== store.settings.theme) void save({ theme: th });
    const tool = target.closest<HTMLElement>("[data-tool]")?.dataset.tool as ToolKind | undefined;
    if (tool) void save({ disabledTools: toggleTool(store.settings.disabledTools, tool) });
    const sg = target.closest<HTMLElement>("[data-seg]");
    if (sg) void save({ voiceLanguage: sg.dataset.v as Settings["voiceLanguage"] });
    if (target.closest("[data-about]")) {
      modal.remove();
      openAbout();
    }
    if (target.closest("[data-newwin]")) {
      void ipc.windowNew().then(() => {
        modal.remove();
      });
    }
    if (target.closest("[data-close]")) modal.remove();
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
