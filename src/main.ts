import "./styles/base.css";
import "./styles/chrome.css";
import "./styles/tiles.css";
import "./styles/board.css";
import "./styles/dialogs.css";
import "./styles/logo.css";
import "./styles/work.css";
import "./styles/voice.css";

import { App } from "./app";
import { events, ipc } from "./core/ipc";
import { store } from "./core/store";
import { openNewSession } from "./ui/new-session";
import { openOnboarding } from "./ui/onboarding";
import { startUpdateChecks } from "./ui/updater";
import { initZoom } from "./ui/zoom";
import { installModalFit } from "./ui/modal-fit";
import { installCloseGuard } from "./ui/close-guard";
import { refreshUsage } from "./ui/usage";
import { showWhatsNew } from "./ui/whatsnew";
import { initTheme } from "./ui/theme";
import { resolveLocale, setLocale, t } from "./i18n";

async function boot(): Promise<void> {
  const [settings, tools, display, snapshot, windows, projects] = await Promise.all([
    ipc.settingsGet(),
    ipc.toolsAvailable(),
    ipc.displayInfo(),
    ipc.snapshot(store.layoutKey),
    ipc.windowsList(),
    ipc.projectsList(),
  ]);
  store.projects = projects;
  store.windows = windows;
  store.settings = settings;
  setLocale(resolveLocale(settings.language));
  // Mudou o idioma (nesta ou em outra janela): recarrega a interface. As sessões continuam rodando.
  // As outras preferências (ex.: terminal escuro) valem na hora em todas as janelas.
  await events.onSettings((s) => {
    if (s.language !== store.settings.language) return location.reload();
    store.settings = s;
    store.emit("settings");
  });
  initTheme();
  store.tools = tools;
  store.display = display;
  store.sessions = snapshot.sessions;
  store.tree = snapshot.layout;
  store.view = snapshot.view;
  store.recentDirs = snapshot.recentDirs;
  document.body.classList.toggle("no-mica", !display.mica);
  initZoom();
  installModalFit();
  installCloseGuard();

  // Em desenvolvimento, `__polvo.store` fica acessível no DevTools para depuração.
  const root = document.getElementById("app")!;
  const app = new App(root);
  if (import.meta.env.DEV) Object.assign(window, { __polvo: { store, app } });
  await app.start();

  void refreshUsage();
  window.setInterval(() => void refreshUsage(), 60_000);

  if (store.isMain) {
    showWhatsNew(__APP_VERSION__, settings.onboarded);
    startUpdateChecks();
    if (!settings.onboarded) {
      openOnboarding(() => {
        if (!store.sessions.length) openNewSession(() => {});
      });
    }
  }
}

boot().catch((err) => {
  document.body.innerHTML = `<pre style="color:var(--bad);padding:24px;white-space:pre-wrap">${t("app.bootFailed")}\n${String(err)}</pre>`;
});
