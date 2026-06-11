import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
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
