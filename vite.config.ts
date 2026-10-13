import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  root: "client",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: {
    proxy: { "/socket.io": { target: "http://localhost:3000", ws: true } },
  },
});
