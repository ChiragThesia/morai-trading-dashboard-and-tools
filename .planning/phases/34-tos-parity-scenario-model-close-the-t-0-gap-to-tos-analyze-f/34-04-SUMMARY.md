---
phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f
plan: 04
subsystem: quant
tags: [put-call-parity, dividend-yield, fred, gex, gex-snapshot, mcp, tos-parity]

requires:
  - phase: 34-03
    provides: "impliedDivYield(callMark, putMark, spot, strike, T, r): number | null exported from @morai/core; LegObsForGex.mark carried through the GEX cohort read"
provides:
  - "gexSnapshotEntry.impliedCarry / GexSnapshotRow.impliedCarry — nullable per-expiry [{expiration, rate, divYield}], additive, existing snapshots/fixtures read/parse as null"
  - "Migration 0023 (single nullable jsonb column gex_snapshots.implied_carry), applied at worker boot only"
  - "computeGexSnapshot resolves per-expiry carry: r interpolated from live FRED DGS1MO/DGS3MO, q solved via put-call parity over the ATM-bracket call/put marks already in the GEX cohort"
  - "GET /api/analytics/gex and the get_gex MCP tool both serialize impliedCarry from the shared gexSnapshotResponse schema (rule 9)"
affects: ["34-05 (web consumes impliedCarry via useGex() to re-price AnalyzerPosition.frontRate/frontDivYield/backRate/backDivYield with the server-resolved (r, q) instead of the flat DEFAULT_RATE/DEFAULT_DIV)"]

tech-stack:
  added: []
  patterns:
    - "Cross-context application port import: analytics/application/computeGexSnapshot.ts imports ForReadingMacroObservations + MacroObservationRow from ../../journal/index.ts (architecture-boundaries rule 7), same convention analytics/application/getRegimeBoard.ts already established"
    - "Per-field-nullable-degrade jsonb column mirroring the existing nearTerm precedent exactly: schema column, Zod-parsed read seam, persist/read mapping, contract-test round-trip + legacy-null case"
    - "A dependency-injected read (readMacroObservations) is wrapped so its OWN failure degrades one output field to null rather than propagating err() and blocking the whole use-case's persist"

key-files:
  created:
    - packages/adapters/src/postgres/migrations/0023_gex_implied_carry.sql
    - packages/adapters/src/postgres/migrations/meta/0023_snapshot.json
  modified:
    - packages/contracts/src/gex.ts
    - packages/contracts/src/gex.test.ts
    - packages/adapters/src/postgres/schema.ts
    - packages/adapters/src/postgres/migrations/meta/_journal.json
    - packages/core/src/analytics/application/ports.ts
    - packages/adapters/src/postgres/gex-snapshot.repo.ts
    - packages/adapters/src/__contract__/gex-snapshot.contract.ts
    - packages/core/src/analytics/application/getGex.test.ts
    - packages/core/src/analytics/application/computeGexSnapshot.ts
    - packages/core/src/analytics/application/computeGexSnapshot.test.ts
    - apps/worker/src/main.ts
    - apps/server/src/adapters/http/gex.routes.ts
    - apps/server/src/adapters/http/gex.routes.test.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/tools.test.ts

key-decisions:
  - "Migration 0023 was generated via `bunx drizzle-kit generate --name gex_implied_carry` (not hand-authored) after editing schema.ts — produced exactly the single additive `ALTER TABLE gex_snapshots ADD COLUMN implied_carry jsonb;` the plan required, plus the matching meta/_journal.json entry and meta/0023_snapshot.json drizzle-kit state file."
  - "ATM-bracket pair selection uses the SINGLE nearest-to-spot strike carrying both a call and a put mark, not RESEARCH's 'average 2-3 adjacent qualifying strikes' — left to Claude's Discretion per the plan; simpler, same well-conditioned one-unknown parity solve, smaller oracle. Marked with a ponytail comment (upgrade path: add averaging if UAT shows single-strike noise)."
  - "readMacroObservations is a REQUIRED (not optional) ComputeGexSnapshotDeps field, matching every other Deps type's convention in this codebase (no optional deps fields elsewhere). This required adding a shared EMPTY_MACRO_STUB to the ~12 pre-existing, carry-unrelated tests in computeGexSnapshot.test.ts so they keep compiling and passing unchanged."
  - "T (time to expiry) is computed via @morai/shared's settlementTimestamp + parseOccSymbol, NOT core's journal/domain/dte.ts computeT — the latter is a different bounded context's domain function and importing it from analytics would violate architecture-boundaries rule 7 (cross bounded contexts only through application ports, never another context's domain/). This is also what the plan's read_first explicitly names and what 34-02's client-side dteExact() already does for the identical reason."
  - "getGex.test.ts (not listed in the plan's files_modified) required a one-line fixture fix (added impliedCarry: [...] to its hand-typed GexSnapshotRow literal) because packages/core/tsconfig.json does NOT exclude *.test.ts from `tsc --build` (unlike packages/adapters and apps/server, which do) — the widened required field broke that unrelated fixture's typecheck. Rule 1/3 auto-fix, smallest possible diff."
  - "No get_gex MCP tool test existed before this plan (tools.test.ts had zero Gex coverage). Added one, mirroring the get_picker_candidates McpServer+Client+InMemoryTransport harness already established in the same file, to prove the registered handler is genuinely invoked (not just the underlying use-case called directly)."

patterns-established:
  - "computeGexSnapshot's new Step 8c (implied carry) is deliberately placed AFTER byExpiry/nearTerm and BEFORE the row build, and its own macro-read failure is caught locally (via `macroResult.ok ? ... : null`) rather than returned as err() — the only field in the row allowed to independently degrade to null without aborting the whole snapshot persist."

requirements-completed: [TOSP-02]

coverage:
  - id: D1
    description: "impliedCarry exists end-to-end at rest: additive nullable per-expiry {expiration, rate, divYield} on gexSnapshotEntry/GexSnapshotRow, a single additive nullable jsonb column (migration 0023), and a persist/read mapping that round-trips a non-null value and reads a legacy/absent value back as null"
    requirement: "TOSP-02"
    verification:
      - kind: unit
        ref: "packages/contracts/src/gex.test.ts#gexSnapshotEntry — parsed result includes impliedCarry / accepts null impliedCarry"
        status: pass
      - kind: integration
        ref: "packages/adapters/src/__contract__/gex-snapshot.contract.ts#impliedCarry — round-trip (34-04), run against both the in-memory twin (src/memory/gex-snapshot.contract.test.ts) and real Postgres via testcontainers (src/postgres/gex-snapshot.repo.contract.test.ts)"
        status: pass
    human_judgment: false
  - id: D2
    description: "computeGexSnapshot resolves per-expiry (r, q) once per GEX cycle: r interpolated from the live FRED DGS1MO/DGS3MO curve, q solved via put-call parity over the ATM-bracket call/put marks already in the cohort; degrades to null (never a throw, never NaN) on a macro-read failure or no expiry with a usable ATM pair, while GEX still persists"
    requirement: "TOSP-02"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/application/computeGexSnapshot.test.ts#impliedCarry — recovers a known (r, q) from forward-priced ATM marks over the live FRED curve (bsmPrice-forward-priced oracle)"
        status: pass
      - kind: unit
        ref: "packages/core/src/analytics/application/computeGexSnapshot.test.ts#impliedCarry — degrades to null when the macro read errs (GEX still persists) / degrades to null when no expiry has an ATM call+put pair"
        status: pass
    human_judgment: false
  - id: D3
    description: "impliedCarry flows through GET /api/analytics/gex and the get_gex MCP tool from the single shared gexSnapshotResponse schema (rule 9) — both the non-null and null cases serialize correctly on both surfaces"
    requirement: "TOSP-02"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/gex.routes.test.ts#GET /analytics/gex — returns 200 with impliedCarry / serializes impliedCarry: null when unresolved"
        status: pass
      - kind: unit
        ref: "apps/server/src/adapters/mcp/tools.test.ts#get_gex MCP tool — returns gexSnapshotResponse-valid content including impliedCarry / serializes impliedCarry: null when unresolved"
        status: pass
    human_judgment: false

duration: ~22min
completed: 2026-07-11
status: complete
---

# Phase 34 Plan 04: GEX snapshot gains parity-implied per-expiry carry Summary

**Additive nullable `impliedCarry` on the GEX snapshot — per expiry, the FRED-interpolated risk-free rate AND the put-call-parity-implied dividend yield solved against it over the ATM-bracket marks already in the GEX cohort — flowing end-to-end through migration 0023, `computeGexSnapshot`, and both `GET /api/analytics/gex` and the `get_gex` MCP tool.**

## Performance

- **Duration:** ~22 min
- **Tasks:** 3 (all TDD: RED → GREEN)
- **Files modified:** 15 (2 created, 13 modified) + 1 SUMMARY

## Accomplishments

- `gexSnapshotEntry`/`GexSnapshotRow` gain `impliedCarry: { expiration, rate, divYield }[] | null` — mirrors the existing `nearTerm` "may be absent on older snapshots" precedent exactly (required key, nullable value; the base test fixture carries a non-null value so every unrelated existing test keeps parsing).
- Migration `0023_gex_implied_carry.sql` — a single additive `ALTER TABLE gex_snapshots ADD COLUMN implied_carry jsonb;`, generated via `drizzle-kit generate` (not hand-authored) after editing `schema.ts`, with the matching `meta/_journal.json` entry (idx 23) so `runMigrations` picks it up at worker boot.
- `gex-snapshot.repo.ts` persists/reads `impliedCarry` through a new nullable `impliedCarrySchema` Zod parse at the read seam, byte-identical in structure to the existing `nearTermSchema` handling (legacy/absent rows map to `null`, never a parse failure that drops the row).
- `computeGexSnapshot` gains a new Step 8c: groups the cohort's legs by `expiration`, and per expiry — parses the root via `parseOccSymbol` (degrading that expiry on an unparseable contract), computes a settlement-aware fractional `T` via `settlementTimestamp` (D-02, same 365.25 day-count the client uses), interpolates `r` from the live FRED `DGS1MO`/`DGS3MO` curve (percent → decimal, clamped to the [30d, 90d] bracket), picks the single ATM-bracket strike nearest spot carrying both a call and a put mark, and solves `q` via 34-03's `impliedDivYield`. A macro-read failure degrades the whole field to `null` without failing the GEX snapshot persist (T-34-03). Proven by a `bsmPrice`-forward-priced recovery oracle (known `r=0.045`, `q=0.013`, recovered to 6 decimal places) plus two degrade cases (macro-read error; no ATM pair).
- `GET /api/analytics/gex` and the `get_gex` MCP tool both pass `row.impliedCarry` through the identical `gexSnapshotResponse.parse({...})` object (rule 9) — pure passthrough, zero business logic at the edge.
- Worker wiring: `apps/worker/src/main.ts` injects `readMacroObservations: macroObsRepo.readMacroObservations` (the same repo instance already used for the entry-gate deps) — zero new adapters, zero new queries.

## Task Commits

Each task was committed atomically per the plan-level TDD gate:

1. **Task 1 RED** — `9dc69eb` (test): add failing tests for GEX impliedCarry field
2. **Task 1 GREEN** — `1942bff` (feat): add impliedCarry field end-to-end (contract, schema, repo)
3. **Task 2 RED** — `09c1845` (test): add failing tests for computeGexSnapshot impliedCarry resolve
4. **Task 2 GREEN** — `9d01df3` (feat): resolve per-expiry implied carry in computeGexSnapshot
5. **Task 3 RED** — `e4ff644` (test): add failing tests for impliedCarry on gex route + MCP tool
6. **Task 3 GREEN** — `5b56706` (feat): surface impliedCarry on GET /api/analytics/gex + get_gex MCP tool

_No REFACTOR commits — each GREEN implementation matched the plan's stated design (mirroring the `nearTerm` precedent, `getRegimeBoard.ts`'s cross-context import convention, and 34-RESEARCH.md's Pattern 2) with nothing to clean up._

## Files Created/Modified

- `packages/adapters/src/postgres/migrations/0023_gex_implied_carry.sql` — the single additive nullable jsonb column, drizzle-kit generated.
- `packages/adapters/src/postgres/migrations/meta/0023_snapshot.json` / `meta/_journal.json` — drizzle-kit migration state + journal entry.
- `packages/contracts/src/gex.ts` / `gex.test.ts` — `impliedCarry` field + parse/null tests.
- `packages/adapters/src/postgres/schema.ts` — `implied_carry` jsonb column on `gexSnapshots`.
- `packages/core/src/analytics/application/ports.ts` — `GexSnapshotRow.impliedCarry`.
- `packages/adapters/src/postgres/gex-snapshot.repo.ts` — `impliedCarrySchema` + persist/read mapping.
- `packages/adapters/src/__contract__/gex-snapshot.contract.ts` — round-trip + legacy-null contract-test cases (run against both the memory twin and real Postgres).
- `packages/core/src/analytics/application/getGex.test.ts` — pre-existing fixture fix (Rule 1/3, unrelated to this task but forced by the widened required field).
- `packages/core/src/analytics/application/computeGexSnapshot.ts` / `computeGexSnapshot.test.ts` — `interpolateShortRate`, `pickAtmBracketPair`, `computeImpliedCarry`, the new dep, the recovery oracle + 2 degrade tests.
- `apps/worker/src/main.ts` — `readMacroObservations: macroObsRepo.readMacroObservations` wiring.
- `apps/server/src/adapters/http/gex.routes.ts` / `gex.routes.test.ts` — passthrough + tests.
- `apps/server/src/adapters/mcp/tools.ts` / `tools.test.ts` — passthrough + a brand-new `get_gex MCP tool` describe block (none existed before).

## Decisions Made

See `key-decisions` in the frontmatter (drizzle-kit-generated migration; single-nearest-strike ATM pick over RESEARCH's multi-strike average; required — not optional — `readMacroObservations` dep; `settlementTimestamp`/`parseOccSymbol` over core's `computeT` for hexagon-boundary reasons; the `getGex.test.ts` fixture fix; the new `get_gex` MCP test harness).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed `getGex.test.ts`'s pre-existing `GexSnapshotRow` fixture**
- **Found during:** Task 1 GREEN, `bun run typecheck`
- **Issue:** `packages/core/tsconfig.json` does not exclude `*.test.ts` from `tsc --build` (unlike `packages/adapters`/`apps/server`, which do). `getGex.test.ts`'s hand-typed `FIXTURE_ROW: GexSnapshotRow` (not in this plan's `files_modified`) predates the new required `impliedCarry` field and failed to compile once the field was added.
- **Fix:** Added `impliedCarry: [{ expiration: "2026-06-27", rate: 0.045, divYield: 0.013 }]` to the fixture — smallest possible diff, matches the file's existing style.
- **Files modified:** `packages/core/src/analytics/application/getGex.test.ts`
- **Commit:** `1942bff` (bundled with the Task 1 GREEN commit, since it was required for that commit's `bun run typecheck` to pass)

---

**Total deviations:** 1 auto-fixed (blocking/typecheck). No scope creep — the fix is a one-line addition to a fixture the type change directly broke; no other files outside the plan's stated list were touched.

## Issues Encountered

None beyond the fixture fix documented above. The RED steps surfaced exactly the anticipated failures (missing `impliedCarry` field/dep at each layer), confirmed via actual test runs before each GREEN implementation — including one interesting non-failure: the in-memory GEX repo twin's contract test passed immediately at RED (no code change needed, matching 34-03's precedent that the twin's generic passthrough already satisfies a widened shared type), so genuine RED for Task 1's persist/read half was demonstrated against the real Postgres adapter (testcontainers) instead.

## User Setup Required

None — no external service configuration required. Migration 0023 applies automatically at the next worker deploy (boot-time migrator), never a direct prod DB push.

## Next Phase Readiness

- **Exact contract field shape for 34-05:** `gexSnapshotResponse.impliedCarry: { expiration: string; rate: number; divYield: number }[] | null` — the browser's `useGex()` hook (already `gexSnapshotResponse.parse()`-validated, zero changes needed there) will receive this field automatically on every GEX fetch once the worker/server redeploy with this plan's changes.
- 34-05 can look up a calendar's front/back leg carry via `impliedCarry.find(e => e.expiration === leg.expiration)`, falling back to `undefined` (and thus `AnalyzerPosition`'s existing `?? DEFAULT_RATE`/`?? DEFAULT_DIV` fallback from 34-02) when the array is `null` or has no matching expiry entry — zero new fallback logic needed, 34-02's `resolveDte`/per-leg-carry plumbing already expects exactly this shape.
- `impliedCarry` is `null` until the NEXT GEX compute cycle runs post-deploy (existing snapshots read back `null` via the legacy-row path) — 34-05's UAT gate should account for one GEX cycle's lag after deploy before real (r, q) values appear.
- Full workspace gate green: `bun run typecheck` clean, `bun run lint` clean (only the pre-existing legacy-boundaries-selector warning, unrelated), `bun run test` — 292 test files / 3215 tests passed (includes all new/modified assertions across all three tasks).

## Self-Check: PASSED

All created files and commit hashes verified present (see below).

---
*Phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f*
*Completed: 2026-07-11*
