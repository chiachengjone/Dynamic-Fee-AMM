import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vite + React + Tailwind v4 (CSS-first, via the official Vite plugin).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    // recharts is a single large vendor lib that can't be split further;
    // it lives in its own cached chunk, so raise the cosmetic warning limit.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split the heavy third-party libs into their own chunks so the main
        // app bundle stays small and the vendor code caches independently.
        manualChunks: {
          ethers: ["ethers"],
          recharts: ["recharts"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
