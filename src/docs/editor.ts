// Editor de Markdown (CodeMirror 6) com o visual do Polvo. Carregado só
// quando o usuário abre o modo de edição.
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { tags as t } from "@lezer/highlight";
import { basicSetup } from "codemirror";

const theme = EditorView.theme(
  {
    "&": { height: "100%", color: "#e6e7ee", backgroundColor: "transparent", fontSize: "13px" },
    ".cm-scroller": { fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace', lineHeight: "1.6", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,.15) transparent" },
    ".cm-content": { padding: "14px 0 40vh", caretColor: "#e6e7ee" },
    ".cm-line": { padding: "0 18px 0 10px" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#e6e7ee" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "#8aa2ff40 !important" },
    ".cm-gutters": { backgroundColor: "transparent", color: "#4f546a", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#9aa0b4" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.035)" },
    ".cm-foldPlaceholder": { backgroundColor: "rgba(255,255,255,.08)", border: "none", color: "#9aa0b4" },
    ".cm-matchingBracket": { backgroundColor: "rgba(138,162,255,.25) !important", outline: "none" },
    ".cm-searchMatch": { backgroundColor: "rgba(229,163,58,.3)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(229,163,58,.55)" },
    ".cm-panels": { backgroundColor: "rgba(24,26,40,.97)", color: "#e9eaf0", borderColor: "rgba(255,255,255,.12)" },
    ".cm-panel input, .cm-panel button": { fontSize: "12px" },
    ".cm-tooltip": { backgroundColor: "rgba(24,26,40,.97)", border: "1px solid rgba(255,255,255,.16)", borderRadius: "8px" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "rgba(138,162,255,.25)" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: t.heading1, color: "#ffffff", fontWeight: "700", fontSize: "1.25em" },
  { tag: t.heading2, color: "#ffffff", fontWeight: "700", fontSize: "1.12em" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: "#ffffff", fontWeight: "650" },
  { tag: t.strong, fontWeight: "700", color: "#f2f3f8" },
  { tag: t.emphasis, fontStyle: "italic", color: "#ddb6f5" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "#9aa0b4" },
  { tag: [t.link, t.url], color: "#8aa2ff" },
  { tag: t.monospace, color: "#8ee0ec" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "#6b7086" },
  { tag: t.quote, color: "#b8bccb", fontStyle: "italic" },
  { tag: t.list, color: "#e5a33a" },
  { tag: [t.keyword, t.operatorKeyword], color: "#c792ea" },
  { tag: [t.string, t.special(t.string)], color: "#6fd4a3" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#f2c46d" },
  { tag: t.comment, color: "#6b7086", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#7c9cff" },
  { tag: [t.typeName, t.className], color: "#f2c46d" },
  { tag: [t.propertyName, t.attributeName], color: "#a5b9ff" },
  { tag: t.tagName, color: "#f07178" },
]);

export interface DocEditor {
  view: EditorView;
  getText(): string;
  /** Troca o texto mantendo o cursor (usado quando o arquivo muda por fora). */
  setText(text: string): void;
  focus(): void;
  destroy(): void;
}

export function createEditor(
  parent: HTMLElement,
  text: string,
  on: { change(text: string): void; save(): void; scroll(ratio: number): void },
): DocEditor {
  let silent = false;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab, { key: "Mod-s", preventDefault: true, run: () => (on.save(), true) }]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(highlight),
        EditorView.lineWrapping,
        theme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !silent) on.change(u.state.doc.toString());
        }),
      ],
    }),
  });
  view.scrollDOM.addEventListener("scroll", () => {
    const s = view.scrollDOM;
    const max = s.scrollHeight - s.clientHeight;
    on.scroll(max > 0 ? s.scrollTop / max : 0);
  });
  return {
    view,
    getText: () => view.state.doc.toString(),
    setText(next) {
      const head = Math.min(view.state.selection.main.head, next.length);
      silent = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, selection: { anchor: head } });
      silent = false;
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
