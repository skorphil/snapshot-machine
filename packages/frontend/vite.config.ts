import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@snapshot-machine/shared/": fileURLToPath(
        new URL("../shared/", import.meta.url),
      ),
      "@/": fileURLToPath(new URL("./src/", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: true,
    hmr: {
      host: "127.0.0.1",
      // Disable token for HMR to avoid noisy connection errors in the Deno Desktop webview proxy
      // @ts-ignore: token is a valid option in newer Vite versions
      token: false,
    },
    fs: {
      allow: [".."],
    },
    watch: {
      ignored: [
        "**/dist/**",
        "**/.vite/**",
        "**/.git/**",
        "**/node_modules/**",
      ],
    },
  },
});
