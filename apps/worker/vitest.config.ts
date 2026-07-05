import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // More-specific subpath alias MUST precede the bare @morai/core alias (Vite matches
      // in order) so the @morai/core/rule-tags subpath (WR-03) resolves to the value module.
      "@morai/core/rule-tags": fileURLToPath(
        new URL("../../packages/core/src/journal/domain/rule-tags.ts", import.meta.url),
      ),
      "@morai/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
      "@morai/adapters": fileURLToPath(
        new URL("../../packages/adapters/src/index.ts", import.meta.url),
      ),
      "@morai/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "apps/worker",
    globals: false,
  },
});
