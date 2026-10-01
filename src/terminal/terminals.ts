// Mantém um terminal para cada sessão desta janela e informa o status ao backend.
import { ipc } from "../core/ipc";
import { isRunning, store } from "../core/store";
import { cleanTitle, contextFromScreen, detectStatus, previewLines, StatusDebouncer } from "./detector";
import { SessionTerminal } from "./session-terminal";

export class Terminals {
  private map = new Map<string, SessionTerminal>();
  private reported = new Map<string, string>();
  private debouncer = new StatusDebouncer(2);
  private titleTimers = new Map<string, number>();
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
        this.debouncer.forget(id);
      }
    }
    for (const s of mine.values()) {
      let t = this.map.get(s.id);
      if (!t) {
        const id = s.id;
        t = new SessionTerminal(id, s.tool, this.isAppShortcut, (raw) => this.onTitle(id, raw));
        this.map.set(s.id, t);
      }
      // Um novo início (retomar/reiniciar) muda `since` com status "starting".
      if (isRunning(s) && (!t.connected || (s.runtime.status === "starting" && t.connectedTo !== s.runtime.since))) {
        void t.connect(s.runtime.since);
      }
    }
  }

  /** O nome do chat acompanha o título do terminal (se o usuário não renomeou). */
  private onTitle(id: string, raw: string): void {
    const title = cleanTitle(raw);
    if (!title) return;
    clearTimeout(this.titleTimers.get(id));
    this.titleTimers.set(
      id,
      window.setTimeout(() => {
        const s = store.session(id);
        if (!s || s.titleLocked || s.title === title) return;
        store.patchLocal(id, { title });
        store.emit("runtime");
        ipc.sessionUpdate(id, { autoTitle: title }).catch(() => {});
      }, 600),
    );
  }

  private tick(): void {
    const now = performance.now();
    for (const s of store.mine) {
      const t = this.map.get(s.id);
      if (!t || !t.connected || !isRunning(s) || t.lastOutput === 0) continue;
      const screen = t.screen();
      const ctx = contextFromScreen(screen);
      if (ctx !== null) this.screenContext.set(s.id, ctx);
      const status = this.debouncer.next(s.id, detectStatus(s.tool, screen, now - t.lastSpontaneous));
      const preview = previewLines(screen);
      const key = `${status}\n${preview.join("\n")}`;
      if (this.reported.get(s.id) === key) continue;
      this.reported.set(s.id, key);
      ipc.sessionReport(s.id, status, preview).catch(() => {});
    }
  }
}
