// Mantém um terminal para cada sessão desta janela e informa o status ao backend.
import { ipc } from "../core/ipc";
import { isRunning, store } from "../core/store";
import { contextFromScreen, detectStatus, previewLines } from "./detector";
import { SessionTerminal } from "./session-terminal";

export class Terminals {
  private map = new Map<string, SessionTerminal>();
  private reported = new Map<string, string>();
  /** Contexto lido da tela, para CLIs sem fonte melhor (ex.: OpenCode). */
  readonly screenContext = new Map<string, number>();

  constructor(private isAppShortcut: (e: KeyboardEvent) => boolean) {
    window.setInterval(() => this.tick(), 900);
  }

  get(id: string): SessionTerminal | undefined {
    return this.map.get(id);
  }

  /** Cria, conecta ou descarta terminais conforme as sessões desta janela. */
  sync(): void {
    const mine = new Map(store.mine.map((s) => [s.id, s]));
    for (const [id, t] of this.map) {
      if (!mine.has(id)) {
        t.dispose();
        this.map.delete(id);
        this.reported.delete(id);
      }
    }
    for (const s of mine.values()) {
      let t = this.map.get(s.id);
      if (!t) {
        t = new SessionTerminal(s.id, s.tool, this.isAppShortcut);
        this.map.set(s.id, t);
      }
      // Um novo início (retomar/reiniciar) muda `since` com status "starting".
      if (isRunning(s) && (!t.connected || (s.runtime.status === "starting" && t.connectedTo !== s.runtime.since))) {
        void t.connect(s.runtime.since);
      }
    }
  }

  private tick(): void {
    const now = performance.now();
    for (const s of store.mine) {
      const t = this.map.get(s.id);
      if (!t || !t.connected || !isRunning(s) || t.lastOutput === 0) continue;
      const screen = t.screen();
      const ctx = contextFromScreen(screen);
      if (ctx !== null) this.screenContext.set(s.id, ctx);
      const status = detectStatus(s.tool, screen, now - t.lastOutput, now - t.lastInput);
      const preview = previewLines(screen);
      const key = `${status}\n${preview.join("\n")}`;
      if (this.reported.get(s.id) === key) continue;
      this.reported.set(s.id, key);
      ipc.sessionReport(s.id, status, preview).catch(() => {});
    }
  }
}
