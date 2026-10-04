// Editor de Markdown (CodeMirror 6) com o visual do Polvo. Carregado só
// quando o usuário abre o modo de edição.
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { tags as t } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { isLight, onThemeChange } from "../ui/theme";

// Cores pelos tokens do CSS: o mesmo tema serve ao claro e ao escuro. Só a
// marcação "dark" do CodeMirror (que escolhe os padrões dele) troca com o tema.
const themeSpec = {
  "&": { height: "100%", color: "var(--text)", backgroundColor: "transparent", fontSize: "13px" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6", scrollbarWidth: "thin", scrollbarColor: "var(--thumb) transparent" },
  ".cm-content": { padding: "14px 0 40vh", caretColor: "var(--text)" },
  ".cm-line": { padding: "0 18px 0 10px" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent) !important" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--faint)", border: "none" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--muted)" },
  ".cm-activeLine": { backgroundColor: "var(--hover)" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--hover2)", border: "none", color: "var(--muted)" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent) !important", outline: "none" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warn) 30%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--warn) 55%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--raised)", color: "var(--text)", borderColor: "var(--line2)" },
  ".cm-panel input, .cm-panel button": { fontSize: "12px" },
  ".cm-tooltip": { backgroundColor: "var(--raised)", border: "1px solid var(--line2)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent)", color: "var(--text)" },
};
const darkTheme = EditorView.theme(themeSpec, { dark: true });
const lightTheme = EditorView.theme(themeSpec, { dark: false });
const themeFor = () => (isLight() ? lightTheme : darkTheme);

const highlight = HighlightStyle.define([
  { tag: t.heading1, color: "var(--text)", fontWeight: "700", fontSize: "1.25em" },
  { tag: t.heading2, color: "var(--text)", fontWeight: "700", fontSize: "1.12em" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: "var(--text)", fontWeight: "650" },
  { tag: t.strong, fontWeight: "700", color: "var(--text)" },
  { tag: t.emphasis, fontStyle: "italic", color: "var(--syn-em)" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: t.monospace, color: "var(--syn-mono)" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--syn-meta)" },
  { tag: t.quote, color: "var(--syn-quote)", fontStyle: "italic" },
  { tag: t.list, color: "var(--syn-list)" },
  { tag: [t.keyword, t.operatorKeyword], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
  { tag: t.comment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-fn)" },
  { tag: [t.typeName, t.className], color: "var(--syn-type)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--syn-prop)" },
  { tag: t.tagName, color: "var(--syn-tag)" },
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
  const themeSlot = new Compartment();
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
        themeSlot.of(themeFor()),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !silent) on.change(u.state.doc.toString());
        }),
      ],
    }),
  });
  let dark = !isLight();
  const offTheme = onThemeChange(() => {
    if (dark === !isLight()) return;
    dark = !isLight();
    view.dispatch({ effects: themeSlot.reconfigure(themeFor()) });
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
    destroy: () => {
      offTheme();
      view.destroy();
    },
  };
}
