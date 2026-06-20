import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolve @morai/* workspace packages to their source.
    // Vite (used by vitest) reads 'main' or 'exports', not the 'module' field.
    alias: {
      "@morai/shared": new URL(
        "../../packages/shared/src/index.ts",
        import.meta.url,
      ).pathname,
      "@morai/core": new URL(
        "../../packages/core/src/index.ts",
        import.meta.url,
      ).pathname,
      "@morai/adapters": new URL(
        "../../packages/adapters/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    globals: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
