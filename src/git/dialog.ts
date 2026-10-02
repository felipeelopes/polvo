// Diálogo simples para as ações de git: escolhas, um campo de texto e caixas de seleção.
import { t } from "../i18n";
import { esc, h } from "../ui/dom";

export interface AskOpts {
  title: string;
  sub?: string;
  /** HTML extra (já escapado) entre o subtítulo e os campos. */
  html?: string;
  input?: { value?: string; placeholder?: string; mono?: boolean; validate?: (v: string) => string | null };
  input2?: { label: string; value?: string; placeholder?: string; mono?: boolean };
  checks?: { id: string; label: string; checked?: boolean }[];
  /** Escolhas grandes (como “Deixar” / “Levar”). Sem elas, usa Cancelar/OK. */
  choices?: { id: string; label: string; hint?: string; danger?: boolean }[];
  confirm?: { label: string; danger?: boolean };
  select?: { label: string; options: { value: string; label: string }[]; value?: string };
}

export interface AskResult {
  choice: string;
  value: string;
  value2: string;
  checks: Record<string, boolean>;
  select: string;
}

export function ask(o: AskOpts): Promise<AskResult | null> {
  return new Promise((resolve) => {
    const modal = h("div", "modal gdlg");
    const input = o.input
      ? `<input class="txt${o.input.mono ? " mono" : ""}" data-in value="${esc(o.input.value ?? "")}" placeholder="${esc(o.input.placeholder ?? "")}" spellcheck="false">`
      : "";
    const input2 = o.input2
      ? `<label class="lbl">${esc(o.input2.label)}</label><input class="txt${o.input2.mono ? " mono" : ""}" data-in2 value="${esc(o.input2.value ?? "")}" placeholder="${esc(o.input2.placeholder ?? "")}" spellcheck="false">`
      : "";
    const select = o.select
      ? `<label class="lbl">${esc(o.select.label)}</label><select class="txt" data-sel>${o.select.options.map((x) => `<option value="${esc(x.value)}"${x.value === o.select!.value ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select>`
      : "";
    const checks = (o.checks ?? []).map((c) => `<label class="gchk"><input type="checkbox" data-chk="${esc(c.id)}"${c.checked ? " checked" : ""}> ${esc(c.label)}</label>`).join("");
    const choices = o.choices
      ? `<div class="gchoices">${o.choices.map((c) => `<button class="gchoice${c.danger ? " danger" : ""}" data-c="${esc(c.id)}"><b>${esc(c.label)}</b>${c.hint ? `<small>${esc(c.hint)}</small>` : ""}</button>`).join("")}</div>`
      : "";
    const foot = o.choices
      ? `<div class="mfoot"><span class="hk"></span><button class="ghost" data-c="cancel">${esc(t("git.dialog.cancel"))}</button></div>`
      : `<div class="mfoot"><span class="hk err" data-err></span><button class="ghost" data-c="cancel">${esc(t("git.dialog.cancel"))}</button><button class="${o.confirm?.danger ? "danger" : "primary"}" data-c="ok">${esc(o.confirm?.label ?? t("git.dialog.ok"))}</button></div>`;
    modal.innerHTML = `<div class="mbox gbox"><h2>${esc(o.title)}</h2>${o.sub ? `<div class="sub">${esc(o.sub)}</div>` : ""}${o.html ?? ""}${input}${input2}${select}${checks}${choices}${foot}</div>`;
    const inEl = modal.querySelector<HTMLInputElement>("[data-in]");
    const done = (choice: string | null) => {
      if (choice === null) {
        modal.remove();
        return resolve(null);
      }
      const value = inEl?.value.trim() ?? "";
      const err = choice !== "cancel" && o.input?.validate ? o.input.validate(value) : null;
      if (err) {
        const e = modal.querySelector<HTMLElement>("[data-err]");
        if (e) e.textContent = err;
        inEl?.focus();
        return;
      }
      const res: AskResult = {
        choice,
        value,
        value2: modal.querySelector<HTMLInputElement>("[data-in2]")?.value.trim() ?? "",
        checks: Object.fromEntries([...modal.querySelectorAll<HTMLInputElement>("[data-chk]")].map((c) => [c.dataset.chk!, c.checked])),
        select: modal.querySelector<HTMLSelectElement>("[data-sel]")?.value ?? "",
      };
      modal.remove();
      resolve(choice === "cancel" ? null : res);
    };
    modal.addEventListener("click", (e) => {
      if (e.target === modal) return done(null);
      const c = (e.target as Element).closest<HTMLElement>("[data-c]")?.dataset.c;
      if (c) done(c === "cancel" ? null : c);
    });
    modal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") done(null);
      if (e.key === "Enter" && !o.choices && (e.target as Element).tagName !== "TEXTAREA") {
        e.preventDefault();
        done("ok");
      }
    });
    document.body.append(modal);
    if (inEl) {
      inEl.focus();
      inEl.select();
    } else modal.querySelector<HTMLButtonElement>(o.choices ? "[data-c]:not([data-c=cancel])" : '[data-c="ok"]')?.focus();
  });
}

/** Nome de branch válido (regras do `git check-ref-format`, simplificadas). */
export function branchError(name: string): string | null {
  if (!name || /[\s~^:?*[\\]|\.\.|@\{|\/\/|^[-/.]|[/.]$|\.lock$/.test(name)) return t("git.branch.invalidName");
  return null;
}

/** Converte um texto livre em nome de branch ("Nova tela de login" → "nova-tela-de-login"). */
export function slugBranch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/[\s~^:?*[\\]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-+/g, "-")
    .replace(/^[-/.]+|[-/.]+$/g, "");
}
