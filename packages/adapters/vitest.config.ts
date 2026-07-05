import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@morai/contracts": fileURLToPath(
        new URL("../contracts/src/index.ts", import.meta.url),
      ),
      // More-specific subpath alias MUST precede the bare @morai/core alias (Vite matches
      // in order) so the @morai/core/rule-tags subpath (WR-03) resolves to the value module
      // instead of being prefix-rewritten to src/index.ts/rule-tags.
      "@morai/core/rule-tags": fileURLToPath(
        new URL("../core/src/journal/domain/rule-tags.ts", import.meta.url),
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
    // Single fork so all tests share the ONE container from globalSetup.
    // fileParallelism: false ensures test FILES run sequentially within that fork,
    // preventing concurrent TRUNCATE statements from different files from wiping
    // each other's fixtures against the shared Postgres container.
    pool: "forks",
    singleFork: true,
    fileParallelism: false,
    globalSetup: ["./test/globalSetup.ts"],
  },
});
