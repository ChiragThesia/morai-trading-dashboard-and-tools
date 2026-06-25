import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Global ignores — these files are never linted in normal runs
  {
    ignores: [
      "node_modules/**",
      "**/dist/**",
      "**/*.tsbuildinfo",
      // Fixture files are only linted explicitly via --no-ignore in acceptance tests
      "**/__fixtures__/**",
      // Files outside TypeScript project scope
      ".remember/**",
      ".planning/**",
      // Agent worktrees + tooling — each worktree is a full repo copy with its
      // own config/node_modules; never lint them (same rationale as .planning).
      ".claude/**",
    ],
  },

  // Boundaries: register element types and enforce the hexagon law
  {
    plugins: { boundaries },
    settings: {
      // Use the TypeScript resolver so boundaries can follow @morai/* workspace imports
      // to their actual source paths (needed because Bun creates per-package symlinks,
      // not root-level node_modules/@morai/ symlinks).
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: [
            "packages/shared/tsconfig.json",
            "packages/contracts/tsconfig.json",
            "packages/core/tsconfig.json",
            "packages/adapters/tsconfig.json",
            "packages/quant/tsconfig.json",
            "apps/server/tsconfig.json",
            "apps/worker/tsconfig.json",
            "apps/web/tsconfig.json",
          ],
        },
      },
      "boundaries/elements": [
        { type: "shared",    pattern: "**/packages/shared/src/**",    mode: "full" },
        { type: "contracts", pattern: "**/packages/contracts/src/**", mode: "full" },
        { type: "core",      pattern: "**/packages/core/src/**",      mode: "full" },
        { type: "adapters",  pattern: "**/packages/adapters/src/**",  mode: "full" },
        { type: "quant",     pattern: "**/packages/quant/src/**",     mode: "full" },
        { type: "apps",      pattern: "**/apps/**",                   mode: "full" },
      ],
    },
    rules: {
      // boundaries/dependencies is the v6 name for the old boundaries/element-types rule.
      // String-based selector syntax is used (compatible with v6.0.2).
      "boundaries/dependencies": ["error", {
        default: "disallow",
        rules: [
          // shared: may only import from within shared itself (relative intra-package imports)
          { from: "shared",    allow: ["shared"] },
          // contracts: shared + intra-package relative imports (same pattern as shared→shared)
          { from: "contracts", allow: ["shared", "contracts"] },
          // quant: pure math leaf — imports nothing (self-only for intra-package relative imports)
          { from: "quant",     allow: ["quant"] },
          // core: shared + quant (BSM kernel leaf) + intra-package relative imports
          // External vendor imports (hono, drizzle, etc.) are blocked by no-restricted-imports below
          { from: "core",      allow: ["shared", "quant", "core"] },
          // adapters: core ports + shared + intra-package relative imports (same pattern as core→core)
          // Contract test files (*.contract.test.ts) additionally import from contracts to assert
          // the adapter output satisfies the published contract schema (cross-boundary test-only).
          { from: "adapters",  allow: ["contracts", "core", "shared", "adapters"] },
          // apps: composition roots — can import everything + intra-package relative imports
          // apps/web imports quant for client-side BSM live re-pricing (D21)
          { from: "apps",      allow: ["adapters", "core", "contracts", "shared", "quant", "apps"] },
        ],
      }],
    },
  },

  // Vendor package restriction for packages/core — boundaries plugin only enforces
  // monorepo-internal element types; external vendor imports need a separate rule.
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          "hono*",
          "drizzle*",
          "postgres",
          "@modelcontextprotocol*",
          "pg-boss*",
          "node:*",
        ],
      }],
    },
  },

  // TypeScript-ESLint strict rules — applies to all TS source files within tsconfig scope.
  // Test files (*.test.ts) are excluded from tsconfig emit but ARE type-checked via vitest's
  // own type resolution; they are excluded here to avoid "file not in project" parse errors
  // from the typed lint rules. The strict rules (no-any, no-as, no-!) still apply via the
  // per-file block below that uses project:false for test files.
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx", "apps/**/*.ts", "apps/**/*.tsx"],
    ignores: ["**/__fixtures__/**", "**/vitest.config.ts", "apps/web/vite.config.ts", "**/*.test.ts", "**/*.test.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [
          "packages/shared/tsconfig.json",
          "packages/contracts/tsconfig.json",
          "packages/core/tsconfig.json",
          "packages/adapters/tsconfig.json",
          "packages/quant/tsconfig.json",
          "apps/server/tsconfig.json",
          "apps/worker/tsconfig.json",
          "apps/web/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Test files, vitest config, contract harnesses, and globalSetup — not in tsconfig emit
  // scope; use project:false to avoid "file not in project" parse errors.
  // Applies syntactic strict rules only (no type-aware rules that need parserOptions.project).
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/vitest.config.ts",
      "**/__contract__/**/*.ts",
      "**/vitest.d.ts",
      "**/test/**/*.ts",
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: false,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      // Disable type-aware rules that require parserOptions.project
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/switch-exhaustiveness-check": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
    },
  },

  // Fixture files — syntactic-only TS rules (no type-aware parsing, files excluded from tsconfig)
  // Triggered only via explicit --no-ignore invocation; excluded from normal runs.
  {
    files: ["**/__fixtures__/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: false,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      // Syntactic rules that work without type info — these prove FND-02 and FND-03
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
);
