//! Textos do backend que chegam ao usuário (mensagens de erro, menu do
//! Explorer). Os catálogos ficam em `src-tauri/i18n/<idioma>.json`, com chaves
//! planas (`"projects.invalidName"`). O português é a origem; o que faltar num
//! idioma cai no inglês e depois no português.

use std::collections::HashMap;
use std::sync::OnceLock;

use parking_lot::RwLock;

const CATALOGS: [(&str, &str); 10] = [
    ("pt", include_str!("../i18n/pt.json")),
    ("en", include_str!("../i18n/en.json")),
    ("es", include_str!("../i18n/es.json")),
    ("fr", include_str!("../i18n/fr.json")),
    ("de", include_str!("../i18n/de.json")),
    ("it", include_str!("../i18n/it.json")),
    ("ja", include_str!("../i18n/ja.json")),
    ("zh", include_str!("../i18n/zh.json")),
    ("ko", include_str!("../i18n/ko.json")),
    ("ru", include_str!("../i18n/ru.json")),
];

type Tables = HashMap<&'static str, HashMap<String, String>>;

fn tables() -> &'static Tables {
    static T: OnceLock<Tables> = OnceLock::new();
    T.get_or_init(|| {
        CATALOGS
            .iter()
            .map(|(lang, json)| (*lang, serde_json::from_str(json).unwrap_or_default()))
            .collect()
    })
}

fn current() -> &'static RwLock<&'static str> {
    static L: OnceLock<RwLock<&'static str>> = OnceLock::new();
    L.get_or_init(|| RwLock::new("en"))
}

/// Idioma pela preferência ("auto" segue o idioma do Windows).
pub fn resolve(pref: &str) -> &'static str {
    let wanted = if pref.is_empty() || pref == "auto" {
        sys_locale::get_locale().unwrap_or_default()
    } else {
        pref.to_string()
    };
    let base = wanted
        .to_lowercase()
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_string();
    CATALOGS
        .iter()
        .map(|(l, _)| *l)
        .find(|l| *l == base)
        .unwrap_or("en")
}

pub fn set_language(pref: &str) {
    *current().write() = resolve(pref);
}

pub fn language() -> &'static str {
    *current().read()
}

/// Texto traduzido; `{nome}` é trocado pelo valor correspondente em `vars`.
pub fn tr(key: &str, vars: &[(&str, &str)]) -> String {
    let t = tables();
    let raw = [language(), "en", "pt"]
        .iter()
        .find_map(|l| t.get(l).and_then(|m| m.get(key)))
        .cloned()
        .unwrap_or_else(|| key.to_string());
    vars.iter()
        .fold(raw, |s, (k, v)| s.replace(&format!("{{{k}}}"), v))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogs_parse_and_cover_portuguese() {
        let t = tables();
        let pt = &t["pt"];
        for (lang, _) in CATALOGS {
            let m = &t[lang];
            for key in pt.keys() {
                assert!(m.contains_key(key), "{lang}: falta a chave {key}");
            }
        }
    }

    #[test]
    fn resolves_languages() {
        assert_eq!(resolve("pt"), "pt");
        assert_eq!(resolve("ja"), "ja");
        assert_eq!(resolve("xx"), "en");
    }
}
