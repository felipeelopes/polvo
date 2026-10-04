// Tema claro/escuro. Quem decide é a janela: o Rust aplica a preferência
// (Automático, Claro ou Escuro) e o WebView2 repassa em prefers-color-scheme,
// então o CSS só usa a media query. Aqui ficam o estado para o código que
// desenha cores fora do CSS (terminal, editor, diagramas) e o aviso de troca.
import { store } from "../core/store";

const media = window.matchMedia("(prefers-color-scheme: light)");
const listeners = new Set<() => void>();

/** A interface está no tema claro agora. */
export const isLight = (): boolean => media.matches;

/** Terminais no tema claro, a menos que o usuário peça terminal sempre escuro. */
export const isLightTerminal = (): boolean => isLight() && !store.settings.terminalDark;

/** Avisa quando o tema (ou a preferência do terminal) muda. Devolve a função que cancela. */
export function onThemeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  document.documentElement.classList.toggle("term-dark", !!store.settings.terminalDark);
  for (const fn of listeners) fn();
}

/** Liga os avisos: troca do tema da janela e mudança da preferência do terminal. */
export function initTheme(): void {
  let terminalDark = !!store.settings.terminalDark;
  document.documentElement.classList.toggle("term-dark", terminalDark);
  media.addEventListener("change", emit);
  store.on((topic) => {
    if (topic !== "settings" || !!store.settings.terminalDark === terminalDark) return;
    terminalDark = !!store.settings.terminalDark;
    emit();
  });
}

/** Lê um token de cor do CSS (ex.: "--term-bg") já resolvido para o tema atual. */
export const cssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
