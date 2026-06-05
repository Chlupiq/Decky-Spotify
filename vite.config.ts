import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import path from "path";

// ESM-safe __dirname for Vite 5
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    lib: {
      entry: path.resolve(__dirname, "src/index.tsx"),
      name: "SpotifyLauncherPro",
      formats: ["iife"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: ["react", "react-dom", "@decky/ui", "@decky/api"],
      output: {
        globals: {
          react: "SP_REACT",
          "react-dom": "SP_REACTDOM",
          "@decky/ui": "DFL",
          "@decky/api": "DFL",
        },
        inlineDynamicImports: true,
      },
    },
    minify: false,
    sourcemap: true,
  },
});
