import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    // No inline module-preload polyfill, so the production CSP can keep
    // script-src 'self' (no 'unsafe-inline') without breaking the bundle.
    modulePreload: { polyfill: false },
  },
});
