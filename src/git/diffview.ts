// Visualização de um diff: unificado ou lado a lado, com destaque de sintaxe,
// seleção de linhas pela margem e botões por trecho.
import hljs from "highlight.js/lib/common";
import { t, tn } from "../i18n";
import { esc, h } from "../ui/dom";
import { lineKey, type DiffLine, type FileDiff } from "./diff";

export type DiffMode = "unified" | "split";

export interface HunkAction {
  id: string;
  label: string;
  danger?: boolean;
}

export interface DiffViewOpts {
  /** Linhas podem ser escolhidas (incluir/tirar/descartar só algumas). */
  selectable: boolean;
  hunkActions: HunkAction[];
  onHunk(action: string, hunk: number): void;
  onSelection(sel: Set<string>): void;
  /** Duplo clique numa linha (abrir no editor). */
  onOpenLine?(line: number): void;
}

const MAX_LINES = 3000;
const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  rs: "rust", py: "python", rb: "ruby", go: "go", java: "java", kt: "kotlin", cs: "csharp", cpp: "cpp", cc: "cpp", h: "cpp", hpp: "cpp", c: "c",
  css: "css", scss: "scss", less: "less", html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml", json: "json", jsonc: "json",
  md: "markdown", mdx: "markdown", yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", sh: "bash", bash: "bash", ps1: "powershell", psm1: "powershell",
  sql: "sql", php: "php", swift: "swift", lua: "lua", r: "r", dockerfile: "dockerfile", makefile: "makefile", nsh: "ini",
};

export function langOf(path: string): string | null {
  const base = path.split(/[\\/]/).pop()!.toLowerCase();
  const ext = base.includes(".") ? base.split(".").pop()! : base;
  const lang = EXT_LANG[ext] ?? ext;
  return hljs.getLanguage(lang) ? lang : null;
}

function paint(raw: string, lang: string | null): string {
  const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  if (!lang || text.length > 2000) return esc(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return esc(text);
  }
}

export class DiffView {
  readonly el = h("div", "gd");
  mode: DiffMode = "unified";
  selection = new Set<string>();
  private file: FileDiff | null = null;
  private lang: string | null = null;
  private forced = false;
  private anchor: { h: number; i: number } | null = null;

  constructor(private opts: DiffViewOpts) {
    this.el.addEventListener("click", (e) => this.onClick(e));
    this.el.addEventListener("dblclick", (e) => {
      const n = (e.target as Element).closest<HTMLElement>("[data-n]")?.dataset.n;
      if (n && this.opts.onOpenLine) this.opts.onOpenLine(Number(n));
    });
  }

  set(file: FileDiff | null, path: string, keepSelection = false): void {
    this.file = file;
    this.lang = langOf(path);
    if (!keepSelection) this.selection.clear();
    this.forced = false;
    this.render();
  }

  setMode(mode: DiffMode): void {
    this.mode = mode;
    this.render();
  }

  clearSelection(): void {
    this.selection.clear();
    this.anchor = null;
    this.render();
    this.opts.onSelection(this.selection);
  }

  render(): void {
    const f = this.file;
    if (!f) {
      this.el.innerHTML = "";
      return;
    }
    if (f.binary) {
      this.el.innerHTML = `<div class="gd-note">${esc(t("git.diff.binary"))}</div>`;
      return;
    }
    if (!f.hunks.length) {
      this.el.innerHTML = `<div class="gd-note">${esc(t("git.diff.empty"))}</div>`;
      return;
    }
    const total = f.hunks.reduce((n, x) => n + x.lines.length, 0);
    if (total > MAX_LINES && !this.forced) {
      this.el.innerHTML = `<div class="gd-note">${esc(t("git.diff.tooBig", { n: total }))}<button class="gbtn" data-force>${esc(t("git.diff.showAnyway"))}</button></div>`;
      return;
    }
    const sel = this.opts.selectable;
    const acts = this.opts.hunkActions;
    const html: string[] = [`<div class="gd-body ${this.mode}${sel ? " sel" : ""}">`];
    f.hunks.forEach((hk, hi) => {
      const buttons = acts.map((a) => `<button class="gd-ha${a.danger ? " danger" : ""}" data-ha="${a.id}" data-h="${hi}">${esc(a.label)}</button>`).join("");
      html.push(`<div class="gd-hunk"><span class="gd-hh">@@ -${hk.oldStart},${hk.oldLines} +${hk.newStart},${hk.newLines} @@ <em>${esc(hk.section)}</em></span><span class="gd-has">${buttons}</span></div>`);
      if (this.mode === "unified") {
        hk.lines.forEach((l, li) => html.push(this.row(l, hi, li)));
      } else {
        html.push(...this.splitRows(hk.lines, hi));
      }
    });
    html.push("</div>");
    this.el.innerHTML = html.join("");
  }

  private cls(l: DiffLine, hi: number, li: number): string {
    const k = l.kind === "+" ? "a" : l.kind === "-" ? "d" : "c";
    const on = l.kind !== " " && this.selection.has(lineKey(hi, li));
    return `gl ${k}${on ? " on" : ""}`;
  }

  private row(l: DiffLine, hi: number, li: number): string {
    const pick = l.kind !== " " ? ` data-k="${hi}:${li}"` : "";
    const n = l.new ?? l.old;
    return `<div class="${this.cls(l, hi, li)}"${pick} data-n="${n ?? ""}"><span class="gn">${l.old ?? ""}</span><span class="gn">${l.new ?? ""}</span><span class="gm">${l.kind === " " ? "" : l.kind}</span><span class="gt">${paint(l.text, this.lang) || " "}${l.noEol ? '<i class="gd-eol">⏎̸</i>' : ""}</span></div>`;
  }

  private half(l: DiffLine | undefined, hi: number, li: number): string {
    if (!l) return `<div class="gh gh-blank"></div>`;
    const pick = l.kind !== " " ? ` data-k="${hi}:${li}"` : "";
    const n = l.kind === "-" ? l.old : l.new;
    return `<div class="gh ${this.cls(l, hi, li)}"${pick} data-n="${(l.new ?? l.old) ?? ""}"><span class="gn">${n ?? ""}</span><span class="gt">${paint(l.text, this.lang) || " "}</span></div>`;
  }

  private splitRows(lines: DiffLine[], hi: number): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (l.kind === " ") {
        out.push(`<div class="gs">${this.half(l, hi, i)}${this.half(l, hi, i)}</div>`);
        i++;
        continue;
      }
      const dels: number[] = [];
      const adds: number[] = [];
      while (i < lines.length && lines[i].kind === "-") dels.push(i++);
      while (i < lines.length && lines[i].kind === "+") adds.push(i++);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        const d = dels[k];
        const a = adds[k];
        out.push(`<div class="gs">${this.half(d === undefined ? undefined : lines[d], hi, d ?? -1)}${this.half(a === undefined ? undefined : lines[a], hi, a ?? -1)}</div>`);
      }
    }
    return out;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as Element;
    if (target.closest("[data-force]")) {
      this.forced = true;
      return this.render();
    }
    const ha = target.closest<HTMLElement>("[data-ha]");
    if (ha) return this.opts.onHunk(ha.dataset.ha!, Number(ha.dataset.h));
    if (!this.opts.selectable || this.el.classList.contains("nosel")) return;
    // Só a margem (números e sinal) escolhe linhas; o texto continua selecionável.
    if (!target.closest(".gn,.gm")) return;
    const row = target.closest<HTMLElement>("[data-k]");
    if (!row) return;
    const [hi, li] = row.dataset.k!.split(":").map(Number);
    const file = this.file!;
    if (e.shiftKey && this.anchor && this.anchor.h === hi) {
      const [a, b] = [Math.min(this.anchor.i, li), Math.max(this.anchor.i, li)];
      for (let i = a; i <= b; i++) if (file.hunks[hi].lines[i].kind !== " ") this.selection.add(lineKey(hi, i));
    } else {
      const k = lineKey(hi, li);
      if (this.selection.has(k)) this.selection.delete(k);
      else this.selection.add(k);
      this.anchor = { h: hi, i: li };
    }
    this.render();
    this.opts.onSelection(this.selection);
  }
}

/** Texto da barra de seleção ("3 linhas selecionadas"). */
export const selectionLabel = (n: number) => tn("git.diff.selected", n);
