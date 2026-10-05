// Aba "Branches": locais e remotas, com trocar, mesclar, rebase, renomear,
// apagar, worktrees e PR.
import { t } from "../i18n";
import { ago, esc, h } from "../ui/dom";
import { git, type Branch, type Commit } from "./api";
import { ask, branchError } from "./dialog";
import { GI, splitter, type GitCtx } from "./ui";

export class BranchesPane {
  readonly el = h("div", "gp gp-branches");
  private listEl = h("div", "gb-list");
  private detail = h("div", "gb-detail");
  private branches: Branch[] = [];
  private sel: string | null = null;
  private filter = "";
  private lastHead: string | null = null;

  constructor(private ctx: GitCtx) {
    const col = h("div", "gc-col");
    const top = h("div", "gc-head");
    top.innerHTML = `<input class="gc-filter" placeholder="${esc(t("git.branches.filter"))}" spellcheck="false">`;
    top.querySelector("input")!.addEventListener("input", (e) => {
      this.filter = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderList();
    });
    const foot = h("div", "gb-foot");
    foot.innerHTML = `<button class="gbtn primary" data-b="new">${esc(t("git.branches.new"))}</button><button class="gbtn" data-b="wt">${GI.branch} ${esc(t("git.branches.newWorktree"))}</button>`;
    foot.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>("[data-b]")?.dataset.b;
      if (b === "new") void this.ctx.newBranch();
      if (b === "wt") void this.ctx.newBranch(undefined, true);
    });
    col.append(top, this.listEl, foot);
    this.el.append(col, splitter(this.el, col, "listW.branches"), this.detail);
    this.listEl.addEventListener("click", (e) => {
      const row = (e.target as Element).closest<HTMLElement>("[data-b]");
      if (row) this.pick(row.dataset.b!);
    });
    this.listEl.addEventListener("dblclick", (e) => {
      const row = (e.target as Element).closest<HTMLElement>("[data-b]");
      const b = row && this.branches.find((x) => x.name === row.dataset.b);
      if (b && !b.current) void this.ctx.checkout(b.name, b.remote);
    });
    this.detail.addEventListener("click", (e) => void this.onAction(e));
  }

  reset(): void {
    this.sel = null;
    this.branches = [];
  }

  update(): void {
    const head = `${this.ctx.status?.branch}|${this.ctx.status?.head}|${this.ctx.status?.ahead}|${this.ctx.status?.behind}`;
    if (head === this.lastHead && this.branches.length) return;
    this.lastHead = head;
    void this.reload();
  }

  async reload(): Promise<void> {
    this.branches = await git.branches(this.ctx.repo).catch(() => []);
    if (!this.sel || !this.branches.some((b) => b.name === this.sel)) this.sel = this.branches.find((b) => b.current)?.name ?? this.branches[0]?.name ?? null;
    this.renderList();
    this.renderDetail();
  }

  private renderList(): void {
    const match = (b: Branch) => !this.filter || b.name.toLowerCase().includes(this.filter);
    const row = (b: Branch) => `<div class="gb-r${b.name === this.sel ? " on" : ""}${b.current ? " cur" : ""}" data-b="${esc(b.name)}" title="${esc(b.subject)}">
      ${GI.branch}<span class="gb-n">${esc(b.name)}</span>
      ${b.worktree && !b.current ? `<span class="gref" title="${esc(t("git.branches.inWorktree", { path: b.worktree }))}">wt</span>` : ""}
      ${b.gone ? `<span class="gref gone">${esc(t("git.branches.gone"))}</span>` : ""}
      <span class="gb-ab">${b.ahead ? `${GI.up}${b.ahead}` : ""}${b.behind ? `${GI.down}${b.behind}` : ""}</span><small>${esc(ago(b.date * 1000))}</small></div>`;
    const local = this.branches.filter((b) => !b.remote && match(b)).sort((a, b) => Number(b.current) - Number(a.current) || b.date - a.date);
    const remote = this.branches.filter((b) => b.remote && match(b)).sort((a, b) => b.date - a.date);
    this.listEl.innerHTML = `<div class="gf-h">${esc(t("git.branches.local"))}</div>${local.map(row).join("")}${remote.length ? `<div class="gf-h">${esc(t("git.branches.remote"))}</div>${remote.map(row).join("")}` : ""}`;
  }

  private pick(name: string): void {
    this.sel = name;
    this.listEl.querySelectorAll<HTMLElement>(".gb-r").forEach((r) => r.classList.toggle("on", r.dataset.b === name));
    this.renderDetail();
  }

  private renderDetail(): void {
    const b = this.branches.find((x) => x.name === this.sel);
    if (!b) {
      this.detail.innerHTML = "";
      return;
    }
    const cur = this.ctx.status?.branch ?? "HEAD";
    const btn = (id: string, label: string, cls = "") => `<button class="gbtn ${cls}" data-a="${id}">${esc(label)}</button>`;
    const acts = [
      !b.current && btn("checkout", t("git.branches.checkout"), "primary"),
      !b.current && !b.remote && !b.worktree && btn("worktree", t("git.branches.openWorktree")),
      !b.current && btn("merge", t("git.branches.merge", { branch: cur })),
      !b.current && btn("squash", t("git.branches.squash", { branch: cur })),
      !b.current && btn("rebase", t("git.branches.rebase", { branch: cur })),
      b.current && this.ctx.webUrl && btn("pr", t("git.branches.createPr")),
      !b.remote && btn("rename", t("git.branches.rename")),
      b.worktree && !b.current && btn("wtremove", t("git.branches.worktreeRemove"), "danger"),
      !b.current && btn(b.remote ? "delremote" : "delete", t(b.remote ? "git.branches.deleteRemote" : "git.branches.delete"), "danger"),
    ]
      .filter(Boolean)
      .join("");
    const track = b.upstream ? `${b.upstream}${b.ahead ? ` · ${t("git.branches.ahead", { n: b.ahead })}` : ""}${b.behind ? ` · ${t("git.branches.behind", { n: b.behind })}` : ""}` : "";
    this.detail.innerHTML = `<div class="gh-info"><h3 class="mono">${GI.branch} ${esc(b.name)}${b.current ? ` <span class="gref head">${esc(t("git.branches.current"))}</span>` : ""}</h3>
      <div class="gh-meta">${track ? `<span>${esc(track)}</span>` : ""}${b.worktree ? `<span>${esc(t("git.branches.inWorktree", { path: b.worktree }))}</span>` : ""}<span class="mono">${esc(b.sha)}</span><span>${esc(ago(b.date * 1000))}</span></div>
      <div class="gh-acts">${acts}</div></div><div class="gb-commits"></div>`;
    void this.renderCompare(b, cur);
  }

  /** Commits à frente e atrás da branch atual (ou os últimos, se for a atual). */
  private async renderCompare(b: Branch, cur: string): Promise<void> {
    const repo = this.ctx.repo;
    const row = (c: Commit) => `<div class="gh-r"><i class="gh-dot${c.unpushed ? " up" : ""}"></i><div class="gh-m"><b>${esc(c.subject)}</b><small><span>${esc(c.short)} · ${esc(c.author)} · ${esc(ago(c.date * 1000))}</span></small></div></div>`;
    let html: string;
    if (b.current) {
      const list = await git.log(repo, 0, 20, undefined, b.name).catch(() => []);
      html = `<div class="gf-h">${esc(t("git.branches.lastCommits"))}</div>${list.map(row).join("")}`;
    } else {
      const [ahead, behind] = await Promise.all([
        git.log(repo, 0, 50, undefined, `${cur}..${b.name}`).catch(() => []),
        git.log(repo, 0, 50, undefined, `${b.name}..${cur}`).catch(() => []),
      ]);
      const sec = (title: string, list: Commit[]) => `<div class="gf-h">${esc(title)} <span class="gb-cnt">${list.length}${list.length === 50 ? "+" : ""}</span></div>${list.length ? list.map(row).join("") : `<div class="gb-none">${esc(t("git.branches.nothing"))}</div>`}`;
      html = sec(t("git.branches.aheadOf", { branch: cur }), ahead) + sec(t("git.branches.behindOf", { branch: cur }), behind);
    }
    if (this.sel !== b.name) return;
    const el = this.detail.querySelector(".gb-commits");
    if (el) el.innerHTML = html;
  }

  private async onAction(e: MouseEvent): Promise<void> {
    const a = (e.target as Element).closest<HTMLElement>("[data-a]")?.dataset.a;
    const b = this.branches.find((x) => x.name === this.sel);
    if (!a || !b) return;
    const repo = this.ctx.repo;
    switch (a) {
      case "checkout":
        return this.ctx.checkout(b.name, b.remote);
      case "worktree":
        return this.ctx.newBranch(b.name, true);
      case "merge":
        return void this.ctx.act(() => git.action(repo, "merge", [b.name]), t("git.branches.merged", { branch: b.name }));
      case "squash":
        return void this.ctx.act(() => git.action(repo, "squash", [b.name]), t("git.branches.merged", { branch: b.name }));
      case "rebase":
        return void this.ctx.act(() => git.action(repo, "rebase", [b.name]), t("git.branches.rebased"));
      case "pr":
        return void this.ctx.act(() => git.prCreate(repo));
      case "rename": {
        const r = await ask({ title: t("git.branches.renameTitle", { branch: b.name }), input: { value: b.name, mono: true, validate: branchError }, confirm: { label: t("git.dialog.rename") } });
        if (r && r.value !== b.name) {
          await this.ctx.act(() => git.action(repo, "rename", [b.name, r.value]));
          this.sel = r.value;
        }
        return;
      }
      case "delete": {
        const r = await ask({ title: t("git.branches.deleteTitle", { branch: b.name }), sub: t("git.branches.deleteSub"), checks: [{ id: "force", label: t("git.branches.deleteForce") }], confirm: { label: t("git.dialog.delete"), danger: true } });
        if (r) await this.ctx.act(() => git.action(repo, "delete", [b.name, r.checks.force ? "force" : ""]), t("git.branches.deleted", { branch: b.name }));
        return;
      }
      case "delremote": {
        const r = await ask({ title: t("git.branches.deleteRemoteTitle", { branch: b.name }), sub: t("git.branches.deleteRemoteSub"), confirm: { label: t("git.dialog.delete"), danger: true } });
        if (r) await this.ctx.act(() => git.action(repo, "delete-remote", [b.name]), t("git.branches.deleted", { branch: b.name }));
        return;
      }
      case "wtremove": {
        const r = await ask({ title: t("git.branches.worktreeRemoveTitle", { path: b.worktree! }), sub: t("git.branches.worktreeRemoveSub"), checks: [{ id: "force", label: t("git.branches.worktreeRemoveForce") }], confirm: { label: t("git.dialog.delete"), danger: true } });
        if (r) {
          await this.ctx.act(() => git.action(repo, "worktree-remove", [b.worktree!, r.checks.force ? "force" : ""]));
          this.ctx.host.gitChanged();
        }
        return;
      }
    }
  }
}
