import "./styles/base.css";
import "./styles/chrome.css";
import "./styles/tiles.css";
import "./styles/board.css";
import "./styles/dialogs.css";
import "./styles/logo.css";

import { App } from "./app";
import { ipc } from "./core/ipc";
import { store } from "./core/store";
import { openNewSession } from "./ui/new-session";
import { openOnboarding } from "./ui/onboarding";
import { startUpdateChecks } from "./ui/updater";
import { refreshUsage } from "./ui/usage";

async function boot(): Promise<void> {
  const [settings, tools, display, snapshot, windows] = await Promise.all([
    ipc.settingsGet(),
    ipc.toolsAvailable(),
    ipc.displayInfo(),
    ipc.snapshot(store.label),
    ipc.windowsList(),
  ]);
  store.windows = windows;
  store.settings = settings;
  store.tools = tools;
  store.display = display;
  store.sessions = snapshot.sessions;
  store.tree = snapshot.layout;
  store.view = snapshot.view;
  store.recentDirs = snapshot.recentDirs;
  document.body.classList.toggle("no-mica", !display.mica);

  // Em desenvolvimento, `__polvo.store` fica acessível no DevTools para depuração.
  const root = document.getElementById("app")!;
  const app = new App(root);
  if (import.meta.env.DEV) Object.assign(window, { __polvo: { store, app } });
  await app.start();

  void refreshUsage();
  window.setInterval(() => void refreshUsage(), 60_000);

  if (store.isMain) {
    startUpdateChecks();
    if (!settings.onboarded) {
      openOnboarding(() => {
        if (!store.sessions.length) openNewSession(() => {});
      });
    }
  }
}

boot().catch((err) => {
  document.body.innerHTML = `<pre style="color:#f88;padding:24px;white-space:pre-wrap">Falha ao iniciar o Polvo:\n${String(err)}</pre>`;
});
