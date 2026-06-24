---
phase: 09-web-dashboard-frontend-react-spa-on-hono-rpc
plan: "03"
subsystem: web-frontend-scaffold
tags: [vite, react, tailwind-v4, shadcn, tanstack-query, supabase, jsdom, vitest]
status: complete

dependency_graph:
  requires:
    - 09-01 (ESLint boundary wiring + tsconfig stub)
    - 09-02 (packages/quant leaf — workspace:* dep)
  provides:
    - apps/web/package.json (full dep set: react, tanstack, shadcn, visx, uplot, echarts, supabase)
    - apps/web/tsconfig.json (jsx:react-jsx, types:[], references contracts/shared/quant/server)
    - apps/web/vite.config.ts (react + tailwindcss plugins, @ alias, /api dev proxy)
    - apps/web/vite-env.d.ts (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_API_BASE_URL typed)
    - apps/web/index.html (Google Fonts Space Grotesk + JetBrains Mono)
    - apps/web/src/index.css (@theme Morai palette, @theme inline shadcn bridge, :root vars, body gradient)
    - apps/web/src/main.tsx (placeholder root wrapped in QueryClientProvider)
    - apps/web/components.json (shadcn initialized)
    - apps/web/src/components/ui/* (12 locked shadcn components)
    - apps/web/src/lib/queryClient.ts (QueryClient singleton)
    - apps/web/src/lib/supabase.ts (Supabase createClient singleton)
    - apps/web/src/lib/utils.ts (shadcn cn utility)
    - apps/web/vitest.config.ts (jsdom + react plugin + workspace aliases)
    - apps/web/src/main.smoke.test.tsx (RTL harness smoke test)
  affects:
    - Plan 09-04 (auth gate + RPC client — builds directly on this scaffold)
    - Plan 09-05 (Overview screen — builds on Plan 04 auth + this scaffold)
    - All future screen plans — foundation they build on

tech_stack:
  added:
    - react@^19.2.7 (React 19)
    - vite@^8.1.0 (build tool)
    - tailwindcss@^4.3.1 + @tailwindcss/vite@^4.3.1 (CSS-first v4)
    - shadcn@^4.11.0 (component scaffolder; copy-in components)
    - tw-animate-css@^1.4.0 (shadcn animation dependency)
    - @tanstack/react-query@^5.101.1 (server state / polling)
    - @supabase/supabase-js@^2.108.2 (SPA auth client)
    - hono@^4.12.23 (RPC client — matches server version)
    - @visx/shape + @visx/gradient + @visx/event + @visx/scale + @visx/axis + @visx/group + @visx/tooltip@^4.0.0
    - uplot@^1.6.32 + uplot-react@^1.2.4
    - echarts@^6.1.0 + echarts-for-react@^3.0.6
    - lucide-react (icons)
    - jsdom@^26.1.0 + @testing-library/react@^16.3.0 + @testing-library/user-event@^14.6.1 (dev)
  patterns:
    - Tailwind v4 CSS-first @theme (no config.js — RESEARCH Pattern 1)
    - @theme inline shadcn bridge to fix bg-background resolution (Pitfall 2)
    - shadcn copy-in component model (official registry only, no third-party)
    - QueryClient singleton with retry/staleTime defaults (RESEARCH Pattern 4)
    - Supabase createClient (not @supabase/ssr — pure Vite SPA, no SSR)
    - jsdom vitest config with name field for --project filter

key_files:
  created:
    - apps/web/package.json
    - apps/web/vite.config.ts
    - apps/web/vite-env.d.ts
    - apps/web/index.html
    - apps/web/components.json
    - apps/web/src/index.css
    - apps/web/src/main.tsx
    - apps/web/src/lib/queryClient.ts
    - apps/web/src/lib/supabase.ts
    - apps/web/src/lib/utils.ts
    - apps/web/src/components/ui/badge.tsx
    - apps/web/src/components/ui/button.tsx
    - apps/web/src/components/ui/card.tsx
    - apps/web/src/components/ui/dialog.tsx
    - apps/web/src/components/ui/input.tsx
    - apps/web/src/components/ui/separator.tsx
    - apps/web/src/components/ui/skeleton.tsx
    - apps/web/src/components/ui/slider.tsx
    - apps/web/src/components/ui/tabs.tsx
    - apps/web/src/components/ui/textarea.tsx
    - apps/web/src/components/ui/toggle-group.tsx
    - apps/web/src/components/ui/toggle.tsx
    - apps/web/src/components/ui/tooltip.tsx
    - apps/web/vitest.config.ts
    - apps/web/src/main.smoke.test.tsx
  modified:
    - apps/web/tsconfig.json (expanded from stub: jsx, types:[], ignoreDeprecations, baseUrl+paths)
    - eslint.config.js (add vite.config.ts to typed-lint ignores)
    - bun.lock (new workspace deps)

decisions:
  - "shadcn init rewrites :root to oklch light-mode defaults — override every :root var with Morai palette hex values directly; @theme inline bridge required for bg-background utility resolution (Pitfall 2)"
  - "tsconfig baseUrl deprecated in TS6 — use ignoreDeprecations:6.0 to silence; shadcn init requires @/* path alias"
  - "apps/web/vite.config.ts excluded from typed ESLint lint (not in tsconfig scope) via ignores in eslint.config.js"
  - "toggle-group.tsx as cast and supabase.ts as string casts are accepted exceptions — eslint-disable-next-line on specific lines only"
  - "vitest project name:'web' required for --project web filter; auto-discovered by root apps/*/vitest.config.ts glob"

metrics:
  duration: "13min"
  completed: "2026-06-24"
  tasks_completed: 3
  tasks_total: 3
  files_created: 25
  files_modified: 3
---

# Phase 09 Plan 03: apps/web Scaffold — Vite + React + Tailwind v4 + shadcn + QueryClient + Supabase + jsdom

Buildable, lint-clean, test-ready `apps/web` shell with the Tailwind v4 Morai palette, 12 shadcn components, TanStack Query provider, Supabase Auth client, and jsdom vitest config.

## What Was Built

**Task 1 — apps/web build scaffold (commit e905174)**

Created the full apps/web workspace: `package.json` (hono ^4.12.23 matching server, @tanstack/react-query, @supabase/supabase-js, @visx/* 7-package set, uplot + uplot-react, echarts + echarts-for-react, @morai/quant workspace:*), `tsconfig.json` (types:[], jsx:react-jsx, DOM lib, references contracts/shared/quant/server), `vite.config.ts` (react() + tailwindcss() plugins, @ alias, /api dev proxy), `vite-env.d.ts` (typed VITE_* env vars), `index.html` (Space Grotesk + JetBrains Mono via Google Fonts), `src/index.css` (@theme Morai palette with all 19 locked tokens including --color-violet:#a78bfa, @theme inline shadcn bridge, :root shadcn vars, body radial-gradient), `src/main.tsx` (placeholder root). `vite build` exits 0, produces `dist/`.

**Task 2 — shadcn init + 12 locked components + singletons (commit ce89aa0)**

Ran `npx shadcn@latest init` producing `components.json`. Added all 12 locked components: card, tabs, slider, toggle-group, dialog, input, textarea, badge, tooltip, skeleton, separator, button. Reconciled shadcn-generated `:root` (oklch light-mode defaults) with Morai dark palette hex values — every shadcn var now resolves to the locked Morai token. `@theme inline` bridge ensures `bg-background`, `border-border`, etc. resolve to Morai colors via Tailwind v4's `--color-*` namespace (Pitfall 2 fix). Created `src/lib/queryClient.ts` (QueryClient singleton: retry:3, exponential retryDelay capped 30s, refetchOnWindowFocus:true, staleTime:20s). Created `src/lib/supabase.ts` (createClient singleton reading VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY). Updated `main.tsx` to wrap root in `QueryClientProvider`. Fixed lint: vite.config.ts added to typed-lint ignores; eslint-disable-next-line on shadcn toggle-group as cast and supabase as string casts. `typecheck + lint + build` all pass.

**Task 3 — jsdom vitest config + RTL smoke test (commit 216352c)**

Created `apps/web/vitest.config.ts`: defineConfig with `@vitejs/plugin-react`, `test.environment: "jsdom"`, `test.globals: false`, `test.name: "web"` (for `--project web` filter), resolve aliases for @, @morai/contracts, @morai/quant, @morai/shared. Created `src/main.smoke.test.tsx`: RTL smoke test rendering a trivial element and asserting its presence — proves the jsdom + RTL pipeline works. `vitest run --project web` exits 0 (1 file, 1 test). Auto-discovered by root `apps/*/vitest.config.ts` glob — no root config change needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] shadcn init requires @/* path alias in tsconfig**

- **Found during:** Task 2 shadcn init
- **Issue:** `npx shadcn@latest init --defaults` failed with "Could not find valid path aliases or package imports for init." shadcn init requires `@/*` alias to resolve `@/components/ui/*` imports in generated component files.
- **Fix:** Added `"baseUrl": ".", "paths": { "@/*": ["./src/*"] }` to `apps/web/tsconfig.json`. TypeScript 6 deprecates `baseUrl` — added `"ignoreDeprecations": "6.0"` to silence the error. Also updated `vite.config.ts` to use `resolve.alias: { "@": "/src" }` (already present from Task 1 — no change needed).
- **Files modified:** `apps/web/tsconfig.json`
- **Commit:** included in ce89aa0

**2. [Rule 2 - Auto-add] ESLint typed-lint ignores for vite.config.ts**

- **Found during:** Task 2 lint verification
- **Issue:** `apps/web/vite.config.ts` is in the `apps/**/*.ts` glob for typed lint rules but is NOT in `apps/web/tsconfig.json`'s source scope (it's a build config, not src/ code). ESLint reported a parse error: "parserOptions.project has been provided but the file was not found in any of the provided project(s)".
- **Fix:** Added `"apps/web/vite.config.ts"` to the `ignores` array of the typed-lint ESLint block in `eslint.config.js`. This matches the existing pattern used for `**/vitest.config.ts`.
- **Files modified:** `eslint.config.js`
- **Commit:** included in ce89aa0

**3. [Rule 3 - Blocking] shadcn-generated toggle-group.tsx uses `as React.CSSProperties` cast**

- **Found during:** Task 2 lint verification
- **Issue:** shadcn-generated `src/components/ui/toggle-group.tsx` uses `{ "--gap": spacing } as React.CSSProperties` — blocked by the `@typescript-eslint/consistent-type-assertions: ["error", { assertionStyle: "never" }]` rule.
- **Fix:** Added `// eslint-disable-next-line @typescript-eslint/consistent-type-assertions` on the line before the cast. This is the minimum-impact fix for generated shadcn code we cannot rewrite (it's a CSS custom property assignment requiring the cast).
- **Files modified:** `apps/web/src/components/ui/toggle-group.tsx`
- **Commit:** included in ce89aa0

**4. [Rule 2 - Auto-add] vitest `name` field required for `--project web` filter**

- **Found during:** Task 3 vitest run
- **Issue:** `vitest run --project apps/web` failed with "No projects matched the filter". In vitest v4, the `--project` filter matches `test.name`, not the config file path.
- **Fix:** Added `test.name: "web"` to `apps/web/vitest.config.ts`. The VALIDATION.md quick-run command uses `--project apps/web` — the actual working filter is `--project web`. This is documented in the Summary decisions.
- **Files modified:** `apps/web/vitest.config.ts`
- **Commit:** included in 216352c

## Verification Results

```
cd apps/web && bun run build     → exit 0 (dist/ produced, 215KB JS, 43KB CSS)
vitest run --project web          → 1 test file, 1 test, exit 0 (RTL smoke passes)
bun run typecheck (apps/web)      → exit 0, no errors
bun run lint (root)               → exit 0, no errors (only pre-existing legacy selector warnings)
bun run test (root workspace)     → 117 test files, 1110 tests, all pass
```

## Known Stubs

- `apps/web/src/main.tsx` — Placeholder component instead of real App/auth gate. Plan 04 replaces this with the auth gate (Supabase session check) and App.tsx routing to Shell.

This stub does not prevent this plan's goal (scaffold foundation). Plan 04 is explicitly marked as the plan that adds the auth gate.

## Self-Check: PASSED

- `apps/web/package.json` — exists, contains @tanstack/react-query, @supabase/supabase-js, @tailwindcss/vite, @visx/shape, uplot, echarts, @morai/quant workspace:*
- `apps/web/src/index.css` — exists, contains @theme with --color-violet: #a78bfa and full palette
- `apps/web/tsconfig.json` — exists, types:[], references ../server and ../../packages/quant
- `apps/web/components.json` — exists (shadcn initialized)
- `apps/web/src/components/ui/` — 13 files (12 locked components + toggle.tsx dependency)
- `apps/web/src/lib/queryClient.ts` — exists, exports QueryClient with retry:3
- `apps/web/src/lib/supabase.ts` — exists, exports supabase via createClient
- `apps/web/src/main.tsx` — exists, contains QueryClientProvider
- `apps/web/vitest.config.ts` — exists, contains jsdom environment
- `apps/web/src/main.smoke.test.tsx` — exists, RTL smoke test
- Commits e905174, ce89aa0, 216352c — verified in git log
