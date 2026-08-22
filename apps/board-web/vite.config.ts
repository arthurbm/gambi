import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const boardProxyUrl = process.env.BOARD_PROXY_URL ?? "http://127.0.0.1:3001";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 3002,
    strictPort: true,
    proxy: {
      "/api-reference": boardProxyUrl,
      "/events": boardProxyUrl,
      "/rpc": boardProxyUrl,
      "/tiles": boardProxyUrl,
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
  ],
});
