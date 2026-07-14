# Phase 40: Journal History Repair - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Mode:** Autonomous (user delegated all decisions: "knock it out yourself, you know best about the platform")

<domain>
## Phase Boundary

The journal's per-calendar 30-min series (greeks, front/back IV, term slope, marks, spot,
P&L) is the product's core value — PROJECT.md: "for any calendar, answer how did price and
greeks move over the life of this trade". The user's words (2026-07-14): "what I care about
is to keep the GREEK + Vol and all charts history in the journal so I can see why my
calendar acted the way it did. Right now it gets lost."

Live prod evidence (verified 2026-07-14 via MCP + get_live_greeks):

- Both OPEN calendars (SPX 7600P / 7200P, front 2026-11-20, back 2026-11-30, opened
  06-24): 49 snapshot rows each, **100% isGap** (NaN greeks/IVs), rows exist only
  07-06→07-08, **zero rows since Jul 8 19:46Z** (Jul 9, 10, 13 silent). 10 of 13 eligible
  trading days have zero rows.
- Root of the 100%-gap: back leg `SPX 261130P07600000` returns ALL-NaN bsm fields from
  `get_live_greeks` while front leg `SPX 261120P07600000` is healthy
  (bsmIv 0.152, delta −0.489). One NaN leg → whole row isGap → every chart panel blank.
- The zero-rows-since-Jul-8: OPS-01 freshness gate (Phase 25) skips the calendar's cycle
  when either leg is stale/missing — correct live behavior, but the skipped slot is never
  backfilled ("historical rows are never backfilled", snapshotCalendars.ts), so a
  perpetually-stale back leg = permanent silence.
- No calendar has ANY row before 2026-07-06 (July-1 chain-source freeze + late
  registration) — entry-day context is lost for every existing calendar.
- Closed 7350P (07-02→07-06) kept writing rows through 07-10 (status stayed open until
  the 07-10 reconcile); its actual open life (07-02→07-06) has zero rows.
- Series inflation: ~19 rows/day vs the expected ~13 — a top-of-hour NaN row followed
  ~10-15 min later by a recompute row with identical spot/netMark/frontMark (25 frozen
  duplicates per calendar).

The raw material to fix ALL of this exists: `leg_observations` holds the full SPX chain
(marks, IVs, bsm_* greeks) since 2026-06-12. Journal rows are derivable from it.

In scope: data layer (core use-cases, adapters/repos, worker job, CLI), the back-leg NaN
root cause, one-time repair of all 17 existing calendars.
Out of scope: any UI change (LifecycleChart already renders greeks/vol/term/price panels
and draws gaps honestly), market-context history (GEX walls / skew / regime snapshots in
the journal), new analytics/formulas.

</domain>

<decisions>
## Implementation Decisions

All delegated to Claude ("you know best"). Locked here for the planner:

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

</decisions>

<code_context>
## Existing Code Insights

- `packages/core/src/journal/application/snapshotCalendars.ts` — live writer: OPS-01
  freshness gate (assessLegFreshness), buildSnapshotRow → computeLegPairMetrics +
  computeSnapshotPnl (exported for the JRNL-01 recompute path — precedent for reuse).
- `packages/core/src/journal/application/ports.ts` — `ForResolvingLegSnapshot` resolves
  the LATEST leg observation only; rebuild needs a historical as-of/slot-window variant
  (new driven port + Postgres/memory twins + contract tests, per architecture-boundaries).
- `packages/core/src/journal/application/getCalendarLifecycle.ts` — read path enriches
  rows with computeForwardVol + computeAttributionSeries; untouched by this phase.
- `calendar_snapshots` — 18-col row, composite PK (calendar_id, time), Drizzle-numeric
  strings, 'NaN' valid per D-06, `trigger` provenance ('scheduled'|'event-move').
- `leg_observations` — full-chain rows since 2026-06-12 with mark + bsm_iv/bsm_delta/…;
  convention: NULL bsm_* = never processed by compute-bsm-greeks (starvation tell),
  'NaN' = IV inversion failed (memory: BSM newest-first fix, chain-window regression).
- Repair-CLI precedents: `fix-pnl-reingest.ts` (validated-oracle P&L repair),
  backfill-transactions CLI, scoped rebuild-journal — journal data is rebuilt from
  broker fills / stored observations, never hand-edited (workflow.md Data Discipline).
- Worker: `apps/worker/src/handlers/snapshot-calendars.ts` thin adapter (RTH+holiday gate
  on journal write only, chains compute-analytics); `register-open-calendars.ts`
  (on-demand, no RTH gate) — on-register backfill hooks here or in its use-case.
- pg-boss: singletonKey dedup idiom; 900s handler budget (batch big writes — WATCH from
  BSM drain: ~15k rows/cycle risk; rebuild writes ≪ that per calendar but batch anyway).
- Suites: TDD red→green mandatory; contract tests run against Postgres testcontainers +
  memory twins; distinct-timestamp discipline (phase 5-6 lesson: reused now() hides bugs).

## Live data facts for test fixtures

- Open cal c225281e: front `SPX   261120P07600000` healthy / back `SPX   261130P07600000`
  all-NaN — the exact repro pair for HIST-01.
- 17 calendars total (15 closed, 2 open); closed ones need CLI repair only.
- All existing rows are source='cboe'; schwab_chain never appears in snapshots to date.

</code_context>

<specifics>
## Specific Ideas

- Acceptance shape (VALIDATION + verifier): after HIST-01 fix + repair run, BOTH open
  calendars' lifecycle series contain non-gap rows wherever leg_observations had usable
  marks for both legs; per-calendar before/after coverage stats (rows, non-gap rows, days
  covered) printed by the CLI and recorded in the SUMMARY. The 07-06→07-08 window for the
  open calendars is the concrete testbed: those 49 all-gap rows must heal wherever the
  archive has both legs' marks.
- The "why did my calendar act that way" question is answered by SERIES, not points —
  optimize for continuous non-gap runs, not row count.
- Do NOT chase schwab-vs-cboe source mixing in this phase; selectChainSources dual-source
  union already exists upstream. Rebuild consumes whatever leg_observations has.

</specifics>

<deferred>
## Deferred Ideas

- Market-context history in the journal (GEX walls / skew / full term structure / regime
  at each snapshot) — separate future phase; needs its own storage + UI design.
- Smile-IV for far-dated legs — standing DO-NOT-BUILD (TOS default = Individual IV).
- Tick-level journal cadence — contradicts STRM-04 + 30-min design.
- Journal UI redesign — user's "doesn't cut it" is about lost DATA; revisit presentation
  only if the repaired data still reads poorly.

</deferred>
