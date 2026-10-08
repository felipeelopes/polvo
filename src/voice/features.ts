// Log-mel do Whisper calculado só sobre o áudio real. O extrator do
// transformers.js processa sempre a janela inteira de 30 s (3000 quadros, FFT
// genérica e uma multiplicação de matrizes via ONNX): ~0,5 s por chamada. Os
// quadros depois do fim da fala são silêncio puro e, após a normalização,
// valem a mesma constante — então basta calcular os quadros com som.
// Resultado idêntico ao do extrator original (mesma janela e filtros mel).

const N_FFT = 400;
const HOP = 160;
const BINS = N_FFT / 2 + 1; // 201
const FRAMES = 3000;
const SAMPLES = FRAMES * HOP; // 30 s
const MEL_FLOOR = 1e-10;

// FFT de 400 pontos decomposta em 16 × 25 (Cooley–Tukey de um nível).
const P = 16;
const Q = 25;
const c25 = new Float64Array(Q * Q);
const s25 = new Float64Array(Q * Q);
for (let n = 0; n < Q; n++)
  for (let k = 0; k < Q; k++) {
    c25[n * Q + k] = Math.cos((2 * Math.PI * n * k) / Q);
    s25[n * Q + k] = Math.sin((2 * Math.PI * n * k) / Q);
  }
const cTw = new Float64Array(P * BINS);
const sTw = new Float64Array(P * BINS);
for (let p = 0; p < P; p++)
  for (let k = 0; k < BINS; k++) {
    cTw[p * BINS + k] = Math.cos((2 * Math.PI * p * k) / N_FFT);
    sTw[p * BINS + k] = Math.sin((2 * Math.PI * p * k) / N_FFT);
  }

/** Espectro de potência (|X[k]|², k = 0..200) de um quadro real de 400 amostras. */
function powerSpectrum(x: Float64Array, out: Float64Array, re: Float64Array, im: Float64Array): void {
  // DFTs de 25 pontos de cada subsequência x[16·n + p].
  for (let p = 0; p < P; p++) {
    for (let k = 0; k < Q; k++) {
      let r = 0;
      let i = 0;
      for (let n = 0; n < Q; n++) {
        const v = x[P * n + p];
        r += v * c25[n * Q + k];
        i -= v * s25[n * Q + k];
      }
      re[p * Q + k] = r;
      im[p * Q + k] = i;
    }
  }
  // Combina com os fatores de giro: X[k] = Σp W400^(p·k) · A_p[k mod 25].
  for (let k = 0; k < BINS; k++) {
    const km = k % Q;
    let r = 0;
    let i = 0;
    for (let p = 0; p < P; p++) {
      const ar = re[p * Q + km];
      const ai = im[p * Q + km];
      const wc = cTw[p * BINS + k];
      const ws = -sTw[p * BINS + k];
      r += ar * wc - ai * ws;
      i += ar * ws + ai * wc;
    }
    out[k] = r * r + i * i;
  }
}

export interface MelConfig {
  /** Janela de Hann (400). */
  window: ArrayLike<number>;
  /** Filtros mel: n_mels linhas × 201 colunas. */
  melFilters: ArrayLike<number>[];
}

/** Faixa não nula de cada filtro mel (são triângulos estreitos). */
const ranges = new WeakMap<object, { lo: number; hi: number; w: Float64Array }[]>();

function filterRanges(filters: ArrayLike<number>[]) {
  let r = ranges.get(filters);
  if (!r) {
    r = filters.map((row) => {
      let lo = 0;
      let hi = BINS - 1;
      while (lo < BINS && !row[lo]) lo++;
      while (hi > lo && !row[hi]) hi--;
      return { lo, hi, w: Float64Array.from(row as ArrayLike<number>) };
    });
    ranges.set(filters, r);
  }
  return r;
}

/** Atributos de entrada do Whisper ([n_mels × 3000], linha por filtro mel). */
export function logMel(audio: Float32Array, cfg: MelConfig): Float32Array {
  const filters = filterRanges(cfg.melFilters);
  const nMels = filters.length;
  const len = Math.min(audio.length, SAMPLES);
  const pad = N_FFT / 2;
  // Quadros que tocam alguma amostra real (os demais são silêncio).
  const live = Math.min(FRAMES, Math.ceil((len + pad) / HOP) + 1);
  // Amostra do sinal com o preenchimento "reflect" do início e zeros depois do fim.
  const at = (j: number): number => {
    const t = j - pad;
    const idx = t < 0 ? -t : t;
    return idx < len ? audio[idx] : 0;
  };
  const out = new Float32Array(nMels * FRAMES);
  const frame = new Float64Array(N_FFT);
  const spec = new Float64Array(BINS);
  const re = new Float64Array(P * Q);
  const im = new Float64Array(P * Q);
  const win = cfg.window;
  let max = -Infinity;
  for (let f = 0; f < live; f++) {
    const off = f * HOP;
    for (let j = 0; j < N_FFT; j++) frame[j] = at(off + j) * win[j];
    powerSpectrum(frame, spec, re, im);
    for (let m = 0; m < nMels; m++) {
      const { lo, hi, w } = filters[m];
      let s = 0;
      for (let k = lo; k <= hi; k++) s += w[k] * spec[k];
      const v = Math.log10(Math.max(MEL_FLOOR, s));
      out[m * FRAMES + f] = v;
      if (v > max) max = v;
    }
  }
  // Silêncio: log10(1e-10) = -10, que a normalização prende em (máx − 8).
  if (live < FRAMES) max = Math.max(max, -10);
  const floor = max - 8;
  for (let m = 0; m < nMels; m++) {
    const row = m * FRAMES;
    for (let f = 0; f < live; f++) out[row + f] = (Math.max(out[row + f], floor) + 4) / 4;
    out.fill((Math.max(-10, floor) + 4) / 4, row + live, row + FRAMES);
  }
  return out;
}
