---
phase: 19-picker-engine-economic-events
reviewed: 2026-07-05T00:09:44Z
depth: standard
files_reviewed: 60
files_reviewed_list:
  - apps/server/src/adapters/http/picker.routes.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/web/src/components/picker/CandidateCard.tsx
  - apps/web/src/hooks/usePicker.ts
  - apps/web/src/screens/Analyzer.tsx
  - apps/worker/src/handlers/compute-gex-snapshot.ts
  - apps/worker/src/handlers/compute-picker.ts
  - apps/worker/src/handlers/fetch-economic-events.ts
  - apps/worker/src/schedule.ts
  - packages/adapters/src/http/economic-events.ts
  - packages/adapters/src/memory/economic-events.ts
  - packages/adapters/src/memory/picker-snapshot.ts
  - packages/adapters/src/postgres/migrations/0014_economic_events.sql
  - packages/adapters/src/postgres/migrations/0015_picker_snapshot.sql
  - packages/adapters/src/postgres/repos/economic-events.ts
  - packages/adapters/src/postgres/repos/picker-chain.ts
  - packages/adapters/src/postgres/repos/picker-snapshot.ts
  - packages/adapters/src/postgres/schema.ts
  - packages/contracts/src/picker.ts
  - packages/core/src/picker/application/computePickerSnapshot.ts
  - packages/core/src/picker/application/getPicker.ts
  - packages/core/src/picker/application/ports.ts
  - packages/core/src/picker/domain/breakevens.ts
  - packages/core/src/picker/domain/candidate-selection.ts
  - packages/core/src/picker/domain/fwd-iv.ts
  - packages/core/src/picker/domain/scoring.ts
  - packages/core/src/picker/domain/types.ts
findings:
  critical: 0
  warning: 5
  info: 2
  total: 7
status: resolved
---

# Phase 19: Code Review Report

**Reviewed:** 2026-07-05T00:09:44Z
**Depth:** standard
**Files Reviewed:** 60 (source subset; 27 load-bearing files enumerated above)
**Status:** resolved — all 5 WARNING findings fixed 2026-07-05 (fix pass, TDD red→green,
one commit per finding; see commits below). The 2 INFO findings are unaddressed
(non-blocking, documented as accepted tradeoffs at the time of review).

## Fix Pass (2026-07-05)

| Finding | Fix | Commit |
|---|---|---|
| WR-01 | `onConflictDoNothing({target: observedAt})` (Postgres) + no-op-on-duplicate (memory twin); shared contract regression | `1963b7a` |
| WR-02 | Inverted `eventAdjustment` caption logic to match penalty semantics (`rawValue > 0 ? "−" : "ok"`) | `b4069cf` |
| WR-03 | Added `observedAt` (full-ISO instant) to `pickerSnapshotResponse` + domain `PickerSnapshot`, stamped from `latestTime` in `computePickerSnapshot.ts`; `CandidateCard`/`CandidateRail` consume it instead of date-only `asOf` for the freshness dot | `122ed87` |
| WR-04 | Candidate id now includes the delta-rung label (`${rung.label}-${K}-${fe}-${be}`), preventing cross-rung id collisions on sparse chains | `9e89e60` |
| WR-05 | `economic-events.ts` always unions `FOMC_SEED` regardless of CPI/NFP fetch outcome — a FRED failure drops only the affected FRED-sourced rows | `4e9c011` |

Full suite (1829 tests, incl. testcontainers), `bun run typecheck`, and `bun run lint` all
green after the fix pass.

## Summary

Reviewed the picker engine (fwd-iv, breakevens, scoring, candidate-selection), the
compute/get use-cases, the picker-snapshot + economic-events persistence layer, the FRED
HTTP adapter, the thin HTTP/MCP/job adapters, and the web rail/card. The numerical core
is genuinely well-guarded: `computeFwdIv` handles the `rad === 0` boundary correctly and
never emits NaN; `findBreakevens` is a bounded, terminating bisection with honest empty
results; `scoreCalendarCandidates` zeroes degraded terms instead of propagating undefined;
Zod-parse runs on both the write and read seams of `picker_snapshot`; SQL is parameterized
throughout. The property tests and msw tests are substantive, not vacuous.

The defects that survived the green suite are on the seams the tests under-exercise:
(1) an **idempotency asymmetry** — the picker snapshot uses a plain `INSERT` on an
`observed_at` primary key, so a same-cohort re-trigger throws a PK violation where the rest
of the pipeline (GEX) upserts idempotently; (2) an **inverted event-adjustment caption**
that displays "ok" for the highest-event-risk candidates; (3) the **date-only `asOf`** that
makes the freshness dot and "as of HH:MM" both misleading in production — and whose "fresh"
test path feeds a full ISO timestamp production never produces; (4) a **duplicate-candidate-id**
possibility across delta rungs; and (5) the **FOMC seed being dropped** whenever the FRED
fetch fails, which — given FRED_API_KEY is unset in this environment — zeroes the event
criterion permanently. No security vulnerabilities and no data-corruption defects found.

## Warnings

### WR-01: `picker_snapshot` INSERT is not idempotent on re-trigger — PK collision loops the terminal job

**File:** `packages/adapters/src/postgres/repos/picker-snapshot.ts:38-41`, `packages/adapters/src/postgres/schema.ts:471-474`, `apps/worker/src/handlers/compute-gex-snapshot.ts:51-55`

**Issue:** `picker_snapshot.observed_at` is the PRIMARY KEY and `insertPickerSnapshot`
does a plain `db.insert(...)` with **no** `onConflictDoNothing`/`onConflictDoUpdate`
(deliberately, per the D-06 "append-only" comment). `observedAt` is derived from the cohort's
latest quote time (`computePickerSnapshot.ts:247-252,318`), NOT `now()`. So any second
compute-picker run for a cohort whose `leg_observations.time` has not advanced inserts the
same `observed_at` → Postgres raises a unique-violation → mapped to `StorageError`
(`:44-45`) → the job handler throws (`compute-picker.ts:40-43`) → pg-boss retries → collides
again. This is reachable: compute-gex-snapshot **upserts** by `cycle_time` and is
deliberately idempotent for re-runs, but on each success it re-enqueues compute-picker
(`compute-gex-snapshot.ts:51`); the `singletonKey` only dedupes *concurrent* enqueues, not a
later re-run of the same cohort (a GEX-job retry, or the compute-bsm-greeks hourly fallback
re-driving the chain with no new fetch). The pipeline's own idempotency contract is broken at
exactly one node.

**Fix:** Make the write idempotent to match the rest of the pipeline (GEX precedent):
```ts
await db.insert(pickerSnapshots)
  .values({ observedAt: row.observedAt, snapshot: validated })
  .onConflictDoNothing({ target: pickerSnapshots.observedAt });
```
Or, if genuine append-history of repeated computes is required, give the table a surrogate
PK (`uuid` + non-unique `observed_at` index) so re-computes append instead of colliding.
Add a testcontainers regression that calls `insertPickerSnapshot` twice with the same
`observedAt` and asserts `ok`, not a thrown StorageError.

### WR-02: Event-adjustment bar caption is inverted — highest-risk candidates read "ok"

**File:** `apps/web/src/components/picker/CandidateCard.tsx:53-54`, cross-ref `packages/core/src/picker/domain/scoring.ts:172`

**Issue:** `scoreOne` sets the `eventAdjustment` breakdown entry's `rawValue` to
`evtPenalty` — the *penalty sum* (0 = clean/no front-leg events, 0.5 = one event, ≥1 = two+
events). The card's caption formatter reads:
```ts
case "eventAdjustment":
  return entry.rawValue >= 1 ? "ok" : "−";
```
So a candidate whose front leg spans **no** events (`evtPenalty = 0`, the ideal case, full
100% bar) renders "−", while a candidate straddling **both FOMC and CPI**
(`evtPenalty = 1.0`, worst case, zeroed bar) renders "ok". The caption inverts the risk
signal in a trading tool. No test asserts this caption (`CandidateCard.test.tsx` checks bar
widths and guard states but never the eventAdjustment caption text), so the green suite hides
it.

**Fix:** Base the caption on the penalty's true meaning (or on `contribution`):
```ts
case "eventAdjustment":
  return entry.rawValue > 0 ? "−" : "ok"; // penalty present → adjusted; clean → ok
```
and add an assertion for both branches.

### WR-03: Date-only `asOf` makes the staleness dot always-amber and the "as of HH:MM" time wrong; the "fresh" test uses an unrealistic full-ISO `asOf`

**File:** `apps/web/src/components/picker/CandidateCard.tsx:65-73`, cross-ref `packages/core/src/picker/application/computePickerSnapshot.ts:252,306` and `apps/web/src/components/picker/CandidateCard.test.tsx:314-346`

**Issue:** Production `asOf` is a date-only `YYYY-MM-DD` string (`asOfIso =
latestTime.toISOString().slice(0, 10)`; contract comment confirms). `formatAsOf` does
`new Date(asOf)` → UTC midnight of that day, then:
- freshness = `ageMs < GEX_FRESH_MS` where `GEX_FRESH_MS = 35 min`. During RTH the age from
  UTC-midnight is 13.5–20 h, so the dot is **always amber** for a genuinely fresh snapshot
  (errs safe — never falsely green — but is uninformative).
- the label `as of ${hhmm}` renders the local-time formatting of UTC midnight, i.e. a
  constant timezone-offset artifact (e.g. always "20:00"/"19:00" in ET), **never the real
  snapshot instant.**

The `renders 'as of {HH:MM}' with a fresh (bg-up) dot` test (`:314`) feeds
`asOf={new Date().toISOString()}` — a full ISO timestamp the production compute path never
produces — so the only test exercising the "fresh" branch proves an unreachable code path
(green-suite false confidence).

**Fix:** Either carry a full instant in the contract (add a `computedAt`/`observedAt` ISO
timestamp to `pickerSnapshotResponse` and stamp it from `latestTime.toISOString()` in
`computePickerSnapshot.ts`, feeding *that* to `formatAsOf`), or change the fresh-path test to
use a date-only `asOf` and assert the amber/`—` outcome so the test matches production data.

### WR-04: Duplicate candidate `id` possible across delta rungs → React key collision + combined-book double-toggle

**File:** `packages/core/src/picker/domain/candidate-selection.ts:197-240`

**Issue:** The candidate `id` is `` `${K}-${fe}-${be}` `` (`:240`). `K` is
`nearestStrikeByDelta(...)` resolved *per delta rung*. The module's dedupe-by-construction
argument (Pitfall 5) only guarantees a single back-expiry per `(rung, frontExpiry)`; it does
**not** prevent two different rungs (e.g. `20D` and `10D`) from resolving to the *same*
nearest strike for the same front expiry when the chain is sparse or deltas compress at short
DTE. That yields two candidates with identical `id`, `frontLeg`, and `backLeg`. Downstream:
`rankAndCapCandidates` keeps both (`localeCompare === 0`), `CandidateCard`/`CandidateRail`
render two elements with the same React `key={candidate.id}` (`Analyzer.tsx:121`,
duplicate-key warning), and `combinedIds`/`copiedId` (keyed by id) toggle both at once.

**Fix:** Include the delta rung in the id, e.g. `` `${rung.label}-${K}-${fe}-${be}` ``, or
dedupe resolved `(K, fe, be)` triples before emitting. Add a selection test with a
deliberately sparse strike ladder where two rungs collapse to one strike and assert unique
ids.

### WR-05: FOMC seed is dropped whenever the FRED CPI/NFP fetch fails — zero events when FRED_API_KEY is unset

**File:** `packages/adapters/src/http/economic-events.ts:125-150`

**Issue:** The adapter returns `err({kind:"fetch-error"})` for a missing/empty key or any
CPI/NFP failure and, per the D-17 no-partial-fallback comment, does **not** return the
hand-maintained `FOMC_SEED` alone. The worker handler then persists nothing
(`fetch-economic-events.ts:31-35`), so `economic_events` stays empty →
`eventsContextStatus = "missing"` → the event criterion is zeroed for every candidate. The
file's own header and MEMORY note record that `FRED_API_KEY` is **absent in this
environment**, so in the current prod config the picker will *never* have any economic
events — not even FOMC, the single largest scheduled event for an index-vol calendar — and
FOMC availability is coupled to CPI/NFP fetch success it does not actually depend on. The
degradation is surfaced honestly via `eventsContextStatus`, so this is a design tradeoff, not
a silent corruption — but the operational outcome (permanently zeroed event scoring) is
severe enough to flag.

**Fix:** Decouple the seed from the FRED path: return the FOMC seed with
`eventsContextStatus` still reflecting the CPI/NFP fetch outcome (e.g. persist FOMC on FRED
failure while tagging events partial/stale), or set `FRED_API_KEY` in the deploy env and add
a health check that alerts when `economic_events` is empty during RTH.

## Info

### IN-01: Whole-snapshot `source` taken from the lowest-strike quote

**File:** `packages/core/src/picker/application/computePickerSnapshot.ts:256-258`

**Issue:** `source = firstQuote.source` where `firstQuote = chain[0]` and the chain repo
orders by `strike ASC` (`picker-chain.ts:58`). A cohort that mixes `schwab` and `cboe`
sources (e.g. during a vendor transition) is labeled by whichever vendor owns the lowest
strike, not by the dominant source.

**Fix:** If cohorts can be mixed, resolve `source` by majority (or carry per-quote source);
otherwise document the single-source cohort invariant at the port so the assumption is
explicit.

### IN-02: `readEconomicEvents` returns the full unfiltered table including historical FRED dates

**File:** `packages/adapters/src/postgres/repos/economic-events.ts:53-68`, cross-ref `packages/adapters/src/http/economic-events.ts:99-101`

**Issue:** `fetchReleaseDates` maps every row FRED returns (no forward-date filter) and the
repo reads them all back on every compute. Functionally correct — `legSpansEvents` filters to
`(today, expiry]` — but the table accumulates historical CPI/NFP dates indefinitely (bounded
per `(date,name)` PK, but monotonically growing), and every compute reads the full set.

**Fix:** Optional — filter the FRED fetch (or the read) to a forward horizon (e.g. events on
or after `today − freshnessWindow`) to keep the working set small; not a correctness issue.

---

_Reviewed: 2026-07-05T00:09:44Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
