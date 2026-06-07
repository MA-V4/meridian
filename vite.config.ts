import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Use relative paths in production build so Electron can load files
  base: command === "build" ? "./" : "/",
}));