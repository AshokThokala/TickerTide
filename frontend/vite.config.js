import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Use the canonical path as root so redirected/symlinked folders
// (e.g. Windows app-storage virtualization) don't fail Vite's fs checks.
const root = realpathSync.native(fileURLToPath(new URL(".", import.meta.url)));

// Dev server proxies /api to the FastAPI backend on :8000.
export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
