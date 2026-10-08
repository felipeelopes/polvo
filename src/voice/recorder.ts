// Captura do microfone já em 16 kHz mono (o formato do Whisper): o WebView
// reamostra no AudioContext e um AudioWorklet junta as amostras fora da thread
// da interface. Um AnalyserNode alimenta a animação em tempo real.
import { ipc } from "../core/ipc";

export const RATE = 16_000;
/** Quadro de análise da fala: 20 ms. */
export const FRAME = RATE / 50;

const WORKLET = `registerProcessor("polvo-rec", class extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
});`;

let workletUrl: string | null = null;

export class Recorder {
  readonly analyser: AnalyserNode;
  private chunks: Float32Array[] = [];
  private length = 0;
  private stopped = false;
  /** Energia (RMS) de cada quadro de 20 ms, calculada à medida que o áudio chega. */
  readonly rms: number[] = [];
  private acc = 0;
  private accN = 0;

  private constructor(
    private ctx: AudioContext,
    private stream: MediaStream,
    private node: AudioWorkletNode,
    private source: MediaStreamAudioSourceNode,
  ) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.55;
    source.connect(this.analyser);
    source.connect(node);
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.stopped) return;
      this.chunks.push(e.data);
      this.length += e.data.length;
      for (const v of e.data) {
        this.acc += v * v;
        if (++this.accN === FRAME) {
          this.rms.push(Math.sqrt(this.acc / FRAME));
          this.acc = this.accN = 0;
        }
      }
    };
  }

  static async open(): Promise<Recorder> {
    // O WebView2 pergunta a cada vez se ninguém responder ao pedido de permissão.
    await ipc.voiceAllowMic().catch(() => {});
    const stream = await navigator.mediaDevices.getUserMedia({
      // Sem supressão de ruído/eco do navegador: o Whisper foi treinado com
      // áudio cru e os artefatos desses filtros pioram o reconhecimento.
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
    const ctx = new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
    try {
      workletUrl ??= URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await ctx.audioWorklet.addModule(workletUrl);
      const source = ctx.createMediaStreamSource(stream);
      // Sem saída audível: o nó precisa estar no grafo para processar.
      const node = new AudioWorkletNode(ctx, "polvo-rec", { numberOfInputs: 1, numberOfOutputs: 0 });
      return new Recorder(ctx, stream, node, source);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      throw e;
    }
  }

  get seconds(): number {
    return this.length / RATE;
  }

  /** Limiar de fala: bem acima do ruído de fundo (percentil 15 dos quadros). */
  threshold(): number {
    const n = this.rms.length;
    if (n < 10) return 0.015;
    const sample = n > 1500 ? this.rms.slice(-1500) : this.rms.slice();
    sample.sort((a, b) => a - b);
    return Math.max(0.012, sample[Math.floor(sample.length * 0.15)] * 3);
  }

  /** Amostras entre duas posições (em amostras). */
  range(from: number, to: number): Float32Array {
    const out = new Float32Array(Math.max(0, to - from));
    let pos = 0;
    for (const c of this.chunks) {
      const end = pos + c.length;
      if (end > from && pos < to) {
        const a = Math.max(from, pos) - pos;
        const b = Math.min(to, end) - pos;
        out.set(c.subarray(a, b), pos + a - from);
      }
      pos = end;
      if (pos >= to) break;
    }
    return out;
  }

  get samplesCount(): number {
    return this.length;
  }

  /** Cópia das amostras (as últimas `maxSeconds`, se informado). */
  samples(maxSeconds?: number): Float32Array {
    const want = maxSeconds ? Math.min(this.length, Math.round(maxSeconds * RATE)) : this.length;
    const out = new Float32Array(want);
    let pos = want;
    for (let i = this.chunks.length - 1; i >= 0 && pos > 0; i--) {
      const c = this.chunks[i];
      const n = Math.min(c.length, pos);
      out.set(c.subarray(c.length - n), pos - n);
      pos -= n;
    }
    return out;
  }

  /** Solta o microfone (o indicador do Windows apaga na hora). */
  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.node.port.onmessage = null;
    this.source.disconnect();
    this.node.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close();
  }
}

/**
 * Corta o silêncio do começo e do fim (economiza processamento e evita as
 * "alucinações" do Whisper em trechos mudos). Devolve null se não houve fala.
 */
export function trimSilence(audio: Float32Array): Float32Array | null {
  const frame = RATE / 50; // 20 ms
  const n = Math.floor(audio.length / frame);
  if (!n) return null;
  const rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += audio[i] * audio[i];
    rms[f] = Math.sqrt(sum / frame);
  }
  // Ruído de fundo: o percentil 20 dos quadros; fala fica bem acima dele.
  const floor = [...rms].sort((a, b) => a - b)[Math.floor(n * 0.2)];
  const threshold = Math.max(0.012, floor * 3);
  let first = -1;
  let last = -1;
  let voiced = 0;
  for (let f = 0; f < n; f++) {
    if (rms[f] > threshold) {
      voiced++;
      if (first < 0) first = f;
      last = f;
    }
  }
  // Menos de ~150 ms de som acima do ruído: não foi fala.
  if (voiced < 8) return null;
  const pad = 15; // 300 ms de margem
  const start = Math.max(0, first - pad) * frame;
  const end = Math.min(n, last + pad + 1) * frame;
  return audio.slice(start, end);
}

/** Frases que o Whisper inventa em silêncio ou ruído. */
const HALLUCINATIONS = [
  /^\s*[[(].*[\])]\s*$/, // [Música], (aplausos)
  /legendas? (pela|por) .*amara/i,
  /^\s*(obrigad[oa]s? por assistir(em)?|thanks? (you )?for watching)[.!]*\s*$/i,
  /^\s*(\.\.\.|…)?\s*$/,
];

export function cleanText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return HALLUCINATIONS.some((re) => re.test(t)) ? "" : t;
}
