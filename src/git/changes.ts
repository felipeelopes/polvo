// Aba "Alterações": arquivos modificados, diff com seleção de linhas,
// stash e a caixa de commit.
import { ipc } from "../core/ipc";
import { normPath, store } from "../core/store";
import { t, tn } from "../i18n";
import { ago, esc, h } from "../ui/dom";
import { toast } from "../ui/feedback";
import { git, type FileChange, type Stash } from "./api";
import { buildPatch, hunkSelection, parseDiff, type FileDiff } from "./diff";
import { DiffView, selectionLabel, type DiffMode } from "./diffview";
import { ask, branchError, slugBranch } from "./dialog";
import { absPath, GI, IMAGE_EXT, letterOf, menu, splitPath, stagedState, type GitCtx } from "./ui";

const PROTECTED = /^(main|master|develop|trunk|release.*)$/;
/** Larguras mínimas da lista e do diff ao arrastar a divisória (as mesmas do CSS de `.gc-col`). */
const MIN_LIST = 220;
const MIN_DIFF = 320;
const pref = (k: string, d: string) => {
  try {
    return localStorage.getItem(`polvo.git.${k}`) ?? d;
  } catch {
    return d;
  }
};
const setPref = (k: string, v: string) => {
  try {
    localStorage.setItem(`polvo.git.${k}`, v);
  } catch {
    /* sem armazenamento */
  }
};

/** Quem estava trabalhando quando cada arquivo apareceu (por repositório). */
const agentOf = new Map<string, Map<string, string>>();

export class ChangesPane {
  readonly el = h("div", "gp gp-changes");
  private list = h("div", "gc-list");
  private head = h("div", "gc-head");
  private find = h("div", "gc-find");
  private stashEl = h("div", "gc-stash");
  private box = h("div", "gc-commit");
  private dHead = h("div", "gd-head");
  private dScroll = h("div", "gd-scroll");
  private selBar = h("div", "gd-selbar");
  private selected: string | null = null;
  private filter = "";
  private mode = pref("mode", "unified") as DiffMode;
  private ws = pref("ws", "0") === "1";
  private context = 3;
  private raw = { u: "", s: "" };
  private files: { u: FileDiff | null; s: FileDiff | null } = { u: null, s: null };
  private uView: DiffView;
  private sView: DiffView;
  private stashOpen = true;
  private stashSel: Stash | null = null;
  private stashes: Stash[] = [];
  private known = new Set<string>();
  private busy = false;
  private lastKey = "";
  private nextKey = "";

  constructor(private ctx: GitCtx) {
    this.uView = new DiffView({
      selectable: true,
      hunkActions: [
        { id: "stage", label: t("git.diff.stageHunk") },
        { id: "discard", label: t("git.diff.discardHunk"), danger: true },
      ],
      onHunk: (a, hi) => void this.hunk("u", a, hi),
      onSelection: () => this.onSelection("u"),
      onOpenLine: (n) => this.openSelected(n),
    });
    this.sView = new DiffView({
      selectable: true,
      hunkActions: [{ id: "unstage", label: t("git.diff.unstageHunk") }],
      onHunk: (a, hi) => void this.hunk("s", a, hi),
      onSelection: () => this.onSelection("s"),
      onOpenLine: (n) => this.openSelected(n),
    });
    this.uView.mode = this.sView.mode = this.mode;

    const col = h("div", "gc-col");
    this.list.tabIndex = 0;
    col.append(this.head, this.find, this.list, this.stashEl, this.box);
    const diff = h("div", "gc-diff");
    this.selBar.hidden = true;
    diff.append(this.dHead, this.dScroll, this.selBar);
    const grip = h("div", "gc-grip");
    grip.title = t("git.changes.resize");
    grip.addEventListener("pointerdown", (e) => this.startResize(e, col));
    grip.addEventListener("dblclick", () => {
      this.setListWidth(null);
      setPref("listW", "");
    });
    this.setListWidth(Number(pref("listW", "")) || null);
    this.el.append(col, grip, diff);

    this.head.innerHTML = `<span class="cb" data-all title="${esc(t("git.changes.selectAll"))}"></span><span class="gc-count"></span><span class="sp"></span>
      <button class="ibtn sm" data-find title="${esc(t("git.changes.filter"))} (Ctrl+F)">${GI.search}</button><button class="ibtn sm" data-stash title="${esc(t("git.changes.stashNew"))}">${GI.stash}</button><button class="ibtn sm" data-lm title="${esc(t("git.head.more"))}">${GI.more}</button>`;
    this.find.innerHTML = `${GI.search}<input class="gc-filter" placeholder="${esc(t("git.changes.filter"))}" spellcheck="false"><button class="ibtn sm" data-unfind title="${esc(t("git.dialog.cancel"))}">×</button>`;
    this.find.hidden = true;
    this.head.addEventListener("click", (e) => this.onHead(e));
    const findInput = this.find.querySelector<HTMLInputElement>(".gc-filter")!;
    findInput.addEventListener("input", () => {
      this.filter = findInput.value.trim().toLowerCase();
      this.renderList();
    });
    findInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.toggleFind(false);
      if (e.key === "ArrowDown") this.list.focus();
    });
    this.find.addEventListener("click", (e) => {
      if ((e.target as Element).closest("[data-unfind]")) this.toggleFind(false);
    });
    this.list.addEventListener("click", (e) => this.onListClick(e));
    this.list.addEventListener("contextmenu", (e) => this.onListMenu(e));
    this.list.addEventListener("keydown", (e) => this.onListKey(e));
    this.list.title = t("git.changes.keys");
    this.stashEl.addEventListener("click", (e) => void this.onStash(e));
    this.dHead.addEventListener("click", (e) => this.onDiffHead(e));
    this.selBar.addEventListener("click", (e) => void this.onSelBar(e));
    this.buildCommitBox();
  }

  private get repo(): string {
    return this.ctx.repo;
  }

  private get all(): FileChange[] {
    return this.ctx.status?.files ?? [];
  }

  private file(path: string | null): FileChange | undefined {
    return path ? this.all.find((f) => f.path === path) : undefined;
  }

  /** Largura da lista de arquivos; `null` volta ao padrão do CSS. */
  private setListWidth(w: number | null): void {
    if (w) this.el.style.setProperty("--gc-w", `${Math.round(w)}px`);
    else this.el.style.removeProperty("--gc-w");
  }

  /** Divisória entre a lista e o diff: arrastar muda a largura, que fica lembrada. */
  private startResize(e: PointerEvent, col: HTMLElement): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = col.getBoundingClientRect().width;
    const max = this.el.clientWidth - MIN_DIFF;
    let w = w0;
    document.body.classList.add("resizing-git");
    const move = (ev: PointerEvent) => {
      w = Math.max(MIN_LIST, Math.min(max, w0 + ev.clientX - x0));
      this.setListWidth(w);
    };
    const up = () => {
      document.body.classList.remove("resizing-git");
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      if (w !== w0) setPref("listW", String(Math.round(w)));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }

  /** Repositório trocado. */
  reset(): void {
    this.selected = null;
    this.known.clear();
    this.lastKey = "";
    this.raw = { u: "", s: "" };
    this.stashOpen = true;
    this.stashSel = null;
    this.stashShown = "";
    this.loadDraft();
  }

  /** Status novo: atualiza lista, diff e caixa de commit. */
  update(): void {
    this.trackAgents();
    const key = JSON.stringify(this.all);
    const listChanged = key !== this.lastKey;
    this.lastKey = key;
    if (this.selected && !this.file(this.selected)) this.selected = null;
    if (!this.selected && !this.stashSel) this.selected = this.all.find((f) => f.conflict)?.path ?? this.all[0]?.path ?? null;
    if (listChanged) this.renderList();
    this.renderStash();
    this.renderCommitState();
    // Vendo um stash: o diff dá lugar ao conteúdo dele.
    if (!this.stashSel) void this.loadDiff(listChanged);
  }

  focus(): void {
    this.list.focus();
  }

  // ------------------------------------------------------------ lista

  private trackAgents(): void {
    let map = agentOf.get(this.repo);
    if (!map) agentOf.set(this.repo, (map = new Map()));
    const root = normPath(this.repo);
    const working = store.sessions.find((s) => s.tool !== "shell" && s.runtime.status === "working" && normPath(s.cwd).startsWith(root));
    for (const f of this.all) {
      if (!this.known.has(f.path) && working && this.lastKey) map.set(f.path, working.title);
      this.known.add(f.path);
    }
    for (const p of [...map.keys()]) if (!this.all.some((f) => f.path === p)) map.delete(p);
  }

  private visible(): FileChange[] {
    const list = this.filter ? this.all.filter((f) => f.path.toLowerCase().includes(this.filter)) : this.all;
    return [...list].sort((a, b) => Number(b.conflict) - Number(a.conflict) || a.path.localeCompare(b.path));
  }

  private renderList(): void {
    const files = this.visible();
    const all = this.all;
    const staged = all.filter((f) => stagedState(f) !== "off").length;
    const allBox = this.head.querySelector<HTMLElement>("[data-all]")!;
    allBox.className = `cb ${staged === 0 ? "" : staged === all.length && all.every((f) => stagedState(f) === "on") ? "on" : "part"}`;
    this.head.querySelector<HTMLElement>(".gc-count")!.textContent = all.length ? tn("git.changes.count", all.length) : "";
    if (!all.length) {
      this.list.innerHTML = `<div class="g-empty">${GI.check}<b>${esc(t("git.changes.none"))}</b><span>${esc(t("git.changes.noneHint"))}</span></div>`;
      return;
    }
    const agents = agentOf.get(this.repo);
    let conflictHeader = false;
    this.list.innerHTML = files
      .map((f) => {
        const { dir, name } = splitPath(f.path);
        const L = letterOf(f);
        const who = agents?.get(f.path);
        const hdr = f.conflict && !conflictHeader ? ((conflictHeader = true), `<div class="gf-h">${esc(t("git.changes.conflicted"))}</div>`) : "";
        const after = !f.conflict && conflictHeader ? ((conflictHeader = false), `<div class="gf-h">${esc(t("git.tabs.changes"))}</div>`) : "";
        return `${hdr}${after}<div class="gf${f.path === this.selected ? " on" : ""}" data-p="${esc(f.path)}" title="${esc(f.path)}${f.orig ? `\n${esc(t("git.changes.renamed", { from: f.orig }))}` : ""}">
          <span class="cb ${f.conflict ? "dis" : stagedState(f)}" data-cb></span><span class="gf-p"><em>${esc(dir)}</em>${esc(name)}</span>${who ? `<span class="gf-who" title="${esc(t("git.changes.agent", { name: who }))}">${esc(who.slice(0, 18))}</span>` : ""}<span class="gst ${L}">${L}</span></div>`;
      })
      .join("");
  }

  private select(path: string | null): void {
    if (path === this.selected && !this.stashSel) return;
    if (this.stashSel) {
      this.stashSel = null;
      this.stashShown = "";
      this.renderStash();
    }
    this.selected = path;
    this.list.querySelectorAll<HTMLElement>(".gf").forEach((r) => r.classList.toggle("on", r.dataset.p === path));
    this.list.querySelector(".gf.on")?.scrollIntoView({ block: "nearest" });
    this.raw = { u: "", s: "" };
    void this.loadDiff(true);
  }

  private async toggle(paths: FileChange[]): Promise<void> {
    if (!paths.length || this.busy) return;
    const unstage = paths.every((f) => stagedState(f) === "on");
    const list = paths.flatMap((f) => (f.orig ? [f.path, f.orig] : [f.path]));
    this.busy = true;
    await this.ctx.act(() => (unstage ? git.unstage(this.repo, list) : git.stage(this.repo, list)));
    this.busy = false;
  }

  private onHead(e: MouseEvent): void {
    const tg = e.target as Element;
    if (tg.closest("[data-all]")) {
      const all = this.all.filter((f) => !f.conflict);
      const everything = all.length && all.every((f) => stagedState(f) === "on");
      void this.ctx.act(() => (everything ? git.unstage(this.repo, ["."]) : git.stage(this.repo, ["."])));
      return;
    }
    if (tg.closest("[data-stash]")) return void this.stash();
    if (tg.closest("[data-find]")) return this.toggleFind(this.find.hidden);
    const lm = tg.closest<HTMLElement>("[data-lm]");
    if (lm) {
      menu("git-list", lm, [
        { id: "stash", label: t("git.changes.stashAll"), disabled: !this.all.length },
        { id: "restore", label: t("git.changes.stashRestoreLast"), disabled: !this.ctx.status?.stashes },
        { id: "review", label: t("git.review"), disabled: !this.all.length },
        "-",
        { id: "discard", label: t("git.changes.ctx.discard"), danger: true, disabled: !this.all.length },
      ], (id) => {
        if (id === "stash") void this.stash();
        if (id === "restore") void this.restoreLast();
        if (id === "review") this.ctx.host.askAgent(this.repo, t("git.agentReview"));
        if (id === "discard") void this.discard(this.all.filter((f) => !f.conflict));
      });
    }
  }

  private onListClick(e: MouseEvent): void {
    const row = (e.target as Element).closest<HTMLElement>(".gf");
    if (!row) return;
    const f = this.file(row.dataset.p!);
    if (!f) return;
    if ((e.target as Element).closest("[data-cb]") && !f.conflict) {
      void this.toggle([f]);
      return;
    }
    this.select(f.path);
  }

  private onListMenu(e: MouseEvent): void {
    const row = (e.target as Element).closest<HTMLElement>(".gf");
    if (!row) return;
    const f = this.file(row.dataset.p!);
    if (!f) return;
    this.select(f.path);
    const { dir } = splitPath(f.path);
    const ext = /\.([^./]+)$/.exec(f.path)?.[1];
    const st = stagedState(f);
    menu("git-file", e, [
      { id: st === "on" ? "unstage" : "stage", label: t(st === "on" ? "git.changes.ctx.unstage" : "git.changes.ctx.stage"), disabled: f.conflict },
      { id: "discard", label: t("git.changes.ctx.discard"), danger: true },
      "-",
      { id: "ignore", label: t("git.changes.ctx.ignore") },
      ...(ext ? [{ id: "ignoreExt", label: t("git.changes.ctx.ignoreExt", { ext }) }] : []),
      ...(dir ? [{ id: "ignoreDir", label: t("git.changes.ctx.ignoreFolder", { dir: dir.slice(0, -1) }) }] : []),
      "-",
      { id: "open", label: t("git.changes.ctx.open") },
      { id: "reveal", label: t("git.changes.ctx.reveal") },
      { id: "copy", label: t("git.changes.ctx.copyPath") },
      { id: "copyRel", label: t("git.changes.ctx.copyRel") },
      { id: "history", label: t("git.changes.ctx.history"), disabled: f.untracked },
      { id: "stashFile", label: t("git.changes.ctx.stash"), disabled: f.conflict },
    ], (id) => void this.fileAction(id, f));
  }

  private async fileAction(id: string, f: FileChange): Promise<void> {
    const abs = absPath(this.repo, f.path);
    const { dir } = splitPath(f.path);
    switch (id) {
      case "stage":
      case "unstage":
        return this.toggle([f]);
      case "discard":
        return this.discard([f]);
      case "ignore":
        return void this.ctx.act(() => git.ignore(this.repo, `/${f.path}`), t("git.changes.ignored"));
      case "ignoreExt":
        return void this.ctx.act(() => git.ignore(this.repo, `*.${/\.([^./]+)$/.exec(f.path)![1]}`), t("git.changes.ignored"));
      case "ignoreDir":
        return void this.ctx.act(() => git.ignore(this.repo, `/${dir}`), t("git.changes.ignored"));
      case "open":
        return this.openSelected();
      case "reveal":
        return void ipc.fileReveal(abs).catch((e) => toast(String(e)));
      case "copy":
        return void navigator.clipboard.writeText(abs).then(() => toast(t("docs.panel.pathCopied")));
      case "copyRel":
        return void navigator.clipboard.writeText(f.path).then(() => toast(t("docs.panel.pathCopied")));
      case "history":
        return this.ctx.showHistory(f.path);
      case "stashFile":
        return this.stash([f]);
    }
  }

  private toggleFind(on: boolean): void {
    this.find.hidden = !on;
    const input = this.find.querySelector<HTMLInputElement>("input")!;
    if (on) input.focus();
    else {
      input.value = "";
      this.filter = "";
      this.renderList();
      this.list.focus();
    }
  }

  private onListKey(e: KeyboardEvent): void {
    if (e.key.toLowerCase() === "f" && e.ctrlKey) {
      e.preventDefault();
      return this.toggleFind(true);
    }
    const files = this.visible();
    const i = files.findIndex((f) => f.path === this.selected);
    const cur = files[i];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next = files[Math.max(0, Math.min(files.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) this.select(next.path);
    } else if (e.key === " " && cur && !cur.conflict) void this.toggle([cur]);
    else if (e.key === "Delete" && cur) void this.discard([cur]);
    else if (e.key === "Enter" && cur) this.openSelected();
    else return;
    e.preventDefault();
  }

  private async discard(files: FileChange[]): Promise<void> {
    if (!files.length) return;
    const ok = await ask({
      title: tn("git.changes.discardTitle", files.length, { name: splitPath(files[0].path).name }),
      sub: t("git.changes.discardSub"),
      html: `<ul class="mlist gfiles">${files.slice(0, 8).map((f) => `<li><span class="gst ${letterOf(f)}">${letterOf(f)}</span><span>${esc(f.path)}</span></li>`).join("")}${files.length > 8 ? `<li><span>…</span></li>` : ""}</ul>`,
      confirm: { label: t("git.changes.discardBtn"), danger: true },
    });
    if (!ok) return;
    await this.ctx.act(() => git.discard(this.repo, files.map((f) => ({ path: f.path, orig: f.orig, x: f.x, untracked: f.untracked }))), t("git.changes.discarded"));
  }

  private openSelected(line?: number): void {
    if (!this.selected) return;
    const abs = absPath(this.repo, this.selected);
    if (/\.(md|markdown|mdx)$/i.test(abs) && line === undefined) return this.ctx.host.openDoc(abs);
    git.openInEditor(abs, line).catch((e) => toast(String(e)));
  }

  // ------------------------------------------------------------ stash

  /** Guarda alterações num stash (todas, ou só os arquivos dados), com mensagem opcional. */
  async stash(files?: FileChange[]): Promise<void> {
    if (!this.all.length) return toast(t("git.changes.none"));
    const list = files ?? [];
    const hasStaged = this.all.some((f) => !f.untracked && f.x !== ".");
    const r = await ask({
      title: list.length ? t("git.changes.stashFilesTitle", { name: splitPath(list[0].path).name }) : t("git.changes.stashNew"),
      sub: t("git.changes.stashSub"),
      input: { value: "", placeholder: t("git.changes.stashMessage") },
      checks: [
        { id: "u", label: t("git.changes.stashUntracked"), checked: true },
        ...(!list.length ? [{ id: "k", label: t("git.changes.stashKeepIndex"), checked: false }] : []),
        ...(!list.length && hasStaged ? [{ id: "s", label: t("git.changes.stashStagedOnly"), checked: false }] : []),
      ],
      confirm: { label: t("git.changes.stashBtn") },
    });
    if (!r) return;
    const opts = Object.entries(r.checks).filter(([, v]) => v).map(([k]) => k).join("");
    const paths = list.flatMap((f) => (f.orig ? [f.path, f.orig] : [f.path]));
    const repo = this.repo;
    const done = await this.ctx.act(() => git.action(repo, "stash-push", [r.value, opts, ...paths]));
    if (done === undefined) return;
    this.stashOpen = true;
    this.stashShown = "";
    this.renderStash();
    toast(t("git.changes.stashed"), { label: t("git.changes.stashPop"), run: () => void this.ctx.act(() => git.action(repo, "stash-pop", ["0"]), t("git.changes.stashRestored")) });
  }

  private stashShown = "";

  private renderStash(force = false): void {
    const n = this.ctx.status?.stashes ?? 0;
    const key = `${this.repo}|${n}|${this.stashOpen}|${this.stashSel?.index ?? ""}`;
    if (key === this.stashShown && !force) return;
    this.stashShown = key;
    this.stashEl.hidden = !n;
    if (!n) {
      if (this.stashSel) this.closeStash();
      return;
    }
    const head = `<button class="gs-h" data-st="toggle">${GI.stash}<span>${esc(tn("git.changes.stash", n))}</span><i class="chev${this.stashOpen ? " open" : ""}">${GI.caret}</i></button>`;
    if (!this.stashOpen) {
      this.stashEl.innerHTML = head;
      return;
    }
    void git.stashes(this.repo).then((list) => {
      this.stashes = list;
      if (this.stashSel && !list.some((s) => s.index === this.stashSel!.index && s.message === this.stashSel!.message)) this.closeStash();
      this.stashEl.innerHTML = `${head}<div class="gs-list">${list
        .map(
          (s) => `<div class="gs-r${this.stashSel?.index === s.index ? " on" : ""}" data-si="${s.index}" title="${esc(t("git.changes.stashHint"))}"><span>${esc(stashLabel(s.message))}<small>${esc(ago(s.date * 1000))}</small></span>
          <button data-st="pop" data-i="${s.index}" title="${esc(t("git.changes.stashPop"))}">${esc(t("git.changes.stashPop"))}</button><button data-st="more" data-i="${s.index}">${GI.more}</button></div>`,
        )
        .join("")}</div>`;
    });
  }

  private async onStash(e: MouseEvent): Promise<void> {
    const b = (e.target as Element).closest<HTMLElement>("[data-st]");
    if (!b) {
      const row = (e.target as Element).closest<HTMLElement>("[data-si]");
      const s = row && this.stashes.find((x) => x.index === Number(row.dataset.si));
      if (s) void this.showStash(s);
      return;
    }
    if (b.dataset.st === "toggle") {
      this.stashOpen = !this.stashOpen;
      return this.renderStash();
    }
    const s = this.stashes.find((x) => x.index === Number(b.dataset.i));
    if (!s) return;
    if (b.dataset.st === "pop") return this.stashAct("pop", s);
    this.stashMenu(b, s);
  }

  private stashMenu(anchor: HTMLElement, s: Stash): void {
    menu("git-stash", anchor, [
      { id: "view", label: t("git.changes.stashView") },
      { id: "pop", label: t("git.changes.stashPop") },
      { id: "apply", label: t("git.changes.stashApply") },
      { id: "branch", label: t("git.changes.stashBranch") },
      "-",
      { id: "drop", label: t("git.changes.stashDrop"), danger: true },
    ], (id) => (id === "view" ? void this.showStash(s) : void this.stashAct(id, s)));
  }

  /** Restaurar (pop), aplicar, criar branch ou descartar um stash. */
  private async stashAct(action: string, s: Stash): Promise<void> {
    const repo = this.repo;
    const i = String(s.index);
    if (action === "drop") {
      const ok = await ask({ title: t("git.changes.stashDropTitle"), sub: t("git.changes.stashDropSub", { name: stashLabel(s.message) }), confirm: { label: t("git.dialog.delete"), danger: true } });
      if (ok && (await this.ctx.act(() => git.action(repo, "stash-drop", [i]))) !== undefined) this.closeStash();
      return;
    }
    if (action === "branch") {
      const r = await ask({ title: t("git.changes.stashBranchTitle"), input: { value: slugBranch(stashLabel(s.message)), placeholder: t("git.branch.namePlaceholder"), mono: true, validate: branchError }, confirm: { label: t("git.dialog.create") } });
      if (!r) return;
      if ((await this.ctx.act(() => git.action(repo, "stash-branch", [r.value, i]), t("git.branch.created", { branch: r.value }))) !== undefined) {
        this.closeStash();
        this.ctx.host.gitChanged();
      }
      return;
    }
    const done = await this.ctx.act(() => git.action(repo, action === "apply" ? "stash-apply" : "stash-pop", [i]), t("git.changes.stashRestored"));
    if (done !== undefined) this.closeStash();
  }

  /** Mostra o conteúdo de um stash no lugar do diff. */
  private async showStash(s: Stash): Promise<void> {
    this.stashSel = s;
    this.selected = null;
    this.list.querySelectorAll(".gf.on").forEach((r) => r.classList.remove("on"));
    this.stashEl.querySelectorAll<HTMLElement>("[data-si]").forEach((r) => r.classList.toggle("on", Number(r.dataset.si) === s.index));
    this.selBar.hidden = true;
    const rev = `stash@{${s.index}}`;
    this.dHead.innerHTML = `${GI.stash}<span class="gd-path gs-title" title="${esc(s.message)}">${esc(stashLabel(s.message))}</span>
      <button class="gbtn primary" data-sx="pop">${esc(t("git.changes.stashPop"))}</button><button class="gbtn" data-sx="apply" title="${esc(t("git.changes.stashApply"))}">${esc(t("git.changes.stashApplyShort"))}</button>
      <button class="ibtn sm" data-sx="more">${GI.more}</button><button class="ibtn sm" data-sx="close" title="${esc(t("git.dialog.cancel"))}">×</button>`;
    this.dScroll.innerHTML = `<div class="g-empty">…</div>`;
    const files = await git.commitFiles(this.repo, rev).catch(() => []);
    if (this.stashSel !== s) return;
    this.dScroll.innerHTML = files.length ? "" : `<div class="g-empty">${esc(t("git.diff.empty"))}</div>`;
    for (const f of files.slice(0, 40)) {
      const raw = await git.diff({ repo: this.repo, path: f.path, orig: f.orig, kind: "commit", sha: rev }).catch(() => "");
      if (this.stashSel !== s) return;
      const view = new DiffView({ selectable: false, hunkActions: [], onHunk: () => {}, onSelection: () => {} });
      view.mode = this.mode;
      view.set(parseDiff(raw)[0] ?? null, f.path);
      const { dir, name } = splitPath(f.path);
      this.dScroll.append(h("div", "gd-sec gs-file", `<span class="gst ${f.status}">${f.status}</span> <em>${esc(dir)}</em>${esc(name)}`), view.el);
    }
  }

  private closeStash(): void {
    if (!this.stashSel) return;
    this.stashSel = null;
    this.stashShown = "";
    this.renderStash();
    this.selected = this.all[0]?.path ?? null;
    this.renderList();
    void this.loadDiff(true);
  }

  /** Restaura o stash mais recente (atalho). */
  async restoreLast(): Promise<void> {
    if (!this.ctx.status?.stashes) return toast(t("git.changes.stashNone"));
    const [s] = await git.stashes(this.repo).catch(() => []);
    if (s) await this.stashAct("pop", s);
  }

  // ------------------------------------------------------------ diff

  private async loadDiff(force: boolean): Promise<void> {
    const f = this.file(this.selected);
    if (!f) {
      this.selBar.hidden = true;
      this.raw = { u: "", s: "" };
      if (!this.all.length) {
        const st = this.ctx.status;
        const key = JSON.stringify([this.repo, st?.branch, st?.upstream, st?.ahead, st?.behind, st?.stashes, this.ctx.webUrl]);
        if (key !== this.nextKey || !this.dScroll.querySelector(".g-next")) {
          this.nextKey = key;
          this.renderNext();
        }
        return;
      }
      this.dHead.innerHTML = "";
      this.dScroll.innerHTML = `<div class="g-empty">${esc(t("git.diff.pickFile"))}</div>`;
      return;
    }
    const path = f.path;
    if (f.conflict) return this.renderConflict(f);
    const base = { repo: this.repo, path: f.path, orig: f.orig, context: this.context, ignoreWs: this.ws };
    try {
      const [u, s] = await Promise.all([
        f.untracked ? git.diff({ ...base, kind: "untracked" }) : f.y !== "." ? git.diff({ ...base, kind: "worktree" }) : Promise.resolve(""),
        !f.untracked && f.x !== "." ? git.diff({ ...base, kind: "staged" }) : Promise.resolve(""),
      ]);
      if (this.selected !== path) return;
      if (!force && u === this.raw.u && s === this.raw.s) return;
      const keepU = u === this.raw.u;
      const keepS = s === this.raw.s;
      this.raw = { u, s };
      this.files = { u: parseDiff(u)[0] ?? null, s: parseDiff(s)[0] ?? null };
      this.renderDiffHead(f);
      this.dScroll.innerHTML = "";
      const sections: [string, FileDiff | null, DiffView, boolean][] = [
        [f.untracked ? t("git.changes.untracked") : t("git.changes.unstaged"), this.files.u, this.uView, keepU],
        [t("git.changes.staged"), this.files.s, this.sView, keepS],
      ];
      const both = !!this.files.u && !!this.files.s;
      const lineOps = !f.untracked;
      for (const [title, file, view, keep] of sections) {
        if (!file) continue;
        if (both) this.dScroll.append(h("div", "gd-sec", esc(title)));
        view.set(file, f.path, keep && !force);
        if (!lineOps) {
          view.el.classList.add("nosel");
        } else view.el.classList.remove("nosel");
        this.dScroll.append(view.el);
      }
      if (IMAGE_EXT.test(f.path)) void this.renderImages(f);
      else if (!this.files.u && !this.files.s) this.dScroll.innerHTML = `<div class="g-empty">${esc(t("git.diff.empty"))}</div>`;
      this.onSelection(null);
    } catch (e) {
      this.dScroll.innerHTML = `<div class="g-empty err">${esc(String(e))}</div>`;
    }
  }

  private renderDiffHead(f: FileChange): void {
    const { dir, name } = splitPath(f.path);
    const add = (this.files.u?.added ?? 0) + (this.files.s?.added ?? 0);
    const rem = (this.files.u?.removed ?? 0) + (this.files.s?.removed ?? 0);
    const L = letterOf(f);
    this.dHead.innerHTML = `<span class="gst ${L}">${L}</span><span class="gd-path" title="${esc(f.path)}"><em>${esc(dir)}</em>${esc(name)}</span>
      ${this.ws ? `<button class="gd-flag" data-dh="ws" title="${esc(t("git.diff.ws"))}">${esc(t("git.diff.wsOn"))} ×</button>` : ""}
      <span class="gd-n"><i class="a">+${add}</i><i class="d">−${rem}</i></span>
      <div class="seg gseg"><button data-dm="unified" class="${this.mode === "unified" ? "on" : ""}">${esc(t("git.diff.unified"))}</button><button data-dm="split" class="${this.mode === "split" ? "on" : ""}">${esc(t("git.diff.split"))}</button></div>
      <button class="ibtn sm" data-dh="open" title="${esc(t("git.changes.ctx.open"))}">${GI.editor}</button>
      <button class="ibtn sm" data-dh="menu" title="${esc(t("git.head.more"))}">${GI.more}</button>`;
  }

  private onDiffHead(e: MouseEvent): void {
    const tg = e.target as Element;
    const sx = tg.closest<HTMLElement>("[data-sx]");
    if (sx && this.stashSel) {
      if (sx.dataset.sx === "close") return this.closeStash();
      if (sx.dataset.sx === "more") return this.stashMenu(sx, this.stashSel);
      return void this.stashAct(sx.dataset.sx!, this.stashSel);
    }
    const dm = tg.closest<HTMLElement>("[data-dm]")?.dataset.dm as DiffMode | undefined;
    if (dm) {
      this.mode = dm;
      setPref("mode", dm);
      this.uView.setMode(dm);
      this.sView.setMode(dm);
      this.dHead.querySelectorAll<HTMLElement>("[data-dm]").forEach((b) => b.classList.toggle("on", b.dataset.dm === dm));
      return;
    }
    const btn = tg.closest<HTMLElement>("[data-dh]");
    const a = btn?.dataset.dh;
    if (a === "ws") return this.diffOption("ws");
    if (a === "open") return this.openSelected();
    if (a === "menu" && btn) {
      const f = this.file(this.selected);
      const off = '<i class="g-ic"></i>';
      menu("git-diff", btn, [
        { id: "ws", label: t("git.diff.ws"), icon: this.ws ? GI.check : off },
        { id: "more", label: t("git.diff.more"), hint: `${this.context}` },
        { id: "less", label: t("git.diff.less"), disabled: this.context <= 1 },
        "-",
        { id: "open", label: t("git.changes.ctx.open") },
        { id: "reveal", label: t("git.changes.ctx.reveal") },
        { id: "copyRel", label: t("git.changes.ctx.copyRel") },
        ...(f && !f.untracked ? [{ id: "history", label: t("git.changes.ctx.history") }] : []),
        "-",
        { id: "discard", label: t("git.changes.ctx.discard"), danger: true, disabled: !f || f.conflict },
      ], (id) => {
        if (id === "ws" || id === "more" || id === "less") return this.diffOption(id);
        if (f) void this.fileAction(id, f);
      });
    }
  }

  private diffOption(id: "ws" | "more" | "less"): void {
    if (id === "ws") {
      this.ws = !this.ws;
      setPref("ws", this.ws ? "1" : "0");
    } else if (id === "more") this.context = Math.min(this.context * 3, 9999);
    else this.context = Math.max(1, Math.round(this.context / 3));
    void this.loadDiff(true);
  }

  private async renderImages(f: FileChange): Promise<void> {
    const abs = absPath(this.repo, f.path);
    const mime = /\.svg$/i.test(f.path) ? "image/svg+xml" : "image/*";
    const url = (b: Uint8Array) => URL.createObjectURL(new Blob([b as BlobPart], { type: mime }));
    const [before, after] = await Promise.all([
      f.untracked || f.x === "A" ? null : git.fileAt(this.repo, "HEAD", f.orig ?? f.path).then(url, () => null),
      f.y === "D" || f.x === "D" ? null : ipc.fileBytes(abs).then(url, () => null),
    ]);
    if (this.selected !== f.path) return;
    const box = h("div", "gimg");
    box.innerHTML = `${before ? `<figure><img src="${before}"><figcaption>HEAD</figcaption></figure>` : ""}${after ? `<figure><img src="${after}"><figcaption>${esc(t("git.diff.image"))}</figcaption></figure>` : ""}`;
    this.dScroll.replaceChildren(box);
  }

  private async renderConflict(f: FileChange): Promise<void> {
    const abs = absPath(this.repo, f.path);
    this.dHead.innerHTML = `<span class="gst U">U</span><span class="gd-path"><em>${esc(splitPath(f.path).dir)}</em>${esc(splitPath(f.path).name)}</span>`;
    const text = await ipc.fileRead(abs).then((d) => d.content, () => "");
    if (this.selected !== f.path) return;
    let side: "" | "ours" | "theirs" = "";
    const lines = text.split("\n").map((l, i) => {
      if (l.startsWith("<<<<<<<")) side = "ours";
      else if (l.startsWith("=======") && side) side = "theirs";
      const mark = /^(<<<<<<<|=======|>>>>>>>)/.test(l);
      const cls = mark ? "mk" : side;
      if (l.startsWith(">>>>>>>")) side = "";
      return `<div class="gl ${cls}" data-n="${i + 1}"><span class="gn">${i + 1}</span><span class="gt">${esc(l) || " "}</span></div>`;
    });
    this.dScroll.innerHTML = `<div class="gconf"><span>${GI.warn} ${esc(t("git.diff.conflictHint"))}</span>
      <button class="gbtn" data-cf="ours">${esc(t("git.op.ours"))}</button><button class="gbtn" data-cf="theirs">${esc(t("git.op.theirs"))}</button>
      <button class="gbtn" data-cf="open">${esc(t("git.changes.ctx.open"))}</button><button class="gbtn ai" data-cf="agent">${GI.spark} ${esc(t("git.op.askAgent"))}</button>
      <button class="gbtn primary" data-cf="resolved">${esc(t("git.op.resolved"))}</button></div><div class="gd"><div class="gd-body unified conflict">${lines.join("")}</div></div>`;
    this.dScroll.querySelector(".gconf")!.addEventListener("click", (e) => {
      const cf = (e.target as Element).closest<HTMLElement>("[data-cf]")?.dataset.cf;
      if (!cf) return;
      if (cf === "open") return this.openSelected(Number(this.dScroll.querySelector(".gl.mk")?.getAttribute("data-n") ?? 1));
      if (cf === "agent") {
        const op = this.ctx.status?.operation ?? "merge";
        return this.ctx.host.askAgent(this.repo, t("git.op.agentPrompt", { op, files: f.path }));
      }
      void this.ctx.act(() => git.action(this.repo, "resolve", [f.path, cf === "resolved" ? "" : cf]));
    });
    this.dScroll.querySelector(".gd-body")!.addEventListener("dblclick", (e) => {
      const n = (e.target as Element).closest<HTMLElement>("[data-n]")?.dataset.n;
      if (n) this.openSelected(Number(n));
    });
  }

  private async hunk(which: "u" | "s", action: string, hi: number): Promise<void> {
    const file = this.files[which];
    if (!file) return;
    await this.applyLines(which, action, hunkSelection(file, hi));
  }

  private async applyLines(which: "u" | "s", action: string, sel: Set<string>): Promise<void> {
    const file = this.files[which];
    if (!file || this.busy) return;
    const f = this.file(this.selected);
    if (f?.untracked && action === "stage") return this.toggle([f]);
    if (action === "discard") {
      const n = [...sel].length;
      const ok = await ask({ title: tn("git.diff.discardLinesTitle", n), sub: t("git.diff.discardLinesSub"), confirm: { label: t("git.changes.discardBtn"), danger: true } });
      if (!ok) return;
    }
    const reverse = action !== "stage";
    const patch = buildPatch(file, sel, reverse);
    if (!patch) return;
    this.busy = true;
    await this.ctx.act(() => git.apply(this.repo, patch, action !== "discard", reverse));
    this.busy = false;
    this.uView.selection.clear();
    this.sView.selection.clear();
  }

  private onSelection(which: "u" | "s" | null): void {
    if (which === "u" && this.sView.selection.size) this.sView.clearSelection();
    if (which === "s" && this.uView.selection.size) this.uView.clearSelection();
    const u = this.uView.selection.size;
    const s = this.sView.selection.size;
    const n = u || s;
    this.selBar.hidden = !n;
    if (!n) return;
    const btns = u
      ? `<button class="gbtn primary" data-sb="stage">${esc(t("git.diff.stageLines"))}</button><button class="gbtn danger" data-sb="discard">${esc(t("git.diff.discardLines"))}</button>`
      : `<button class="gbtn primary" data-sb="unstage">${esc(t("git.diff.unstageLines"))}</button>`;
    this.selBar.innerHTML = `<span>${esc(selectionLabel(n))}</span>${btns}<button class="gbtn" data-sb="clear">${esc(t("git.diff.clear"))}</button>`;
  }

  private async onSelBar(e: MouseEvent): Promise<void> {
    const a = (e.target as Element).closest<HTMLElement>("[data-sb]")?.dataset.sb;
    if (!a) return;
    if (a === "clear") {
      this.uView.clearSelection();
      this.sView.clearSelection();
      return;
    }
    const which = this.uView.selection.size ? "u" : "s";
    await this.applyLines(which, a, new Set((which === "u" ? this.uView : this.sView).selection));
  }

  // ------------------------------------------------------------ commit

  private sum!: HTMLInputElement;
  private desc!: HTMLTextAreaElement;
  private btn!: HTMLButtonElement;
  private amending = false;
  private coauthors: string[] = [];

  private buildCommitBox(): void {
    this.box.innerHTML = `<div class="gc-amend" hidden></div>
      <div class="gc-msg">
        <div class="gc-sumrow"><input class="gc-sum" placeholder="${esc(t("git.commit.summary"))}" spellcheck="true"><span class="gc-len"></span></div>
        <textarea class="gc-desc" rows="3" placeholder="${esc(t("git.commit.description"))}"></textarea>
        <div class="gc-co" hidden></div>
        <div class="gc-tools"><button class="gc-ai" data-c="ai" title="${esc(t("git.commit.aiHint"))}">${GI.spark}<span>${esc(t("git.commit.ai"))}</span></button><span class="sp"></span>
          <button class="ibtn sm" data-c="coauthor" title="${esc(t("git.commit.coauthorAdd"))}">${GI.person}</button>
          <button class="ibtn sm" data-c="opts" title="${esc(t("git.commit.options"))}">${GI.more}</button></div>
      </div>
      <div class="gc-prot" hidden></div>
      <button class="gc-btn" data-c="commit"></button>`;
    this.sum = this.box.querySelector(".gc-sum")!;
    this.desc = this.box.querySelector(".gc-desc")!;
    this.btn = this.box.querySelector(".gc-btn")!;
    const save = () => this.saveDraft();
    this.sum.addEventListener("input", () => {
      save();
      this.renderCommitState();
    });
    this.desc.addEventListener("input", () => {
      save();
      this.fitDesc();
    });
    for (const el of [this.sum, this.desc] as HTMLElement[]) {
      el.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" && e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          void this.commit();
        }
      });
    }
    this.sum.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.ctrlKey) {
        e.preventDefault();
        this.desc.focus();
      }
    });
    this.box.addEventListener("click", (e) => {
      const tg = e.target as Element;
      const rm = tg.closest<HTMLElement>("[data-co-rm]")?.dataset.coRm;
      if (rm !== undefined) {
        this.coauthors.splice(Number(rm), 1);
        return this.renderCoauthors();
      }
      const c = tg.closest<HTMLElement>("[data-c]");
      if (!c) return;
      switch (c.dataset.c) {
        case "commit":
          return void this.commit();
        case "ai":
          return void this.generate(c as HTMLButtonElement);
        case "branch":
          return void this.ctx.newBranch();
        case "noamend":
          return void this.setAmend(false);
        case "coauthor":
          return void this.addCoauthor();
        case "opts": {
          const nv = pref("noVerify", "0") === "1";
          const so = pref("signOff", "0") === "1";
          const off = '<i class="g-ic"></i>';
          return menu("git-copts", c, [
            { id: "amend", label: t("git.commit.amend"), hint: t("git.commit.amendShort"), icon: this.amending ? GI.check : off },
            "-",
            { id: "noVerify", label: t("git.commit.noVerify"), icon: nv ? GI.check : off },
            { id: "signOff", label: t("git.commit.signOff"), icon: so ? GI.check : off },
          ], (id) => {
            if (id === "amend") void this.setAmend(!this.amending);
            else setPref(id, pref(id, "0") === "1" ? "0" : "1");
          });
        }
      }
    });
  }

  private fitDesc(): void {
    this.desc.style.height = "auto";
    this.desc.style.height = `${Math.min(180, Math.max(58, this.desc.scrollHeight))}px`;
  }

  private draftKey(): string {
    return `draft.${normPath(this.repo)}`;
  }

  private saveDraft(): void {
    setPref(this.draftKey(), JSON.stringify({ s: this.sum.value, d: this.desc.value, c: this.coauthors }));
  }

  private loadDraft(): void {
    try {
      const d = JSON.parse(pref(this.draftKey(), "{}")) as { s?: string; d?: string; c?: string[] };
      this.sum.value = d.s ?? "";
      this.desc.value = d.d ?? "";
      this.coauthors = d.c ?? [];
    } catch {
      this.sum.value = this.desc.value = "";
      this.coauthors = [];
    }
    this.amending = false;
    this.renderCoauthors();
    this.fitDesc();
  }

  private renderCoauthors(): void {
    const el = this.box.querySelector<HTMLElement>(".gc-co")!;
    el.hidden = !this.coauthors.length;
    el.innerHTML = this.coauthors
      .map((c, i) => `<span class="gc-chip" title="Co-authored-by: ${esc(c)}">${GI.person}<span>${esc(c.replace(/\s*<.*$/, ""))}</span><button data-co-rm="${i}" title="${esc(t("git.dialog.cancel"))}">×</button></span>`)
      .join("");
    this.saveDraft();
  }

  private async addCoauthor(): Promise<void> {
    const recent = await git.log(this.repo, 0, 300).catch(() => []);
    const people = [...new Set(recent.map((c) => `${c.author} <${c.email}>`))].filter((p) => !this.coauthors.includes(p));
    const r = await ask({
      title: t("git.commit.coauthorAdd"),
      sub: t("git.commit.coauthorSub"),
      input: { placeholder: t("git.commit.coauthorHint"), list: people, validate: (v) => (/^[^<>]+<[^<>@\s]+@[^<>\s]+>$/.test(v.trim()) ? null : t("git.commit.coauthorInvalid")) },
      confirm: { label: t("git.dialog.ok") },
    });
    if (!r) return;
    this.coauthors.push(r.value.trim());
    this.renderCoauthors();
  }

  private async setAmend(on: boolean): Promise<void> {
    this.amending = on;
    if (on && !this.sum.value.trim()) {
      const [last] = await git.log(this.repo, 0, 1).catch(() => []);
      if (last) {
        this.sum.value = last.subject;
        this.desc.value = last.body;
        this.fitDesc();
      }
    }
    this.renderCommitState();
  }

  private renderCommitState(): void {
    const st = this.ctx.status;
    if (!st) return;
    const branch = st.branch ?? t("git.branch.detached");
    const staged = this.all.filter((f) => !f.untracked && f.x !== ".").length;
    const total = this.all.length;
    const amend = this.amending;
    const len = this.sum.value.length;
    const lenEl = this.box.querySelector<HTMLElement>(".gc-len")!;
    lenEl.textContent = len > 50 ? String(72 - len) : "";
    lenEl.className = `gc-len${len > 72 ? " bad" : ""}`;
    lenEl.title = len > 72 ? t("git.commit.tooLong") : "";
    const am = this.box.querySelector<HTMLElement>(".gc-amend")!;
    am.hidden = !amend;
    if (amend) am.innerHTML = `${GI.refresh}<span>${esc(t("git.commit.amending"))}</span><button data-c="noamend">${esc(t("git.dialog.cancel"))}</button>`;
    let label: string;
    if (amend) label = t("git.commit.buttonAmend", { branch });
    else if (!staged && total) label = tn("git.commit.buttonAll", total, { branch });
    else label = t("git.commit.button", { branch });
    this.btn.innerHTML = `<span>${esc(label)}</span><kbd>${t("git.commit.shortcut")}</kbd>`;
    this.btn.title = !staged && total && !amend ? t("git.commit.allHint") : "";
    const conflicts = this.all.some((f) => f.conflict);
    this.btn.disabled = conflicts || (!total && !amend) || (!amend && !this.sum.value.trim());
    const prot = this.box.querySelector<HTMLElement>(".gc-prot")!;
    const isProt = !!st.branch && PROTECTED.test(st.branch) && total > 0 && !amend;
    prot.hidden = !isProt;
    if (isProt) prot.innerHTML = `${GI.warn}<span>${esc(t("git.commit.protected", { branch: st.branch! }))}</span><button data-c="branch">${esc(t("git.commit.createBranch"))}</button>`;
    this.box.classList.toggle("gc-idle", !total && !amend);
  }

  private async generate(btn: HTMLButtonElement): Promise<void> {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add("busy");
    const label = btn.querySelector("span")!;
    label.textContent = t("git.commit.aiWorking");
    try {
      const msg = await git.aiMessage(this.repo);
      const [first, ...rest] = msg.split("\n");
      this.sum.value = first.trim();
      this.desc.value = rest.join("\n").trim();
      this.fitDesc();
      this.saveDraft();
      this.renderCommitState();
      this.sum.focus();
    } catch (e) {
      toast(String(e));
    } finally {
      btn.disabled = false;
      btn.classList.remove("busy");
      label.textContent = t("git.commit.ai");
    }
  }

  async commit(): Promise<void> {
    if (this.btn.disabled) {
      if (this.all.some((f) => f.conflict)) toast(t("git.commit.conflicts"));
      else if (!this.sum.value.trim() && !this.amending) {
        toast(t("git.commit.needSummary"));
        this.sum.focus();
      }
      return;
    }
    const summary = this.sum.value.trim();
    const body = this.desc.value.trim();
    const trailers = this.coauthors.map((c) => `Co-authored-by: ${c}`).join("\n");
    const message = [summary, body, trailers].filter(Boolean).join("\n\n");
    const staged = this.all.some((f) => !f.untracked && f.x !== ".");
    const repo = this.repo;
    this.btn.disabled = true;
    const res = await this.ctx.act(() =>
      git.commit({ repo, message, amend: this.amending, noVerify: pref("noVerify", "0") === "1", signOff: pref("signOff", "0") === "1", all: !staged && !this.amending }),
    );
    if (!res) return this.renderCommitState();
    this.sum.value = this.desc.value = "";
    this.amending = false;
    this.coauthors = [];
    this.renderCoauthors();
    this.fitDesc();
    this.renderCommitState();
    toast(t("git.commit.done", { sha: res.sha }), {
      label: t("git.commit.undo"),
      run: () =>
        void this.ctx.act(async () => {
          const msg = await git.undoCommit(repo);
          const [first, ...rest] = msg.split("\n");
          this.sum.value = first;
          this.desc.value = rest.join("\n").replace(/\n*Co-authored-by:.*$/gim, "").trim();
          this.fitDesc();
          this.saveDraft();
          return msg;
        }, t("git.commit.undone")),
    });
  }

  /** Foco direto no resumo (atalho). */
  focusSummary(): void {
    this.sum.focus();
  }

  // ------------------------------------------------------------ sem alterações

  /** Sem alterações: sugere o próximo passo (enviar, publicar, PR…), como o GitHub Desktop. */
  private renderNext(): void {
    const st = this.ctx.status;
    if (!st) return;
    const cards: { id: string; title: string; desc: string; primary?: boolean }[] = [];
    if (st.branch && !st.upstream && !st.unborn) cards.push({ id: "publish", title: t("git.next.publish"), desc: t("git.next.publishDesc", { branch: st.branch }), primary: true });
    if (st.behind) cards.push({ id: "pull", title: tn("git.next.pull", st.behind), desc: t("git.next.pullDesc"), primary: true });
    if (st.ahead) cards.push({ id: "push", title: tn("git.next.push", st.ahead), desc: t("git.next.pushDesc"), primary: !st.behind });
    if (this.ctx.webUrl && st.upstream && st.branch && !PROTECTED.test(st.branch)) cards.push({ id: "pr", title: t("git.next.pr"), desc: t("git.next.prDesc", { branch: st.branch }) });
    if (st.stashes) cards.push({ id: "stash", title: t("git.next.stash"), desc: t("git.next.stashDesc") });
    cards.push({ id: "editor", title: t("git.next.editor"), desc: t("git.next.editorDesc") });
    cards.push({ id: "explorer", title: t("git.next.explorer"), desc: t("git.next.explorerDesc") });
    if (this.ctx.webUrl) cards.push({ id: "web", title: t("git.next.web"), desc: t("git.next.webDesc") });
    this.dHead.innerHTML = "";
    this.dScroll.innerHTML = `<div class="g-next"><div class="g-next-h">${GI.check}<b>${esc(t("git.next.title"))}</b><span>${esc(t("git.changes.noneHint"))}</span></div>
      <div class="g-cards">${cards.map((c) => `<button class="g-card${c.primary ? " primary" : ""}" data-next="${c.id}"><b>${esc(c.title)}</b><small>${esc(c.desc)}</small></button>`).join("")}</div></div>`;
    this.dScroll.querySelector(".g-cards")!.addEventListener("click", (e) => {
      const id = (e.target as Element).closest<HTMLElement>("[data-next]")?.dataset.next;
      if (!id) return;
      if (id === "publish" || id === "pull" || id === "push") return void this.ctx.sync(id);
      if (id === "pr") return void this.ctx.act(() => git.prCreate(this.repo));
      if (id === "stash") return void this.restoreLast();
      if (id === "editor") return void git.openInEditor(this.repo).catch((err) => toast(String(err)));
      if (id === "explorer") return void ipc.fileReveal(this.repo).catch((err) => toast(String(err)));
      if (id === "web" && this.ctx.webUrl) return void ipc.openUrl(this.ctx.webUrl).catch(() => {});
    });
  }
}

/** "On main: polvo:main" / "WIP on main: abc123 msg" → texto amigável. */
function stashLabel(msg: string): string {
  return msg.replace(/^(WIP )?[Oo]n [^:]+: /, "").replace(/^polvo:/, "⎇ ");
}
