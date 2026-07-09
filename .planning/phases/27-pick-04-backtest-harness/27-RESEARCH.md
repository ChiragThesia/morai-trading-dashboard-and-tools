# Phase 27: PICK-04 Backtest Harness - Research

**Researched:** 2026-07-09
**Domain:** Point-in-time replay of the picker/exit rule engines against stored market data (in-repo codebase archaeology — no external library or API research required)
**Confidence:** HIGH (every claim below is read directly from this repository's source; nothing is web-sourced or training-data-derived)

## Summary

This phase is pure codebase archaeology, not library research. `.planning/research/PITFALLS.md` already covers the external quant-backtesting methodology (look-ahead, survivorship, overfitting, fill-model divergence) exhaustively and at HIGH confidence. The open question this research answers is mechanical: **which exact repo functions, ports, and columns does a point-in-time replay need, which of them already support "as of time T" reads, and which need a new additive export or a new bounded read.**

The answer is good news shaped as a to-do list. Three load-bearing simplifications fall out of reading the actual schema and use-cases:

1. **The leakage oracle doesn't need to rebuild GEX or economic-events state as of T.** `picker_snapshot.snapshot` already stores the frozen `gex`, `events`, `gexContextStatus`, and `eventsContextStatus` values the live picker actually scored against. Replay reuses them verbatim instead of re-deriving them from `gex_snapshots`/`economic_events` (which have no as-of-T read today, and `economic_events` has no `discoveredAt` column at all — true "as known at T" is unrecoverable for events, but irrelevant once the stored snapshot is the source).
2. **`scoreCalendarCandidates`'s weights are NOT injectable today** — they're direct imports from `rules.ts` inside `scoreOne`. Leave-one-rule-out ablation needs one small, additive, default-preserving change: an optional `weights?: Partial<Record<BreakdownCriterion, number>>` on `ScoringParams`, defaulting to the existing constants. Zero live call-site changes.
3. **`readJournal`'s row mapper silently drops every `schwab_chain`-sourced snapshot row** (`mapSnapshotRow` in `calendar-snapshots.ts` returns `null` for any `source !== "cboe"`). The exits context (Phase 26) already had to work around this with its own fresh query. The backtest's 13-trade exit replay would reproduce that exact silent-data-loss bug if it naively calls `readJournal` — it needs the same kind of source-inclusive fresh read the exits context built.

**Primary recommendation:** build the backtest as a new `packages/core/src/backtest/` bounded context that (a) adds ~6 additive exports to existing barrels, (b) adds one new as-of-T chain read + one as-of-T RV20 read + one source-inclusive full-history read, (c) replays three genuinely distinct things (leakage-oracle score reproduction, the 13 real trades' exit mechanics, and a full-universe hypothetical entry+exit simulation for attribution/ablation) through the untouched live domain functions, and (d) never writes anything but `backtest_runs`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Point-in-time chain/RV20 reconstruction | Database/Storage | API/Backend | New parameterized SQL reads live in `packages/adapters/postgres/`; the "as of T" semantics are a query concern |
| Candidate universe + scoring replay | API/Backend | — | Reuses `packages/core` pure domain functions unchanged; no I/O in this tier |
| Exit-ladder replay (13 trades + hypothetical) | API/Backend | Database/Storage | `evaluateExit` reuse is backend/core; its inputs are assembled from stored rows |
| Attribution / ablation / bootstrap-CI kernel | API/Backend | — | Pure numeric functions, no I/O |
| CLI orchestration | API/Backend | — | `apps/worker/src/backtest.ts`, same tier as `fix-pnl-reingest.ts`/`backfill-transactions.ts` |
| Report persistence | Database/Storage | API/Backend | `backtest_runs` append-only table |

No Browser/Client, Frontend-Server, or CDN/Static capability exists in this phase — it is a backend-only operator CLI with no UI (BOARD/UI work is out of scope per REQUIREMENTS.md's phase boundary).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BT-01 | Operator CLI replays stored chains since 2026-06-12 through the SAME pure entry+exit functions with point-in-time correctness (no lookahead) | New as-of-T chain/RV20 reads (Architecture Patterns → "New reads needed"); CLI env-bootstrap finding (Code Examples → CLI composition) |
| BT-02 | Replay of a historical cohort reproduces the recorded live `picker_snapshot` score for that cohort (leakage oracle) | "Oracle mechanics" finding — reuse stored `gex`/`events`/status fields verbatim; ruleSet-drift guard; exact-match design in Architecture Patterns |
| BT-03 | Harness reproduces the 13 closed calendars' validated outcomes (direction + rough magnitude) with fill-haircut on entry AND exit | 13-trade oracle resolution (`calendar_events.realizedPnl`); exit walk-forward design; `readJournal` source-drop bug and its fix |
| BT-04 | Per-rule directional attribution + leave-one-rule-out ablation, every number stamped n= and date range, persisted append-only | Kernel function designs (directional sign-test, ablation rank-delta, bootstrap CI); `backtest_runs` migration shape |
| BT-05 | Harness never writes weights; outputs are directional evidence a human reads | Don't Hand-Roll / guard-test recommendation; module-boundary check (no `ForWriting*Rules`-shaped port anywhere in the backtest tree) |
</phase_requirements>

## Standard Stack

### Core

No new dependencies. This phase reuses what's already installed:

| Library | Version (installed) | Purpose | Why no swap needed |
|---------|---------|---------|--------------|
| `fast-check` | `^4.8.0` (root `devDependencies`) | Property tests for the attribution/ablation/CI kernel | Already the project's numeric-invariant tool (used by `realized-vol.test.ts`, `rules.test.ts`, etc.) |
| `testcontainers` | `^12.0.1` (`packages/adapters/package.json`) | Real-Postgres contract tests for the new repos | Already the project's repo-test tool (every `*.contract.test.ts` uses it) |
| `drizzle-kit` | `^0.31.10` (root `devDependencies`) | Generates migration `0021_*.sql` from the schema diff | Already the project's migration generator (`drizzle.config.ts` points at `packages/adapters/src/postgres/schema.ts`) |

**Installation:** none — `bun install` at HEAD already provides all three.

**Version verification:** read directly from `package.json`/`packages/adapters/package.json` `[VERIFIED: codebase grep]`, not `npm view` — this is an internal monorepo dependency check, not a public-registry lookup.

### Alternatives Considered

None. `.planning/config.json` `workflow` has no dependency-swap trigger for this phase, and REQUIREMENTS.md's Out of Scope table explicitly rules out a "Backtest DSL / generic strategy language" — the only defensible design is "reuse the live TypeScript functions directly," which needs no library.

## Package Legitimacy Audit

**Not applicable — this phase installs zero new packages.** All three tools the Testing section of `27-CONTEXT.md` names (fast-check, testcontainers, drizzle-kit) are already present in `package.json`/`packages/adapters/package.json` at HEAD. The Package Legitimacy Gate (`gsd-tools query package-legitimacy check`) is skipped per its own trigger condition ("whenever this phase installs external packages").

## Architecture Patterns

### System Architecture Diagram

```
apps/worker/src/backtest.ts  (CLI entrypoint, import.meta.main guard)
        │
        ├─ parse argv: --from --to --calendar --report-only  (Zod, YYYY-MM-DD regex + round-trip guard,
        │                                                      mirrors backfill-transactions.ts exactly)
        ├─ parse env: { DATABASE_URL } ONLY  (NOT bootWorkerConfig() — see Code Examples)
        ├─ makeDb(DATABASE_URL) + compose backtest-owned repos from @morai/adapters
        │
        ▼
   runBacktest(deps)  — packages/core/src/backtest/application/runBacktest.ts (orchestrator)
        │
        ├──▶ [A] replayPickerCohort × N stored picker_snapshot rows in [from,to]   (BT-02)
        │        chain-as-of-T ──▶ selectCandidates ──▶ scoreCalendarCandidates
        │        (gex/events/status taken FROM the stored snapshot, not re-derived)
        │        ──▶ diff vs snapshot.candidates + snapshot.gateDrops ──▶ mismatch list
        │
        ├──▶ [B] replayExitsForCalendar × 13 closed calendars                       (BT-03)
        │        readFullSnapshotHistoryForCalendar (NEW, source-inclusive)
        │        ──▶ walk rows ASC ──▶ evaluateExit per row (in-memory previousVerdict)
        │        ──▶ compare final trajectory vs calendar_events.realizedPnl (the fills-ledger oracle)
        │
        ├──▶ [C] replayHypotheticalEntry × full universe × cohorts since 2026-06-12  (BT-04 input)
        │        chain-as-of-T ──▶ selectCandidates (full universe, incl. gate-dropped)
        │        ──▶ scoreCalendarCandidates (+ weights override per ablated rule)
        │        ──▶ forward-walk each candidate with evaluateExit using synthetic MarketContext
        │             assembled from leg_observations (no calendars row exists for these)
        │        ──▶ per-candidate simulated P&L at first actionable verdict or front expiry
        │
        ▼
   attribution/ablation/CI kernel (packages/core/src/backtest/domain/*.ts — pure, no I/O)
        directionalAttribution(A ∪ C outcomes)  +  ablationDeltas(C)  +  bootstrapCi(...)  +  coveragePercent(...)
        │
        ▼
   assemble BacktestReport JSONB  ──▶  persistBacktestRun (backtest_runs, INSERT only)  ──▶  console.warn summary
```

The primary use case (`bun run apps/worker/src/backtest.ts --from 2026-06-12 --to 2026-07-09`) traces top to bottom: CLI parses args → connects to Postgres directly (no brokerage I/O) → runs the three replay paths → reduces to a report → persists once → prints a human-readable summary. Nothing in this diagram writes to `calendars`, `calendar_events`, `picker_snapshot`, `exit_verdicts`, or any `rules.ts`/`exit-rules.ts` file.

### Recommended Project Structure

```
packages/core/src/backtest/
├── domain/
│   ├── directional-attribution.ts   # median-split sign test (BT-04)
│   ├── ablation-delta.ts            # per-cohort rank-delta between baseline/ablated scoring
│   ├── bootstrap-ci.ts              # resample CI + a small quantile() helper (percentileRank doesn't invert)
│   ├── types.ts                     # BacktestReport, ReplayMismatch, AblationRow, etc.
│   └── *.test.ts                    # fast-check: constant arrays, n=1, ties (per 27-CONTEXT.md Testing)
├── application/
│   ├── ports.ts                     # ForReadingChainAsOf, ForReadingDailySpotClosesAsOf,
│   │                                 # ForReadingPickerSnapshotsInRange, ForReadingClosedCalendarOutcomes,
│   │                                 # ForReadingFullSnapshotHistoryForCalendar, ForPersistingBacktestRun
│   ├── replayPickerCohort.ts        # BT-02 leakage oracle
│   ├── replayExitsForCalendar.ts    # BT-03 13-trade oracle
│   ├── replayHypotheticalEntry.ts   # BT-04 full-universe entry+exit simulation
│   └── runBacktest.ts               # orchestrator + report assembly
└── index.ts                         # barrel, threaded into packages/core/src/index.ts

packages/adapters/src/postgres/repos/
├── backtest-chain.ts                # as-of-T union/dedup chain read (mirrors picker-chain.ts + gex-snapshot.repo.ts)
├── backtest-history.ts              # as-of-T readDailySpotClosesAsOf + readPickerSnapshotsInRange
└── backtest-runs.ts                 # INSERT-only backtest_runs repo

apps/worker/src/
└── backtest.ts                      # CLI composition root, DATABASE_URL-only env
```

`calendar-snapshots.ts` gets ONE additive method (`readFullSnapshotHistoryForCalendar`), not a new file — it already owns `calendarSnapshots` table access and the existing `readLatestSnapshotPerOpenCalendar` precedent for a source-inclusive query sits right next to it.

### Required Additive Exports (Wave 0 prerequisite)

`[VERIFIED: codebase grep]` — grepped `packages/core/src/index.ts`, `packages/core/src/picker/index.ts`, `packages/core/src/exits/index.ts` directly; none of the following are reachable via `@morai/core` today, even though every one of them is pure domain logic the backtest must reuse (not reimplement) per the phase's own "zero reimplementation" lock:

| Symbol | Lives in | Currently exported from | Needs threading to |
|---|---|---|---|
| `selectCandidates`, `SelectCandidatesParams`, `SelectCandidatesResult`, `GateDrops` | `picker/domain/candidate-selection.ts` | nowhere outside the picker context | `picker/index.ts` → `core/index.ts` |
| `haircutFill` | `picker/domain/candidate-selection.ts` | nowhere (exits imports it via a documented relative cross-context path, see below) | `picker/index.ts` → `core/index.ts` |
| `scoreCalendarCandidates`, `ScoringParams` (with the new optional `weights` field) | `picker/domain/scoring.ts` | nowhere | `picker/index.ts` → `core/index.ts` |
| `RULE_SET_METADATA`, `RuleMetadata` | `picker/domain/rules.ts` | nowhere | `picker/index.ts` → `core/index.ts` |
| `RawCandidate`, `ScoredCandidate`, `BreakdownEntry`, `BreakdownCriterion`, `ContextEntry`, `ExitPlan` | `picker/domain/types.ts` | nowhere | `picker/index.ts` → `core/index.ts` |
| `realizedVol` | `picker/domain/realized-vol.ts` | nowhere | `picker/index.ts` → `core/index.ts` |
| `rankAndCapCandidates`, `PICKER_TOP_N` | `picker/application/computePickerSnapshot.ts` | nowhere | `picker/index.ts` → `core/index.ts` |
| `evaluateExit` | `exits/domain/evaluate-exit.ts` | `exits/index.ts` only (re-exported inside that barrel, but the barrel's re-export is not itself re-threaded up for the pure function — only `makeComputeExitAdviceUseCase`/`makeGetExitAdviceUseCase` are threaded to `core/index.ts`) | `core/index.ts` |
| `EXIT_RULE_METADATA`, `EXIT_PRECEDENCE`, `TAKE_RUNGS`, `STOP_RUNGS`, `TERM_INVERSION_MIN/DISARM`, `GAMMA_OFF_STRIKE/DISARM/FRONT_DTE_MAX`, `EVT_BLACKOUT_DAYS`, `ROLL_*` | `exits/domain/exit-rules.ts` | `exits/index.ts` only | `core/index.ts` |
| A new pure leg-pair-metrics function extracted from `buildSnapshotRow` (see Code Examples) | `journal/application/snapshotCalendars.ts` | n/a — doesn't exist yet | `journal/index.ts` → `core/index.ts` |

`percentileRank`, `calendarDte`, `isWithinRth`, `isNyseHoliday`, `bsmGreeks`, `bsmPrice`, `computeSnapshotPnl`, `ForReadingCalendarEvents`, and `listCalendars`-backing types are **already** exported at the top-level barrel — no gap there.

**Precedent that this pattern is acceptable:** `exits/domain/evaluate-exit.ts` already imports `haircutFill` via a relative path (`"../../picker/domain/candidate-selection.ts"`), and its own docstring calls this out as a deliberate, documented exception to architecture-boundaries §2 ("not a foreign `domain/` port import"). Once `haircutFill` is threaded through `picker/index.ts`, the backtest (and, if ever revisited, the exits context) can import it the normal way instead.

**Live-behavior-change check:** every one of these is a pure additive export or an optional-parameter addition (`ScoringParams.weights?`). No existing call site (`computePickerSnapshot.ts`, `computeExitAdvice.ts`) passes the new field, so their behavior is byte-identical before and after. The `weight-sum-100` registry test (`rules.test.ts`) asserts against the `rules.ts` constants directly and is unaffected.

### New reads needed (none exist today, verified by reading every candidate read path)

`[VERIFIED: codebase grep + read]` — none of the following support an "as of time T" bound. Every existing chain/history read resolves the LATEST state relative to wall-clock `now`, or relative to the single most-recent row:

| Read | Existing function | Existing bound | Gap |
|---|---|---|---|
| Chain slice (bid/ask/mark/greeks/OI, dual-source union/dedup) | `picker-chain.ts` `readChainForPicker` | `MAX(time WHERE bsm_iv IS NOT NULL)`, then a 10-min lookback window — always the newest cohort | No `asOfT` parameter anywhere. `gex-snapshot.repo.ts`'s `readLegObsForGex` and `calendar-snapshots.ts`'s `resolveLegSnapshot` have the identical gap (also always-latest) |
| RV20 daily closes | `picker-history.ts` `readDailySpotCloses` | "last N distinct days present," anchored to data, not wall clock, but still always the MOST RECENT N days | No `asOfT` bound — this is exactly the vector PITFALLS.md Pitfall 2 names for `vrp` (an ACTIVE scored rule, weight 5) |
| Full snapshot history for a calendar, source-inclusive | none | `readJournal` exists but its row mapper (`mapSnapshotRow`) returns `null` and silently drops any row where `source !== "cboe"` | A calendar journaled partly via `schwab_chain` (routine since the dual-source chain fetch shipped) loses those cycles silently if `readJournal` is reused. The exits context (`26-03`, `readLatestSnapshotPerOpenCalendar`) already had to build its OWN fresh query for exactly this reason — same fix needed here, generalized to "all history for one calendar" instead of "latest row per open calendar" |
| GEX context as-of-T | `gex-snapshot.repo.ts` `readGexSnapshot` | `ORDER BY cycle_time DESC LIMIT 1` — latest only | **Not needed** for BT-02 (reuse the stored snapshot's frozen `gex` field, see Summary). Would be needed only if the harness ever scores cohorts that never got a live `picker_snapshot` row — out of scope this phase |
| Economic events as-of-T | `economic-events` repo `readEconomicEvents` | no time-scoping at all | **Not reconstructable even in principle** — `economic_events` (schema.ts:466-478) has no `createdAt`/`discoveredAt` column, only `eventDate`/`eventName`/`source`. For BT-02, reuse the stored snapshot's frozen `events` array instead. Document as a caveat (see Common Pitfalls) rather than attempt a fix — FOMC/CPI/NFP dates are published months ahead and essentially never change, so the residual leakage risk is negligible for this specific field, unlike RV20 |

**As-of-T chain query pattern** (parameterizes the existing picker-chain.ts / gex-snapshot.repo.ts two-step query with one added bound):

```ts
// Source: packages/adapters/src/postgres/repos/picker-chain.ts (existing pattern, generalized)
const latestRows = await db
  .select({ maxTime: max(legObservations.time) })
  .from(legObservations)
  .where(and(isNotNull(legObservations.bsmIv), lte(legObservations.time, asOfT))); // <-- the only new predicate

const latestTime = latestRows[0]?.maxTime;
if (latestTime === undefined || latestTime === null) return ok([]); // no data at or before asOfT

const windowStart = new Date(latestTime.getTime() - LOOKBACK_MS); // same 10-min lookback as live
// ...identical selectDistinctOn/join/orderBy as readChainForPicker, but SELECT the full column
// set (bid, ask, mark, bsmIv, bsmDelta, bsmGamma, bsmTheta, bsmVega, openInterest,
// underlyingPrice, source, time) since this one read must serve BOTH candidate-universe
// generation (needs bid/ask/OI/bsmIv) AND exit-context assembly for hypothetical positions
// (needs mark/bsmDelta/bsmGamma/bsmTheta/bsmVega) — avoids two separate as-of-T queries per cohort.
```

Cohort enumeration for the walk-forward loops does **not** need a new "distinct 30-min slot" discovery query. Two existing ledgers already ARE the canonical list of "a cycle actually ran live":

- Leakage oracle (BT-02) and the hypothetical-entry walk-forward (BT-04): iterate `picker_snapshot.observed_at` values in `[from, to]` — a new `ForReadingPickerSnapshotsInRange` port (the existing `ForReadingPickerSnapshot` only reads the single latest row).
- The 13-trade exit replay (BT-03): iterate the calendar's own `calendar_snapshots.time` sequence via the new `readFullSnapshotHistoryForCalendar` — already 30-min-spaced by construction, and the sequence's natural end (no more rows once `snapshot-calendars` stops writing for a closed calendar) is the walk-forward's termination condition. No separate "terminal verdict" stopping logic is needed for this path.

### Pattern 1: Oracle mechanics — what `picker_snapshot` already freezes

**What:** `PickerSnapshotRow.snapshot` (the JSONB blob validated by `pickerSnapshotResponse.parse`, `packages/adapters/src/postgres/repos/picker-snapshot.ts`) stores, per historical cohort: `gex` (flip/callWall/putWall/netGammaAtSpot/absGammaStrike/nearTerm), `gexContextStatus`, `events[]`, `eventsContextStatus`, `gateDrops` (liquidity/netTheta/termInverted/eventBlackout), `ruleSet[]` (the `RULE_SET_METADATA` snapshot at compute time), and `candidates[]` (top-8 only, each with the full 9-entry `breakdown[]`).

**When to use:** every BT-02 leakage-oracle replay. This is the mechanism that lets replay skip re-deriving GEX/events state entirely.

**Example (replay comparison sketch):**
```ts
// Source: packages/core/src/backtest/application/replayPickerCohort.ts (new)
async function replayPickerCohort(stored: PickerSnapshotRow, deps: ReplayDeps): Promise<CohortMismatch[]> {
  // 1. Registry-drift guard FIRST: if rules.ts changed since this row was written, a
  //    mismatch below is expected drift, not a leakage bug — flag and skip scoring compare.
  if (!ruleSetsEqual(stored.snapshot.ruleSet, RULE_SET_METADATA)) {
    return [{ kind: "registry-drift", observedAt: stored.observedAt, detail: "ruleSet changed since snapshot" }];
  }

  const chain = await deps.readChainAsOf(stored.observedAt); // as-of-T, NOT "latest"
  const realizedVol20 = await deps.readDailySpotClosesAsOf(21, stored.observedAt).then(realizedVol);
  const events = stored.snapshot.events; // reuse frozen events — NOT a fresh economic_events read
  const gexContext = stored.snapshot.gexContextStatus === "ok" ? toGexContextForPicker(stored.snapshot.gex) : null;

  const { candidates: raw, gateDrops } = selectCandidates(chain, events, { r, q });
  let scored = scoreCalendarCandidates(raw, gexContext, { r, q, realizedVol20 });
  if (stored.snapshot.eventsContextStatus !== "ok") scored = scored.map(zeroEventAdjustment); // same post-step as live
  const ranked = rankAndCapCandidates(scored, PICKER_TOP_N);

  return diffById(ranked, stored.snapshot.candidates).concat(diffGateDrops(gateDrops, stored.snapshot.gateDrops));
}
```

### Pattern 2: Ablation seam — optional weights, zero live-behavior change

**What:** `scoring.ts`'s `scoreOne` currently reads `WEIGHT_SLOPE`, `WEIGHT_FWD_EDGE`, etc. as direct top-of-file imports from `rules.ts` — confirmed by reading the full breakdown-array and `rawScore` construction in `scoring.ts`. `ScoringParams` has no weights field at all today.

**When to use:** BT-04's leave-one-rule-out ablation, run against the hypothetical full-universe replay.

**Example:**
```ts
// Source: packages/core/src/picker/domain/scoring.ts (additive diff sketch)
export type ScoringParams = {
  readonly r: number;
  readonly q: number;
  readonly realizedVol20?: number | null;
  readonly slopeHistory?: ReadonlyArray<number>;
  /** Ablation seam (PICK-04): override one or more active-rule weights. Absent/undefined
   * criteria fall back to the rules.ts constant — omitting this field entirely (every live
   * call site) reproduces today's behavior exactly. */
  readonly weights?: Partial<Record<BreakdownCriterion, number>>;
};

// inside scoreOne:
const wSlope = params.weights?.slope ?? WEIGHT_SLOPE;
// ...same substitution for the other 8 weight constants, both in the breakdown[] push and in rawScore.
```

Backtest call for "ablate slope": `scoreCalendarCandidates(raw, gex, { ...baseParams, weights: { slope: 0 } })`.

### Pattern 3: The 13-trade fills-ledger oracle

**What:** `calendars.ts`'s repo read functions (`getOpenCalendars`, `listCalendars`, `getCalendarById`) never select `calendars.closeNetCredit` — confirmed by reading every `mapRow`/select clause in the file; the `Calendar` domain type (`journal/application/ports.ts`) has no `closeNetCredit` field. The validated realized-P&L oracle instead lives on **`calendar_events.realizedPnl`** (schema.ts:267, "closeCredit − openDebit − totalFees; NULL on OPEN events," computed by `sync-fills`'s pairing logic and the exact value the Phase-22 journal-P&L fix validated against real Schwab transactions for all 13 calendars).

**When to use:** BT-03's oracle resolution.

**Example:**
```ts
// Source: apps/worker/src/backtest.ts composition (reuses existing ports, no new repo query)
const closed = await calendarsRepo.listCalendars("closed"); // existing port, unchanged
for (const cal of closed.value) {
  const events = await calendarEventsRepo.readCalendarEvents(cal.id); // existing port, unchanged
  const realizedPnl = events.value
    .filter((e) => (e.eventType === "CLOSE" || e.eventType === "ROLL") && e.realizedPnl !== null)
    .reduce((sum, e) => sum + e.realizedPnl!, 0); // dollars — this IS "the fills are the oracle"
}
```

### Pattern 4: `readJournal`'s silent source-drop, and the fix already precedented in Phase 26

**What:** `calendar-snapshots.ts`'s `mapSnapshotRow` returns `null` (and the caller drops the row) for any `calendar_snapshots.source !== "cboe"`. Its own comment explains why: `"schwab_chain"` was historically rare, so the mapper only ever handled `"cboe"`. Since the dual-source chain fetch shipped, `schwab_chain`-sourced rows are routine. The exits context's own docstring (`exits/application/ports.ts`) names this exact function as "Pitfall 1" and built `readLatestSnapshotPerOpenCalendar` (a fresh `DISTINCT ON` query with no source filter) specifically to avoid it — but that port only reads the LATEST row per OPEN calendar, not full history, and excludes closed calendars entirely (`WHERE calendars.status = 'open'`).

**When to use:** BT-03's full walk-forward needs every row for a calendar regardless of status or source.

**Example:**
```ts
// Source: packages/adapters/src/postgres/repos/calendar-snapshots.ts (new additive method,
// same file — mirrors readLatestSnapshotPerOpenCalendar's "no source filter" fix, generalized
// to full history and to closed calendars too)
const readFullSnapshotHistoryForCalendar: ForReadingFullSnapshotHistoryForCalendar = async (calendarId) => {
  const rows = await db
    .select()
    .from(calendarSnapshots)
    .where(eq(calendarSnapshots.calendarId, calendarId))
    .orderBy(asc(calendarSnapshots.time)); // no status join, no source filter — every row, ASC
  return ok(rows.map(mapSnapshotRowInclusive)); // a new mapper — no `if (source !== "cboe") return null`
};
```

### Pattern 5: Hypothetical-position MarketContext assembly (no `calendars` row exists)

**What:** `snapshotCalendars.ts`'s private `buildSnapshotRow(now, cal, front, back, trigger)` is exactly the formula the backtest needs for a hypothetical candidate's leg-pair metrics (`netMark = backMark - frontMark`, NaN-propagation when either leg is unsolved, `netGreek = (back - front) * qty * 100`, `termSlope`, `dteFront`/`dteBack` via `calendarDte`) — but it's private and shaped around a full `Calendar` domain object (`cal.id`, `cal.openNetDebit`, `cal.qty`, `cal.frontExpiry`, `cal.backExpiry`), which a never-traded candidate doesn't have.

**When to use:** BT-04's hypothetical-entry walk-forward (research question 5).

**Example (extraction, zero behavior change to the live writer):**
```ts
// Source: packages/core/src/journal/application/snapshotCalendars.ts (refactor-extract, additive export)
export function computeLegPairMetrics(
  now: Date,
  front: LegSnapshot | null,
  back: LegSnapshot | null,
  qty: number,
  frontExpiry: string,
  backExpiry: string,
): Omit<SnapshotRow, "calendarId" | "pnlOpen" | "trigger"> {
  // ...exact body currently inside buildSnapshotRow, minus the pnlOpen/calendarId/trigger fields
}

function buildSnapshotRow(now, cal, front, back, trigger): SnapshotRow {
  const metrics = computeLegPairMetrics(now, front, back, cal.qty, cal.frontExpiry, cal.backExpiry);
  const pnlOpen = String(computeSnapshotPnl(parseFloat(metrics.netMark), cal.openNetDebit, cal.qty));
  return { ...metrics, calendarId: cal.id, pnlOpen, trigger };
}
```

The backtest then builds `front`/`back` (`LegSnapshot`) directly from the as-of-T chain slice (filtered to the candidate's fixed strike/expiry/`"P"`), applies the same freshness check `snapshotCalendars.ts` uses (`isLegFresh`/`SNAPSHOT_LEG_STALENESS_TOLERANCE_MS` — skip/flag the cycle, mirroring OPS-01, if a leg is missing or its own `time` is far from the resolved cohort time), calls `computeLegPairMetrics`, converts the numeric-string sentinels via `Number(...)` (the same conversion `main.ts`'s `mapSnapshotToLatestSnapshotForCalendar` already does for the live exits wiring), and assembles `MarketContext`/`HeldPosition` (`openNetDebit` := the candidate's own haircut-priced `debit` from `selectCandidates`). `cohortNow` := the resolved cohort time itself (replaying history has no "elapsed lag" concept beyond what the chain data itself shows), so the staleness gate degrades gracefully to "never fires on backtest replay" except via the explicit leg-freshness check.

### Anti-Patterns to Avoid

- **Re-deriving GEX/events state from raw tables for the leakage oracle:** unnecessary work AND a source of false-positive mismatches (freshness-window clock logic that has no meaningful "then" to compare against). Use the frozen snapshot fields.
- **Reusing `readJournal`/`mapSnapshotRow` for the 13-trade replay:** silently drops `schwab_chain`-sourced cycles — exactly the class of bug PITFALLS.md's "these features convert silent data gaps into confident wrong answers" framing warns about.
- **Computing a correlation coefficient for directional attribution:** `27-CONTEXT.md` explicitly locks "sign + n, never a coefficient." Use the median-split sign test (Code Examples), not Pearson r.
- **A new generic "backtest DSL" or strategy-parameter language:** explicitly Out of Scope in REQUIREMENTS.md. The whole point is replaying the ONE existing engine, not building a second one.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Candidate universe generation | A second scanner | `selectCandidates` (exported, unchanged) | Locked decision: "Zero reimplementation of scoring logic" |
| Scoring | A second scoring function | `scoreCalendarCandidates` (+ optional `weights`) | Same lock; the ablation seam is additive, not a rewrite |
| Exit verdicts | A second exit ladder | `evaluateExit` (exported, unchanged) | Same lock, extended to Phase 26's evaluator |
| Fill pricing (entry AND exit) | A second haircut formula | `haircutFill` (exported) | PITFALLS.md Pitfall 4: "One shared fill function used by the live picker and both sides of the backtest" |
| Percentile/rank math | A new percentile function | `percentileRank` (already exported) | Already reusable, zero gap |
| Realized-P&L for the 13 trades | A hand-derived formula from `calendars.openNetDebit`/mark-to-market | `calendar_events.realizedPnl`, summed over CLOSE/ROLL rows | This IS the validated fills-ledger oracle (Phase-22 fix); hand-deriving risks reproducing the exact unit bug that fix corrected |
| Confidence interval | A hand-rolled t-test or z-interval | A seeded-RNG bootstrap resample + a small `quantile()` helper | n=13 is too small for a parametric interval to be honest; CONTEXT.md explicitly wants the CI's width to BE the honesty signal |
| Report viewer | A new UI/route | JSONB persisted to `backtest_runs` + a console summary | No UI phase requested; BT-04 only asks for a persisted report a human reads |

**Key insight:** every piece of "don't hand-roll" here maps to an EXISTING function in this exact repo, not a third-party library — the discipline is "export and reuse the engine," not "pick the right npm package."

## Common Pitfalls

(Repo-specific application of `.planning/research/PITFALLS.md`'s taxonomy — see that file for the full external methodology; this section only adds what's specific to THIS phase's concrete code paths.)

### Pitfall: Treating the events-leakage gap as fixable when it structurally isn't

**What goes wrong:** A planner tries to add point-in-time filtering to `readEconomicEvents` and can't, because `economic_events` has no timestamp column recording when a row was inserted/discovered.
**Why it happens:** Every OTHER leakage vector in this phase (chain, RV20) has an obvious as-of-T fix (add a `time <=` bound). This one doesn't, because the underlying data model never captured "discovered at."
**How to avoid:** Don't try. Use the frozen `snapshot.events` array for BT-02 (Pattern 1). For BT-04's hypothetical-cohort replay (which has no stored snapshot to freeze from), use the CURRENT `readEconomicEvents()` result and document the caveat explicitly in the report ("economic events reflect the CURRENT calendar, not necessarily what was known at each historical decision date — low-risk because FOMC/CPI/NFP dates are published months ahead and rarely change").
**Warning signs:** A task titled "add discoveredAt to economic_events" appearing in the plan — that's schema scope-creep this phase doesn't need (Deferred Ideas in `27-CONTEXT.md` only names `bsm_solved_at`, not an events-discovery column).

### Pitfall: Comparing replay candidates by array position instead of by `id`

**What goes wrong:** `rankAndCapCandidates` sorts by score-desc + id tie-break BEFORE the stored snapshot's `candidates[]` array is written — so array index in the stored blob is RANK order, not generation order. A naive positional diff (`replayed[i]` vs `stored[i]`) will spuriously "mismatch" whenever ranking(but not membership) differs by an off-by-one from a floating-point rounding difference elsewhere.
**How to avoid:** Diff by building a `Map<id, candidate>` from both sides and comparing matched pairs; report unmatched ids on either side as a separate (louder) mismatch class.

### Pitfall: Forgetting the ruleSet-drift guard

**What goes wrong:** `rules.ts` weights get tuned in a later phase (PLAY-05, or a future promotion). Re-running the backtest against OLD `picker_snapshot` rows now legitimately mismatches the stored score — not because of a leakage bug, but because the registry itself changed. Reporting this as a "leakage detected!" false alarm erodes trust in the harness exactly the way PITFALLS.md warns a green-but-wrong backtest does.
**How to avoid:** Compare `stored.snapshot.ruleSet` against the CURRENT `RULE_SET_METADATA` first (Pattern 1); skip/flag score-equality checking for any cohort where they differ, and report the drift separately from genuine mismatches.

### Pitfall: The late-solved-BSM caveat still applies even with a `time <= asOfT` bound

**What goes wrong:** Adding `lte(legObservations.time, asOfT)` to the as-of-T chain query bounds which ROWS are visible, but `bsm_iv`/`bsm_delta`/etc. are solved **in place via UPSERT** with no `bsm_solved_at` column (confirmed: `leg_observations` schema has no such column). A row observed at T but not BSM-solved until T+15min shows its FINAL solved value in ANY read today, including the as-of-T one.
**How to avoid:** Exactly what `27-CONTEXT.md` already locked — flag this as a documented residual-optimism caveat in the report, don't attempt to fix it (no `bsm_solved_at` column this phase). The leakage oracle's reliance on the STORED snapshot (Pattern 1) already minimizes exposure to this for BT-02; it remains a real, undocumented-away risk for BT-04's hypothetical-cohort replay.

## Code Examples

### CLI env bootstrap — DATABASE_URL only, NOT `bootWorkerConfig()`

`[VERIFIED: codebase read]` — `apps/worker/src/config.ts`'s `workerConfigSchema` REQUIRES (no default) `TOKEN_ENCRYPTION_KEY` (min 32 chars), `SCHWAB_TRADER_APP_KEY`, `SCHWAB_TRADER_APP_SECRET`, and `SIDECAR_URL`, in addition to `DATABASE_URL`. Both existing CLI precedents (`fix-pnl-reingest.ts`, `backfill-transactions.ts`) accept this because they DO perform brokerage I/O (Schwab transaction backfill) and are documented as run via `railway run` (a deployed environment where those vars already exist). The backtest performs ZERO brokerage I/O — it only reads Postgres and writes one new table. Forcing an operator to set four irrelevant secrets to run a local analysis tool is unnecessary friction the CONTEXT.md's "DATABASE_URL only" instruction is explicitly guarding against.

```ts
// Source: apps/worker/src/backtest.ts (new, composition-root pattern mirrors fix-pnl-reingest.ts
// EXCEPT for env parsing — this is the one deliberate deviation, and why)
if (import.meta.main) {
  const backtestConfigSchema = z.object({ DATABASE_URL: z.string().url() });
  const config = backtestConfigSchema.parse(process.env); // fails loud, same spirit as bootWorkerConfig
  const { makeDb } = await import("@morai/adapters");
  const db = makeDb(config.DATABASE_URL);
  // ...compose backtest-owned repos directly from db; no brokerTokensRepo, no sidecar, no Schwab adapters
}
```

### Bootstrap CI kernel (BT-04)

```ts
// Source: packages/core/src/backtest/domain/bootstrap-ci.ts (new)
function quantile(sorted: ReadonlyArray<number>, p: number): number {
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** Seeded so re-running over UNCHANGED replay data reproduces an IDENTICAL report — avoids a
 * false "the numbers changed" alarm between two runs of an append-only audit tool. */
export function bootstrapCi(
  samples: ReadonlyArray<number>,
  seed: number,
  iterations = 2000,
  confidence = 0.9,
): { readonly low: number; readonly high: number; readonly n: number } {
  if (samples.length === 0) return { low: NaN, high: NaN, n: 0 };
  let s = seed;
  const rand = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; // mulberry-style PRNG
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < samples.length; j++) sum += samples[Math.floor(rand() * samples.length)]!;
    means.push(sum / samples.length);
  }
  means.sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  return { low: quantile(means, alpha), high: quantile(means, 1 - alpha), n: samples.length };
}
```

fast-check invariants (per `27-CONTEXT.md` Testing: "constant arrays, n=1, ties"): constant `samples` array → `low === high === that constant`; `samples.length === 1` → degenerate point CI at that value; `low <= high` always; same `seed` + same `samples` → identical output (determinism).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.8` (root) |
| Config file | existing root/workspace vitest config — no phase-specific changes expected (every other bounded context colocates `*.test.ts`/`*.contract.test.ts` with source under the same runner) |
| Quick run command | `bun run vitest run packages/core/src/backtest` (or the specific new file) |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BT-01 | Point-in-time chain read: a future-dated `leg_observations` row must NOT change a past-T read's result | integration (testcontainers) | `bun run vitest run packages/adapters/src/postgres/repos/backtest-chain.contract.test.ts` | ❌ Wave 0 |
| BT-02 | Replay of a seeded historical cohort reproduces its stored `picker_snapshot` score exactly | integration (testcontainers) | `bun run vitest run packages/core/src/backtest/application/replayPickerCohort.test.ts` | ❌ Wave 0 |
| BT-02 | ruleSet-drift guard: a cohort whose stored ruleSet differs from current `RULE_SET_METADATA` is flagged, not falsely reported as a leakage mismatch | unit | `bun run vitest run packages/core/src/backtest/application/replayPickerCohort.test.ts` | ❌ Wave 0 (same file) |
| BT-03 | `readFullSnapshotHistoryForCalendar` returns `schwab_chain`-sourced rows (regression guard for the `mapSnapshotRow` drop bug) | integration (testcontainers) | `bun run vitest run packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` | file exists, needs a new test case |
| BT-03 | Exit replay over the 13 closed calendars reproduces direction (and rough magnitude, per a Claude's-Discretion tolerance) vs `calendar_events.realizedPnl` | integration (testcontainers) | `bun run vitest run packages/core/src/backtest/application/replayExitsForCalendar.test.ts` | ❌ Wave 0 |
| BT-04 | Directional-attribution sign test: constant metric array, n<4, and a known positive/negative split all classify correctly | unit (fast-check) | `bun run vitest run packages/core/src/backtest/domain/directional-attribution.test.ts` | ❌ Wave 0 |
| BT-04 | Ablation rank-delta: zeroing a rule's weight never IMPROVES a candidate's rank if its raw contribution was positive | unit (fast-check) | `bun run vitest run packages/core/src/backtest/domain/ablation-delta.test.ts` | ❌ Wave 0 |
| BT-04 | Bootstrap CI: constant array degenerates, n=1 degenerates, low≤high, same seed reproducible | unit (fast-check) | `bun run vitest run packages/core/src/backtest/domain/bootstrap-ci.test.ts` | ❌ Wave 0 |
| BT-04 | `backtest_runs` repo is append-only (a second insert with a new id never overwrites the first; no update port exists) | integration (testcontainers) | `bun run vitest run packages/adapters/src/postgres/repos/backtest-runs.contract.test.ts` | ❌ Wave 0 |
| BT-05 | The backtest module tree has no port shaped like `ForWriting*Rules`/`ForPersistingRuleWeights` and never imports a write path into `rules.ts`/`exit-rules.ts` | unit (static/structural guard, mirrors `rules.test.ts`'s existing refuted-criteria registry guard) | `bun run vitest run packages/core/src/backtest/application/ports.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** the specific new/changed test file(s).
- **Per wave merge:** `bun run test` (full suite — the additive-export changes to `scoring.ts`/`snapshotCalendars.ts` touch shared, live-path files and must not regress `rules.test.ts`, `scoring.test.ts`, `computePickerSnapshot.test.ts`, `evaluate-exit.test.ts`, `computeExitAdvice.test.ts`).
- **Phase gate:** full suite green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `packages/core/src/backtest/domain/*.test.ts` — kernel fast-check tests (directional attribution, ablation delta, bootstrap CI)
- [ ] `packages/core/src/backtest/application/replayPickerCohort.test.ts` — BT-02 leakage oracle + ruleSet-drift guard
- [ ] `packages/core/src/backtest/application/replayExitsForCalendar.test.ts` — BT-03 13-trade oracle
- [ ] `packages/core/src/backtest/application/replayHypotheticalEntry.test.ts` — BT-04 full-universe simulation
- [ ] `packages/core/src/backtest/application/ports.test.ts` — BT-05 no-write-path structural guard
- [ ] `packages/adapters/src/postgres/repos/backtest-chain.contract.test.ts` — as-of-T no-lookahead test (BT-01's own required check)
- [ ] `packages/adapters/src/postgres/repos/backtest-runs.contract.test.ts` — append-only insert
- [ ] `packages/adapters/src/postgres/repos/backtest-history.contract.test.ts` — as-of-T RV20 read
- [ ] A new test case inside the EXISTING `calendar-snapshots.contract.test.ts` covering `readFullSnapshotHistoryForCalendar`'s `schwab_chain`-inclusion (no new file — this repo already has a contract-test file to extend)
- [ ] Framework install: none — `fast-check`/`testcontainers`/`vitest` already present

## Security Domain

`security_enforcement` is enabled (`.planning/config.json` `security_asvs_level: 1`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Operator-run local CLI, no new auth surface; reuses the existing `DATABASE_URL` connection, no user-facing login |
| V3 Session Management | No | No session concept in a one-shot CLI |
| V4 Access Control | No | No new HTTP route, MCP tool, or served endpoint this phase — it is explicitly NOT a pg-boss job or server route (locked decision) |
| V5 Input Validation | Yes | Zod-parse every CLI arg at the composition root: `--from`/`--to` via the SAME YYYY-MM-DD-regex-plus-round-trip-date guard `backfill-transactions.ts` already uses; `--calendar <id>` validated as UUID-shaped before hitting `getCalendarById` (a malformed id already safely resolves to "not found" per the existing `"invalid input syntax for type uuid"` handling in `calendars.ts` — reuse, don't re-guard) |
| V6 Cryptography | No | No new secret, token, or encrypted column. The minimal env-schema recommendation (Code Examples) deliberately AVOIDS pulling in `TOKEN_ENCRYPTION_KEY` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via CLI-supplied date range/calendar id | Tampering | Drizzle parameterized query builders throughout (`and(gte(...), lte(...))`, `eq(...)`) — the same convention every existing repo in this codebase already follows; never raw template interpolation |
| Unbounded resource use from a wide `--from`/`--to` range | Denial of Service (self-inflicted, single-operator tool) | Reject/warn on `--from` earlier than 2026-06-12 (the documented start of the replayable `leg_observations` corpus per `27-CONTEXT.md`'s Phase Boundary); stream per-cohort rather than loading the whole range into memory at once (PITFALLS.md Performance Traps table already names this exact trap) |
| `backtest_runs` JSONB report containing dollar P&L figures | Information Disclosure | Add `.enableRLS()` to the new `backtest_runs` table — every existing table in `schema.ts` does this uniformly; this is not new sensitive data (the same dollar figures already live in `calendars`/`calendar_events`), just a new place it's aggregated, so the existing RLS convention is sufficient and consistent |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Roughly 100-240 stored `picker_snapshot` rows exist in `[2026-07-05, 2026-07-09]` (Phase 19 ship date through this research date, 24/7 cadence at up to 48/day, minus gaps) | Architecture Patterns / cohort enumeration | Purely informational sizing estimate — does not affect any design decision; the harness discovers the real count itself via `ForReadingPickerSnapshotsInRange` at run time and reports it in the coverage section, so a wrong estimate here has zero downstream effect |
| A2 | "Direction + rough magnitude" tolerance for BT-03 (Claude's Discretion per `27-CONTEXT.md`) can reasonably be: direction = sign match on realized P&L, magnitude = modeled-vs-oracle within a wide multiplier band (e.g. 2-3x), given the fill-haircut model is a known approximation (PITFALLS.md Pitfall 4) | Pattern 3 / BT-03 | If too loose, a genuinely broken exit-replay could pass; if too tight, a correct replay could spuriously fail on ordinary haircut-vs-real-fill slippage. This is explicitly left to the planner/discuss-phase to pick an exact number — not locked by CONTEXT.md |
| A3 | Economic-events leakage risk (no `discoveredAt` column) is negligible in practice because FOMC/CPI/NFP dates are published months ahead and essentially never rescheduled | Common Pitfalls | If a historical event date WAS materially rescheduled inside the replay window, BT-04's hypothetical-cohort attribution could show a small, undetectable leakage on the `eventAdjustment`/`backEventBonus` terms only (not on the leakage-oracle's BT-02 check, which reuses frozen snapshot data and is unaffected) |

## Open Questions (RESOLVED)

1. **Does the leakage oracle need a new as-of-T GEX/events read?**
   - What we know: no as-of-T GEX or events read exists anywhere in adapters today.
   - What's unclear: whether that's a blocker.
   - Resolution: No. `picker_snapshot` already freezes both fields at write time; BT-02 reuses them directly (Pattern 1). A new as-of-T GEX/events read is only needed if a future phase wants to score cohorts that never got a live snapshot — explicitly out of this phase's scope.

2. **Is `scoreCalendarCandidates`'s registry injectable for ablation?**
   - What we know: `ScoringParams` today has no weights field; `scoreOne` imports `WEIGHT_*` constants directly.
   - What's unclear: whether this needs a bigger refactor.
   - Resolution: No bigger refactor needed. One optional `weights?: Partial<Record<BreakdownCriterion, number>>` field with `??` fallback per criterion is a fully additive, zero-live-behavior-change seam (Pattern 2).

3. **Where does the 13-trade realized-P&L oracle actually live?**
   - What we know: `calendars.openNetDebit` is read-exposed; `calendars.closeNetCredit` is not (write-only from every read path checked).
   - What's unclear: the correct, already-validated source for realized P&L.
   - Resolution: `calendar_events.realizedPnl`, summed over `CLOSE`/`ROLL` rows per calendar (Pattern 3) — this is the exact fills-ledger value the Phase-22 journal-P&L fix validated against real Schwab transactions for all 13 calendars, per project memory.

4. **Can `readJournal` be reused for the 13-trade exit walk-forward?**
   - What we know: `readJournal` exists and returns a calendar's full snapshot history.
   - What's unclear: whether it's complete.
   - Resolution: No — its mapper silently drops every `schwab_chain`-sourced row. A new source-inclusive `readFullSnapshotHistoryForCalendar` (Pattern 4) is required; this exact class of bug was already named and worked around once, in Phase 26, for a narrower read (latest-per-open-calendar only).

5. **How does a hypothetical (never-traded) candidate get a `MarketContext` for exit-ladder replay, with no `calendars` row to key off?**
   - What we know: `evaluateExit` needs `MarketContext`/`HeldPosition`; those are normally built from `calendar_snapshots` rows written by `snapshotCalendars.ts`.
   - What's unclear: how to reproduce that computation for a position that never existed as a `calendars` row.
   - Resolution: extract the pure leg-pair-metrics computation out of `snapshotCalendars.ts`'s private `buildSnapshotRow` into an exported function (Pattern 5), and drive it from the as-of-T chain slice filtered to the candidate's fixed strike/expiries, instead of from a `Calendar` object.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | `testcontainers`-based contract tests for the new repos | ✓ | (daemon responds) | — |
| bun | CLI execution (`bun run apps/worker/src/backtest.ts`), test runner invocation | ✓ | 1.3.13 | — |
| node | drizzle-kit / tooling | ✓ | v26.3.1 | — |
| drizzle-kit | migration `0021_*.sql` generation | ✓ (root devDependency, `^0.31.10`) | — | — |
| Postgres (DATABASE_URL) | all backtest reads/writes | not probed this session (no live credentials in a research-only context) | — | Not a blocker: every other phase in this repo has the same dependency and it is already the project's standing infrastructure |

**Missing dependencies with no fallback:** none identified.

## Sources

### Primary (HIGH confidence — direct codebase reads, this session)

- `apps/worker/src/fix-pnl-reingest.ts`, `apps/worker/src/backfill-transactions.ts` — CLI composition-root precedent, `import.meta.main` guard pattern
- `apps/worker/src/config.ts` — `bootWorkerConfig`'s required-field set (the finding that motivates the minimal-env recommendation)
- `apps/worker/src/main.ts` (lines ~500-700) — live wiring for `readGexContextForPicker`, `readChainForRollForExits`, `mapCalendarToHeldPosition`, `mapSnapshotToLatestSnapshotForCalendar` — the exact conversion patterns the backtest must mirror
- `packages/core/src/picker/domain/{candidate-selection,rules,scoring,types,realized-vol}.ts` — full read of universe generation, scoring, and RV20 formulas
- `packages/core/src/picker/application/{computePickerSnapshot,ports}.ts` — the live use-case's exact read/score/persist sequence and the `PickerSnapshot` stored-blob shape
- `packages/core/src/exits/{domain,application}/*.ts` — `evaluateExit`, `exit-rules.ts` registry, `computeExitAdvice.ts`'s read order and hysteresis-state threading
- `packages/core/src/journal/application/snapshotCalendars.ts` — `buildSnapshotRow`'s exact leg-pair-metrics formula
- `packages/core/src/journal/application/getCalendarLifecycle.ts`, `packages/core/src/journal/domain/attribution.ts` — confirmed the Phase-22 P&L-attribution path reads `pnlOpen`/mark-to-market, NOT a realized-fills number, ruling it out as the BT-03 oracle source
- `packages/adapters/src/postgres/repos/{picker-chain,picker-snapshot,picker-history,calendars,fills,calendar-snapshots,exit-verdicts}.ts`, `packages/adapters/src/postgres/gex-snapshot.repo.ts` — every existing read's exact SQL shape and bound (or lack of one)
- `packages/adapters/src/postgres/schema.ts` — full schema read; confirmed `calendars.closeNetCredit` write-only exposure, `calendar_events.realizedPnl`, `economic_events`'s missing discovery-timestamp column, migration file conventions (0019/0020 as generated-diff examples)
- `packages/core/src/index.ts`, `packages/core/src/picker/index.ts`, `packages/core/src/exits/index.ts` — full grep for every symbol this phase needs, confirming the additive-export list
- `drizzle.config.ts`, root `package.json`, `packages/adapters/package.json` — migration-generation command and dependency versions
- `docs/architecture/jobs.md`, `docs/architecture/picker-rules.md`, `docs/architecture/exit-rules.md` — pipeline trigger chain, rule tables, precedence order
- `.planning/research/PITFALLS.md`, `.planning/REQUIREMENTS.md`, `.planning/phases/27-pick-04-backtest-harness/27-CONTEXT.md` — upstream methodology and locked decisions (this research does not re-derive what these already establish)

No Secondary or Tertiary sources — no WebSearch/WebFetch/Context7 calls were made this session. None were needed: every open research question was answerable by reading this repository's own source, and the external quant-backtesting methodology (look-ahead, survivorship, overfitting floors, fill-model divergence) is already covered at HIGH confidence in `.planning/research/PITFALLS.md`, which itself cites web sources directly.

## Metadata

**Confidence breakdown:**
- Replay-input reconstruction (chain/RV20/GEX/events): HIGH — every read path was located and its exact bound (or absence of one) confirmed by reading the SQL
- Oracle mechanics (picker_snapshot fields, calendar_events.realizedPnl): HIGH — confirmed against the actual Zod-validated stored shape and the schema's own column comments
- Ablation seam design: HIGH — confirmed `ScoringParams`/`scoreOne` have no weight injection today; the proposed fix is minimal and directly testable
- Kernel function designs (attribution/ablation/CI): MEDIUM — the formulas are standard and satisfy CONTEXT.md's constraints, but exact tolerance/threshold numbers (A2 in Assumptions Log) are left to planning/discuss-phase, not locked here
- Security/ASVS mapping: HIGH — this is a backend-only CLI with no new auth/session/access surface; the applicable categories are narrow and clearly reasoned

**Research date:** 2026-07-09
**Valid until:** re-verify if `rules.ts`/`exit-rules.ts`/`scoring.ts`/`snapshotCalendars.ts`/`calendar-snapshots.ts` change before this phase is planned (this research pins exact function signatures and export gaps as of the current HEAD; Phase 28 or a mid-milestone rule-weight promotion would invalidate the ruleSet-drift assumptions, not the mechanics)
