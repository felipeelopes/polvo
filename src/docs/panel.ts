// Painel de documentos: abas de arquivos Markdown ao lado das sessões, com
// leitura (mermaid, fórmulas, código), edição e modo dividido. Acompanha
// mudanças feitas por fora — o agente editando o arquivo aparece ao vivo.
import "../styles/docs.css";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ipc } from "../core/ipc";
import { store } from "../core/store";
import { t, tn } from "../i18n";
import { basename, esc, h } from "../ui/dom";
import { closePopover, popover, toast } from "../ui/feedback";
import type { DocEditor } from "./editor";
import { renderDiagrams } from "./mermaid";
import { dirname, MD_EXT, resolvePath } from "./paths";
import { enhance, renderMarkdown, toggleTask } from "./render";

type Mode = "read" | "split" | "edit";

const POLL_MS = 1500;
const MIN_W = 320;
const KEY = () => `polvo.docs.${store.label}`;

const I = {
  doc: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6.5 8.5h4M6.5 11h4"/></svg>',
  x: '<svg width="11" height="11" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  toc: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 3.5h1M5.5 3.5H14M2 8h1M5.5 8H14M2 12.5h1M5.5 12.5H14"/></svg>',
  save: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2.5 2.5h9l2 2v9h-11z"/><path d="M5 2.5v3.5h5V2.5M5 13.5V9.5h6v4"/></svg>',
  more: '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
  max: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9.5 2H14v4.5M6.5 14H2V9.5M14 2 9 7M2 14l5-5"/></svg>',
  min: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M14 6.5H9.5V2M2 9.5h4.5V14M9.5 6.5 15 1M6.5 9.5 1 15"/></svg>',
  plus: '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M3 8h10M8 3v10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" };
const images = new Map<string, Promise<string>>();

function localImage(path: string): Promise<string> {
  let p = images.get(path);
  if (!p) {
    p = ipc.fileBytes(path).then((bytes) => {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[ext] ?? "application/octet-stream" }));
    });
    p.catch(() => images.delete(path));
    images.set(path, p);
  }
  return p;
}

/** Carrega o editor só quando alguém for editar. */
let editorModule: Promise<typeof import("./editor")> | null = null;
const loadEditor = () => (editorModule ??= import("./editor"));

class Doc {
  readonly el = h("div", "doc");
  readonly toc = h("nav", "doc-toc");
  readonly edHost = h("div", "doc-ed");
  readonly pv = h("div", "doc-pv");
  readonly article = h("article", "md");
  readonly tab = h("button", "dtab");
  editor: DocEditor | null = null;
  mode: Mode = "read";
  saved: string;
  /** Mudou no disco enquanto havia alterações não salvas. */
  conflict = false;
  missing = false;
  private renderTimer: number | undefined;
  private syncing = false;

  constructor(
    public path: string,
    public text: string,
    public mtime: number,
    private panel: DocsPanel,
  ) {
    this.saved = text;
    this.pv.append(this.article);
    this.el.append(this.toc, this.edHost, this.pv);
    this.tab.title = path;
    this.tab.addEventListener("click", (e) => {
      if ((e.target as Element).closest(".dtab-x")) panel.closeDoc(this);
      else panel.activate(this);
    });
    this.tab.addEventListener("auxclick", (e) => {
      if (e.button === 1) panel.closeDoc(this);
    });
    this.article.addEventListener("click", (e) => this.onClick(e));
    this.article.addEventListener("change", (e) => this.onTask(e));
    this.pv.addEventListener("scroll", () => this.markToc(), { passive: true });
    this.toc.addEventListener("click", (e) => {
      const id = (e.target as Element).closest<HTMLElement>("[data-h]")?.dataset.h;
      if (id) this.scrollTo(id);
    });
    this.renderTab();
    this.render();
  }

  get name(): string {
    return basename(this.path);
  }

  get dirty(): boolean {
    return this.text !== this.saved;
  }

  renderTab(): void {
    this.tab.className = `dtab${this.panel.active === this ? " on" : ""}${this.dirty ? " dirty" : ""}`;
    this.tab.innerHTML = `${I.doc}<span>${esc(this.name)}</span><i class="dtab-dot"></i><span class="dtab-x" title="${esc(t("docs.panel.closeTab"))}">${I.x}</span>`;
  }

  async setMode(mode: Mode): Promise<void> {
    this.mode = mode;
    this.el.classList.remove("m-read", "m-split", "m-edit");
    this.el.classList.add(`m-${mode}`);
    if (mode !== "read" && !this.editor) {
      const { createEditor } = await loadEditor();
      if (this.editor) return;
      this.editor = createEditor(this.edHost, this.text, {
        change: (text) => this.onEdit(text),
        save: () => void this.save(),
        scroll: (r) => this.syncScroll(r),
      });
    }
    if (mode !== "read") requestAnimationFrame(() => this.editor?.focus());
  }

  private onEdit(text: string): void {
    const wasDirty = this.dirty;
    this.text = text;
    if (wasDirty !== this.dirty) {
      this.renderTab();
      this.panel.renderHead();
    }
    clearTimeout(this.renderTimer);
    if (this.mode === "split") this.renderTimer = window.setTimeout(() => this.render(), 220);
    else this.renderTimer = window.setTimeout(() => this.render(), 600);
  }

  private syncScroll(ratio: number): void {
    if (this.mode !== "split") return;
    this.syncing = true;
    this.pv.scrollTop = ratio * (this.pv.scrollHeight - this.pv.clientHeight);
    requestAnimationFrame(() => (this.syncing = false));
  }

  /** Atualiza a leitura sem perder diagramas já desenhados (nem o zoom deles). */
  render(): void {
    const tpl = document.createElement("template");
    try {
      tpl.innerHTML = renderMarkdown(this.text);
    } catch (e) {
      tpl.innerHTML = `<p class="md-err">${esc(t("docs.panel.renderError", { error: String(e) }))}</p>`;
    }
    const frag = tpl.content;
    enhance(frag as unknown as HTMLElement);

    const reuse = new Map<string, HTMLElement[]>();
    for (const old of this.article.querySelectorAll<HTMLElement>(".mmd.ready")) {
      const k = old.dataset.src ?? "";
      reuse.set(k, [...(reuse.get(k) ?? []), old]);
    }
    for (const fresh of frag.querySelectorAll<HTMLElement>(".mmd")) {
      const old = reuse.get(fresh.dataset.src ?? "")?.shift();
      if (old) fresh.replaceWith(old);
    }
    const base = dirname(this.path);
    for (const img of frag.querySelectorAll<HTMLImageElement>("img")) {
      const src = img.getAttribute("src") ?? "";
      if (!src || /^(https?:|data:|blob:)/i.test(src)) continue;
      img.removeAttribute("src");
      let rel = src;
      try {
        rel = decodeURI(src);
      } catch {
        /* mantém */
      }
      localImage(resolvePath(base, rel.split(/[?#]/)[0]))
        .then((url) => (img.src = url))
        .catch(() => img.classList.add("broken"));
    }
    const top = this.pv.scrollTop;
    this.article.replaceChildren(frag);
    this.pv.scrollTop = top;
    void renderDiagrams(this.article);
    this.buildToc();
  }

  private buildToc(): void {
    const heads = [...this.article.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id]")];
    const tocH = `<div class="toc-h">${esc(t("docs.panel.toc"))}</div>`;
    this.toc.innerHTML = heads.length
      ? `${tocH}${heads.map((x) => `<button data-h="${esc(x.id)}" class="l${x.tagName[1]}">${esc(x.textContent ?? "")}</button>`).join("")}`
      : `${tocH}<div class="toc-none">${esc(t("docs.panel.tocEmpty"))}</div>`;
    this.markToc();
  }

  private markToc(): void {
    if (this.syncing || !this.el.classList.contains("toc-on")) return;
    const top = this.pv.getBoundingClientRect().top + 24;
    let current: string | null = null;
    for (const x of this.article.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id]")) {
      if (x.getBoundingClientRect().top <= top) current = x.id;
      else break;
    }
    this.toc.querySelectorAll<HTMLElement>("[data-h]").forEach((b) => b.classList.toggle("on", b.dataset.h === current));
  }

  scrollTo(id: string): void {
    const target = this.article.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ?? this.article.querySelector<HTMLElement>(`[name="${CSS.escape(id)}"]`);
    if (!target) return;
    this.pv.scrollTo({ top: target.offsetTop - 12, behavior: "smooth" });
    target.classList.remove("hl");
    void target.offsetWidth;
    target.classList.add("hl");
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as Element;
    const copy = target.closest<HTMLElement>("[data-copy]");
    if (copy) {
      const code = copy.closest(".code")?.querySelector("code")?.textContent ?? "";
      navigator.clipboard.writeText(code).then(() => {
        copy.textContent = t("docs.panel.copied");
        window.setTimeout(() => (copy.textContent = t("docs.panel.copy")), 1400);
      }, () => {});
      return;
    }
    const a = target.closest<HTMLAnchorElement>("a[href]");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) return this.scrollTo(decodeURIComponent(href.slice(1)));
    if (/^(https?:|mailto:)/i.test(href)) {
      if (/^https?:/i.test(href)) ipc.openUrl(href).catch((err) => toast(String(err)));
      return;
    }
    const [file, hash] = href.split("#");
    let rel = file;
    try {
      rel = decodeURIComponent(file);
    } catch {
      /* mantém */
    }
    const path = resolvePath(dirname(this.path), rel);
    if (MD_EXT.test(path)) void this.panel.open(path, hash ? decodeURIComponent(hash) : undefined);
    else ipc.fileReveal(path).catch(() => toast(t("docs.panel.fileNotFound")));
  }

  private onTask(e: Event): void {
    const box = e.target as HTMLInputElement;
    if (box.dataset.task === undefined) return;
    const next = toggleTask(this.text, Number(box.dataset.task), box.checked);
    if (next === this.text) return;
    this.text = next;
    this.editor?.setText(next);
    // Marcar uma tarefa lendo o documento já grava, como no GitHub.
    void this.save(true);
  }

  async save(quiet = false): Promise<void> {
    const text = this.text;
    try {
      this.mtime = await ipc.fileWrite(this.path, text);
      this.saved = text;
      this.conflict = false;
      this.missing = false;
      this.renderTab();
      this.panel.renderHead();
      if (!quiet) toast(t("docs.panel.saved", { name: this.name }));
    } catch (e) {
      toast(t("docs.panel.saveError", { error: String(e) }));
    }
  }

  /** Relê do disco, descartando alterações locais. */
  async reload(): Promise<void> {
    try {
      const f = await ipc.fileRead(this.path);
      this.apply(f.content, f.mtime);
    } catch (e) {
      toast(String(e));
    }
  }

  private apply(content: string, mtime: number): void {
    this.mtime = mtime;
    this.conflict = false;
    this.missing = false;
    if (content !== this.text) {
      this.text = this.saved = content;
      this.editor?.setText(content);
      this.render();
    } else this.saved = content;
    this.renderTab();
    this.panel.renderHead();
  }

  /** Confere se o arquivo mudou por fora (o agente pode estar escrevendo nele). */
  async poll(): Promise<void> {
    const m = await ipc.fileMtime(this.path).catch(() => null);
    if (m === null) {
      if (!this.missing) {
        this.missing = true;
        this.panel.renderHead();
      }
      return;
    }
    if (this.missing) {
      this.missing = false;
      this.panel.renderHead();
    }
    if (m === this.mtime || this.conflict) return;
    if (this.dirty) {
      this.conflict = true;
      this.panel.renderHead();
      return;
    }
    const f = await ipc.fileRead(this.path).catch(() => null);
    if (f) {
      this.apply(f.content, f.mtime);
      this.pv.classList.remove("pulse");
      void this.pv.offsetWidth;
      this.pv.classList.add("pulse");
    }
  }

  destroy(): void {
    clearTimeout(this.renderTimer);
    this.editor?.destroy();
    this.el.remove();
    this.tab.remove();
  }
}

/** Ferramenta fixa no painel (ex.: Git), com aba própria antes dos documentos. */
export interface DockTool {
  readonly tab: HTMLElement;
  readonly el: HTMLElement;
  headHtml(): string;
  onHead(e: MouseEvent): void;
  shown(): void;
  hidden(): void;
  onKey(e: KeyboardEvent): boolean;
}

export class DocsPanel {
  readonly el = h("aside", "docs");
  docs: Doc[] = [];
  active: Doc | null = null;
  private tool: DockTool | null = null;
  private toolOn = false;
  private tabs = h("div", "dtabs");
  private head = h("div", "docs-acts");
  private info = h("div", "docs-info");
  private bar = h("div", "docs-bar");
  private stack = h("div", "docs-stack");
  private width = 0;
  private maximized = false;

  constructor(private content: HTMLElement) {
    const grip = h("div", "docs-grip");
    const top = h("div", "docs-h");
    const add = h("button", "dtab-add", I.plus);
    add.title = t("docs.panel.openFile");
    add.onclick = () => void this.pick();
    const tabsWrap = h("div", "dtabs-wrap");
    tabsWrap.append(this.tabs, add);
    top.append(tabsWrap, this.head);
    this.el.append(grip, top, this.info, this.bar, this.stack);
    this.el.hidden = true;

    grip.addEventListener("pointerdown", (e) => this.startResize(e));
    grip.addEventListener("dblclick", () => this.setWidth(this.el.parentElement!.clientWidth * 0.46));
    this.head.addEventListener("click", (e) => this.onAction(e));
    this.bar.addEventListener("click", (e) => this.onBar(e));
    this.tabs.addEventListener("wheel", (e) => {
      if (e.deltaY) this.tabs.scrollLeft += e.deltaY;
    }, { passive: true });
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    window.setInterval(() => {
      if (!this.el.hidden) for (const d of this.docs) void d.poll();
    }, POLL_MS);
    this.restore();
  }

  /** Abre (ou foca) um documento. `hash` rola até um título. */
  async open(path: string, hash?: string, quiet = false): Promise<void> {
    const key = path.toLowerCase();
    let doc = this.docs.find((d) => d.path.toLowerCase() === key);
    if (!doc) {
      try {
        const f = await ipc.fileRead(path);
        doc = this.docs.find((d) => d.path.toLowerCase() === f.path.toLowerCase());
        if (!doc) {
          doc = new Doc(f.path, f.content, f.mtime, this);
          this.docs.push(doc);
          this.tabs.append(doc.tab);
          this.stack.append(doc.el);
          void doc.setMode("read");
        }
      } catch (e) {
        if (!quiet) toast(String(e));
        return;
      }
    }
    this.show();
    this.activate(doc);
    if (hash) requestAnimationFrame(() => doc.scrollTo(hash));
  }

  /** Liga uma ferramenta (Git) ao painel. */
  attachTool(tool: DockTool): void {
    this.tool = tool;
    this.tabs.prepend(tool.tab);
    tool.el.hidden = true;
    this.stack.append(tool.el);
    tool.tab.addEventListener("click", () => this.showTool());
  }

  get toolVisible(): boolean {
    return this.toolOn && !this.el.hidden;
  }

  showTool(): void {
    if (!this.tool) return;
    this.show();
    this.toolOn = true;
    for (const d of this.docs) {
      d.el.hidden = true;
      d.renderTab();
    }
    this.tool.el.hidden = false;
    this.tool.shown();
    this.renderHead();
    this.persist();
  }

  private hideTool(): void {
    if (!this.toolOn || !this.tool) return;
    this.toolOn = false;
    this.tool.el.hidden = true;
    this.tool.hidden();
  }

  /** Atalho: abre o Git, ou fecha o painel se o Git já está à vista. */
  toggleTool(): void {
    if (this.toolVisible) {
      this.hideTool();
      if (this.active) this.activate(this.active);
      else this.hide();
    } else this.showTool();
  }

  activate(doc: Doc): void {
    this.hideTool();
    this.active = doc;
    for (const d of this.docs) {
      d.el.hidden = d !== doc;
      d.renderTab();
    }
    doc.tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.renderHead();
    this.persist();
  }

  async closeDoc(doc: Doc): Promise<void> {
    if (doc.dirty && !(await this.confirmDiscard([doc]))) return;
    const i = this.docs.indexOf(doc);
    this.docs.splice(i, 1);
    doc.destroy();
    if (this.active === doc) {
      const next = this.docs[Math.min(i, this.docs.length - 1)];
      if (next) this.activate(next);
      else {
        this.active = null;
        if (this.tool) this.showTool();
        else this.hide();
      }
    }
    this.persist();
  }

  renderHead(): void {
    const common = `<button class="ibtn" data-a="max" title="${esc(t(this.maximized ? "docs.panel.restore" : "docs.panel.expand"))}">${this.maximized ? I.min : I.max}</button>
      <button class="ibtn" data-a="close" title="${esc(t("docs.panel.closePanel"))}">${I.x}</button>`;
    if (this.toolOn && this.tool) {
      this.head.innerHTML = this.tool.headHtml() + common;
      this.info.hidden = true;
      this.bar.hidden = true;
      return;
    }
    this.info.hidden = false;
    const d = this.active;
    if (!d) return;
    const mode = (m: Mode, label: string, key: string) => `<button data-mode="${m}" class="${d.mode === m ? "on" : ""}" title="${esc(label)} (${key})">${esc(label)}</button>`;
    const tocOn = d.el.classList.contains("toc-on");
    this.head.innerHTML = `<div class="seg dmode">${mode("read", t("docs.panel.modeRead"), "Ctrl+1")}${mode("split", t("docs.panel.modeSplit"), "Ctrl+2")}${mode("edit", t("docs.panel.modeEdit"), "Ctrl+3")}</div>
      <button class="ibtn${tocOn ? " on" : ""}" data-a="toc" title="${esc(t("docs.panel.toc"))}">${I.toc}</button>
      <button class="ibtn${d.dirty ? " hot" : ""}" data-a="save" title="${esc(t("docs.panel.save"))}" ${d.dirty ? "" : "disabled"}>${I.save}</button>
      <button class="ibtn" data-a="more" data-pop title="${esc(t("docs.panel.more"))}">${I.more}</button>
      ${common}`;
    this.info.innerHTML = `<span class="docs-path" title="${esc(d.path)}">${esc(d.path)}</span><span class="docs-state${d.dirty ? " dirty" : ""}">${esc(t(d.dirty ? "docs.panel.stateUnsaved" : "docs.panel.stateSaved"))}</span>`;
    if (d.missing) this.showBar(t("docs.panel.missing"), `<button data-b="save">${esc(t("docs.panel.saveAgain"))}</button><button data-b="close">${esc(t("docs.panel.closeTabButton"))}</button>`);
    else if (d.conflict) this.showBar(t("docs.panel.conflict"), `<button data-b="reload">${esc(t("docs.panel.useDisk"))}</button><button data-b="keep">${esc(t("docs.panel.keepMine"))}</button>`);
    else this.bar.hidden = true;
  }

  private showBar(text: string, buttons: string): void {
    this.bar.innerHTML = `<span>${esc(text)}</span>${buttons}`;
    this.bar.hidden = false;
  }

  private onBar(e: MouseEvent): void {
    const b = (e.target as Element).closest<HTMLElement>("[data-b]")?.dataset.b;
    const d = this.active;
    if (!b || !d) return;
    if (b === "reload") void d.reload();
    else if (b === "save") void d.save();
    else if (b === "close") void this.closeDoc(d);
    else if (b === "keep") {
      // A próxima gravação sobrescreve a versão do disco.
      void ipc.fileMtime(d.path).then((m) => {
        if (m !== null) d.mtime = m;
        d.conflict = false;
        this.renderHead();
      });
    }
  }

  private onAction(e: MouseEvent): void {
    const target = e.target as Element;
    const common = target.closest<HTMLElement>("[data-a]")?.dataset.a;
    if (common === "max") return this.setMax(!this.maximized);
    if (common === "close") return void this.closeAll();
    if (this.toolOn && this.tool) return this.tool.onHead(e);
    const d = this.active;
    if (!d) return;
    const mode = target.closest<HTMLElement>("[data-mode]")?.dataset.mode as Mode | undefined;
    if (mode) {
      void d.setMode(mode).then(() => this.renderHead());
      this.renderHead();
      return;
    }
    const btn = target.closest<HTMLElement>("[data-a]");
    switch (btn?.dataset.a) {
      case "toc":
        d.el.classList.toggle("toc-on");
        this.renderHead();
        break;
      case "save":
        void d.save();
        break;
      case "more":
        this.openMore(btn);
        break;
      case "max":
        this.setMax(!this.maximized);
        break;
      case "close":
        void this.closeAll();
        break;
    }
  }

  private openMore(anchor: HTMLElement): void {
    const d = this.active;
    if (!d) return;
    popover(
      "docs-more",
      anchor,
      (el) => {
        el.innerHTML = `<button data-m="reload">${esc(t("docs.panel.reload"))}</button><button data-m="reveal">${esc(t("docs.panel.reveal"))}</button><button data-m="copy">${esc(t("docs.panel.copyPath"))}</button><hr><button data-m="open">${esc(t("docs.panel.openOther"))}</button>`;
        el.onclick = (e) => {
          const m = (e.target as Element).closest<HTMLElement>("[data-m]")?.dataset.m;
          if (!m) return;
          closePopover();
          if (m === "reload") void (d.dirty ? this.confirmDiscard([d]).then((ok) => (ok ? d.reload() : undefined)) : d.reload());
          if (m === "reveal") ipc.fileReveal(d.path).catch((err) => toast(String(err)));
          if (m === "copy") navigator.clipboard.writeText(d.path).then(() => toast(t("docs.panel.pathCopied")), () => {});
          if (m === "open") void this.pick();
        };
      },
      "menu",
    );
  }

  private async pick(): Promise<void> {
    const dir = this.active ? dirname(this.active.path) : (store.session(store.active)?.cwd ?? undefined);
    const picked = await openDialog({ multiple: true, defaultPath: dir, filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }] }).catch(() => null);
    const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
    for (const p of list) await this.open(p);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.toolOn && this.tool) {
      if (this.tool.onKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const d = this.active;
    if (!d || !e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const modes: Record<string, Mode> = { "1": "read", "2": "split", "3": "edit" };
    if (k === "s") void d.save();
    else if (k === "w") void this.closeDoc(d);
    else if (modes[k] && !e.shiftKey) void d.setMode(modes[k]).then(() => this.renderHead());
    else if (k === "tab" && this.docs.length > 1) this.activate(this.docs[(this.docs.indexOf(d) + (e.shiftKey ? this.docs.length - 1 : 1)) % this.docs.length]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private show(): void {
    if (!this.el.hidden) return;
    this.el.hidden = false;
    if (!this.width) this.width = Math.round((this.el.parentElement?.clientWidth ?? 1200) * 0.46);
    this.setWidth(this.width);
    this.el.classList.remove("enter");
    void this.el.offsetWidth;
    this.el.classList.add("enter");
    this.persist();
  }

  private hide(): void {
    this.hideTool();
    this.setMax(false);
    this.el.hidden = true;
    this.persist();
  }

  private async closeAll(): Promise<void> {
    const dirty = this.docs.filter((d) => d.dirty);
    if (dirty.length && !(await this.confirmDiscard(dirty))) return;
    for (const d of this.docs) d.destroy();
    this.docs = [];
    this.active = null;
    this.hide();
  }

  private setMax(on: boolean): void {
    this.maximized = on;
    this.el.classList.toggle("max", on);
    this.content.hidden = on;
    this.renderHead();
  }

  private setWidth(w: number): void {
    const total = this.el.parentElement?.clientWidth ?? 1200;
    this.width = Math.round(Math.max(MIN_W, Math.min(w, total - 380)));
    this.el.style.width = `${this.width}px`;
  }

  private startResize(e: PointerEvent): void {
    if (this.maximized) return;
    e.preventDefault();
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    const right = this.el.getBoundingClientRect().right;
    document.body.classList.add("resizing-docs");
    const move = (ev: PointerEvent) => this.setWidth(right - ev.clientX);
    const up = () => {
      document.body.classList.remove("resizing-docs");
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      this.persist();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  }

  /** Pergunta antes de descartar alterações. Resolve true para continuar. */
  private confirmDiscard(docs: Doc[]): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = h("div", "modal");
      const names = docs.map((d) => `<li>${I.doc}<span>${esc(d.name)}</span></li>`).join("");
      modal.innerHTML = `<div class="mbox guard"><h2>${esc(t("docs.discard.title"))}</h2><div class="sub">${esc(tn("docs.discard.sub", docs.length))}</div><ul class="busy">${names}</ul>
        <div class="mfoot"><span class="hk"></span><button class="ghost" data-c="cancel">${esc(t("docs.discard.cancel"))}</button><button class="ghost" data-c="discard">${esc(t("docs.discard.discard"))}</button><button class="primary" data-c="save">${esc(t("docs.discard.save"))}</button></div></div>`;
      const done = (ok: boolean) => {
        modal.remove();
        resolve(ok);
      };
      modal.addEventListener("click", async (e) => {
        const c = (e.target as Element).closest<HTMLElement>("[data-c]")?.dataset.c;
        if (e.target === modal || c === "cancel") done(false);
        else if (c === "discard") done(true);
        else if (c === "save") {
          for (const d of docs) await d.save(true);
          done(docs.every((d) => !d.dirty));
        }
      });
      modal.addEventListener("keydown", (e) => {
        if (e.key === "Escape") done(false);
      });
      document.body.append(modal);
      modal.querySelector<HTMLButtonElement>('[data-c="save"]')!.focus();
    });
  }

  /** Lembra abas, aba ativa e largura por janela (reabre após recarregar). */
  private persist(): void {
    try {
      localStorage.setItem(KEY(), JSON.stringify({ open: !this.el.hidden, git: this.toolOn, paths: this.docs.map((d) => d.path), active: this.active?.path ?? null, width: this.width }));
    } catch {
      /* sem armazenamento */
    }
  }

  private restore(): void {
    let saved: { open?: boolean; git?: boolean; paths?: string[]; active?: string | null; width?: number } = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY()) ?? "{}");
    } catch {
      return;
    }
    if (saved.width) this.width = saved.width;
    if (!saved.open || !saved.paths?.length) return;
    void (async () => {
      for (const p of saved.paths!) await this.open(p, undefined, true);
      const act = this.docs.find((d) => d.path === saved.active);
      if (saved.git && this.tool) this.showTool();
      else if (act) this.activate(act);
    })();
  }
}
