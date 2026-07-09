import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // VITE_MOCK=1 swaps the Supabase client for in-memory demo fixtures
      // (screenshots, offline UI work). This exact-path entry must precede the
      // "@" prefix alias so it wins. Never set in production, so it never ships.
      ...(process.env.VITE_MOCK
        ? { "@/lib/supabase": path.resolve(__dirname, "./src/mock/supabase.ts") }
        : {}),
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
