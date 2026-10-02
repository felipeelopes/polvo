// Painel Git (aba do painel lateral): segue o projeto em foco, mostra
// alterações, histórico, branches e PRs, e sincroniza com o remoto.
import "../styles/git.css";
import { ipc } from "../core/ipc";
import { normPath, store } from "../core/store";
import type { ToolKind } from "../core/types";
import { t, tn } from "../i18n";
import { ago, basename, esc, h } from "../ui/dom";
import { closePopover, popover, toast } from "../ui/feedback";
import { TOOLS } from "../ui/icons";
import { git, type GitStatus, type RemoteOp, type Stash } from "./api";
import { BranchesPane } from "./branches";
import { ChangesPane } from "./changes";
import { ask, branchError, slugBranch } from "./dialog";
import { HistoryPane } from "./history";
import { PrsPane } from "./prs";
import { GI, menu, type GitCtx, type GitHost } from "./ui";

type Sub = "changes" | "history" | "branches" | "prs";
const POLL_MS = 2000;
const AUTO_FETCH_MS = 5 * 60_000;
const lastFetch = new Map<string, number>();

export class GitView implements GitCtx {
  readonly tab = h("button", "dtab dtab-git");
  readonly el = h("div", "git");
  repo = "";
  status: GitStatus | null = null;
  webUrl: string | null = null;
  defaultBranch: string | null = null;
  private follow = true;
  private sub: Sub = "changes";
  private top = h("div", "g-top");
  private banner = h("div", "g-banner");
  private body = h("div", "g-body");
  private empty = h("div", "g-none");
  private panes: Record<Sub, { el: HTMLElement; update(): void; reset(): void }>;
  private changes: ChangesPane;
  private history: HistoryPane;
  private visible = false;
  private syncing: { op: RemoteOp; line: string } | null = null;
  private stashes: Stash[] = [];
  private stashKey = "";
  private notRepo = false;
  private timer: number | undefined;
  private lastJson = "";
  private shape = "";

  constructor(readonly host: GitHost) {
    this.changes = new ChangesPane(this);
    this.history = new HistoryPane(this);
    this.panes = { changes: this.changes, history: this.history, branches: new BranchesPane(this), prs: new PrsPane(this) };
    for (const p of Object.values(this.panes)) this.body.append(p.el);
    this.banner.hidden = true;
    this.empty.hidden = true;
    this.el.append(this.top, this.banner, this.body, this.empty);
    this.tab.title = t("git.tabHint");
    this.top.addEventListener("click", (e) => this.onTop(e));
    this.banner.addEventListener("click", (e) => void this.onBanner(e));
    this.empty.addEventListener("click", (e) => {
      if ((e.target as Element).closest("[data-init]")) void this.act(() => git.init(this.repo)).then(() => this.host.gitChanged());
      if ((e.target as Element).closest("[data-pick]")) this.pickRepo(e.target as HTMLElement);
    });
    try {
      this.sub = (localStorage.getItem("polvo.git.sub") as Sub) || "changes";
      this.follow = localStorage.getItem(`polvo.git.follow.${store.label}`) !== "0";
      if (!this.follow) this.repo = localStorage.getItem(`polvo.git.repo.${store.label}`) ?? "";
    } catch {
      /* ignora */
    }
    store.on((topic) => {
      if ((topic === "active" || topic === "git") && this.follow) this.followFocus();
    });
    window.addEventListener("focus", () => this.visible && void this.refresh());
    this.renderTab();
    this.followFocus();
  }

  // ------------------------------------------------------------ dock

  headHtml(): string {
    return `<button class="ibtn" data-g="refresh" title="${esc(t("git.head.refresh"))}">${GI.refresh}</button><button class="ibtn" data-g="more" data-pop title="${esc(t("git.head.more"))}">${GI.more}</button>`;
  }

  onHead(e: MouseEvent): void {
    const b = (e.target as Element).closest<HTMLElement>("[data-g]");
    if (b?.dataset.g === "refresh") void this.refresh(true);
    if (b?.dataset.g === "more") this.moreMenu(b);
  }

  shown(): void {
    this.visible = true;
    this.renderTab();
    void this.refresh(true);
    clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      if (document.hasFocus()) void this.refresh();
    }, POLL_MS);
  }

  hidden(): void {
    this.visible = false;
    this.renderTab();
    clearInterval(this.timer);
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === "F5") {
      void this.refresh(true);
      return true;
    }
    if (!e.ctrlKey || e.altKey) return false;
    const subs: Sub[] = ["changes", "history", "branches", "prs"];
    const n = Number(e.key);
    if (n >= 1 && n <= 4 && !e.shiftKey) {
      this.setSub(subs[n - 1]);
      return true;
    }
    if (e.key === "Enter" && this.sub === "changes") {
      void this.changes.commit();
      return true;
    }
    if (e.shiftKey && e.code === "KeyS" && this.status) {
      void this.changes.stash();
      return true;
    }
    return false;
  }

  private renderTab(): void {
    const n = this.status?.files.length ?? 0;
    const c = this.status?.files.some((f) => f.conflict);
    this.tab.className = `dtab dtab-git${this.visible ? " on" : ""}`;
    this.tab.innerHTML = `${GI.branch}<span>${esc(t("git.tab"))}</span>${n ? `<span class="dtab-n${c ? " bad" : ""}">${n}</span>` : ""}`;
  }

  // ------------------------------------------------------------ repositório

  private followFocus(): void {
    const s = store.session(store.active) ?? (this.repo ? undefined : store.mine[0]);
    if (!s) return;
    const root = store.git[s.cwd]?.root ?? s.cwd;
    if (normPath(root) !== normPath(this.repo)) this.setRepo(root);
  }

  setRepo(path: string, manual = false): void {
    if (manual) {
      this.follow = false;
      try {
        localStorage.setItem(`polvo.git.follow.${store.label}`, "0");
        localStorage.setItem(`polvo.git.repo.${store.label}`, path);
      } catch {
        /* ignora */
      }
    }
    if (normPath(path) === normPath(this.repo) && this.status) return;
    this.repo = path;
    this.status = null;
    this.lastJson = "";
    this.webUrl = null;
    this.stashKey = "";
    for (const p of Object.values(this.panes)) p.reset();
    void git.webUrl(path).then((u) => (this.webUrl = u), () => {});
    this.defaultBranch = null;
    void git.repoConfig(path).then((c) => (this.defaultBranch = c.defaultBranch), () => {});
    if (this.visible) void this.refresh(true);
    else this.renderTop();
  }

  private setFollow(): void {
    this.follow = true;
    try {
      localStorage.setItem(`polvo.git.follow.${store.label}`, "1");
    } catch {
      /* ignora */
    }
    this.followFocus();
  }

  /** Relê o status; `force` atualiza as abas mesmo sem mudança. */
  async refresh(force = false): Promise<void> {
    if (!this.repo) return this.renderNone();
    const repo = this.repo;
    let st: GitStatus | null = null;
    try {
      st = await git.status(repo);
      this.notRepo = false;
    } catch {
      this.notRepo = true;
    }
    if (repo !== this.repo) return;
    if (this.notRepo || !st) {
      this.status = null;
      return this.renderNone();
    }
    // Ao seguir uma subpasta, usa a raiz do repositório.
    if (normPath(st.root) !== normPath(this.repo)) {
      this.repo = st.root;
      void git.webUrl(st.root).then((u) => (this.webUrl = u), () => {});
    }
    const json = JSON.stringify(st);
    const changed = json !== this.lastJson;
    this.lastJson = json;
    this.status = st;
    this.empty.hidden = true;
    this.body.hidden = false;
    if (changed || force) {
      this.renderTop();
      this.renderTab();
      await this.loadStashes();
      this.renderBanner();
      // Selos e barra lateral só mudam com branch, commits ou quantidade de arquivos.
      const shape = `${st.root}|${st.branch}|${st.head}|${st.ahead}|${st.behind}|${st.files.length}`;
      if (shape !== this.shape) {
        this.shape = shape;
        this.host.gitChanged();
      }
    }
    // A aba visível sempre acompanha (o diff do arquivo aberto pode mudar sem mudar o status).
    if (changed || force || this.sub === "changes") this.panes[this.sub].update();
    this.autoFetch();
  }

  private renderNone(): void {
    this.renderTop();
    this.renderTab();
    this.body.hidden = true;
    this.banner.hidden = true;
    this.empty.hidden = false;
    this.empty.innerHTML = this.repo
      ? `<div class="g-empty big">${GI.repo}<b>${esc(t("git.repo.notRepoTitle"))}</b><span class="mono">${esc(this.repo)}</span><span>${esc(t("git.repo.notRepoHint"))}</span><button class="gbtn primary" data-init>${esc(t("git.repo.init"))}</button></div>`
      : `<div class="g-empty big">${GI.repo}<span>${esc(t("git.repo.noFocus"))}</span><button class="gbtn" data-pick>${esc(t("git.repo.pick"))}</button></div>`;
  }

  // ------------------------------------------------------------ barra do topo

  private renderTop(): void {
    const st = this.status;
    const name = this.repo ? basename(this.repo) : t("git.repo.none");
    const branch = st ? (st.branch ? (st.unborn ? t("git.branch.unborn", { name: st.branch }) : st.branch) : `${t("git.branch.detached")} ${st.head?.slice(0, 7) ?? ""}`) : "—";
    const sub = (s: Sub) => `<button data-sub="${s}" class="${this.sub === s ? "on" : ""}">${esc(t(`git.tabs.${s}`))}</button>`;
    this.top.innerHTML = `<button class="g-pick" data-t="repo" data-pop title="${esc(this.repo)}">${GI.repo}<span><small>${esc(this.follow ? t("git.repo.following") : t("git.repo.label"))}</small><b>${esc(name)}</b></span>${GI.caret}</button>
      <button class="g-pick" data-t="branch" data-pop ${st ? "" : "disabled"}>${GI.branch}<span><small>${esc(t("git.branch.label"))}</small><b class="mono">${esc(branch)}</b></span>${GI.caret}</button>
      ${st ? this.syncHtml(st) : ""}
      <span class="sp"></span>
      <div class="seg gseg gtabs">${sub("changes")}${sub("history")}${sub("branches")}${sub("prs")}</div>`;
    for (const [k, p] of Object.entries(this.panes)) p.el.hidden = k !== this.sub;
  }

  private syncHtml(st: GitStatus): string {
    if (this.syncing) {
      return `<div class="g-sync busy"><span class="g-spin"></span><span><small>${esc(t(`git.sync.${this.syncing.op === "force-push" ? "push" : this.syncing.op === "push-tags" ? "pushTags" : this.syncing.op}`))}</small><b>${esc(this.syncing.line || "…")}</b></span></div>`;
    }
    let op: RemoteOp = "fetch";
    let label = t("git.sync.fetch");
    let icon = GI.sync;
    let count = "";
    if (st.branch && !st.upstream && !st.unborn) {
      op = "publish";
      label = t("git.sync.publish");
      icon = GI.up;
    } else if (st.behind) {
      op = "pull";
      label = t("git.sync.pull");
      icon = GI.down;
      count = `${st.behind}${st.ahead ? ` ${GI.up}${st.ahead}` : ""}`;
    } else if (st.ahead) {
      op = "push";
      label = t("git.sync.push");
      icon = GI.up;
      count = String(st.ahead);
    }
    const when = lastFetch.get(normPath(this.repo));
    const small = op === "fetch" ? (when ? t("git.sync.lastFetch", { ago: ago(when) }) : t("git.sync.never")) : st.upstream ?? "origin";
    return `<div class="g-sync${op !== "fetch" ? " hot" : ""}"><button data-t="sync" data-op="${op}" title="${esc(op === "publish" ? t("git.sync.publishHint") : label)}">${icon}<span><small>${esc(small)}</small><b>${esc(label)}${count ? ` <i>${count}</i>` : ""}</b></span></button><button class="g-caret" data-t="syncmenu" data-pop title="${esc(t("git.sync.menu"))}">${GI.caret}</button></div>`;
  }

  private onTop(e: MouseEvent): void {
    const tg = e.target as Element;
    const s = tg.closest<HTMLElement>("[data-sub]")?.dataset.sub as Sub | undefined;
    if (s) return this.setSub(s);
    const b = tg.closest<HTMLElement>("[data-t]");
    if (!b) return;
    if (b.dataset.t === "repo") this.pickRepo(b);
    if (b.dataset.t === "branch") void this.branchMenu(b);
    if (b.dataset.t === "sync") void this.sync(b.dataset.op as RemoteOp);
    if (b.dataset.t === "syncmenu") this.syncMenu(b);
  }

  setSub(s: Sub): void {
    this.sub = s;
    try {
      localStorage.setItem("polvo.git.sub", s);
    } catch {
      /* ignora */
    }
    this.top.querySelectorAll<HTMLElement>("[data-sub]").forEach((b) => b.classList.toggle("on", b.dataset.sub === s));
    for (const [k, p] of Object.entries(this.panes)) p.el.hidden = k !== s;
    if (this.status) this.panes[s].update();
    if (s === "changes") this.changes.focus();
  }

  showHistory(path?: string): void {
    this.setSub("history");
    this.history.setPath(path ?? null);
  }

  private pickRepo(anchor: HTMLElement): void {
    const seen = new Map<string, { path: string; label: string; branch: string | null }>();
    for (const info of Object.values(store.git)) {
      if (!info) continue;
      for (const w of info.worktrees.length ? info.worktrees : [{ path: info.root, branch: info.branch, main: true }]) {
        const k = normPath(w.path);
        if (!seen.has(k)) seen.set(k, { path: w.path, label: basename(info.project) + (w.main ? "" : ` · ${basename(w.path)}`), branch: w.branch });
      }
    }
    for (const p of store.projects) if (!seen.has(normPath(p.path))) seen.set(normPath(p.path), { path: p.path, label: basename(p.path), branch: null });
    const list = [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
    popover(
      "git-repo",
      anchor,
      (el) => {
        el.innerHTML = `<button data-r="__follow" class="${this.follow ? "cur" : ""}">${this.follow ? GI.check : '<i class="g-ic"></i>'}<span>${esc(t("git.repo.follow"))}</span></button><hr><div class="mh">${esc(t("git.repo.label"))}</div>${list
          .map((r) => `<button data-r="${esc(r.path)}" class="${normPath(r.path) === normPath(this.repo) ? "cur" : ""}" title="${esc(r.path)}">${GI.repo}<span>${esc(r.label)}</span>${r.branch ? `<small>${esc(r.branch)}</small>` : ""}</button>`)
          .join("")}`;
        el.onclick = (ev) => {
          const r = (ev.target as Element).closest<HTMLElement>("[data-r]")?.dataset.r;
          if (!r) return;
          closePopover();
          if (r === "__follow") this.setFollow();
          else this.setRepo(r, true);
        };
      },
      "menu gmenu",
    );
  }

  private moreMenu(anchor: HTMLElement): void {
    if (!this.repo) return;
    menu("git-more", anchor, [
      { id: "fetch", label: t("git.head.fetch") },
      { id: "editor", label: t("git.head.openEditor") },
      { id: "explorer", label: t("git.head.openExplorer") },
      { id: "terminal", label: t("git.head.openTerminal") },
      ...(this.webUrl ? [{ id: "web", label: t("git.head.openWeb") }] : []),
      ...(this.status?.branch ? [{ id: "copy", label: t("git.head.copyBranch") }] : []),
      "-",
      { id: "review", label: t("git.review") },
      { id: "settings", label: t("git.settings.title") },
    ], (id) => {
      if (id === "fetch") void this.sync("fetch");
      if (id === "editor") git.openInEditor(this.repo).catch((e) => toast(String(e)));
      if (id === "explorer") ipc.fileReveal(this.repo).catch((e) => toast(String(e)));
      if (id === "terminal") this.host.openTerminal(this.repo);
      if (id === "web" && this.webUrl) ipc.openUrl(this.status?.branch ? `${this.webUrl}/tree/${encodeURIComponent(this.status.branch)}` : this.webUrl).catch(() => {});
      if (id === "copy") navigator.clipboard.writeText(this.status!.branch!).then(() => toast(t("git.head.branchCopied")));
      if (id === "review") this.host.askAgent(this.repo, t("git.agentReview"));
      if (id === "settings") void this.settings();
    });
  }

  // ------------------------------------------------------------ branches

  private async branchMenu(anchor: HTMLElement): Promise<void> {
    const list = await git.branches(this.repo).catch(() => []);
    const cur = this.status?.branch ?? null;
    const render = (el: HTMLDivElement, q: string) => {
      const ql = q.trim().toLowerCase();
      const local = list.filter((b) => !b.remote && (!ql || b.name.toLowerCase().includes(ql))).sort((a, b) => Number(b.current) - Number(a.current) || b.date - a.date);
      const remote = ql ? list.filter((b) => b.remote && b.name.toLowerCase().includes(ql)).slice(0, 8) : [];
      const exact = list.some((b) => b.name === q.trim());
      const slug = slugBranch(q);
      const items = el.querySelector<HTMLElement>(".gbm-items")!;
      items.innerHTML = `${slug && !exact ? `<button data-new="${esc(slug)}">${GI.branch}<span>${esc(t("git.branch.create", { name: slug }))}</span><small>Enter</small></button><hr>` : ""}
        <div class="mh">${esc(t("git.branch.recent"))}</div>${local
          .slice(0, 30)
          .map((b) => `<button data-co="${esc(b.name)}" class="${b.current ? "cur" : ""}">${b.current ? GI.check : GI.branch}<span class="mono">${esc(b.name)}</span><small>${b.ahead ? `↑${b.ahead} ` : ""}${b.behind ? `↓${b.behind} ` : ""}${b.worktree && !b.current ? "wt " : ""}${esc(ago(b.date * 1000))}</small></button>`)
          .join("")}
        ${remote.length ? `<div class="mh">${esc(t("git.branch.remote"))}</div>${remote.map((b) => `<button data-co="${esc(b.name)}" data-remote="1">${GI.web}<span class="mono">${esc(b.name)}</span></button>`).join("")}` : ""}
        <hr><button data-x="new">${esc(t("git.branch.createDots"))}</button><button data-x="wt">${esc(t("git.branch.worktree"))}</button>`;
    };
    popover(
      "git-branch",
      anchor,
      (el) => {
        el.innerHTML = `<input class="txt gbm-q" placeholder="${esc(t("git.branch.filter"))}" spellcheck="false"><div class="gbm-items"></div>`;
        const q = el.querySelector<HTMLInputElement>(".gbm-q")!;
        render(el, "");
        q.addEventListener("input", () => render(el, q.value));
        q.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          const first = el.querySelector<HTMLElement>("[data-new],[data-co]");
          first?.click();
        });
        el.onclick = (e) => {
          const tg = e.target as Element;
          const co = tg.closest<HTMLElement>("[data-co]");
          const nw = tg.closest<HTMLElement>("[data-new]")?.dataset.new;
          const x = tg.closest<HTMLElement>("[data-x]")?.dataset.x;
          if (!co && !nw && !x) return;
          closePopover();
          if (co && co.dataset.co !== cur) void this.checkout(co.dataset.co!, !!co.dataset.remote);
          if (nw) void this.createBranch(nw);
          if (x === "new") void this.newBranch();
          if (x === "wt") void this.newBranch(undefined, true);
        };
        requestAnimationFrame(() => q.focus());
      },
      "menu gmenu gbm",
    );
  }

  private async createBranch(name: string, from?: string): Promise<void> {
    const err = branchError(name);
    if (err) return toast(err);
    await this.act(() => git.action(this.repo, "create", [name, from ?? ""]), t("git.branch.created", { branch: name }));
  }

  /** Agentes trabalhando dentro deste repositório. */
  private busyAgents(): number {
    const root = normPath(this.repo);
    return store.sessions.filter((s) => s.runtime.status === "working" && normPath(s.cwd).startsWith(root)).length;
  }

  async checkout(name: string, remote = false): Promise<void> {
    const st = this.status;
    if (!st) return;
    const cur = st.branch ?? "HEAD";
    const target = remote ? name.replace(/^[^/]+\//, "") : name;
    const isSha = /^[0-9a-f]{7,40}$/.test(name) && !remote;
    const dirty = st.files.length > 0;
    const busy = this.busyAgents();
    let leave = false;
    if (dirty || busy) {
      const r = await ask({
        title: dirty ? t("git.switch.title", { branch: cur }) : t("git.branches.checkout"),
        sub: dirty ? t("git.switch.sub", { target }) : undefined,
        html: busy ? `<div class="g-warn">${GI.warn}<span>${esc(t("git.switch.agentBusy", { n: busy }))}</span></div>` : "",
        choices: [
          ...(dirty ? [{ id: "leave", label: t("git.switch.leave", { branch: cur }), hint: t("git.switch.leaveHint") }] : []),
          { id: "bring", label: dirty ? t("git.switch.bring", { target }) : t("git.branches.checkout"), hint: dirty ? t("git.switch.bringHint") : undefined },
          ...(!isSha ? [{ id: "worktree", label: t("git.switch.useWorktree", { target }) }] : []),
        ],
      });
      if (!r) return;
      if (r.choice === "worktree") return this.newBranch(name, true);
      leave = r.choice === "leave";
    }
    const repo = this.repo;
    const ok = await this.act(async () => {
      if (leave) await git.action(repo, "stash-push", [`polvo:${cur}`]);
      return git.action(repo, "checkout", [name, isSha ? "detach" : remote ? "remote" : ""]);
    }, t("git.branch.switched", { branch: target }));
    if (ok !== undefined) this.host.gitChanged();
  }

  /** Nova branch (opcionalmente numa worktree com um agente). `from` pode ser um sha ou uma branch existente. */
  async newBranch(from?: string, worktree = false): Promise<void> {
    const st = this.status;
    if (!st) return;
    const existing = from && !/^[0-9a-f]{7,40}$/.test(from) ? from : null;
    const base = from ?? st.branch ?? "HEAD";
    const agents = (["claude", "codex", "opencode", "shell"] as ToolKind[]).filter((k) => store.toolEnabled(k));
    const r = await ask({
      title: t(worktree ? "git.branches.worktreeTitle" : "git.branch.newTitle"),
      sub: worktree ? t("git.branches.worktreeSub") : t("git.branch.newFrom", { base: from && /^[0-9a-f]{7,40}$/.test(from) ? from.slice(0, 7) : base }),
      input: { value: existing ? existing.replace(/^origin\//, "") : "", placeholder: t("git.branch.namePlaceholder"), mono: true, validate: (v) => branchError(slugBranch(v) || v) },
      input2: worktree ? { label: t("git.branches.worktreePath"), placeholder: `${this.repo}-…`, mono: true } : undefined,
      select: worktree ? { label: t("git.branches.worktreeAgent"), options: [...agents.map((k) => ({ value: k, label: TOOLS[k].name })), { value: "", label: "—" }], value: agents[0] } : undefined,
      confirm: { label: t("git.dialog.create") },
    });
    if (!r) return;
    const name = slugBranch(r.value) || r.value;
    const repo = this.repo;
    if (!worktree) return this.createBranch(name, from);
    const path = r.value2 || `${this.repo.replace(/[\\/]+$/, "")}-${name.replace(/[\\/]+/g, "-")}`;
    const branches = await git.branches(repo).catch(() => []);
    const localExists = branches.some((b) => !b.remote && b.name === name);
    const args = localExists ? [path, name] : [path, name, "new", from ?? ""];
    const done = await this.act(() => git.action(repo, "worktree-add", args), t("git.branches.worktreeCreated", { path }));
    if (done === undefined) return;
    this.host.gitChanged();
    if (r.select) this.host.newSession(path, r.select as ToolKind);
  }

  // ------------------------------------------------------------ sincronizar

  private syncMenu(anchor: HTMLElement): void {
    const st = this.status;
    if (!st) return;
    menu("git-sync", anchor, [
      { id: "fetch", label: t("git.sync.fetch"), hint: t("git.sync.fetchHint") },
      { id: "pull", label: t("git.sync.pull"), hint: st.behind ? `↓${st.behind}` : "", disabled: !st.upstream },
      { id: st.upstream ? "push" : "publish", label: t(st.upstream ? "git.sync.push" : "git.sync.publish"), hint: st.ahead ? `↑${st.ahead}` : "" },
      "-",
      { id: "force-push", label: t("git.sync.forcePush"), danger: true, disabled: !st.upstream },
      { id: "push-tags", label: t("git.sync.pushTags") },
      ...(this.defaultBranch && st.branch && this.defaultBranch.replace(/^origin\//, "") !== st.branch
        ? ["-" as const, { id: "update", label: t("git.sync.updateFrom", { branch: this.defaultBranch.replace(/^origin\//, "") }) }]
        : []),
      ...(this.webUrl && st.branch ? ["-" as const, { id: "pr", label: t("git.branches.createPr") }] : []),
    ], (id) => {
      if (id === "pr") void this.act(() => git.prCreate(this.repo));
      else if (id === "update") void this.updateFromDefault();
      else void this.sync(id as RemoteOp);
    });
  }

  /** "Atualizar a partir de main": busca e mescla a branch padrão na atual (como o GitHub Desktop). */
  private async updateFromDefault(): Promise<void> {
    const def = this.defaultBranch;
    if (!def) return;
    const repo = this.repo;
    if (this.status?.upstream) await this.sync("fetch", true);
    await this.act(() => git.action(repo, "merge", [def]), t("git.branches.merged", { branch: def }));
  }

  /** Remoto e identidade (nome/e-mail) do repositório. */
  private async settings(): Promise<void> {
    const repo = this.repo;
    const cfg = await git.repoConfig(repo).catch(() => null);
    if (!cfg) return;
    const r = await ask({
      title: t("git.settings.title"),
      sub: repo,
      fields: [
        { id: "remote", label: t("git.settings.remote"), value: cfg.remote ?? "", placeholder: "https://github.com/usuario/repositorio.git", mono: true },
        { id: "name", label: t("git.settings.name"), value: cfg.name },
        { id: "email", label: t("git.settings.email"), value: cfg.email },
      ],
      html: `<div class="g-row-acts"><button class="gbtn" data-gi>${esc(t("git.settings.gitignore"))}</button></div>`,
      onExtra: () => void git.openInEditor(`${repo.replace(/[\\/]+$/, "")}\\.gitignore`).catch((e) => toast(String(e))),
      confirm: { label: t("git.settings.save") },
    });
    if (!r) return;
    const f = r.fields;
    if (f.remote && f.remote !== (cfg.remote ?? "")) await this.act(() => git.action(repo, "set-remote", [f.remote]));
    if ((f.name && f.name !== cfg.name) || (f.email && f.email !== cfg.email)) await this.act(() => git.action(repo, "set-identity", [f.name, f.email]), t("git.settings.saved"));
    void git.webUrl(repo).then((u) => (this.webUrl = u), () => {});
  }

  async sync(op: RemoteOp, silent = false): Promise<void> {
    if (this.syncing || !this.status) return;
    if (op === "force-push") {
      const ok = await ask({ title: t("git.sync.forceTitle"), sub: t("git.sync.forceSub", { upstream: this.status.upstream ?? "origin" }), confirm: { label: t("git.sync.push"), danger: true } });
      if (!ok) return;
    }
    const repo = this.repo;
    if (!silent) {
      this.syncing = { op, line: "" };
      this.renderTop();
    }
    const label = t(`git.sync.${op === "force-push" ? "push" : op === "push-tags" ? "pushTags" : op}`);
    try {
      await git.remote(repo, op, (line) => {
        if (!this.syncing || silent) return;
        this.syncing.line = line.replace(/^remote:\s*/, "").slice(0, 60);
        const b = this.top.querySelector(".g-sync.busy b");
        if (b) b.textContent = this.syncing.line;
      });
      if (op === "fetch" || op === "pull") lastFetch.set(normPath(repo), Date.now());
      if (!silent) {
        if (op === "publish" && this.webUrl && /github/i.test(this.webUrl)) toast(t("git.sync.done", { op: label }), { label: t("git.branches.createPr"), run: () => void this.act(() => git.prCreate(repo)) });
        else toast(t("git.sync.done", { op: label }));
      }
    } catch (e) {
      if (!silent) toast(String(e));
    }
    this.syncing = null;
    if (repo === this.repo) await this.refresh(true);
  }

  private autoFetch(): void {
    const st = this.status;
    if (!st?.upstream || this.syncing) return;
    const k = normPath(this.repo);
    const last = lastFetch.get(k) ?? 0;
    if (Date.now() - last < AUTO_FETCH_MS) return;
    lastFetch.set(k, Date.now());
    void this.sync("fetch", true);
  }

  // ------------------------------------------------------------ faixas

  private async loadStashes(): Promise<void> {
    const key = `${this.repo}|${this.status?.stashes}`;
    if (key === this.stashKey) return;
    this.stashKey = key;
    this.stashes = this.status?.stashes ? await git.stashes(this.repo).catch(() => []) : [];
  }

  private renderBanner(): void {
    const st = this.status;
    if (!st) return;
    const conflicts = st.files.filter((f) => f.conflict).length;
    if (st.operation) {
      const ready = conflicts === 0;
      this.banner.className = `g-banner ${ready ? "ok" : "bad"}`;
      this.banner.innerHTML = `${GI.warn}<span><b>${esc(t(`git.op.${st.operation}`))}</b> · ${esc(ready ? t("git.op.ready") : tn("git.op.conflicts", conflicts))}</span>
        ${conflicts ? `<button class="gbtn ai" data-b="agent">${GI.spark} ${esc(t("git.op.askAgent"))}</button>` : ""}
        ${st.operation !== "merge" ? `<button class="gbtn" data-b="skip">${esc(t("git.op.skip"))}</button>` : ""}
        <button class="gbtn" data-b="abort">${esc(t("git.op.abort"))}</button><button class="gbtn primary" data-b="continue" ${ready ? "" : "disabled"}>${esc(t("git.op.continue"))}</button>`;
      this.banner.hidden = false;
      return;
    }
    const mine = st.branch ? this.stashes.find((s) => s.message.endsWith(`polvo:${st.branch}`)) : undefined;
    if (mine) {
      this.banner.className = "g-banner info";
      this.banner.innerHTML = `${GI.stash}<span>${esc(t("git.switch.restoreTitle"))}</span><button class="gbtn primary" data-b="restore" data-i="${mine.index}">${esc(t("git.switch.restore"))}</button><button class="gbtn" data-b="drop" data-i="${mine.index}">${esc(t("git.switch.drop"))}</button>`;
      this.banner.hidden = false;
      return;
    }
    this.banner.hidden = true;
  }

  private async onBanner(e: MouseEvent): Promise<void> {
    const b = (e.target as Element).closest<HTMLElement>("[data-b]");
    if (!b || (b as HTMLButtonElement).disabled) return;
    const repo = this.repo;
    const i = b.dataset.i ?? "0";
    switch (b.dataset.b) {
      case "continue":
        return void this.act(() => git.action(repo, "continue"), t("git.op.continued"));
      case "abort":
        return void this.act(() => git.action(repo, "abort"), t("git.op.aborted"));
      case "skip":
        return void this.act(() => git.action(repo, "skip"));
      case "restore":
        return void this.act(() => git.action(repo, "stash-pop", [i]));
      case "drop": {
        const ok = await ask({ title: t("git.changes.stashDropTitle"), sub: t("git.changes.stashDropSub", { name: this.status?.branch ?? "" }), confirm: { label: t("git.dialog.delete"), danger: true } });
        if (ok) void this.act(() => git.action(repo, "stash-drop", [i]));
        return;
      }
      case "agent": {
        const files = this.status?.files.filter((f) => f.conflict).map((f) => f.path).join(", ") ?? "";
        return this.host.askAgent(repo, t("git.op.agentPrompt", { op: this.status?.operation ?? "merge", files }));
      }
    }
  }

  // ------------------------------------------------------------ ações

  async act<T>(p: () => Promise<T>, ok?: string | ((v: T) => string)): Promise<T | undefined> {
    try {
      const v = await p();
      if (ok) toast(typeof ok === "function" ? ok(v) : ok);
      await this.refresh(true);
      return v;
    } catch (e) {
      toast(String(e));
      await this.refresh(true);
      return undefined;
    }
  }
}
