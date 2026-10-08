// Motor de transcrição: dono do worker do Whisper. O worker só nasce no
// primeiro uso (nada é baixado antes disso) e é encerrado depois de um tempo
// parado, devolvendo a memória da GPU.
import type { ModelChoice, ResolvedModel, VoiceDevice, WorkerIn, WorkerOut } from "./protocol";

export type { ModelChoice };

/** Tamanho aproximado do download (MB) de cada modelo, na GPU e na CPU. */
export const MODEL_MB: Record<ResolvedModel, { gpu: number; cpu: number }> = {
  turbo: { gpu: 760, cpu: 1085 },
  small: { gpu: 586, cpu: 249 },
  base: { gpu: 206, cpu: 77 },
};

export type EngineState =
  | { phase: "off" }
  | { phase: "loading"; model: ResolvedModel | null; device: VoiceDevice | null; firstTime: boolean; loaded: number; total: number }
  | { phase: "ready"; device: VoiceDevice; model: ResolvedModel }
  | { phase: "error"; message: string };

/** Sem uso por este tempo, o modelo sai da memória (volta do cache em segundos). */
const IDLE_UNLOAD_MS = 20 * 60_000;

class Engine {
  state: EngineState = { phase: "off" };
  private worker: Worker | null = null;
  private model: ModelChoice | null = null;
  private seq = 0;
  private waiting = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();
  private ready: Promise<VoiceDevice> | null = null;
  private idleTimer: number | undefined;
  private listeners = new Set<(s: EngineState) => void>();

  on(fn: (s: EngineState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: EngineState): void {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Começa a carregar (ou baixar, na primeira vez) em segundo plano. */
  warm(model: ModelChoice): Promise<VoiceDevice> {
    this.touch();
    if (this.ready && this.model === model) return this.ready;
    this.unload();
    this.model = model;
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "polvo-voz" });
    this.worker = worker;
    this.set({ phase: "loading", model: null, device: null, firstTime: false, loaded: 0, total: 0 });
    this.ready = new Promise<VoiceDevice>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        if (m.type === "resolved" && this.state.phase === "loading") this.set({ ...this.state, model: m.model, device: m.device, firstTime: !m.cached });
        else if (m.type === "progress" && this.state.phase === "loading") this.set({ ...this.state, loaded: m.loaded, total: m.total });
        else if (m.type === "ready") {
          this.set({ phase: "ready", device: m.device, model: m.model });
          resolve(m.device);
        } else if (m.type === "error") {
          this.set({ phase: "error", message: m.message });
          reject(new Error(m.message));
          this.unload(false);
        } else if (m.type === "result") {
          const w = this.waiting.get(m.id);
          this.waiting.delete(m.id);
          if (m.error) w?.reject(new Error(m.error));
          else w?.resolve(m.text);
        }
      };
      worker.onerror = (e) => {
        const message = e.message || "worker";
        this.set({ phase: "error", message });
        reject(new Error(message));
        this.unload(false);
      };
    });
    this.ready.catch(() => {});
    this.send({ type: "load", model });
    return this.ready;
  }

  /**
   * Depois de `warm`: true se o modelo ainda vai ser baixado (primeiro uso);
   * false se já está no cache ou pronto.
   */
  firstTime(): Promise<boolean> {
    return new Promise((resolve) => {
      let off: (() => void) | null = null;
      let done = false;
      const check = (s: EngineState) => {
        if (done) return;
        const known = s.phase !== "loading" || s.model !== null;
        if (!known) return;
        done = true;
        off?.();
        resolve(s.phase === "loading" && s.firstTime);
      };
      off = this.on(check);
      check(this.state);
      if (done) off();
    });
  }

  /** Transcreve áudio mono de 16 kHz. Os pedidos são atendidos em ordem. */
  async transcribe(model: ModelChoice, audio: Float32Array, language: string | null, prompt: string): Promise<string> {
    await this.warm(model);
    this.touch();
    const id = ++this.seq;
    const p = new Promise<string>((resolve, reject) => this.waiting.set(id, { resolve, reject }));
    this.send({ type: "transcribe", id, audio, language, prompt }, [audio.buffer as ArrayBuffer]);
    try {
      return await p;
    } finally {
      this.touch();
    }
  }

  get busy(): boolean {
    return this.waiting.size > 0;
  }

  private send(msg: WorkerIn, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  private touch(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if (!this.busy) this.unload();
    }, IDLE_UNLOAD_MS);
  }

  private unload(reset = true): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.model = null;
    for (const w of this.waiting.values()) w.reject(new Error("cancelado"));
    this.waiting.clear();
    if (reset && this.state.phase !== "error") this.set({ phase: "off" });
  }
}

export const engine = new Engine();
