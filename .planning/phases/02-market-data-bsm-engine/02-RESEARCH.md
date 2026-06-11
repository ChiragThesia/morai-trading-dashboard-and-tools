# Phase 2: Market Data & BSM Engine — Research

**Researched:** 2026-06-10
**Domain:** Options market data ingestion + Black-Scholes-Merton analytics engine
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** `q` is a fixed Zod-config value, default 1.3%. No calibration in Phase 2.
- **D-02:** `r` comes from stored FRED DGS3MO rate; 4.5% fallback when no rate row exists.
- **D-03:** IV inversion = Newton-Raphson (analytic vega) with bisection fallback when Newton diverges or vega is too flat. Property tests must cover the fallback path.
- **D-04:** T = exact minutes to expiration cutoff / minutes-per-year (365.25-day basis). Cutoff: PM-settled (SPXW weeklies/dailies, PM monthlies) → 16:00 ET; AM-settled (SPX 3rd-Friday monthlies) → 09:30 ET.
- **D-05:** trade-advisor `bsm.ts` and `cboe.ts` are READ-ONLY references. Morai code written fresh, TDD red→green.
- **D-06:** RTH gating double-layered: pg-boss cron in ET + handler self-check. NYSE holiday awareness Phase 3.
- **D-07:** `fetch-cboe-chain` enqueues `compute-bsm-greeks` on successful persist (chained). Compute also has a sparse hourly fallback schedule during RTH.
- **D-08:** No manual trigger surface in Phase 2 (MCP-01 is Phase 5).
- **D-09:** Rows with mathematically unsolvable IV stamped `bsm_iv = 'NaN'` (Postgres numeric NaN).
- **D-10:** `lastJobRuns` carries both `lastSuccessAt` and `lastErrorAt` + error message per job.
- **D-11:** Store BOTH roots (SPX and SPXW) within DTE/strike filter; `contracts.root` distinguishes them.
- **D-12:** Greeks stored in TOS-convention display units: theta per calendar day (negative = decay), vega per 1 vol point, delta/gamma raw per-share. ×100 multiplier applied at read/display.
- **D-13:** All tunables (DTE bound 90, strike band ±10%, q 1.3%, fallback rate 4.5%, cadences) in Zod config schema with hardcoded defaults; env vars override.

### Claude's Discretion
- Exact CBOE delayed-quotes URL + retry/backoff numbers.
- FRED API usage (key vs no-key CSV endpoint).
- Upsert SQL shape (`ON CONFLICT DO NOTHING` vs equivalent) for append-only idempotency.
- Which rate row matches an observation (latest date ≤ observation date).
- Calibration fixture sources for the 1e-4 greek reference tests.
- pg-boss queue/job naming + payload Zod schemas.

### Deferred Ideas (OUT OF SCOPE)
- (r, q) calibration against TOS readings — Phase 4+.
- Retention/pruning policy for `leg_observations` — Phase 6.
- Manual `trigger_job` surface — Phase 5 (MCP-01).
- NYSE holiday calendar — Phase 3 (CAL-05).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MKT-01 | `ForFetchingChain` driven port + CBOE adapter (delayed quotes, no auth) + in-memory twin | CBOE endpoint URL verified from reference `cboe.ts`, Zod parse pattern documented, msw mock pattern confirmed |
| MKT-02 | `ForFetchingRate` port + FRED DGS3MO adapter + 4.5% fallback | FRED API key required for JSON; no-key CSV endpoint exists via fredgraph.com gateway; fallback + logging pattern documented |
| MKT-03 | Filtered chain persistence: ≤90 DTE + strike ±10% spot → `leg_observations` append-only, `source='cboe'` | Schema confirmed (no migration), upsert via composite PK, contracts first-seen upsert pattern documented |
| BSM-01 | IV inversion (Newton-Raphson + bisection fallback), property-tested fast-check round-trip ≤1e-6 | Newton-Raphson formula, Brenner-Subrahmanyam initial guess, bisection bounds, fallback trigger verified |
| BSM-02 | BSM greeks (European, with q) validated against ≥3 calibration fixtures at ≤1e-4 | Three computed fixtures with reference values provided; Hull textbook cross-check included |
| BSM-03 | `compute-bsm-greeks` use-case: scans pending partial index, writes bsm_* columns; NaN stamp for failures | Partial index confirmed in schema, NaN write pattern (string 'NaN') verified for Drizzle/postgres.js |
| (sched) | Three pg-boss scheduled jobs + `lastJobRuns` in status | pg-boss v12 schedule/work/send API documented, job table query for lastSuccessAt/lastErrorAt confirmed |
</phase_requirements>

---

## Summary

Phase 2 wires three distinct subsystems: a CBOE HTTP adapter (no-auth delayed quotes), a
FRED rate adapter (API-key JSON or no-key CSV), and a pure-math BSM engine in `packages/core`.
All three feed a pg-boss job pipeline. The schema already exists; no migrations are expected.

The CBOE feed is simple: one GET to a public CDN URL returns ~20k contracts as JSON.
The reference `cboe.ts` provides the exact endpoint, OSI parse logic, and all edge cases.
Morai must rewrite it fresh (D-05) behind a `ForFetchingChain` port, but the implementation
shape is fully known.

The BSM engine is the most numerically sensitive part. The formulas are closed-form; the IV
inversion requires a two-stage solver (Newton-Raphson → bisection fallback). The A&S polynomial
ncdf approximation used in the reference `bsm.ts` achieves ~1.5e-7 absolute error, which is
sufficient for the 1e-6 round-trip price tolerance — because that tolerance is numerical
self-consistency (recovered price matches input price), not absolute accuracy against a
true Gaussian CDF. Three calibration fixtures with computed reference values are provided
directly in this document.

pg-boss v12 (latest: 12.18.3) is a major version jump from the v10 the CONTEXT anticipated.
The schedule/work/send API is stable across v10–v12, but handler signature changed in v10:
handlers always receive an array. The `pgboss.job` table supports querying last-success/error
per job name directly via SQL without a new table.

**Primary recommendation:** Write BSM domain functions first (pure, fast-check testable), then
build CBOE/FRED adapters with msw mocks, then wire the three pg-boss jobs in `apps/worker`.
`lastJobRuns` status extension touches `packages/contracts` → `packages/core` → both HTTP and
MCP adapters; do it in a single wave to satisfy MCP-02.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| BSM math (IV inversion, greeks) | Domain (`packages/core`) | — | Pure functions; no I/O; belong in the hexagon per architecture-boundaries.md |
| CBOE chain fetch | Driven adapter (`packages/adapters`) | — | External HTTP; adapters own vendor coupling |
| FRED rate fetch | Driven adapter (`packages/adapters`) | — | External HTTP with fallback logic; adapter boundary |
| Chain filtering (DTE + strike band) | Domain / Application (`packages/core`) | — | Business rule; config-injected bounds; no I/O |
| Observation persistence (`leg_observations`) | Driven adapter (`packages/adapters/postgres`) | — | SQL/Drizzle confined to adapters |
| Rate persistence (`rate_observations`) | Driven adapter (`packages/adapters/postgres`) | — | Same |
| `compute-bsm-greeks` use-case | Application (`packages/core`) | — | Orchestrates domain + driven ports; no infrastructure |
| pg-boss job scheduling | Driving adapter (`apps/worker`) | — | Infrastructure; wires use-cases to cron triggers |
| `lastJobRuns` reporting | Application/Contracts layer | HTTP + MCP adapters | Core defines `StatusPayload`; contracts define wire shape; both adapters consume |
| RTH gating (time check) | Handler (`apps/worker`) | Domain util (optional) | Clock is infrastructure; pure RTH window function can be in shared |

---

## Standard Stack

### Core (no new packages — already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | ^4.4.3 | Zod-parse all external inputs before core | Already in all packages |
| `fast-check` | ^4.8.0 | Property tests for BSM round-trips | Already in devDeps (root) |
| `@testcontainers/postgresql` | ^12.0.1 | Real Postgres for repo tests | Already in adapters devDeps |
| `msw` | ^2.14.6 | Mock CBOE + FRED HTTP at network layer | Already in ecosystem; must be added to adapters devDeps |

### New Dependency Required

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `pg-boss` | ^12.18.3 | Postgres-backed job queue for scheduled fetches | Chosen in architecture docs; not yet installed |
| `msw` | ^2.14.6 | HTTP mocking for adapter tests (CBOE, FRED) | Required by tdd.md; not yet in any package.json |

**Version verification:** [VERIFIED: npm registry]
- `pg-boss@12.18.3` — npm view confirmed; MIT; github.com/timgit/pg-boss; created 2016-03-18; actively maintained (updated 2026-06-10)
- `msw@2.14.6` — npm view confirmed; MIT; github.com/mswjs/msw; created 2018-11-18; actively maintained (updated 2026-05-11)

**Installation:**
```bash
# Add to apps/worker/package.json
bun add pg-boss

# Add to packages/adapters/package.json devDependencies
bun add -d msw

# Also add pg-boss types if needed (included in the package itself — no @types/pg-boss)
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pg-boss` | Bull, BullMQ, graphile-worker | pg-boss uses same Postgres DB (no Redis dep); architecture already decided |
| FRED API key | No-key fredgraph.com CSV gateway | See FRED section below — API key is cleaner and already exists in trade-advisor `.env`; no-key CSV gateway is a third-party proxy (ivo-welch.org) with unknown SLA |
| A&S 5-term ncdf approx | Higher-precision erfc rational (Cody) | A&S is sufficient for 1e-6 round-trip; higher precision not justified at SPX price scale |

---

## Package Legitimacy Audit

> slopcheck was not available at research time. All packages verified via npm view and official
> source repositories.

| Package | Registry | Age | Source Repo | Disposition |
|---------|----------|-----|-------------|-------------|
| `pg-boss` | npm | ~10 yrs (2016) | github.com/timgit/pg-boss | Approved — long-standing, single maintainer (timjones), 262 published versions, no suspicious postinstall |
| `msw` | npm | ~8 yrs (2018) | github.com/mswjs/msw | Approved — industry standard HTTP mock library, 335 versions, maintained by kettanaito |
| `fast-check` | npm | Already installed | github.com/dubzzz/fast-check | Approved — already in project |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none (slopcheck unavailable — all packages tagged [ASSUMED] for slopcheck result, but npm registry age/source verification passes)

*Note: Because slopcheck was unavailable, treat all new packages as [ASSUMED] for slopcheck purposes. Given the registry age and source repo history of pg-boss and msw, the risk is low, but the planner should include a verification checkpoint before install if following strict protocol.*

---

## Architecture Patterns

### System Architecture Diagram

```
External world                 apps/worker                   packages/core
───────────────                ─────────────                 ──────────────
                               ┌─────────────────────────┐
CBOE CDN ──────────────────────► fetch-cboe-chain handler │
cdn.cboe.com/api/global/       │   ↓ Zod-parse job payload│
delayed_quotes/options/        │   ↓ call use-case         │──► makeFetchChainUseCase
  _SPX.json                    │                           │       ↓ ForFetchingChain (port)
  _SPXW.json                   │                           │           ↓ (adapter impl)
                               │   on success:             │       ↓ ForPersistingChain (port)
                               │   boss.send(              │           ↓ (adapter impl)
                               │    'compute-bsm-greeks')  │
FRED API ─────────────────────►│ fetch-rates handler       │──► makeFetchRateUseCase
api.stlouisfed.org/fred/       │                           │       ↓ ForFetchingRate (port)
  series/observations          │                           │       ↓ ForPersistingRate (port)
  ?series_id=DGS3MO            │
  &api_key=...                 │
                               │ compute-bsm-greeks handler│──► makeComputeBsmGreeksUseCase
                               │                           │       ↓ ForReadingPendingObs (port)
                               │                           │       ↓ bsmIvInvert() [domain]
                               │                           │       ↓ bsmGreeks() [domain]
                               │                           │       ↓ ForWritingBsmResults (port)
                               └─────────────────────────┘
                                         ↓ reads
apps/server                    pgboss.job (Postgres)       packages/contracts
────────────                   ──────────────────          ─────────────────
GET /api/status ───────────────► getStatus use-case ───────► statusResponse schema
MCP get_status                         ↓ SQL query                (extended with lastJobRuns)
                                SELECT name, max(completed_on)
                                FROM pgboss.job WHERE state IN...
```

### Recommended Project Structure

New files this phase (additions to existing structure):

```
packages/core/src/
├── journal/                          # existing context
│   ├── application/
│   │   ├── ports.ts                  # extend: ForFetchingChain, ForFetchingRate,
│   │   │                             #   ForPersistingObservations, ForReadingPendingObs,
│   │   │                             #   ForWritingBsmResults, ForReadingRate, ForReadingJobRuns
│   │   ├── fetchChain.ts             # new use-case
│   │   ├── fetchRate.ts              # new use-case
│   │   ├── computeBsmGreeks.ts       # new use-case
│   │   └── getStatus.ts              # extend: ForReadingJobRuns injected
│   ├── domain/
│   │   ├── bsm.ts                    # new: price, greeks, ncdf — pure functions
│   │   ├── iv-inversion.ts           # new: Newton-Raphson + bisection
│   │   └── rth-window.ts             # new: isWithinRth(now: Date): boolean
│   └── index.ts                      # re-export new types

packages/adapters/src/
├── http/
│   ├── cboe.ts                       # new: CBOE driven adapter (ForFetchingChain)
│   └── fred.ts                       # new: FRED driven adapter (ForFetchingRate)
├── memory/
│   ├── chain.ts                      # new: in-memory twin for ForFetchingChain
│   └── rate.ts                       # new: in-memory twin for ForFetchingRate
├── postgres/
│   └── repos/
│       ├── leg-observations.ts       # new: ForPersistingObservations + ForReadingPendingObs
│       ├── rate-observations.ts      # new: ForPersistingRate + ForReadingRate
│       ├── contracts.ts              # new: ForUpsertingContracts
│       └── job-runs.ts               # new: ForReadingJobRuns (query pgboss.job)
└── __contract__/
    ├── chain.contract.ts             # new: shared contract test for chain port
    └── rate.contract.ts              # new: shared contract test for rate port

packages/contracts/src/
└── status.ts                         # extend lastJobRuns from literal "none yet" to per-job shape

apps/worker/src/
├── main.ts                           # extend: register 3 jobs, RTH gating
├── config.ts                         # extend: Phase 2 tunables (DTE, strike band, q, r fallback)
└── handlers/
    ├── fetch-cboe-chain.ts           # new: thin handler (parse → use-case → map Result)
    ├── fetch-rates.ts                # new: thin handler
    └── compute-bsm-greeks.ts        # new: thin handler
```

### Pattern 1: CBOE Adapter with Zod-Parse-Before-Core

**What:** Fetch the delayed quotes JSON, Zod-parse the raw payload immediately, return `Result<ChainQuotes, FetchError>`. Core never sees raw HTTP or unvalidated shapes.
**When to use:** Any external HTTP adapter per architecture-boundaries.md §3.

```typescript
// Source: reference cboe.ts (D-05) + CBOE API shape [VERIFIED: cboe.ts source read]
// Endpoint: https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json
//           https://cdn.cboe.com/api/global/delayed_quotes/options/_SPXW.json
// No auth, no API key. 15-min delayed. Public CDN.

const CboeOptionSchema = z.object({
  option: z.string(),           // OSI symbol e.g. "SPX260515C00200000"
  bid: z.number().optional(),
  ask: z.number().optional(),
  iv: z.number().optional(),
  open_interest: z.number().optional(),
  volume: z.number().optional(),
  delta: z.number().optional(),
  gamma: z.number().optional(),
  vega: z.number().optional(),
  theta: z.number().optional(),
}).passthrough();                // keep extra fields, don't throw

const CboeResponseSchema = z.object({
  timestamp: z.string(),        // ISO string; use as observation time
  data: z.object({
    options: z.array(CboeOptionSchema),
    close: z.number().optional(),
    current_price: z.number().optional(),
    prev_day_close: z.number().optional(),
  }).passthrough(),
});

// Spot price resolution (in priority order):
// parsed.data.current_price ?? parsed.data.close ?? parsed.data.prev_day_close ?? 0
```

### Pattern 2: OSI → OCC Symbol Conversion

**What:** CBOE uses compact OSI (no padding): `"SPX260515C00200000"`. Morai's OCC symbol
format requires 21 chars with 6-char padded root: `"SPX   260515C00200000"`.
The existing `parseOccSymbol` / `formatOccSymbol` in `packages/shared` handles the Morai OCC format.
The CBOE-to-OCC bridge lives in the adapter.

```typescript
// Source: cboe.ts reference + shared/occ-symbol.ts [VERIFIED: both read]
// Walk from end: last 8 chars = strike×1000 (zero-padded), before that 1 char = C/P,
// before that 6 chars = YYMMDD, remainder = root (variable length, no padding in OSI).
function osiToOcc(osi: string): Result<OccSymbol, OccError> {
  if (osi.length < 15) return err({ kind: "WRONG_LENGTH", got: osi.length });
  const strikeStr = osi.slice(-8);
  const sideChar  = osi.slice(-9, -8);
  const dateStr   = osi.slice(-15, -9);
  const root      = osi.slice(0, osi.length - 15);
  // build 21-char padded symbol → formatOccSymbol({ root, expiry, type, strike })
}
```

**SPX vs SPXW root detection:** CBOE OSI for SPXW uses root `"SPXW"` (4 chars). SPX uses
`"SPX"` (3 chars). The root determines settlement style (D-04 + D-11). Store `contracts.root`
as the raw 3- or 4-char root without padding.

### Pattern 3: DTE Calculation (D-04)

**What:** T = (minutes to settlement cutoff) / (365.25 × 24 × 60). Settlement-aware.

```typescript
// Source: D-04 decision [CITED: 02-CONTEXT.md D-04]
// MINUTES_PER_YEAR = 365.25 * 24 * 60 = 525_960
const MINUTES_PER_YEAR = 365.25 * 24 * 60;

function minutesToCutoff(now: Date, expiry: Date, root: string): number {
  // PM-settled: SPXW (all) + SPX non-3rd-Friday → 16:00 ET on expiry date
  // AM-settled: SPX 3rd-Friday → 09:30 ET on expiry date
  // 3rd-Friday detection: month/year of expiry → third Friday
  const isAmSettled = root === 'SPX' && isThirdFriday(expiry);
  const cutoffHour = isAmSettled ? 9 : 16;
  const cutoffMin  = isAmSettled ? 30 : 0;
  // Build cutoff Date in ET, compute diff in minutes
}

function computeT(now: Date, expiry: Date, root: string): number {
  return Math.max(0, minutesToCutoff(now, expiry, root)) / MINUTES_PER_YEAR;
}
```

**Third-Friday detection (SPX AM settlement):** The third Friday of a month is the first
Friday that is ≥ 15th of the month. [ASSUMED]

### Pattern 4: Newton-Raphson IV Inversion + Bisection Fallback

**What:** Recover σ from (mark, S, K, T, r, q, type) using Newton-Raphson with analytic
vega, falling back to bisection when vega < threshold or Newton diverges.

```typescript
// Source: BSM derivation + reference bsm.ts + macroption.com formulas [CITED: macroption.com]
const VEGA_THRESHOLD = 1e-8;  // below this, NR would divide near-zero
const MAX_ITER = 50;
const NR_TOL = 1e-10;         // sigma convergence (price residual << 1e-6 follows)
const BISECT_LO = 0.001;
const BISECT_HI = 5.0;        // 500% vol upper bound covers any realistic SPX option

function invertIv(
  mark: number, S: number, K: number, T: number, r: number, q: number, type: 'C' | 'P'
): Result<number, IvError> {
  if (T <= 0) return err({ kind: 'expired' });
  const intrinsic = type === 'C' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (mark < intrinsic - 0.5) return err({ kind: 'below-intrinsic' });  // arbitrage
  const forward = S * Math.exp((r - q) * T);
  if (mark >= forward * Math.exp(-r * T)) return err({ kind: 'above-bound' }); // call

  // Brenner-Subrahmanyam initial guess: σ₀ ≈ (C/S) × √(2π/T)
  let sigma = (mark / S) * Math.sqrt(2 * Math.PI / T);
  if (!Number.isFinite(sigma) || sigma < BISECT_LO || sigma > BISECT_HI) sigma = 0.2;

  // Newton-Raphson phase
  for (let i = 0; i < MAX_ITER; i++) {
    const price = bsmPrice(S, K, T, sigma, r, q, type);
    const v = bsmVega(S, K, T, sigma, r, q);      // analytic, same for C/P
    if (v < VEGA_THRESHOLD) break;                 // → bisection fallback
    const delta = (price - mark) / v;
    sigma -= delta;
    if (sigma <= 0) { sigma = BISECT_LO; break; }
    if (sigma > BISECT_HI) { sigma = BISECT_HI; break; }
    if (Math.abs(delta) < NR_TOL) return ok(sigma);
  }

  // Bisection fallback — guaranteed to converge; covers NR failure + deep ITM/OTM/near-expiry
  let lo = BISECT_LO, hi = BISECT_HI;
  for (let i = 0; i < 200; i++) {  // 200 bisection steps → |hi-lo| < 5/(2^200) ≈ 0
    const mid = (lo + hi) / 2;
    if (bsmPrice(S, K, T, mid, r, q, type) > mark) hi = mid; else lo = mid;
    if (hi - lo < 1e-10) return ok((lo + hi) / 2);
  }
  return ok((lo + hi) / 2);
}
```

### Pattern 5: pg-boss Job Registration (v12 API)

**What:** Register scheduled and ad-hoc jobs in `apps/worker/src/main.ts`.

```typescript
// Source: timgit.github.io/pg-boss API docs [CITED: timgit.github.io/pg-boss/api/scheduling]
// pg-boss version installed: ^12.18.3

// Scheduling — 5-field cron, tz accepts IANA timezone strings
await boss.schedule('fetch-cboe-chain', '*/30 * * * 1-5', null, {
  tz: 'America/New_York',   // DST handled automatically
});
await boss.schedule('fetch-rates', '0 9 * * 1-5', null, {
  tz: 'America/New_York',
});
// Sparse fallback for compute (D-07):
await boss.schedule('compute-bsm-greeks', '0 10-16 * * 1-5', null, {
  tz: 'America/New_York',
});

// Handler registration — v10+ handler always receives array
// [CITED: github.com/timgit/pg-boss/releases/tag/10.0.0 breaking changes]
await boss.work('fetch-cboe-chain', { pollingIntervalSeconds: 30 }, async ([job]) => {
  if (job === undefined) return;
  const result = await fetchChainUseCase();
  if (!result.ok) {
    // throw to mark job failed; pg-boss will retry per retryLimit
    throw new Error(result.error.message);
  }
  // D-07: enqueue compute on successful persist
  await boss.send('compute-bsm-greeks', {});
});

// Job chaining — send() inside handler
await boss.send('compute-bsm-greeks', {}, { singletonKey: 'triggered-by-chain' });
// singletonKey: ensures only one queued+active job with that key at a time
```

**RTH self-check pattern (D-06):**
```typescript
function isWithinRth(now: Date): boolean {
  // Interpret now in ET
  const etMs = toEasternMs(now);
  const hour = Math.floor(etMs / 3600000) % 24;
  const min  = Math.floor(etMs / 60000) % 60;
  const totalMin = hour * 60 + min;
  const dow = new Date(etMs).getDay(); // 0=Sun, 6=Sat in ET
  if (dow === 0 || dow === 6) return false;
  return totalMin >= 9 * 60 + 30 && totalMin <= 16 * 60;
}
// Handler: if (!isWithinRth(new Date())) { console.warn('skip: outside RTH'); return; }
```

### Pattern 6: `lastJobRuns` via pgboss.job Query

**What:** Read last success/error per job from `pgboss.job` Postgres table — no new table needed.

```typescript
// Source: nerdleveltech.com pg-boss tutorial + pg-boss v10.0.0 schema changes
// [CITED: github.com/timgit/pg-boss/releases/tag/10.0.0]
// pgboss.job columns (v10+ snake_case): name, state, completed_on, output, started_on
// state values: 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed'

// Query for lastJobRuns — adapter lives in packages/adapters/postgres/repos/job-runs.ts
// Uses the existing `postgres` sql client (same pattern as other repos)
const query = sql`
  SELECT DISTINCT ON (name)
    name,
    state,
    completed_on,
    output   -- error message for failed state
  FROM pgboss.job
  WHERE name IN ('fetch-cboe-chain', 'fetch-rates', 'compute-bsm-greeks')
    AND state IN ('completed', 'failed')
  ORDER BY name, completed_on DESC NULLS LAST
`;
// Maps to: { [jobName]: { lastSuccessAt: Date|null, lastErrorAt: Date|null, lastError: string|null } }
```

**Retention note:** pg-boss retains completed jobs until `keepUntil` (default 14 days).
For Phase 2, the default retention is sufficient. If jobs run every 30 min, 14-day default
keeps ~672 recent records per job — more than enough for status reads. [ASSUMED]

### Pattern 7: Postgres Numeric NaN (D-09)

**What:** Write `bsm_iv = 'NaN'` to mark unsolvable IV. Drizzle maps `numeric` columns to
TypeScript `string`, so the string `'NaN'` passes through correctly.

```typescript
// Source: Drizzle + postgres.js behavior [ASSUMED — verified by reasoning from type mapping]
// Drizzle numeric → TS string; Postgres numeric accepts literal 'NaN' as special value

// Write NaN stamp:
await db.update(legObservations)
  .set({ bsmIv: 'NaN', bsmDelta: 'NaN', bsmGamma: 'NaN', bsmTheta: 'NaN', bsmVega: 'NaN' })
  .where(and(eq(legObservations.time, obs.time), eq(legObservations.contract, obs.contract)));

// Query NaN rows:
const pending = await db.select()
  .from(legObservations)
  .where(sql`bsm_iv = 'NaN'::numeric`);
// DO NOT use eq(legObservations.bsmIv, 'NaN') — Drizzle may not cast correctly
// Use sql template to force the ::numeric cast

// The partial index for pending compute:
// WHERE bsm_iv IS NULL AND mark IS NOT NULL
// NaN-stamped rows are NOT NULL, so they fall out of the pending scan — correct behavior (D-09)
```

### Anti-Patterns to Avoid

- **Copying trade-advisor code verbatim:** D-05 explicitly forbids it. The reference uses module-level cache, hardcoded r/q, no `Result`, and returns `null` on failure — all violate strict-TS rules.
- **Calling `boss.schedule()` inside a handler:** Schedule is idempotent and should only be called at boot (main.ts). Handlers call `boss.send()` for chaining, not `boss.schedule()`.
- **Writing `bsmIv = NaN` (JS NaN):** JS `NaN` is a float; Drizzle would serialize it incorrectly. Must use the string `'NaN'`.
- **Using `Date.now()` in domain functions:** Core must be pure. Pass `now: Date` as a parameter.
- **Storing spot price at fetch time only once:** CBOE payload carries `data.current_price` which is the spot at the payload timestamp. Use `parsed.timestamp` as `leg_observations.time`, not wall-clock.
- **Assuming `pgboss.job` is always populated:** Jobs are only in `pgboss.job` once they have run. First deploy will return empty `lastJobRuns`; status code must handle nulls gracefully.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP mocking in tests | Custom fetch stub | `msw` | msw intercepts at the node:http layer; retry/backoff/429 paths test correctly |
| Cron expression parsing | Custom scheduler loop | `pg-boss schedule()` | pg-boss uses `cron-parser` internally; DST, leap seconds handled |
| Job deduplication | Custom lock table | `pg-boss singletonKey` | pg-boss serializes this via Postgres advisory locks |
| Testcontainer Postgres lifecycle | Custom Docker spawn | `@testcontainers/postgresql` | Already used in Phase 1; contract-test harness established |
| OCC symbol parse/format | Custom string parse | `parseOccSymbol` / `formatOccSymbol` in `packages/shared` | Already exists, tested, handles branding |

**Key insight:** The entire job scheduling, retry, and deduplication layer is pg-boss's job — do not replicate any of it in application code.

---

## BSM Reference Fixtures (≥3 required by BSM-02, tolerance 1e-4)

All values computed in this research session using the reference `ncdf` approximation from
`bsm.ts` (A&S 7.1.26 5-term polynomial, max error ~1.5e-7 per CDF evaluation).
[CITED: trade-advisor bsm.ts read + macroption.com formulas]

### Fixture 1 — Hull Textbook Classic (q=0 baseline)

Parameters: S=42, K=40, T=0.5yr, r=0.10, sigma=0.20, q=0.0

| Metric | Value | Notes |
|--------|-------|-------|
| Call price | 4.7594 | Hull "Options, Futures, and Other Derivatives" ~4.76 [CITED: Hull, confirmed by formula] |
| Put price | 0.8086 | |
| d1 | 0.769263 | |
| d2 | 0.627841 | |
| Call delta (Δ) | 0.779131 | ∈ [0,1] ✓ |
| Put delta (Δ) | −0.220869 | ∈ [−1,0] ✓ |
| Gamma (Γ) | 0.049963 | ≥ 0 ✓ |
| Theta call/day | −0.012482 | Negative (decay) ✓ |
| Vega per vol pt | 0.088134 | ≥ 0 ✓ |

### Fixture 2 — SPX-Like ATM with Continuous Dividend (q=1.3%)

Parameters: S=100, K=100, T=1.0yr, r=0.05, sigma=0.20, q=0.013

| Metric | Value | Notes |
|--------|-------|-------|
| Call price | 9.6439 | |
| Put price | 6.0584 | |
| d1 | 0.285000 | |
| d2 | 0.085000 | |
| Call delta (Δ) | 0.604271 | ∈ [0,1] ✓ |
| Put delta (Δ) | −0.382813 | ∈ [−1,0] ✓ |
| Gamma (Γ) | 0.018906 | ≥ 0 ✓ |
| Theta call/day | −0.015153 | Negative ✓ |
| Theta put/day | −0.005645 | |
| Vega per vol pt | 0.378117 | ≥ 0 ✓ |

### Fixture 3 — OTM Put, SPX-Like (realistic operational scenario)

Parameters: S=100, K=95, T=0.25yr, r=0.045, sigma=0.18, q=0.013

| Metric | Value | Notes |
|--------|-------|-------|
| Call price | 7.0710 | |
| Put price | 1.3327 | |
| d1 | 0.703814 | |
| d2 | 0.613814 | |
| Call delta (Δ) | 0.756762 | ∈ [0,1] ✓ |
| Put delta (Δ) | −0.239993 | ∈ [−1,0] ✓ |
| Gamma (Γ) | 0.034490 | ≥ 0 ✓ |
| Theta call/day | −0.021056 | Negative ✓ |
| Theta put/day | −0.013031 | |
| Vega per vol pt | 0.155204 | ≥ 0 ✓ |

**Tolerance guidance:** Tests assert `|computed - fixture| ≤ 1e-4` per greek. Fixtures computed
with the same ncdf approximation that will be used in Morai's BSM implementation, so rounding
differences are only in the final reported digit. The 1e-4 tolerance provides 3+ orders of margin.

**Cross-check:** Fixture 1 call price 4.7594 matches Hull's textbook value (~4.76) to within
rounding from the stated parameters. [CITED: Hull "Options, Futures, and Other Derivatives", Chapter 15]

---

## FRED Rate Adapter

### Options Analysis

The FRED API requires an API key for the JSON endpoint (`api.stlouisfed.org/fred/series/observations`).
[CITED: fred.stlouisfed.org/docs/api/fred/v2/api_key.html]

A no-key CSV gateway exists at `ivo-welch.org/professional/fredcsv.html` (`/cgi-bin/fredwrap?symbol=DGS3MO`), but this is a third-party proxy with no published SLA.

**Recommendation (Claude's Discretion):** Use the official FRED JSON API with the API key that
already exists in trade-advisor `.env` (`FRED_API_KEY`). This is the most reliable approach.
Add `FRED_API_KEY` as an optional env var in the Zod config — when absent, the adapter skips
fetch and uses the 4.5% fallback immediately (acceptable since the fallback is already required
for network failures). This keeps Railway env minimal per D-13.

```typescript
// FRED API endpoint (requires api_key):
// https://api.stlouisfed.org/fred/series/observations
//   ?series_id=DGS3MO
//   &api_key=<key>
//   &file_type=json
//   &sort_order=desc
//   &limit=5                  // latest 5 business days; we want most recent non-"." value
//   &observation_start=<date> // optional date filter

// Response shape:
// { observations: [{ date: "2026-06-09", value: "5.25" }, ...] }
// Missing value marker: "." (holidays, weekends) — skip these rows

// Rate selection: most recent observation where value !== "."
// Match to leg_observation: latest rate_observations.date <= observation.time::date
```

**Missing value handling:** FRED uses `"."` for dates where no data exists (weekends,
holidays). The adapter must filter these out and take the most recent non-`"."` value.
[CITED: fred.stlouisfed.org search results + FRED API docs reference]

---

## CBOE Adapter Details

### Endpoint and Response Shape

[VERIFIED: cboe.ts reference read] — Direct source read, highest confidence.

```
URL: https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json
     https://cdn.cboe.com/api/global/delayed_quotes/options/_SPXW.json
Auth: None required
Delay: ~15 minutes
Rate: No documented rate limit; reference uses User-Agent header. Add 1-2 second minimum
      between SPX and SPXW fetches.

Response top-level:
{
  "timestamp": "2026-06-10T14:32:00",   // ISO-like string; use as observation time
  "data": {
    "current_price": 5432.10,           // spot — may be null
    "close": 5430.00,                   // prior close — fallback for spot
    "prev_day_close": 5410.00,          // day-before close — second fallback
    "options": [
      {
        "option": "SPX260515C00200000",  // compact OSI (no root padding)
        "bid": 3230.10,
        "ask": 3233.00,
        "iv": 0.1523,                   // vendor IV (unused for BSM; stored as raw)
        "open_interest": 1234,
        "volume": 56,
        "delta": 0.9945,
        "gamma": 0.0001,
        "vega": 0.1523,
        "theta": -1.2300
      },
      ...                               // ~20k contracts for SPX
    ]
  }
}
```

**SPX vs SPXW in the same payload:** The `_SPX.json` endpoint contains SPX-root contracts
only. `_SPXW.json` contains SPXW-root contracts only. Fetch both URLs; their timestamps
will be close but may differ slightly. Use each payload's `timestamp` field for the
`leg_observations.time` of that root's contracts.

**Fetch both in parallel:** Both fetches are independent. `Promise.all([fetchSPX(), fetchSPXW()])`.

**Spot price from payload:** D-04 requires spot for DTE/strike filtering. Use
`current_price ?? close ?? prev_day_close`. If all null, log and abort with `Result.err`.

**Contract filtering (MKT-03):**
```typescript
function isInFilter(contract: CboeContract, spot: number, maxDte: number, strikeBandPct: number): boolean {
  const dte = computeDte(now, contract.expiry);  // calendar-day approximation for filter only
  if (dte > maxDte) return false;
  const bandLo = spot * (1 - strikeBandPct);
  const bandHi = spot * (1 + strikeBandPct);
  return contract.strike >= bandLo && contract.strike <= bandHi;
}
// DTE for FILTERING only can use calendar-day integer (< 90 day check)
// Full T in years (D-04 precision) is needed only in BSM computation
```

---

## RTH Cron Expressions

[CITED: computed, D-06 decision]

14 observation slots per day: 09:30, 10:00, 10:30, ..., 15:30, 16:00 ET.

**Recommended approach:** Single cron expression `'*/30 * * * 1-5'` fires every 30 min Mon–Fri
(including nights, but outside RTH calls are no-ops per the handler RTH self-check in D-06).
This is simpler than two expressions and the RTH guard catches any misfire.

Alternative (two expressions, strictly no outside-RTH fires):
```
'30 9 * * 1-5'      — 09:30 ET
'0,30 10-16 * * 1-5' — 10:00, 10:30 ... 15:30, 16:00 ET (16:30 fires but handler no-ops)
```

**Rate fetch:** `'0 9 * * 1-5'` — once daily at 09:00 ET (before market open; no RTH restriction).

**BSM compute fallback (D-07):** `'0 10-16 * * 1-5'` — hourly sweep during RTH.

**DST handling:** `tz: 'America/New_York'` in `boss.schedule()` options handles DST transitions
automatically. [CITED: timgit.github.io/pg-boss/api/scheduling]

---

## `statusResponse` Schema Change

The current `statusResponse` in `packages/contracts/src/status.ts`:
```typescript
lastJobRuns: z.literal("none yet")
```

Must become (D-10):
```typescript
const jobRunRecord = z.object({
  lastSuccessAt: z.string().datetime().nullable(),
  lastErrorAt:   z.string().datetime().nullable(),
  lastError:     z.string().nullable(),
});

lastJobRuns: z.union([
  z.literal("none yet"),
  z.record(z.string(), jobRunRecord),  // key = job name
])
```

**Ripple:** `packages/contracts/src/status.ts` → `packages/core/src/journal/application/getStatus.ts`
(StatusPayload type) → `apps/server` HTTP route + MCP tool tests. All must change in the same
PR per MCP-02 rule.

**Backward compat in production:** The `GET /api/status` response changes shape. Since the only
consumer is Claude Code (MCP) and manual curl, no versioned API concern in Phase 2.

---

## Common Pitfalls

### Pitfall 1: CBOE `timestamp` Field Format

**What goes wrong:** `parsed.data.timestamp` may not be a valid ISO 8601 string. The reference
payload shows `"2026-06-10T14:32:00"` without timezone — this is ET local time, not UTC.
If stored directly as a timestamptz, Postgres may interpret it as UTC.
**Why it happens:** CBOE serves ET timestamps without a `Z` or offset suffix.
**How to avoid:** Append the ET offset or convert to UTC before storing.
Use a helper: `new Date(cboeTimestamp + ' America/New_York')` or Intl.DateTimeFormat.
**Warning signs:** `leg_observations.time` values that are 4-5 hours before the actual fetch
time (UTC offset confusion).

### Pitfall 2: pg-boss v12 Handler Array

**What goes wrong:** Handler receives an array even when `batchSize` is 1. Code that treats
the first argument as a single job (`async (job) => { job.data... }`) will see `job` as `Job[]`
and `job.data` will be undefined.
**Why it happens:** pg-boss v10+ breaking change standardized to array signature.
[CITED: github.com/timgit/pg-boss/releases/tag/10.0.0]
**How to avoid:** Always destructure: `async ([job]) => { ... }`. Guard: `if (job === undefined) return;`
**Warning signs:** `TypeError: Cannot read properties of undefined (reading 'data')` in worker logs.

### Pitfall 3: CBOE Spot Price Null

**What goes wrong:** All three spot price fields (`current_price`, `close`, `prev_day_close`)
are `null` or absent in rare CBOE responses (pre-market, outages).
**Why it happens:** CBOE CDN occasionally returns partial payloads.
**How to avoid:** If spot is 0 or null after the fallback chain, return `Result.err` and do not
persist. Log the payload timestamp. The handler should record the error in `lastJobRuns.lastErrorAt`.
**Warning signs:** `leg_observations.underlying_price = 0` rows in the database.

### Pitfall 4: Numeric NaN vs JS NaN

**What goes wrong:** Passing JavaScript `NaN` (a float) to Drizzle writes an empty string or
throws, not Postgres numeric NaN.
**Why it happens:** postgres.js serializes JS `NaN` as an empty string for numeric parameters.
[ASSUMED — based on postgres.js type mapping behavior]
**How to avoid:** Pass the string `'NaN'` (not `NaN`). Check via `typeof bsmIv === 'string' && bsmIv === 'NaN'` when reading.
**Warning signs:** Empty string in `bsm_iv` column, or Drizzle insert errors mentioning invalid numeric.

### Pitfall 5: BSM Vega Near Zero for Extreme Options

**What goes wrong:** Newton-Raphson divides by near-zero vega for deep ITM/OTM options or near
expiry, producing divergent sigma values (negative or >> 5.0).
**Why it happens:** Vega → 0 as |d1| → ∞ or T → 0.
**How to avoid:** Check `vega < VEGA_THRESHOLD` before each NR step and break to bisection.
The bisection fallback must be tested — D-03 explicitly requires property tests covering it.
**Warning signs:** `bsm_iv` values > 10.0 (1000% vol) or negative after compute job.

### Pitfall 6: `pgboss.job` Incomplete on First Deploy

**What goes wrong:** `GET /api/status` queries `pgboss.job` before any job has run; the query
returns zero rows; `lastJobRuns` shows nulls for all jobs.
**Why it happens:** pg-boss only writes to `pgboss.job` after a job has been scheduled and
attempted. On first deploy, jobs are scheduled but not yet run.
**How to avoid:** The `ForReadingJobRuns` adapter must return `null` (not throw) when no rows
exist. `StatusPayload.lastJobRuns` should gracefully represent "never run" — keep the `z.literal("none yet")` as the initial state, upgrading to per-job records once data exists.
**Warning signs:** Status endpoint 500 errors on first deploy.

### Pitfall 7: FRED "." Missing Value

**What goes wrong:** Selecting the latest `rate_observations` row to get today's rate, but the
most recent FRED record is a `"."` (holiday/weekend) that was stored accidentally.
**Why it happens:** FRED API returns `"."` for dates with no observation; code that doesn't
filter these before upsert stores nullish values.
**How to avoid:** Before upserting to `rate_observations`, filter out any observation where
`value === '.'`. The rate for weekends is the most recent prior business day.
**Warning signs:** `rate_observations.rate = null` rows.

---

## Code Examples

### BSM Price Function (full, with dividend yield)

```typescript
// Source: macroption.com BSM formulas + reference bsm.ts [CITED: both]
// packages/core/src/journal/domain/bsm.ts

// A&S 7.1.26 approximation — max |error| ~ 1.5e-7 (sufficient for 1e-6 round-trip)
function ncdf(x: number): number {
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741;
  const a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-ax*ax);
  return 0.5*(1 + sign*y);
}

function npdf(x: number): number {
  return Math.exp(-0.5*x*x) / Math.sqrt(2*Math.PI);
}

export function bsmPrice(S: number, K: number, T: number, sigma: number,
                          r: number, q: number, type: 'C' | 'P'): number {
  if (T <= 0) return type === 'C' ? Math.max(S-K, 0) : Math.max(K-S, 0);
  const sqT = Math.sqrt(T);
  const d1  = (Math.log(S/K) + (r - q + sigma*sigma/2)*T) / (sigma*sqT);
  const d2  = d1 - sigma*sqT;
  if (type === 'C') return S*Math.exp(-q*T)*ncdf(d1) - K*Math.exp(-r*T)*ncdf(d2);
  return K*Math.exp(-r*T)*ncdf(-d2) - S*Math.exp(-q*T)*ncdf(-d1);
}

export type BsmGreeks = {
  readonly delta: number;   // e^(-qT)*N(d1) for call; e^(-qT)*(N(d1)-1) for put
  readonly gamma: number;   // e^(-qT)*n(d1) / (S*sigma*sqrt(T))
  readonly theta: number;   // per calendar day, per 365.25-day year (D-04) — negative = decay
  readonly vega:  number;   // per 1 vol point (i.e., dV/d(sigma*100) = S*e^(-qT)*n(d1)*sqrt(T)/100)
};

export function bsmGreeks(S: number, K: number, T: number, sigma: number,
                           r: number, q: number, type: 'C' | 'P'): BsmGreeks {
  const sqT = Math.sqrt(T);
  const d1  = (Math.log(S/K) + (r - q + sigma*sigma/2)*T) / (sigma*sqT);
  const d2  = d1 - sigma*sqT;
  const eqT = Math.exp(-q*T);
  const erT = Math.exp(-r*T);
  const nd1 = npdf(d1);

  const delta = type === 'C' ? eqT*ncdf(d1) : eqT*(ncdf(d1)-1);
  const gamma = eqT*nd1 / (S*sigma*sqT);

  // Theta: annual rate / 365.25 per D-04
  const thetaAnnual = type === 'C'
    ? -S*eqT*nd1*sigma/(2*sqT) - r*K*erT*ncdf(d2)  + q*S*eqT*ncdf(d1)
    : -S*eqT*nd1*sigma/(2*sqT) + r*K*erT*ncdf(-d2) - q*S*eqT*ncdf(-d1);
  const theta = thetaAnnual / 365.25;

  // Vega: per 1 vol point (sigma = decimal, 1 vol point = 0.01)
  const vega = S*eqT*nd1*sqT / 100;

  return { delta, gamma, theta, vega };
}

export function bsmVega(S: number, K: number, T: number, sigma: number,
                         r: number, q: number): number {
  // Analytic vega without /100 — used by IV inversion denominator
  const sqT = Math.sqrt(T);
  const d1  = (Math.log(S/K) + (r - q + sigma*sigma/2)*T) / (sigma*sqT);
  return S*Math.exp(-q*T)*npdf(d1)*sqT;
}
```

### fast-check Property Test Skeleton

```typescript
// Source: fast-check v4 API + Phase 1 fc.date() lessons from STATE.md
// packages/core/src/journal/domain/bsm.test.ts

import fc from 'fast-check';
import { bsmPrice, invertIv } from './bsm.ts';

it('BSM-01: round-trip |recomputed_mark - input_mark| ≤ 1e-6 for 1000+ inputs', () => {
  fc.assert(fc.property(
    fc.float({ min: 500,  max: 8000,  noNaN: true }),  // S (SPX-like spot)
    fc.float({ min: 400,  max: 9000,  noNaN: true }),  // K
    fc.float({ min: 0.01, max: 2.0,   noNaN: true }),  // T (years)
    fc.float({ min: 0.05, max: 3.0,   noNaN: true }),  // sigma
    fc.constantFrom('C' as const, 'P' as const),
    (S, K, T, sigma, type) => {
      const r = 0.045, q = 0.013;
      const mark = bsmPrice(S, K, T, sigma, r, q, type);
      const ivResult = invertIv(mark, S, K, T, r, q, type);
      if (!ivResult.ok) return; // below-intrinsic / degenerate — skip
      const recovered = bsmPrice(S, K, T, ivResult.value, r, q, type);
      expect(Math.abs(recovered - mark)).toBeLessThanOrEqual(1e-6);
    },
    { numRuns: 1000 }
  ));
});

it('BSM-01: monotonicity — higher sigma → higher BSM price', () => {
  fc.assert(fc.property(
    fc.float({ min: 500, max: 8000, noNaN: true }),
    fc.float({ min: 500, max: 8000, noNaN: true }),
    fc.float({ min: 0.01, max: 1.5, noNaN: true }),
    fc.float({ min: 0.01, max: 2.0, noNaN: true }),  // sigmaLo
    fc.float({ min: 0.01, max: 1.0, noNaN: true }),  // sigmaIncrease
    fc.constantFrom('C' as const, 'P' as const),
    (S, K, T, sigmaLo, inc, type) => {
      const r = 0.045, q = 0.013;
      const sigmaHi = sigmaLo + inc;
      const priceLo = bsmPrice(S, K, T, sigmaLo, r, q, type);
      const priceHi = bsmPrice(S, K, T, sigmaHi, r, q, type);
      expect(priceHi).toBeGreaterThanOrEqual(priceLo);
    },
    { numRuns: 1000 }
  ));
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pg-boss single job handler | Array handler `([job])` | v10.0.0 (Aug 2024) | Phase 2 must use array destructure |
| `onComplete` completion jobs | Dead letter queues | v10.0.0 | Do not use `onComplete`; it was removed |
| `teamSize`/`teamConcurrency` work options | `batchSize`/`pollingIntervalSeconds` | v10.0.0 | Phase 2 uses new option names |
| CBOE `_SPX.json` contains both roots | Two separate endpoints: `_SPX.json` and `_SPXW.json` | [ASSUMED — reference `cboe.ts` only shows SPX] | Fetch both; reference only shows single-root fetch |
| drizzle-orm `numeric` as JS `number` | drizzle-orm `numeric` as TypeScript `string` | Drizzle v0.20+ | Must pass string `'NaN'`, not JS `NaN` |

**Deprecated/outdated in pg-boss (from v10.0.0 release notes):**
- `onComplete()`, `offComplete()`, `fetchCompleted()` — removed; use DLQ pattern instead
- `teamSize`, `teamConcurrency`, `teamRefill` work options — removed
- `noScheduling` constructor option — renamed to `schedule: false`
- camelCase column names in `pgboss.job` — renamed to snake_case (`completed_on` not `completedOn`)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | SPXW endpoint is `_SPXW.json` (separate from `_SPX.json`) | CBOE Adapter Details | Planner may spec wrong URL; verify against live endpoint or CBOE docs before implementing |
| A2 | Third-Friday SPX AM-settlement detection: first Friday ≥ 15th of month | Pattern 3 (DTE) | AM/PM settlement cutoff wrong for some SPX expirations; verify against CBOE expiration calendar |
| A3 | pg-boss retains completed jobs 14 days by default | Pattern 6 | lastJobRuns query returns empty; may need explicit retentionDays config in createQueue() |
| A4 | FRED "." is the missing-value sentinel across all DGS3MO observations | FRED Rate Adapter | Rate adapter skips valid data; verify against a FRED API response |
| A5 | Drizzle numeric → TypeScript string; JS NaN fails silently | Pattern 7 (Numeric NaN) | bsm_iv writes fail or store wrong values; add an integration test to verify NaN roundtrip |
| A6 | slopcheck unavailable — pg-boss and msw legitimacy assessed from npm registry age and source repos only | Package Audit | Extremely low risk given 10-year and 8-year package histories; but technically [ASSUMED] for slopcheck verdict |
| A7 | CBOE payload `timestamp` is ET local time (no timezone suffix) | Pitfall 1 | UTC confusion in stored observations; validate with a live payload sample |

---

## Open Questions (RESOLVED)

1. **SPXW endpoint URL**
   - **RESOLVED (planning)** — Wave 0 live smoke check (Plan 02-01 Task 3) fetches `_SPXW.json` and records the finding in `packages/adapters/test/fixtures/README.md`; Plan 02-04 Task 1 implements per the recorded finding (separate `_SPXW.json` endpoint, or filter SPXW root from `_SPX.json`). If the synthetic-fixture fallback is taken, the README flags the question STILL OPEN and the Plan 02-04 executor must confirm the endpoint live before adapter work.
   - What we know: reference `cboe.ts` only fetches `_SPX.json` with `root` parameter; no SPXW-specific code
   - What's unclear: whether `_SPXW.json` is the correct endpoint or whether SPXW contracts appear in `_SPX.json`
   - Recommendation: Verify by fetching `https://cdn.cboe.com/api/global/delayed_quotes/options/_SPXW.json` in a Wave 0 smoke test; fall back to filtering OSI symbols for "SPXW" root in the `_SPX.json` payload if the endpoint doesn't exist

2. **pg-boss CBOE payload — should jobs carry payload or be zero-data?**
   - **RESOLVED** — zero-data jobs adopted. Plan 02-07 handlers carry no market-data payload (no 20k-contract serialization); handlers use the v12 array signature with `if (job === undefined) return` guard and call use-cases that read from the DB. Chaining uses `boss.send('compute-bsm-greeks', {}, { singletonKey: 'triggered-by-chain' })` per D-07.
   - What we know: `boss.send('compute-bsm-greeks', {})` with empty payload works; the use-case reads from DB not job payload
   - What's unclear: `fetch-cboe-chain` payload shape — should it carry the fetched result or just trigger the use-case to refetch?
   - Recommendation: Jobs carry no market-data payload (no JSON serialization of 20k contracts). Handler calls use-case which fetches, persists, and returns. Payload schema is `z.object({})`.

3. **FRED API key absence during Phase 2 development**
   - **RESOLVED** — `FRED_API_KEY` is an optional field in the worker Zod config (Plan 02-07 Task 2, D-13); the FRED adapter falls back to 4.5% immediately when the key is absent and logs the fallback (Plan 02-05 Task 1, asserted by test); all tests use msw so no live key is needed in development or CI.
   - What we know: `FRED_API_KEY` exists in trade-advisor `.env` (referenced in trade-advisor-inventory.md); not currently in Morai env
   - What's unclear: Whether to add it to Railway env now or rely on the 4.5% fallback during development
   - Recommendation: Add `FRED_API_KEY` as optional in Zod config (`z.string().optional()`); fallback to 4.5% immediately if absent. Ship with key for production; develop/test with msw mocks so no live key needed in test.

*Note on Assumption A3 (pg-boss 14-day retention):* tolerated as-is — the Plan 02-07 `lastJobRuns` query returns only the most recent completed/failed row per job and the repo returns an empty map (→ "none yet") when no rows exist, so shorter-than-expected retention degrades gracefully rather than erroring.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | All packages | ✓ | (project already uses) | — |
| Postgres (Supabase) | DB tests, production | ✓ | 16 (Supabase) | — |
| Docker (testcontainers) | Postgres contract tests | ✓ (Phase 1 confirmed) | Docker Desktop | TEST_DATABASE_URL escape hatch |
| `pg-boss` npm package | apps/worker | ✗ (not yet installed) | 12.18.3 | — (must install) |
| `msw` npm package | packages/adapters (tests) | ✗ (not yet installed) | 2.14.6 | — (must install) |
| CBOE CDN (live) | Production only | ✓ (public, no auth) | — | msw mock in tests |
| FRED API (live) | Production only | ✓ (requires API key) | — | 4.5% fallback + msw mock in tests |

**Missing dependencies with no fallback:**
- `pg-boss` must be installed in `apps/worker/package.json`
- `msw` must be installed in `packages/adapters/package.json` (devDependencies)

**Missing dependencies with fallback:**
- FRED API key: 4.5% fallback covers missing key; msw covers tests

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4 (root vitest.config.ts with test.projects) |
| Config file | `vitest.config.ts` (root) + per-package `vitest.config.ts` |
| Quick run command | `bun run test --project @morai/core` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MKT-01 | CBOE adapter Zod-parses recorded fixture | msw/adapter | `bun run test --project @morai/adapters` | ❌ Wave 0 |
| MKT-01 | CBOE malformed payload yields Result.err | msw/adapter | same | ❌ Wave 0 |
| MKT-01 | In-memory twin passes chain contract test | unit | same | ❌ Wave 0 |
| MKT-02 | FRED 200 → numeric rate + upsert | msw/adapter | same | ❌ Wave 0 |
| MKT-02 | FRED unreachable → 4.5% fallback + logged | msw/adapter | same | ❌ Wave 0 |
| MKT-03 | Persist fixture chain: only in-filter rows, source='cboe', bsm_iv IS NULL | testcontainers | `bun run test --project @morai/adapters` | ❌ Wave 0 |
| MKT-03 | Duplicate persist adds zero rows | testcontainers | same | ❌ Wave 0 |
| BSM-01 | Price monotone in sigma (1000 runs) | fast-check/unit | `bun run test --project @morai/core` | ❌ Wave 0 |
| BSM-01 | Round-trip `\|recovered_mark - input_mark\| ≤ 1e-6` (1000 runs) | fast-check/unit | same | ❌ Wave 0 |
| BSM-01 | Degenerate inputs (mark < intrinsic, T=0) yield Result.err | unit | same | ❌ Wave 0 |
| BSM-01 | Bisection fallback path covered (deep ITM/near-expiry inputs) | unit | same | ❌ Wave 0 |
| BSM-02 | Fixture 1 greeks match reference ≤ 1e-4 | unit calibration | same | ❌ Wave 0 |
| BSM-02 | Fixture 2 greeks match reference ≤ 1e-4 | unit calibration | same | ❌ Wave 0 |
| BSM-02 | Fixture 3 greeks match reference ≤ 1e-4 | unit calibration | same | ❌ Wave 0 |
| BSM-02 | Call delta ∈ [0,1], put delta ∈ [-1,0] (fast-check) | fast-check/unit | same | ❌ Wave 0 |
| BSM-02 | Gamma ≥ 0, vega ≥ 0 (fast-check) | fast-check/unit | same | ❌ Wave 0 |
| BSM-03 | compute-bsm-greeks fills all 5 bsm_* columns on pending rows | testcontainers | `bun run test --project @morai/adapters` | ❌ Wave 0 |
| BSM-03 | Re-run is no-op (vendor columns unchanged) | testcontainers | same | ❌ Wave 0 |
| BSM-03 | Unsolvable IV → bsm_iv='NaN', row excluded from pending scan | testcontainers | same | ❌ Wave 0 |
| (sched) | Job handler tests pass with in-memory adapters | unit | `bun run test --project @morai/worker` | ❌ Wave 0 |
| (sched) | lastJobRuns in status shows per-job success/error | unit | same | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run test --project @morai/core` (fast, no Docker)
- **Per wave merge:** `bun run test` (full workspace including testcontainers)
- **Phase gate:** Full suite + `bun run typecheck` + `bun run lint` green before `/gsd-verify-work`

### Wave 0 Gaps

All test files are new this phase. Wave 0 must create:
- [ ] `packages/core/src/journal/domain/bsm.test.ts` — covers BSM-01, BSM-02
- [ ] `packages/core/src/journal/domain/iv-inversion.test.ts` — covers BSM-01 (bisection path)
- [ ] `packages/core/src/journal/application/computeBsmGreeks.test.ts` — covers BSM-03 (use-case with memory adapters)
- [ ] `packages/adapters/src/http/cboe.test.ts` — covers MKT-01 with msw
- [ ] `packages/adapters/src/http/fred.test.ts` — covers MKT-02 with msw
- [ ] `packages/adapters/src/postgres/repos/leg-observations.test.ts` — testcontainers, MKT-03 + BSM-03
- [ ] `packages/adapters/src/__contract__/chain.contract.ts` — shared contract for ForFetchingChain
- [ ] `packages/adapters/src/__contract__/rate.contract.ts` — shared contract for ForFetchingRate
- [ ] `apps/worker/src/handlers/fetch-cboe-chain.test.ts` — handler unit test with memory adapters
- [ ] Framework: `pg-boss` and `msw` must be added to respective package.json files before any test can run

---

## Security Domain

> `security_enforcement: true` and `security_asvs_level: 1` per config.json.

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No user auth in Phase 2 data pipeline |
| V3 Session Management | No | Stateless job handlers |
| V4 Access Control | Partial | CBOE/FRED are outbound only; `pgboss.job` table access must be confined to the `postgres` user already used by the app |
| V5 Input Validation | Yes | Zod schemas gate ALL external inputs: CBOE JSON, FRED JSON, job payloads |
| V6 Cryptography | No | No crypto operations |
| V7 Error Handling | Yes | No stack traces or raw error messages in HTTP responses or MCP tools |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed CBOE payload (injection/crash) | Tampering | `CboeResponseSchema.safeParse()` — returns `Result.err`, never throws to transport |
| FRED API key in logs | Info Disclosure | D-13: never log config values; only log field names on failure |
| Unbounded chain write (DoS via huge payload) | DoS | Chain filter (≤90 DTE, ±10% strike band) bounds the write volume at the use-case layer |
| pg-boss schema exposure | Elevation | `pgboss.job` is in a separate schema; app user needs SELECT on it for lastJobRuns; no GRANT beyond SELECT on that table |
| Replay attack on job handlers | Tampering | pg-boss deduplication via composite PK on `leg_observations` prevents duplicate rows |

---

## Sources

### Primary (HIGH confidence)

- Reference `cboe.ts` (READ) — endpoint URL, OSI format, response schema, spot fallback chain, 5-min cache pattern
- Reference `bsm.ts` (READ) — ncdf A&S coefficients, bsmCall/bsmPut formulas, bisection implementation, r=4.5%/q=1.3% defaults
- `packages/adapters/src/postgres/schema.ts` (READ) — exact column names, partial index SQL, enum values
- `packages/contracts/src/status.ts` (READ) — current shape to extend
- `packages/core/src/journal/application/getStatus.ts` (READ) — StatusPayload type, factory pattern
- `packages/shared/src/occ-symbol.ts` (READ) — OCC parse/format logic, 21-char format spec
- `apps/worker/src/main.ts` + `config.ts` (READ) — current worker boot pattern to extend
- pg-boss schedule() API — [CITED: timgit.github.io/pg-boss/api/scheduling]
- pg-boss v10 breaking changes — [CITED: github.com/timgit/pg-boss/releases/tag/10.0.0]
- pg-boss npm registry — [VERIFIED: npm registry] `pg-boss@12.18.3`
- msw npm registry — [VERIFIED: npm registry] `msw@2.14.6`

### Secondary (MEDIUM confidence)

- macroption.com BSM formulas — confirmed against reference bsm.ts implementation
- nerdleveltech.com pg-boss tutorial — work() array signature, schedule() tz example, pgboss.job query
- logsnag.com pg-boss deep-dive — singletonKey semantics
- FRED search results — API key requirement, `"."` missing value marker
- Wikipedia BSM model — formula structure cross-check

### Tertiary (LOW confidence / [ASSUMED])

- SPXW endpoint URL (`_SPXW.json`) — inferred from CBOE URL pattern, not directly confirmed
- pg-boss default retention 14 days — from training knowledge, not verified in v12 docs
- Drizzle numeric NaN behavior — reasoned from type mapping, not empirically tested
- Third-Friday AM-settlement detection algorithm — standard definition, implementation not verified

---

## Metadata

**Confidence breakdown:**
- CBOE adapter: HIGH — reference source code read directly
- BSM math formulas: HIGH — derived, cross-checked against reference implementation and textbook
- BSM calibration fixtures: HIGH — computed in this session using reference ncdf
- pg-boss v12 API: MEDIUM — official docs page fetched for schedule(); work() API from tutorial + release notes
- FRED API: MEDIUM — official docs returned 403; confirmed from search results + known API structure
- lastJobRuns via pgboss.job: MEDIUM — schema from search + tutorial; not verified against v12 live schema
- Postgres numeric NaN: MEDIUM — reasoned from Drizzle type mapping; not empirically tested

**Research date:** 2026-06-10
**Valid until:** 2026-07-10 (stable domain — BSM math doesn't change; pg-boss API stable across patch releases)
