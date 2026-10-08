// Mensagens entre a interface e o worker de reconhecimento de fala.

/** "webgpu" = placa de vídeo; "wasm" = processador. */
export type VoiceDevice = "webgpu" | "wasm";

/** Modelos Whisper usados; "auto" escolhe pelo dispositivo. */
export type ResolvedModel = "turbo" | "small" | "base";
export type ModelChoice = "auto" | ResolvedModel;

export type WorkerIn =
  | { type: "load"; model: ModelChoice }
  | { type: "transcribe"; id: number; audio: Float32Array; language: string | null; prompt: string };

export type WorkerOut =
  | { type: "resolved"; model: ResolvedModel; device: VoiceDevice; cached: boolean }
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; device: VoiceDevice; model: ResolvedModel }
  | { type: "error"; message: string }
  | { type: "result"; id: number; text: string; error?: string };
