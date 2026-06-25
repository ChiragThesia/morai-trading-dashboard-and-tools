---
phase: 11-sidecar-scaffold-auth-migration
plan: "03"
subsystem: adapters/sidecar
tags: [tdd, sidecar, chain-adapter, ForFetchingChain, JRNL-02]
status: complete

dependency_graph:
  requires: ["11-01"]
  provides: ["makeSidecarChainAdapter", "makeMemorySidecarChainAdapter", "SidecarChainResponseSchema"]
  affects: ["11-06"]

tech_stack:
  added: []
  patterns:
    - "safeParse-at-boundary (SidecarChainResponseSchema) — adapter-local Zod (D-08)"
    - "adapter factory with injected fetch — enables Vitest swap without global.fetch patching"
    - "OCC brand via parseOccSymbol+formatOccSymbol — no 'as' assertion needed"
    - "in-memory twin (makeMemorySidecarChainAdapter) ships in same PR — architecture-boundaries §8"

key_files:
  created:
    - packages/adapters/src/sidecar/chain-adapter.ts
    - packages/adapters/src/memory/sidecar-chain.ts
    - packages/adapters/src/memory/sidecar-chain.test.ts
  modified:
    - packages/adapters/src/sidecar/chain-adapter.test.ts
    - packages/adapters/src/index.ts

decisions:
  - "D-08 enforced: SidecarChainResponseSchema + SidecarErrorBodySchema live in packages/adapters, not packages/contracts"
  - "OccSymbol branded via parseOccSymbol+formatOccSymbol round-trip instead of 'as OccSymbol' cast (typescript.md rule)"
  - "Error body parsed with SidecarErrorBodySchema.safeParse to avoid 'as' cast on resp.json() body"
  - "Test helper uses new Response(JSON.stringify(body)) constructor instead of 'as Response' cast (lint fix)"

metrics:
  duration: "~5 minutes"
  completed: "2026-06-25"
  tasks_completed: 4
  files_changed: 5

requirements_satisfied: [JRNL-02]
---

# Phase 11 Plan 03: Sidecar Chain Adapter — GREEN Summary

Sidecar chain HTTP-client adapter implementing `ForFetchingChain` via Zod-safeParse-at-boundary, plus its mandatory in-memory twin, turning the 11-01 RED scaffold green.

## What Was Built

**`packages/adapters/src/sidecar/chain-adapter.ts`**
- `SidecarErrorBodySchema` (Zod) — parses `{error: string}` from non-2xx response bodies without `as` assertions.
- `SidecarChainResponseSchema` (Zod, adapter-local D-08) — validates `/sidecar/chain` response shape.
- `makeSidecarChainAdapter(deps: {fetch, sidecarUrl})` — factory returning `{fetchChain: ForFetchingChain}`.
  - 503 `{error:"AUTH_EXPIRED"}` body → `err({kind:"fetch-error", message:"AUTH_EXPIRED"})`.
  - Network throw → `err({kind:"fetch-error", ...})` — adapter never throws.
  - Parse failure → `err` with `"sidecar chain parse error: ..."` message.
  - Valid response → `ok(RawChain)` with `source:"schwab_chain"`, `observedAt` and `quotes[].expiry` as `Date` objects.
  - OCC symbol branding via `parseOccSymbol+formatOccSymbol` round-trip (no `as OccSymbol` assertion).

**`packages/adapters/src/memory/sidecar-chain.ts`**
- `makeMemorySidecarChainAdapter()` — `Map<root, RawChain>` store with `seed(root, chain)` + `fetchChain(root)`.
- Unseeded root → `err({kind:"fetch-error", message:"Root not seeded: ..."})`.
- Satisfies architecture-boundaries §8 (D-07): twin ships in same PR as driven adapter.

**`packages/adapters/src/index.ts`** — barrel exports for both new adapters and the Zod schema.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | `chain-adapter.ts`: SidecarChainAdapter + SidecarChainResponseSchema (4 scaffold tests GREEN) | `955610e` |
| 2 | `sidecar-chain.ts` + `sidecar-chain.test.ts`: in-memory twin + 3 tests | `5f8d930` |
| 3 | `index.ts`: barrel exports for adapter + twin | `db0cf62` |
| 4 | Fix `as Response` cast in test helper → `new Response()` constructor (lint compliance) | `2674bf3` |

## Verification Results

```
bun run test packages/adapters/src/sidecar/chain-adapter.test.ts
  Test Files  1 passed (1)
  Tests  4 passed (4)

bun run test packages/adapters/src/memory/sidecar-chain.test.ts
  Test Files  1 passed (1)
  Tests  3 passed (3)

bun run typecheck  → clean
bun run lint       → clean (no errors; pre-existing boundary warnings only)
grep -n sidecar packages/adapters/src/index.ts → 5 matches
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 'as Response' type assertion in scaffold test file**
- **Found during:** Task 4 (lint verification after barrel exports)
- **Issue:** The 11-01 RED scaffold helper used `{ok, status, json} as Response` which triggers `@typescript-eslint/consistent-type-assertions: never`.
- **Fix:** Replaced with `new Response(JSON.stringify(body), {status, headers:{Content-Type:application/json}})` — real Response object, no cast.
- **Files modified:** `packages/adapters/src/sidecar/chain-adapter.test.ts`
- **Commit:** `2674bf3`

**2. [Rule 2 - Missing safety] Error body parsed with schema instead of 'as' cast**
- **Found during:** Task 1 implementation
- **Issue:** Reading `body.error` from an `unknown` JSON response requires narrowing. Initial approach used `as Record<string,unknown>`.
- **Fix:** Added `SidecarErrorBodySchema = z.object({error: z.string()})` and used `.safeParse()` to extract the error key — consistent with the Schwab adapter pattern.
- **Files modified:** `packages/adapters/src/sidecar/chain-adapter.ts`
- **Commit:** `955610e`

## Threat Surface Scan

All threat mitigations from the plan's threat model are implemented:

| Threat ID | Mitigation | Status |
|-----------|-----------|--------|
| T-11-03-01 | `SidecarChainResponseSchema.safeParse` at boundary; parse failure → err, never reaches core | Implemented |
| T-11-03-02 | Returns only `{kind, message}`; no token/secret material on chain path | Implemented |
| T-11-03-03 | Network error → `err({kind:'fetch-error'})`; adapter never throws | Implemented |

No new trust boundaries introduced beyond those in the plan's threat model.

## Self-Check

### Files Exist
- FOUND: `packages/adapters/src/sidecar/chain-adapter.ts`
- FOUND: `packages/adapters/src/memory/sidecar-chain.ts`
- FOUND: `packages/adapters/src/memory/sidecar-chain.test.ts`

### Commits Exist
- FOUND: `955610e` feat(11-03): implement SidecarChainAdapter
- FOUND: `5f8d930` feat(11-03): add makeMemorySidecarChainAdapter
- FOUND: `db0cf62` feat(11-03): export sidecar adapter + twin
- FOUND: `2674bf3` fix(11-03): replace 'as Response' in test helper

## Self-Check: PASSED
