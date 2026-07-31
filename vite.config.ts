import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "localhost",
  },
  preview: {
    host: "localhost",
  },
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
  },
});
