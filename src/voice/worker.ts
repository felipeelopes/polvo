// Reconhecimento de fala em segundo plano: Whisper (ONNX) via transformers.js.
// Usa a GPU pelo WebGPU quando há um adaptador; senão, a CPU (WASM com SIMD).
// O modelo e o runtime são baixados no primeiro uso e ficam no cache do
// WebView (Cache API), então das próximas vezes tudo funciona offline.
import { env, pipeline, Tensor, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { logMel } from "./features";
import type { ModelChoice, ResolvedModel, VoiceDevice, WorkerIn, WorkerOut } from "./protocol";
import { hasModel, opfsCache } from "./store";

env.allowLocalModels = false;
// Pesos e runtime ficam em arquivos no disco (ver store.ts), não no Cache Storage.
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = opfsCache as never;

// Sem a lib "webworker" (ela mudaria os tipos globais do resto do app).
const post = (msg: WorkerOut) => (self as unknown as { postMessage(m: WorkerOut): void }).postMessage(msg);

const REPOS: Record<ResolvedModel, string> = {
  turbo: "onnx-community/whisper-large-v3-turbo",
  small: "onnx-community/whisper-small",
  base: "onnx-community/whisper-base",
};

const RATE = 16_000;
/** Janela do Whisper; trechos maiores são cortados na pausa mais próxima. */
const WINDOW_S = 30;
/** O prompt divide os 448 tokens do decoder com a resposta. */
const MAX_PROMPT_TOKENS = 160;

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loading: Promise<void> | null = null;

async function pickDevice(): Promise<{ device: VoiceDevice; f16: boolean }> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(o?: object): Promise<{ features: Set<string> } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter({ powerPreference: "high-performance" });
    if (adapter) return { device: "webgpu", f16: adapter.features.has("shader-f16") };
  } catch {
    /* sem WebGPU */
  }
  return { device: "wasm", f16: false };
}

/** "auto": o turbo (o melhor em português) na GPU; na CPU ele seria lento demais, então o small. */
const resolve = (choice: ModelChoice, device: VoiceDevice): ResolvedModel => (choice === "auto" ? (device === "webgpu" ? "turbo" : "small") : choice);

/** Pesos por dispositivo: na GPU, o turbo em 4 bits e os menores com o encoder cheio; na CPU, int8. */
function dtypeFor(model: ResolvedModel, device: VoiceDevice, f16: boolean): Record<string, string> {
  if (device === "wasm") return { encoder_model: "q8", decoder_model_merged: "q8" };
  if (model === "turbo") return f16 ? { encoder_model: "q4f16", decoder_model_merged: "q4f16" } : { encoder_model: "q4", decoder_model_merged: "q4" };
  return f16 ? { encoder_model: "fp16", decoder_model_merged: "fp16" } : { encoder_model: "fp32", decoder_model_merged: "q4" };
}

async function create(model: ResolvedModel, device: VoiceDevice, f16: boolean): Promise<AutomaticSpeechRecognitionPipeline> {
  // Progresso somado por arquivo: o total da biblioteca conta arquivos que
  // nem são baixados (outras precisões), e a barra nunca chegaria a 100%.
  const files = new Map<string, { loaded: number; total: number }>();
  let last = 0;
  // Os tipos da biblioteca não descrevem o dtype por submodelo.
  return (await pipeline("automatic-speech-recognition", REPOS[model], {
    device,
    dtype: dtypeFor(model, device, f16) as never,
    progress_callback: (p) => {
      if (p.status !== "progress") return;
      files.set(p.file, { loaded: p.loaded, total: p.total });
      const now = performance.now();
      if (now - last < 100 && p.loaded < p.total) return;
      last = now;
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: "progress", loaded, total });
    },
  })) as AutomaticSpeechRecognitionPipeline;
}

async function load(choice: ModelChoice): Promise<void> {
  let { device, f16 } = await pickDevice();
  let model = resolve(choice, device);
  post({ type: "resolved", model, device, cached: await hasModel(REPOS[model]) });
  try {
    asr = await create(model, device, f16);
  } catch (e) {
    if (device !== "webgpu") throw e;
    // GPU sem suporte a algum operador (driver antigo…): cai para a CPU.
    console.warn("[voz] WebGPU falhou, usando CPU:", e);
    device = "wasm";
    model = resolve(choice, device);
    post({ type: "resolved", model, device, cached: await hasModel(REPOS[model]) });
    asr = await create(model, device, false);
  }
  // Aquecimento: compila os shaders/kernels agora, e não na primeira fala.
  await generate(new Float32Array(RATE), "en", "");
  post({ type: "ready", device, model });
}

/** Ponto de corte: o trecho mais silencioso entre 20 s e 30 s. */
function cutPoint(audio: Float32Array, from: number): number {
  const end = from + WINDOW_S * RATE;
  if (end >= audio.length) return audio.length;
  const frame = RATE / 10;
  let best = end;
  let bestE = Infinity;
  for (let s = from + 20 * RATE; s + frame <= end; s += frame / 2) {
    let e = 0;
    for (let i = s; i < s + frame; i++) e += audio[i] * audio[i];
    if (e < bestE) {
      bestE = e;
      best = s + frame / 2;
    }
  }
  return best;
}

/**
 * Uma janela de até 30 s. O prompt (vocabulário + o que já foi dito) entra
 * como contexto anterior (<|startofprev|>), como o `initial_prompt` do Whisper:
 * melhora nomes, termos técnicos e a pontuação.
 */
async function generate(audio: Float32Array, language: string | null, prompt: string): Promise<string> {
  const { model, tokenizer: tok, processor } = asr!;
  // Extrator próprio, só sobre o áudio real (ver features.ts).
  const fe = (processor as unknown as { feature_extractor: { window: Float64Array; config: { mel_filters: number[][] } } }).feature_extractor;
  const mels = fe.config.mel_filters;
  const input_features = new Tensor("float32", logMel(audio, { window: fe.window, melFilters: mels }), [1, mels.length, 3000]);
  const id = (t: string) => tok.convert_tokens_to_ids(t) as number;
  let init: number[] | undefined;
  if (language) {
    const promptIds = prompt.trim() ? (tok.encode(` ${prompt.trim()}`, { add_special_tokens: false }) as number[]).slice(-MAX_PROMPT_TOKENS) : [];
    init = [...(promptIds.length ? [id("<|startofprev|>"), ...promptIds] : []), id("<|startoftranscript|>"), id(`<|${language}|>`), id("<|transcribe|>"), id("<|notimestamps|>")];
  }
  const out = (await model.generate({
    inputs: input_features,
    ...(init ? { decoder_input_ids: [init] } : { task: "transcribe" }),
    max_new_tokens: 220,
  } as never)) as { tolist(): bigint[][] };
  const ids = out.tolist()[0].map(Number).slice(init?.length ?? 0);
  const text = (tok.decode(ids, { skip_special_tokens: true }) as string).trim();
  // Em áudio confuso o Whisper às vezes só repete o prompt.
  return prompt && text.length > 3 && prompt.includes(text) ? "" : text;
}

async function transcribe(audio: Float32Array, language: string | null, prompt: string): Promise<string> {
  const parts: string[] = [];
  for (let start = 0; start < audio.length; ) {
    const end = cutPoint(audio, start);
    if (end - start >= RATE / 4) {
      const text = await generate(audio.subarray(start, end), language, [prompt, ...parts].join(" "));
      if (text) parts.push(text);
    }
    start = end;
  }
  return parts.join(" ");
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === "load") {
    loading ??= load(msg.model).catch((err) => {
      loading = null;
      asr = null;
      post({ type: "error", message: String((err as Error)?.message ?? err) });
    });
    return;
  }
  if (msg.type === "transcribe") {
    try {
      await loading;
      if (!asr) throw new Error("modelo não carregado");
      post({ type: "result", id: msg.id, text: await transcribe(msg.audio, msg.language, msg.prompt) });
    } catch (err) {
      post({ type: "result", id: msg.id, text: "", error: String((err as Error)?.message ?? err) });
    }
  }
};
