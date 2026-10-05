// Aba "Histórico": commits com busca, detalhes, arquivos e ações
// (reverter, cherry-pick, tag, branch, reset, checkout).
import { ipc } from "../core/ipc";
import { localeTag, t, tn } from "../i18n";
import { ago, debounce, esc, h } from "../ui/dom";
import { toast } from "../ui/feedback";
import { git, type Commit, type CommitFile } from "./api";
import { parseDiff } from "./diff";
import { DiffView } from "./diffview";
import { ask, branchError } from "./dialog";
import { GI, menu, splitPath, splitter, type GitCtx } from "./ui";

const PAGE = 150;

/** Foto de cada e-mail: URL (ou `null`, sem foto conhecida), resolvida uma vez por sessão. */
const photos = new Map<string, Promise<string | null>>();
/** URLs que já falharam (404 do Gravatar, sem rede): ficam só as iniciais. */
const failed = new Set<string>();

/** Foto do autor: a do GitHub pelo e-mail noreply, senão o Gravatar (SHA-256, 404 se não houver). */
function photoOf(email: string): Promise<string | null> {
  const key = email.trim().toLowerCase();
  let p = photos.get(key);
  if (!p) {
    const gh = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/.exec(key);
    p = gh
      ? Promise.resolve(`https://avatars.githubusercontent.com/u/${gh[1]}?s=64`)
      : !key.includes("@") || !crypto.subtle
        ? Promise.resolve(null)
        : crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)).then(
            (b) => `https://www.gravatar.com/avatar/${[...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("")}?s=64&d=404`,
            () => null,
          );
    photos.set(key, p);
  }
  return p;
}

/** Iniciais do nome, com a cor tirada do e-mail; a foto entra por cima quando carrega. */
function avatar(name: string, email: string, cls = ""): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  const ini = ((words[0]?.[0] ?? "?") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
  let hue = 0;
  for (const ch of email.toLowerCase()) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="gav ${cls}" style="--h:${hue}" data-e="${esc(email)}" title="${esc(name)}">${esc(ini)}</span>`;
}

/** Põe as fotos nos avatares de `root` (os que não têm foto ficam com as iniciais). */
function loadPhotos(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".gav[data-e]:not([data-ph])").forEach((el) => {
    el.dataset.ph = "";
    void photoOf(el.dataset.e!).then((url) => {
      if (!url || failed.has(url)) return;
      const img = new Image();
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.onload = () => el.append(img);
      img.onerror = () => failed.add(url);
      img.src = url;
    });
  });
}

export class HistoryPane {
  readonly el = h("div", "gp gp-history");
  private listEl = h("div", "gh-list");
  private detail = h("div", "gh-detail");
  private search = "";
  private path: string | null = null;
  private commits: Commit[] = [];
  private sel: Commit | null = null;
  private files: CommitFile[] = [];
  private file: string | null = null;
  private view = new DiffView({ selectable: false, hunkActions: [], onHunk: () => {}, onSelection: () => {} });
  private done = false;
  private loading = false;
  private headSha: string | null = null;

  constructor(private ctx: GitCtx) {
    const col = h("div", "gc-col");
    const top = h("div", "gc-head");
    top.innerHTML = `<input class="gc-filter" placeholder="${esc(t("git.history.search"))}" spellcheck="false"><span class="gh-pathf" hidden></span>`;
    const input = top.querySelector<HTMLInputElement>("input")!;
    const run = debounce(() => void this.reload(), 300);
    input.addEventListener("input", () => {
      this.search = input.value;
      run();
    });
    top.addEventListener("click", (e) => {
      if ((e.target as Element).closest("[data-clear]")) this.setPath(null);
    });
    col.append(top, this.listEl);
    this.el.append(col, splitter(this.el, col, "listW.history"), this.detail);
    this.listEl.addEventListener("click", (e) => {
      if ((e.target as Element).closest("[data-more]")) return void this.load();
      const row = (e.target as Element).closest<HTMLElement>("[data-sha]");
      const c = row && this.commits.find((x) => x.sha === row.dataset.sha);
      if (c) void this.pick(c);
    });
    this.listEl.addEventListener("contextmenu", (e) => {
      const row = (e.target as Element).closest<HTMLElement>("[data-sha]");
      const c = row && this.commits.find((x) => x.sha === row.dataset.sha);
      if (c) this.actions(c, e);
    });
    this.listEl.addEventListener("scroll", () => {
      const l = this.listEl;
      if (l.scrollTop + l.clientHeight > l.scrollHeight - 200) void this.load();
    });
    this.detail.addEventListener("click", (e) => this.onDetail(e));
  }

  reset(): void {
    this.path = null;
    this.search = "";
    (this.el.querySelector(".gc-filter") as HTMLInputElement).value = "";
    this.sel = null;
    this.commits = [];
    this.renderPathFilter();
  }

  /** Mostrar só os commits de um arquivo. */
  setPath(path: string | null): void {
    this.path = path;
    this.renderPathFilter();
    void this.reload();
  }

  private renderPathFilter(): void {
    const el = this.el.querySelector<HTMLElement>(".gh-pathf")!;
    el.hidden = !this.path;
    if (this.path) el.innerHTML = `<span title="${esc(this.path)}">${esc(t("git.history.fileHistory", { name: splitPath(this.path).name }))}</span><button data-clear title="${esc(t("git.history.clearFilter"))}">×</button>`;
  }

  /** Status novo: só recarrega se o HEAD mudou. */
  update(): void {
    const head = this.ctx.status?.head ?? null;
    if (head !== this.headSha || !this.commits.length) {
      this.headSha = head;
      void this.reload();
    }
  }

  async reload(): Promise<void> {
    this.commits = [];
    this.done = false;
    await this.load();
    if (!this.sel || !this.commits.some((c) => c.sha === this.sel!.sha)) {
      if (this.commits[0]) await this.pick(this.commits[0]);
      else this.renderDetail();
    }
  }

  private async load(): Promise<void> {
    if (this.loading || this.done) return;
    this.loading = true;
    try {
      const page = await git.log(this.ctx.repo, this.commits.length, PAGE, this.search || undefined, undefined, this.path ?? undefined);
      this.commits.push(...page);
      this.done = page.length < PAGE;
    } catch (e) {
      this.done = true;
      toast(String(e));
    }
    this.loading = false;
    this.renderList();
  }

  private renderList(): void {
    if (!this.commits.length) {
      this.listEl.innerHTML = `<div class="g-empty">${esc(t("git.history.empty"))}</div>`;
      return;
    }
    const refChip = (r: string) => {
      const tag = r.startsWith("tag: ");
      const name = r.replace(/^tag: /, "").replace(/^HEAD -> /, "");
      return `<span class="gref${tag ? " tag" : r.startsWith("HEAD") ? " head" : name.includes("/") ? " remote" : ""}">${tag ? GI.tag : ""}${esc(name)}</span>`;
    };
    this.listEl.innerHTML =
      this.commits
        .map(
          (c) => `<div class="gh-r${this.sel?.sha === c.sha ? " on" : ""}" data-sha="${c.sha}">${avatar(c.author, c.email, c.parents.length > 1 ? "merge" : "")}
          <div class="gh-m"><b>${esc(c.subject)}</b><small>${c.refs.map(refChip).join("")}<span>${esc(c.author)} · ${esc(ago(c.date * 1000))}</span>${c.unpushed ? `<span class="gunp">${GI.up}${esc(t("git.history.unpushed"))}</span>` : ""}</small></div></div>`,
        )
        .join("") + (this.done ? "" : `<button class="gh-more" data-more>${esc(t("git.history.more"))}</button>`);
    loadPhotos(this.listEl);
  }

  private async pick(c: Commit): Promise<void> {
    this.sel = c;
    this.listEl.querySelectorAll<HTMLElement>(".gh-r").forEach((r) => r.classList.toggle("on", r.dataset.sha === c.sha));
    this.files = await git.commitFiles(this.ctx.repo, c.sha).catch(() => []);
    if (this.sel !== c) return;
    this.file = (this.path && this.files.find((f) => f.path === this.path)?.path) || this.files[0]?.path || null;
    this.renderDetail();
    void this.loadFileDiff();
  }

  private renderDetail(): void {
    const c = this.sel;
    if (!c) {
      this.detail.innerHTML = `<div class="g-empty">${esc(t("git.history.pickCommit"))}</div>`;
      return;
    }
    const date = new Date(c.date * 1000).toLocaleString(localeTag(), { dateStyle: "medium", timeStyle: "short" });
    this.detail.innerHTML = `<div class="gh-info">
        <h3>${esc(c.subject)}</h3>${c.body ? `<pre class="gh-body">${esc(c.body)}</pre>` : ""}
        <div class="gh-meta"><span class="gh-who">${avatar(c.author, c.email, "sm")}${esc(c.author)} &lt;${esc(c.email)}&gt;</span><span>${esc(date)}</span><button class="gsha" data-h="sha" title="${esc(t("git.history.ctx.copySha"))}">${GI.copy}${c.short}</button>${c.parents.length > 1 ? `<span class="gref">${esc(t("git.history.merge"))}</span>` : ""}<span>${esc(tn("git.history.files", this.files.length))}</span></div>
        <div class="gh-acts"><button class="gbtn" data-h="revert">${esc(t("git.history.ctx.revert"))}</button><button class="gbtn" data-h="branch">${esc(t("git.history.ctx.branch"))}</button><button class="gbtn" data-h="tag">${esc(t("git.history.ctx.tag"))}</button><button class="gbtn ai" data-h="agent">${GI.spark} ${esc(t("git.history.ctx.askAgent"))}</button><button class="ibtn sm" data-h="more">${GI.more}</button></div>
      </div>
      <div class="gh-split"><div class="gh-files">${this.files
        .map((f) => {
          const { dir, name } = splitPath(f.path);
          return `<div class="gf${f.path === this.file ? " on" : ""}" data-f="${esc(f.path)}" title="${esc(f.path)}"><span class="gf-p"><em>${esc(dir)}</em>${esc(name)}</span><span class="gst ${f.status}">${f.status}</span></div>`;
        })
        .join("")}</div><div class="gh-diff"></div></div>`;
    this.detail.querySelector(".gh-diff")!.append(this.view.el);
    loadPhotos(this.detail);
  }

  private async loadFileDiff(): Promise<void> {
    const c = this.sel;
    const f = this.files.find((x) => x.path === this.file);
    if (!c || !f) {
      this.view.set(null, "");
      return;
    }
    const raw = await git.diff({ repo: this.ctx.repo, path: f.path, orig: f.orig, kind: "commit", sha: c.sha }).catch((e) => String(e));
    if (this.sel !== c || this.file !== f.path) return;
    this.view.set(parseDiff(raw)[0] ?? null, f.path);
  }

  private onDetail(e: MouseEvent): void {
    const tg = e.target as Element;
    const file = tg.closest<HTMLElement>("[data-f]")?.dataset.f;
    if (file) {
      this.file = file;
      this.detail.querySelectorAll<HTMLElement>("[data-f]").forEach((r) => r.classList.toggle("on", r.dataset.f === file));
      return void this.loadFileDiff();
    }
    const a = tg.closest<HTMLElement>("[data-h]");
    if (!a || !this.sel) return;
    if (a.dataset.h === "more") return this.actions(this.sel, a);
    void this.run(a.dataset.h!, this.sel);
  }

  private actions(c: Commit, at: HTMLElement | MouseEvent): void {
    const branch = this.ctx.status?.branch ?? "HEAD";
    const isHead = c.sha === this.ctx.status?.head;
    menu("git-commit", at, [
      { id: "sha", label: t("git.history.ctx.copySha"), hint: c.short },
      { id: "msg", label: t("git.history.ctx.copyMsg") },
      "-",
      { id: "branch", label: t("git.history.ctx.branch") },
      { id: "tag", label: t("git.history.ctx.tag") },
      { id: "checkout", label: t("git.history.ctx.checkout") },
      "-",
      { id: "cherry", label: t("git.history.ctx.cherry", { branch }), disabled: isHead },
      { id: "revert", label: t("git.history.ctx.revert") },
      ...(isHead && c.unpushed ? [{ id: "undo", label: t("git.history.ctx.undo") }, { id: "reword", label: t("git.history.ctx.reword") }] : []),
      ...(isHead && c.unpushed && this.commits[1]?.unpushed && c.parents.length === 1 && this.commits[1].parents.length === 1
        ? [{ id: "squash", label: t("git.history.ctx.squash") }]
        : []),
      { id: "reset", label: t("git.history.ctx.reset", { branch }), disabled: isHead, danger: true },
      "-",
      ...(this.ctx.webUrl ? [{ id: "web", label: t("git.history.ctx.web") }] : []),
      { id: "agent", label: t("git.history.ctx.askAgent") },
    ], (id) => void this.run(id, c));
  }

  private async run(id: string, c: Commit): Promise<void> {
    const repo = this.ctx.repo;
    const branch = this.ctx.status?.branch ?? "HEAD";
    switch (id) {
      case "sha":
        return void navigator.clipboard.writeText(c.sha).then(() => toast(t("git.history.shaCopied")));
      case "msg":
        return void navigator.clipboard.writeText(c.body ? `${c.subject}\n\n${c.body}` : c.subject).then(() => toast(t("git.history.msgCopied")));
      case "branch":
        return this.ctx.newBranch(c.sha);
      case "checkout":
        return this.ctx.checkout(c.sha, false);
      case "cherry":
        return void this.ctx.act(() => git.action(repo, "cherry-pick", [c.sha]), t("git.history.picked"));
      case "revert":
        return void this.ctx.act(() => git.action(repo, "revert", [c.sha]), t("git.history.reverted"));
      case "undo":
        return void this.ctx.act(() => git.undoCommit(repo), t("git.commit.undone"));
      case "reword": {
        const r = await ask({
          title: t("git.history.rewordTitle"),
          input: { value: c.subject, validate: (v) => (v ? null : t("git.commit.needSummary")) },
          input2: { label: t("git.commit.description"), value: c.body },
          confirm: { label: t("git.settings.save") },
        });
        if (r) await this.ctx.act(() => git.action(repo, "reword", [r.value2 ? `${r.value}\n\n${r.value2}` : r.value]), t("git.history.reworded"));
        return;
      }
      case "squash":
        return void this.ctx.act(() => git.action(repo, "squash-head"), t("git.history.squashed"));
      case "web":
        return void ipc.openUrl(`${this.ctx.webUrl}/commit/${c.sha}`).catch((e) => toast(String(e)));
      case "agent":
        return this.ctx.host.askAgent(repo, t("git.history.explainPrompt", { sha: c.short, subject: c.subject }));
      case "tag": {
        const r = await ask({
          title: t("git.history.tagTitle", { sha: c.short }),
          input: { placeholder: t("git.history.tagName"), mono: true, validate: branchError },
          input2: { label: t("git.history.tagMessage"), placeholder: "" },
          checks: this.ctx.webUrl ? [{ id: "push", label: t("git.history.tagPush"), checked: false }] : [],
          confirm: { label: t("git.dialog.create") },
        });
        if (!r) return;
        await this.ctx.act(() => git.action(repo, "tag", [r.value, c.sha, r.value2]), t("git.history.tagged", { tag: r.value }));
        if (r.checks.push) await this.ctx.act(() => git.remote(repo, "push-tags", () => {}));
        return;
      }
      case "reset": {
        const r = await ask({
          title: t("git.history.resetTitle", { branch, sha: c.short }),
          sub: t("git.history.resetSub"),
          choices: [
            { id: "soft", label: t("git.history.resetSoft") },
            { id: "mixed", label: t("git.history.resetMixed") },
            { id: "hard", label: t("git.history.resetHard"), hint: t("git.history.resetHardWarn"), danger: true },
          ],
        });
        if (r) await this.ctx.act(() => git.action(repo, "reset", [c.sha, r.choice]));
        return;
      }
    }
  }
}
