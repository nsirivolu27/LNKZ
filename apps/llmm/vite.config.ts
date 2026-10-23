import { defineConfig } from "vite";

const api = "http://127.0.0.1:3100";

/**
 * Two entry points: the product site and the console. Inputs are relative to the
 * project root on purpose, so the config carries no path or filesystem imports
 * and behaves the same in a container as it does locally.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        console: "console.html",
      },
    },
  },
  server: {
    proxy: {
      "/api": api,
      "/share": api,
      "/health": api,
    },
  },
});
