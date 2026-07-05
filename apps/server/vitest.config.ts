import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolve @morai/* workspace packages to their source.
    // Vite (used by vitest) reads 'main' or 'exports', not the 'module' field.
    // Adding 'main': 'src/index.ts' to each package.json fixes resolution,
    // but we also keep aliases here for belt-and-suspenders coverage.
    alias: {
      "@morai/shared": new URL(
        "../../packages/shared/src/index.ts",
        import.meta.url,
      ).pathname,
      "@morai/contracts": new URL(
        "../../packages/contracts/src/index.ts",
        import.meta.url,
      ).pathname,
      // More-specific subpath alias MUST precede the bare @morai/core alias (Vite matches
      // in order) so the @morai/core/rule-tags subpath (WR-03) resolves to the value module.
      "@morai/core/rule-tags": new URL(
        "../../packages/core/src/journal/domain/rule-tags.ts",
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
    name: "server",
    globals: false,
    // Default timeout for unit tests.
    // STRM-04 regression test and any future contract tests use per-test overrides.
    testTimeout: 10_000,
    hookTimeout: 10_000,
    // Shared globalSetup with packages/adapters: spins a Postgres testcontainer once
    // and provides "dbUrl" via inject() for contract/regression tests.
    // Tests that don't use inject("dbUrl") are unaffected.
    globalSetup: ["../../packages/adapters/test/globalSetup.ts"],
  },
});
