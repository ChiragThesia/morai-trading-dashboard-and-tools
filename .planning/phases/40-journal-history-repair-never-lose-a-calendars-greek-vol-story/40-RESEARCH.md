# Phase 40: Journal History Repair - Research

**Researched:** 2026-07-14
**Domain:** Codebase-internal data-layer repair (Postgres query correctness, pg-boss job wiring, options-symbol/root resolution) — no external library research needed
**Confidence:** HIGH

## Summary

HIST-01's back-leg NaN is not a fetch-window or BSM-starvation problem — it is a **symbol/root
mismatch bug**, already half-documented in the codebase's own comments, that this research
traced to four exact call sites. The calendar `SPX 7600P` (front `2026-11-20`, back
`2026-11-30`) has a front leg that is a real, exchange-standard **SPX** monthly (`2026-11-20` is
the 3rd Friday of November) and a back leg that Cboe lists under the **SPXW** root (Cboe's own
product spec: "SPXW is the ticker symbol for SPX Weeklys **and SPX End-of-Month options**";
`2026-11-30` is a Monday, the last trading day of the month, not the 3rd Friday). The `calendars`
table stores only ONE `underlying` root for both legs — `registerOpenCalendars.ts` documents
this as a known, unfixed limitation ("the back leg's occSymbol will be mis-derived ... until a
future schema change"). Every leg-resolution path that builds the back leg's OCC symbol from
`calendar.underlying` (`getOpenCalendarLegs` ×2 adapters, `resolveLegSnapshot`'s `contracts.root`
match, `getLiveGreeks`'s `frontOcc`/`backOcc`) constructs `SPX   261130P07600000` — a string Cboe
never publishes, since the real contract is `SPXW261130P07600000`. The back leg's data may
already exist, fully BSM-processed, in `leg_observations` under the correct symbol; it is simply
never looked up. This ALSO defeats the D-04 "targeted fetch" bypass that was built specifically
to save far-dated calendar legs from the 90-day DTE filter (`BSM_MAX_DTE=90`; the Nov-30 back leg
is ~139 days out) — the bypass allowlist is built from the same wrong-root symbol, so it silently
never matches the real, correctly-rooted quote Cboe returns. The historical timeline (49 all-NaN
rows Jul-06→Jul-08, then total silence from Jul-08 onward) is fully explained by this SAME bug
crossing the OPS-01 (Phase 25) deploy boundary: pre-OPS-01, a null leg still produced a gap row;
post-OPS-01, a null leg fails the freshness gate and the whole cycle is skipped.

Two further structural findings shape HIST-02/03/04/05: (1) the existing write port
(`ForPersistingSnapshot`) is `onConflictDoNothing` — **insert-only**, and cannot satisfy D-03's
"replace a gap row with a healed one" requirement; a new conditional-write port is required, not
just a new read port. (2) `readJournal`'s `mapSnapshotRow` silently **drops any row whose
`source !== 'cboe'`** — already a documented pitfall for a sibling port — which means a healed
row resolved from a `schwab_chain`-sourced observation would be silently invisible in the exact
UI (`LifecycleChart`) this phase exists to fix, unless the rebuild path is made source-inclusive
or `mapSnapshotRow` itself is fixed. HIST-05's ~19-vs-13 rows/day is fully explained by a
scheduling collision: `compute-bsm-greeks` has BOTH a chain-trigger (from the 30-min
`fetch-schwab-chain`) AND an independent hourly `0 * * * *` fallback cron; near the top of every
hour both paths independently enqueue `snapshot-calendars`, producing two near-simultaneous
writes with different exact timestamps (the composite PK is `(time, calendar_id)`, and `time` is
wall-clock-exact, not slot-rounded, so `onConflictDoNothing` never collapses them).

**Primary recommendation:** Fix root resolution ONCE as a shared pure function
(`resolveRootCandidates(underlying) → ["SPX","SPXW"] | ["SPXW"]`) reused at all four broken call
sites (no date-of-week heuristic needed at the resolve/read side — prefer a root-agnostic
`contracts` lookup that tries both candidates and trusts whichever one actually has data); add
ONE new conditional-write port that reuses the ALREADY-LOCKED `isGapRow` predicate
(`attribution.ts`) instead of inventing a second definition of "gap"; and fix HIST-05 by rounding
`scheduled`-trigger snapshot timestamps down to the nearest 30-min RTH slot before persisting, so
the EXISTING composite-PK `onConflictDoNothing` naturally collapses same-slot duplicate writes
with zero new dedup logic.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Root/occSymbol resolution fix (HIST-01) | API/Backend (`packages/core` domain fn) | Database/Storage (`contracts.root` already stores the correct value per-quote; the bug is in the match, not the data) | Pure logic bug — no schema or vendor-data problem |
| Historical slot rebuild (HIST-02) | API/Backend (new pure use-case in `packages/core`) | Database/Storage (new as-of-slot query in `packages/adapters`) | Derivation logic must stay pure/testable; only the raw read is I/O |
| Fill-only heal write (HIST-02/03) | Database/Storage (new conditional-write port/SQL) | API/Backend (use-case decides gap-vs-live via `isGapRow` before calling it) | The "never overwrite a live row" guarantee is safest as one atomic SQL condition, not a read-then-write race in application code |
| Self-heal recurring job (HIST-03) | API/Backend (worker job handler + use-case) | Database/Storage (bounded-lookback query) | Matches existing job-handler-as-thin-adapter convention |
| Operator CLI repair (HIST-04) | API/Backend (CLI orchestrator script) | — | Mirrors `fix-pnl-reingest.ts`/`backfill-transactions.ts` — a composition-root script, not a new architectural layer |
| On-register backfill (HIST-04) | API/Backend (`registerOpenCalendars` use-case extension or chained job) | — | Registration is already an application-layer use-case; backfill is a natural chained effect |
| Series hygiene / dedup (HIST-05) | API/Backend (slot-boundary-rounding pure fn in `snapshotCalendars.ts`'s caller) | Database/Storage (existing composite PK does the actual dedup once the key is correct) | No new dedup mechanism needed — fix the key, reuse the existing constraint |

There is no Browser/Client, Frontend-Server, or CDN/Static involvement — D-01 is explicit that
this is a zero-UI, data-layer-only phase.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 Data-only phase.** Zero UI changes. The lifecycle chart is starved, not broken —
  when rows exist and are non-gap, all four panels light up.
- **D-02 No formula drift.** The rebuild path derives rows with the SAME pure functions the
  live writer uses: `computeLegPairMetrics` (snapshotCalendars.ts, PICK-04 extraction) +
  `computeSnapshotPnl`. If rebuild needs the functions exported/moved, that is a pure
  extraction refactor with tests unchanged.
- **D-03 Fill-only upsert.** Rebuild/self-heal NEVER overwrites an existing non-gap row.
  A gap row (spot=0 or NaN greek) MAY be replaced by a healed non-gap row for the same
  (calendar_id, time-slot). Live rows always win over healed rows.
- **D-04 Honest-gap law.** Where `leg_observations` truly has no usable data for a slot
  (missing contract, no mark), the slot stays absent/gap — never interpolated, never
  fabricated. D-05/D-06 gap-drawing conventions in the chart stay meaningful.
- **D-05 OPS-01 stays.** The live freshness gate keeps refusing to write stale marks as
  fresh. Self-heal is the complement: skipped/missed slots get repaired from observations
  once usable data exists, within a bounded lookback (default 7 days) — plus the CLI for
  unbounded one-time repair.
- **D-06 HIST-01 is root-cause-first.** Investigate WHERE the back-leg NaN comes from
  before coding: NULL bsm_* = never-processed (BSM batch starvation tell) vs 'NaN' string
  = inversion failed (mark ≤ intrinsic / bad inputs) vs contract absent from the fetch
  window (D-04 ForGettingOpenCalendarLegs targeted-fetch supposedly guarantees open-calendar
  legs are always captured — verify it actually covers the back leg's EOM date 261130).
  Fix at the root; do not special-case symptoms.
- **D-07 Slot semantics.** Journal cadence = 30-min RTH slots. Rebuild targets each slot
  between max(openedAt, first-observation) and min(closedAt, now); per slot, resolve each
  leg's observation nearest-within-the-slot (reuse the existing freshness window as the
  usability bound). One scheduled row per slot (HIST-05); event-move rows stay distinct via
  `trigger`.
- **D-08 Rebuild never writes outside openedAt..closedAt.** Kills the "closed calendar
  kept snapshotting 4 days" class; also trim/ignore live rows outside the life window when
  rebuilding (do NOT delete user-visible history silently — replace only gap rows, and
  post-close rows may be deleted only by the explicit CLI repair with a printed count).
- **D-09 Consumers must stay consistent.** `replayExitsForCalendar` (backtest) and the exit
  advisor read journal rows — backfilled history changes their inputs. That is the POINT
  (better data), but the phase must run the existing backtest/exit suites green and note
  in the SUMMARY that historical verdicts may shift after repair.
- **D-10 Ops discipline.** New/changed worker job + any schema change → docs first
  (docs/architecture, stack-decisions if a new mechanism), migration via drizzle if needed
  (expect NONE — calendar_snapshots composite PK (calendar_id, time) already supports
  upsert; verify). Prod repair run is operator/orchestrator-executed after deploy, with
  before/after coverage counts printed.

### Claude's Discretion

Anything not pinned above: job wiring (chained vs cron), CLI naming, lookback constant,
batching sizes, test structure — follow existing patterns (fix-pnl-reingest.ts,
backfill CLIs, snapshot-calendars handler idioms).

### Deferred Ideas (OUT OF SCOPE)

- Market-context history in the journal (GEX walls / skew / full term structure / regime
  at each snapshot) — separate future phase; needs its own storage + UI design.
- Smile-IV for far-dated legs — standing DO-NOT-BUILD (TOS default = Individual IV).
- Tick-level journal cadence — contradicts STRM-04 + 30-min design.
- Journal UI redesign — user's "doesn't cut it" is about lost DATA; revisit presentation
  only if the repaired data still reads poorly.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HIST-01 | Root-cause and fix the far-dated back-leg NaN | Root Cause Chain section (below) identifies the SPX/SPXW root-mismatch bug at 4 exact call sites, cited against Cboe's own product spec and the codebase's pre-existing "KNOWN LIMITATION" docstring; diagnostic SQL specified to CONFIRM against live data before coding (D-06 mandate); compounding DTE-filter interaction documented |
| HIST-02 | Pure rebuild use-case deriving calendar_snapshots from leg_observations, no formula drift, fill-only upsert | Slot-resolution port design (mirrors `readSmile`'s as-of-time pattern + `resolveLegSnapshot`'s contracts-join pattern); D-02 reuse of `computeLegPairMetrics`/`computeSnapshotPnl` confirmed exported; CRITICAL finding that `ForPersistingSnapshot` cannot satisfy fill-only semantics — new port required, reusing `isGapRow` |
| HIST-03 | Recurring self-heal job for OPEN calendars, bounded lookback, OPS-01 gate stays | Job-wiring precedent (chain-trigger vs cron tradeoffs documented from `schedule.ts`); recommended to share the SAME rebuild use-case as HIST-04 with a bounded-lookback parameter, not a separate implementation |
| HIST-04 | Operator CLI (one calendar or all) + on-register backfill from openedAt | `fix-pnl-reingest.ts`/`backfill-transactions.ts` CLI precedent fully documented (pure orchestrator + `import.meta.main` composition root); `registerOpenCalendars.ts` identified as the exact hook point for on-register backfill; `TRIGGERABLE_JOBS`/`triggerJobBodyFor` contract pattern documented for optional HTTP/MCP on-demand triggering |
| HIST-05 | At most one scheduled row per 30-min slot; rebuild never writes outside openedAt..closedAt | Root cause of the ~19-vs-13 rows/day fully traced to the `compute-bsm-greeks` hourly-fallback-cron vs 30-min chain-trigger collision in `schedule.ts`; fix recommended (round `scheduled`-trigger timestamps to slot boundary, reuse existing composite PK) requires zero new dedup mechanism |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

These directives carry the same authority as CONTEXT.md's locked decisions — the plan must not
contradict them:

1. **Dependencies point inward** — `core` imports `shared` only. The new root-resolution
   function, rebuild use-case, and heal port types all belong in `packages/core`; Drizzle/SQL
   stays confined to `packages/adapters/postgres/`.
2. **TDD red→green** — every pure function (root resolution, slot-rounding, the rebuild
   use-case) and every new port needs a RED test run before the GREEN implementation. Numerical
   code (this phase touches BSM-adjacent leg-pair math indirectly via `computeLegPairMetrics`
   reuse, and the new slot-rounding function) needs fast-check property tests per `tdd.md`.
3. **No `any`, no `as`, no `!`** — the existing codebase's `parseOccSymbol`/Zod-at-boundary
   idiom must be followed for any new symbol/root parsing.
4. **Docs before architecture changes** — `docs/architecture/jobs.md`'s Job Catalog table (and
   its `snapshot-calendars` row, which currently reads "historical gap rows are never
   backfilled — self-healing on the next fresh cycle") must be updated BEFORE the self-heal job
   ships, since this phase makes that sentence false. Two more explicit "never backfilled"
   claims exist at `docs/architecture/jobs.md:127-129` (macro/FRED gap policy — NOT touched by
   this phase, leave as-is, it's a different job) and the general Job Catalog `snapshot-calendars`
   row (Phase 40 makes this stale, must rewrite). A new pg-boss job (self-heal / CLI-triggerable)
   is "new tooling" under this rule → the planner's Wave 0 / first task should be a docs-only
   commit updating `docs/architecture/jobs.md` with the new job's row and the corrected
   backfill-policy language, ahead of any code.
5. **Architecture-boundaries rule 8 (in-memory twin)** — every new/changed driven port (the new
   slot-resolution read port AND the new conditional-write/heal port) needs its Postgres
   implementation AND its `packages/adapters/src/memory/` twin in the same PR, contract-tested
   against both (see Testing section below).
6. **Architecture-boundaries rule 9 (HTTP route + MCP tool "same PR")** — this rule is
   explicitly WAIVED for this phase's new use-case(s) per D-01's phase-boundary scoping: the
   rebuild/self-heal use-case is a CLI + job concern, not a new read API, and ships with zero
   new HTTP/MCP surface. The ONE optional exception: if the planner wants the CLI's underlying
   rebuild job to also be manually triggerable in prod without `railway run` shell access
   (matching `rebuild-journal`'s `POST /api/jobs/rebuild-journal/trigger` precedent), adding it
   to `TRIGGERABLE_JOBS` (`packages/contracts/src/jobs.ts`) is a one-line, already-generic
   extension — not a rule violation, since the route/tool ALREADY exists generically. Flag as
   Claude's Discretion (CONTEXT.md explicitly delegates "job wiring").

## Standard Stack

### Core

No new external packages. This phase is a pure internal data-layer fix reusing the existing
stack:

| Library | Version (installed) | Purpose | Why Standard (here) |
|---------|---------|---------|--------------|
| Drizzle ORM | already in `packages/adapters` | New Postgres queries (slot-resolution read, conditional heal write) | Existing convention; confined to `packages/adapters/postgres/` per architecture-boundaries.md §4 |
| pg-boss | already in `apps/worker` | New self-heal job registration (HIST-03) | Existing job runner; `schedule.ts`/`registerAllJobs` is the one place cron/chain-trigger wiring lives |
| Zod | already everywhere | Payload/CLI-arg parsing at boundaries | typescript.md "parse, don't cast" |
| Vitest + fast-check + testcontainers | already in root `package.json` (`fast-check ^4.8.0`), `vitest.config.ts` | Unit/property/contract tests | tdd.md-mandated stack; Docker confirmed available this session (see Environment Availability) |

### Supporting

None — no new supporting libraries needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing `isGapRow` (attribution.ts) for the heal-write's gap predicate | Re-deriving a second "is this row a gap" condition directly in SQL | Rejected: `isGapRow`'s definition is explicitly LOCKED by a "do NOT relitigate" docstring; a second, hand-written SQL predicate would drift the moment either definition changes |
| A pure day-of-week "is 3rd Friday → SPX else SPXW" classifier for root resolution | A root-agnostic `contracts` table lookup (try both roots, trust whichever has data) | The classifier is needed ONLY at `getOpenCalendarLegs` (constructing a symbol before any contract row can exist yet — a genuine chicken/egg case). Everywhere else (`resolveLegSnapshot`, `getLiveGreeks`), a root-agnostic/try-both lookup against the ALREADY-CORRECTLY-ROOTED `contracts`/`leg_observations` data (populated by the OSI-parsing fetch adapters, which are NOT buggy) is simpler and has zero risk of an incorrect date-math edge case (holiday-shifted Fridays, EOQ specials, etc.) |

**Installation:** None required — zero new dependencies.

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** All new code (root-resolution
pure function, rebuild use-case, heal port, self-heal job, CLI) uses only already-installed,
already-audited dependencies (Drizzle, pg-boss, Zod, Vitest/fast-check/testcontainers).

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Root Cause Chain (HIST-01) — Detailed

### The bug, precisely

`calendars.underlying` (`packages/adapters/src/postgres/schema.ts:58`) is a SINGLE root string
shared by both legs. `registerOpenCalendars.ts` (`packages/core/src/journal/application/registerOpenCalendars.ts:29-37`)
documents this as a **pre-existing, unfixed KNOWN LIMITATION**, verbatim:

> "the calendars table's `underlying` column is a single root string shared by BOTH legs... A
> calendar whose front and back legs have DIFFERENT OCC roots (e.g. front SPX-standard, back
> SPXW-weekly) cannot be fully represented — this use-case stores the front leg's root (the best
> available single value), so the back leg's occSymbol will be mis-derived by the existing
> fill-matching/snapshot-resolution paths until a future schema change stores per-leg root."

`position-pairing.ts` (`packages/core/src/journal/domain/position-pairing.ts:12-14`) independently
documents that this mixed-root pattern is REAL and EXPECTED for this exact underlying:

> "Keying on underlyingSymbol (not OCC root) is required for a real calendar spread whose front
> leg is SPX-rooted (standard monthly expiry) and back leg is SPXW-rooted (weekly) — both share
> the same underlyingSymbol ('$SPX') even though their OCC roots differ."

**Confirmed date math (computed this session via `date -j`):** November 2026's Fridays are the
6th, 13th, 20th, and 27th — so **Nov 20, 2026 is the 3rd Friday** (standard monthly, root
`SPX`). **Nov 30, 2026 is a Monday** — not a Friday at all, and (since Nov has 30 days) the last
trading day of the month.

**Confirmed via Cboe's own product documentation** [CITED: cboe.com — SPX End-of-Month Options
Contract Specifications, cboe.com/tradable-products/sp-500/spx-options/end-of-month-options]:
"SPXW is the ticker symbol for SPX Weeklys and SPX End-of-Month options... SPX EOM options
feature expiration dates that fall on the last business day of the month, as opposed to the
standard third Friday of the month expirations." This means the back leg's real, exchange-listed
OCC root is **SPXW**, not `calendar.underlying`'s stored value **SPX** (the front leg's root).

### The four broken call sites

All four construct or match an OCC root using `calendar.underlying` for BOTH legs, instead of
resolving each leg's OWN correct root:

1. **`packages/adapters/src/postgres/repos/calendars.ts:330-364`** (`getOpenCalendarLegs`) —
   builds `formatOccSymbol({root: row.underlying === "SPXW" ? "SPXW" : "SPX", ...})` for BOTH
   `front` and `back`. This is the D-04 "targeted fetch" mustInclude set — for this calendar it
   constructs `SPX   261130P07600000` for the back leg, which Cboe never emits.
2. **`packages/adapters/src/memory/calendars.ts:135-159`** — byte-identical bug, in-memory twin
   of #1 (must be fixed together, architecture-boundaries.md rule 8).
3. **`packages/adapters/src/postgres/repos/calendar-snapshots.ts:140-215`** (`resolveLegSnapshot`)
   — Step 1 queries `eq(contracts.root, query.underlying)` (line ~157). `snapshotCalendars.ts`
   (`packages/core/src/journal/application/snapshotCalendars.ts:257-267`) calls `resolveLegs`
   for BOTH front and back with the SAME `underlying: calendar.underlying`. For the back leg,
   this queries `contracts WHERE root='SPX' AND expiration='2026-11-30' AND ...` — but the real
   contract row (correctly populated by the OSI-parsing fetch adapter) has `root='SPXW'`. Zero
   rows match → `ok(null)` → the leg is `null` → `isLegFresh(null, now)` → `false` → OPS-01's
   freshness gate skips the WHOLE calendar's cycle (`snapshotCalendars.ts:279-284`).
4. **`packages/core/src/journal/application/getLiveGreeks.ts:66-81`** — constructs
   `frontOcc`/`backOcc` via `root = cal.underlying === "SPXW" ? "SPXW" : "SPX"`, same bug. This
   is the EXACT tool (`get_live_greeks`) CONTEXT.md's own diagnosis used — the printed
   `SPX   261130P07600000` in CONTEXT.md's evidence is literally this buggy constructed string,
   not necessarily proof that leg_observations has no data at all.

Critically, **`getLiveGreeks.ts`'s NaN output cannot distinguish** "no observation exists" from
"observation exists but `bsm_iv` is DB-NULL (never processed)" from "observation exists with
`bsm_iv='NaN'` (inversion failed)" — all three collapse to the same NaN-stamped display (line
90-99: `obs === null` → NaN; line 103: `obs.bsmIv ?? NAN_STAMP` → NaN for DB-NULL too). This
means CONTEXT.md's live diagnosis, while correctly identifying WHICH leg is broken, cannot by
itself distinguish this root-mismatch hypothesis from a genuine BSM-starvation/inversion-failure
hypothesis — see Diagnostic SQL below, which the executor MUST run first per D-06.

### Compounding: the DTE filter (independent second bug, likely same fix resolves both)

`apps/worker/src/config.ts:22` sets `BSM_MAX_DTE` default = **90 days**. The back leg
(`2026-11-30`) is ~139 calendar days from "today" (2026-07-14) — it fails
`fetchChain.ts`'s `isInFilter` DTE gate (`packages/core/src/journal/application/fetchChain.ts:70-83`)
UNLESS the D-04 `mustInclude` bypass (`fetchChain.ts:172-175`, `processChain`) saves it. Since
`mustInclude` is built from the SAME buggy wrong-root symbol (call site #1 above), the bypass
allowlist contains `SPX   261130P07600000` but the vendor's real, correctly-rooted quote arrives
as `SPXW261130P07600000` (via `mapCboeOption`/`osiToOcc` in `packages/adapters/src/http/cboe.ts`,
which correctly parses the vendor's real OSI string) — **the bypass never matches**, so even
persisting the raw observation at all may currently fail the DTE filter for this leg. Fixing the
root-resolution bug at the mustInclude construction site is very likely SUFFICIENT to fix this
compounding issue too, since D-04 was purpose-built to defeat exactly this DTE cap for calendar
legs — it only needs to target the correct symbol string.

### Timeline reconciliation (why 49 gap rows Jul-06→Jul-08, THEN total silence)

This is fully consistent with ONE persistent bug (the root mismatch) crossing the OPS-01 deploy
boundary (Phase 25, part of v1.3, added 2026-07-09 per STATE.md):

- **Before OPS-01 (≤ Jul-08):** `snapshotCalendars.ts`'s OLD behavior (no freshness gate) wrote
  a row EVERY cycle regardless of a null leg, null-coalescing to spot=0/NaN (the "Jul-06
  mechanism" the current code's comments reference at `snapshotCalendars.ts:8`). A null back leg
  (root mismatch, unrelated to OPS-01) → gap row, every 30-min cycle → the 49 all-NaN rows.
- **After OPS-01 (Jul-09 onward):** the SAME null back leg now makes `isLegFresh` return
  `false` → the freshness gate SKIPS the whole cycle (`continue`, no row at all) → zero rows,
  matching "zero rows since Jul 8 19:46Z."
- **No calendar has ANY row before Jul-06** is a SEPARATE, already-understood cause (the Jul-1
  chain-source-cutover outage + late registration — see project memory
  `morai-chain-source-cutover-outage.md`), not part of the root-mismatch story; HIST-04's
  backfill-from-`openedAt` addresses it directly.

### Diagnostic SQL (run FIRST, per D-06 — do not code before confirming)

```sql
-- 1. Does the back leg's real contract exist under EITHER root, and which one?
SELECT occ_symbol, root, contract_type, strike, expiration
FROM contracts
WHERE expiration = '2026-11-30' AND strike = 7600000 AND contract_type = 'P';
-- Expect: a row with occ_symbol='SPXW261130P07600000', root='SPXW'. If ZERO rows: the DTE-filter
-- compounding bug (or a genuine vendor-absence) is blocking persistence entirely — check further.

-- 2. Does leg_observations have healthy, BSM-processed data under the REAL root, vs the
--    WRONGLY-queried root the code currently asks for?
SELECT contract, time, mark, bsm_iv, bsm_delta, source
FROM leg_observations
WHERE contract IN ('SPXW261130P07600000', 'SPX   261130P07600000')
ORDER BY time DESC LIMIT 20;
-- If SPXW261130... has recent non-NULL, non-'NaN' bsm_iv rows and SPX   261130... has ZERO rows:
-- root-mismatch hypothesis CONFIRMED — the fix is a resolution-logic fix, not a BSM/fetch fix.

-- 3. Confirm both open calendars' stored underlying + expiries:
SELECT id, underlying, strike, option_type, front_expiry, back_expiry, status, opened_at
FROM calendars WHERE status = 'open';

-- 4. Generalize across all 17 calendars — for each, does front_expiry's weekday differ from
--    back_expiry's in a way that implies a root split (one IS the 3rd Friday, the other ISN'T)?
SELECT id, underlying, front_expiry, to_char(front_expiry, 'Dy') AS front_dow,
       back_expiry, to_char(back_expiry, 'Dy') AS back_dow
FROM calendars ORDER BY opened_at;
```

If query 2 shows the real (`SPXW`-rooted) symbol has healthy recent data, HIST-01's fix is a
pure resolution-logic change with NO data loss — the archive already has what's needed.

## Architecture Patterns

### System Architecture Diagram

```
LIVE WRITE PATH (existing, partially broken by the root-mismatch bug):

  fetch-schwab-chain (cron */30 * 24/7; dual-source Schwab+CBOE, or CBOE-only fallback)
        |
        v
  leg_observations + contracts  <───────────────────┐
        |  (chain-trigger, singletonKey "triggered-by-chain")
        v                                            │ resolveLegSnapshot's contracts.root
  compute-bsm-greeks (+ hourly 0 * * * * fallback)    │ match fails for the back leg (HIST-01) —
        |  invertIv -> bsm_iv/delta/gamma/theta/vega  │ query asks for the WRONG root
        |  (chain-trigger "triggered-by-compute";     │
        |   ALSO independent hourly cron -> HIST-05)  │
        v                                             │
  snapshot-calendars (RTH-gated write)                │
        |  resolveLegs(underlying, strike, type, expiry) x2 [front, back] ──────┘
        |  OPS-01 freshness gate -> null leg => SKIP whole cycle (no row)
        |  computeLegPairMetrics + computeSnapshotPnl (pure, D-02 no-drift)
        v
  calendar_snapshots  ── persistSnapshot = onConflictDoNothing (INSERT-ONLY —
        |                 cannot heal an existing gap row; D-03 needs a NEW port)
        v
  readJournal (mapSnapshotRow DROPS any row where source != 'cboe' — pitfall)
        v
  getCalendarLifecycle -> LifecycleChart (UI, unchanged, D-01)

  [also: readLatestSnapshotPerOpenCalendar -> exit advisor (source-inclusive, already fixed)]
  [also: readFullSnapshotHistoryForCalendar -> replayExitsForCalendar backtest (source-inclusive)]


NEW REPAIR PATH (this phase, HIST-02/03/04):

  leg_observations (full-chain archive since 2026-06-12 — the raw material)
        |
        v
  [NEW] resolve-leg-observation-for-slot port
        (mirrors readSmile's "latest at-or-before an anchor" pattern +
         resolveLegSnapshot's contracts-join pattern; root-candidate-aware —
         reuses the SAME fix as the live path, tries both SPX/SPXW roots)
        |
        v
  [NEW] rebuildCalendarHistory use-case (pure, packages/core)
        for each 30-min RTH slot in [max(openedAt, firstObs) .. min(closedAt, now)]:
          resolve front+back leg observation for that slot
          computeLegPairMetrics(...) + computeSnapshotPnl(...)   <- SAME fns, D-02
          honest-gap: no usable data for the slot => produce nothing (D-04)
        |
        v
  [NEW] heal-snapshot write port (conditional, NOT onConflictDoNothing)
        existing row absent      -> INSERT
        existing row IS a gap    -> UPDATE   (gap test = isGapRow, reused from attribution.ts)
        existing row is NOT a gap -> NO-OP   (D-03: live rows always win)
        |
        +──> apps/worker CLI (one calendar or all; mirrors fix-pnl-reingest.ts /
        |     backfill-transactions.ts; unbounded lookback) ─────────────── HIST-04
        |
        +──> [NEW] self-heal-journal job (bounded 7-day lookback default,
        |     OPEN calendars only; chain-triggered or cron — Claude's discretion) ── HIST-03
        |
        +──> registerOpenCalendars use-case (backfill [openedAt, now] for a
              newly/late-registered calendar) ─────────────────────────────  HIST-04
```

### Recommended Project Structure

No new top-level directories — everything lands in the existing journal bounded context and
worker app:

```
packages/core/src/journal/
├── domain/
│   ├── occ-root.ts              # NEW: resolveRootCandidates(underlying) pure fn + tests
│   ├── attribution.ts            # EXISTING: isGapRow — reused, not reimplemented
│   └── ...
├── application/
│   ├── ports.ts                  # ADD: ForResolvingLegObservationForSlot,
│   │                              #      ForHealingSnapshot (new conditional-write port)
│   ├── rebuildCalendarHistory.ts # NEW: pure use-case (HIST-02)
│   ├── selfHealJournal.ts        # NEW: bounded-lookback wrapper over rebuildCalendarHistory (HIST-03)
│   └── registerOpenCalendars.ts  # EXTEND: chain a backfill call after registration (HIST-04)

packages/adapters/src/postgres/repos/
├── leg-observations.ts           # ADD: as-of-slot read query (mirrors readSmile pattern)
└── calendar-snapshots.ts         # ADD: heal-write query; FIX: resolveLegSnapshot root match;
                                   #      FIX: mapSnapshotRow source-inclusive (pitfall)

packages/adapters/src/memory/
├── leg-observations.ts           # twin of the new read query
└── calendar-snapshots.ts         # twin of the new heal-write query

apps/worker/src/
├── handlers/self-heal-journal.ts # NEW: thin handler (HIST-03)
├── repair-journal-history.ts     # NEW: CLI, import.meta.main-guarded (HIST-04)
└── schedule.ts                   # ADD: new queue registration

docs/architecture/jobs.md         # UPDATE FIRST (docs-before-code, CLAUDE.md rule 4)
```

### Pattern 1: Root-candidate resolution (fixes HIST-01 at all 4 call sites with ONE function)

**What:** A single pure function returning the ordered root candidates to try for a leg, given
the calendar's stored `underlying`.
**When to use:** Any place currently doing `underlying === "SPXW" ? "SPXW" : "SPX"` for a
specific leg's expiry.
**Example (recommended shape, not prescriptive of file layout):**
```typescript
// packages/core/src/journal/domain/occ-root.ts
export function resolveRootCandidates(underlying: string): ReadonlyArray<"SPX" | "SPXW"> {
  if (underlying === "SPXW") return ["SPXW"]; // unambiguous — no split possible
  return ["SPX", "SPXW"]; // try the calendar's stored root first, then the sibling
}
```
Consuming sites then either (a) build BOTH candidate OCC symbols and add both to a mustInclude
allowlist (costless over-inclusion — `getOpenCalendarLegs`), or (b) query `contracts`/leg
observations for each candidate root in order and take the first hit (`resolveLegSnapshot`,
`getLiveGreeks`). Neither requires date-of-week math or a 3rd-Friday classifier.

### Pattern 2: As-of-slot leg resolution (HIST-02) — mirrors `readSmile`

**What:** Resolve a leg's nearest observation at-or-before a specific historical instant, not
just "the latest ever" (which `ForResolvingLegSnapshot` already does).
**When to use:** The new rebuild use-case, once per (leg, slot).
**Example:**
```typescript
// Source: packages/adapters/src/postgres/repos/leg-observations.ts:325-382 (readSmile),
// the closest existing precedent for "resolve as of a historical anchor time"
const rows = await db
  .select({ /* ... */ })
  .from(legObservations)
  .innerJoin(contracts, eq(legObservations.contract, contracts.occSymbol))
  .where(and(
    inArray(contracts.root, rootCandidates),       // Pattern 1's candidates
    eq(contracts.strike, query.strike),
    eq(contracts.expiration, query.expiry),
    eq(contracts.contractType, query.optionType),
    lte(legObservations.time, slotAnchor),          // "at or before" the slot
    // usability bound: reuse SNAPSHOT_LEG_STALENESS_TOLERANCE_MS or a slot-window bound
  ))
  .orderBy(desc(legObservations.time))
  .limit(1);
```

### Pattern 3: Fill-only conditional write (HIST-02/03) — reuse `isGapRow`, don't reinvent "gap"

**What:** A write that inserts when no row exists, replaces only when the existing row is a gap,
and no-ops when the existing row is already live data.
**When to use:** Every place a healed row is persisted (rebuild use-case, self-heal job).
**Example:**
```typescript
// Source: packages/core/src/journal/domain/attribution.ts:78-83 — the LOCKED, reusable
// definition of "gap" (docstring: "do NOT relitigate"). SnapshotRow is structurally a
// superset of AttributionRow's fields, so it can be passed to isGapRow directly.
export function isGapRow(row: AttributionRow): boolean {
  if (row.spot === "0") return true;
  return [row.frontIv, row.backIv, row.netDelta, row.netGamma, row.netTheta, row.netVega].some(
    (value) => !Number.isFinite(parseFloat(value)),
  );
}
```
The new heal-write port's adapter can either (a) translate this exact condition into a single
SQL `UPDATE ... WHERE (calendar_id, time) = (?, ?) AND (front_iv = 'NaN' OR back_iv = 'NaN' OR
spot = '0' OR ...)` for one atomic round-trip, or (b) do a SELECT-then-decide in the adapter
function body calling `isGapRow` directly (simpler to keep in sync with the one JS source of
truth, at the cost of two round-trips). Recommend (b) for a first cut — reuse, don't duplicate,
the predicate; optimize to (a) only if the two-roundtrip cost is measured to matter (ponytail:
correctness/reuse over premature optimization here).

### Pattern 4: Slot-boundary rounding (HIST-05) — reuse the existing composite PK, no new dedup

**What:** Round a `scheduled`-trigger snapshot's `time` down to its nominal 30-min RTH slot
boundary BEFORE persisting, instead of stamping the exact wall-clock instant the job happened to
finish at.
**When to use:** `snapshotCalendars.ts`'s `now` value, for `trigger: 'scheduled'` rows only —
`event-move` rows must keep their real timestamp (D-07: "event-move rows stay distinct via
trigger").
**Why this fixes HIST-05 with zero new dedup code:** `calendar_snapshots`'s PK is
`(time, calendar_id)` with `persistSnapshot` already `onConflictDoNothing`
(`packages/adapters/src/postgres/schema.ts:78-113`, `calendar-snapshots.ts:58-94`). Two
compute-bsm-greeks→snapshot-calendars chains firing 10-15 minutes apart near the top of an hour
(one from the 30-min `fetch-schwab-chain` chain-trigger, one from the independent hourly
`0 * * * *` fallback cron — both defined in `apps/worker/src/schedule.ts:133-166`) currently
insert TWO rows because their exact wall-clock `time` values differ. Rounding both down to the
same nominal slot boundary (e.g. `10:00:00Z`) makes the SECOND write's `(time, calendar_id)`
collide with the first's, and the existing `onConflictDoNothing` silently absorbs it — no new
uniqueness logic, no cron schedule change, no risk to the hourly fallback's OWN resilience
purpose (OPS-02's docstring: it exists so a missed chain-trigger still drains eventually).
No existing 30-min slot-rounding utility exists yet (verified — `isWithinRth`,
`packages/shared/src/rth-window.ts`, only checks membership, doesn't round); a new small pure
function following `isWithinRth`'s `Intl.DateTimeFormat`-based, no-Date.now(), caller-passes-`now`
idiom is the right home for it.

### Anti-Patterns to Avoid

- **Inventing a 3rd-Friday/EOM date classifier for the READ side.** Only `getOpenCalendarLegs`
  structurally needs it (no `contracts` row may exist yet for a brand-new leg). Everywhere else,
  a root-agnostic/try-both lookup against already-correct stored data is simpler and has no
  calendar-edge-case risk (holidays, EOQ specials).
- **Reusing `readJournal`/`mapSnapshotRow` in the rebuild path.** Its own sibling port's
  docstring already warns against this (`ports.ts:279-281`, `ForReadingLatestSnapshotPerOpenCalendar`):
  it silently drops `schwab_chain`-sourced rows. The rebuild path (and the acceptance-criteria
  verification of it) must use a source-inclusive read, or fix `mapSnapshotRow` itself.
  See Common Pitfalls #1 — this is the single highest-severity finding in this research.
  Using `ForPersistingSnapshot`/`onConflictDoNothing` for the heal write. It cannot update an
  existing gap row — D-03 is structurally impossible with that port. A new port is required, not
  a new caller of the old one.
- **Removing the hourly `compute-bsm-greeks` fallback cron to fix HIST-05.** It exists for a
  real resilience reason (OPS-02: a missed/failed chain-trigger still drains eventually). Fix
  the write-side key (slot rounding), not the resilience mechanism.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Is this snapshot row a gap?" | A second hand-written NaN/zero check (in SQL or a new TS predicate) | `isGapRow` from `packages/core/src/journal/domain/attribution.ts:78-83` | Already the LOCKED, tested, docstring-pinned definition ("do NOT relitigate") consumed by `getCalendarLifecycle`'s attribution series; a second definition is a guaranteed future drift bug |
| "Which root does this leg's contract really use?" | A 3rd-Friday/EOM date classifier duplicated at 4 call sites | ONE shared `resolveRootCandidates` pure function (Pattern 1), OR a root-agnostic `contracts` lookup where a `contracts` row already exists | The classifier is fragile (holiday shifts, EOQ specials) and only truly needed at ONE call site (`getOpenCalendarLegs`, before any contract row exists) |
| "Resolve a leg's observation as of a historical time" | A brand-new query pattern from scratch | Mirror `readSmile` (`leg-observations.ts:325-382`) — same "latest at-or-before anchor, joined through `contracts`" shape | Already a proven, tested precedent for exactly this access pattern |
| "Chunk a wide date range into bounded windows" (if HIST-04's CLI needs range chunking) | New chunking logic | `chunkDateRange` (`@morai/core`, used by `backfill-transactions.ts`) — reusable IF the CLI's own repair range needs windowing; likely NOT needed here since the rebuild iterates 30-min slots directly rather than paginating a vendor API | Existing, tested, `docs/architecture/jobs.md`-documented pure function |
| "Repair CLI composition root" | A new bespoke CLI framework/pattern | `import.meta.main`-guarded thin composition root, mirroring `fix-pnl-reingest.ts` (full file read this session) and `backfill-transactions.ts` | This is the THIRD such script if built from scratch; the existing two are directly copy-adaptable and already TDD-exempt per `tdd.md`'s "pure wiring in composition roots" exemption |
| "On-demand operator trigger for the self-heal job" | A new bespoke trigger mechanism | `TRIGGERABLE_JOBS` + `triggerJobBodyFor` (`packages/contracts/src/jobs.ts`) — the existing `POST /api/jobs/:name/trigger` route + `trigger_job` MCP tool, already Zod-validated (T-05-22, V5 Input Validation) | One array entry + one payload-shape branch extends an already-hardened, already-tested generic mechanism |

**Key insight:** every piece of this phase's machinery already has a same-shape precedent
somewhere in this codebase. The research above found zero cases where genuinely new
architecture is needed — only new *instances* of existing patterns (one more port pair, one more
job, one more CLI, one more pure predicate reuse).

## Runtime State Inventory

> This phase is a data-repair phase, not a rename/rebrand — included in abbreviated form since
> there genuinely is production runtime state this phase touches.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `calendar_snapshots` — 17 calendars' worth of rows (15 closed, 2 open), many gap/duplicate per CONTEXT.md's live evidence. `leg_observations` — untouched, read-only source archive since 2026-06-12 | Data migration via the new heal-write port (fill-only, never destructive to non-gap rows); the CLI (HIST-04) is the one-time repair mechanism, with before/after counts printed per D-10 |
| Live service config | None — no n8n/external service config involved | None |
| OS-registered state | pg-boss `pgboss.schedule` table gains one new row if HIST-03 uses a cron (vs pure chain-trigger); idempotent on every worker boot per existing `registerAllJobs` convention | None beyond the code change — `registerAllJobs` already handles idempotent re-registration |
| Secrets/env vars | None — no new env vars needed (reuses `DATABASE_URL`, existing worker config) | None |
| Build artifacts | None — no renamed packages, no stale egg-info-style artifacts | None — verified by grep, nothing found |

## Common Pitfalls

### Pitfall 1: `mapSnapshotRow` silently drops non-'cboe' rows (HIGH severity — threatens the phase's own acceptance criteria)

**What goes wrong:** `readJournal` (the port `getCalendarLifecycle`/`getJournal` use — i.e. the
EXACT read path the LifecycleChart UI consumes) calls `mapSnapshotRow`
(`packages/adapters/src/postgres/repos/calendar-snapshots.ts:468-501`), which does
`if (row.source !== "cboe") return null;` — silently omitting the row entirely from the series.
**Why it happens:** `computeLegPairMetrics`'s source resolution
(`snapshotCalendars.ts:188-191`) picks `front?.source ?? back?.source ?? "cboe"`, mapped to
`"schwab_chain" | "cboe"`. If EITHER leg's historical `leg_observations` row (used by the
rebuild) happens to be `schwab_chain`-sourced, the healed row's `source` could resolve to
`schwab_chain` — and then vanish from the UI the phase exists to fix, even though the row was
successfully written to `calendar_snapshots`.
**How to avoid:** Either (a) make the healed rows always resolve to `source='cboe'` by
construction if that's operationally true for the historical archive (CONTEXT.md's own
code-context notes: "All existing rows are source='cboe'; schwab_chain never appears in
snapshots to date" — worth re-verifying against `leg_observations` specifically, since THAT
table may have schwab_chain rows even if `calendar_snapshots` historically hasn't), or (b) apply
the SAME inclusive-mapping fix `ForReadingLatestSnapshotPerOpenCalendar` and
`ForReadingFullSnapshotHistoryForCalendar` already use (a fresh query that never drops by
source) to `readJournal`/`mapSnapshotRow` itself. Given D-01's acceptance test is explicitly "the
LifecycleChart shows non-gap rows," option (b) is the safer, root-cause-correct fix and should be
in scope even though `readJournal` predates this phase.
**Warning signs:** A rebuild/repair run reports rows written and non-gap, but the Journal UI (or
`getCalendarLifecycle` in a manual API call) still shows gaps for the same slots.

### Pitfall 2: `ForPersistingSnapshot` cannot satisfy D-03 (structural, not a workaround-able gotcha)

**What goes wrong:** The existing write port is `.onConflictDoNothing()` on the composite PK
(`calendar-snapshots.ts:58-94`) — a genuine INSERT-ONLY semantic. Calling it a second time for
an existing `(calendar_id, time)` key, even with better data, is silently absorbed as a no-op.
**Why it happens:** It was built for the live writer, which only ever writes the CURRENT instant
once.
**How to avoid:** Do not attempt to satisfy D-03 by calling `persistSnapshot` again with healed
data. Build a genuinely new port (Pattern 3) with conditional UPDATE-or-INSERT semantics.
**Warning signs:** A rebuild/self-heal run reports "N rows processed" but `calendar_snapshots`'s
actual gap-row count doesn't decrease.

### Pitfall 3: HIST-05's duplicate rows are a scheduling collision, not a snapshot-calendars logic bug

**What goes wrong:** Looking for the duplicate-row cause INSIDE `snapshotCalendars.ts`'s own
logic (e.g., suspecting a double-call or a retry) will not find it — the use-case itself is
called once per job invocation and is otherwise correct.
**Why it happens:** Two INDEPENDENT pg-boss schedules both terminate at `snapshot-calendars`:
the 30-min `fetch-schwab-chain` chain-trigger chain, and the hourly `0 * * * *`
`compute-bsm-greeks` fallback cron (`apps/worker/src/schedule.ts:133-166`), which near the top
of each hour fire close together but not simultaneously (10-15 min processing-time gap matches
CONTEXT.md's observed pattern exactly).
**How to avoid:** Fix the write-side key (Pattern 4 — round `scheduled` timestamps to the slot
boundary), not the scheduling. Do not attempt to deduplicate by adding a NEW distinct-lock/mutex
mechanism — the existing composite PK already does this once the key is correct.
**Warning signs:** Duplicate rows have DIFFERENT `time` values (10-15 min apart) but IDENTICAL
`spot`/`net_mark`/`front_mark` — a same-cycle re-read of already-fresh (frozen) leg data, not
two genuinely different market observations.

### Pitfall 4: `getLiveGreeks`'s NaN output is not diagnostic evidence of WHICH failure mode

**What goes wrong:** Treating CONTEXT.md's `get_live_greeks` diagnosis ("back leg all-NaN") as
proof of a specific mechanism (e.g., BSM starvation) risks fixing the wrong layer.
**Why it happens:** `getLiveGreeks.ts` (lines 90-99, 103) NaN-stamps for THREE distinct
underlying causes indistinguishably: no observation row at all, a DB-NULL `bsm_iv` (never
processed), and a `bsm_iv='NaN'` (inversion genuinely failed).
**How to avoid:** Run the Diagnostic SQL (above) against `leg_observations`/`contracts`
directly — never trust `get_live_greeks`'s NaN alone to diagnose root cause.
**Warning signs:** A fix that only touches `computeBsmGreeks.ts`/`invertIv` without touching the
root-matching call sites will not change the symptom, since (per this research) the leg is most
likely never being FOUND at all, not failing to solve.

## Code Examples

Verified patterns from this codebase (all file paths confirmed to exist this session):

### As-of-time resolution precedent (for HIST-02's new port)
```typescript
// Source: packages/adapters/src/postgres/repos/leg-observations.ts:325-382 (readSmile)
// The closest existing precedent for "resolve leg_observations data as of a historical anchor"
const latest = await db
  .select({ time: legObservations.time })
  .from(legObservations)
  .where(and(
    lte(legObservations.time, snapshotTime),
    isNotNull(legObservations.bsmIv),
    ne(legObservations.bsmIv, sql`'NaN'::numeric`),
  ))
  .orderBy(desc(legObservations.time))
  .limit(1);
```

### Contracts-join resolution precedent (for HIST-01's fix + HIST-02's port)
```typescript
// Source: packages/adapters/src/postgres/repos/calendar-snapshots.ts:152-163 (resolveLegSnapshot)
// Current (buggy) form — root comes straight from query.underlying, which is always
// calendar.underlying for BOTH legs:
const contractRows = await db
  .select({ occSymbol: contracts.occSymbol })
  .from(contracts)
  .where(and(
    eq(contracts.root, query.underlying),   // <-- BUG: should try both SPX/SPXW candidates
    eq(contracts.strike, query.strike),
    eq(contracts.expiration, query.expiry),
    eq(contracts.contractType, query.optionType),
  ))
  .limit(1);
```

### D-03 gap predicate to reuse (never redefine)
```typescript
// Source: packages/core/src/journal/domain/attribution.ts:78-83
export function isGapRow(row: AttributionRow): boolean {
  if (row.spot === "0") return true;
  return [row.frontIv, row.backIv, row.netDelta, row.netGamma, row.netTheta, row.netVega].some(
    (value) => !Number.isFinite(parseFloat(value)),
  );
}
// AttributionRow is a structural subset of SnapshotRow (time, spot, frontIv, backIv, netDelta,
// netGamma, netTheta, netVega, pnlOpen) — any SnapshotRow can be passed directly, no mapping needed.
```

### Pure formula reuse (D-02 — already exported, ready to call)
```typescript
// Source: packages/core/src/journal/application/snapshotCalendars.ts:144-212, 112-118
// computeLegPairMetrics(now, front, back, qty, frontExpiry, backExpiry) — pure, no I/O
// computeSnapshotPnl(netMark, openNetDebit, qty) — pure, no I/O
// Both ALREADY exported specifically for reuse (PICK-04 precedent, JRNL-01 precedent) —
// the rebuild use-case calls these exact functions per resolved slot, D-02 satisfied by construction.
```

### On-demand trigger contract pattern (for HIST-03/04's optional operator-trigger surface)
```typescript
// Source: packages/contracts/src/jobs.ts (full file read this session)
export const TRIGGERABLE_JOBS = [
  "rebuild-journal", "sync-fills", "compute-bsm-greeks", "recompute-snapshot-pnl",
  "wipe-derived-fills", "register-open-calendars", "fetch-schwab-chain",
] as const;
// Adding a new job name here + a triggerJobBodyFor branch (if calendarId should be required)
// is the ENTIRE extension needed — POST /api/jobs/:name/trigger and the trigger_job MCP tool
// both already share this schema (MCP-02 single-schema-source convention).
```

### CLI composition-root precedent (for HIST-04)
```typescript
// Source: apps/worker/src/fix-pnl-reingest.ts (full file read this session) and
// apps/worker/src/backfill-transactions.ts — both follow:
//   1. A PURE orchestrator function (testable offline with faked deps + in-memory twins)
//   2. `if (import.meta.main) { ... }` guarded composition root at the bottom of the SAME file
//      (thin wiring, TDD-exempt per tdd.md "pure wiring in composition roots" scope exemption)
//   3. console.warn/console.error progress + a final BEFORE/AFTER summary table
//   4. Every step checks its Result and process.exit(1) on failure, with a clear message about
//      what state was left behind and whether re-running is safe (idempotency called out explicitly)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `snapshot-calendars` writes a spot=0/NaN gap row for any missing/stale leg every cycle | OPS-01 freshness gate skips the whole cycle instead (no row) | Phase 25, deployed ~2026-07-08/09 (v1.3) | Directly explains the historical 49-gap-rows→total-silence transition this phase investigates; this phase's self-heal (HIST-03) is the intended "complement" to OPS-01 the CONTEXT.md's D-05 names |
| "Historical gap rows are never backfilled" (documented policy, `docs/architecture/jobs.md`'s `snapshot-calendars` row and `snapshotCalendars.ts`'s own docstring) | This phase reverses that policy for OPEN calendars (bounded self-heal) and ALL calendars (unbounded CLI) | This phase (40) | `docs/architecture/jobs.md` MUST be updated (CLAUDE.md docs-before-code rule) — the Job Catalog row's language is about to become false |

**Deprecated/outdated:** the `snapshot-calendars` row's phrase "self-healing on the next fresh
cycle" in `docs/architecture/jobs.md:25` referred ONLY to a future live cycle picking up fresh
data going forward — it explicitly did NOT mean historical backfill. This phase adds genuine
historical backfill for the first time; the doc's wording should be updated to distinguish
"live self-heal" (existing, forward-only) from "historical repair" (new, this phase).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The back leg's real, exchange-listed OCC root is SPXW (not SPX) for `2026-11-30` — based on Cboe's published product spec (3rd-Friday = SPX, everything else including EOM = SPXW) plus computed day-of-week math, but NOT empirically confirmed against the live Cboe delayed-quotes JSON this session (the fetch attempt exceeded a 10MB size cap) | Root Cause Chain | If wrong, HIST-01's root-resolution fix direction is still safe (a root-agnostic/try-both lookup doesn't depend on this claim being exactly right for every edge case), but the specific timeline/diagnosis narrative would need revision. The Diagnostic SQL (query 1-2) is specified precisely so the EXECUTOR confirms this against live prod data before writing the fix — do not skip that step |
| A2 | HIST-05's duplicate-row mechanism is the `compute-bsm-greeks` hourly-fallback-cron vs 30-min `fetch-schwab-chain` chain-trigger collision, inferred from `schedule.ts`'s cron definitions and CONTEXT.md's observed ~10-15 min gap between duplicate pairs — not confirmed against actual `pgboss.job` run-history timestamps in prod | HIST-05 / Pitfall 3 | If wrong, the slot-rounding fix (Pattern 4) is still directionally correct and harmless (it can only reduce duplicates), but the planner should have the executor spot-check a few real duplicate-pair timestamps against actual cron-fire times before treating this as fully confirmed |
| A3 | `calendar_snapshots` historically has zero `schwab_chain`-sourced rows (per CONTEXT.md's own code-context note), so Pitfall 1 (`mapSnapshotRow` dropping non-cboe rows) has not yet bitten in practice but COULD once the rebuild reads from `leg_observations`, which may include `schwab_chain`-sourced observations even where no `calendar_snapshots` row has ever been schwab_chain-sourced | Pitfall 1 | If `leg_observations` for these specific calendars turns out to be entirely `cboe`-sourced too, Pitfall 1 is a non-issue for THIS repair run — but it remains a latent bug the phase should still fix given D-01's acceptance criteria is UI-visible non-gap rows |

**If this table is empty:** N/A — see rows above. All three should be spot-checked against live
data during planning/execution, not treated as settled.

## Open Questions (RESOLVED)

> Resolution notes (plan-checker pass, 2026-07-14): Q1 resolved in 40-06-PLAN — separate
> `self-heal-journal` job on a sparse hourly cron, no RTH gate, bounded 7-day lookback
> (rationale recorded in the plan). Q2 resolved in 40-05-PLAN — ONE shared
> `rebuildCalendarHistory` use-case parametrized by date range, reused by the self-heal job
> (40-06), the repair job/CLI (40-07), and the on-register backfill (40-07). Q3 is
> unresolvable without live DB access and is handled by design: 40-08 Task 2 runs the
> diagnostic SQL as an explicit pre-repair checkpoint, and the try-both-roots fix (40-02) is
> correct under BOTH outcomes (data present → healed; absent → captured from the next chain
> cycle, honest gap until then). Live confirmation is deliberately deferred to the 40-08
> gate — the fix direction is invariant to the diagnostic result (Assumption A1).

1. **Should the self-heal job (HIST-03) be its own pg-boss queue, or logic added inside the
   existing `snapshot-calendars` handler?**
   - What we know: `snapshot-calendars` is RTH-gated for its live write; self-heal should
     probably run on ANY schedule (healing past slots isn't time-of-day sensitive the same way).
     The codebase's own convention (rebuild-journal, recompute-snapshot-pnl, wipe-derived-fills)
     is dedicated small jobs for narrow repair concerns, even where they COULD have been folded
     into a bigger existing job.
   - What's unclear: whether chain-triggering it after `compute-analytics` (matching the
     existing chain-trigger convention) or a bounded low-frequency cron (e.g. hourly, mirroring
     `compute-bsm-greeks`'s fallback) is preferred.
   - Recommendation: separate job, matching the strong existing-code precedent for dedicated
     repair jobs; CONTEXT.md explicitly delegates "job wiring (chained vs cron)" to Claude's
     discretion — the planner should pick one and state the rationale, not present both to the
     user.

2. **Should HIST-04's operator CLI and HIST-03's self-heal job share ONE underlying
   `rebuildCalendarHistory` use-case (parametrized by lookback window: bounded 7-day vs
   unbounded), or should they be separate implementations?**
   - What we know: D-05 explicitly frames the CLI as "unbounded one-time repair" alongside a
     "bounded lookback (default 7 days)" self-heal — same shape, different bound.
   - What's unclear: nothing structural — this is a strong "share one use-case" case.
   - Recommendation: ONE pure use-case taking a date-range parameter, called by three adapters
     (CLI, self-heal job, registerOpenCalendars' on-register hook) — see Architecture Patterns
     diagram. Do not build three implementations.

3. **Does `leg_observations` for the two open calendars' back legs actually have healthy
   `SPXW`-rooted data waiting to be found (Diagnostic SQL query 2), or does the DTE-filter
   compounding bug mean the real quote was never even persisted?**
   - What we know: the D-04 mustInclude bypass is broken by the SAME root bug, so it's possible
     NOTHING was ever captured for the back leg beyond whatever occasionally falls inside the
     90-day/10%-band window naturally (unlikely for a leg this far out-of-band on strike or DTE).
   - What's unclear: without live DB access this session, unconfirmed either way.
   - Recommendation: the diagnostic SQL MUST run before the planner locks HIST-01's fix scope —
     if query 1/2 come back empty even after considering both roots, the fix needs to ALSO
     ensure the D-04 bypass starts working (which the recommended fix does, by construction,
     once `getOpenCalendarLegs` builds both root candidates) and then wait for the NEXT chain
     fetch cycle to actually capture the leg before any historical rebuild has data to work with
     for that specific slot — this is an "honest gap" (D-04) outcome, not a bug in the rebuild
     logic itself.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | All new code (worker CLI, use-cases, tests) | ✓ | 1.3.13 | — |
| Docker (for Postgres testcontainers) | New contract tests (HIST-02's new ports) | ✓ | running | — |
| fast-check | Property tests for new pure functions (root resolution, slot rounding) | ✓ | ^4.8.0 (root `package.json`) | — |
| Vitest | All tests | ✓ | configured at root `vitest.config.ts` | — |
| Postgres (DATABASE_URL) | Live diagnostic SQL, prod repair run | Not verified this session (no live DB access from research) | — | Executor/orchestrator runs diagnostic SQL + repair against the real DATABASE_URL at execution time, per D-10 "operator/orchestrator-executed after deploy" |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** live Postgres access for the diagnostic SQL — the
research phase could not execute it directly (no DB/MCP tool available to this research agent);
the planner must schedule it as an explicit early task/checkpoint for the executor, who does
have DB access.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (root `vitest.config.ts`) + fast-check `^4.8.0` + testcontainers (Postgres) |
| Config file | `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/vitest.config.ts` |
| Quick run command | `bun run test -- <path/to/file.test.ts>` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HIST-01 | `resolveRootCandidates` returns correct candidates for SPX/SPXW underlying | unit + fast-check | `bun run test -- packages/core/src/journal/domain/occ-root.test.ts` | ❌ Wave 0 |
| HIST-01 | `resolveLegSnapshot` finds the back leg's data under the correct (SPXW) root when `calendar.underlying='SPX'` | contract (postgres + memory) | `bun run test -- packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` | extend existing file |
| HIST-01 | Regression: the exact Nov-20/Nov-30 mixed-root calendar no longer produces a null back leg | unit | `bun run test -- packages/core/src/journal/application/snapshotCalendars.test.ts` | extend existing file |
| HIST-02 | Rebuild use-case derives byte-identical rows to what the live writer would have produced, for a fixture slot | unit + fast-check | `bun run test -- packages/core/src/journal/application/rebuildCalendarHistory.test.ts` | ❌ Wave 0 |
| HIST-02 | New as-of-slot read port: contract test (hit / miss / stale-outside-window) | contract (postgres + memory) | `bun run test -- packages/adapters/src/postgres/repos/leg-observations.contract.test.ts` | extend existing contract suite |
| HIST-02 | New heal-write port: insert-when-absent / update-when-gap / no-op-when-live (D-03) | contract (postgres + memory) | `bun run test -- packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` | extend existing file |
| HIST-03 | Self-heal use-case only touches OPEN calendars, only within the bounded lookback, never overwrites live rows | unit | `bun run test -- packages/core/src/journal/application/selfHealJournal.test.ts` | ❌ Wave 0 |
| HIST-03 | Handler: array-guard, RTH-gate-or-not decision, chain-trigger (if any) | unit | `bun run test -- apps/worker/src/handlers/self-heal-journal.test.ts` | ❌ Wave 0 |
| HIST-04 | CLI orchestrator: one-calendar mode, all-calendars mode, idempotent re-run, before/after counts printed | unit (offline, faked deps) | `bun run test -- apps/worker/src/repair-journal-history.test.ts` | ❌ Wave 0 |
| HIST-04 | On-register backfill: a newly-registered calendar gets `[openedAt, now]` rows | unit | `bun run test -- packages/core/src/journal/application/registerOpenCalendars.test.ts` | extend existing file |
| HIST-05 | Slot-boundary rounding: idempotent, always rounds down to a valid RTH 30-min slot, `event-move` trigger bypasses it | unit + fast-check | `bun run test -- packages/core/src/journal/domain/<slot-rounding-file>.test.ts` | ❌ Wave 0 |
| HIST-05 | Regression: two chain-triggered snapshot-calendars runs 10-15 min apart within the same nominal slot produce ONE row | unit | `bun run test -- packages/core/src/journal/application/snapshotCalendars.test.ts` | extend existing file |
| D-09 (regression gate) | Backtest + exit suites stay green after repair changes journal inputs | integration | `bun run test -- packages/core/src/backtest packages/core/src/exits` | existing suites — run, don't modify assertions unless a genuine behavior change is intended |

### Sampling Rate

- **Per task commit:** targeted `bun run test -- <changed file(s)>`
- **Per wave merge:** `bun run test` (full suite) + `bun run typecheck` + `bun run lint`
- **Phase gate:** full suite green, PLUS the live diagnostic SQL run against prod (or a
  production-shaped fixture) confirming the root-cause hypothesis before the repair CLI is run
  against real prod data, PLUS the D-09-mandated backtest/exit suite green-check with a SUMMARY
  note about any verdict shifts.

### Wave 0 Gaps

- [ ] `packages/core/src/journal/domain/occ-root.test.ts` — covers HIST-01's root-candidate logic
- [ ] `packages/core/src/journal/application/rebuildCalendarHistory.test.ts` — covers HIST-02
- [ ] `packages/core/src/journal/application/selfHealJournal.test.ts` — covers HIST-03
- [ ] `apps/worker/src/handlers/self-heal-journal.test.ts` — covers HIST-03's handler
- [ ] `apps/worker/src/repair-journal-history.test.ts` — covers HIST-04's CLI
- [ ] A new slot-boundary-rounding pure function + its test file — covers HIST-05
- [ ] Framework install: none — Vitest/fast-check/testcontainers all already present

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | This phase adds no new user-facing auth surface; the optional `TRIGGERABLE_JOBS` extension reuses the EXISTING Supabase-JWT-gated `/api/jobs/:name/trigger` route (unchanged by this phase) |
| V3 Session Management | No | Same as above |
| V4 Access Control | No (reuses existing) | If the planner adds the new job to `TRIGGERABLE_JOBS`, it inherits the SAME operator-only access control every existing triggerable job already has — no new gate needed |
| V5 Input Validation | Yes | `z.enum(TRIGGERABLE_JOBS)` already rejects arbitrary job names (T-05-22 precedent); the CLI's own argv parsing (calendar id / "all") should Zod-parse per typescript.md; the new ports' query inputs (strike, expiry, optionType) reuse the SAME shapes `ForResolvingLegSnapshot` already validates |
| V6 Cryptography | No | No secrets, tokens, or crypto touched by this phase — Data Discipline (`workflow.md`) already forbids Schwab credentials in code/logs/fixtures, unaffected here |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via a hand-built root/symbol string reaching a raw query | Tampering | Already mitigated codebase-wide by Drizzle parameterized queries (T-02-09 convention) — the new queries in Pattern 2/3 must follow the same `db.select()...where(and(eq(...)))` idiom, never raw template interpolation |
| A destructive CLI flag (e.g., "repair ALL calendars") run against prod without confirmation | Repudiation / accidental data loss | Mirror `fix-pnl-reingest.ts`'s convention: print a clear before-state, require the operator to explicitly invoke the "all calendars" mode (no silent default-to-all), print a before/after summary, and make every step idempotent so a partial failure is safely re-runnable (D-10's own explicit requirement) |
| The new heal-write port accidentally overwriting a genuinely live (non-gap) row due to an `isGapRow` mismatch or a race between the live writer and self-heal | Tampering (data integrity) | D-03's "live rows always win" must be enforced by the SAME `isGapRow` predicate used everywhere else (Pattern 3) — never a second, potentially looser, definition; the self-heal job's bounded lookback (7 days) and OPEN-only scope also bounds the blast radius of any bug here |

## Sources

### Primary (HIGH confidence — codebase, verified via Read/Bash this session)
- `packages/core/src/journal/application/snapshotCalendars.ts` — live writer, OPS-01 gate, `computeLegPairMetrics`/`computeSnapshotPnl` exports
- `packages/core/src/journal/application/ports.ts` — all port type definitions, including the `ForReadingLatestSnapshotPerOpenCalendar` docstring's own prior warning about `mapSnapshotRow`'s drop bug
- `packages/core/src/journal/application/registerOpenCalendars.ts` — the KNOWN LIMITATION docstring (root cause smoking gun)
- `packages/core/src/journal/domain/position-pairing.ts` — mixed-root-is-real-and-expected docstring
- `packages/core/src/journal/domain/attribution.ts` — `isGapRow`, the locked gap definition
- `packages/core/src/journal/application/getLiveGreeks.ts` — the buggy root-construction site #4, and the NaN-ambiguity finding
- `packages/core/src/journal/application/fetchChain.ts` — D-04 mustInclude mechanism, DTE/band filter
- `packages/core/src/journal/domain/iv-inversion.ts`, `computeBsmGreeks.ts` — confirms the BSM/inversion layer is NOT the bug (ruled out)
- `packages/adapters/src/postgres/repos/calendars.ts`, `packages/adapters/src/memory/calendars.ts` — `getOpenCalendarLegs`, bug sites #1/#2
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` — `resolveLegSnapshot` (bug site #3), `persistSnapshot` (insert-only finding), `mapSnapshotRow` (Pitfall 1), `readLatestSnapshotPerOpenCalendar`/`readFullSnapshotHistoryForCalendar` (source-inclusive precedent)
- `packages/adapters/src/postgres/repos/leg-observations.ts` — `readSmile` (as-of-time precedent), full export list
- `packages/adapters/src/http/cboe.ts` — confirms vendor OSI parsing is correct (not the bug); root-prefix filter logic
- `packages/adapters/src/postgres/schema.ts` — `calendars`, `calendarSnapshots`, `legObservations`, `contracts` table definitions
- `packages/shared/src/rth-window.ts`, `occ-symbol.ts` — `isWithinRth` pattern precedent, OCC root-padding convention
- `apps/worker/src/config.ts` — `BSM_MAX_DTE=90` confirmed default
- `apps/worker/src/schedule.ts` — full cron/chain-trigger registry (HIST-05 root cause)
- `apps/worker/src/handlers/snapshot-calendars.ts`, `compute-bsm-greeks.ts`, `fetch-schwab-chain.ts`, `fetch-cboe-chain.ts`, `register-open-calendars.ts` — chain-trigger wiring, thin-handler convention
- `apps/worker/src/fix-pnl-reingest.ts`, `backfill-transactions.ts` — CLI precedent (full files read)
- `packages/contracts/src/jobs.ts` — `TRIGGERABLE_JOBS`/`triggerJobBodyFor` (full file read)
- `docs/architecture/jobs.md` — Job Catalog, existing backfill-policy language needing update
- `packages/core/src/backtest/application/replayExitsForCalendar.ts` — consumer, source-inclusive precedent
- `packages/adapters/src/__contract__/calendar-snapshots.contract.ts` — contract-test pattern precedent
- `.claude/rules/{architecture-boundaries,tdd,typescript,workflow,docs}.md`, `CLAUDE.md` — project constraints
- `date -j` (macOS) — computed Nov 2026 day-of-week facts directly, not from training data

### Secondary (MEDIUM confidence)
- Cboe official product specification pages (WebSearch, cross-referencing multiple Cboe.com
  results): "SPXW is the ticker symbol for SPX Weeklys and SPX End-of-Month options"; "SPX EOM
  options feature expiration dates that fall on the last business day of the month, as opposed
  to the standard third Friday of the month expirations" — [cboe.com/tradable-products/sp-500/spx-options/end-of-month-options](https://www.cboe.com/tradable-products/sp-500/spx-options/end-of-month-options), [cboe.com/tradable_products/sp_500/spx_end_of_month_options/specifications](https://www.cboe.com/tradable_products/sp_500/spx_end_of_month_options/specifications)

### Tertiary (LOW confidence)
- None used for load-bearing claims. The one attempted direct-fetch verification (live Cboe
  `_SPX.json` delayed-quotes JSON, to empirically confirm the exact `261130P07600000` row and
  its root prefix) failed due to a 10MB response-size cap — flagged as Assumption A1, not
  presented as verified.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, pure reuse of existing, already-audited stack
- Architecture (root cause + fix direction): HIGH — multi-source triangulated (codebase's own
  docstrings + Cboe's official spec + computed date math + the code's own bug-site trace), but
  the LIVE-DATA confirmation (Diagnostic SQL) is explicitly unverified this session (no DB
  access) — flagged as the mandatory first executor step, not skippable
- Pitfalls: HIGH — Pitfall 1 and 2 are structural findings verified directly by reading the
  exact port implementations, not inferred

**Research date:** 2026-07-14
**Valid until:** Stable domain (internal data-layer bug, not a fast-moving external API) — no
expiry concern beyond the live-data confirmation step, which is time-sensitive only in the sense
that prod data keeps accumulating; re-run the diagnostic SQL if execution is delayed more than a
few days from this research.
