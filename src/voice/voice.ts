// Ditado por voz em qualquer chat: o botão do microfone no cabeçalho (ou
// Ctrl+Shift+Espaço) abre uma barra sobre o terminal. O microfone só abre com
// o modelo 100% pronto; na primeira vez a barra mostra o download e depois um
// botão "Falar". Enquanto a pessoa fala, cada trecho é transcrito na pausa
// seguinte e fixado na tela; ao terminar, só falta processar a última frase.
// Enter insere no chat, Ctrl+Enter insere e envia, Esc cancela. Segurar o
// atalho funciona como "aperte para falar". Tudo local: Whisper num worker,
// na GPU quando houver.
import { isRunning, store } from "../core/store";
import { locale, t } from "../i18n";
import type { Terminals } from "../terminal/terminals";
import type { SessionTerminal } from "../terminal/session-terminal";
import { toast } from "../ui/feedback";
import { ICON, TOOLS } from "../ui/icons";
import { basename, esc } from "../ui/dom";
import { engine, MODEL_MB, type EngineState, type ModelChoice } from "./engine";
import { cleanText, FRAME, Recorder, trimSilence } from "./recorder";

/** Limite de uma gravação. */
const MAX_SECONDS = 5 * 60;
/** Segurar o atalho por mais que isso = "aperte para falar" (soltar insere). */
const HOLD_MS = 450;
const BARS = 36;
/** Pausa que fecha um trecho (em quadros de 20 ms): 0,5 s. */
const PAUSE_FRAMES = 25;
/** Trecho sem pausa por mais que isso é cortado no ponto mais silencioso. */
const MAX_SEGMENT_S = 20;
/** Respiro entre uma prévia e a próxima (a própria inferência já leva ~1–3 s). */
const PARTIAL_GAP_MS = 250;
/** Depois do primeiro uso, o modelo é pré-carregado ao abrir o app. */
const READY_KEY = "polvo.voice.ready";

/**
 * loading: carregando (ou baixando, na primeira vez) — microfone fechado;
 * ready: primeira vez concluída, esperando a pessoa clicar em "Falar";
 * opening/listening: microfone aberto; finishing: transcrevendo o final.
 */
type Phase = "loading" | "ready" | "opening" | "listening" | "finishing";

class Dictation {
  readonly bar: HTMLDivElement;
  phase: Phase = "loading";
  rec: Recorder | null = null;
  private raf = 0;
  private tickTimer: number | undefined;
  private levels = new Float32Array(BARS);
  private canvas: HTMLCanvasElement;
  private textEl: HTMLElement;
  private timeEl: HTMLElement;
  private setupEl: HTMLElement;
  private devEl: HTMLElement;
  private offEngine: () => void;
  private color = "#7aa5ff";
  private freq: Uint8Array<ArrayBuffer> | null = null;
  private wave: Float32Array<ArrayBuffer> | null = null;

  /** Trechos já transcritos (fixos) e a prévia do trecho atual. */
  private committed: string[] = [];
  private partial = "";
  /** Amostra onde começa o trecho ainda não fixado. */
  private from = 0;
  /** Transcrição em andamento (um trecho ou uma prévia): uma de cada vez. */
  private job: Promise<void> | null = null;
  private lastPartial = 0;
  /** Última prévia concluída: se cobriu todo o trecho, vira o texto fixo sem rodar o modelo de novo. */
  private lastPreview: { from: number; to: number; text: string } | null = null;

  constructor(
    readonly id: string,
    readonly term: SessionTerminal,
    private actions: { primary(send: boolean): void; cancel(): void },
  ) {
    this.bar = document.createElement("div");
    this.bar.className = "vbar";
    this.bar.innerHTML = `
      <div class="vb-text"><span class="vb-ph"></span></div>
      <div class="vb-row">
        <span class="vb-mic">${ICON.mic}</span>
        <canvas class="vb-wave" height="28"></canvas>
        <span class="vb-time">0:00</span>
        <span class="vb-dev" hidden></span>
        <button class="vb-btn" data-v="cancel" title="${t("voice.cancel")} (Esc)">${ICON.close}</button>
        <button class="vb-btn vb-ok" data-v="ok"></button>
      </div>
      <div class="vb-setup" hidden><div class="vb-prog"><i></i></div><small></small></div>`;
    this.canvas = this.bar.querySelector("canvas")!;
    this.textEl = this.bar.querySelector(".vb-text")!;
    this.timeEl = this.bar.querySelector(".vb-time")!;
    this.setupEl = this.bar.querySelector(".vb-setup")!;
    this.devEl = this.bar.querySelector(".vb-dev")!;
    this.bar.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.bar.addEventListener("click", (e) => {
      const v = (e.target as Element).closest<HTMLElement>("[data-v]")?.dataset.v;
      if (v === "cancel") actions.cancel();
      if (v === "ok") actions.primary(e.ctrlKey);
    });
    this.setPhase("loading");
    term.host.append(this.bar);
    this.offEngine = engine.on((s) => this.renderEngine(s));
    this.renderEngine(engine.state);
  }

  setPhase(p: Phase): void {
    this.phase = p;
    this.bar.dataset.phase = p;
    const msg = { loading: "voice.loadingTitle", ready: "voice.readyTitle", opening: "voice.speakNow", listening: "voice.speakNow", finishing: "voice.transcribing" }[p];
    if (p === "loading" && engine.state.phase === "loading" && engine.state.firstTime) this.placeholder(t("voice.setupTitle"));
    else this.placeholder(t(msg));
    const ok = this.bar.querySelector<HTMLElement>(".vb-ok")!;
    const ready = p === "ready";
    ok.innerHTML = `${ready ? ICON.mic : ICON.check}<span>${t(ready ? "voice.start" : "voice.insert")}</span>`;
    ok.title = ready ? `${t("voice.start")} (Enter)` : t("voice.insertHint");
  }

  /** Texto de apoio enquanto ainda não há fala transcrita. */
  private placeholder(text: string): void {
    if (this.committed.length || this.partial) return;
    this.textEl.innerHTML = `<span class="vb-ph">${esc(text)}</span>`;
  }

  start(rec: Recorder): void {
    this.rec = rec;
    this.color = getComputedStyle(this.bar).getPropertyValue("--acc").trim() || this.color;
    this.setPhase("listening");
    this.freq = new Uint8Array(rec.analyser.frequencyBinCount);
    this.wave = new Float32Array(rec.analyser.fftSize);
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.tickTimer = window.setInterval(() => this.tick(), 120);
  }

  /**
   * Transcrição incremental: numa pausa, o trecho desde o último corte é
   * transcrito e fixado; entre pausas, prévias do trecho atual (só na GPU).
   */
  private tick(): void {
    const rec = this.rec;
    if (!rec || this.job || this.phase !== "listening") return;
    const rms = rec.rms;
    const thr = rec.threshold();
    const fromF = Math.floor(this.from / FRAME);
    const endF = rms.length;
    let voiced = 0;
    for (let f = fromF; f < endF; f++) if (rms[f] > thr) voiced++;
    if (voiced < 8) return;
    let quiet = 0;
    while (quiet < endF - fromF && rms[endF - 1 - quiet] <= thr) quiet++;
    const seconds = (endF - fromF) / 50;
    if (quiet >= PAUSE_FRAMES && seconds >= 1) return this.commit((endF - Math.floor(quiet / 2)) * FRAME);
    if (seconds >= MAX_SEGMENT_S) return this.commit(quietest(rms, fromF + 10 * 50, endF - 25) * FRAME);
    // Prévia só no meio da fala: no fim da frase ela atrasaria o trecho fixo.
    const st = engine.state;
    if (st.phase === "ready" && st.device === "webgpu" && quiet < 8 && performance.now() - this.lastPartial > PARTIAL_GAP_MS) this.preview(endF * FRAME);
  }

  /** A última prévia já cobre [from, to)? (nada de fala depois do fim dela) */
  private previewCovers(from: number, to: number): string | null {
    const p = this.lastPreview;
    if (!p || p.from !== from || !this.rec) return null;
    const thr = this.rec.threshold();
    const rms = this.rec.rms;
    for (let f = Math.floor(p.to / FRAME); f < Math.min(rms.length, Math.ceil(to / FRAME)); f++) if (rms[f] > thr) return null;
    return p.text;
  }

  private commit(to: number): void {
    const from = this.from;
    this.from = to;
    const reuse = this.previewCovers(from, to);
    if (reuse !== null) {
      if (reuse) this.committed.push(reuse);
      this.partial = "";
      this.lastPreview = null;
      return this.renderText();
    }
    const audio = trimSilence(this.rec!.range(from, to));
    if (!audio) return;
    this.job = this.run(audio)
      .then((text) => {
        if (text) this.committed.push(text);
        this.partial = "";
        this.renderText();
      })
      .catch(() => {})
      .finally(() => (this.job = null));
  }

  private preview(to: number): void {
    const from = this.from;
    const audio = trimSilence(this.rec!.range(from, to));
    if (!audio) return;
    this.job = this.run(audio)
      .then((text) => {
        // Só vale se o trecho não foi fixado nesse meio tempo.
        if (this.from === from) {
          this.lastPreview = { from, to, text };
          if (this.phase === "listening") {
            this.partial = text;
            this.renderText();
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        this.job = null;
        this.lastPartial = performance.now();
      });
  }

  private async run(audio: Float32Array): Promise<string> {
    const prompt = `${voicePrompt(this.id)} ${this.committed.join(" ")}`;
    return cleanText(await engine.transcribe(voiceModel(), audio, voiceLanguage(), prompt));
  }

  /** Palavras já mostradas (as novas entram animadas, uma a uma). */
  private shown: string[] = [];

  private renderText(): void {
    if (!this.committed.length && !this.partial) return this.setPhase(this.phase);
    const fixed = this.committed.join(" ").split(/\s+/).filter(Boolean);
    const live = this.partial.split(/\s+/).filter(Boolean);
    const words = [...fixed, ...live];
    let same = 0;
    while (same < words.length && same < this.shown.length && words[same] === this.shown[same]) same++;
    let n = 0;
    const span = (w: string, i: number) => (i < same ? esc(w) : `<span class="vb-w" style="animation-delay:${Math.min(n++, 24) * 35}ms">${esc(w)}</span>`);
    const html = (list: string[], base: number) => list.map((w, i) => span(w, base + i)).join(" ");
    this.textEl.innerHTML = `<span class="vb-c">${html(fixed, 0)}</span>${live.length ? ` <span class="vb-p">${html(live, fixed.length)}</span>` : ""}`;
    this.shown = words;
    this.textEl.scrollTop = this.textEl.scrollHeight;
  }

  /** Para de ouvir e transcreve só o que falta desde o último trecho fixado. */
  async finish(): Promise<string> {
    const rec = this.rec;
    const end = rec?.samplesCount ?? 0;
    this.stopListening();
    this.setPhase("finishing");
    await this.job;
    const reuse = rec && end > this.from ? this.previewCovers(this.from, end) : null;
    if (reuse !== null) {
      if (reuse) this.committed.push(reuse);
    } else if (rec && end > this.from) {
      const audio = trimSilence(rec.range(this.from, end));
      this.from = end;
      if (audio) {
        const text = await this.run(audio);
        if (text) this.committed.push(text);
      }
    }
    this.partial = "";
    return this.committed.join(" ").trim();
  }

  private stopListening(): void {
    clearInterval(this.tickTimer);
    cancelAnimationFrame(this.raf);
    if (!this.rec) return;
    this.rec.close();
    this.levels.fill(0);
    this.draw();
  }

  dispose(): void {
    this.stopListening();
    this.rec = null;
    this.offEngine();
    this.bar.classList.add("out");
    window.setTimeout(() => this.bar.remove(), 160);
  }

  /** Onda: barras espelhadas a partir do centro, com a energia de cada faixa da voz. */
  private draw(): void {
    const c = this.canvas;
    const w = c.clientWidth;
    const hgt = c.clientHeight;
    if (!w || !hgt) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hgt * dpr);
    }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);

    let level = 0;
    const live = this.rec && this.phase === "listening";
    if (live && this.freq && this.wave) {
      this.rec!.analyser.getByteFrequencyData(this.freq);
      this.rec!.analyser.getFloatTimeDomainData(this.wave);
      let sum = 0;
      for (const v of this.wave) sum += v * v;
      level = Math.min(1, Math.sqrt(sum / this.wave.length) * 9);
      // Voz humana: ~80 Hz a ~4 kHz (bins de 31 Hz a 16 kHz/512).
      const lo = 3;
      const hi = 130;
      const half = BARS / 2;
      for (let i = 0; i < half; i++) {
        const a = Math.floor(lo + ((hi - lo) * i) / half);
        const b = Math.floor(lo + ((hi - lo) * (i + 1)) / half);
        let m = 0;
        for (let k = a; k < b; k++) m = Math.max(m, this.freq[k]);
        const v = Math.pow(m / 255, 1.6) * (0.35 + level);
        // Graves no centro, agudos nas pontas.
        for (const idx of [half - 1 - i, half + i]) this.levels[idx] += (Math.min(1, v) - this.levels[idx]) * (v > this.levels[idx] ? 0.55 : 0.18);
      }
    }
    this.bar.style.setProperty("--lvl", level.toFixed(3));

    const gap = 3;
    const bw = Math.max(2, (w - gap * (BARS - 1)) / BARS);
    const mid = hgt / 2;
    g.fillStyle = this.color;
    for (let i = 0; i < BARS; i++) {
      const v = this.levels[i];
      const bh = Math.max(3, v * (hgt - 2));
      const x = i * (bw + gap);
      g.globalAlpha = 0.35 + 0.65 * Math.min(1, v * 1.6);
      g.beginPath();
      g.roundRect(x, mid - bh / 2, bw, bh, bw / 2);
      g.fill();
    }
    g.globalAlpha = 1;

    if (live) {
      const s = Math.floor(this.rec!.seconds);
      this.timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (this.rec!.seconds >= MAX_SECONDS) this.actions.primary(false);
    }
  }

  private renderEngine(s: EngineState): void {
    const setup = this.setupEl;
    this.devEl.hidden = s.phase !== "ready";
    if (s.phase === "ready") {
      const gpu = s.device === "webgpu";
      this.devEl.textContent = gpu ? "GPU" : "CPU";
      this.devEl.className = `vb-dev${gpu ? " gpu" : ""}`;
      this.devEl.title = `${t(gpu ? "voice.gpuHint" : "voice.cpuHint")} · Whisper ${MODEL_NAMES[s.model]}`;
    }
    if (s.phase === "loading") {
      if (this.phase === "loading") this.setPhase("loading");
      setup.hidden = false;
      const pct = s.total ? Math.min(100, Math.round((s.loaded / s.total) * 100)) : 0;
      setup.classList.toggle("indet", !s.total);
      setup.querySelector<HTMLElement>(".vb-prog i")!.style.width = `${pct}%`;
      const size = s.total ? `${Math.round(s.total / 1e6)} MB` : s.model ? `~${MODEL_MB[s.model][s.device === "wasm" ? "cpu" : "gpu"]} MB` : "";
      setup.querySelector("small")!.textContent = s.firstTime ? `${t("voice.setupFirst")} · ${s.total ? t("voice.setupProgress", { pct, size }) : size}` : t("voice.loading");
    } else if (s.phase === "error") {
      setup.hidden = false;
      setup.classList.remove("indet");
      setup.classList.add("err");
      setup.querySelector("small")!.textContent = t("voice.loadFailed", { error: s.message });
    } else setup.hidden = true;
  }
}

/** Quadro mais silencioso entre dois quadros (corte de trecho longo sem pausa). */
function quietest(rms: number[], a: number, b: number): number {
  let best = Math.min(b, rms.length) - 1;
  for (let f = Math.max(0, a); f < Math.min(b, rms.length); f++) if (rms[f] < rms[best]) best = f;
  return best;
}

const MODEL_NAMES = { turbo: "large-v3-turbo", small: "small", base: "base" } as const;

const voiceModel = (): ModelChoice => (["turbo", "small", "base"].includes(store.settings.voiceModel) ? store.settings.voiceModel : "auto");

/** Termos que aparecem muito ao falar com agentes de código (o Whisper erra "commit", "pull request"…). */
const DEV_TERMS = ["commit", "pull request", "branch", "merge", "deploy", "GitHub", "endpoint", "API", "backend", "frontend", "TypeScript", "bug", "log"];

/**
 * Contexto passado ao Whisper como "fala anterior": o vocabulário do usuário,
 * o nome do projeto e termos de programação. Melhora muito nomes próprios e
 * termos em inglês no meio do português.
 */
function voicePrompt(id: string): string {
  const s = store.session(id);
  const mine = (store.settings.voiceVocabulary ?? "").split(/[,;\n]/).map((w) => w.trim()).filter(Boolean);
  const terms = [...new Set([...mine, ...(s ? [basename(s.cwd), TOOLS[s.tool].name] : []), ...DEV_TERMS])];
  return `${terms.join(", ")}.`;
}

const voiceLanguage = (): string | null => (store.settings.voiceLanguage === "auto" ? null : locale());

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export class Voice {
  private cur: Dictation | null = null;
  /** Atalho pressionado: momento e sessão (para o "aperte para falar"). */
  private press: { at: number; id: string } | null = null;

  constructor(private terms: Terminals) {
    document.addEventListener("keydown", (e) => this.onKey(e), true);
    document.addEventListener("keyup", (e) => this.onKeyUp(e), true);
    window.addEventListener("blur", () => this.onKeyUp(null));
    engine.on((s) => {
      if (s.phase !== "ready") return;
      try {
        localStorage.setItem(READY_KEY, "1");
      } catch {
        /* só perde o pré-carregamento */
      }
    });
    // Já usado antes: carrega o modelo do disco em segundo plano, para o
    // primeiro clique no microfone já encontrar tudo pronto.
    if (store.isMain && storageGet(READY_KEY)) {
      const warm = () => void engine.warm(voiceModel()).catch(() => {});
      window.setTimeout(() => ("requestIdleCallback" in window ? requestIdleCallback(warm, { timeout: 5000 }) : warm()), 3000);
    }
  }

  isActive(id: string): boolean {
    return this.cur?.id === id;
  }

  /** Botão do microfone: começa a ditar ou termina e insere. */
  toggle(id: string): void {
    if (this.cur?.id === id) return this.primary(false);
    void this.start(id);
  }

  /** Ação principal da barra, conforme a fase: começar a falar ou inserir. */
  private primary(send: boolean): void {
    const d = this.cur;
    if (!d) return;
    if (d.phase === "ready") void this.listen(d);
    else if (d.phase === "opening" || d.phase === "listening") void this.finish(send);
  }

  /** Ctrl+Shift+Espaço pressionado. */
  shortcutDown(e: KeyboardEvent, id: string | null): void {
    if (e.repeat) return;
    if (this.cur) {
      if (this.cur.phase === "ready") this.press = { at: performance.now(), id: this.cur.id };
      return this.primary(false);
    }
    if (!id) return;
    this.press = { at: performance.now(), id };
    void this.start(id);
  }

  private onKeyUp(e: KeyboardEvent | null): void {
    if (!this.press || (e && e.code !== "Space")) return;
    const held = performance.now() - this.press.at;
    const id = this.press.id;
    this.press = null;
    if (held >= HOLD_MS && this.cur?.id === id && this.cur.phase === "listening") void this.finish(false);
  }

  private onKey(e: KeyboardEvent): void {
    const d = this.cur;
    if (!d) return;
    if (e.key === "Escape") this.cancel();
    else if (e.key === "Enter" && !e.shiftKey && !e.altKey && ["ready", "opening", "listening"].includes(d.phase)) this.primary(e.ctrlKey);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private async start(id: string): Promise<void> {
    const s = store.session(id);
    const term = this.terms.get(id);
    if (!s || !term) return;
    if (!isRunning(s)) return toast(t("voice.notRunning"));
    if (this.cur) {
      if (this.cur.phase === "opening" || this.cur.phase === "listening") await this.finish(false);
      else if (this.cur.phase === "finishing") return;
      else this.end();
    }
    const d = new Dictation(id, term, { primary: (send) => this.primary(send), cancel: () => this.cancel() });
    this.cur = d;
    this.paint();
    // O microfone só abre com o modelo 100% pronto.
    const ready = engine.warm(voiceModel());
    const first = await engine.firstTime();
    try {
      await ready;
    } catch {
      return; // o erro aparece na barra
    }
    if (this.cur !== d) return;
    // Primeira vez: termina no "Pronto!" e a pessoa escolhe quando falar.
    if (first) {
      d.setPhase("ready");
      this.paint();
      return;
    }
    await this.listen(d);
  }

  /** Abre o microfone e começa a ouvir. */
  private async listen(d: Dictation): Promise<void> {
    d.setPhase("opening");
    this.paint();
    try {
      const rec = await Recorder.open();
      if (this.cur !== d) return rec.close();
      d.start(rec);
      this.paint();
    } catch (e) {
      if (this.cur === d) this.end();
      const name = (e as DOMException)?.name;
      toast(name === "NotAllowedError" ? t("voice.micDenied") : name === "NotFoundError" ? t("voice.noMic") : t("voice.micError", { error: String((e as Error)?.message ?? e) }));
    }
  }

  private cancel(): void {
    if (this.cur) this.end();
  }

  /** Para de gravar, transcreve o que falta e insere no chat (e envia, se pedido). */
  private async finish(send: boolean): Promise<void> {
    const d = this.cur;
    if (!d || (d.phase !== "opening" && d.phase !== "listening")) return;
    if (d.phase === "opening") return this.end();
    this.paint();
    try {
      const promise = d.finish();
      this.paint();
      const text = await promise;
      if (this.cur !== d) return;
      this.end();
      if (!text) return toast(t("voice.nothing"));
      this.insert(d.term, text, send);
    } catch (e) {
      if (this.cur === d) this.end();
      toast(t("voice.failed", { error: String((e as Error)?.message ?? e) }));
    }
  }

  private insert(term: SessionTerminal, text: string, send: boolean): void {
    const before = term.typedLine;
    const sep = before && !/\s$/.test(before) ? " " : "";
    term.paste(sep + text);
    term.focus();
    // Depois do fim da colagem: o CLI trata o Enter como envio.
    if (send) window.setTimeout(() => term.input("\r"), 80);
  }

  private end(): void {
    this.cur?.dispose();
    this.cur = null;
    this.paint();
  }

  /** Botões de microfone dos cabeçalhos refletem a gravação. */
  private paint(): void {
    for (const b of document.querySelectorAll<HTMLElement>(".pacts [data-a=voice]")) {
      const phase = this.cur && this.cur.id === b.dataset.sid ? this.cur.phase : null;
      b.classList.toggle("rec", phase === "opening" || phase === "listening");
      b.classList.toggle("busy", phase === "loading" || phase === "ready" || phase === "finishing");
    }
  }
}

