import { defineConfig } from "vitest/config";

// Vitest 4 removed the standalone `vitest.workspace.ts` file; projects are now
// declared here via `test.projects`. Each glob resolves the per-package configs
// (their globalSetup, aliases, pool settings, and timeouts apply per project).
export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"],
  },
});
