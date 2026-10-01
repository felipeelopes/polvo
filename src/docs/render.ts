// Markdown → HTML seguro: GFM, destaque de código, fórmulas (KaTeX), alertas
// do GitHub, notas de rodapé e blocos mermaid (desenhados depois, em `mermaid.ts`).
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import "katex/dist/katex.min.css";
import { Marked, type Tokens } from "marked";
import markedAlert from "marked-alert";
import markedFootnote from "marked-footnote";
import { gfmHeadingId } from "marked-gfm-heading-id";
import { markedHighlight } from "marked-highlight";
import markedKatex from "marked-katex-extension";
import { esc } from "../ui/dom";

const ALERT_TITLES: Record<string, string> = { note: "Nota", tip: "Dica", important: "Importante", warning: "Atenção", caution: "Cuidado" };

const LANG_ALIAS: Record<string, string> = { sh: "bash", shell: "bash", ps1: "powershell", ps: "powershell", yml: "yaml", js: "javascript", ts: "typescript", rs: "rust", py: "python", cs: "csharp", "c#": "csharp" };

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      if (lang === "mermaid") return code;
      const l = LANG_ALIAS[lang.toLowerCase()] ?? lang.toLowerCase();
      try {
        return hljs.getLanguage(l) ? hljs.highlight(code, { language: l }).value : hljs.highlightAuto(code).value;
      } catch {
        return code;
      }
    },
  }),
  markedKatex({ throwOnError: false, output: "htmlAndMathml" }),
  markedAlert(),
  markedFootnote({ description: "Notas" }),
  gfmHeadingId(),
  {
    gfm: true,
    renderer: {
      code(token: Tokens.Code) {
        const lang = (token.lang ?? "").match(/\S*/)?.[0] ?? "";
        if (lang.toLowerCase() === "mermaid") // Codificado: o DOMPurify remove atributos com `-->` (as setas do mermaid).
          return `<div class="mmd" data-src="${encodeURIComponent(token.text)}"></div>`;
        const body = token.escaped ? token.text : esc(token.text);
        return `<div class="code"><div class="code-h"><span>${esc(lang || "texto")}</span><button data-copy title="Copiar">Copiar</button></div><pre><code class="hljs${lang ? ` language-${esc(lang)}` : ""}">${body.replace(/\n$/, "")}</code></pre></div>`;
      },
    },
  },
);

/** Separa o front matter (YAML entre `---`) do corpo. */
function splitFrontMatter(src: string): { meta: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  return m ? { meta: m[1], body: src.slice(m[0].length) } : { meta: null, body: src };
}

export function renderMarkdown(src: string): string {
  const { meta, body } = splitFrontMatter(src);
  const html = marked.parse(body, { async: false });
  const front = meta ? `<details class="fm"><summary>Metadados</summary><pre>${esc(meta)}</pre></details>` : "";
  return DOMPurify.sanitize(front + html, {
    ADD_TAGS: ["semantics", "annotation", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac", "msqrt", "mroot", "mtext", "mspace", "mtable", "mtr", "mtd", "munder", "mover", "munderover", "mstyle", "mpadded", "mphantom", "menclose"],
    ADD_ATTR: ["encoding", "mathvariant", "displaystyle", "scriptlevel", "data-copy", "target"],
  });
}

/** Ajustes depois de inserir o HTML: títulos de alertas em português e caixas de tarefa clicáveis. */
export function enhance(root: HTMLElement): void {
  for (const t of root.querySelectorAll<HTMLElement>(".markdown-alert-title")) {
    const type = [...(t.parentElement?.classList ?? [])].find((c) => c.startsWith("markdown-alert-"))?.slice(15);
    const label = type && ALERT_TITLES[type];
    const text = [...t.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    if (label && text) text.textContent = label;
  }
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((c, i) => {
    c.disabled = false;
    c.dataset.task = String(i);
    c.closest("li")?.classList.add("task");
  });
}

/** Marca/desmarca a n-ésima tarefa (`- [ ]`) no texto, ignorando blocos de código. */
export function toggleTask(src: string, n: number, done: boolean): string {
  const lines = src.split("\n");
  let fence: string | null = null;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const f = /^\s*(```|~~~)/.exec(lines[i]);
    if (f) fence = fence === null ? f[1] : fence === f[1] ? null : fence;
    if (fence !== null) continue;
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(lines[i]);
    if (!m) continue;
    if (count++ === n) {
      lines[i] = m[1] + (done ? "x" : " ") + m[3] + lines[i].slice(m[0].length);
      break;
    }
  }
  return lines.join("\n");
}
