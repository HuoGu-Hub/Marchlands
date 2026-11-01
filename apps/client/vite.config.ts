import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  assetsInclude: ["**/*.glb"],
  server: {
    host: "127.0.0.1",
    port: 5188,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
