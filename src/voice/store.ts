// Cache dos arquivos do modelo no disco (OPFS, o sistema de arquivos privado
// do WebView). O Cache Storage do Chromium falha com arquivos acima de ~256 MB
// ("Unexpected internal error") e os pesos do Whisper turbo passam disso: sem
// isto, o modelo seria baixado de novo a cada abertura do app.
// Implementa o `match`/`put` que o transformers.js espera de um cache.

const DIR = "polvo-models";

let root: Promise<FileSystemDirectoryHandle> | null = null;
const dir = () => (root ??= navigator.storage.getDirectory().then((r) => r.getDirectoryHandle(DIR, { create: true })));

/** Nome de arquivo estável para a chave (o OPFS não aceita "/" no nome). */
const fileName = (key: string) => key.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_");

export const opfsCache = {
  async match(key: string): Promise<Response | undefined> {
    try {
      const file = await (await (await dir()).getFileHandle(fileName(key))).getFile();
      return new Response(file, { headers: { "content-length": String(file.size), "content-type": file.type || "application/octet-stream" } });
    } catch {
      return undefined;
    }
  },

  /** Grava num arquivo temporário e só renomeia no fim: falha no meio não deixa arquivo quebrado. */
  async put(key: string, response: Response): Promise<void> {
    if (!response.body) return;
    const d = await dir();
    const name = fileName(key);
    const tmp = `${name}.part`;
    try {
      const fh = await d.getFileHandle(tmp, { create: true });
      await response.body.pipeTo(await fh.createWritable());
      await (fh as FileSystemFileHandle & { move(name: string): Promise<void> }).move(name);
    } catch (e) {
      console.warn("[voz] não foi possível salvar o arquivo do modelo:", e);
      await d.removeEntry(tmp).catch(() => {});
    }
  },
};

/** Os pesos deste repositório já estão no disco? */
export async function hasModel(repo: string): Promise<boolean> {
  const prefix = fileName(`huggingface.co/${repo}/`);
  try {
    const d = (await dir()) as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> };
    for await (const name of d.keys()) if (name.startsWith(prefix) && name.includes("decoder_model_merged") && name.endsWith(".onnx")) return true;
  } catch {
    /* sem OPFS */
  }
  return false;
}
