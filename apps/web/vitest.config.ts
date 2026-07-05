import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Explicit workspace package aliases — Vite/Vitest needs these because workspace
    // packages expose "module" not "exports" (PATTERNS.md: Root vitest workspace auto-discovery)
    alias: {
      "@": resolve(__dirname, "src"),
      "@morai/contracts": resolve(__dirname, "../../packages/contracts/src/index.ts"),
      // More-specific subpath alias MUST precede the bare @morai/core alias (Vite matches
      // in order) so the @morai/core/rule-tags subpath (WR-03) resolves to the value module.
      "@morai/core/rule-tags": resolve(__dirname, "../../packages/core/src/journal/domain/rule-tags.ts"),
      "@morai/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      "@morai/quant": resolve(__dirname, "../../packages/quant/src/index.ts"),
      "@morai/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  test: {
    name: "web",
    environment: "jsdom",
    globals: false,
  },
});
