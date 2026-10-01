import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

const host = process.env.TAURI_DEV_HOST;

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
  build: {
    target: "es2022",
    sourcemap: false,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
} as Parameters<typeof defineConfig>[0]);
