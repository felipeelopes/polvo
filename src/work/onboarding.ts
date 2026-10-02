// Onboarding da tela "Meu trabalho": apresentação animada, conexão das fontes
// (login moderno com código no navegador, reaproveitando gh/az quando já há
// login), preferências e conclusão. Também serve de tela "Fontes e
// preferências" depois (abre direto no passo das fontes).
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import type { ToolKind } from "../core/types";
import { esc } from "../ui/dom";
import { toast } from "../ui/feedback";
import { ICON, TOOLS } from "../ui/icons";
import { logo } from "../ui/logo";
import { t, tn } from "../i18n";
import { work, type AdoOrg, type Detect, type LoginEvent, type WorkConfig } from "./api";

export interface OnboardingOptions {
  config: WorkConfig;
  repos: string[];
  step: number;
  done(cfg: WorkConfig, detect: Detect | null): void;
  skip(): void;
}

type Login = { phase: "idle" | "device" | "browser" | "error"; code?: string; url?: string; error?: string; opened?: boolean };

interface OrgRow {
  name: string;
  auth: AdoOrg["auth"];
  on: boolean;
  remote: boolean;
}

const STEPS = 4;
const AGENTS: ToolKind[] = ["claude", "codex", "opencode"];

const GH_SVG =
  '<svg viewBox="0 0 16 16" width="22" height="22"><path fill="currentColor" d="M8 0C3.6 0 0 3.6 0 8c0 3.5 2.3 6.5 5.5 7.6.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8.6-.2 1.3-.3 2-.3s1.4.1 2 .3c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.6 3.9.3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4C13.7 14.5 16 11.5 16 8c0-4.4-3.6-8-8-8z"/></svg>';
const ADO_SVG =
  '<svg viewBox="0 0 16 16" width="22" height="22"><path fill="#4c9bf0" d="M15 3.6v8.3l-3.4 2.8-5.3-1.9v1.9L3.3 10.8l8.7.7V4.1zm-2.9.4L7.2 1v2L2.7 4.3 1.3 6.1v4.1l1.9.8V5.8z"/></svg>';
const GIT_SVG =
  '<svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="#f08a5d" stroke-width="1.6" stroke-linecap="round"><circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="5.5" r="1.6"/><path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-2.3 3-7 3.6"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

export class WorkOnboarding {
  private step: number;
  private cfg: WorkConfig;
  private detect: Detect | null = null;
  private detecting = false;
  private repoCount: number;
  private orgs: OrgRow[];
  private discovering = false;
  private gh: Login = { phase: "idle" };
  private ado: Login = { phase: "idle" };
  private patOpen = false;
  private patBusy = false;
  private box: HTMLElement;

  constructor(
    root: HTMLElement,
    private o: OnboardingOptions,
  ) {
    this.step = o.step;
    this.cfg = { ...o.config, adoOrgs: [...o.config.adoOrgs] };
    this.repoCount = o.repos.length;
    this.orgs = this.cfg.adoOrgs.map((x) => ({ ...x, on: true, remote: false }));
    this.box = document.createElement("div");
    this.box.className = "wk-onb";
    root.append(this.box);
    this.box.addEventListener("click", (e) => void this.onClick(e));
    this.box.addEventListener("change", (e) => this.onChange(e));
    this.render();
    if (this.step >= 1) void this.scan();
  }

  // ------------------------------------------------------------ dados

  private async scan(): Promise<void> {
    if (this.detecting) return;
    this.detecting = true;
    this.render();
    const [detect, local] = await Promise.all([work.detect().catch(() => null), work.local(this.o.repos, Date.now()).catch(() => null)]);
    this.detect = detect;
    this.detecting = false;
    if (local) {
      this.repoCount = local.repos.length;
      for (const r of local.repos) {
        const org = r.remote?.kind === "ado" ? r.remote.org : null;
        if (org && !this.orgs.some((x) => x.name.toLowerCase() === org.toLowerCase())) this.orgs.push({ name: org, auth: "account", on: true, remote: true });
        else if (org) this.orgs.find((x) => x.name.toLowerCase() === org.toLowerCase())!.remote = true;
      }
    }
    this.render();
    if (this.adoConnected) void this.discover();
  }

  private get adoConnected(): boolean {
    return !!(this.detect?.entraConnected || this.detect?.azUser);
  }

  private async discover(): Promise<void> {
    this.discovering = true;
    this.render();
    try {
      const names = await work.adoDiscover();
      const few = names.length <= 3;
      for (const n of names) {
        if (!this.orgs.some((x) => x.name.toLowerCase() === n.toLowerCase())) this.orgs.push({ name: n, auth: "account", on: few, remote: false });
      }
    } catch {
      /* conta sem acesso à lista de organizações: ficam as dos repositórios */
    }
    this.discovering = false;
    this.render();
  }

  // ------------------------------------------------------------ desenho

  private render(): void {
    const steps = [this.intro, this.sources, this.prefs, this.finish];
    const progress =
      this.step === 0
        ? ""
        : `<div class="wk-onb-top"><div class="wk-onb-progress"><i style="width:${(this.step / (STEPS - 1)) * 100}%"></i></div><span>${t("work.onb.step", { n: this.step, total: STEPS - 1 })}</span>
          ${this.o.config.onboarded ? `<button class="ibtn sm" data-skip title="${t("work.drawer.close")}">${ICON.close}</button>` : ""}</div>`;
    const prev = this.box.dataset.step;
    this.box.dataset.step = String(this.step);
    this.box.innerHTML = `${progress}<div class="wk-onb-body${prev !== String(this.step) ? " enter" : ""}">${steps[this.step].call(this)}</div>`;
  }

  private intro(): string {
    const cards = [
      ["bug", "🐞", t("work.onb.demo.bug"), "AB#1832 · P1"],
      ["pr", "⇄", t("work.onb.demo.pr"), "#145 · ✓"],
      ["commit", "●", t("work.onb.demo.commits"), "+612 −48"],
    ];
    return `<div class="wk-intro">
      <div class="wk-scene">
        <div class="wk-glow"></div>
        <div class="wk-orbit"><span class="o1">${GH_SVG}</span><span class="o2">${ADO_SVG}</span><span class="o3">${GIT_SVG}</span></div>
        <div class="wk-octo">${logo(118, "wave", { look: true })}</div>
        ${cards.map(([k, ic, title, sub], i) => `<div class="wk-fcard c${i}"><span class="fi ${k}">${ic}</span><div><b>${esc(title)}</b><small>${esc(sub)}</small></div></div>`).join("")}
      </div>
      <div class="wk-kicker">${t("work.onb.kicker")}</div>
      <h1>${t("work.onb.title")}</h1>
      <p>${t("work.onb.tagline")}</p>
      <div class="wk-onb-cta"><button class="primary lg" data-next>${t("work.onb.start")} →</button><button class="ghost" data-skip>${t("work.onb.skip")}</button></div>
    </div>`;
  }

  private loginPanel(l: Login, kind: "gh" | "ado"): string {
    if (l.phase === "device") {
      return `<div class="wk-device">
        <div class="lbl">${t("work.onb.device.code")}</div>
        <div class="code">${(l.code ?? "").split("").map((ch, i) => `<span style="animation-delay:${i * 45}ms">${esc(ch)}</span>`).join("")}</div>
        <button class="primary sm" data-copyopen="${kind}">${t("work.onb.device.copy")}</button>
        <div class="wk-wait"><i></i>${l.opened ? t("work.onb.device.copied") : t("work.onb.device.waiting")}</div>
      </div>`;
    }
    if (l.phase === "browser") return `<div class="wk-device"><div class="wk-wait"><i></i>${t("work.onb.ado.browser")}</div></div>`;
    if (l.phase === "error") return `<div class="wk-err">${esc(l.error ?? "")}</div>`;
    return "";
  }

  private install(cmd: string): string {
    return `<div class="wk-install"><code>${esc(cmd)}</code><button class="ibtn sm" data-copy="${esc(cmd)}" title="copy">${ICON.terminal}</button><button class="ghost sm" data-rescan>${t("work.onb.github.recheck")}</button></div>`;
  }

  private sources(): string {
    const d = this.detect;
    const spin = `<div class="wk-detect"><i class="wk-spin"></i>${t("work.onb.github.detecting")}</div>`;
    const local = `<div class="wk-src-card ok">
      <div class="hd"><span class="logo">${GIT_SVG}</span><div><b>${t("work.onb.local.title")}</b><small>${this.repoCount ? tn("work.onb.local.found", this.repoCount) : t("work.onb.local.none")}</small></div><span class="ok-badge">${CHECK}${t("work.onb.local.ready")}</span></div>
    </div>`;

    let ghBody = "";
    const ghOk = !!d?.githubLogin;
    if (this.detecting && !d) ghBody = spin;
    else if (ghOk) {
      ghBody = `<div class="wk-acct">${d!.githubAvatar ? `<img src="${esc(d!.githubAvatar)}" alt="">` : ""}<span>${t("work.onb.github.connected", { login: esc(d!.githubLogin!) })}</span>
        <em>${d!.githubSource === "gh" ? t("work.onb.github.viaGh") : t("work.onb.github.viaPolvo")}</em><div class="sp"></div>
        ${d!.githubSource === "polvo" ? `<button class="ghost sm" data-ghlogout>${t("work.onb.github.logout")}</button>` : ""}
        <span class="switch${this.cfg.github ? " on" : ""}" data-ghtoggle></span></div>`;
    } else if (this.gh.phase === "device" || this.gh.phase === "browser") ghBody = this.loginPanel(this.gh, "gh");
    else if (d && !d.githubNative && !d.ghInstalled) ghBody = `<div class="wk-need">${t("work.onb.github.needCli")}</div>${this.install("winget install --id GitHub.cli")}`;
    else ghBody = `${this.loginPanel(this.gh, "gh")}<button class="primary wk-login gh" data-ghlogin>${GH_SVG}${t("work.onb.github.login")}</button>`;
    const github = `<div class="wk-src-card${ghOk ? " ok" : ""}">
      <div class="hd"><span class="logo">${GH_SVG}</span><div><b>${t("work.onb.github.title")}</b><small>${t("work.onb.github.sub")}</small></div>${ghOk ? `<span class="ok-badge">${CHECK}</span>` : ""}</div>
      <div class="bd">${ghBody}</div></div>`;

    let adoBody = "";
    const adoAcct = this.detect?.entraConnected ? t("work.onb.ado.connected", { account: "Microsoft Entra ID" }) : d?.azUser ? t("work.onb.ado.connected", { account: esc(d.azUser) }) : "";
    if (this.detecting && !d) adoBody = spin;
    else if (this.adoConnected) {
      adoBody = `<div class="wk-acct"><span>${adoAcct}</span><div class="sp"></div>${d?.entraConnected ? `<button class="ghost sm" data-adologout>${t("work.onb.ado.logout")}</button>` : ""}</div>`;
    } else if (this.ado.phase === "device" || this.ado.phase === "browser") adoBody = this.loginPanel(this.ado, "ado");
    else if (d && !d.entraNative && !d.azInstalled) adoBody = `<div class="wk-need">${t("work.onb.ado.needCli")}</div>${this.install("winget install --id Microsoft.AzureCLI")}`;
    else adoBody = `${this.loginPanel(this.ado, "ado")}<button class="primary wk-login ms" data-adologin><span class="ms-logo"><i></i><i></i><i></i><i></i></span>${t("work.onb.ado.login")}</button>`;
    const orgs = this.orgs.length || this.discovering
      ? `<div class="wk-orgs"><div class="lbl">${t("work.onb.ado.orgs")}</div>${this.orgs
          .map(
            (x, i) => `<label class="wk-org"><input type="checkbox" data-org="${i}"${x.on ? " checked" : ""}><span class="box">${CHECK}</span><b>${esc(x.name)}</b>${
              x.auth === "pat" ? `<em>${t("work.onb.ado.viaPat")}</em>` : x.remote ? `<em>${t("work.onb.ado.fromRemote")}</em>` : ""
            }</label>`,
          )
          .join("")}${this.discovering ? `<div class="wk-detect"><i class="wk-spin"></i>${t("work.onb.ado.orgsLoading")}</div>` : ""}</div>`
      : this.adoConnected
        ? `<div class="wk-faint">${t("work.onb.ado.orgsNone")}</div>`
        : "";
    const pat = this.patOpen
      ? `<div class="wk-pat"><div class="wk-faint">${t("work.onb.ado.patHint")}</div>
          <div class="row"><input data-patorg placeholder="${t("work.onb.ado.patOrg")}" spellcheck="false"><input data-pat type="password" placeholder="${t("work.onb.ado.patToken")}" spellcheck="false">
          <button class="primary sm" data-patsave${this.patBusy ? " disabled" : ""}>${this.patBusy ? '<i class="wk-spin"></i>' : ""}${t("work.onb.ado.patSave")}</button></div></div>`
      : `<button class="link" data-patopen>${t("work.onb.ado.pat")}</button>`;
    const adoOk = this.orgs.some((x) => x.on) && (this.adoConnected || this.orgs.some((x) => x.on && x.auth === "pat"));
    const ado = `<div class="wk-src-card${adoOk ? " ok" : ""}">
      <div class="hd"><span class="logo">${ADO_SVG}</span><div><b>${t("work.onb.ado.title")}</b><small>${t("work.onb.ado.sub")}</small></div>${adoOk ? `<span class="ok-badge">${CHECK}</span>` : ""}</div>
      <div class="bd">${adoBody}${orgs}${pat}</div></div>`;

    return `<h2>${t("work.onb.sources.title")}</h2><p class="sub">${t("work.onb.sources.sub")}</p>
      <div class="wk-src-grid">${local}${github}${ado}</div>
      <div class="wk-onb-foot"><button class="ghost" data-back>${t("work.onb.back")}</button><div class="sp"></div><button class="primary" data-next>${t("work.onb.next")} →</button></div>`;
  }

  private prefs(): string {
    const agents = AGENTS.filter((k) => store.toolEnabled(k));
    const seg = (key: string, cur: string, opts: [string, string][]) =>
      `<div class="seg">${opts.map(([v, l]) => `<button data-${key}="${v}" class="${cur === v ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
    return `<h2>${t("work.onb.prefs.title")}</h2><p class="sub">${t("work.onb.prefs.sub")}</p>
      <div class="wk-prefs">
        <div class="wk-pref" data-bugs><div><b>🐞 ${t("work.onb.prefs.bugs")}</b><small>${t("work.onb.prefs.bugsText")}</small></div><span class="switch${this.cfg.bugsFirst ? " on" : ""}"></span></div>
        <div class="wk-pref"><div><b>${t("work.onb.prefs.agent")}</b><small>${t("work.onb.prefs.agentText")}</small></div>
          ${seg("agent", this.cfg.agent, [["auto", t("work.agent.auto")], ...agents.map((k): [string, string] => [k, TOOLS[k].short])])}</div>
        <div class="wk-pref"><div><b>${t("work.onb.prefs.refresh")}</b></div>${seg("refresh", String(this.cfg.refreshMinutes), [2, 5, 15, 30].map((n): [string, string] => [String(n), t("work.onb.prefs.minutes", { n })]))}</div>
        <div class="wk-note">${t("work.onb.prefs.pending")}</div>
      </div>
      <div class="wk-onb-foot"><button class="ghost" data-back>${t("work.onb.back")}</button><div class="sp"></div><button class="primary" data-next>${t("work.onb.next")} →</button></div>`;
  }

  private finish(): string {
    const login = this.cfg.github ? this.detect?.githubLogin : null;
    const orgs = this.orgs.filter((x) => x.on).length;
    const lines = [
      `<li style="--d:0">${CHECK}${tn("work.onb.done.local", this.repoCount)}</li>`,
      login ? `<li style="--d:1">${CHECK}${esc(t("work.onb.done.github", { login }))}</li>` : "",
      orgs ? `<li style="--d:2">${CHECK}${tn("work.onb.done.ado", orgs)}</li>` : "",
    ].join("");
    return `<div class="wk-done">
      <div class="wk-burst">${Array.from({ length: 14 }, (_, i) => `<i style="--a:${(i * 360) / 14}deg;--h:${(i * 47) % 360}"></i>`).join("")}
        <svg class="wk-check" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28"/><path d="M20 33l8 8 16-17"/></svg></div>
      <h2>${t("work.onb.done.title")}</h2><p class="sub">${t("work.onb.done.sub")}</p>
      <ul>${lines}</ul>
      ${!login && !orgs ? `<div class="wk-note">${t("work.onb.done.none")}</div>` : ""}
      <div class="wk-tip">${t("work.onb.done.tip")}</div>
      <div class="wk-onb-foot"><button class="ghost" data-back>${t("work.onb.back")}</button><div class="sp"></div><button class="primary lg" data-finish>${t("work.onb.finish")} →</button></div>
    </div>`;
  }

  // ------------------------------------------------------------ ações

  private go(step: number): void {
    this.step = Math.max(0, Math.min(STEPS - 1, step));
    this.render();
    if (this.step === 1 && !this.detect) void this.scan();
  }

  private onChange(e: Event): void {
    const cb = (e.target as Element).closest<HTMLInputElement>("[data-org]");
    if (cb) {
      this.orgs[Number(cb.dataset.org)].on = cb.checked;
      this.render();
    }
  }

  private event(kind: "gh" | "ado"): (e: LoginEvent) => void {
    return (e) => {
      const l = kind === "gh" ? this.gh : this.ado;
      if ("browser" in e) l.phase = "browser";
      else {
        l.phase = "device";
        l.code = e.code;
        l.url = e.url;
        // Copia o código e abre a página de confirmação sozinho.
        void this.copyOpen(l);
      }
      this.render();
    };
  }

  private async copyOpen(l: Login): Promise<void> {
    if (l.code) await navigator.clipboard.writeText(l.code).catch(() => {});
    if (l.url) await ipc.openUrl(l.url).catch(() => {});
    l.opened = true;
    this.render();
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const target = e.target as Element;
    const d = (sel: string) => target.closest<HTMLElement>(sel);
    if (d("[data-skip]")) return this.o.skip();
    if (d("[data-back]")) return this.go(this.step - 1);
    if (d("[data-next]")) return this.go(this.step + 1);
    if (d("[data-rescan]")) {
      this.detect = null;
      return void this.scan();
    }
    const copy = d("[data-copy]");
    if (copy) {
      await navigator.clipboard.writeText(copy.dataset.copy!).catch(() => {});
      return toast(copy.dataset.copy!);
    }
    const co = d("[data-copyopen]");
    if (co) return void this.copyOpen(co.dataset.copyopen === "gh" ? this.gh : this.ado);
    if (d("[data-ghtoggle]")) {
      this.cfg.github = !this.cfg.github;
      return this.render();
    }
    if (d("[data-ghlogin]")) {
      this.gh = { phase: "idle" };
      this.render();
      try {
        await work.githubLogin(this.event("gh"));
        this.gh = { phase: "idle" };
        this.cfg.github = true;
        this.detect = await work.detect();
      } catch (err) {
        this.gh = { phase: "error", error: String(err) };
      }
      return this.render();
    }
    if (d("[data-ghlogout]")) {
      await work.githubLogout();
      this.detect = await work.detect();
      return this.render();
    }
    if (d("[data-adologin]")) {
      this.ado = { phase: "idle" };
      this.render();
      try {
        await work.adoLogin(this.event("ado"));
        this.ado = { phase: "idle" };
        this.detect = await work.detect();
        void this.discover();
      } catch (err) {
        this.ado = { phase: "error", error: String(err) };
      }
      return this.render();
    }
    if (d("[data-adologout]")) {
      await work.adoLogout();
      this.detect = await work.detect();
      return this.render();
    }
    if (d("[data-patopen]")) {
      this.patOpen = true;
      this.render();
      this.box.querySelector<HTMLInputElement>("[data-patorg]")?.focus();
      return;
    }
    if (d("[data-patsave]")) {
      const org = this.box.querySelector<HTMLInputElement>("[data-patorg]")?.value.trim() ?? "";
      const pat = this.box.querySelector<HTMLInputElement>("[data-pat]")?.value.trim() ?? "";
      this.patBusy = true;
      this.render();
      try {
        await work.adoPat(org, pat);
        const name = org.replace(/^https?:\/\/dev\.azure\.com\//i, "").replace(/\/.*$/, "");
        const row = this.orgs.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (row) Object.assign(row, { auth: "pat", on: true });
        else this.orgs.push({ name, auth: "pat", on: true, remote: false });
        this.patOpen = false;
        toast(t("work.onb.ado.patSaved", { org: name }));
      } catch (err) {
        toast(String(err));
      }
      this.patBusy = false;
      return this.render();
    }
    const agent = d("[data-agent]");
    if (agent) {
      this.cfg.agent = agent.dataset.agent!;
      return this.render();
    }
    const refresh = d("[data-refresh]");
    if (refresh) {
      this.cfg.refreshMinutes = Number(refresh.dataset.refresh);
      return this.render();
    }
    if (d("[data-bugs]")) {
      this.cfg.bugsFirst = !this.cfg.bugsFirst;
      return this.render();
    }
    if (d("[data-finish]")) {
      const cfg: WorkConfig = {
        ...this.cfg,
        onboarded: true,
        // Sem conta conectada, organizações "de conta" não teriam token.
        adoOrgs: this.orgs.filter((x) => x.on && (x.auth === "pat" || this.adoConnected)).map(({ name, auth }) => ({ name, auth })),
      };
      try {
        this.o.done(await work.saveConfig(cfg), this.detect);
      } catch (err) {
        toast(String(err));
      }
    }
  }
}
