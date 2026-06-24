# Phase 9: Web Dashboard Frontend — Pattern Map

**Mapped:** 2026-06-24
**Files analyzed:** 22 new/modified files
**Analogs found:** 14 / 22 (8 frontend artifacts have no in-repo analog — see "No Analog Found")

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/quant/package.json` | config | — | `packages/shared/package.json` | exact |
| `packages/quant/tsconfig.json` | config | — | `packages/shared/tsconfig.json` | exact |
| `packages/quant/src/bsm.ts` | utility (pure math) | transform | `packages/core/src/journal/domain/bsm.ts` | exact (relocated) |
| `packages/quant/src/index.ts` | config (barrel) | — | `packages/shared/src/index.ts` | exact |
| `packages/quant/src/bsm.test.ts` | test | transform | `packages/core/src/journal/domain/bsm.test.ts` | exact (ported) |
| `apps/web/package.json` | config | — | `apps/server/package.json` | role-match |
| `apps/web/tsconfig.json` | config | — | `apps/server/tsconfig.json` | role-match |
| `apps/web/vite.config.ts` | config | — | no analog (Vite is new) | none |
| `apps/web/vitest.config.ts` | config | — | `packages/core/vitest.config.ts` | role-match |
| `apps/web/src/lib/rpc.ts` | utility | request-response | `apps/server/src/main.ts` (AppType export) | partial (type consumer) |
| `apps/web/src/lib/supabase.ts` | utility | request-response | no analog | none |
| `apps/web/src/lib/queryClient.ts` | config | — | no analog | none |
| `apps/web/src/hooks/useStatus.ts` | hook | request-response | no analog (TanStack Query new) | none |
| `apps/web/src/hooks/useGex.ts` | hook | request-response | same as useStatus | none |
| `apps/web/src/hooks/usePositions.ts` | hook | request-response | same as useStatus | none |
| `apps/web/src/hooks/useJournal.ts` | hook | request-response | same as useStatus | none |
| `apps/web/src/App.tsx` | component | request-response | no analog (React new) | none |
| `apps/web/src/screens/*.tsx` | component | request-response | no analog | none |
| `apps/web/src/components/Shell.tsx` | component | event-driven | no analog | none |
| `apps/web/src/components/charts/*.tsx` | component | transform | no analog (chart libs new) | none |
| `apps/web/src/index.css` | config | — | no analog (Tailwind v4 new) | none |
| `apps/web/vercel.json` | config | — | no analog | none |
| `docs/architecture/stack-decisions.md` | doc | — | itself (update) | exact |
| `docs/architecture/monorepo-layout.md` | doc | — | itself (update) | exact |
| `eslint.config.js` | config | — | itself (update) | exact |
| `packages/contracts/src/index.ts` | config (barrel) | — | itself (update) | exact |

---

## Pattern Assignments

### `packages/quant/package.json` (config)

**Analog:** `packages/shared/package.json` (lines 1-12)

```json
{
  "name": "@morai/shared",
  "version": "0.0.1",
  "module": "src/index.ts",
  "main": "src/index.ts",
  "types": "dist/index.d.ts",
  "private": true,
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^6"
  }
}
```

**Copy this exactly**, replacing `@morai/shared` with `@morai/quant`. Zero runtime dependencies (pure leaf — no `"dependencies"` key at all). `devDependencies` identical.

---

### `packages/quant/tsconfig.json` (config)

**Analog:** `packages/shared/tsconfig.json` (lines 1-10)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/__fixtures__/**", "src/**/*.test.ts"]
}
```

**Copy exactly.** No `"references"` needed — `packages/quant` is a pure leaf (nothing it imports). This is the canonical pure-leaf tsconfig shape.

---

### `packages/quant/src/bsm.ts` (utility, transform)

**Analog:** `packages/core/src/journal/domain/bsm.ts` (lines 1-174 — the whole file)

This is a **relocation**, not a rewrite. The file is already zero-import — copy it verbatim. Key characteristics to preserve:

**File header** (lines 1-14): JSDoc with A&S reference, display-convention table, D-04/D-12 references. Keep intact so the history and calibration rationale travel with the kernel.

**Exported surface** (lines 50-65, 83-102, 116-146, 162-173):
```typescript
export type BsmGreeks = { readonly delta: number; readonly gamma: number; readonly theta: number; readonly vega: number }
export function bsmPrice(S, K, T, sigma, r, q, type: "C" | "P"): number
export function bsmGreeks(S, K, T, sigma, r, q, type: "C" | "P"): BsmGreeks
export function bsmVega(S, K, T, sigma, r, q): number
```

No `any`, no `as`, no `!` — already compliant. The private helpers `ncdf`/`npdf` are unexported; keep them unexported.

---

### `packages/quant/src/index.ts` (barrel)

**Analog:** `packages/shared/src/index.ts` (lines 1-10)

```typescript
// Shared kernel — cross-cutting primitives for @morai/shared.
export type { Ok, Err, Result } from "./result.ts";
export { ok, err, isOk, isErr } from "./result.ts";
export { assertDefined } from "./assert.ts";
```

**Pattern:** one comment line naming the package purpose, then named re-exports using `export type { ... }` for types and `export { ... }` for values. `verbatimModuleSyntax: true` in `tsconfig.base.json` requires this split.

For `packages/quant/src/index.ts`:
```typescript
// BSM kernel — pure math leaf for @morai/quant. No I/O, no deps.
export type { BsmGreeks } from "./bsm.ts";
export { bsmPrice, bsmGreeks, bsmVega } from "./bsm.ts";
```

---

### `packages/quant/src/bsm.test.ts` (test, transform)

**Analog:** `packages/core/src/journal/domain/bsm.test.ts` (lines 1-295 — full file)

**This is the parity baseline test.** Port all fixtures and fast-check properties directly. The test imports change from `"./bsm.ts"` to `"./bsm.ts"` (same relative path, now in quant). The test body is identical — same oracle values, same tolerance `TOL = 1e-4`, same fast-check properties with `numRuns: 1000`.

**Import pattern** (lines 8-12):
```typescript
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { bsmPrice, bsmGreeks, bsmVega } from "./bsm.ts";
import type { BsmGreeks } from "./bsm.ts";
```

**fast-check pattern** (lines 189-254): `fc.float({ min: Math.fround(N), max: Math.fround(N), noNaN: true })` — the `Math.fround()` wrapper is mandatory for fast-check v4 (32-bit float bounds constraint). Copy this pattern for any new property tests in quant.

**Additional test to add** (not in the analog): IV bisection round-trip property — `bsmVega` is used as the Newton-Raphson denominator in TOS paste parser IV inversion. Add a property test verifying `bsmPrice(bsmVega(...)) ≈ targetPrice` once IV bisection logic is written.

---

### `apps/web/package.json` (config)

**Analog:** `apps/server/package.json` (lines 1-26)

```json
{
  "name": "@morai/server",
  "version": "0.0.1",
  "module": "src/main.ts",
  "private": true,
  "dependencies": {
    "@morai/adapters": "workspace:*",
    "@morai/contracts": "workspace:*",
    ...
    "hono": "^4.12.23"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^6"
  },
  "scripts": { "dev": "bun run --watch src/main.ts" }
}
```

**Pattern to copy:** `"name": "@morai/web"`, `"version": "0.0.1"`, `"module": "src/main.tsx"`, `"private": true`. Workspace deps use `"workspace:*"`. For web: add `"@morai/contracts": "workspace:*"`, `"@morai/quant": "workspace:*"`. **Critical:** `hono` version in `apps/web` must exactly match `apps/server` — currently `^4.12.23` (resolves to `4.12.27`). Mismatched hono versions break `hc<AppType>()` type inference.

**Scripts pattern:**
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "typecheck": "tsc --noEmit"
}
```

---

### `apps/web/tsconfig.json` (config)

**Analog:** `apps/server/tsconfig.json` (lines 1-15)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../../packages/core" },
    { "path": "../../packages/adapters" },
    { "path": "../../packages/contracts" },
    { "path": "../../packages/shared" }
  ]
}
```

**For `apps/web/tsconfig.json`:** same shape, different references:
```json
"references": [
  { "path": "../../packages/contracts" },
  { "path": "../../packages/shared" },
  { "path": "../../packages/quant" },
  { "path": "../server" }
]
```

The `../server` reference is required for the `import type { AppType }` in `src/lib/rpc.ts`. The `verbatimModuleSyntax: true` in `tsconfig.base.json` enforces that non-runtime imports use `import type` — failing to do so causes a build error. Note: `tsconfig.base.json` also sets `"types": ["bun"]` globally; `apps/web` needs `"types": []` in its `compilerOptions` to remove the bun types (Vite SPA uses browser globals, not Bun).

---

### `apps/web/vitest.config.ts` (config)

**Analog:** `packages/core/vitest.config.ts` (lines 1-14)

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@morai/shared": new URL("../shared/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    globals: false,
  },
});
```

**Pattern:** `defineConfig` from `vitest/config`, resolve aliases for workspace packages (Vite/Vitest needs explicit aliases because workspace packages use `"module"` not `"exports"`). For `apps/web`, add aliases for `@morai/contracts`, `@morai/quant`. The root `vitest.config.ts` auto-discovers via `"apps/*/vitest.config.ts"` glob — no change needed to the root config.

Also add `{ "path": "../../packages/quant" }` and `{ "path": "../server" }` to the project list in `eslint.config.js` resolver settings (lines 32-40) when the new packages/apps land.

---

### `apps/web/src/lib/rpc.ts` (utility, request-response)

**Analog:** `apps/server/src/main.ts` lines 251-254 (AppType export) + lines 194-214 (chained router pattern)

```typescript
// From apps/server/src/main.ts line 254:
export type AppType = typeof app;

// Chained router pattern (lines 197-206) — required for AppType type inference:
const apiRouter = new Hono()
  .route("/", statusRoutes(getStatus))
  .route("/", calendarRoutes(...))
  .route("/", journalRoutes(getJournal))
  .route("/", brokerageRoutes(...))
  .route("/", analyticsRoutes(...))
  .route("/analytics", gexRoutes(getGex));
```

The `rpc.ts` file consumes this type. **Critical pattern from RESEARCH.md Pattern 3:**
```typescript
import { hc } from 'hono/client'
import type { AppType } from '../../apps/server/src/main.ts'  // type-only — MANDATORY

let _supabaseSession: string | null = null

export function setAuthToken(token: string | null) {
  _supabaseSession = token
}

export const rpc = hc<AppType>(import.meta.env.VITE_API_BASE_URL as string, {
  headers: () => ({
    ..._supabaseSession ? { Authorization: `Bearer ${_supabaseSession}` } : {},
    'Content-Type': 'application/json',
  }),
})
```

`verbatimModuleSyntax: true` (from `tsconfig.base.json` line 8) enforces `import type` at compile time — a non-type import of the server module fails the build. This is the enforcement mechanism that prevents bundling server runtime code.

---

### `eslint.config.js` updates (config — modify existing file)

**Analog:** `eslint.config.js` lines 43-70 (boundaries element + rules blocks)

**Two updates required:**

1. Add `quant` element type to `"boundaries/elements"` (after line 44):
```javascript
{ type: "quant", pattern: "**/packages/quant/src/**", mode: "full" },
```

2. Add `"quant"` to the allow list for `core` and `apps` element types (lines 63, 69):
```javascript
{ from: "core",  allow: ["shared", "quant", "core"] },
{ from: "apps",  allow: ["adapters", "core", "contracts", "shared", "quant", "apps"] },
```

3. Add new tsconfig paths to the resolver `project` array (lines 32-39) and the typed rules block (lines 104-112):
```javascript
"packages/quant/tsconfig.json",
"apps/web/tsconfig.json",
```

4. Add `apps/web` to the typed-lint block's `files` glob and `parserOptions.project` list.

---

### `packages/core/src/journal/domain/bsm.ts` (modify existing — add re-export)

**After extraction to `packages/quant`**, this file changes from source-of-truth to a re-export shim. **Pattern for re-export shim** (mirrors how `packages/shared/src/index.ts` works):

```typescript
// Re-export from the canonical leaf — @morai/quant owns this file now.
// This shim keeps existing core import sites working without change.
export type { BsmGreeks } from "@morai/quant";
export { bsmPrice, bsmGreeks, bsmVega } from "@morai/quant";
```

Alternatively, update all call sites in `packages/core/src/` that import `bsmPrice`/`bsmGreeks`/`bsmVega` from `./bsm.ts` to import from `@morai/quant` directly. Search with:
```bash
rg "from.*bsm" packages/core/src/ --type ts
```

The shim approach requires zero call-site changes and is lower risk for the kernel extraction step.

---

### `packages/core/tsconfig.json` (modify — add quant reference)

**Analog:** `apps/server/tsconfig.json` references block (lines 9-14)

Add to `packages/core/tsconfig.json`:
```json
{ "path": "../quant" }
```

This is already the established pattern for workspace package references.

---

## Shared Patterns

### Barrel Index (pure-export)

**Source:** `packages/shared/src/index.ts` (lines 1-10)
**Apply to:** `packages/quant/src/index.ts`, any new `packages/contracts/src/` additions

Pattern: one descriptive comment, then `export type { ... }` for type-only exports and `export { ... }` for value exports, all referencing `.ts` extensions explicitly (required by `allowImportingTsExtensions: true` in tsconfig.base.json).

### Pure-Leaf Package Structure

**Source:** `packages/shared/` (package.json + tsconfig.json + src/index.ts)
**Apply to:** `packages/quant/`

Shape: `name: "@morai/X"`, `module: "src/index.ts"`, `composite: true` tsconfig, no runtime dependencies, `devDependencies` = `@types/bun` + `typescript` only.

### TypeScript strict compliance

**Source:** `tsconfig.base.json` (lines 1-21) + `eslint.config.js` (lines 119-127)
**Apply to:** ALL new `.ts` / `.tsx` files

Every file must satisfy:
- No `any` — `unknown` + Zod narrowing instead
- No `as` type assertions — `import type` uses `as string` on `import.meta.env.*` only because Vite env types require it; acceptable exception
- No `!` — use optional chaining or explicit branch
- `verbatimModuleSyntax: true` enforces `import type` for type-only imports at compile time
- `readonly` on domain types

### Vitest fast-check property tests for numerical code

**Source:** `packages/core/src/journal/domain/bsm.test.ts` (lines 189-295)
**Apply to:** `packages/quant/src/bsm.test.ts`, `apps/web/src/lib/tos-parser.test.ts`

Pattern:
```typescript
import fc from "fast-check";
// fc.float MUST use Math.fround() bounds (fast-check v4 requirement):
fc.float({ min: Math.fround(500), max: Math.fround(8000), noNaN: true })
// numRuns: 1000 for all property tests:
fc.assert(fc.property(...), { numRuns: 1000 })
```

### Zod parse-don't-cast at API boundaries

**Source:** `packages/contracts/src/gex.test.ts` (lines 37-106) showing the contract test pattern
**Apply to:** Any new Zod schema in `packages/contracts/src/`, and any `res.json()` parsing in hooks

All API responses parsed through the contract Zod schema before use. Never `res.json() as SomeType` — always `schema.parse(await res.json())`.

### Root vitest workspace auto-discovery

**Source:** `vitest.config.ts` (lines 6-9)
```typescript
test: {
  projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"],
}
```

The glob already matches `apps/web/vitest.config.ts` and `packages/quant/vitest.config.ts`. No changes needed to the root config once those files exist.

---

## No Analog Found

These files are **genuinely new** — no in-repo analog exists. Planner must reference RESEARCH.md patterns and the mockup HTML files as the oracle.

| File | Role | Data Flow | Reason | Oracle |
|------|------|-----------|--------|--------|
| `apps/web/vite.config.ts` | config | — | Vite is new to the project | RESEARCH.md Pattern 1 |
| `apps/web/src/index.css` | config | — | Tailwind v4 `@theme` is new | RESEARCH.md Pattern 1 |
| `apps/web/src/lib/supabase.ts` | utility | request-response | No auth client in repo | RESEARCH.md Pattern 5 |
| `apps/web/src/lib/queryClient.ts` | config | — | TanStack Query is new | RESEARCH.md Pattern 4 |
| `apps/web/src/hooks/use*.ts` | hook | request-response | TanStack Query hooks are new | RESEARCH.md Pattern 4 |
| `apps/web/src/App.tsx` | component | request-response | React is new to the project | RESEARCH.md Pattern 5 code example |
| `apps/web/src/screens/*.tsx` | component | request-response | React components are new | `09-UI-SPEC.md` screen contracts + `mockups/*.html` |
| `apps/web/src/components/Shell.tsx` | component | event-driven | React components are new | `09-UI-SPEC.md` global/sticky-header spec |
| `apps/web/src/components/charts/PayoffChart.tsx` | component | transform | visx is new | RESEARCH.md Pattern 7 + `mockups/analyzer-v1.html` |
| `apps/web/src/components/charts/GreekStrips.tsx` | component | transform | uPlot is new | RESEARCH.md Pattern 8 + `mockups/analyzer-v1.html` |
| `apps/web/src/components/charts/GexBars.tsx` | component | transform | ECharts is new | RESEARCH.md Pattern 9 + `mockups/market-v1.html` |
| `apps/web/src/components/charts/PnlHeatmap.tsx` | component | transform | ECharts is new | RESEARCH.md Pattern 9 + `mockups/analyzer-v1.html` |
| `apps/web/src/components/charts/GammaProfile.tsx` | component | transform | visx is new | RESEARCH.md Pattern 7 + `mockups/market-v1.html` |
| `apps/web/src/lib/tos-parser.ts` | utility | transform | No parser in repo | `mockups/playground-v3.html` (reference implementation) |
| `apps/web/vercel.json` | config | — | Vercel is new | RESEARCH.md Pattern 10 |

**Primary mockup oracles:**
- `mockups/playground-v3.html` — complete TOS parser + BSM scenario engine + chart rendering (the "I want it like this" reference for Analyzer math)
- `mockups/analyzer-v1.html` — Analyzer screen layout, payoff chart z-order, greek strips, heatmap
- `mockups/overview-v1.html` — Overview 12-col grid, mini charts
- `mockups/positions-v1.html` — Positions screen layout, attribution waterfall
- `mockups/journal-v1.html` — Journal 3-column layout, lifecycle tabs, scrubber
- `mockups/market-v1.html` — Market screen, GEX bars, gamma profile
- `mockups/gex-snapshot.json` — GEX API response shape (oracle for contract parsing)

---

## Docs Updates (docs-before-code, D-01 + D-05)

These must land **before any code files** per `workflow.md` and `architecture-boundaries.md`.

| File | Change | Trigger |
|------|--------|---------|
| `docs/architecture/stack-decisions.md` | Add D21: `packages/quant` pure leaf extraction. Fix D3: Recharts → visx/uPlot/ECharts. Add D19 web host (Vercel) if not already present. | D-01, D-05 |
| `docs/architecture/monorepo-layout.md` | Add `packages/quant/` to workspace graph + layout table. Add `core → quant` and `web → quant` dependency edges. Add `apps/web` to apps table. | D-01 |

---

## Metadata

**Analog search scope:** `packages/shared/`, `packages/contracts/`, `packages/core/src/journal/domain/`, `apps/server/src/`, root `vitest.config.ts`, `eslint.config.js`, `tsconfig.base.json`
**Files scanned:** 16 source files
**Pattern extraction date:** 2026-06-24
