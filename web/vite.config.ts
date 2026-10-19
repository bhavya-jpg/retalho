import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Relative base so the static build also opens from disk / any sub-path (PLAN.md M14).
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1000 },
});
