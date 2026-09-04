import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri serves the built assets over the `tauri://` protocol, so the bundle is
// plain static output with relative paths. The dev server exists only for
// `tauri dev`; the shell points its window at it.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    watch: { ignored: ["**/src-tauri/**", "**/app/**", "**/data/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome110",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
