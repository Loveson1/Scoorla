import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("firebase")) {
            return "firebase";
          }
          if (
            id.includes("jspdf") ||
            id.includes("html2canvas") ||
            id.includes("dompurify")
          ) {
            return "pdf";
          }
          if (
            id.includes("react") ||
            id.includes("react-dom") ||
            id.includes("react-router")
          ) {
            return "react-vendor";
          }
          return "vendor";
        },
      },
    },
  },
});
