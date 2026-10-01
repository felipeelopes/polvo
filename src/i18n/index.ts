// Traduções da interface. O português (pt-BR) é o idioma de origem: as chaves
// e os textos-base ficam em `locales/pt.ts`; os outros idiomas seguem a mesma
// estrutura. Uso: `t("sidebar.empty")`, `t("pane.started", { tool })` e, para
// plurais, `tn("board.sessions", n)` (chaves `.one` e `.other`).
import pt from "./locales/pt";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import de from "./locales/de";
import it from "./locales/it";
import ja from "./locales/ja";
import zh from "./locales/zh";
import ko from "./locales/ko";
import ru from "./locales/ru";

export type Messages = typeof pt;

/** Idiomas suportados, com o nome na própria língua. */
export const LOCALES = {
  en: "English",
  pt: "Português (Brasil)",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  ja: "日本語",
  zh: "简体中文",
  ko: "한국어",
  ru: "Русский",
} as const;

export type Locale = keyof typeof LOCALES;

/** Tag BCP 47 de cada idioma (para `lang`, datas e números). */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en",
  pt: "pt-BR",
  es: "es",
  fr: "fr",
  de: "de",
  it: "it",
  ja: "ja",
  zh: "zh-CN",
  ko: "ko",
  ru: "ru",
};

/** Os catálogos podem ter chaves faltando: caem no inglês e depois no português. */
type Catalog = { [k: string]: string | Catalog };
const CATALOGS: Record<Locale, Catalog> = { pt, en, es, fr, de, it, ja, zh, ko, ru } as Record<Locale, Catalog>;

const flat = new Map<Locale, Map<string, string>>();

function flatten(cat: Catalog, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(cat)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else flatten(v, key, out);
  }
  return out;
}

function table(l: Locale): Map<string, string> {
  let m = flat.get(l);
  if (!m) {
    m = flatten(CATALOGS[l]);
    flat.set(l, m);
  }
  return m;
}

let current: Locale = "en";

/** Idioma pela preferência salva ("auto" segue o idioma do Windows). */
export function resolveLocale(pref: string | null | undefined): Locale {
  if (pref && pref !== "auto" && pref in LOCALES) return pref as Locale;
  for (const lang of navigator.languages ?? [navigator.language]) {
    const base = lang.toLowerCase().split("-")[0];
    if (base in LOCALES) return base as Locale;
  }
  return "en";
}

export function setLocale(l: Locale): void {
  current = l;
  document.documentElement.lang = LOCALE_TAGS[l];
}

export const locale = (): Locale => current;
export const localeTag = (): string => LOCALE_TAGS[current];

type Vars = Record<string, string | number>;

/** Texto traduzido; `{nome}` é substituído por `vars.nome`. */
export function t(key: string, vars?: Vars): string {
  const raw = table(current).get(key) ?? table("en").get(key) ?? table("pt").get(key);
  if (raw === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] chave ausente: ${key}`);
    return key;
  }
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : raw;
}

/** Plural: usa `key.one` quando n = 1 e `key.other` nos demais casos; `{n}` vira o número. */
export function tn(key: string, n: number, vars?: Vars): string {
  const form = new Intl.PluralRules(LOCALE_TAGS[current]).select(n);
  const k = form === "one" && table(current).has(`${key}.one`) ? `${key}.one` : table(current).has(`${key}.${form}`) ? `${key}.${form}` : `${key}.other`;
  return t(k, { n, ...vars });
}

/** Todas as chaves de um catálogo (usado nos testes de completude). */
export const keysOf = (l: Locale): string[] => [...table(l).keys()];
