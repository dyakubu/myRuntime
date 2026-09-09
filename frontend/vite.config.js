import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In production the API serves this build from its own origin (api/app/main.py mounts
// frontend/dist at "/"), so requests go to a relative /api path. The dev proxy makes
// `npm run dev` behave the same way against a locally running uvicorn.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
});
