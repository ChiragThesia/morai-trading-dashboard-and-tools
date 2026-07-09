# Stack Research

**Domain:** SPX calendar-spread trading system — v1.3 Picker Intelligence (exit advisor, PICK-04 backtest harness, playbook port / VIX3M ingestion)
**Researched:** 2026-07-09
**Confidence:** HIGH
**Scope:** ONLY the three new v1.3 features. The locked stack (Bun/Hono/Supabase/Drizzle/
pg-boss/Vitest/Railway, schwab-py sidecar, React/Vite/Tailwind/shadcn) is unchanged and not
re-researched — see `docs/architecture/stack-decisions.md`. This file supersedes the v1.2
STACK.md previously here.

## Headline

**Zero new dependencies.** All three v1.3 features are built from capabilities the repo
already ships. The single external unknown — the FRED series id for the 3-month VIX — is
verified: it is **`VXVCLS`** (still live, daily, current to 2026-07-07), and adding it is a
one-line change to an existing constant, not a code change. Backtest replay and per-rule
metrics are pure TS over stored Postgres data reusing helpers that already exist. Exit
verdicts and backtest runs get two small new tables following the established
append-history pattern — no storage engine, no ORM, no npm additions.

## Recommended Stack

There are **no new core technologies**. The table below is the existing, locked stack the
three features build on — included so the roadmap sees which pieces each feature touches.

### Core Technologies

| Technology | Version (pinned) | Purpose | Why it already covers the new work |
|------------|------------------|---------|-----------------------------------|
| FRED HTTP adapter (`makeFredSeriesAdapter`, in-repo) | n/a (own code) | Fetch any FRED series by id, raw value, no fallback (D-09/D-14) | Already **parameterized** — takes any `seriesId`. Adding VIX3M = add `"VXVCLS"` to `DEFAULT_FRED_SERIES_IDS`. The adapter, the `macro_observations` table, the in-memory twin, and the fail-loud batch need zero code change. |
| Drizzle ORM + drizzle-kit | `drizzle-orm@^0.45.2`, `drizzle-kit@^0.31.10` | Schema + idempotent migrations | Two new append-history tables (exit advisories, backtest runs) are ordinary Drizzle tables + one idempotent migration (the DATA-01..04 pattern, next numbers 0018+). |
| Zod | `zod@^4.4.3` | Parse-don't-cast at every boundary | The exit-verdict and backtest-report JSONB blobs are Zod-parsed on write AND read at the adapter edge — the exact `picker_snapshot` discipline (T-19-10). |
| pg-boss | `pg-boss@^12.18.3` | Chain-triggered jobs | The exit advisor is a new handler appended to the existing single-trigger chain (`…→compute-gex-snapshot→compute-picker→compute-exit-advice`). No queue change. |
| Own picker engine (`scoreCalendarCandidates`, `PICKER_RULES`) | n/a (own code) | Entry scoring over a typed rule registry | The backtest **replays** stored chains through this same engine — no separate simulation framework. Exit rules extend the same registry pattern (gate/score rows). |

### Supporting Libraries

**No new libraries.** The reusable primitives the backtest metrics need already live in the
repo — listed here so the plan reuses them (ponytail rung 2) instead of adding a stats dep.

| Existing helper | Location | Purpose | Reuse in v1.3 |
|-----------------|----------|---------|---------------|
| `percentileRank(value, history)` | `packages/shared/src/percentile-rank.ts` | Inclusive trailing-window percentile, null-safe | Per-rule predictive-power ranking; Spearman = Pearson on ranks, and ranks come from this same sort/rank logic. |
| `realizedVol(closes)` | `packages/core/src/picker/domain/realized-vol.ts` | Sample stdev (n−1) of log returns × √252 | Its mean/variance/stdev pattern is the template for Pearson-r / information-coefficient — copy the shape, don't add jStat. |
| `picker_snapshot` append-history corpus | `packages/adapters/src/postgres/schema.ts` | One JSONB `pickerSnapshotResponse` per `observedAt`, INSERT-only | Schema comment already says it exists "for PICK-04's future slope backtest" — it is the trailing-slope input; the corpus is already accumulating. |
| `leg_observations` (dual-source chains) | schema `legObservations` | Full SPX chain since 2026-06-12 | The raw replay material — re-derive candidates per historical cohort. |
| `calendar_events` (realizedPnl) | schema `calendarEvents` | 13 closed calendars, OPEN/CLOSE/ROLL + realized P&L | The backtest **oracle** — measure each rule's score against realized outcome. |
| `getMacro` / `macro_observations` read | `packages/core/src/journal/application/getMacro.ts` | Read latest macro series by id | The VIX/VIX3M ratio gate reads VIXCLS + VXVCLS from here; ratio is one division, pure TS. |

### Development Tools

| Tool | Version | Notes |
|------|---------|-------|
| Vitest | `vitest@^4.1.8` | Existing workspace runner. |
| fast-check | `fast-check@^4.8.0` | **Required** for the backtest metric functions (numerical code → property tests per tdd.md): correlation invariants (∈[−1,1], rank-permutation stability, round-trips). Already installed. |
| testcontainers | `testcontainers@^12.0.1`, `@testcontainers/postgresql@^12.0.1` | Real-Postgres repo tests for the two new tables (SQL never mocked). Already installed. |
| msw | `msw@^2.14.6` | Network-layer test for the VXVCLS fetch path (reuses the existing FRED adapter test harness). Already installed. |

## Installation

```bash
# Nothing to install. v1.3 adds zero npm packages.
```

The only "install-shaped" change for VIX3M ingestion is one line:

```ts
// packages/core/src/journal/application/fetchMacroSeries.ts
export const DEFAULT_FRED_SERIES_IDS: ReadonlyArray<string> = [
  "DFF", "DGS1MO", "DGS3MO", "SOFR", "T10Y2Y", "T10Y3M", "VIXCLS",
  "VXVCLS", // ← add: CBOE S&P 500 3-Month Volatility Index (VIX3M)
];
```

Plus its memory-twin seed in the fetchMacroSeries test and a contract-test row (architecture
rule 8), then two Drizzle migrations for the new tables. No `package.json` edit.

## Verified: the VIX3M FRED series (question a)

| Question | Answer | Evidence (live, 2026-07-09) |
|----------|--------|------------------------------|
| Exact FRED series id for the 3-month VIX? | **`VXVCLS`** — "CBOE S&P 500 3-Month Volatility Index" | FRED public CSV `fredgraph.csv?id=VXVCLS` → **HTTP 200**, 4852 daily rows, 2007-12-04 → **2026-07-07 = 19.01**. |
| Is VXVCLS discontinued? | **No — live and current.** | Latest observation is one trading day old; series still updating daily. |
| The "renamed" history? | The **underlying CBOE index** ticker changed **VXV → VIX3M in Sept 2017**, but **FRED kept the legacy `VXVCLS` id**. | `VIX3M`, `VIX3MCLS`, `VXV` all return **HTTP 404** on FRED — they do not exist as FRED series. |
| Unit handling? | RAW index level, **no /100** — identical to the already-ingested `VIXCLS`. | The adapter's D-14 raw-value path (VIXCLS is stored raw) is already correct for VXVCLS. |

**Integration caveat for the ratio gate:** the VIX/VIX3M gate must read `VIXCLS` and `VXVCLS`
from the **same `macro_observations.date`**. Both are daily FRED series on the same NYSE
publication calendar (both carry blank/`.` rows on half-days like 2026-07-03, already filtered
by the adapter's `.` guard), so joining on `date` avoids comparing a stale VXVCLS against a
fresh VIXCLS. The evening `fetch-rates` run persists only the latest non-`.` row per series —
on a normal weekday both land the same date.

> Note: the brief's phrase "fredapi in worker" is imprecise — the worker has **no `fredapi`
> Python dependency**. FRED is fetched by a plain `fetch()`-based TS adapter
> (`packages/adapters/src/http/fred.ts`). Nothing Python-side changes for VIX3M.

## Backtest harness — library needed? (question b)

**None. Pure TS is sufficient and correct.**

- **Replay** = iterate stored `leg_observations` cohorts + `picker_snapshot` history through
  the existing `scoreCalendarCandidates` engine, scored against `calendar_events.realizedPnl`.
  This is DB reads + existing domain code — a backtest *framework* would wrap the engine we
  already have.
- **Metrics** (per-rule predictive power: rank correlation / information coefficient /
  hit-rate) are ~15–30 lines of pure TS in a new
  `packages/core/src/picker/domain/backtest-metrics.ts`, reusing `percentileRank` and the
  `realizedVol` stdev pattern, property-tested with the already-installed fast-check.

## Storage shape — new tables vs JSONB (question c)

**Two new small tables**, both following the repo's established append-history pattern.
Not JSONB bolted onto `calendar_snapshots`; not a wide normalized metric schema.

**1. `exit_advisories`** — the exit advisor's per-cycle verdicts.
- Append-only; time-leading composite PK **`(observed_at, calendar_id)`**; columns
  `verdict` (text enum `HOLD|TAKE|STOP|ROLL|EXIT_PRE_EVENT`) + `detail` JSONB (triggers
  fired, metric snapshot, reason strings). `onConflictDoNothing` → idempotent per chain
  cycle, exactly like `skew_observations` / `term_structure_observations`.
- **Per-(calendar, instant) rows, not a whole-blob-per-instant** (unlike `picker_snapshot`):
  the held-positions panel and MCP tool ask "this calendar's verdict now / its history" — a
  per-calendar row is directly queryable; a blob would force JSON extraction on every read.
- **New table, not JSONB on `calendar_snapshots`:** that table is journal data — RTH-gated,
  rebuilt from fills, "never hand-edited". Exit advice is a derived 24/7 read-only
  computation with a different lifecycle. Keeping it separate preserves JRNL integrity and
  matches the one-table-per-derived-concern pattern (skew / risk-reversal / term-structure /
  gex / picker each got their own).

**2. `backtest_runs`** — evidence trail for weight promote/demote.
- Append-only; PK `run_at` timestamptz (or `id`); one **`report` JSONB blob** = the whole
  typed `BacktestReport` (params, per-rule metrics array, summary), **Zod-parsed on write AND
  read** at the adapter boundary. This is the `picker_snapshot` pattern verbatim.
- JSONB beats a normalized schema here: low volume (a handful of runs), heterogeneous nested
  per-rule metrics, and the append-history lets a weight change cite the run that justified it
  ("promote/demote with evidence" — the milestone requirement).
- **Ponytail note:** if you only ever act on the latest report and never query run history,
  skip the table and emit a report artifact. Since the milestone wants *auditable* weight
  changes, the one thin JSONB table is the minimal persistent form — recommend keeping it.

Both tables need the full port kit (architecture rules 8–9): Drizzle table + idempotent
migration (0018+), a Zod contract for the JSONB shape, an in-memory twin + testcontainers
repo test, and HTTP + MCP read surfaces. All with the existing stack.

## Alternatives Considered

| Recommended | Alternative | When the alternative would win |
|-------------|-------------|--------------------------------|
| Pure-TS metrics reusing `percentileRank` / `realizedVol` pattern | `simple-statistics`, `jStat`, `ml-*` | Never here — the needed functions are ~30 lines already patterned in-repo; a dep pays off only at a large, varied stats surface. |
| Replay through the existing engine | A backtesting framework (backtrader, zipline, vectorbt) | Never — those are Python, heavyweight, and would wrap an engine we already own; wrong runtime for a Bun/TS monorepo. |
| Postgres + Drizzle grouping/aggregation | danfojs / arquero dataframes | Never — Postgres already groups/aggregates the cohorts; a dataframe layer duplicates it in memory. |
| Two new append-history tables | JSONB columns on `calendar_snapshots` | Never — pollutes fills-derived journal data with derived advice and breaks the RTH-gate lifecycle. |
| `VXVCLS` via existing FRED adapter | A dedicated FRED client (`fredapi` py, `node-fred`) | Never — the parameterized TS adapter already fetches any series id; a client lib adds a dependency for a URL we already build. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| FRED series id `VIX3M` / `VIX3MCLS` / `VXV` | **404 on FRED** — they don't exist as FRED series (the VIX3M name is the CBOE ticker, not the FRED id) | `VXVCLS` |
| `fredapi` (Python) or any Node FRED client | The worker fetches FRED with a plain TS `fetch()` adapter that already parameterizes by series id | Add `"VXVCLS"` to `DEFAULT_FRED_SERIES_IDS` |
| Python backtest frameworks (backtrader / zipline / vectorbt) | Wrong runtime; heavyweight; re-wraps the picker engine we already own | Replay stored chains through `scoreCalendarCandidates` |
| TS stats libs (simple-statistics / jStat / ml-matrix) | ~30 lines of correlation/rank already patterned in-repo; violates the zero-new-deps rule | `percentileRank` + a small `backtest-metrics.ts`, fast-check-tested |
| Dataframe libs (danfojs / arquero) | Postgres + Drizzle already group and aggregate cohorts | SQL aggregation + Drizzle repos |
| JSONB advice columns on `calendar_snapshots` | Journal data is RTH-gated and rebuilt from fills; derived advice has a different lifecycle | New `exit_advisories` + `backtest_runs` tables |

## Stack Patterns by Variant

**Exit advisor (per-open-calendar, each cycle):**
- New pg-boss handler on the existing single-trigger chain after `compute-picker`.
- New exit-rule registry mirroring `PICKER_RULES` (gate/score rows) in
  `packages/core/src/picker/domain/` (or a sibling `exit/` context).
- Storage: `exit_advisories` (per-calendar append-history, above). Read surfaces: held-positions
  panel (HTTP) + MCP tool.

**PICK-04 backtest (on-demand):**
- On-demand CLI in `apps/worker` (the `backfill-transactions` precedent — not a pg-boss job),
  or a `trigger_job`-style manual run.
- Metrics in a pure-domain `backtest-metrics.ts`; oracle = `calendar_events.realizedPnl`.
- Storage: `backtest_runs` JSONB report (above).

**VIX3M / playbook gates:**
- `"VXVCLS"` into `DEFAULT_FRED_SERIES_IDS`; ratio + VIX-level gates read `macro_observations`
  by same-date join; new gate rows in the picker registry (the deferred `VIX < 25` /
  `VIX/VIX3M < 0.95` gates named in `docs/architecture/picker-rules.md`).

## Version Compatibility

| Package | Version | Notes |
|---------|---------|-------|
| drizzle-orm / drizzle-kit | `^0.45.2` / `^0.31.10` | New tables use the same builders as the 17 existing tables — no version bump. |
| zod | `^4.4.3` | JSONB contracts use the same `z.infer` boundary parsing as `picker_snapshot`. |
| pg-boss | `^12.18.3` | Exit-advice handler uses the existing `singletonKey` dedupe + array-guard (Pitfall 2) pattern. |
| vitest / fast-check | `^4.1.8` / `^4.8.0` | Backtest metric property tests use the installed fast-check. |
| testcontainers | `^12.0.1` | New repo tests reuse the existing testcontainers Postgres harness. |

**No new packages → no new compatibility surface.**

## Sources

- FRED `fredgraph.csv?id=VXVCLS` — direct fetch, 2026-07-09: HTTP 200, 4852 rows, 2007-12-04 → 2026-07-07 (19.01), still updating. **HIGH** (authoritative source, verified).
- FRED `fredgraph.csv?id={VIX3M,VIX3MCLS,VXV}` — direct fetch, 2026-07-09: all HTTP 404. **HIGH** (authoritative, verified).
- [CBOE S&P 500 3-Month Volatility Index (VXVCLS) | FRED](https://fred.stlouisfed.org/series/VXVCLS) — series title + active status. **HIGH**.
- [CBOE Volatility Index: VIX (VIXCLS) | FRED](https://fred.stlouisfed.org/series/VIXCLS) — confirms VIXCLS (already ingested) is the sibling series. **HIGH**.
- [Cboe VIX3M dashboard](https://www.cboe.com/us/indices/dashboard/vix3m/) — confirms the underlying index is now branded VIX3M (formerly VXV). **HIGH**.
- Codebase (in-repo, read 2026-07-09): `packages/adapters/src/http/fred.ts` (parameterized adapter, raw value), `packages/core/src/journal/application/fetchMacroSeries.ts` (`DEFAULT_FRED_SERIES_IDS`), `packages/adapters/src/postgres/schema.ts` (`macro_observations`, `picker_snapshot`, analytics-table pattern), `packages/shared/src/percentile-rank.ts`, `packages/core/src/picker/domain/realized-vol.ts`. **HIGH** (direct source).

---
*Stack research for: SPX calendar-spread trading system — v1.3 Picker Intelligence*
*Researched: 2026-07-09*
