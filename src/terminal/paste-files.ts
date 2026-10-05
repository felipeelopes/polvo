// Ctrl + V com arquivos copiados no Explorer: vão para `.polvo/pasted` do
// projeto (os que já estão nele ficam onde estão) e entram no chat como
// `@caminho`. Imagem solta (print) no Claude Code vira o Alt + V nativo dele,
// que anexa a imagem; nos outros CLIs é salva como PNG e referenciada.
import type { Terminal } from "@xterm/xterm";
import { ipc } from "../core/ipc";
import type { ToolKind } from "../core/types";
import { toast } from "../ui/feedback";
import type { FileLinkHost } from "./file-links";

/** Como o CLI recebe a referência: `@caminho` nos agentes, o caminho puro no shell. */
export function fileRef(tool: ToolKind, path: string): string {
  const quoted = /\s/.test(path) ? `"${path}"` : path;
  return tool === "shell" ? quoted : `@${quoted}`;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Cola arquivos (ou a imagem) da área de transferência; `false` se não havia nenhum. */
export async function pasteFiles(term: Terminal, host: FileLinkHost, tool: ToolKind, image?: Blob | null): Promise<boolean> {
  const cwd = host.cwd();
  if (!cwd) return false;
  try {
    const paths = await ipc.clipboardFiles();
    let refs: string[] = [];
    if (paths.length) refs = await ipc.pasteFiles(cwd, paths);
    else if (image) {
      // O Claude Code lê a imagem da área de transferência sozinho com Alt + V.
      if (tool === "claude") {
        term.input("\x1bv");
        return true;
      }
      const ext = image.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      refs = [await ipc.pasteImage(cwd, toBase64(new Uint8Array(await image.arrayBuffer())), ext)];
    } else return false;
    if (refs.length) term.paste(refs.map((p) => fileRef(tool, p)).join(" ") + " ");
    return true;
  } catch (e) {
    toast(String((e as Error)?.message ?? e));
    return true;
  }
}

/**
 * Intercepta o `paste` antes do xterm: texto comum segue normal; sem texto
 * (arquivos do Explorer, print) cola os arquivos.
 */
export function installPasteFiles(term: Terminal, el: HTMLElement, host: FileLinkHost, tool: ToolKind): void {
  el.addEventListener(
    "paste",
    (e) => {
      const cd = e.clipboardData;
      if (!cd || !host.cwd()) return;
      const text = cd.getData("text/plain");
      const hasFiles = [...cd.types].includes("Files");
      if (text && !hasFiles) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // Com texto junto (ex.: copiado do Word), o texto vence a imagem.
      const image = text ? null : ([...cd.files].find((f) => f.type.startsWith("image/")) ?? null);
      void pasteFiles(term, host, tool, image).then((done) => {
        if (!done && text) term.paste(text);
      });
    },
    true,
  );
}

/** Imagem na área de transferência (para o colar do clique direito). */
export async function clipboardImage(): Promise<Blob | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) return await item.getType(type);
    }
  } catch {
    /* sem permissão ou vazio */
  }
  return null;
}
