import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

const host = process.env.TAURI_DEV_HOST;

function dropOrtWasm(): Plugin {
  return {
    name: "polvo-drop-ort-wasm",
    generateBundle(_opts, bundle) {
      for (const name of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(name)) delete bundle[name];
    },
  };
}

// Configuração recomendada pelo Tauri: porta fixa e sem limpar o terminal.
export default defineConfig({
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // O worker do ditado importa o transformers.js, que divide o código em partes.
  // O runtime WASM do ONNX (~27 MB) não vai no instalador: o transformers.js o
  // baixa do CDN no primeiro uso do ditado e guarda no cache, junto do modelo.
  worker: { format: "es", plugins: () => [dropOrtWasm()] },
  build: {
    target: "es2022",
    sourcemap: false,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
} as Parameters<typeof defineConfig>[0]);
