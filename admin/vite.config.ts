import { defineConfig } from "vite";

export default defineConfig({
  base: "/admin/",
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 4173,
    proxy: { "/api": "http://127.0.0.1:3000" }
  }
});
