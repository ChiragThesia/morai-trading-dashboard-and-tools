---
phase: 06-derived-analytics
reviewed: 2026-06-22T13:20:00Z
depth: standard
review_round: 2
files_reviewed: 9
files_reviewed_list:
  - apps/worker/src/main.ts
  - apps/worker/src/schedule.ts
  - packages/adapters/src/memory/leg-observations.ts
  - packages/adapters/src/postgres/repos/leg-observations.ts
  - packages/adapters/src/smile-moneyness.ts
  - packages/core/src/analytics/application/computeAnalytics.ts
  - packages/core/src/analytics/application/ports.ts
  - packages/core/src/analytics/domain/percentile-rank.ts
  - packages/core/src/analytics/domain/risk-reversal.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
clean_bill: true
verdict: VERIFIED — no blocker; Phase 6 may be declared verified (leave unmerged for operator review)
---

# Phase 6: Code Review Report — Re-Review #2 (final gate)

**Reviewed:** 2026-06-22
**Depth:** standard (adversarial re-verification of the gap-round fix delta)
**Files Reviewed:** 9 (fix delta) + supporting contract suites + cross-module call paths
**Status:** clean — clean bill of health, no blocker

## Summary

This is the final gate for the Phase 6 gap-round (plans 06-06/07/08) that closed the two
BLOCKERs and four WARNINGs from `06-REVIEW.md`. I verified every original finding is
GENUINELY fixed at the code, contract-test, and suite level — not merely claimed. The
dominant defect (the cycle-resolution seam) is fixed at the root: `now()` is now used
**only** as an upper bound for "≤ anchor" resolution and is never stamped on any row; all
three observation tables share one DATA-resolved instant per cycle.

Proof of work executed this round:
- `bun run test` → **102 files, 945 tests, all passing** (includes the Postgres
  testcontainer seam suite that fails on the old exact-`now()` code).
- `bun run typecheck` → clean.
- `bun run lint` → clean (only pre-existing `boundaries` plugin v5→v6 migration warnings,
  unrelated to this phase).
- Hexagon purity grep: core imports only `@morai/shared` + same-context ports. No
  `any` / `as` / `!` in any of the 9 fix-delta files.

**Clean bill: yes. No blocker. Phase 6 is trustworthy and may be declared verified, left
UNMERGED for operator review per the locked decision.**

## Original Finding Verification (priority order)

### CR-01 — smile read returned 0 rows in prod via exact `now()` → **FIXED**

- `computeAnalytics.ts:68` — `now` is captured for resolution bounds only; the comment and
  code make explicit it is NEVER a stamped value.
- `computeAnalytics.ts:103-104` — `smileAnchor = snapshotAnchor ?? now`; the read is a
  bounded "latest leg cohort ≤ anchor", not exact equality.
- `leg-observations.ts:321-337` (Postgres) — Step 1 resolves `MAX(time) ≤ anchor` among
  BSM-solved rows (`bsmIv NOT NULL AND != 'NaN'::numeric`) via
  `lte(time, snapshotTime) … orderBy(desc(time)).limit(1)`; Step 2 reads that exact cohort.
  Returns `{ cycleTime: resolvedTime, quotes }`. The resolved instant comes from DATA.
- `memory/leg-observations.ts:112-143` — twin mirrors the same "latest ≤ anchor among solved
  cohorts" resolution; no longer `getTime() === getTime()` equality.
- Smile-source contract suite (`smile-source.contract.ts:172-253`) proves the seam: a cohort
  STRICTLY BEFORE the anchor is returned (the exact assertion that fails on old code), the
  LATEST-≤-anchor cohort wins, an anchor earlier than every leg → empty, and a later all-NaN
  time is skipped in favor of the latest SOLVED cohort.
- Confirmed: `now()` is never a stamped value — only a read upper bound.

### CR-02 — `now()`-stamp defeats idempotency + desyncs snapshot_time → **FIXED**

- `computeAnalytics.ts:116` — `const stampInstant = snapshotAnchor ?? cycleTime`. All three
  writers stamp `stampInstant`: skew (`:121`), term (`:85` via `snap.snapshotTime`, which IS
  the snapshot anchor), and RR (`:162`). The RR history window is also bounded by
  `stampInstant` (`:155`), not `now()`.
- Structural single-anchor is enforced in the use-case, not just a test: when snapshots
  exist, skew/RR are stamped with the SNAPSHOT anchor (`snapshotAnchor`), so
  `skew.snapshot_time == term.snapshot_time` by construction. Term rows are derived from the
  same `snap.snapshotTime`. This is the `??` short-circuit, not coincidence.
- Idempotency proven against real Postgres: `compute-analytics-seam.contract.ts:119-141`
  runs the handler TWICE at two DISTINCT `now()` values over one seeded cycle and asserts 0
  new rows in all three tables (PKs collide on the resolved instant). A fast-check property
  (`:167-204`) repeats this over distinct (T_obs, T_snap, N1, N2) tuples.
- Fallback coherence confirmed (`computeAnalytics.ts:103,110,116`; seam test `:143-165`):
  - snapshots present → smile anchored to snapshot time, all three tables share it;
  - no snapshots, smile present → `stampInstant = cycleTime` (the smile's own resolved leg
    instant); skew/RR written, 0 term rows; re-run adds 0 (test asserts skew time == tObs);
  - neither → `cycleTime === null` → `return ok(undefined)` clean no-op (term half already
    wrote nothing).

### WR-01 — `percentileRank` empty history → null (not 100) → **FIXED**

- `percentile-rank.ts:19-21` — `if (n === 0) return null;` return type is `number | null`.
- Carried through: `computeAnalytics.ts:149,158,166` — `rrRank` is `number | null`, only
  computed when `riskReversal !== null` AND prior history exists; persisted as null otherwise.
- Contract carries it: `contracts/src/analytics.ts:46` — `rrRank: z.number().nullable()`.
  Edge maps it through (`analytics.routes.ts:81`, `mcp/tools.ts:329`).
- Tested: `computeAnalytics.test.ts:315-337` asserts `rrRank` is null for a non-null
  risk-reversal with NO prior history; `:344-359` asserts a real 50 once history exists.

### WR-02 — bracket-width gate (MAX_BRACKET_WIDTH) → **FIXED**

- `risk-reversal.ts:25,65-67` — `MAX_BRACKET_WIDTH = 0.3`; `interpAtDelta` returns null when
  `span > MAX_BRACKET_WIDTH` (after the exact-hit `span === 0` short-circuit, so a degenerate
  span is handled correctly).
- The property test has teeth on BOTH sides:
  `risk-reversal.property.test.ts:100-138` forces null on wide non-adjacent brackets that DO
  straddle ±0.25 (the gate, not a straddle-miss, is what forces null — asserted explicitly at
  `:124-125`); `:140-171` asserts a within-width straddle still yields a finite RR (the gate
  does not reject legitimate tight smiles). Both at numRuns=1000.

### WR-03 — `moneyness` populated = (strike/1000)/spot on both adapters → **FIXED**

- `smile-moneyness.ts:13-16` — single shared `computeMoneyness(strikeX1000, spot)`:
  `(strike/1000)/spot`, returns null when `!Number.isFinite(spot) || spot <= 0`.
- Both adapters import and use it: Postgres `leg-observations.ts:20,367`, memory twin
  `memory/leg-observations.ts:18,140`. No duplicate divergent logic.
- Flows to contract + persisted column: `analytics.ts:22` (`moneyness: z.number().nullable()`),
  skew repo round-trips it (`skew-observations.ts:48,84`). No dead permanently-null surface.
- Shared contract suite proves parity: `smile-source.contract.ts:84-114` asserts the computed
  value AND the null-on-non-positive-spot guard against BOTH the twin and real Postgres.

### WR-04 — delta-sign sanity drops non-physical points before the put/call split → **FIXED**

- `risk-reversal.ts:34-44` — `usablePoints` drops `null` delta, non-finite delta/iv, and
  `Math.abs(delta) >= 1` (non-physical) BEFORE the put (`delta < 0`) / call (`delta > 0`)
  split at `:82-83`. A magnitude-≥-1 point cannot land in either wing regardless of sign.
- This is the domain-guard option offered in the original WR-04 fix; the put/call split itself
  is sign-defined, so wing placement is consistent with the smile's delta sign.

### IN-01 / IN-02 — stale comments / ordering JSDoc → **ADDRESSED**

- `worker/main.ts:402,416` and `schedule.ts:7,26,41,60` now say 9 queues / 6 crons / 9
  handlers (commit fbf7a70). Matches the registered set in `registerAllJobs`.

## New-Bug Sweep on the Fix Delta

I traced the new code paths adversarially for regressions introduced by the fix. Nothing
found. Specifically cleared:

- **`ForReadingSmileSource` shape wiring** — `{ cycleTime, quotes }` (`ports.ts:39-42`) is
  produced identically by both adapters and consumed correctly at `computeAnalytics.ts:106`
  (destructure) with the null-cycle no-op guard at `:110`. Worker wiring
  (`main.ts:193`) passes `legObsRepo.readSmile` unchanged — type-checked.
- **Bounded smile SQL correctness** — `lte` upper bound + `desc(time).limit(1)` resolves the
  latest cohort; both Step 1 (resolve) and Step 2 (read) exclude `'NaN'::numeric` and NULL
  bsm_iv, so the resolved cycle is guaranteed to have a real smile. No off-by-one: `lte`
  (inclusive ≤) is correct for "at or before the anchor" and the contract test seeds an exact
  boundary (`smile-source.contract.ts:58-82`, cycleTime == snapshotTime).
- **smile-moneyness shared, not duplicated** — one module, imported by both adapters; the
  property is the same guard on both sides.
- **Hexagon purity** — `computeAnalytics.ts`, `ports.ts`, `risk-reversal.ts`,
  `percentile-rank.ts` import only `@morai/shared` + same-context files. No drizzle/node/SDK
  leakage into core.
- **No `any` / `as` / `!`** in any of the 9 files (grep + tsc strict pass).
- **Single-anchor has no `now()`-stamp path** — exhaustively: `stampInstant` is
  `snapshotAnchor ?? cycleTime`; `snapshotAnchor` is `snapshots[0]?.snapshotTime` (DATA) and
  `cycleTime` is the resolved leg instant (DATA). There is no branch that assigns `now()` to a
  stamped field. Term rows use `snap.snapshotTime` directly. skew/term divergence is
  structurally impossible when snapshots exist.

## Minor Notes (non-blocking, no action required)

- A Postgres NOTICE during migration 0007 truncates the RR composite-PK constraint NAME to 63
  chars (`risk_reversal_observations_snapshot_time_underlying_expiration_`). This is cosmetic:
  the name is still unique in the schema and idempotency is enforced by the PK column set, not
  the constraint name. No collision risk. Not a finding.
- Term half writes before the smile read; if the smile read then errors, term rows are already
  committed. This is acceptable and idempotent (re-run re-stamps the same term instant, 0 new
  rows) — consistent with the locked design's per-table idempotency.

---

_Reviewed: 2026-06-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard — re-review #2 (final gate)_
