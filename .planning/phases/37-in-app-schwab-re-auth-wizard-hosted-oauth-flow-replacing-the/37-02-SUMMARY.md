---
phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the
plan: 02
subsystem: auth
tags: [zod, hexagonal, ports, sidecar-adapter, oauth]

requires:
  - phase: 37-01
    provides: reauth_nonces migration + docs-first OAuth mechanics decisions
provides:
  - Browser-facing Zod contracts for start/exchange re-auth operations (strict, no-leak)
  - Core reauth bounded context (ForStartingReauth/ForExchangingReauth ports + use-cases)
  - Sidecar HTTP adapter forwarding to the sidecar admin surface with the shared-secret header
affects: [37-05 (server proxy routes wire this adapter), 37-06 (web wizard parses these contracts)]

tech-stack:
  added: []
  patterns:
    - "ForVerbingNoun function-type driven ports for a new bounded context (reauth)"
    - "Thin passthrough use-case even for a capability with no extra logic (Pattern 4, mirrors makeEnqueueJobUseCase)"
    - "HTTP adapter with injected fetch, Zod safeParse at the boundary, Result mapping, constructor.name-only error logging (mirrors positions-reconciler.ts) — no memory/ twin for fetch adapters"

key-files:
  created:
    - packages/contracts/src/reauth.ts
    - packages/contracts/src/reauth.test.ts
    - packages/core/src/reauth/application/ports.ts
    - packages/core/src/reauth/application/startReauth.ts
    - packages/core/src/reauth/application/startReauth.test.ts
    - packages/core/src/reauth/application/exchangeReauth.ts
    - packages/core/src/reauth/application/exchangeReauth.test.ts
    - packages/core/src/reauth/index.ts
    - packages/adapters/src/sidecar/reauth-adapter.ts
    - packages/adapters/src/sidecar/reauth-adapter.test.ts
  modified:
    - packages/contracts/src/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "Adapter drops the sidecar-issued CSRF `state` before returning from startReauth — the port type only carries {authUrl}, so the nonce never crosses the TS boundary at all (belt-and-suspenders on top of the contract's .strict() no-leak invariant)."
  - "No packages/adapters/src/memory/ twin for the reauth ports — HTTP fetch adapters (chain-adapter.ts, positions-reconciler.ts precedent) are tested with an injected fake fetch, not an in-memory repo double; architecture-boundaries rule 8 applies to driven ports over a repo, not these."

patterns-established:
  - "Reauth bounded context directory shape (application/ports.ts + application/<useCase>.ts + index.ts barrel) mirrors exits/ exactly."

requirements-completed: [REAUTH-05]

coverage:
  - id: D1
    description: "Four strict Zod contracts (reauthStartRequest/Response, reauthExchangeRequest/Response) reject extra keys, notably a code/state echo on the exchange response"
    requirement: "REAUTH-05"
    verification:
      - kind: unit
        ref: "packages/contracts/src/reauth.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Core reauth ports + makeStartReauth/makeExchangeReauth passthrough use-cases, ok/err both propagate unchanged from the injected port"
    requirement: "REAUTH-05"
    verification:
      - kind: unit
        ref: "packages/core/src/reauth/application/startReauth.test.ts"
        status: pass
      - kind: unit
        ref: "packages/core/src/reauth/application/exchangeReauth.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Sidecar reauth adapter sends X-Sidecar-Admin-Token header, safeParses via contracts, maps 401/503/network/parse failures to Result, logs only constructor.name"
    requirement: "REAUTH-05"
    verification:
      - kind: unit
        ref: "packages/adapters/src/sidecar/reauth-adapter.test.ts"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-13
status: complete
---

# Phase 37 Plan 02: Reauth Contracts + Core Ports + Sidecar Adapter Summary

**Zod contracts (strict, no code/state leak) + core `reauth` bounded-context ports/use-cases + a sidecar HTTP adapter authenticating with an X-Sidecar-Admin-Token header — the full TS boundary stack the server proxy and web wizard will consume in later plans.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-13T11:19:00Z
- **Completed:** 2026-07-13T11:26:00Z
- **Tasks:** 3
- **Files modified:** 12 (10 created, 2 barrel edits)

## Accomplishments
- Four `.strict()` Zod schemas (`reauthStartRequest`, `reauthStartResponse`, `reauthExchangeRequest`, `reauthExchangeResponse`) with inferred types, registered in the contracts barrel — an extra key (code/state/redirectUrl echo) is rejected at parse time.
- A pure `reauth` bounded context in `@morai/core`: `ForStartingReauth`/`ForExchangingReauth` function-type ports plus thin `makeStartReauth`/`makeExchangeReauth` passthrough use-cases, imports only `@morai/shared`.
- `makeSidecarReauthAdapter` in `@morai/adapters`: POSTs to `/sidecar/admin/reauth/{start,exchange}` with an injected `fetch` and the `X-Sidecar-Admin-Token` header, Zod-safeParses through the Task-1 contracts, and maps every failure path (network throw, non-ok status, parse failure) to `Result` — logging only `error.constructor.name`, never the message/code/redirect URL.

## Task Commits

Each task was committed atomically (TDD RED confirmed before each GREEN):

1. **Task 1: Browser-facing re-auth Zod contracts** - `ef37a24` (feat)
2. **Task 2: Core reauth bounded context — ports + thin use-cases** - `95fb473` (feat)
3. **Task 3: Sidecar reauth HTTP adapter** - `0dc34a4` (feat)

_Note: each commit landed at green — the RED (failing import) step was run and confirmed before implementing, per task, but is not a separate commit (single-commit-at-green precedent, tdd.md)._

## Files Created/Modified
- `packages/contracts/src/reauth.ts` - four strict Zod schemas + inferred types
- `packages/contracts/src/reauth.test.ts` - 13 tests: valid/invalid + extra-key rejection per schema
- `packages/contracts/src/index.ts` - barrel export for the four reauth schemas/types
- `packages/core/src/reauth/application/ports.ts` - `ReauthApp`, `ReauthError`, `ForStartingReauth`, `ForExchangingReauth`
- `packages/core/src/reauth/application/startReauth.ts` + `.test.ts` - passthrough use-case + 2 tests
- `packages/core/src/reauth/application/exchangeReauth.ts` + `.test.ts` - passthrough use-case + 2 tests
- `packages/core/src/reauth/index.ts` - bounded-context barrel
- `packages/core/src/index.ts` - top-level barrel re-export for the reauth context
- `packages/adapters/src/sidecar/reauth-adapter.ts` - `makeSidecarReauthAdapter` (shared `postToSidecar` helper + per-endpoint mapping)
- `packages/adapters/src/sidecar/reauth-adapter.test.ts` - 6 tests: ok path + header assertion (both endpoints), 401/503 upstream-error, thrown-fetch network-error, malformed-body parse-error

## Decisions Made
- The adapter's `startReauth` explicitly narrows `ok({ authUrl: result.value.authUrl })` rather than spreading the full parsed response — the sidecar-issued CSRF `state` (needed server-side for the Postgres nonce round-trip elsewhere, not in this plan's scope) never crosses into the returned port value. Belt-and-suspenders on top of the contract layer's own `.strict()` no-leak enforcement (T-37-06).
- No `packages/adapters/src/memory/` twin was added for `ForStartingReauth`/`ForExchangingReauth` — confirmed via PATTERNS.md and the `chain-adapter.ts`/`positions-reconciler.ts` precedent that HTTP fetch adapters are tested with an injected fake `fetch`, not an in-memory repo double. `architecture-boundaries.md` rule 8 ("ship the in-memory twin") applies to driven ports over a Postgres repo, not to these.

## Deviations from Plan

None - plan executed exactly as written. All three tasks' TDD RED step was run and confirmed failing for the right reason (missing module) before implementing to green.

## Issues Encountered
- `bunx tsc --build packages/adapters --force` in isolation reported stale "no exported member" errors for `@morai/contracts`, because `packages/contracts/dist/index.d.ts` (resolved via the package's `types` field) predated the new `reauth.ts` export and wasn't rebuilt in dependency order. Running the project's canonical `bun run typecheck` (`tsc --build --force` from the repo root) rebuilt `contracts` before `adapters` and came back clean — not a real type error, just a build-order artifact of checking one leaf project in isolation.

## User Setup Required

None - no external service configuration required in this plan.

## Next Phase Readiness
- 37-05 (server proxy routes) can now import `makeSidecarReauthAdapter` from `@morai/adapters`, wire `SIDECAR_ADMIN_TOKEN` from config, and mount `makeStartReauth`/`makeExchangeReauth` behind the existing Supabase JWT group.
- 37-06 (web wizard) can import the four reauth contracts from `@morai/contracts` directly — no changes needed to this plan's output.
- No blockers. 37-03 (sidecar Python re-init plumbing) ran in parallel on disjoint files (`apps/sidecar/*.py`) with no conflicts observed.

---
*Phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the*
*Completed: 2026-07-13*

## Self-Check: PASSED
All 10 created source/test files and the SUMMARY.md itself confirmed present on disk; all 3 task commit hashes (ef37a24, 95fb473, 0dc34a4) confirmed in git log.
