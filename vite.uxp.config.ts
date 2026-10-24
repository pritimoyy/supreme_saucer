import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { uxp } from "vite-uxp-plugin";
import uxpConfig from "./uxp.config";
import path from "path";

const src = path.resolve(__dirname, "src");
const uxpRoot = path.resolve(src, "uxp");
const outDir = path.resolve(__dirname, "dist", "uxp");

export default defineConfig({
  plugins: [react(), uxp(uxpConfig)],
  root: uxpRoot,
  clearScreen: false,
  resolve: {
    alias: [
      {
        find: "@shared",
        replacement: path.resolve(src, "shared"),
      },
    ],
  },
  server: {
    port: 3200,
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(uxpRoot, "index.html"),
      output: {
        manualChunks: {},
        preserveModules: false,
        format: "es",
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
    target: "es2020",
    outDir,
    emptyOutDir: true,
  },
});
