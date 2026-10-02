// Aba "PRs": pull requests do GitHub pelo `gh`, com status dos checks,
// checkout (também numa worktree) e revisão por um agente.
import { ipc } from "../core/ipc";
import { t } from "../i18n";
import { ago, esc, h } from "../ui/dom";
import { toast } from "../ui/feedback";
import { git, type PullRequest } from "./api";
import { GI, type GitCtx } from "./ui";

let ghOk: Promise<boolean> | null = null;

function checks(pr: PullRequest): "ok" | "fail" | "run" | null {
  const list = pr.statusCheckRollup ?? [];
  if (!list.length) return null;
  const states = list.map((c) => (c.conclusion ?? c.state ?? c.status ?? "").toUpperCase());
  if (states.some((s) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(s))) return "fail";
  if (states.some((s) => ["", "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING"].includes(s))) return "run";
  return "ok";
}

export class PrsPane {
  readonly el = h("div", "gp gp-prs");
  private listEl = h("div", "gb-list");
  private detail = h("div", "gb-detail");
  private prs: PullRequest[] = [];
  private sel: number | null = null;
  private loaded: string | null = null;

  constructor(private ctx: GitCtx) {
    const col = h("div", "gc-col");
    const foot = h("div", "gb-foot");
    foot.innerHTML = `<button class="gbtn primary" data-p="create">${GI.pr} ${esc(t("git.prs.create"))}</button><button class="ibtn sm" data-p="refresh" title="${esc(t("git.prs.refresh"))}">${GI.refresh}</button>`;
    foot.addEventListener("click", (e) => {
      const p = (e.target as Element).closest<HTMLElement>("[data-p]")?.dataset.p;
      if (p === "create") void this.ctx.act(() => git.prCreate(this.ctx.repo));
      if (p === "refresh") void this.reload();
    });
    col.append(this.listEl, foot);
    this.el.append(col, this.detail);
    this.listEl.addEventListener("click", (e) => {
      const n = (e.target as Element).closest<HTMLElement>("[data-n]")?.dataset.n;
      if (n) {
        this.sel = Number(n);
        this.render();
      }
    });
    this.detail.addEventListener("click", (e) => void this.onAction(e));
  }

  reset(): void {
    this.loaded = null;
    this.prs = [];
    this.sel = null;
  }

  update(): void {
    if (this.loaded !== this.ctx.repo) void this.reload();
  }

  async reload(): Promise<void> {
    this.loaded = this.ctx.repo;
    ghOk ??= git.ghAvailable();
    if (!(await ghOk)) {
      this.listEl.innerHTML = `<div class="g-empty">${GI.pr}<span>${esc(t("git.prs.noGh"))}</span></div>`;
      this.detail.innerHTML = "";
      return;
    }
    this.listEl.innerHTML = `<div class="g-empty">${esc(t("git.prs.loading"))}</div>`;
    try {
      this.prs = await git.prs(this.ctx.repo);
    } catch (e) {
      this.listEl.innerHTML = `<div class="g-empty err">${esc(String(e))}</div>`;
      return;
    }
    if (!this.prs.some((p) => p.number === this.sel)) this.sel = this.prs.find((p) => p.headRefName === this.ctx.status?.branch)?.number ?? this.prs[0]?.number ?? null;
    this.render();
  }

  private render(): void {
    if (!this.prs.length) {
      this.listEl.innerHTML = `<div class="g-empty">${GI.pr}<span>${esc(t("git.prs.none"))}</span></div>`;
      this.detail.innerHTML = "";
      return;
    }
    const chk = (pr: PullRequest) => {
      const c = checks(pr);
      return c ? `<span class="gci ${c}"><i></i>${esc(t(c === "ok" ? "git.prs.checksOk" : c === "fail" ? "git.prs.checksFail" : "git.prs.checksRun"))}</span>` : "";
    };
    const review = (pr: PullRequest) =>
      pr.reviewDecision === "APPROVED" ? `<span class="gref ok">${esc(t("git.prs.approved"))}</span>` : pr.reviewDecision === "CHANGES_REQUESTED" ? `<span class="gref gone">${esc(t("git.prs.changes"))}</span>` : "";
    this.listEl.innerHTML = this.prs
      .map(
        (pr) => `<div class="gpr${pr.number === this.sel ? " on" : ""}${pr.headRefName === this.ctx.status?.branch ? " cur" : ""}" data-n="${pr.number}">
        <b><span class="gpr-n">#${pr.number}</span> ${esc(pr.title)}</b>
        <small>${pr.isDraft ? `<span class="gref">${esc(t("git.prs.draft"))}</span>` : ""}${review(pr)}${chk(pr)}<span>${esc(t("git.prs.by", { author: pr.author?.login ?? "?" }))} · ${esc(ago(Date.parse(pr.updatedAt)))}</span></small></div>`,
      )
      .join("");
    const pr = this.prs.find((p) => p.number === this.sel);
    if (!pr) return;
    this.detail.innerHTML = `<div class="gh-info"><h3><span class="gpr-n">#${pr.number}</span> ${esc(pr.title)}</h3>
      <div class="gh-meta"><span class="mono">${esc(pr.headRefName)} → ${esc(pr.baseRefName)}</span>${review(pr)}${chk(pr)}<span>${esc(t("git.prs.by", { author: pr.author?.login ?? "?" }))}</span></div>
      <div class="gh-acts"><button class="gbtn primary" data-a="checkout">${esc(t("git.prs.checkout"))}</button><button class="gbtn" data-a="worktree">${GI.branch} ${esc(t("git.prs.worktree"))}</button>
      <button class="gbtn ai" data-a="review">${GI.spark} ${esc(t("git.prs.review"))}</button><button class="gbtn" data-a="open">${GI.web} ${esc(t("git.prs.open"))}</button></div></div>
      <div class="gpr-checks">${(pr.statusCheckRollup ?? [])
        .map((c) => {
          const raw = c as { name?: string; context?: string; conclusion?: string; state?: string; status?: string };
          const s = (raw.conclusion ?? raw.state ?? raw.status ?? "").toUpperCase();
          const cls = ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(s) ? "ok" : ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"].includes(s) ? "fail" : "run";
          return `<div class="gci ${cls}"><i></i>${esc(raw.name ?? raw.context ?? "check")}<small>${esc(s.toLowerCase())}</small></div>`;
        })
        .join("")}</div>`;
  }

  private async onAction(e: MouseEvent): Promise<void> {
    const a = (e.target as Element).closest<HTMLElement>("[data-a]")?.dataset.a;
    const pr = this.prs.find((p) => p.number === this.sel);
    if (!a || !pr) return;
    const repo = this.ctx.repo;
    if (a === "open") return void ipc.openUrl(pr.url).catch((err) => toast(String(err)));
    if (a === "checkout") return void this.ctx.act(() => git.action(repo, "pr-checkout", [String(pr.number)]));
    if (a === "review") return this.ctx.host.askAgent(repo, t("git.prs.reviewPrompt", { n: pr.number, title: pr.title }));
    if (a === "worktree") {
      // Busca a branch do PR e abre numa worktree com um agente.
      await this.ctx.act(() => git.remote(repo, "fetch", () => {}));
      return this.ctx.newBranch(`origin/${pr.headRefName}`, true);
    }
  }
}
