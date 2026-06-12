import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@morai/contracts": fileURLToPath(
        new URL("../contracts/src/index.ts", import.meta.url),
      ),
      "@morai/core": fileURLToPath(
        new URL("../core/src/index.ts", import.meta.url),
      ),
      "@morai/shared": fileURLToPath(
        new URL("../shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "packages/adapters",
    globals: false,
    // Docker startup can take up to 60s
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Single fork so all tests share the ONE container from globalSetup
    pool: "forks",
    singleFork: true,
    globalSetup: ["./test/globalSetup.ts"],
  },
});
