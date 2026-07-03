---
phase: 17-overview-v2-redesign-iv-calibration-fix
plan: 01
subsystem: analytics
tags: [iv-calibration, bsm, result-type, fast-check, tdd]

# Dependency graph
requires:
  - phase: 08-web-dashboard-backend-gex-auth-rpc
    provides: apps/web/src/lib/position-greeks.ts (OCC-parse -> guard -> call-kernel -> Result shape mirrored here)
  - phase: 12-livestream-cascade
    provides: packages/core/src/streaming/recompute-live-greek.ts (mid-price resolution + error-tagging convention mirrored here)
provides:
  - resolveLegIv(occSymbol, spot, rate, divYield, liveTick, restMarketValue, netQty, now) — Result<number, CalibrationError>
  - CalibrationError type (IvError | {kind:"no-price"})
  - BSM_PARITY_TOLERANCE constant + OQ1 resolution (the two "BSM engines" are the same function)
affects: [17-02, 17-03, 17-04, overview-v2-redesign]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-side price->IV calibration wrapper around a frozen core solver (invertIv), never re-implementing the solver"
    - "Live-tick trust shortcut: an already-server-calibrated IV is trusted verbatim, keeping exactly one non-convergence code path"

key-files:
  created:
    - apps/web/src/lib/iv-calibration.ts
    - apps/web/src/lib/iv-calibration.test.ts
  modified:
    - apps/web/package.json (added @morai/core workspace dependency)
    - apps/web/tsconfig.json (added packages/core project reference)
    - apps/web/vitest.config.ts (added @morai/core alias, mirroring existing @morai/quant/@morai/shared aliases)

key-decisions:
  - "apps/web now depends on @morai/core (package.json + tsconfig references + vitest alias) — required to import the frozen invertIv solver from its package root per RESEARCH.md D-01; core is hexagon-pure (imports only @morai/shared per architecture-boundaries.md) so this stays browser-bundle-safe"
  - "OQ1 resolved without reconciliation: packages/core/src/journal/domain/bsm.ts is a re-export shim of @morai/quant's bsmPrice — the two BSM 'engines' are literally the same function, so BSM_PARITY_TOLERANCE (1e-6) only needs to absorb REST-fallback float round-trip noise, not genuine divergence"
  - "Round-trip property test compares via repricing (bsmPrice(sigma_recovered) vs mark, 1e-6 tolerance) rather than raw sigma equality — matches iv-inversion.test.ts's own convention and is robust to the mark*100/100 REST-fallback round-trip's floating-point noise (raw sigma comparison was flaky at ~2.3e-9 on a deep-ITM counterexample)"

patterns-established:
  - "Pitfall 2 trust-shortcut: when liveTick is present, return ok(liveTick.bsmIv) directly without calling invertIv — the server already ran invertIv and only emits on ok"
  - "Pitfall 3 REST-fallback guard: price = abs(marketValue) / (abs(netQty) * 100), only when marketValue !== null && netQty !== 0, else err({kind:'no-price'}) — never a 0/0 division"

requirements-completed: [OVW-02]

coverage:
  - id: D1
    description: "resolveLegIv calibrates a leg's IV via invertIv for the REST/cold-start path, and trusts an already-converged live tick's bsmIv directly — never DEFAULT_IV on any branch"
    requirement: "OVW-02"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/iv-calibration.test.ts#resolveLegIv — round-trip property (REST-fallback path)"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/iv-calibration.test.ts#resolveLegIv — live-tick trust shortcut (Pitfall 2)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Non-convergent (deep-ITM/illiquid) legs return a tagged IvError, distinct from the cold-start no-price state and the netQty===0 REST-fallback guard state"
    requirement: "OVW-02"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/iv-calibration.test.ts#resolveLegIv — non-convergence (deep-ITM / illiquid)"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/iv-calibration.test.ts#resolveLegIv — cold-start (Pitfall 2)"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/iv-calibration.test.ts#resolveLegIv — netQty===0 REST fallback (Pitfall 3)"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/iv-calibration.test.ts#resolveLegIv — expired leg"
        status: pass
    human_judgment: false
  - id: D3
    description: "OQ1 (do the two BSM engines agree?) resolved via smoke test without reconciling engines"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/iv-calibration.test.ts#resolveLegIv — BSM cross-engine parity smoke test (OQ1)"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-03
status: complete
---

# Phase 17 Plan 01: IV Calibration Wrapper Summary

**resolveLegIv() — a tagged, tested client-side price→IV bridge around the frozen `invertIv` core solver, replacing the flat DEFAULT_IV guess for OVW-02**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-03T22:00:00Z (approx.)
- **Completed:** 2026-07-03T22:10:00Z (approx.)
- **Tasks:** 2 (both TDD red→green)
- **Files modified:** 5 (2 created, 3 wiring edits)

## Accomplishments

- `resolveLegIv()` — the OVW-02 wiring bridge: turns a live SSE tick or REST-derived
  per-leg price into a calibrated IV via the already-shipped, production-hardened
  `invertIv` solver, or a tagged `err`. Never substitutes `DEFAULT_IV`.
- Distinct, tested error states: `expired`, `below-intrinsic`, `above-bound` (from
  `invertIv` itself, surfaced verbatim) and a wrapper-owned `no-price` state for
  cold-start legs and the guarded REST-fallback division (netQty===0 / marketValue===null).
- Live-tick trust shortcut (Pitfall 2): when a live SSE tick is present, its
  server-calibrated `bsmIv` is trusted directly — keeps exactly one non-convergence
  code path (the REST/cold-start branch), avoiding a redundant client-side solve.
- OQ1 (do the two BSM engines — core-internal and `@morai/quant` — agree?) resolved:
  `packages/core/src/journal/domain/bsm.ts` is a re-export shim of `@morai/quant`'s
  `bsmPrice`. They are the same function. `BSM_PARITY_TOLERANCE` (1e-6) is exported
  and the smoke test passes as regression insurance, not because two independent
  implementations happened to converge.
- Wired `apps/web` → `@morai/core` (package.json dependency, tsconfig project
  reference, vitest alias) so `invertIv`/`IvError` can be imported from the package
  root, per RESEARCH.md's explicit HIGH-confidence direction — not a deep relative
  import into `packages/core/src/journal/domain/`.

## Task Commits

Each task was committed atomically (TDD red→green):

1. **Task 1: resolveLegIv() — tagged price→IV wrapper**
   - RED: `d5bcbc3` — `test(17-01): add failing tests for resolveLegIv`
   - GREEN: `61fbaa0` — `feat(17-01): implement resolveLegIv price->IV wrapper`
2. **Task 2: BSM cross-engine parity smoke test (OQ1)**
   - RED: `edb804a` — `test(17-01): add BSM parity smoke test`
   - GREEN: `8a01259` — `feat(17-01): add BSM parity tolerance constant, resolve OQ1`

_Note: no REFACTOR commit — the implementation was already minimal after GREEN._

## Files Created/Modified

- `apps/web/src/lib/iv-calibration.ts` — `resolveLegIv()`, `LiveTick`, `CalibrationError`,
  `BSM_PARITY_TOLERANCE`. Pure function, no I/O, no `any`/`as`/`!`.
- `apps/web/src/lib/iv-calibration.test.ts` — fast-check round-trip property (REST-fallback
  path, 500 runs) + 6 unit tests (live-tick trust, non-convergence, cold-start, netQty===0,
  expired, BSM parity smoke test).
- `apps/web/package.json` — added `"@morai/core": "workspace:*"` dependency.
- `apps/web/tsconfig.json` — added `{ "path": "../../packages/core" }` project reference.
- `apps/web/vitest.config.ts` — added `"@morai/core"` alias (mirrors existing
  `@morai/quant`/`@morai/shared` aliases; workspace packages expose `module` not `exports`).

## Decisions Made

- **apps/web → @morai/core dependency wiring** (Rule 3 — blocking issue): the plan
  explicitly directs importing `invertIv`/`IvError` from `@morai/core`'s package root,
  but `apps/web` had no dependency on `@morai/core` in `package.json`/`tsconfig.json`.
  Added the workspace dependency, tsconfig reference, and vitest alias — mirroring the
  exact pattern already used for `@morai/quant`/`@morai/shared`. `packages/core` is
  hexagon-pure (imports only `@morai/shared`, no node builtins/`process.env`/vendor SDKs
  per `architecture-boundaries.md`), so this stays browser-bundle-safe; this extends the
  same client-side-kernel-reuse pattern (D-01) already established for `@morai/quant` in
  `position-greeks.ts`/`scenario-engine.ts`, not a new architectural swap.
- **Round-trip property test compares via repricing, not raw sigma equality**: the
  initial implementation compared `wrapped.value === direct.value` within `1e-9` and hit
  a fast-check counterexample (deep-ITM put, S≈1838, K≈5711) where the two sigmas
  differed by ~2.3e-9 — floating-point noise from the REST-fallback's `mark * 100` then
  `/ 100` round-trip, amplified slightly through Newton-Raphson. Switched to comparing
  `bsmPrice(sigma_recovered)` against the original mark within `1e-6`, matching
  `iv-inversion.test.ts`'s own established round-trip tolerance. This is a test-quality
  fix (Rule 1), not a production-code change.
- **OCC-parse failure maps to `err({kind:"no-price"})`**: `CalibrationError` is a fixed
  union (`IvError | {kind:"no-price"}`) with no `bad-symbol` variant. A malformed
  `occSymbol` genuinely cannot be priced, so it maps to the closest existing tag
  (`no-price`) rather than introducing a new error kind outside the plan's frozen
  contract. Not separately unit-tested (not in the plan's `<behavior>` list); documented
  here for traceability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added apps/web → @morai/core workspace dependency**
- **Found during:** Task 1 (writing the RED test, before any implementation)
- **Issue:** `apps/web/package.json` had no `@morai/core` dependency, `tsconfig.json` had
  no project reference to `packages/core`, and `vitest.config.ts` had no alias for it —
  `import { invertIv } from "@morai/core"` would fail to resolve.
- **Fix:** Added `"@morai/core": "workspace:*"` to `apps/web/package.json` dependencies,
  `{ "path": "../../packages/core" }` to `apps/web/tsconfig.json` references, and
  `"@morai/core": resolve(__dirname, "../../packages/core/src/index.ts")` to
  `apps/web/vitest.config.ts`'s alias map — the exact pattern already used for
  `@morai/quant`/`@morai/shared`. Ran `bun install` to link.
- **Files modified:** `apps/web/package.json`, `apps/web/tsconfig.json`,
  `apps/web/vitest.config.ts`, `bun.lock`
- **Verification:** `bun run typecheck` and `bun run test` both green with the new import.
- **Committed in:** `d5bcbc3` (Task 1 RED commit)

**2. [Rule 1 - Bug] Fixed flaky round-trip property comparison**
- **Found during:** Task 2, after adding `BSM_PARITY_TOLERANCE` (running `bun run test`
  against the full property suite surfaced a fast-check counterexample in Task 1's
  round-trip property)
- **Issue:** Comparing `wrapped.value` to `direct.value` (raw sigma) within `1e-9` failed
  on a deep-ITM put fixture (S≈1838.13, K≈5710.65, T≈0.357, sigma≈0.434) — the recovered
  sigmas differed by ~2.33e-9, driven by float round-trip noise in the REST-fallback's
  `mark * 100` then `/ 100` derivation.
- **Fix:** Compare by repricing (`bsmPrice(S, K, T, wrapped.value, ...)` vs `mark` within
  `1e-6`) instead of raw sigma equality — matches the tolerance discipline already
  established in `packages/core/src/journal/domain/iv-inversion.test.ts`.
- **Files modified:** `apps/web/src/lib/iv-calibration.test.ts`
- **Verification:** `bun run test -- apps/web/src/lib/iv-calibration.test.ts` green
  (7/7), full workspace suite green (1376 passed, 168 skipped — skips are pre-existing
  Docker-unavailable testcontainers, unrelated to this plan).
- **Committed in:** `8a01259` (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 blocking dependency wiring, 1 test-quality bug fix)
**Impact on plan:** Both necessary for the plan's own explicit interface contract
(`invertIv` from `@morai/core` package root) and for a non-flaky test suite. No scope
creep — `invertIv`, `packages/core/.../bsm.ts`, and `@morai/quant` were never modified.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `resolveLegIv()` and `CalibrationError` are ready for `apps/web/src/lib/scenario-engine.ts`
  (Plan 17-02, per the phase's Pattern Map) to replace the flat `frontIv`/`backIv` inputs
  with calibrated per-leg IV and leg-level convergence tags.
- `BSM_PARITY_TOLERANCE` is exported for reuse if a future plan needs the same
  cross-engine sanity check elsewhere.
- No blockers for 17-02/17-03/17-04.

---
*Phase: 17-overview-v2-redesign-iv-calibration-fix*
*Completed: 2026-07-03*

## Self-Check: PASSED
