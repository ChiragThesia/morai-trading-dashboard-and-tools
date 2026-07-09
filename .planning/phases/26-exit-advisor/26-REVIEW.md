---
phase: 26-exit-advisor
reviewed: 2026-07-09T00:00:00Z
depth: deep
files_reviewed: 20
files_reviewed_list:
  - packages/core/src/exits/domain/evaluate-exit.ts
  - packages/core/src/exits/domain/exit-rules.ts
  - packages/core/src/exits/domain/types.ts
  - packages/core/src/exits/application/computeExitAdvice.ts
  - packages/core/src/exits/application/getExitAdvice.ts
  - packages/core/src/exits/application/ports.ts
  - packages/contracts/src/exits.ts
  - packages/adapters/src/postgres/repos/exit-verdicts.ts
  - packages/adapters/src/memory/exit-verdicts.ts
  - packages/adapters/src/postgres/repos/calendar-snapshots.ts
  - packages/adapters/src/postgres/migrations/0020_exit_verdicts.sql
  - packages/adapters/src/postgres/schema.ts
  - packages/core/src/picker/domain/candidate-selection.ts
  - apps/worker/src/main.ts
  - apps/worker/src/handlers/compute-exit-advice.ts
  - apps/worker/src/handlers/compute-picker.ts
  - apps/worker/src/schedule.ts
  - apps/server/src/adapters/http/exits.routes.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/web/src/screens/HeldPositionsPanel.tsx
findings:
  critical: 1
  warning: 4
  info: 5
  total: 10
status: fixed
fixed_at: 2026-07-09
fixed_commits:
  CR-01: [0708de8, d893f47]  # indicative gate + read-side null + finite sentinel + contract .finite()
  WR-01: 4499087             # per-row safeParse skip-and-warn on read
  WR-02: a86e5bd             # read-time staleness re-application
  WR-03: 1858793             # spot<=0 gap rows indicative
  WR-04: eec554f             # ROLL estDebit -> estNewFrontCredit relabel
  IN-01: c42942e             # remove dead blockedByEvent guard
  IN-02: 39eac2b             # remove unused PreviousVerdict.armedAt
  IN-03: cb0b4d0             # ROLL DTE from snapshot-time reference
  IN-04: a86e5bd             # closed by WR-02 (read-time clears frozen CHANGED)
  IN-05: 66eb603             # log escalate false->true onset
---

# Phase 26: Exit Advisor — Code Review Report

**Reviewed:** 2026-07-09
**Depth:** deep
**Files Reviewed:** 20
**Status:** fixed (all 10 findings resolved 2026-07-09 — see `fixed_commits` in frontmatter)

## Summary

Reviewed the full Exit Advisor slice — pure evaluator, rule registry, use-cases, ports,
Postgres/memory repos, contract, worker/server wiring, and UI. The following were traced and
**hold up**: P&L sign/scale conventions (points throughout, netMark − openNetDebit over
openNetDebit basis, no dollar/points mismatch); rung mapping (rungs scan highest-first, +5.1%
arms TAKE-5 not TAKE-15; STOP deepest-first); hysteresis arm/disarm asymmetry (traced
+5.1% → +4.8% → +5.1%: arms "+5%", holds at +4.8% via disarm 0.03, no flap); idempotency
(observedAt = snapshot time, deterministic across retries; retry's previous-read returns the
just-written row at T but the persist is an `onConflictDoNothing` no-op so the stored
`changed` flag keeps the first write's correct value — no observed_at off-by-one in persisted
data); strike ×1000 closures (worker + server both divide by 1000, filter compares
points-to-points, picker's own consumer still receives raw ×1000 unchanged); route/MCP parity
(one `exitsResponse` schema, identical field mapping); UI (verdict-enum-driven styling, no
ruleId string-matching, no order affordance, EXIT-10 clean).

One critical defect: the P&L denominator is unguarded, a NULL-basis open calendar is
prod-reachable, and the resulting ±Infinity both escapes the NaN-only indicative gate (bogus
escalated STOP/TAKE) and, once persisted through JSONB, poisons the read path for every
calendar. Four warnings on gate completeness, read-path fragility, read-time staleness, and a
mislabeled ROLL money figure.

## Critical Issues

### CR-01: Zero/NULL `openNetDebit` → ±Infinity pnlPct → bogus escalated STOP/TAKE, then permanent pipeline poisoning

> **FIXED (0708de8, d893f47):** Evaluator collapses pnlPct to a finite 0 sentinel when
> `openNetDebit <= 0` (fires no rung → HOLD) and forces the verdict indicative; `getExitAdvice`
> emits `pnlPct: null` and the contract's `pnlPct` is nullable. Second-order poisoning closed:
> the persisted metric stays finite and `exitMetric.value/threshold`/`pnlPct` are hardened with
> `z.number().finite()`. `calendars.ts:67` NULL→0 map left as-is per the root-cause note.

**File:** `packages/core/src/exits/domain/evaluate-exit.ts:225` (with
`packages/adapters/src/postgres/repos/calendars.ts:67`,
`packages/adapters/src/postgres/repos/fills.ts:324-331`,
`packages/core/src/exits/application/getExitAdvice.ts:72`,
`packages/contracts/src/exits.ts:9-13`)

**Issue:** `pnlPct = (context.netMark - position.openNetDebit) / position.openNetDebit` has
no denominator guard. The zero denominator is prod-reachable two ways:

1. **NULL basis race:** `calendars.open_net_debit` is a NULLable column, and
   `resetCalendarAmounts` (`fills.ts:330`) sets it to NULL during every sync-fills pairing
   pass and rebuild-journal, before `recomputeCalendarAmounts` restores it. sync-fills runs
   every 10 min RTH; a compute-exit-advice cycle landing in that window reads the open
   calendar with NULL basis. `calendars.ts:67` maps NULL → `0`
   (`row.openNetDebit !== null ? parseFloat(row.openNetDebit) : 0`), and the worker's
   `mapCalendarToHeldPosition` passes it straight through.
2. **Equal-average-price registration:** `registerOpenCalendars.ts:161` computes
   `openNetDebit = back.averagePrice - front.averagePrice`, which is exactly `0` when the
   legs report equal averages (it only skips NULL averages, not equal ones).

With `openNetDebit = 0`:
- `netMark < 0` → `pnlPct = -Infinity` → `evalStop`: `-Infinity <= -0.5` → **STOP "-50%",
  escalate:true**. The indicative gate (`evaluate-exit.ts:233`) checks `Number.isNaN` only;
  `-Infinity` is not NaN, so the verdict renders fully actionable.
- `netMark > 0` → `+Infinity` → **TAKE "+15%"**.
- `netMark = 0` → `pnlPct = NaN` — NOT caught either: the gate checks `context.netMark` for
  NaN, never `pnlPct` itself, so all rungs miss and it lands HOLD with `metric.value: NaN`.

**Second-order poisoning (traced):** the STOP verdict carries `metric.value: -Infinity`.
Zod `z.number()` accepts Infinity (rejects only NaN), so `exitVerdict.parse` passes at the
write boundary; Drizzle serializes the JSONB via `JSON.stringify`, which turns `-Infinity`
into `null`. On the NEXT cycle, `readLatestVerdictsPerCalendar` re-parses the stored blob,
`metric.value: null` fails `z.number()`, the whole read returns StorageError →
computeExitAdvice errs every subsequent cycle AND `GET /api/exits` 500s for ALL calendars.
Nothing deletes the row; the outage persists until manual SQL cleanup. (The NaN metric from
the HOLD case poisons identically.)

**Fix (root cause, one place all consumers route through):** gate on a valid basis in the
evaluator and mirror it in the read use-case:
```ts
// evaluate-exit.ts
const pnlPct = position.openNetDebit > 0
  ? (context.netMark - position.openNetDebit) / position.openNetDebit
  : Number.NaN;
const hasNaN = ... || Number.isNaN(pnlPct);
```
(NaN pnlPct then misses every rung → HOLD + indicative, the honest verdict for "no basis.")
Apply the same guard in `getExitAdvice.ts:72` before pushing `pnlPct`. Additionally harden
the contract: `exitMetric.value: z.number().finite()` (and `pnlPct`), so a non-finite value
can never round-trip through JSONB as `null` again.

## Warnings

### WR-01: One corrupted verdict row kills the entire exits read path for all calendars

> **FIXED (4499087):** `readLatestVerdictsPerCalendar` now parses per-row with
> `exitVerdict.safeParse` and skips-and-`console.warn`s a corrupted blob instead of failing the
> batch. Postgres adapter + in-memory twin updated identically; shared contract test asserts the
> corrupted row is skipped while a valid sibling calendar still reads.

**File:** `packages/adapters/src/postgres/repos/exit-verdicts.ts:72-77` (memory twin
`packages/adapters/src/memory/exit-verdicts.ts:73-79` matches)

**Issue:** `readLatestVerdictsPerCalendar` maps every row through `exitVerdict.parse` inside
one try/catch; a single unparseable blob (see CR-01's Infinity→null path, or any future
schema drift) fails the whole read. Both computeExitAdvice (first read) and getExitAdvice
(first read) short-circuit on that error, so one bad row for one calendar takes down verdict
computation AND the API for every calendar, indefinitely. All-or-nothing is the wrong
failure shape for a per-calendar advisory read.

**Fix:** Parse per-row with `exitVerdict.safeParse`; skip-and-`console.warn` the corrupted
row (mirrors `readJournal`'s unknown-source skip at `calendar-snapshots.ts:119-124`) instead
of failing the batch. Update the memory twin identically.

### WR-02: Read-time staleness is never re-applied — a frozen verdict serves as actionable after its data goes stale

> **FIXED (a86e5bd):** `getExitAdvice` re-checks `now − observedAt` against the shared
> `STALENESS_TOLERANCE_MS` (exported from the domain) and forces the returned verdict
> `indicative:true`/`escalate:false` (and `changed:false`) when stale.

**File:** `packages/core/src/exits/application/getExitAdvice.ts:65-97`

**Issue:** `indicative` is computed once at WRITE time against the write-cycle clock and
persisted. `getExitAdvice` reads the stored verdict straight through and never re-checks
`now − observedAt` against the 45-min tolerance. If the chain stalls downstream of
snapshot-calendars (compute-picker failure means compute-exit-advice never re-runs — the
exact worker-down failure mode this repo has hit twice), the last verdict freezes while the
API keeps serving it `escalate:true`/non-indicative; only the UI freshness dot hints at age.
A stale actionable STOP is precisely what the indicative gate exists to prevent.

**Fix:** In `getExitAdvice`, force `indicative:true`/`escalate:false` on a position whose
`row.observedAt` is older than the staleness tolerance at read time (export
`STALENESS_TOLERANCE_MS` from the domain so both sides share one value).

### WR-03: Indicative gate ignores degenerate spot — GAMMA fires an escalated STOP on a spot=0 row

> **FIXED (1858793):** Gate folds in `context.spot > 0 && Number.isFinite(spot)`; a spot=0 gap row
> is now indicative and GAMMA cannot escalate.

**File:** `packages/core/src/exits/domain/evaluate-exit.ts:230-234, 124-141`

**Issue:** The gate validates NaN in `frontIv/backIv/netMark` only, never `spot`. A gap
snapshot with `spot = 0` but numeric marks passes the gate; `evalGamma` computes
`offStrike = |0 − strike|/strike = 1.0` and, with `dteFront < 7`, returns an escalated STOP
on a degenerate row. This relies entirely on upstream invariants (OPS-01 skip + staleness)
that have both regressed in prod before (spot=0 rows Jun 23-26; the Jul-06 gap mechanism).

**Fix:** Treat `context.spot <= 0` as `indicative` in the gate.

### WR-04: ROLL `estDebit` is the replacement front's single-leg SELL credit, mislabeled as the roll's debit

> **FIXED (eec554f):** Domain/contract field renamed `estDebit` → `estNewFrontCredit`; UI label
> changed to "new front est. credit $X". Doc comments note it is the replacement-front SELL credit
> only, not the net roll cost.

**File:** `packages/core/src/exits/domain/evaluate-exit.ts:213` (rendered
`apps/web/src/screens/HeldPositionsPanel.tsx:148` as `est. debit $…`)

**Issue:** `estDebit: haircutFill(best, "sell")` is the haircut sell price of the new front
alone. Rolling a calendar's front means buying back the current short front AND selling the
new one; the shown figure is (a) a credit, not a debit, and (b) omits the buy-back leg, so
it is not the roll's net cost — yet the UI labels it "est. debit". Advisory-only, but it is
a money figure the user may act on.

**Fix:** Relabel to "new front est. credit" (or similar honest copy), or thread the current
front's quote into `evalRoll` and compute the true net roll cost.

## Info

### IN-01: `evalRoll` `blockedByEvent` guard is dead code

> **FIXED (c42942e):** Parameter and early return removed; precedence test still covers evt>roll.

**File:** `packages/core/src/exits/domain/evaluate-exit.ts:186, 259`
**Issue:** `evt` precedes `roll` in `EXIT_PRECEDENCE`; when `evtHit !== null` the loop breaks
on `evt` before `roll` is evaluated, so `blockedByEvent` is always `false` inside `evalRoll`.
**Fix:** Drop the parameter and the early return.

### IN-02: `PreviousVerdict.armedAt` is threaded but never read

> **FIXED (39eac2b):** Removed from the type and its population in `computeExitAdvice`.

**File:** `packages/core/src/exits/domain/types.ts:101`, `computeExitAdvice.ts:129`
**Issue:** `wasArmed` compares only `ruleId`+`rung`; `armedAt` is populated from
`previousRow.observedAt` and unused.
**Fix:** Remove it unless a time-based disarm is planned.

### IN-03: ROLL gating DTE and replacement-DTE use different clocks

> **FIXED (cb0b4d0):** Replacement DTE now measured from `snapshot.time` — the same reference that
> produced the `dteFront` gate — instead of wall-clock `cohortNow`.

**File:** `packages/core/src/exits/domain/evaluate-exit.ts:187, 197`
**Issue:** The `dteFront >= ROLL_FRONT_DTE_MAX` gate uses snapshot-time `dteFront` while
replacement selection uses `daysBetween(cohortNow, expiration)` (wall-clock). Minor skew
across chain latency; can disagree by a day around midnight UTC.
**Fix:** Derive both from the same reference date.

### IN-04: Frozen `changed=true` persists the CHANGED marker indefinitely on a stalled calendar

> **FIXED (a86e5bd):** Closed by WR-02 — `getExitAdvice` forces `changed:false` at read time once
> the row is stale, so a stalled calendar stops showing CHANGED.

**File:** `packages/core/src/exits/application/computeExitAdvice.ts:138-158`
**Issue:** `observedAt = snapshot.time` + `onConflictDoNothing` freezes the row; a calendar
whose snapshots stop keeps its original `changed=true`, so the UI shows CHANGED until fresh
data lands. Low impact (also stale/indicative — once WR-02 is fixed).
**Fix:** Acceptable for the stored-row model; optionally clear at read time when stale.

### IN-05: Escalation `console.warn` misses indicative→actionable transitions

> **FIXED (66eb603):** The warn also fires on an `escalate` false→true onset (previous row not
> escalated, current escalated), independent of `changed`.

**File:** `packages/core/src/exits/application/computeExitAdvice.ts:142`
**Issue:** A STOP suppressed as indicative last cycle that becomes actionable this cycle
(same verdict/rung/ruleId) has `changed=false`, so the ops warn never fires at the moment
the position becomes actionable. UI unaffected; log-only gap.
**Fix:** Also log when `escalate` transitions false→true, independent of `changed`.

---

## Verified clean (traced, no finding)

- **P&L math:** points-scale throughout; `netMark − openNetDebit` over `openNetDebit`
  matches the ledger basis (the D-05 dollar formula divided by `qty·100` — pure ratio, scale
  cancels). Hand-traced: openNetDebit 5.0, netMark 5.30 → +6% → TAKE "+5%". Signs correct
  for a net-debit calendar (profit when netMark > openNetDebit).
- **Threshold boundaries:** TERM `>= 0.005` on front−back (positive when front rich); GAMMA
  `> 0.02` relative to strike with `dte < 7`; EVT ≤3d window with day-before exit stamp
  mirroring picker math; ROLL `dte < 14`, band `<= 0.01`, profit `< 0.15`, replacement
  `[14,21]` inclusive. All match the locked ladder in `docs/architecture/exit-rules.md`.
- **Hysteresis:** arm/disarm asymmetric per rung; `wasArmed` keys on exact ruleId+rung;
  first cycle (null previous) arms fresh only. No flap on the +5.1/+4.8/+5.1 trace.
- **Idempotency/retry:** deterministic observedAt (snapshot time); retry re-evaluation is a
  no-op write; the stored `changed` value survives retries unchanged (retry computes
  changed=false against its own first write, but `onConflictDoNothing` discards it);
  partial-failure resume correct per calendar; dual calendars same cohort fine (composite PK
  includes calendar_id).
- **Strike ×1000:** both composition roots convert once at the boundary; filter compares
  points-to-points (integer ÷1000 exact); no other consumer of `readChainForPicker`
  affected.
- **Route/MCP/UI parity:** one `exitsResponse` schema on both surfaces with identical field
  mapping; UI keyed on verdict enum (no ruleId string matching); no order affordance
  (EXIT-10 holds); `useExits` 404/401/retry handling mirrors sibling hooks.
- **Conventions:** no `any`/`as`/`!` in the diff; hexagon import law holds (exits domain
  imports only shared + own context + exported `haircutFill`); Result usage consistent;
  contract tests use distinct timestamps.

_Reviewed: 2026-07-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
