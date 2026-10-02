// Visão "Meu trabalho": o que é seu em todas as fontes. Commits locais, issues
// e PRs do GitHub, work items, sprint e PRs do Azure DevOps, com a lista "Para
// fazer" priorizada (bugs primeiro), atalhos para levar um item a um agente,
// comentários e link para o registro original.
import DOMPurify from "dompurify";
import { ipc } from "../core/ipc";
import { normPath, store } from "../core/store";
import type { ToolKind } from "../core/types";
import { git as gitApi } from "../git/api";
import { ago, basename, esc, h } from "../ui/dom";
import { closePopover, popover, toast } from "../ui/feedback";
import { ICON, TOOLS } from "../ui/icons";
import { localeTag, t, tn } from "../i18n";
import { work, type AdoOrg, type Detect, type Thread, type WorkConfig } from "./api";
import {
  branchName,
  bugKind,
  build,
  clip,
  commitsSince,
  group,
  heat,
  htmlToText,
  isBug,
  isPending,
  matches,
  perDay,
  reasons,
  startOfDay,
  startOfWeek,
  STATE_FILTERS,
  type GroupBy,
  type Item,
  type Model,
  type Pr,
  type Raw,
  type StateFilter,
} from "./model";
import { WorkOnboarding } from "./onboarding";

export interface WorkHost {
  /** Raízes dos repositórios git conhecidos (projetos e sessões). */
  repos(): string[];
  /** Abre um agente na pasta e envia o pedido; devolve a sessão criada. */
  askAgent(cwd: string, prompt: string, tool?: ToolKind): Promise<string | null>;
  /** Mostra a sessão nos Painéis. */
  openSession(id: string): void;
  openBoard(): void;
}

type Range = "day" | "week" | "sprint";
type Mode = "impl" | "wt" | "plan" | "fix";
const AGENTS: ToolKind[] = ["claude", "codex", "opencode"];
const PAGE = 30;
const CACHE = "polvo.work.cache";
const SEEN = "polvo.work.seen";
const UI = "polvo.work.ui";
const REPOS = "polvo.work.repos";

const read = <T>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...(JSON.parse(v) as T) } : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* cheio ou bloqueado: segue sem cache */
  }
};

const I = {
  gh: '<svg class="src" viewBox="0 0 16 16"><path fill="currentColor" d="M8 0C3.6 0 0 3.6 0 8c0 3.5 2.3 6.5 5.5 7.6.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8.6-.2 1.3-.3 2-.3s1.4.1 2 .3c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.6 3.9.3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4C13.7 14.5 16 11.5 16 8c0-4.4-3.6-8-8-8z"/></svg>',
  ado: '<svg class="src ado" viewBox="0 0 16 16"><path fill="currentColor" d="M15 3.6v8.3l-3.4 2.8-5.3-1.9v1.9L3.3 10.8l8.7.7V4.1zm-2.9.4L7.2 1v2L2.7 4.3 1.3 6.1v4.1l1.9.8V5.8z"/></svg>',
  git: '<svg class="src" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.6"/><path d="M1 8h4.4M10.6 8H15"/></svg>',
  bug: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#e5534b" stroke-width="1.6" stroke-linecap="round"><ellipse cx="8" cy="9" rx="3.5" ry="4.5"/><path d="M8 4.5v9M4.5 9H2M14 9h-2.5M4.8 5.5 3 4M11.2 5.5 13 4"/></svg>',
  issue: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#3fb27f" stroke-width="1.6"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.3" fill="#3fb27f"/></svg>',
  task: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#e5a33a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M5.5 8.2l1.8 1.8 3.3-3.6"/></svg>',
  story: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#5cc8e0" stroke-width="1.6" stroke-linejoin="round"><path d="M3.5 2.5h9v11l-4.5-3-4.5 3z"/></svg>',
  feature: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#b48aff" stroke-width="1.6" stroke-linejoin="round"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>',
  epic: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#f08a5d" stroke-width="1.6" stroke-linejoin="round"><path d="M9.2 1.5L3.2 9h4.3l-.7 5.5 6-7.5H8.5z"/></svg>',
  pr: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#3fb27f" stroke-width="1.6" stroke-linecap="round"><circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="12.5" r="1.6"/><path d="M4 5.1v5.8M12 10.9V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6"/></svg>',
  merged: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#b48aff" stroke-width="1.6" stroke-linecap="round"><circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="8" r="1.6"/><path d="M4 5.1v5.8M5.5 4.3C7 7 8.5 8 10.4 8"/></svg>',
  bot: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2.5" y="5" width="11" height="8.5" rx="2.5"/><path d="M8 2v3M6 9v.1M10 9v.1"/></svg>',
  comment: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"/></svg>',
  ext: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5H7"/></svg>',
  caret: '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4"/></svg>',
  search: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>',
  refresh: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3"/></svg>',
};

const KIND_ICON = (i: Item) => (bugKind(i) ? I.bug : I[i.kind === "bug" ? "bug" : i.kind]);
const srcName = (src: "gh" | "ado") => (src === "gh" ? "GitHub" : "Azure DevOps");

export class WorkView {
  readonly el = h("div", "work");
  private scroll = h("div", "wk-scroll");
  private drawer = h("aside", "wk-drawer");
  private scrim = h("div", "wk-scrim");
  private cfg: WorkConfig | null = null;
  private detect: Detect | null = null;
  private raw: Raw = { local: null, gh: null, ado: [] };
  private errors: { gh: string | null; local: string | null } = { gh: null, local: null };
  private model: Model | null = null;
  private loadedAt = 0;
  private loading = false;
  private timer: number | undefined;
  private onboarding: WorkOnboarding | null = null;
  private seen: Record<string, number> = read(SEEN, {});
  private repoMap: Record<string, string> = read(REPOS, {});
  private ui = read(UI, {
    range: "day" as Range,
    stateF: "pending" as StateFilter,
    groupBy: "smart" as GroupBy,
    onlyBugs: false,
    src: "all" as "all" | "gh" | "ado",
    prTab: "mine" as "mine" | "review" | "merged",
    closed: ["done", "review"] as string[],
  });
  private query = "";
  private cur = 0;
  private shown = PAGE;
  private visible: Item[] = [];
  private sel = new Set<string>();
  private drawerItem: Item | null = null;
  private agentPick: ToolKind | null = null;
  private started = false;

  constructor(private host: WorkHost) {
    this.el.append(this.scroll, this.scrim, this.drawer);
    this.scrim.hidden = true;
    const cache = read<{ raw: Raw | null; at: number }>(CACHE, { raw: null, at: 0 });
    if (cache.raw) {
      this.raw = cache.raw;
      this.loadedAt = cache.at;
    }
    this.scroll.addEventListener("click", (e) => this.onClick(e));
    this.scroll.addEventListener("input", (e) => {
      const q = (e.target as Element).closest<HTMLInputElement>("[data-q]");
      if (q) {
        this.query = q.value;
        this.resetList();
      }
    });
    this.scroll.addEventListener("keydown", (e) => {
      const q = (e.target as Element).closest<HTMLInputElement>("[data-q]");
      if (!q) return;
      if (e.key === "Escape") {
        q.value = this.query = "";
        this.resetList();
        q.blur();
      } else if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        q.blur();
        this.setCur(0);
      }
    });
    this.drawer.addEventListener("click", (e) => this.onDrawerClick(e));
    this.drawer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.ctrlKey) void this.sendComment();
    });
    this.scrim.addEventListener("click", () => this.closeDrawer());
    document.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("focus", () => {
      if (this.active && Date.now() - this.loadedAt > 60_000) void this.refresh();
    });
  }

  private get active(): boolean {
    return store.view === "work" && !this.el.hidden;
  }

  // ------------------------------------------------------------ ciclo de vida

  async show(): Promise<void> {
    if (!this.cfg) {
      try {
        this.cfg = await work.config();
      } catch (e) {
        toast(String(e));
        return;
      }
    }
    if (!this.cfg.onboarded) return this.openOnboarding(0);
    this.agentPick ??= this.defaultAgent();
    this.build();
    this.render();
    if (!this.started) {
      this.started = true;
      void work.detect().then((d) => {
        this.detect = d;
        this.renderHeader();
      });
    }
    if (Date.now() - this.loadedAt > 60_000 || !this.model) void this.refresh();
    this.schedule();
  }

  private schedule(): void {
    clearInterval(this.timer);
    const min = this.cfg?.refreshMinutes ?? 5;
    this.timer = window.setInterval(() => {
      if (this.active && document.hasFocus()) void this.refresh();
    }, min * 60_000);
  }

  /** Status das sessões mudou: atualiza só o que depende delas. */
  sessionsChanged(): void {
    if (!this.active || !this.cfg?.onboarded || this.onboarding) return;
    this.renderKpis();
    this.renderAgents();
  }

  /** Projeto filtrado (ou fontes trocadas): só redesenha. */
  rerender(): void {
    if (this.active && this.cfg?.onboarded && !this.onboarding) this.render();
  }

  private openOnboarding(step: number): void {
    this.closeDrawer();
    this.scroll.replaceChildren();
    this.onboarding = new WorkOnboarding(this.scroll, {
      config: this.cfg!,
      repos: this.host.repos(),
      step,
      done: (cfg, detect) => {
        this.cfg = cfg;
        this.detect = detect;
        this.started = true;
        this.onboarding = null;
        this.agentPick = this.defaultAgent();
        this.ui.groupBy = cfg.bugsFirst ? "smart" : "state";
        this.saveUi();
        this.schedule();
        this.scroll.replaceChildren();
        this.build();
        this.render();
        this.scroll.classList.add("enter");
        window.setTimeout(() => this.scroll.classList.remove("enter"), 1200);
        void this.refresh();
      },
      skip: () => {
        this.onboarding = null;
        if (this.cfg?.onboarded) void this.show();
        else this.host.openBoard();
      },
    });
  }

  async refresh(): Promise<void> {
    if (this.loading || !this.cfg) return;
    this.loading = true;
    this.renderHeader();
    const cfg = this.cfg;
    const since = Date.now() - 31 * 86_400_000;
    const sinceDate = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    try {
      const local = await work.local(this.host.repos(), since).catch((e) => {
        this.errors.local = String(e);
        return null;
      });
      if (local) this.errors.local = null;
      const hints = (local?.repos ?? [])
        .filter((r) => r.remote?.kind === "ado" && r.remote.org && r.remote.project)
        .map((r) => ({ org: r.remote!.org!, project: r.remote!.project! }));
      const [gh, ado] = await Promise.all([
        cfg.github
          ? work.github(sinceDate).then(
              (d) => ((this.errors.gh = null), d),
              (e) => ((this.errors.gh = String(e)), this.raw.gh),
            )
          : Promise.resolve(null),
        cfg.adoOrgs.length ? work.ado(cfg.adoOrgs, hints).catch(() => this.raw.ado) : Promise.resolve([]),
      ]);
      this.raw = { local: local ?? this.raw.local, gh: cfg.github ? gh : null, ado };
      this.loadedAt = Date.now();
      write(CACHE, { raw: this.raw, at: this.loadedAt });
    } finally {
      this.loading = false;
    }
    this.build();
    if (this.active && !this.onboarding) this.render();
  }

  private build(): void {
    this.model = build(this.raw);
    // Primeira vez que vemos um item: os comentários atuais já contam como lidos.
    let changed = false;
    for (const i of this.model.items) {
      if (this.seen[i.key] === undefined) {
        this.seen[i.key] = i.comments;
        changed = true;
      }
    }
    if (changed) write(SEEN, this.seen);
  }

  private newComments = (i: Item) => Math.max(0, i.comments - (this.seen[i.key] ?? i.comments));

  private saveUi(): void {
    write(UI, this.ui);
  }

  // ------------------------------------------------------------ projeto e repositórios

  private repoKey(i: { src: "gh" | "ado"; repo?: string; org?: string; adoProject?: string }): string {
    return i.src === "gh" ? `gh:${(i.repo ?? "").toLowerCase()}` : `ado:${(i.org ?? "").toLowerCase()}/${(i.adoProject ?? "").toLowerCase()}`;
  }

  /** Pasta local do item: pelo remoto do repositório ou pela escolha lembrada. */
  private repoPath(i: { src: "gh" | "ado"; repo?: string; org?: string; adoProject?: string }): string | null {
    const remembered = this.repoMap[this.repoKey(i)];
    if (remembered) return remembered;
    const repos = this.model?.repos ?? [];
    const hit = repos.find((r) => {
      const rm = r.remote;
      if (!rm) return false;
      if (i.src === "gh") return rm.kind === "github" && rm.slug === (i.repo ?? "").toLowerCase();
      return rm.kind === "ado" && rm.org?.toLowerCase() === i.org?.toLowerCase() && rm.project?.toLowerCase() === i.adoProject?.toLowerCase();
    });
    return hit?.path ?? null;
  }

  private inProject(path: string | null): boolean {
    if (!store.project) return true;
    return !!path && normPath(store.git[path]?.project ?? path) === store.project;
  }

  private items(): Item[] {
    return (this.model?.items ?? []).filter((i) => this.inProject(this.repoPath(i)));
  }

  private prs(): Pr[] {
    return (this.model?.prs ?? []).filter((p) => {
      if (!store.project) return true;
      return this.inProject(this.repoPath(p.src === "gh" ? { src: "gh", repo: p.repo } : { src: "ado", org: p.org, adoProject: p.adoProject }));
    });
  }

  private commits() {
    return (this.model?.commits ?? []).filter((c) => this.inProject(c.repo));
  }

  private rangeStart(): number {
    if (this.ui.range === "week") return startOfWeek();
    if (this.ui.range === "sprint") return this.model?.sprint?.start ?? Date.now() - 14 * 86_400_000;
    return startOfDay();
  }

  // ------------------------------------------------------------ desenho

  private render(): void {
    if (!this.scroll.querySelector(".wk-hero")) {
      this.scroll.innerHTML = `
        <div class="wk-hero"></div>
        <div class="wk-kpis"></div>
        <div class="wk-grid">
          <div class="wk-col">
            <section class="wk-card wk-todo" tabindex="-1"></section>
            <section class="wk-card wk-prs"></section>
            <section class="wk-card wk-proj"></section>
          </div>
          <div class="wk-col">
            <section class="wk-card wk-sprint"></section>
            <section class="wk-card wk-tl"></section>
            <section class="wk-card wk-agents"></section>
            <section class="wk-card wk-heat"></section>
          </div>
        </div>`;
    }
    this.renderHeader();
    this.renderKpis();
    this.renderTodo();
    this.renderPrs();
    this.renderProjects();
    this.renderSprint();
    this.renderTimeline();
    this.renderAgents();
    this.renderHeat();
  }

  private part(sel: string): HTMLElement | null {
    return this.scroll.querySelector<HTMLElement>(sel);
  }

  private renderHeader(): void {
    const el = this.part(".wk-hero");
    if (!el || !this.cfg) return;
    const now = new Date();
    const hour = now.getHours();
    const period = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
    const repoUser = this.model?.repos.find((r) => r.user)?.user ?? "";
    const name = (this.detect?.githubName || this.raw.gh?.viewer.name || repoUser || "").split(/\s+/)[0];
    const date = now.toLocaleDateString(localeTag(), { weekday: "long", day: "numeric", month: "long" });
    const items = this.items();
    const pending = items.filter(isPending);
    const today = commitsSince(this.commits(), startOfDay()).commits.length;
    const reviews = this.prs().filter((p) => p.role === "review").length;
    const parts = [
      today ? tn("work.summary.commits", today) : "",
      pending.length ? tn("work.summary.pending", pending.length) + (pending.some(isBug) ? ` (${tn("work.summary.bugs", pending.filter(isBug).length)})` : "") : "",
      reviews ? tn("work.summary.reviews", reviews) : "",
    ].filter(Boolean);
    const login = this.raw.gh?.viewer.login ?? this.detect?.githubLogin;
    const adoErr = this.raw.ado.filter((o) => o.error);
    const chip = (key: string, icon: string, label: string, status: "ok" | "warn" | "off", tip: string) =>
      `<button class="wk-src ${status}" data-sources="${key}" title="${esc(tip)}">${icon}<span>${esc(label)}</span><i></i></button>`;
    const repos = this.model?.repos.length ?? this.host.repos().length;
    el.innerHTML = `
      <div class="wk-hello">
        <div class="wk-date">${esc(date.charAt(0).toUpperCase() + date.slice(1))}</div>
        <h1>${esc(name ? t(`work.hello.${period}`, { name }) : t(`work.helloAnon.${period}`))}</h1>
        <div class="wk-sum">${parts.length ? parts.join(" · ") : t("work.summary.quiet")}</div>
      </div>
      <div class="wk-actions">
        ${store.project ? `<span class="wk-pchip">${esc(t("work.filterProject", { project: store.projectName }))}</span>` : ""}
        <div class="seg wk-range">${(["day", "week", "sprint"] as Range[]).map((r) => `<button data-range="${r}" class="${this.ui.range === r ? "on" : ""}">${t(`work.range.${r}`)}</button>`).join("")}</div>
        ${chip("local", I.git, tn("work.chip.local", repos), this.errors.local ? "warn" : "ok", this.errors.local ?? "")}
        ${
          this.cfg.github
            ? chip(
                "github",
                I.gh,
                login ? t("work.chip.githubAs", { login }) : t("work.chip.github"),
                this.errors.gh ? "warn" : this.raw.gh ? "ok" : "off",
                this.errors.gh ? t("work.chip.error", { source: "GitHub", error: this.errors.gh }) : this.raw.gh ? "" : t("work.chip.off", { source: "GitHub" }),
              )
            : ""
        }
        ${chip(
          "ado",
          I.ado,
          this.cfg.adoOrgs.length ? tn("work.chip.adoOrgs", this.cfg.adoOrgs.length) : t("work.chip.ado"),
          !this.cfg.adoOrgs.length ? "off" : adoErr.length ? "warn" : "ok",
          adoErr.length ? adoErr.map((o) => t("work.chip.error", { source: o.org, error: o.error ?? "" })).join("\n") : this.cfg.adoOrgs.length ? "" : t("work.chip.off", { source: "Azure DevOps" }),
        )}
        <span class="wk-upd">${this.loading ? t("work.updating") : this.loadedAt ? t("work.updated", { ago: ago(this.loadedAt) }) : ""}
          <button class="ibtn sm${this.loading ? " spin" : ""}" data-refresh title="${t("work.refresh")}">${I.refresh}</button>
          <button class="ibtn sm" data-sources="" title="${t("work.sources")}">${ICON.gear}</button>
        </span>
      </div>`;
  }

  private spark(vals: number[], color: string): string {
    const w = 72;
    const hgt = 26;
    const max = Math.max(1, ...vals);
    const pts = vals.map((v, i) => `${((i / Math.max(1, vals.length - 1)) * w).toFixed(1)},${(hgt - (v / max) * (hgt - 4) - 2).toFixed(1)}`).join(" ");
    return `<svg class="wk-spark" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  private renderKpis(): void {
    const el = this.part(".wk-kpis");
    if (!el) return;
    const slice = commitsSince(this.commits(), this.rangeStart());
    const prs = this.prs();
    const mine = prs.filter((p) => p.role === "mine");
    const failing = mine.filter((p) => p.checks === "bad").length;
    const reviews = prs.filter((p) => p.role === "review");
    const oldest = reviews.reduce((a, p) => Math.min(a, p.created || Date.now()), Date.now());
    const sp = this.model?.sprint;
    const pending = this.items().filter(isPending);
    const working = store.sessions.filter((s) => s.runtime.status === "working" || s.runtime.status === "starting").length;
    const waiting = store.sessions.filter((s) => s.runtime.status === "waiting").length;
    const nf = new Intl.NumberFormat(localeTag());
    const kpi = (c: string, label: string, value: string, sub: string, extra = "", attr = "") =>
      `<div class="wk-kpi" style="--c:${c}" ${attr}><div class="l">${label}</div><div class="v">${value}</div><div class="s">${sub}</div>${extra}</div>`;
    el.innerHTML = [
      kpi(
        "var(--ok)",
        t(`work.kpi.commits.${this.ui.range}`),
        nf.format(slice.commits.length),
        `<span class="add">+${nf.format(slice.add)}</span> <span class="del">−${nf.format(slice.del)}</span> ${t("work.kpi.lines")}`,
        this.spark(perDay(this.commits(), 7), "#3fb27f"),
      ),
      kpi("var(--accent)", t("work.kpi.prs"), String(mine.length), failing ? tn("work.kpi.prsFailing", failing) : t("work.kpi.prsAllGood"), "", 'data-prtab="mine"'),
      kpi("#b48aff", t("work.kpi.reviews"), String(reviews.length), reviews.length ? t("work.kpi.reviewsOldest", { ago: ago(oldest) }) : t("work.kpi.reviewsNone"), "", 'data-prtab="review"'),
      sp
        ? kpi(
            "#4c9bf0",
            esc(sp.name),
            `${nf.format(sp.done)}<small>/ ${nf.format(sp.total)}</small>`,
            t("work.kpi.sprintSub", {
              pct: sp.total ? Math.round((sp.done / sp.total) * 100) : 0,
              days: sp.daysLeft ? tn("work.sprint.left", sp.daysLeft).replace(/<\/?b>/g, "") : t("work.sprint.ended"),
            }),
          )
        : kpi("#4c9bf0", t("work.kpi.sprint"), "—", t("work.kpi.sprintNone")),
      kpi("var(--warn)", t("work.kpi.pending"), String(pending.length), tn("work.kpi.pendingBugs", pending.filter(isBug).length), "", 'data-pending=""'),
      kpi("#ff8a70", t("work.kpi.agents"), String(working + waiting), t("work.kpi.agentsSub", { working, waiting }), "", 'data-board=""'),
    ].join("");
  }

  // ------------------------------------------------------------ Para fazer

  private baseList(): Item[] {
    return this.items().filter((i) => (this.ui.src === "all" || i.src === this.ui.src) && matches(i, this.query));
  }

  private renderTodo(): void {
    const el = this.part(".wk-todo");
    if (!el) return;
    if (!el.querySelector(".wk-list")) {
      el.innerHTML = `
        <div class="wk-ch"><h3>${t("work.todo.title")}</h3><span class="cnt" data-cnt></span><div class="sp"></div>
          <div class="seg sm" data-srcs>${(["all", "gh", "ado"] as const).map((s) => `<button data-srcf="${s}">${s === "all" ? t("work.filters.all") : srcName(s)}</button>`).join("")}</div></div>
        <div class="wk-tbar">
          <label class="wk-search">${I.search}<input data-q placeholder="${esc(t("work.todo.search"))}" spellcheck="false"><kbd>/</kbd></label>
          <div class="wk-chips" data-chips></div>
          <button class="wk-chip bug" data-bugs title="${t("work.todo.onlyBugsHint")}">🐞 ${t("work.todo.onlyBugs")}<em data-bugcnt></em></button>
          <div class="sp"></div>
          <div class="wk-grp">${t("work.todo.group")}
            <div class="seg sm" data-groups>
              <button data-group="smart" title="${esc(t("work.todo.groupSmartHint"))}">${t("work.todo.groupSmart")}</button>
              <button data-group="state">${t("work.todo.groupState")}</button>
              <button data-group="project">${t("work.todo.groupProject")}</button>
              <button data-group="none">${t("work.todo.groupNone")}</button>
            </div>
          </div>
        </div>
        <div class="wk-bulk" hidden><span data-bulktxt></span><div class="sp"></div>
          <button class="primary sm" data-bulk="wt">${I.bot}${t("work.todo.bulkImpl")}</button>
          <button class="ghost sm" data-bulk="plan">${t("work.todo.bulkPlan")}</button>
          <button class="ghost sm" data-bulk="clear">${t("work.todo.bulkClear")}</button></div>
        <div class="wk-list"></div>
        <div class="wk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> ${t("work.keys.nav")}</span><span><kbd>A</kbd> ${t("work.keys.implement")}</span>
          <span><kbd>⇧A</kbd> ${t("work.keys.more")}</span><span><kbd>C</kbd> ${t("work.keys.comments")}</span>
          <span><kbd>O</kbd> ${t("work.keys.open")}</span><span><kbd>X</kbd> ${t("work.keys.select")}</span>
          <span><kbd>P</kbd> ${t("work.keys.pending")}</span><span><kbd>B</kbd> ${t("work.keys.bugs")}</span><span><kbd>/</kbd> ${t("work.keys.search")}</span>
        </div>`;
    }
    const base = this.baseList();
    el.querySelectorAll<HTMLElement>("[data-srcf]").forEach((b) => b.classList.toggle("on", b.dataset.srcf === this.ui.src));
    el.querySelectorAll<HTMLElement>("[data-group]").forEach((b) => b.classList.toggle("on", b.dataset.group === this.ui.groupBy));
    const sf = STATE_FILTERS[this.ui.stateF];
    el.querySelector("[data-chips]")!.innerHTML = (Object.keys(STATE_FILTERS) as StateFilter[])
      .map((k) => {
        const n = base.filter((i) => STATE_FILTERS[k](i) && (!this.ui.onlyBugs || isBug(i))).length;
        return `<button class="wk-chip${this.ui.stateF === k ? " on" : ""}" data-sf="${k}">${t(`work.filters.${k}`)}<em>${n}</em></button>`;
      })
      .join("");
    el.querySelector("[data-bugs]")!.classList.toggle("on", this.ui.onlyBugs);
    el.querySelector("[data-bugcnt]")!.textContent = String(base.filter((i) => sf(i) && isBug(i)).length);
    const list = base.filter((i) => sf(i) && (!this.ui.onlyBugs || isBug(i)));
    el.querySelector("[data-cnt]")!.textContent = String(list.length);
    this.renderList(list);
  }

  private renderList(list: Item[], keepScroll = true): void {
    const box = this.part(".wk-todo .wk-list");
    if (!box) return;
    const top = box.scrollTop;
    this.visible = [];
    const hasSource = !!(this.cfg?.github && this.raw.gh) || !!this.cfg?.adoOrgs.length;
    if (!list.length) {
      box.innerHTML = `<div class="wk-empty">${
        this.query ? esc(t("work.todo.emptyQuery", { q: this.query })) : hasSource ? t("work.todo.empty") : `${t("work.todo.emptyNoSource")}<br><button class="primary sm" data-sources="">${t("work.todo.connect")}</button>`
      }</div>`;
      this.updateBulk();
      return;
    }
    const groups = group(list, this.ui.groupBy, this.newComments);
    let html = "";
    let budget = this.shown;
    let total = 0;
    for (const g of groups) {
      if (!g.items.length) continue;
      const closed = this.ui.closed.includes(g.key);
      if (g.title) {
        html += `<div class="wk-gh${closed ? " closed" : ""}${g.urgent ? " urgent" : ""}" data-gk="${esc(g.key)}">${ICON.chevron}${g.color ? `<i class="dot" style="background:${esc(g.color)}"></i>` : ""}<span>${g.literal ? esc(g.title) : t(`work.${g.title}`)}</span><em>${g.items.length}</em>${g.hint ? `<small>${t(`work.${g.hint}`)}</small>` : ""}</div>`;
      }
      if (closed) continue;
      total += g.items.length;
      for (const i of g.items) {
        if (budget-- <= 0) break;
        html += this.row(i, this.visible.length);
        this.visible.push(i);
      }
    }
    if (total > this.visible.length) {
      const left = total - this.visible.length;
      html += `<div class="wk-more"><button data-more>${t("work.todo.more", { n: Math.min(PAGE, left), left })}</button></div>`;
    }
    box.innerHTML = html;
    box.classList.toggle("selecting", this.sel.size > 0);
    if (keepScroll) box.scrollTop = top;
    if (this.cur >= this.visible.length) this.cur = Math.max(0, this.visible.length - 1);
    this.updateBulk();
  }

  private row(i: Item, idx: number): string {
    const k = bugKind(i);
    const nc = this.newComments(i);
    const why = reasons(i, nc)
      .map((r) => (r.key === "newComments" ? tn("work.reason.newComments", nc) : t(`work.reason.${r.key}`, r.vars)))
      .join(" · ");
    const tags = [
      i.priority && i.priority <= 2 ? `<span class="wk-tag p${i.priority}">P${i.priority}</span>` : "",
      k && k !== "label" ? `<span class="wk-tag guess" title="${esc(t("work.todo.likelyBugHint", { word: k }))}">${t("work.todo.likelyBug")}</span>` : "",
      ...i.tags.slice(0, 3).map((x) => `<span class="wk-tag">${esc(x)}</span>`),
    ].join("");
    const cm = i.comments ? `<span class="wk-cm${nc ? " new" : ""}">${I.comment}${i.comments}${nc ? ` · ${tn("work.todo.newComments", nc)}` : ""}</span>` : "";
    const agent = this.agentPick ? TOOLS[this.agentPick].short : "";
    return `<div class="wk-it${idx === this.cur ? " cur" : ""}${this.sel.has(i.key) ? " sel" : ""}${i.state === "done" ? " done" : ""}" data-i="${idx}">
      <div class="cb" data-sel title="${t("work.todo.select")}"></div>
      <div class="ic">${KIND_ICON(i)}</div>
      <div class="t" title="${esc(why || t("work.reason.none"))}"><b>${esc(i.title)}</b>
        <div class="m">${I[i.src]}<span class="ref">${esc(i.ref)}</span>${i.src === "ado" && i.typeName ? `<span class="wk-type">${esc(i.typeName)}</span>` : ""}<span>${esc(i.project)}</span>${tags}${cm}<span>${ago(i.updated)}</span></div>
      </div>
      <div class="r">
        <div class="acts">
          <span class="split"><button class="primary xs" data-do="impl" title="${esc(t("work.todo.implementWith", { agent }))}">${I.bot}${t("work.todo.implement")}</button><button class="primary xs caret" data-do="menu" title="${t("work.todo.moreOptions")}">${I.caret}</button></span>
          <button class="ibtn xs" data-do="comments" title="${t("work.todo.comments")}">${I.comment}</button>
          <button class="ibtn xs" data-do="open" title="${t("work.todo.open")}">${I.ext}</button>
        </div>
        ${this.statePill(i)}
      </div>
    </div>`;
  }

  /** Estado como na origem: no Azure DevOps, o nome e a cor reais. */
  private statePill(i: Item): string {
    if (i.src === "ado" && i.rawState) {
      const style = i.stateColor ? ` style="--sc:${esc(i.stateColor)}"` : "";
      const blocked = i.state === "blocked" ? ` · ${t("work.state.blocked")}` : "";
      return `<span class="wk-st real${i.stateColor ? "" : ` ${i.state}`}"${style} title="${esc(t(`work.state.${i.state}`))}">${esc(i.rawState)}${blocked}</span>`;
    }
    return `<span class="wk-st ${i.state}">${t(`work.state.${i.state}`)}</span>`;
  }

  private resetList(): void {
    this.cur = 0;
    this.shown = PAGE;
    const box = this.part(".wk-todo .wk-list");
    if (box) box.scrollTop = 0;
    this.renderTodo();
  }

  private setCur(i: number, scroll = true): void {
    if (!this.visible.length) return;
    this.cur = Math.max(0, Math.min(this.visible.length - 1, i));
    this.scroll.querySelectorAll<HTMLElement>(".wk-it").forEach((r) => r.classList.toggle("cur", Number(r.dataset.i) === this.cur));
    if (scroll) this.scroll.querySelector(`.wk-it[data-i="${this.cur}"]`)?.scrollIntoView({ block: "nearest" });
  }

  private updateBulk(): void {
    const b = this.part(".wk-bulk");
    if (!b) return;
    b.hidden = this.sel.size === 0;
    b.querySelector("[data-bulktxt]")!.innerHTML = tn("work.todo.selected", this.sel.size);
  }

  private toggleSel(i: Item): void {
    if (this.sel.has(i.key)) this.sel.delete(i.key);
    else this.sel.add(i.key);
    this.renderTodo();
  }

  // ------------------------------------------------------------ PRs e cartões laterais

  private renderPrs(): void {
    const el = this.part(".wk-prs");
    if (!el) return;
    const all = this.prs();
    const list = all.filter((p) => p.role === this.ui.prTab).sort((a, b) => (b.merged ?? b.updated) - (a.merged ?? a.updated));
    const count = (r: Pr["role"]) => all.filter((p) => p.role === r).length;
    const checks = (p: Pr) =>
      p.checks ? `<span class="wk-checks ${p.checks}">${p.src === "ado" && p.checks === "bad" ? t("work.prs.conflicts") : t(`work.prs.checks.${p.checks}`)}</span>` : "";
    const decision = (p: Pr) => {
      if (p.role === "merged") return `<span class="wk-st done">${t("work.prs.decision.merged")}</span>`;
      if (p.draft) return `<span class="wk-st todo">${t("work.prs.decision.draft")}</span>`;
      return p.review ? `<span class="wk-st ${p.review === "approved" ? "doing" : p.review === "changes" ? "blocked" : "review"}">${t(`work.prs.decision.${p.review}`)}</span>` : "";
    };
    el.innerHTML = `
      <div class="wk-ch"><h3>${t("work.prs.title")}</h3><span class="cnt">${all.filter((p) => p.role !== "merged").length}</span><div class="sp"></div>
        <div class="seg sm">${(["mine", "review", "merged"] as const).map((r) => `<button data-prtab="${r}" class="${this.ui.prTab === r ? "on" : ""}">${t(`work.prs.${r}`)} <em>${count(r)}</em></button>`).join("")}</div></div>
      <div class="wk-items">${
        list.length
          ? list
              .slice(0, 40)
              .map(
                (p) => `<div class="wk-it pr" data-pr="${esc(p.key)}">
          <div class="ic">${p.role === "merged" ? I.merged : I.pr}</div>
          <div class="t"><b>${esc(p.title)}</b>
            <div class="m">${I[p.src]}<span class="ref">${esc(p.ref)}</span><span>${esc(p.repo.split("/").pop() ?? p.repo)}</span>${p.author && p.role === "review" ? `<span>@${esc(p.author)}</span>` : ""}<span>${ago(p.merged ?? p.updated)}</span>${
              p.add !== null ? `<span><span class="add">+${p.add}</span> <span class="del">−${p.del}</span></span>` : ""
            }</div>
          </div>
          <div class="r">
            <div class="acts">${p.role === "review" ? `<button class="ghost xs" data-prdo="review">${I.bot}${t("work.prs.reviewAgent")}</button>` : ""}<button class="ibtn xs" data-prdo="open" title="${t("work.prs.open")}">${I.ext}</button></div>
            ${checks(p)}${decision(p)}
          </div></div>`,
              )
              .join("")
          : `<div class="wk-empty sm">${t("work.prs.empty")}</div>`
      }</div>`;
  }

  private renderProjects(): void {
    const el = this.part(".wk-proj");
    if (!el) return;
    const slice = commitsSince(this.commits(), this.rangeStart()).commits;
    const by = new Map<string, { n: number; add: number; del: number }>();
    for (const c of slice) {
      const k = c.repo;
      const v = by.get(k) ?? { n: 0, add: 0, del: 0 };
      v.n++;
      v.add += c.add;
      v.del += c.del;
      by.set(k, v);
    }
    const rows = [...by.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
    const max = Math.max(1, ...rows.map(([, v]) => v.add + v.del));
    const color = (path: string) => store.projects.find((p) => normPath(p.path) === normPath(path))?.color ?? "var(--accent)";
    el.innerHTML = `<div class="wk-ch"><h3>${t("work.projects.title")}</h3><div class="sp"></div><span class="wk-faint">${t("work.projects.sub")}</span></div>
      <div class="wk-bars">${
        rows.length
          ? rows
              .map(
                ([path, v]) => `<div class="wk-bar" title="${esc(path)}"><div class="n"><i style="background:${color(path)}"></i>${esc(basename(path))}</div>
                <div class="track"><span style="width:${(v.add / max) * 100}%;background:${color(path)}"></span><span style="width:${(v.del / max) * 100}%;background:${color(path)};opacity:.35"></span></div>
                <div class="v">${tn("work.projects.commits", v.n)}</div></div>`,
              )
              .join("")
          : `<div class="wk-empty sm">${t("work.projects.empty")}</div>`
      }</div>`;
  }

  private renderSprint(): void {
    const el = this.part(".wk-sprint");
    if (!el) return;
    const sp = this.model?.sprint;
    if (!sp) {
      el.innerHTML = `<div class="wk-ch">${I.ado}<h3>${t("work.sprint.title")}</h3></div><div class="wk-empty sm">${t("work.sprint.none")}${
        this.cfg?.adoOrgs.length ? "" : `<br><button class="ghost sm" data-sources="ado">${t("work.todo.connect")}</button>`
      }</div>`;
      return;
    }
    const fmt = (d: number) => new Date(d).toLocaleDateString(localeTag(), { day: "numeric", month: "short" });
    const unit = t(sp.unit === "points" ? "work.sprint.unitPoints" : "work.sprint.unitItems");
    const fallback: Record<string, string> = { done: "var(--ok)", doing: "#5cc8e0", review: "#b48aff", blocked: "var(--bad)", todo: "rgba(255,255,255,.18)" };
    const parts: [string, number, string][] = sp.byState.map((s) => [esc(s.name), s.value, s.color ? esc(s.color) : fallback[s.state]]);
    const tot = Math.max(1, sp.total);
    const W = 220;
    const H = 72;
    const x = (i: number) => (i / Math.max(1, sp.days - 1)) * W;
    const y = (v: number) => H - 4 - (v / tot) * (H - 10);
    const pts = sp.burndown.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const last = sp.burndown.length - 1;
    const left = sp.daysLeft === 0 ? t("work.sprint.ended") : sp.daysLeft === 1 ? t("work.sprint.lastDay") : tn("work.sprint.left", sp.daysLeft);
    el.innerHTML = `<div class="wk-ch">${I.ado}<h3>${esc(sp.name)} · ${esc(sp.project)}</h3><div class="sp"></div><button class="link" data-url="${esc(sp.url)}">${t("work.sprint.open")}</button></div>
      <div class="wk-spr">
        <div>
          <div class="big">${left}</div>
          <div class="wk-faint">${fmt(sp.start)} → ${fmt(sp.finish)} · ${t("work.sprint.progress", { done: sp.done, total: sp.total, unit })}</div>
          <div class="wk-dist">${parts.filter((p) => p[1] > 0).map((p) => `<span style="flex:${p[1]};background:${p[2]}" title="${p[0]}: ${p[1]}"></span>`).join("")}</div>
          <div class="wk-legend">${parts.filter((p) => p[1] > 0).map((p) => `<span><i style="background:${p[2]}"></i>${p[0]}<b>${p[1]}</b></span>`).join("")}</div>
        </div>
        <div>
          <svg class="wk-burn" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
            <defs><linearGradient id="wkg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#8aa2ff" stop-opacity=".35"/><stop offset="1" stop-color="#8aa2ff" stop-opacity="0"/></linearGradient></defs>
            <line x1="0" y1="${y(tot)}" x2="${W}" y2="${y(0)}" stroke="rgba(255,255,255,.22)" stroke-dasharray="3 4"/>
            ${last >= 0 ? `<polygon points="0,${H} ${pts} ${x(last)},${H}" fill="url(#wkg)"/><polyline points="${pts}" fill="none" stroke="#8aa2ff" stroke-width="2" stroke-linejoin="round"/><circle cx="${x(last)}" cy="${y(sp.burndown[last])}" r="3.5" fill="#8aa2ff" stroke="#0e1020" stroke-width="2"/>` : ""}
          </svg>
          <div class="wk-burnlbl"><span>${fmt(sp.start)}</span><span>${t("work.sprint.burndown")}</span><span>${fmt(sp.finish)}</span></div>
        </div>
      </div>`;
  }

  private renderTimeline(): void {
    const el = this.part(".wk-tl");
    if (!el) return;
    const since = startOfDay();
    type Ev = { at: number; color: string; html: string; sub: string; url?: string };
    const evs: Ev[] = [];
    // Commits agrupados por repositório e hora.
    const buckets = new Map<string, { at: number; n: number; add: number; del: number; repo: string }>();
    for (const c of this.commits().filter((c) => c.date >= since)) {
      const k = `${c.repo}|${new Date(c.date).getHours()}`;
      const b = buckets.get(k) ?? { at: c.date, n: 0, add: 0, del: 0, repo: c.repo };
      b.n++;
      b.add += c.add;
      b.del += c.del;
      b.at = Math.max(b.at, c.date);
      buckets.set(k, b);
    }
    for (const b of buckets.values()) {
      evs.push({ at: b.at, color: "var(--ok)", html: tn("work.timeline.commits", b.n, { repo: esc(basename(b.repo)) }), sub: `+${b.add} −${b.del}` });
    }
    for (const p of this.prs()) {
      if (p.role === "mine" && p.created >= since) evs.push({ at: p.created, color: "#c9d1d9", html: esc(t("work.timeline.prOpened", { ref: p.ref })), sub: esc(p.title), url: p.url });
      if (p.role === "merged" && (p.merged ?? 0) >= since) evs.push({ at: p.merged!, color: "#b48aff", html: esc(t("work.timeline.prMerged", { ref: p.ref })), sub: esc(p.title), url: p.url });
    }
    for (const i of this.items()) {
      if (i.src === "gh" && i.closed && i.closed >= since) evs.push({ at: i.closed, color: "#3fb27f", html: esc(t("work.timeline.issueClosed", { ref: i.ref })), sub: esc(i.title), url: i.url });
    }
    for (const i of this.model?.touched ?? []) {
      if (i.updated >= since && this.inProject(this.repoPath(i)))
        evs.push({ at: i.updated, color: "#4c9bf0", html: esc(t("work.timeline.itemTouched", { ref: i.ref, state: i.rawState })), sub: esc(i.title), url: i.url });
    }
    for (const s of store.sessions.filter((s) => s.createdAt >= since && s.tool !== "shell" && store.inProject(s))) {
      evs.push({ at: s.createdAt, color: TOOLS[s.tool].color, html: esc(t("work.timeline.session", { tool: TOOLS[s.tool].short, project: basename(s.cwd) })), sub: esc(s.title) });
    }
    evs.sort((a, b) => b.at - a.at);
    const time = (d: number) => new Date(d).toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" });
    el.innerHTML = `<div class="wk-ch"><h3>${t("work.timeline.title")}</h3></div>
      <div class="wk-tlist">${
        evs.length
          ? evs
              .slice(0, 30)
              .map((e) => `<div class="wk-ev${e.url ? " link" : ""}" ${e.url ? `data-url="${esc(e.url)}"` : ""}><div class="h">${time(e.at)}</div><div class="d" style="background:${e.color}"></div><div class="x"><div>${e.html}</div><div class="s">${e.sub}</div></div></div>`)
              .join("")
          : `<div class="wk-empty sm">${t("work.timeline.empty")}</div>`
      }</div>`;
  }

  private renderAgents(): void {
    const el = this.part(".wk-agents");
    if (!el) return;
    const visible = store.sessions.filter((s) => s.tool !== "shell" && store.inProject(s));
    const working = visible.filter((s) => s.runtime.status === "working" || s.runtime.status === "starting").length;
    const waiting = visible.filter((s) => s.runtime.status === "waiting").length;
    const today = visible.filter((s) => s.createdAt >= startOfDay()).length;
    const usage = store.usage
      .flatMap((u) => u.windows.filter((w) => w.usedPercent !== null).slice(0, 1).map((w) => ({ tool: u.provider, w })))
      .slice(0, 3);
    el.innerHTML = `<div class="wk-ch"><h3>${t("work.agents.title")}</h3><div class="sp"></div><button class="link" data-board="">${t("work.agents.open")}</button></div>
      <div class="wk-ags">
        <div class="ag"><div class="k">${t("work.agents.working")}</div><div class="v">${working}</div></div>
        <div class="ag${waiting ? " warn" : ""}"><div class="k">${t("work.agents.waiting")}</div><div class="v">${waiting}</div></div>
        <div class="ag"><div class="k">${t("work.agents.today")}</div><div class="v">${today}</div></div>
      </div>
      ${
        usage.length
          ? `<div class="wk-usage">${usage
              .map(
                (u) => `<div><span>${TOOLS[u.tool].short} · ${esc(u.w.short)}</span><span class="bar"><i style="width:${u.w.usedPercent}%;background:${TOOLS[u.tool].color}"></i></span><b>${Math.round(u.w.usedPercent!)}%</b></div>`,
              )
              .join("")}</div>`
          : ""
      }`;
  }

  private renderHeat(): void {
    const el = this.part(".wk-heat");
    if (!el) return;
    const m = heat(this.commits());
    const max = Math.max(1, ...m.flat());
    const day = (back: number) => new Date(Date.now() - back * 86_400_000).toLocaleDateString(localeTag(), { weekday: "short" });
    let cells = `<div></div>${Array.from({ length: 24 }, (_, hr) => `<div class="hl">${hr % 3 === 0 ? hr : ""}</div>`).join("")}`;
    m.forEach((row, d) => {
      cells += `<div class="dl">${esc(day(6 - d))}</div>`;
      row.forEach((v, hr) => {
        cells += `<div class="c" style="${v ? `background:rgba(138,162,255,${(0.2 + (v / max) * 0.8).toFixed(2)})` : ""}" title="${esc(day(6 - d))} ${hr}h · ${tn("work.projects.commits", v)}"></div>`;
      });
    });
    el.innerHTML = `<div class="wk-ch"><h3>${t("work.rhythm.title")}</h3><div class="sp"></div><span class="wk-faint">${t("work.rhythm.sub")}</span></div><div class="wk-hm">${cells}</div>`;
  }

  // ------------------------------------------------------------ eventos

  private onClick(e: MouseEvent): void {
    const target = e.target as Element;
    const d = (sel: string) => target.closest<HTMLElement>(sel);
    if (d("[data-refresh]")) return void this.refresh();
    const src = d("[data-sources]");
    if (src) return this.openOnboarding(1);
    const range = d("[data-range]");
    if (range) {
      this.ui.range = range.dataset.range as Range;
      this.saveUi();
      this.renderHeader();
      this.renderKpis();
      this.renderProjects();
      return;
    }
    const tab = d("[data-prtab]");
    if (tab) {
      this.ui.prTab = tab.dataset.prtab as typeof this.ui.prTab;
      this.saveUi();
      this.renderPrs();
      if (tab.classList.contains("wk-kpi")) this.part(".wk-prs")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (d("[data-pending]")) {
      this.ui.stateF = "pending";
      this.saveUi();
      this.resetList();
      this.part(".wk-todo")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (d("[data-board]")) return this.host.openBoard();
    const url = d("[data-url]");
    if (url) return void ipc.openUrl(url.dataset.url!);
    const sf = d("[data-sf]");
    if (sf) {
      this.ui.stateF = sf.dataset.sf as StateFilter;
      if (this.ui.stateF === "done") this.ui.closed = this.ui.closed.filter((k) => k !== "done");
      if (this.ui.stateF === "review") this.ui.closed = this.ui.closed.filter((k) => k !== "review");
      this.saveUi();
      return this.resetList();
    }
    const srcf = d("[data-srcf]");
    if (srcf) {
      this.ui.src = srcf.dataset.srcf as typeof this.ui.src;
      this.saveUi();
      return this.resetList();
    }
    if (d("[data-bugs]")) return this.toggleBugs();
    const grp = d("[data-group]");
    if (grp) {
      this.ui.groupBy = grp.dataset.group as GroupBy;
      this.ui.closed = this.ui.groupBy === "smart" ? ["done", "review"] : this.ui.groupBy === "state" ? ["done"] : [];
      this.saveUi();
      return this.resetList();
    }
    const gh = d(".wk-gh");
    if (gh) {
      const k = gh.dataset.gk!;
      this.ui.closed = this.ui.closed.includes(k) ? this.ui.closed.filter((x) => x !== k) : [...this.ui.closed, k];
      this.saveUi();
      return this.renderTodo();
    }
    if (d("[data-more]")) {
      this.shown += PAGE;
      return this.renderTodo();
    }
    const bulk = d("[data-bulk]");
    if (bulk) {
      const mode = bulk.dataset.bulk!;
      if (mode === "clear") {
        this.sel.clear();
        return this.renderTodo();
      }
      const items = (this.model?.items ?? []).filter((i) => this.sel.has(i.key));
      this.sel.clear();
      this.renderTodo();
      return void this.toAgents(items, mode as Mode, bulk);
    }
    const pr = d("[data-pr]");
    if (pr) {
      const p = this.prs().find((x) => x.key === pr.dataset.pr);
      if (!p) return;
      const act = d("[data-prdo]")?.dataset.prdo;
      if (act === "review") return void this.reviewPr(p, pr);
      return void ipc.openUrl(p.url);
    }
    const row = d(".wk-it[data-i]");
    if (row) {
      const idx = Number(row.dataset.i);
      const item = this.visible[idx];
      if (!item) return;
      this.setCur(idx, false);
      if (d("[data-sel]") || e.ctrlKey) return this.toggleSel(item);
      const act = d("[data-do]");
      switch (act?.dataset.do) {
        case "impl":
          return void this.toAgent(item, "impl", act);
        case "menu":
          return this.agentMenu(item, act);
        case "open":
          return void ipc.openUrl(item.url);
        default:
          return void this.openDrawer(item);
      }
    }
  }

  private toggleBugs(): void {
    this.ui.onlyBugs = !this.ui.onlyBugs;
    this.saveUi();
    this.resetList();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.active || this.onboarding || e.ctrlKey || e.altKey || e.metaKey) return;
    if (document.querySelector(".modal")) return;
    const target = e.target as Element;
    if (target.closest?.(".xterm")) return;
    const typing = !!target.closest?.("input, textarea, select, [contenteditable]");
    if (e.key === "F5") {
      e.preventDefault();
      return void this.refresh();
    }
    if (this.drawerItem) {
      if (e.key === "Escape") return this.closeDrawer();
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === "j" || k === "k") {
        this.setCur(this.cur + (k === "j" ? 1 : -1));
        const next = this.visible[this.cur];
        if (next) void this.openDrawer(next);
        return;
      }
      if (k === "a") return void (e.shiftKey ? this.agentMenu(this.drawerItem, this.drawer.querySelector<HTMLElement>("[data-dmenu]")!) : this.toAgent(this.drawerItem, "impl"));
      if (k === "o") return void ipc.openUrl(this.drawerItem.url);
      if (k === "r") {
        e.preventDefault();
        this.drawer.querySelector("textarea")?.focus();
      }
      return;
    }
    if (typing) return;
    const item = this.visible[this.cur];
    const rowBtn = (sel: string) => this.scroll.querySelector<HTMLElement>(`.wk-it[data-i="${this.cur}"] ${sel}`) ?? undefined;
    switch (e.key) {
      case "/":
        e.preventDefault();
        this.scroll.querySelector<HTMLInputElement>("[data-q]")?.focus();
        break;
      case "ArrowDown":
      case "j":
        e.preventDefault();
        this.setCur(this.cur + 1);
        break;
      case "ArrowUp":
      case "k":
        e.preventDefault();
        this.setCur(this.cur - 1);
        break;
      case "Enter":
      case "c":
      case "C":
        if (item) void this.openDrawer(item);
        break;
      case "a":
        if (item) void this.toAgent(item, "impl", rowBtn("[data-do=impl]"));
        break;
      case "A":
        if (item) this.agentMenu(item, rowBtn("[data-do=menu]") ?? this.scroll);
        break;
      case "o":
      case "O":
        if (item) void ipc.openUrl(item.url);
        break;
      case "x":
      case "X":
        if (item) this.toggleSel(item);
        break;
      case "p":
      case "P":
        this.ui.stateF = this.ui.stateF === "pending" ? "all" : "pending";
        this.saveUi();
        this.resetList();
        break;
      case "b":
      case "B":
        this.toggleBugs();
        break;
      case "Escape":
        if (this.sel.size) {
          this.sel.clear();
          this.renderTodo();
        }
        break;
      default:
        return;
    }
  }

  // ------------------------------------------------------------ agentes

  private defaultAgent(): ToolKind | null {
    const pref = this.cfg?.agent as ToolKind | undefined;
    if (pref && AGENTS.includes(pref) && store.toolEnabled(pref)) return pref;
    return AGENTS.find((k) => store.toolEnabled(k)) ?? null;
  }

  private agentMenu(item: Item, anchor: HTMLElement): void {
    const modes: [Mode | "copy", string, string, string][] = [
      ["impl", t("work.agent.impl"), t("work.agent.implText"), "A"],
      ["wt", t("work.agent.wt"), t("work.agent.wtText"), "W"],
      ["plan", t("work.agent.plan"), t("work.agent.planText"), "P"],
      ["fix", t("work.agent.fix"), t("work.agent.fixText"), "I"],
      ["copy", t("work.agent.copy"), t("work.agent.copyText"), "Y"],
    ];
    const agents = AGENTS.filter((k) => store.toolEnabled(k));
    const render = (el: HTMLDivElement) => {
      el.innerHTML = `<div class="mh">${t("work.agent.menuTitle")} · ${esc(item.ref)}</div>
        <div class="wk-pick">${agents.map((k) => `<button data-pick="${k}" class="${k === this.agentPick ? "on" : ""}">${TOOLS[k].short}</button>`).join("")}</div>
        <hr>${modes.map(([k, l, d, kb]) => `<button data-mode="${k}"><span class="wk-mi">${k === "copy" ? ICON.terminal : I.bot}</span><span class="wk-ml">${l}<em>${d}</em></span><small><kbd>${kb}</kbd></small></button>`).join("")}`;
    };
    popover(`work-agent:${item.key}`, anchor, (el) => {
      render(el);
      el.onclick = (ev) => {
        const pick = (ev.target as Element).closest<HTMLElement>("[data-pick]");
        if (pick) {
          this.agentPick = pick.dataset.pick as ToolKind;
          render(el);
          this.renderTodo();
          return;
        }
        const m = (ev.target as Element).closest<HTMLElement>("[data-mode]")?.dataset.mode;
        if (!m) return;
        closePopover();
        if (m === "copy") void this.copyPrompt(item);
        else void this.toAgent(item, m as Mode, anchor);
      };
      const keys = (ev: KeyboardEvent) => {
        if (!el.isConnected) return removeEventListener("keydown", keys, true);
        const m = ({ a: "impl", w: "wt", p: "plan", i: "fix", y: "copy" } as Record<string, string>)[ev.key.toLowerCase()];
        if (!m) return;
        ev.preventDefault();
        ev.stopPropagation();
        removeEventListener("keydown", keys, true);
        el.querySelector<HTMLElement>(`[data-mode="${m}"]`)?.click();
      };
      addEventListener("keydown", keys, true);
    }, "menu wk-menu");
  }

  /** Pasta local do item; sem correspondência, pergunta (e lembra). */
  private resolveRepo(i: { src: "gh" | "ado"; repo?: string; org?: string; adoProject?: string; project: string }, anchor?: HTMLElement): Promise<string | null> {
    const known = this.repoPath(i);
    if (known) return Promise.resolve(known);
    const repos = [...new Set([...(this.model?.repos.map((r) => r.path) ?? []), ...this.host.repos()])];
    if (!repos.length) {
      toast(t("work.agent.noRepo"));
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      let done = false;
      popover(
        "work-repo",
        anchor ?? this.scroll,
        (el) => {
          el.innerHTML = `<div class="mh">${t("work.agent.chooseRepo")}</div>${repos
            .map((p) => `<button data-path="${esc(p)}">${ICON.folder}<span class="wk-ml">${esc(basename(p))}<em>${esc(p)}</em></span></button>`)
            .join("")}<div class="wk-mfoot">${esc(t("work.agent.chooseRepoHint", { repo: i.repo ?? `${i.org}/${i.adoProject}` }))}</div>`;
          el.onclick = (ev) => {
            const b = (ev.target as Element).closest<HTMLElement>("[data-path]");
            if (!b) return;
            done = true;
            this.repoMap[this.repoKey(i)] = b.dataset.path!;
            write(REPOS, this.repoMap);
            closePopover();
            resolve(b.dataset.path!);
          };
        },
        "menu wk-menu",
        () => !done && resolve(null),
      );
    });
  }

  private async thread(i: Item): Promise<Thread | null> {
    try {
      if (i.src === "gh") return await work.githubThread(i.repo!, i.num);
      const org = this.orgCfg(i.org!);
      return await work.adoThread(org, i.adoProject!, i.num);
    } catch {
      return null;
    }
  }

  private orgCfg(name: string): AdoOrg {
    return this.cfg?.adoOrgs.find((o) => o.name.toLowerCase() === name.toLowerCase()) ?? { name, auth: "account" };
  }

  private prompt(i: Item, th: Thread | null, mode: Mode, branch: string): string {
    const lines = [
      t(`work.prompt.${mode === "wt" ? "impl" : mode}`, { ref: i.ref, source: srcName(i.src), title: i.title }),
      t("work.prompt.link", { url: i.url }),
      [t("work.prompt.meta", { kind: i.typeName ?? t(`work.kind.${i.kind}`), state: i.rawState }), i.priority ? t("work.prompt.priority", { p: i.priority }) : ""].filter(Boolean).join(" · "),
    ];
    if (th?.body) lines.push("", t("work.prompt.description"), clip(htmlToText(th.body), 5000));
    const cms = (th?.comments ?? []).filter((c) => c.html).slice(-12);
    if (cms.length) {
      lines.push("", t("work.prompt.comments"));
      for (const c of cms) lines.push(`- ${c.author ?? "?"}: ${clip(htmlToText(c.html!).replace(/\s+/g, " "), 600)}`);
    }
    const instr = { impl: "doImpl", wt: "doWt", plan: "doPlan", fix: "doFix" }[mode];
    lines.push("", t(`work.prompt.${instr}`, { branch }));
    return lines.join("\n");
  }

  private async copyPrompt(i: Item): Promise<void> {
    const th = await this.thread(i);
    await navigator.clipboard.writeText(this.prompt(i, th, "impl", branchName(i))).catch(() => {});
    toast(t("work.agent.copied", { ref: i.ref }));
  }

  private async toAgent(i: Item, mode: Mode, anchor?: HTMLElement): Promise<boolean> {
    const repo = await this.resolveRepo(i, anchor);
    if (!repo) return false;
    const tool = this.agentPick ?? undefined;
    toast(t("work.agent.preparing", { ref: i.ref }));
    const th = await this.thread(i);
    const branch = branchName(i);
    let cwd = repo;
    if (mode === "wt") {
      const path = `${repo.replace(/[\\/]+$/, "")}-${branch.replace(/[\\/]+/g, "-")}`;
      try {
        await gitApi.action(repo, "worktree-add", [path, branch, "new", ""]);
      } catch (e) {
        // A branch já existe (item retomado): usa a worktree existente ou cria sem -b.
        if (!/already exists|já existe/i.test(String(e))) {
          toast(String(e));
          return false;
        }
        await gitApi.action(repo, "worktree-add", [path, branch]).catch(() => {});
      }
      cwd = path;
    }
    const id = await this.host.askAgent(cwd, this.prompt(i, th, mode, branch), tool);
    if (!id) return false;
    toast(t("work.agent.started", { agent: tool ? TOOLS[tool].short : "", ref: i.ref, project: basename(cwd) }), {
      label: t("work.agent.view"),
      run: () => this.host.openSession(id),
    });
    return true;
  }

  private async toAgents(items: Item[], mode: Mode, anchor: HTMLElement): Promise<void> {
    let n = 0;
    for (const i of items) if (await this.toAgent(i, mode === "plan" ? "plan" : "wt", anchor)) n++;
    if (n > 1) toast(tn("work.agent.startedMany", n));
  }

  private async reviewPr(p: Pr, anchor: HTMLElement): Promise<void> {
    const repo = await this.resolveRepo(
      p.src === "gh" ? { src: "gh", repo: p.repo, project: p.repo } : { src: "ado", org: p.org, adoProject: p.adoProject, project: p.repo },
      anchor,
    );
    if (!repo) return;
    await this.host.askAgent(repo, t("work.prompt.review", { ref: p.ref, url: p.url, title: p.title }), this.agentPick ?? undefined);
  }

  // ------------------------------------------------------------ gaveta (detalhes + comentários)

  private async openDrawer(i: Item): Promise<void> {
    this.drawerItem = i;
    const nc = this.newComments(i);
    const why = reasons(i, nc).map((r) => `<span>${r.key === "newComments" ? tn("work.reason.newComments", nc) : t(`work.reason.${r.key}`, r.vars)}</span>`);
    const source = srcName(i.src);
    this.drawer.innerHTML = `
      <div class="wk-dh">
        <div class="top">${I[i.src]}<span class="ref">${esc(i.ref)}</span><span>·</span><span>${esc(i.project)}</span><div class="sp"></div><button class="ibtn sm" data-dclose title="${t("work.drawer.close")}">${ICON.close}</button></div>
        <h2>${esc(i.title)}</h2>
        <div class="row">${i.typeName ? `<span class="wk-tag">${esc(i.typeName)}</span>` : ""}${this.statePill(i)}${i.priority ? `<span class="wk-tag p${i.priority}">P${i.priority}</span>` : ""}${i.tags.map((x) => `<span class="wk-tag">${esc(x)}</span>`).join("")}<span class="wk-faint">${t("work.drawer.updated", { ago: ago(i.updated) })}</span></div>
        <div class="wk-why"><b>${t("work.reason.why")}</b>${why.length ? why.join("") : `<span>${t("work.reason.none")}</span>`}</div>
        <div class="btns">
          <span class="split"><button class="primary sm" data-dimpl>${I.bot}${esc(t("work.todo.implementWith", { agent: this.agentPick ? TOOLS[this.agentPick].short : "" }).replace(/ \(A\)$/, ""))}</button><button class="primary sm caret" data-dmenu>${I.caret}</button></span>
          <button class="ghost sm" data-dopen>${I.ext}${t("work.drawer.openIn", { source })}</button>
        </div>
      </div>
      <div class="wk-db"><div class="wk-loading">${t("work.drawer.loading")}</div></div>
      <div class="wk-df">
        <textarea placeholder="${esc(t("work.drawer.reply", { ref: i.ref, source }))}"></textarea>
        <div class="r"><span>${t("work.drawer.sendHint")}</span><div class="sp"></div><button class="primary sm" data-send>${t("work.drawer.send")}</button></div>
      </div>`;
    this.drawer.classList.add("open");
    this.scrim.hidden = false;
    this.seen[i.key] = i.comments;
    write(SEEN, this.seen);
    const th = await this.thread(i);
    if (this.drawerItem !== i) return;
    const body = this.drawer.querySelector(".wk-db")!;
    const clean = (html: string) => DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "form", "input"], FORBID_ATTR: ["style"] });
    const initials = (n: string | null) => (n ?? "?").replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
    const comments = th?.comments ?? [];
    body.innerHTML = `
      <div class="wk-desc">${th?.body ? clean(th.body) : `<span class="wk-faint">${t("work.drawer.noDescription")}</span>`}</div>
      <div class="wk-sec"><span>${tn("work.drawer.comments", comments.length)}</span>${nc ? `<span class="new">${tn("work.drawer.newSince", nc)}</span>` : ""}</div>
      ${
        comments.length
          ? comments
              .map(
                (c, k) => `<div class="wk-cmt${k >= comments.length - nc ? " new" : ""}${c.bot ? " bot" : ""}">
            <div class="av">${c.avatar ? `<img src="${esc(c.avatar)}" alt="">` : esc(initials(c.author))}</div>
            <div><div class="hd"><b>${esc(c.author ?? "?")}</b>${c.date ? ago(Date.parse(c.date)) : ""}</div><div class="body">${clean(c.html ?? "")}</div></div>
          </div>`,
              )
              .join("")
          : `<div class="wk-faint">${t("work.drawer.noComments")}</div>`
      }`;
    this.renderTodo();
  }

  private closeDrawer(): void {
    if (!this.drawerItem) return;
    this.drawerItem = null;
    this.drawer.classList.remove("open");
    this.scrim.hidden = true;
    this.part(".wk-todo")?.focus({ preventScroll: true });
  }

  private onDrawerClick(e: MouseEvent): void {
    const target = e.target as Element;
    const i = this.drawerItem;
    if (!i) return;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (link) {
      e.preventDefault();
      if (/^https?:/.test(link.href)) void ipc.openUrl(link.href);
      return;
    }
    if (target.closest("[data-dclose]")) return this.closeDrawer();
    if (target.closest("[data-dimpl]")) return void this.toAgent(i, "impl", target.closest<HTMLElement>("[data-dimpl]")!);
    const menu = target.closest<HTMLElement>("[data-dmenu]");
    if (menu) return this.agentMenu(i, menu);
    if (target.closest("[data-dopen]")) return void ipc.openUrl(i.url);
    if (target.closest("[data-send]")) void this.sendComment();
  }

  private async sendComment(): Promise<void> {
    const i = this.drawerItem;
    const ta = this.drawer.querySelector("textarea");
    if (!i || !ta || !ta.value.trim()) return;
    const text = ta.value.trim();
    ta.disabled = true;
    try {
      if (i.src === "gh") await work.githubComment(i.repo!, i.num, text);
      else await work.adoComment(this.orgCfg(i.org!), i.adoProject!, i.num, text);
      i.comments++;
      this.seen[i.key] = i.comments;
      write(SEEN, this.seen);
      toast(t("work.drawer.sent", { ref: i.ref }));
      ta.value = "";
      void this.openDrawer(i);
    } catch (e) {
      toast(String(e));
    } finally {
      ta.disabled = false;
    }
  }
}
