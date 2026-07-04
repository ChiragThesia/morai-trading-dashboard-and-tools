# Phase 19: Picker Engine + Economic Events - Research

**Researched:** 2026-07-04
**Domain:** Options-scoring domain logic (hexagonal core) + a new external economic-calendar adapter, wired into the existing precompute/HTTP/MCP pipeline
**Confidence:** MEDIUM (engine port: HIGH — mockup + production BSM code both read directly; economic-events source: MEDIUM — resolved via cross-checked web search, official FRED/Fed docs pages blocked this session by bot-detection)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Strikes = delta-targeted OTM puts — ATM + ~30Δ/20Δ/10Δ (research criterion 5: parameterize by delta, not raw strike; CML precedent). GEX proximity stays a scoring bonus (criterion 7). Exact delta rungs = planner.
- **D-02:** Expiry pairing — front leg ≥21 DTE at entry (typically 21–30), flexible; back leg ≥21 days beyond front. Planner picks a concrete default grid; keep it tunable.
- **D-03:** Response carries top-N ranked 6–8 by score (matches the playground-v4 mockup card count). Planner sets the exact cap.
- **D-04:** Precomputed, chain-triggered job. A `compute-picker` job runs after `compute-gex-snapshot`, scores over the latest chain + GEX snapshot, and writes a `picker_snapshot` row. HTTP route + MCP tool read the latest row. Staleness = the stored snapshot's `observedAt`.
- **D-05:** `picker_snapshot` stores the whole `pickerSnapshotResponse` as one Zod-validated JSONB blob.
- **D-06:** Keep history — append one blob per `observedAt` (~13/day RTH). Route reads latest.
- **D-07:** The mockup `buildCandidates()` (playground-v4.html lines 246–284) IS the engine to port + generalize into `packages/core` (generalize hardcoded strikes/spot to D-01's delta-targeted selection over the live chain; reuse `@morai/quant` BSM for greeks/pricing).
- **D-08:** Encode the mockup weights 40 slope / 25 fwdEdge / 15 gexFit / 10 event / 10 beVsEm as documented named-constant tunables ("not empirically calibrated — tune later PICK-04/05"). No reweighting up front.
- **D-09:** Replace the faked 5th term. Phase 19 computes the real BE-vs-EM ratio (breakeven-width ÷ ±1σ expected-move) with a documented-tunable threshold. Only the threshold is uncalibrated, not the metric.
- **D-10:** A leg "spans" an event when the event date falls in `(today, legExpiry]` — the whole remaining life. No extra tunable window param.
- **D-11:** Front-leg-only penalty (criterion 4). Default: penalize all three FOMC/CPI/NFP with documented per-event tunable weights (default 0.5, gentler for NFP allowed). Planner sets which events penalize; default all-three-tunable.
- **D-12 (RESEARCH REQUIRED):** Do NOT settle for a hand-edited static FOMC seed without first researching a programmatic source. Prefer an authoritative external feed → new DB table (IANA tz). A static hand-maintained FOMC seed is the FALLBACK only if no reliable programmatic source exists.
- **D-13:** New economic-events table + adapter (NOT the existing `calendar_events`, which is the journal's OPEN/CLOSE/ROLL events). Follow the `macro_observations`/`fetch-cot` adapter+cron patterns.
- **D-14:** Cron cadence weekly (default Friday, like `fetch-cot`).
- **D-15:** Add a `source` field to `pickerSnapshotResponse` — additive, enum `schwab | cboe`.
- **D-16:** Per-card staleness (each candidate card shows the snapshot's as-of + source).
- **D-17:** When the GEX snapshot is stale/missing or the econ-events table is empty/stale at compute time, tag it — never silent. Additive snapshot-level status fields (`gexContextStatus`/`eventsContextStatus`: `ok | stale | missing`); the affected term contributes 0 and the UI shows "unavailable".
- **D-18:** Distinct honest empty messages — cold-start vs. zero-candidates-passed-filter.
- **D-19:** Loading + fetch-error mirror the existing react-query hook pattern (`useCot`/`useMacro`).

### Claude's Discretion

- Exact delta rungs (D-01), the concrete default DTE grid (D-02), the top-N cap value (D-03), score-tie determinism (stable sort by id), and fixture retention-for-tests.
- Which events penalize + exact per-event penalty weights (D-11) — default all-three-tunable.
- Cron cadence exact time (D-14) — default weekly Friday like `fetch-cot`.
- `get_picker_candidates` MCP return mirrors the HTTP `pickerSnapshotResponse` (MCP-02 one-schema) — trimmed-text-summary alternative dropped.
- Precise `picker_snapshot` DDL, index, and pruning policy for the append-history table (D-06).

### Deferred Ideas (OUT OF SCOPE)

- **PICK-04** — slope-signal backtest over `leg_observations` (validate Vasquez on SPX time-series). The append-history `picker_snapshot` table (D-06) is the free data seed for it. Not this phase.
- **PICK-05** — event-premium weighting by surprise magnitude. Event terms ship as simple flags/penalties (D-10/D-11) this phase.
- **Separate economic-events HTTP/MCP surface** — explicitly out of scope for v1.2 (PICK-03: internal-only, flags ride in the candidates payload).
- **Screener filters** (strike-view all/ATM/put-wall, DTE-range user filter) — Phase-18 deferred; revisit once live candidates exist.
- **Empirical calibration** of the weights + BE-vs-EM/θ/vega thresholds — research backlog; Phase 19 ships documented tunables (D-08/D-09), not validated numbers.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PICK-01 | `scoreCalendarCandidates` (core) scores put-calendar candidates over the latest chain snapshot using the 8 verified criteria; REFUTED criteria absent; FwdIV radicand<0 → tagged guard; contract carries `observedAt`/`source` | Mockup `buildCandidates()`/`fwdIV()`/`legEvents()` fully read and mapped to production BSM (`@morai/quant`) + existing `LegObsForGex`-shaped chain read port. See Architecture Patterns + Code Examples. |
| PICK-02 | Query scored candidates via HTTP route + MCP tool; Analyzer UI swaps fixtures for real data; staleness visible everywhere | `gex.routes.ts` + `getGex.ts` + `ForRunningGetGex` give the exact route/use-case/port template to mirror for `picker.routes.ts` + `get_picker_candidates`. `useCot.ts` gives the exact react-query hook template for `usePicker`. |
| PICK-03 | Economic-events context (FOMC/CPI/NFP dates, IANA tz, cron-refreshed) feeds per-leg event flags; internal-only | D-12 primary research deliverable below: FRED `release/dates` wins for CPI+NFP; a maintained seed is the sanctioned fallback for FOMC (no clean programmatic feed exists). |

</phase_requirements>

## Summary

Phase 19 has two independent deliverables of very different research risk. The **scoring engine** (PICK-01) is low-risk: `mockups/playground-v4.html`'s `buildCandidates()` is a complete, working reference implementation (fwdIV identity + guard, term-slope, event penalty, GEX-fit tiers, dedupe, top-8) that only needs (a) its own simplified BSM swapped for the production `@morai/quant` `bsmPrice`/`bsmGreeks` (which carries a dividend yield `q` and a 365.25-day theta basis the mockup doesn't have), and (b) its hardcoded strike/spot/IV constants replaced with a live chain read using the same `LegObsForGex`-shaped port `compute-gex-snapshot` already uses. This is a straightforward "generalize the pattern that already worked once" job with high confidence.

The **economic-events source** (PICK-03, D-12) is the genuinely research-gated piece, and it resolves cleanly to a **split-source design**: **Schwab has no economic-calendar endpoint at all** (its market-data surface is chains/quotes/streaming only — confirmed by search, matches the repo's own adapter scope), so it is eliminated as a candidate entirely. **FRED wins for CPI and NFP** via the `fred/release/dates?release_id=N` endpoint (release_id 10 = CPI, release_id 50 = Employment Situation/NFP), which does return forward-scheduled release dates when queried with `include_release_dates_with_no_data=true`. **FOMC has no clean programmatic feed** — the Federal Reserve publishes an official calendar page and a general RSS feed, but no dedicated machine-readable FOMC-specific API/ICS. Per D-12's own instruction, a small maintained FOMC seed (refreshed against the official calendar, published a year+ ahead and rarely revised) is the sanctioned fallback for that one event type only — CPI and NFP are NOT hand-seeded.

**Primary recommendation:** Port `buildCandidates()`'s scoring logic verbatim into `packages/core/src/picker/domain/`, re-pricing through `@morai/quant`'s `bsmPrice`/`bsmGreeks` instead of the mockup's private BSM; build ONE new economic-events adapter that combines a FRED `release/dates` HTTP client (CPI + NFP) with a small hardcoded/seeded FOMC table, unioned into one `economic_events` table read by the scoring engine — never expose the split as two data paths to callers.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Candidate scoring math (fwdIV, slope, gexFit, event penalty, beVsEm, weights) | Core (domain) | — | Pure numerical logic, zero I/O — belongs in `packages/core/src/picker/domain/` per hexagon law |
| Candidate universe construction (delta-targeted strike/expiry selection over the chain) | Core (application use-case) | Adapters (chain read) | Reads the existing `LegObsForGex`-shaped port, applies D-01/D-02 selection rules, then calls domain scoring |
| GEX context read | Core (application) | Adapters/Postgres (existing `ForReadingGexSnapshot`) | Already exists (Phase 8) — reuse, don't rebuild |
| Economic-events fetch (FRED HTTP + FOMC seed) | Adapters (`packages/adapters/src/http`, `.../memory`, `.../postgres`) | — | External HTTP + persistence — adapters own I/O, never core |
| `compute-picker` job orchestration | Worker (`apps/worker`) | Core (use-case it calls) | Chain-triggered job handler; thin wiring only, calls the core use-case |
| `GET /api/picker/candidates` route | Server (`apps/server`) | Core (`ForRunningGetPicker`-style port) | Thin Hono router, Zod-parse-through, mirrors `gex.routes.ts` |
| `get_picker_candidates` MCP tool | Server (`apps/server/src/adapters/mcp`) | Core (same port as HTTP) | Same use-case, second driving adapter (MCP-02: one schema) |
| Analyzer UI fixture→live swap, loading/error/empty states | Web (`apps/web`) | Contracts (`pickerSnapshotResponse`) | React Query hook (`usePicker`) mirrors `useCot`/`useMacro`; UI is pure-render, never recomputes scores |

## Standard Stack

### Core

No new runtime dependencies are added or needed (v1.2 zero-new-deps lock is fully satisfiable):

| Library | Version (confirmed in repo) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@morai/quant` | workspace:* (in-repo) | `bsmPrice`/`bsmGreeks`/`bsmVega` — the production BSM engine | Already the sole BSM engine for the whole codebase (Overview/Analyzer); the mockup's private BSM must NOT ship — D-07 explicitly says reuse `@morai/quant` |
| `zod` | ^4.4.3 (contracts/adapters/server/worker) | Parse-don't-cast at every boundary (economic-events HTTP response, `picker_snapshot` JSONB blob, HTTP route body) | Project-wide convention (typescript.md rule) |
| `pg-boss` | ^12.18.3 | `compute-picker` job queue + weekly economic-events cron | Already the sole job runner; `fetch-cot`'s weekly-Friday registration in `apps/worker/src/schedule.ts` is the direct template |
| `drizzle-orm` | ^0.45.2 | `picker_snapshot` + `economic_events` table access | Confined to `packages/adapters/src/postgres/` per architecture-boundaries.md §4 |
| `@tanstack/react-query` | ^5.101.1 (apps/web) | `usePicker` hook (loading/error/staleTime) | Already used by `useCot`/`useMacro`/`useGex` — D-19 mandates mirroring this exact pattern |
| `msw` | ^2.14.6 (adapters devDependency) | Mock the FRED `release/dates` HTTP call in tests | Already used for `fred.test.ts`; identical pattern applies to the new events adapter |
| `@testcontainers/postgresql` / `testcontainers` | ^12.0.1 | Real-Postgres tests for the two new repos (`economic_events`, `picker_snapshot`) | Project rule (tdd.md): "Postgres repos → testcontainers against real Postgres. SQL is never mocked." |
| `fast-check` | ^4.8.0 (root devDependency) | Property tests for FwdIV guard, scoring monotonicity, BE-vs-EM ratio | Project rule (tdd.md): "Numerical code → fast-check property tests" |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| native `Date` + ISO string comparison | n/a (built-in) | Event-date "spans" comparison (D-10: `(today, legExpiry]`) | **No date/timezone library is needed or should be added.** See Pitfall "IANA timezone without a library" below — the comparisons required this phase are calendar-day string comparisons, not zoned-datetime arithmetic. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native ISO-date-string comparison for event windows | `date-fns-tz` / `luxon` (adding a new dependency) | Violates the v1.2 zero-new-deps lock for zero benefit — the only operation needed is calendar-day interval membership, which plain string/Date comparison already does correctly once dates are stored as ET calendar days (see Pitfalls) |
| One `economic_events` table sourced from FRED+seed, unioned at write time | Two separate tables/adapters (one FRED-backed, one static) exposed separately to the scoring engine | The engine and D-17's `eventsContextStatus` need ONE staleness signal; splitting sources at the read boundary would force the scoring engine to reason about two independent freshness states for what the contract treats as one `events` array |
| FRED `release/dates` for CPI/NFP | A third-party "economic calendar" scraping service (e.g. ForexFactory, Investing.com) | Explicitly rejected by user intent ("maybe Schwab can give us this... proper external module") — scraping a non-API commercial calendar site is fragile and was not what the user asked to research; FRED is the US-government-published, already-integrated (`fred.ts` exists), authoritative source for the two data-driven releases |

**Installation:**
```bash
# No new packages — reuse existing workspace deps (@morai/quant, zod, pg-boss, drizzle-orm,
# @tanstack/react-query, msw, testcontainers, fast-check are all already installed).
```

**Version verification:** All versions above were read directly from the repo's `package.json` files (root, `apps/web`, `apps/server`, `apps/worker`, `packages/adapters`, `packages/contracts`) via `Read`/`Bash` this session — `[VERIFIED: repo package.json]`, not a registry lookup, since nothing new is being installed.

## Package Legitimacy Audit

**Not applicable — zero new dependencies this phase (v1.2 lock).** No `npm view` / registry check is needed. If a future phase considers a real economic-calendar package (e.g. an npm wrapper around FRED), it must go through the full Package Legitimacy Gate before use; this phase implements the FRED HTTP call directly (mirroring the existing hand-rolled `fred.ts` adapter) rather than depending on a wrapper package.

**Packages removed due to [SLOP] verdict:** none — no packages considered.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────┐
                          │  FRED release/dates (HTTP)   │  CPI (release_id=10)
                          │  api.stlouisfed.org          │  NFP (release_id=50)
                          └──────────────┬───────────────┘
                                         │ weekly cron (Fri, fetch-economic-events)
                                         ▼
                    ┌───────────────────────────────────────┐
   FOMC seed table  │  fetch-economic-events job (worker)   │
   (maintained,     │  merges FRED rows + FOMC seed rows     │
   refreshed        │  → economic_events (Postgres)          │
   against official └──────────────────┬─────────────────────┘
   Fed calendar)                       │ read at compute time
                                        ▼
┌──────────────┐   ┌──────────────────────────────────────────┐   ┌────────────────────┐
│ leg_observations│→│  compute-picker job (worker, chain-       │←──│ gex_snapshot (latest)│
│ (latest chain,  │  triggered AFTER compute-gex-snapshot)      │   │ (existing, Phase 8)  │
│ ×1000 strikes)   │                                            │   └────────────────────┘
└──────────────┘   │  1. read chain (LegObsForGex-shaped port) │
                    │  2. select delta-targeted OTM put strikes │
                    │     × front/back expiry pairs (D-01/D-02) │
                    │  3. price via @morai/quant bsmPrice/Greeks│
                    │  4. score via scoreCalendarCandidates     │
                    │     (core domain: fwdIV/slope/gexFit/     │
                    │     eventAdjustment/beVsEm, D-07/D-08/D-09)│
                    │  5. tag gexContextStatus/eventsContextStatus
                    │     when GEX/events are stale/missing (D-17)
                    │  6. persist ONE picker_snapshot JSONB row │
                    │     (append-history, D-05/D-06)            │
                    └──────────────────┬─────────────────────────┘
                                       │ read latest row only
                     ┌─────────────────┴──────────────────┐
                     ▼                                     ▼
        GET /api/picker/candidates              get_picker_candidates (MCP)
        (Hono route, mirrors gex.routes.ts)      (same use-case, 2nd driving adapter)
                     │                                     │
                     └───────────────┬─────────────────────┘
                                     ▼
                     Analyzer.tsx (usePicker react-query hook,
                     mirrors useCot/useMacro — loading skeleton,
                     error+retry, distinct cold-start/empty-filter
                     messages D-18, per-card as-of+source D-16)
```

### Recommended Project Structure

```
packages/core/src/picker/
├── domain/
│   ├── fwd-iv.ts              # fwdIv(tf, ivf, tb, ivb) → Result-style guard, never NaN
│   ├── fwd-iv.test.ts
│   ├── scoring.ts              # scoreCalendarCandidates: the 5 weighted criteria (D-07/D-08)
│   ├── scoring.test.ts         # fast-check property tests (weights sum to 100, guard never NaN)
│   ├── candidate-selection.ts  # delta-targeted strike/expiry pairing over the chain (D-01/D-02)
│   └── candidate-selection.test.ts
├── application/
│   ├── ports.ts                 # ForReadingChainForPicker (reuse LegObsForGex shape),
│   │                            # ForReadingEconomicEvents, ForPersistingPickerSnapshot,
│   │                            # ForReadingPickerSnapshot, ForRunningComputePicker, ForRunningGetPicker
│   ├── computePickerSnapshot.ts # the use-case: read chain+gex+events → score → persist (mirrors computeGexSnapshot.ts)
│   ├── computePickerSnapshot.test.ts
│   ├── getPicker.ts             # thin forwarder (mirrors getGex.ts)
│   └── getPicker.test.ts

packages/adapters/src/http/
├── economic-events.ts           # FRED release/dates client (CPI + NFP) + FOMC seed merge
├── economic-events.test.ts      # msw-mocked

packages/adapters/src/memory/
├── economic-events.ts           # in-memory twin
├── economic-events.contract.test.ts
├── picker-snapshot.ts           # in-memory twin
├── picker-snapshot.contract.test.ts

packages/adapters/src/postgres/
├── migrations/00XX_economic_events.sql
├── migrations/00XX_picker_snapshot.sql
├── repos/economic-events.ts
├── repos/economic-events.contract.test.ts
├── repos/picker-snapshot.ts
├── repos/picker-snapshot.contract.test.ts

apps/server/src/adapters/http/picker.routes.ts       # mirrors gex.routes.ts
apps/server/src/adapters/mcp/tools.ts                # + get_picker_candidates entry
apps/worker/src/schedule.ts                           # + compute-picker (chain-triggered), + fetch-economic-events (weekly cron)

apps/web/src/hooks/usePicker.ts                       # mirrors useCot.ts
apps/web/src/screens/Analyzer.tsx                     # fixture import → usePicker()
```

### Pattern 1: FwdIV forward-variance identity with never-NaN guard

**What:** `FwdIV = sqrt((T2·σ2² − T1·σ1²)/(T2 − T1))`, T in DTE. When the radicand is negative (inverted term structure), return a tagged guard result instead of `NaN`.

**When to use:** Every candidate's `fwdIv`/`fwdIvGuard`/`fwdEdge` computation (criterion 1, PICK-01's own success-criterion wording).

**Example:**
```typescript
// Source: mockups/playground-v4.html lines 238-241 (buildCandidates reference engine, D-07)
// generalized into a Result-shaped never-NaN guard for packages/core
function fwdIV(tf, ivf, tb, ivb) { // criterion 1 — forward variance identity, T in DTE
  const rad=(tb*ivb*ivb - tf*ivf*ivf)/(tb-tf);
  return rad>0?Math.sqrt(rad):null; // guard: inverted structure
}
```
Port this AS the domain function (rename to `computeFwdIv`, return `{ fwdIv: number; guard: "ok" }` or `{ fwdIv: null; guard: "inverted" }` matching the `pickerCandidate.fwdIv`/`fwdIvGuard` contract fields already frozen in `packages/contracts/src/picker.ts`). The mockup's `rad>0` check is already correct — do not "fix" it to `>=0`, since `rad===0` degenerately implies `fwdIv=0`, which the mockup and contract both treat as a valid (if edge-case) `ok` result.

### Pattern 2: Precompute-then-read (chain-triggered job, thin routes)

**What:** Heavy scoring runs as a chain-triggered pg-boss job that writes one snapshot row; HTTP route + MCP tool are pure readers of the latest row, never recomputing.

**When to use:** `compute-picker` (D-04) — this is the EXACT pattern `compute-gex-snapshot`/`getGex`/`gex.routes.ts` already established in Phase 8.

**Example:**
```typescript
// Source: packages/core/src/analytics/application/getGex.ts (existing, verbatim pattern to mirror)
export type GetGexDeps = { readonly readGexSnapshot: ForReadingGexSnapshot };
export type ForRunningGetGex = () => Promise<Result<GexSnapshotRow | null, StorageError>>;
export function makeGetGexUseCase(deps: GetGexDeps): ForRunningGetGex {
  return () => deps.readGexSnapshot();
}
```
`getPicker.ts` is a one-line copy of this shape against `ForReadingPickerSnapshot`. `picker.routes.ts` is a one-line copy of `gex.routes.ts`'s route body (call use-case → `result.value === null` → 404 `{error:"no-snapshot"}` → else `pickerSnapshotResponse.parse(...)`).

### Pattern 3: Economic-events adapter mirrors the `macro_observations`/`fetch-cot` trio

**What:** New driven-port type + Postgres table + memory twin + weekly pg-boss cron, following the exact shape of the existing `macro_observations` adapter and `fetch-cot` cron registration.

**Example:**
```sql
-- Source: packages/adapters/src/postgres/migrations/0013_macro_observations.sql (existing, template)
CREATE TABLE "macro_observations" (
  "date" date NOT NULL,
  "series_id" text NOT NULL,
  "value" numeric NOT NULL,
  "source" text NOT NULL,
  CONSTRAINT "macro_observations_date_series_id_pk" PRIMARY KEY("date","series_id")
);
```
`economic_events` follows the same date-typed-column shape: `event_date date NOT NULL`, `event_name text NOT NULL` (enum-like values `FOMC | CPI | NFP`), `source text NOT NULL` (`fred | seed`), composite PK `(event_date, event_name)`. **`event_date` is a plain `date` column — never `timestamptz`** (see Pitfall below on why this sidesteps the IANA/DST question entirely for this phase's needs).

```typescript
// Source: apps/worker/src/schedule.ts (existing, fetch-cot cron — the D-14 template)
await boss.schedule(
  "fetch-cot",
  "0 17 * * 5", // weekly Friday 17:00 ET (after market close, D-07)
  null,
  { tz: "America/New_York" },
);
```
`fetch-economic-events` registers identically: `"0 17 * * 5"` (or any weekly slot — D-14 leaves the exact time to the planner), `{ tz: "America/New_York" }`.

### Pattern 4: Additive, non-breaking contract fields (D-15/D-17)

**What:** `pickerSnapshotResponse`/`pickerCandidate` are Phase-18-frozen; Phase 19 only ADDS fields (`source`, `gexContextStatus`, `eventsContextStatus`), never renames/removes existing ones (MCP-02 + the fixture-swap-is-import-only promise).

**Example:**
```typescript
// packages/contracts/src/picker.ts — additive edit, not a rewrite
export const pickerSnapshotResponse = z.object({
  asOf: z.string(),
  spot: z.number(),
  source: z.enum(["schwab", "cboe"]),               // NEW (D-15)
  gexContextStatus: z.enum(["ok", "stale", "missing"]), // NEW (D-17)
  eventsContextStatus: z.enum(["ok", "stale", "missing"]), // NEW (D-17)
  termStructure: z.array(termStructurePoint),
  gex: pickerGexContext,
  events: z.array(pickerEvent),
  candidates: z.array(pickerCandidate),
});
```
The Phase-18 fixture (`packages/contracts/src/__fixtures__/picker-candidates.fixture.ts`) must be updated in the same PR to supply these new required fields (existing fixture consumers — `Analyzer.tsx` — otherwise fail typecheck, per architecture-boundaries.md's "one-sided field rename fails typecheck" discipline already noted in `picker.ts`'s own comments).

### Anti-Patterns to Avoid

- **Reimplementing BSM inside `packages/core/src/picker/`:** The mockup's `putPrice`/`putGreeks`/`normCdf` are throwaway prototype math (no dividend yield, a cruder 5-term `normCdf`, T-in-days-over-365 not 365.25). Production code MUST call `@morai/quant`'s `bsmPrice`/`bsmGreeks` — a second BSM implementation is exactly the "Don't Hand-Roll" trap this project has already paid down once (see `packages/core/.../bsm.ts` re-export-shim precedent from 17-01).
- **Storing economic-event dates as `timestamptz`:** Converts a calendar day into a UTC instant, reopening the exact CBOE-UTC bug class (STATE.md risk #4) in the opposite direction. Use a plain `date` column and ISO-string interval comparisons (see Pitfalls).
- **Exposing FRED vs. FOMC-seed as two read paths:** The contract's `events` array and `eventsContextStatus` are singular — union the two sources inside the adapter, never let the scoring engine or the UI know there are two origins.
- **Faking `beVsEm` again with a strike-based proxy:** D-09 explicitly forbids shipping the mockup's `K===7500?1:0.7` under a name that claims to measure breakeven-vs-expected-move. Compute the real ratio (see Open Questions for the two viable computation approaches).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BSM pricing/greeks for the candidate legs | A second `putPrice`/`putGreeks`/`normCdf` trio (mockup style) | `@morai/quant` `bsmPrice`/`bsmGreeks`/`bsmVega` | Already the single source of truth (Overview, Analyzer payoff, IV inversion all call it); a second implementation would silently diverge in dividend-yield handling and day-count basis |
| FOMC/CPI/NFP date storage across a DST boundary | A new timezone-conversion utility, or adding `luxon`/`date-fns-tz` | Plain `date` column + ISO string comparison | The only operation needed this phase (D-10's "spans" test) is calendar-day interval membership — zoned-datetime math is unneeded complexity that also violates zero-new-deps |
| Breakeven-price solving for a calendar spread | An ad-hoc closed-form breakeven formula (none exists cleanly for calendars — payoff is not linear near breakeven) | A numeric bisection over spot, mirroring `packages/core/src/journal/domain/iv-inversion.ts`'s bisection-fallback pattern (Result<T,E>, hard iteration cap) | The project already has one battle-tested numeric-solve-with-guard precedent (IV inversion); reuse the pattern rather than inventing a fragile closed-form |
| Delta-targeted strike selection | A hand-rolled "find strike closest to X delta" linear scan repeated ad hoc per call site | One `candidate-selection.ts` domain function that scans the chain once per front/back expiry pair and returns the nearest-delta strikes for the configured rungs (ATM/30Δ/20Δ/10Δ) | Centralizes the D-01 selection rule so it's independently unit-testable and reusable if PICK-04's backtest needs the same universe later |

**Key insight:** Every piece of numerical/domain logic this phase needs already has a working reference implementation somewhere in this repo (the mockup for scoring, `@morai/quant` for pricing, `iv-inversion.ts` for numeric-solve-with-guard patterns, `computeGexSnapshot.ts`/`getGex.ts` for the precompute-then-read shape). The job is disciplined porting and generalizing, not invention — the highest risk is accidentally reintroducing a *second* implementation of something that already exists once (BSM, bisection, the react-query hook shape).

## Common Pitfalls

### Pitfall 1: Strike-unit mismatch (×1000 int convention)

**What goes wrong:** The mockup's `buildCandidates()` uses raw strike numbers (`7500`, `7450`, `7400`). Production `leg_observations`/`LegObsForGex.strike` uses the repo's established ×1000 integer convention (`7500000` = strike 7500, per `ports.ts`'s own comment and the GEX code's `strikeGex`/`buildProfile`).

**Why it happens:** Copy-pasting the mockup's scoring math without converting the chain-read boundary.

**How to avoid:** Convert `LegObsForGex.strike / 1000` at the candidate-selection boundary (application layer), before any domain math touches it. Contract's `pickerCandidateLeg.strike` is already documented as "Strike in points (e.g. 7500.0)" — i.e. the converted, human-readable form — so the conversion must happen once, early, and the domain layer never sees the ×1000 form.

**Warning signs:** Scores that look wildly wrong (GEX-fit proximity checks comparing `7500` against `7500000`), or fast-check property tests that only pass with suspiciously large tolerances.

### Pitfall 2: Reusing the mockup's private BSM instead of `@morai/quant`

**What goes wrong:** The mockup's `putPrice`/`putGreeks` have no dividend yield `q`, a cruder `normCdf` (A&S-style 5-term but different coefficients than `@morai/quant`'s), and a 365-day (not 365.25) theta basis. Porting them verbatim produces numbers that quietly disagree with every other screen's BSM output (Overview payoff, Analyzer scenario strip).

**Why it happens:** D-07 says "port `buildCandidates()`" — easy to over-read this as "port the whole file" rather than "port the SCORING logic, re-pricing through the real engine."

**How to avoid:** Only port `fwdIV`, `legEvents`, the score-weighting formula, and the dedupe/top-N logic. Every `putPrice`/`putGreeks` call site becomes a call to `bsmPrice(S, K, T, sigma, r, q, "P")` / `bsmGreeks(S, K, T, sigma, r, q, "P")` from `@morai/quant`, with `q` sourced the same way the rest of the codebase already sources it (D-01 default 0.013 per `bsm.ts`'s own doc comment).

**Warning signs:** A new `normCdf`/`ncdf` function appearing anywhere under `packages/core/src/picker/`.

### Pitfall 3: Storing economic-event dates as UTC instants (IANA/DST mirror of the CBOE-UTC bug)

**What goes wrong:** CPI/NFP/FOMC releases are published AT specific ET times (08:30 ET for CPI/NFP data prints, 14:00 ET for the FOMC statement). If the adapter naively does `new Date(dateString)` and later persists/compares via a `timestamptz` column, a date near a timezone boundary can silently shift by a day when read back in a different zone context — the CBOE-UTC bug (STATE.md risk #4), same class, opposite direction.

**Why it happens:** The natural instinct given "store with IANA timezone" (D-12/D-13's own wording) is to reach for a zoned-datetime type or library.

**How to avoid:** The `spans` comparison this phase needs (D-10: `(today, legExpiry]`) is a **calendar-day interval**, not a time-of-day comparison — the event's *day* either falls between two other *days* or it doesn't. Store `event_date` as a plain SQL `date` (matching `macro_observations.date`'s own precedent), representing the release's ET calendar day as published by FRED/the Fed (which is already the correct day — FRED's `date` field in `release/dates` responses is the release day, not a UTC-shifted instant). Compare via ISO `YYYY-MM-DD` string ordering (`eventDate > today && eventDate <= legExpiry`), never via `Date` object arithmetic across a timezone. Document this once, in the adapter and the migration, as the resolution to D-12's "IANA timezone" requirement: **the IANA timezone (`America/New_York`) is a fact about how the source data was labeled, satisfied by treating the stored `date` as already being that calendar day — not something the code needs to convert at read/write time.**

**Warning signs:** Any `Date` object crossing a JSON serialization boundary in the events pipeline; a `timestamptz` column in the `economic_events` migration.

### Pitfall 4: FRED endpoint fetch tooling was blocked this research session — verify with a live key before coding the parser

**What goes wrong:** Both `fred.stlouisfed.org` (docs pages) and `api.stlouisfed.org` (the actual API host) returned HTTP 403 to this session's fetch tooling, most likely site-level bot-detection rather than an endpoint-shape problem — the existing `fred.ts` adapter in this repo successfully calls `api.stlouisfed.org/fred/series/observations` in production, so the domain is reachable with a real API key and a real HTTP client (Bun's `fetch`, not this session's WebFetch tool). But this means the exact JSON field names for `release/dates` were confirmed via secondary sources (the `fredr` R package's documented wrapper), not a live response observed this session.

**Why it happens:** FRED's edge (Cloudflare or similar) appears to block non-browser fetch tooling / IPs without an API key more aggressively on some paths than others.

**How to avoid:** Before writing the Zod schema for the `release/dates` response, the planner should schedule a Wave-0 spike task: hit `https://api.stlouisfed.org/fred/release/dates?release_id=10&api_key=$FRED_API_KEY&file_type=json&include_release_dates_with_no_data=true` with the real (already-provisioned, per Phase-14 memory) `FRED_API_KEY` and inspect the live response shape before finalizing the schema — mirroring how `fred.ts`'s own `FredResponseSchema` was presumably validated against a live call originally.

**Warning signs:** A schema that assumes the same `{observations: [{date, value}]}` shape as `series/observations` — `release/dates` returns a DIFFERENT shape (`release_dates: [{release_id, release_name?, date}]`, per the cross-checked secondary sources), not observation rows.

### Pitfall 5: Delta-targeted strike selection needs a re-key for the mockup's dedupe

**What goes wrong:** The mockup dedupes candidates by `key = K + "-" + fe` (raw strike + front expiry). Once strikes are delta-targeted against a live, moving chain (D-01) rather than three fixed numbers (7500/7450/7400), the "same strike" key stops being stable run-to-run (the 20Δ strike today may be 7420, tomorrow 7435) — this is fine for a single snapshot's dedupe, but the planner should be aware the dedupe key must become `(deltaRung, frontExpiry)` or `(selectionRung, frontExpiry)`, not a strike value, once strikes are no longer three fixed numbers.

**How to avoid:** Key dedupe on the delta-rung label (`"ATM"`/`"30D"`/`"20D"`/`"10D"`) plus front expiry, not on the resolved strike price.

## Code Examples

Verified patterns from the codebase (this session's Read tool):

### FwdIV + event-span reference logic to port

```javascript
// Source: mockups/playground-v4.html (lines 238-244), D-07's designated port target
function fwdIV(tf,ivf,tb,ivb){ // criterion 1 — forward variance identity, T in DTE
  const rad=(tb*ivb*ivb - tf*ivf*ivf)/(tb-tf);
  return rad>0?Math.sqrt(rad):null; // guard: inverted structure
}
function legEvents(expiry){ // events landing before this expiry (leg "spans" them)
  const ed=parseExp(expiry);
  return EVENTS.filter(ev=>{const d=new Date(ev.d);return d>TODAY&&d<=ed;}).map(ev=>ev.nm);
}
```

### Scoring weight formula to port verbatim (D-08 named constants)

```javascript
// Source: mockups/playground-v4.html (lines 267-271)
const s = 40*Math.min(1,Math.max(0,slope/0.6))
        + 25*Math.min(1,Math.max(0,(fwdEdge+0.02)/0.04))
        + 15*gexFit
        + 10*Math.max(0,1-evtPenalty)
        + 10*Math.min(1,(K===7500?1:0.7));   // ← D-09: this last term is REPLACED with real beVsEm
```

### Production BSM signature to call instead of the mockup's own math

```typescript
// Source: packages/quant/src/bsm.ts (existing, production)
export function bsmPrice(
  S: number, K: number, T: number, sigma: number, r: number, q: number, type: "C" | "P",
): number;
export function bsmGreeks(
  S: number, K: number, T: number, sigma: number, r: number, q: number, type: "C" | "P",
): BsmGreeks; // { delta, gamma, theta (per calendar day, /365.25), vega (per vol pt, /100) }
```

### Precompute-then-read use-case to mirror

```typescript
// Source: packages/core/src/analytics/application/getGex.ts (existing)
export type ForRunningGetGex = () => Promise<Result<GexSnapshotRow | null, StorageError>>;
export function makeGetGexUseCase(deps: GetGexDeps): ForRunningGetGex {
  return () => deps.readGexSnapshot();
}
```

### HTTP route to mirror

```typescript
// Source: apps/server/src/adapters/http/gex.routes.ts (existing)
router.get("/gex", async (c) => {
  const result = await getGex();
  if (!result.ok) return c.json({ error: "internal" }, 500);
  if (result.value === null) return c.json({ error: "no-snapshot" }, 404);
  return c.json(gexSnapshotResponse.parse({ /* map row → contract shape */ }));
});
```

### react-query hook to mirror

```typescript
// Source: apps/web/src/hooks/useCot.ts (existing)
export function useCot() {
  return useQuery({
    queryKey: ["cot"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/cot");
      if (res.status === 401) throw new UnauthorizedError();
      if (!res.ok) throw new Error(`GET /api/analytics/cot failed: ${res.status}`);
      return cotResponse.parse(await res.json());
    },
    refetchInterval: 3_600_000,
    staleTime: 1_800_000,
    retry: (failureCount, error) => (error instanceof UnauthorizedError ? false : failureCount < 3),
  });
}
```
`usePicker` mirrors this exactly (D-19): swap `cotResponse`/`/api/analytics/cot` for `pickerSnapshotResponse`/`/api/picker/candidates`. Refetch interval should be looser (picker updates ~13×/day RTH via the chain trigger, not weekly) — a shorter `staleTime` (e.g. matching the ~30-min chain cadence) is more appropriate than COT's hourly one; exact tuning is the planner's discretion.

### Existing numeric-solve-with-guard precedent (for D-09's real BE-vs-EM, see Open Questions)

```typescript
// Source: packages/core/src/journal/domain/iv-inversion.ts (existing)
const VEGA_THRESHOLD = 1e-8; const MAX_ITER = 50; const NR_TOL = 1e-10;
const BISECT_LO = 0.001; const BISECT_HI = 5.0; const BISECT_STEPS = 200;
export type IvError = { readonly kind: "expired" } | { readonly kind: "below-intrinsic" } | { readonly kind: "above-bound" };
// Newton-Raphson with a guaranteed-convergence bisection fallback, Result<number, IvError>, never NaN.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Analyzer picker rail renders a frozen fixture (`pickerSnapshotFixture`) | Analyzer picker rail renders live `usePicker()` data against the same frozen contract shape | Phase 19 (this phase) | UI code for rendering (cards, breakdown bars, why-panel) does not change — only the data source and the new loading/error/empty branches (D-18/D-19) |
| No economic-events data exists anywhere in the codebase | New `economic_events` table + adapter, FRED-backed for CPI/NFP + seeded for FOMC | Phase 19 (this phase) | First time the codebase has ANY forward-looking calendar data — distinct from `macro_observations` (historical time-series values) and `calendar_events` (the journal's own OPEN/CLOSE/ROLL trade events) |

**Deprecated/outdated:**
- The mockup's hardcoded `TERM`/`EVENTS`/`GEX` constants (playground-v4.html lines 200-218): these were always meant as a throwaway oracle for the UI mockup, never intended to ship. Nothing to migrate away from — just don't port them.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | FRED `release_id=10` = Consumer Price Index and `release_id=50` = Employment Situation/NFP | D-12 research, Standard Stack | If wrong, the adapter would fetch the wrong release's dates entirely — silently mis-flagging event windows. Cross-checked via two independent web searches both pointing at official `fred.stlouisfed.org` URLs (rid=10 confirmed CPI; rid=50 confirmed via the PAYEMS-table URL `release/tables?eid=4881&rid=50`), but neither was confirmed via a live authenticated API call this session (FRED domains 403'd this session's fetch tooling). **Recommend a Wave-0 spike verifying both `release_id`s against a live `release/dates` call with the real `FRED_API_KEY` before finalizing the adapter.** |
| A2 | `fred/release/dates?release_id=N&include_release_dates_with_no_data=true` returns FORWARD/future-scheduled dates, not just historical ones | D-12 research, Pitfall 4 | If the endpoint only returns past dates even with this flag, FRED cannot serve the "upcoming CPI/NFP" need at all, and D-12's fallback (a maintained seed) would need to extend to CPI/NFP too, not just FOMC. Confirmed via FRED's own documented endpoint description (the `include_release_dates_with_no_data` flag's stated purpose, per official-docs-derived summaries) but not by a live response this session. |
| A3 | The exact JSON response shape of `fred/release/dates` is `{release_dates: [{release_id, release_name?, date}]}` (distinct from `series/observations`'s `{observations: [{date, value}]}`) | Pitfall 4, Code Examples | If the actual shape differs (e.g. field naming), the Zod schema in the new adapter would need adjustment on first live test — low risk since Zod parse failures fail loudly (return `err`), never silently corrupt data, per the existing `fred.ts` adapter's own error-handling convention. |
| A4 | Schwab's Trader API market-data surface has no economic-calendar endpoint | D-12 research (elimination of Schwab as a candidate) | If Schwab does expose an undocumented or newly-added econ-calendar endpoint, the FRED+seed design is still correct (FRED/Fed are the authoritative sources either way) — this assumption only affects whether a *third*, redundant source is being missed, not whether the chosen design works. |
| A5 | No dedicated machine-readable FOMC calendar feed exists (API/ICS/RSS specific to FOMC dates) | D-12 research (FOMC fallback justification) | If a clean feed does exist and was missed, the maintained-seed fallback is more manual-labor than strictly necessary, but not incorrect — FOMC dates change rarely and are published a year+ ahead, so the seed approach still functions correctly even if a feed is later found and swapped in. |

**If this table is empty:** N/A — see entries above. All five concern the economic-events source (D-12), the phase's single genuinely research-gated decision; the scoring-engine port (D-07) and precompute/route/hook patterns are all directly read from working code this session and carry no assumption risk.

## Open Questions

1. **How should the real BE-vs-EM ratio (D-09) be computed — closed-form approximation or numeric solve?**
   - What we know: `expectedMove` (±1σ by front expiry) is already a contract field and already computed the same way the mockup does it (`SPOT*fiv*Math.sqrt(tf/365)`, reusing the existing `expectedMove` calc — no change needed there). "Breakeven width" for a long calendar spread has no simple closed form (the payoff-at-front-expiry curve, `candPnl` in the mockup, is a function of spot that must be solved for its zero-crossings).
   - What's unclear: Whether to (a) numerically bisect the payoff-at-front-expiry function for its breakeven spot(s), reusing the `iv-inversion.ts` bisection-with-guard pattern, or (b) use a cheaper closed-form approximation (e.g. treating the calendar's max-profit width as approximately `debit / (peak vega around ATM)`, a common practitioner heuristic that avoids a numeric solve per candidate).
   - Recommendation: Prefer (a), the numeric bisection — the codebase already has exactly this pattern (`iv-inversion.ts`), the calendar's payoff function (`candPnl`-equivalent) is cheap to evaluate (a few `bsmPrice` calls), and a numeric solve is honest about calendars sometimes having two breakevens (upper and lower) or none, which a closed-form approximation would paper over. The planner should design this as its own small domain function (e.g. `findBreakevens(candidate): ReadonlyArray<number>`) with a documented guard for "no breakeven found within the search bounds."

2. **Exact delta rungs and DTE grid defaults (D-01/D-02 — explicitly left to the planner, but research can ground the choice).**
   - What we know: Research criterion 5 says "parameterize by delta, not raw strike (CML precedent)"; the mockup used ATM + two further-OTM strikes (7500/7450/7400 relative to a 7498.85 spot — i.e., roughly ATM, ~1% OTM, ~1.3% OTM). D-02's constraint: front ≥21–30 DTE typical, back ≥21 days beyond front. The mockup's own filter (`dte(fe)>=21&&dte(fe)<=36` for fronts, `dte(be)-dte(fe)>=21&&dte(be)<=80` for backs) is a reasonable, already-validated-by-the-approved-mockup default grid.
   - What's unclear: The precise delta values for the "30Δ/20Δ/10Δ" rungs mentioned in D-01 (is it exactly −0.30/−0.20/−0.10 put delta, or approximate bands?).
   - Recommendation: Use exact target deltas −0.30 / −0.20 / −0.10 (put delta, i.e. `bsmGreeks(...).delta ≈ -0.30` etc.) plus ATM (delta ≈ −0.50), searching the chain for the closest available strike to each target delta per expiry. Keep the mockup's DTE grid (front 21–36, back front+21 to 80) as the shipped default, matching D-02's "planner picks a concrete default grid" instruction and the already-approved-in-mockup card count/feel.

3. **Should the weekly economic-events cron run before or independent of the picker's first compute-picker trigger on a given day, and what happens on the very first cold boot (no `economic_events` rows yet)?**
   - What we know: D-17 already requires `eventsContextStatus: "missing"` to be tagged and the event-adjustment term to contribute 0 in that case — this handles the cold-start case correctly by design.
   - What's unclear: Whether `fetch-economic-events` should also run once eagerly at worker boot (not just on the weekly cron), so a fresh deploy doesn't sit with `eventsContextStatus: "missing"` for up to a week.
   - Recommendation: Mirror `fetch-cot`'s own precedent exactly (weekly cron only, no eager boot-run) for consistency — D-17's honest-tagging already covers the gap, and the existing `fetch-cot`/`fetch-rates` crons don't eager-run at boot either, so this matches established project convention rather than introducing a new one.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `FRED_API_KEY` (env var) | Economic-events HTTP fetch (CPI/NFP) | ✓ (per Phase-14 project memory: "FRED_API_KEY set" in prod) | — | Adapter must still handle the missing-key case explicitly (mirroring `makeFredSeriesAdapter`'s existing `err({kind:"fetch-error", message:"FRED API key missing"})` — no fallback, no silent scoring against absent data), since local/dev environments may not have it set |
| Docker (for `testcontainers` Postgres tests) | New `economic_events`/`picker_snapshot` repo tests | Assumed ✓ — already a hard project convention (`tdd.md`: "Postgres repos → testcontainers against real Postgres") used successfully by `macro-observations.contract.test.ts`, `cot-observations.contract.test.ts`, etc. | — | None — testcontainers is non-negotiable per project TDD rule; if Docker is unavailable in a given dev environment, that blocks ALL Postgres-repo work, not just this phase |
| Network access to `api.stlouisfed.org` from the worker at runtime | Economic-events cron fetch | Not directly verified this session (this session's own fetch tooling was blocked by site-level bot detection, not a network-reachability issue — the existing `fred.ts` adapter already proves the worker's own runtime `fetch` reaches this host in production) | — | On fetch failure, D-17's `eventsContextStatus: "missing"`/`"stale"` path already provides the honest degrade — no crash, no fabricated data |

**Missing dependencies with no fallback:** none identified — Docker/testcontainers is a pre-existing hard requirement of the whole project, not new to this phase.

**Missing dependencies with fallback:** `FRED_API_KEY` absence in a given environment → adapter returns `err`, `eventsContextStatus` tags `missing`, scoring proceeds with the event term contributing 0 (D-17).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.8 (workspace-wide `vitest run`) |
| Config file | root `vitest.config.ts` (existing — not read this session, assumed unchanged per project convention) |
| Quick run command | `vitest run packages/core/src/picker` (scoped to the new domain during development) |
| Full suite command | `bun run test` (root script: `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|--------------|
| PICK-01 | FwdIV guard never produces NaN, always tags `"inverted"` when radicand<0 | fast-check property test | `vitest run packages/core/src/picker/domain/fwd-iv.test.ts` | ❌ Wave 0 |
| PICK-01 | Weighted score always sums to ≤100 and each breakdown contribution is 0-100 normalized | fast-check property test | `vitest run packages/core/src/picker/domain/scoring.test.ts` | ❌ Wave 0 |
| PICK-01 | REFUTED criteria (IV-rank, IV-diff band, debit-%-of-back) never appear in `breakdown` | example test asserting the `criterion` enum values produced never include a refuted label | `vitest run packages/core/src/picker/domain/scoring.test.ts` | ❌ Wave 0 |
| PICK-01 | Net theta ≤ 0 candidates are filtered out before scoring | example test | `vitest run packages/core/src/picker/domain/candidate-selection.test.ts` | ❌ Wave 0 |
| PICK-01 | Delta-targeted strike selection picks the chain strike closest to each target delta | example test against a small synthetic chain fixture | `vitest run packages/core/src/picker/domain/candidate-selection.test.ts` | ❌ Wave 0 |
| PICK-02 | `GET /api/picker/candidates` returns 404 `{error:"no-snapshot"}` on cold start, 200 + parsed contract otherwise | route test (Hono test client, mirrors `gex.routes.test.ts`) | `vitest run apps/server/src/adapters/http/picker.routes.test.ts` | ❌ Wave 0 |
| PICK-02 | `usePicker` hook mirrors `useCot`'s loading/error/401 behavior | hook test (mirrors `useCot.test.ts`) | `vitest run apps/web/src/hooks/usePicker.test.ts` | ❌ Wave 0 |
| PICK-03 | Economic-events HTTP adapter parses a mocked FRED `release/dates` response, filters/merges with the FOMC seed | msw-mocked adapter test | `vitest run packages/adapters/src/http/economic-events.test.ts` | ❌ Wave 0 |
| PICK-03 | `economic_events`/`picker_snapshot` Postgres repos round-trip correctly, idempotent on re-insert | testcontainers contract test | `vitest run packages/adapters/src/postgres/repos/economic-events.contract.test.ts` | ❌ Wave 0 |
| PICK-03 | A leg "spans" an event iff the event date is in `(today, legExpiry]` | fast-check property test (date-string interval membership) | `vitest run packages/core/src/picker/domain/candidate-selection.test.ts` | ❌ Wave 0 |
| D-17 | `gexContextStatus`/`eventsContextStatus` correctly tag `stale`/`missing` and the corresponding term contributes 0 | example test in the `computePickerSnapshot` use-case test | `vitest run packages/core/src/picker/application/computePickerSnapshot.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the scoped `vitest run packages/core/src/picker` (or the specific new test file) command shown above.
- **Per wave merge:** `bun run test` (full workspace suite).
- **Phase gate:** Full suite green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `packages/core/src/picker/domain/fwd-iv.test.ts` — covers PICK-01 (FwdIV guard, fast-check)
- [ ] `packages/core/src/picker/domain/scoring.test.ts` — covers PICK-01 (weighted score, REFUTED-criteria absence)
- [ ] `packages/core/src/picker/domain/candidate-selection.test.ts` — covers PICK-01/PICK-03 (delta selection, theta filter, event-span interval)
- [ ] `packages/core/src/picker/application/computePickerSnapshot.test.ts` — covers PICK-01/D-17 (in-memory ports)
- [ ] `packages/adapters/src/http/economic-events.test.ts` — covers PICK-03 (msw)
- [ ] `packages/adapters/src/postgres/repos/economic-events.contract.test.ts` + `picker-snapshot.contract.test.ts` — covers PICK-03/D-05/D-06 (testcontainers)
- [ ] `apps/server/src/adapters/http/picker.routes.test.ts` — covers PICK-02 (Hono route test)
- [ ] `apps/web/src/hooks/usePicker.test.ts` — covers PICK-02/D-19 (mirrors `useCot.test.ts`)
- [ ] Framework install: none — Vitest, fast-check, msw, testcontainers all already installed workspace-wide.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (new surfaces) | Existing Bearer-token auth (`apiFetch`, existing 401-handling convention) already gates `/api/picker/candidates` the same way it gates `/api/analytics/gex`/`/api/analytics/cot` — no new auth logic needed |
| V3 Session Management | no | Not touched by this phase |
| V4 Access Control | no | Single-bearer-token model unchanged (documented v2 deferral in STATE.md) |
| V5 Input Validation | yes | Zod at every boundary: the FRED `release/dates` HTTP response, the `picker_snapshot` JSONB blob on read, the HTTP route response before it leaves the server (parse-through, matching `gex.routes.ts`) |
| V6 Cryptography | no | No new secrets/crypto — `FRED_API_KEY` reuses the existing `fred.ts` "never logged" discipline (T-02-11/T-02-12) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| `FRED_API_KEY` leaking into logs on a fetch failure | Information Disclosure | Static warn-text-only logging, exactly as `fred.ts`'s existing `console.warn(\`FRED: ${result.reason}, ...\`)` pattern — never interpolate the key itself, mirror verbatim in the new economic-events adapter |
| A stale/failed economic-events fetch silently producing a falsely-clean score (no event penalty applied when an event actually occurred) | Tampering (data integrity) / a "false-clean" failure mode the project has already flagged (D-17, mirroring the `fwdIvGuard` precedent) | `eventsContextStatus: "missing"|"stale"` tag + the UI's explicit "events unavailable" label — never silently defaulting to "no events" |
| Malformed/unexpected FRED JSON response shape crashing the cron job or corrupting `economic_events` | Denial of Service / data corruption | Zod `safeParse` at the adapter boundary (mirrors `fred.ts`'s `FredResponseSchema.safeParse`), returning `err(...)` on any shape mismatch — job handler logs and moves on, never throws unguarded |
| Overly large FRED response bloating the weekly job (unlikely but worth a bound) | Resource exhaustion | FRED `release/dates` responses are small (dozens of dates per release, not thousands) — no special pagination/limit handling needed beyond what the existing `fred.ts` fetch-with-timeout convention (if any) already provides |

## Sources

### Primary (HIGH confidence)
- `mockups/playground-v4.html` (this repo, read directly) — the reference scoring engine (D-07's designated port target)
- `packages/quant/src/bsm.ts`, `packages/core/src/analytics/application/{computeGexSnapshot,getGex,ports}.ts`, `packages/adapters/src/http/fred.ts`, `packages/adapters/src/memory/macro-observations.ts`, `apps/worker/src/schedule.ts`, `apps/server/src/adapters/http/gex.routes.ts`, `apps/web/src/hooks/useCot.ts`, `packages/core/src/journal/domain/iv-inversion.ts`, `packages/contracts/src/picker.ts`, `.planning/research/calendar-selection-criteria.md` (this repo, all read directly this session)
- Repo `package.json` files (root, `apps/web`, `apps/server`, `apps/worker`, `packages/adapters`, `packages/contracts`, `packages/quant`, `packages/core`) — read directly to confirm zero new deps needed

### Secondary (MEDIUM confidence)
- FRED `release_id=10` = CPI, confirmed via `fred.stlouisfed.org/release?rid=10` (WebSearch, official FRED URL, cross-checked)
- FRED `release_id=50` = Employment Situation/NFP, confirmed via `fred.stlouisfed.org/release/tables?eid=4881&rid=50` (WebSearch, official FRED URL, cross-checked)
- FRED `releases/dates`/`release/dates` endpoint shape and `include_release_dates_with_no_data` forward-dates behavior — via the `fredr` R package's documented vignette (WebFetch succeeded on `cran.r-project.org`, itself describing the official FRED API docs) since direct fetch of `fred.stlouisfed.org`/`api.stlouisfed.org` was blocked (403) this session
- Schwab Trader API market-data surface (chains/quotes/streaming only, no economic-calendar endpoint) — WebSearch across the Schwab developer portal + third-party API guides
- No dedicated programmatic FOMC calendar feed exists — WebSearch across `federalreserve.gov` calendar pages + third-party FOMC-schedule aggregators

### Tertiary (LOW confidence)
- None used without cross-checking — every claim above was corroborated by at least two independent search results or a direct repo-code read.

## Metadata

**Confidence breakdown:**
- Standard stack / engine port (D-07/D-08): HIGH — mockup and production BSM both read directly this session, no external uncertainty
- Economic-events source (D-12): MEDIUM — resolved with a concrete recommendation, but the exact FRED response shape needs a live-key Wave-0 spike (Pitfall 4 / Assumptions A1-A3) since official docs were unreachable this session
- Architecture/patterns (precompute-then-read, adapter trio, route/hook mirrors): HIGH — every pattern cited is an existing, working file in this repo
- Pitfalls: HIGH — strike-unit and BSM-duplication risks are directly observable in the repo's own code; the IANA/DST pitfall follows directly from the project's own documented CBOE-UTC lesson (STATE.md)

**Research date:** 2026-07-04
**Valid until:** 30 days (stable domain — FRED endpoint shape and FOMC schedule change rarely; re-verify the live FRED response shape at Wave 0 regardless of this date)
