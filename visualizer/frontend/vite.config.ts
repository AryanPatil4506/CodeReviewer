import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Proxies /api and /ws to the FastAPI backend during local dev so the
// frontend can always talk to same-origin paths - no CORS juggling, and
// the built app + backend can also be served together in prod if desired.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8001",
        ws: true,
      },
    },
  },
});
