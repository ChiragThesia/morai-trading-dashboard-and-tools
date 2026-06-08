import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolve @morai/shared to workspace source — Bun symlinks work but Vite needs
    // the alias because shared/package.json uses "module" not "main"/"exports".
    alias: {
      "@morai/shared": new URL("../shared/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    globals: false,
  },
});
