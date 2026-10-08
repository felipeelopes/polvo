// Popover de dicas e atalhos.
import { t } from "../i18n";
import { popover } from "./feedback";

export function openHelp(anchor: HTMLElement): void {
  popover(
    "help",
    anchor,
    (el) => {
      el.innerHTML = `<h4>${t("help.title")}</h4><ul>
        <li><span>✥</span><span>${t("help.tips.drag")}</span></li>
        <li><span>▥</span><span>${t("help.tips.edge")}</span></li>
        <li><span>⇤</span><span>${t("help.tips.rail")}</span></li>
        <li><span>↔</span><span>${t("help.tips.magnet")}</span></li>
        <li><span>⇔</span><span>${t("help.tips.dblclick")}</span></li>
        <li><span>⧉</span><span>${t("help.tips.windows")}</span></li>
        <li><span>⎘</span><span>${t("help.tips.clipboard")}</span></li></ul>
        <div class="keys">
          <kbd>Ctrl Shift N</kbd><span>${t("help.keys.newSession")}</span>
          <kbd>Ctrl Shift T</kbd><span>${t("help.keys.terminal")}</span>
          <kbd>Ctrl Shift 1 / 2 / 3</kbd><span>${t("help.keys.views")}</span>
          <kbd>Ctrl Alt ←↑→↓</kbd><span>${t("help.keys.focus")}</span>
          <kbd>Ctrl Alt Shift ←↑→↓</kbd><span>${t("help.keys.swap")}</span>
          <kbd>Ctrl Shift G</kbd><span>${t("help.keys.git")}</span>
          <kbd>Ctrl Shift M</kbd><span>${t("help.keys.maximize")}</span>
          <kbd>Ctrl Shift Z</kbd><span>${t("help.keys.undo")}</span>
          <kbd>Ctrl + / Ctrl − / Ctrl 0</kbd><span>${t("help.keys.zoom")}</span>
          <kbd>Ctrl ${t("terminal.ctrlClick.click")}</kbd><span>${t("help.keys.openPath")}</span>
          <kbd>Ctrl Shift ${t("terminal.ctrlClick.click")}</kbd><span>${t("help.keys.revealPath")}</span>
          <kbd>Ctrl V</kbd><span>${t("help.keys.pasteFiles")}</span>
          <kbd>Ctrl Shift ${t("voice.space")}</kbd><span>${t("help.keys.voice")}</span>
        </div>`;
    },
    "help",
  );
}
