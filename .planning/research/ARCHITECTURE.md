# Architecture Research — v1.3 Picker Intelligence Integration

**Domain:** Subsequent-milestone integration into an existing hexagonal (ports & adapters)
trading system — exit advisor, backtest harness, VIX3M ingestion
**Researched:** 2026-07-09
**Confidence:** HIGH (grounded in the actual codebase — `packages/core/src/{picker,journal,analytics}/**`,
the `picker_snapshot` idempotency repo, the `fix-pnl-reingest`/`backfill-transactions` CLI
precedent, and the pg-boss chain in `apps/worker`; this is an internal-architecture-fit question,
not a technology survey)

> Supersedes the previous (2026-07-03) contents of this file, which covered v1.2 (picker engine,
> events adapter, Overview/Analyzer redesign) — that work is shipped and live. See
> `.planning/milestones/` for the v1.2 archive if that history is needed.

## TL;DR — the four answers

1. **Exit rules own a NEW `exits` bounded context** (`packages/core/src/exits/`), sibling to
   `picker`. It is a *derived-read* context in the exact mould of `analytics`: it reads the
   position from `journal`, the current mark/greeks/P&L from the latest `calendar_snapshots` row,
   GEX from `analytics`, and events from `picker` — all through its own application ports
   (cross-context-via-ports, never a foreign `domain/` import). It writes verdicts; it never
   mutates journal state. This keeps `journal` a pure fills-source-of-truth and `picker` a pure
   entry-universe scorer, and gives the backtest two symmetric pure-domain replays (entry + exit).
2. **Verdicts get their own table `exit_verdicts`**, keyed `(observed_at, calendar_id)`, `jsonb`
   blob validated by a contracts Zod schema, `onConflictDoNothing` = first-write-wins per cohort
   per calendar. This is the proven `picker_snapshot` convention applied at a per-calendar grain.
   Do **not** extend `picker_snapshot` — different grain, different lifecycle, different context.
3. **The backtest runs as an operator CLI** (`apps/worker/src/backtest.ts`), following the
   `fix-pnl-reingest.ts` precedent — **not** a pg-boss job (no cadence, and the 900s handler cap
   fights a bulk history scan) and **not** a server route. It reuses the exact rule code because
   the rules are already pure functions (`selectCandidates` + `scoreCalendarCandidates`, plus the
   new `evaluateExit`): the CLI does all I/O up front, then replays history through those functions
   with zero ports touched in the loop.
4. **Build order: VIX3M ingestion → exit advisor → backtest → playbook crisis gates.** VIX3M
   moves *first and alone* (one array entry) precisely because `macro_observations` has no
   backfill — every day of delay is permanently lost history. Exit advisor is next (headline
   feature, uses only data that already flows). Backtest is third (it needs the exit rules to exist
   before it can validate them). The VIX-gated playbook rules land last, informed by both the
   accumulated VIX3M history and the backtest evidence.

## Standard Architecture

### System Overview — where the three features attach to the hexagon

```
┌──────────────────────────────────────────────────────────────────────────┐
│  DRIVING ADAPTERS (apps/)                                                  │
│  apps/server: HTTP routes + MCP tools    apps/worker: pg-boss handlers     │
│    GET /api/exits (NEW)                     compute-exit-advice (NEW job)   │
│    MCP get_exit_advice (NEW)                backtest.ts (NEW operator CLI)  │
├──────────────────────────────────────────────────────────────────────────┤
│  THE HEXAGON (packages/core/)                                              │
│                                                                            │
│   journal ───────┐   analytics ──┐   picker ────────┐   exits (NEW) ◀──┐   │
│   Calendar,      │   gex_snap,   │   entry universe,│   exit registry, │   │
│   snapshots,     │   skew, term  │   rules.ts,      │   HeldPosition,   │  │
│   fills, P&L     │               │   scoring.ts     │   ExitVerdict     │  │
│        │ reads (application ports only, never cross-context domain) ────┘   │
│        ▼         ▼               ▼                                          │
│   ForReadingLatestSnapshotPerOpenCalendar (NEW journal port)               │
│   ForReadingGexContext (reuse picker's shape)  ForReadingEconomicEvents    │
│   ForReadingOpenCalendars   ForPersistingExitVerdicts (NEW)                │
├──────────────────────────────────────────────────────────────────────────┤
│  DRIVEN ADAPTERS (packages/adapters/)                                      │
│  postgres: exit_verdicts repo (NEW) + memory twin (NEW) + contract test    │
│  fetchMacroSeries gains "VIXCLS3M" (one array entry)                       │
└──────────────────────────────────────────────────────────────────────────┘
```

The whole design principle: **all three features are additive derived-reads.** None of them
touches the journal's fills → events → P&L source-of-truth path, none mutates a position, and
none requires a change inside an existing context's `domain/`. That is what keeps the hexagon law
satisfied in every recommendation below.

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| `exits` context (NEW) | Own the exit-rule registry (playbook ladder) + evaluate open calendars into verdicts | `packages/core/src/exits/{domain,application}` — mirrors `picker`'s shape |
| `exit_verdicts` table (NEW) | Append-only history of per-calendar verdicts per cohort | Postgres repo + memory twin, `(observed_at, calendar_id)` PK |
| `compute-exit-advice` job (NEW) | Chain-triggered evaluation each picker cycle | Thin pg-boss handler after `compute-picker` |
| `backtest.ts` CLI (NEW) | Replay history through entry + exit domains, score per-rule predictive power | Operator CLI in `apps/worker`, not a job |
| VIX3M ingestion (MODIFIED) | Land `VIXCLS3M` into `macro_observations` | One entry in `fetchMacroSeries.ts` `FRED_SERIES` array |
| `journal` (reused, +1 port) | Source open calendars + latest snapshot marks/greeks/P&L | Existing `ForGettingOpenCalendars` + NEW `ForReadingLatestSnapshotPerOpenCalendar` |
| `analytics` (reused) | Supply GEX flip/walls for the GAMMA trigger | Existing GEX snapshot read |
| `picker` (reused) | Supply economic events; later consume VIX3M for crisis gates | Existing `ForReadingEconomicEvents` |

## Recommended Project Structure

```
packages/core/src/exits/                    # NEW bounded context (sibling to picker/)
├── domain/
│   ├── exit-rules.ts        # THE registry: playbook ladder as typed rows (mirrors picker/domain/rules.ts)
│   │                        #   +5/+10/+15% takes · −25/−50% stops · EVT/TERM/GAMMA · roll · theta-runway
│   ├── evaluate-exit.ts     # pure: (HeldPosition, MarketContext) → ExitVerdict  ← the replay entrypoint
│   ├── types.ts             # HeldPosition, MarketContext, ExitVerdict (HOLD|TAKE|STOP|ROLL|EXIT-pre-event)
│   └── *.test.ts            # fast-check on the numeric triggers (P&L%, theta runway) — tdd rule
├── application/
│   ├── ports.ts             # driven ports (local StorageError, journal/analytics/picker precedent)
│   └── computeExitAdvice.ts # use-case: read positions+marks+GEX+events → evaluate → persist
└── index.ts                 # public surface

packages/core/src/backtest/                 # NEW — thin, pure predictive-power math only
├── domain/
│   ├── predictive-power.ts  # rank-correlation / hit-rate of a score term vs realized P&L (pure, tested)
│   └── predictive-power.test.ts
└── index.ts                 # (no application/ports — the CLI owns orchestration & I/O)

apps/worker/src/backtest.ts                 # NEW operator CLI (fix-pnl-reingest.ts precedent)

packages/adapters/src/
├── postgres/repos/exit-verdicts.ts         # NEW repo + contract test
├── postgres/migrations/00NN_exit_verdicts.sql
└── memory/exit-verdicts.ts                 # NEW twin (architecture rule 8)

apps/server/src/adapters/{http,mcp}/exits.* # NEW route + MCP tool (architecture rule 9)
```

### Structure Rationale

- **`exits/` is its own context, not a folder inside `picker` or `journal`.** By data-gravity the
  exit advisor's inputs are ~80% journal-owned (the position, entry debit, current mark, and the
  P&L already computed into `calendar_snapshots.pnl_open`). The two remaining inputs (GEX, events)
  are already read cross-context by `analytics`/`picker` — so pulling them from `exits` is the
  established pattern, not new machinery. But putting exit logic *inside* journal would contaminate
  the "rebuilt from fills, never hand-edited" source-of-truth context with advisory opinion;
  putting it inside picker would bolt a real-position concept onto a context whose entire identity
  is scoring a *hypothetical* entry universe (no calendar id, no entry debit). A separate
  derived-read context — exactly what `analytics` already is — is the clean seam. It also gives the
  backtest two parallel pure-domain replays (picker entry + exits exit) instead of a replay that
  straddles picker-domain and journal-domain.
- **`backtest/` carries only pure math; orchestration lives in the CLI.** The backtest is a
  cross-context *analysis* — it replays `picker` + `exits` domains and joins to `journal` realized
  P&L. A core module may not import another context's `domain/`, so the join cannot live inside a
  core context. The `apps/worker` CLI *is* a composition root — apps may import every context's
  public `index.ts` — so the cross-context orchestration legally lives there. Only the reusable,
  testable numeric kernel (predictive power) sits in core, where the tdd rule can demand fast-check
  coverage of it.

## Architectural Patterns

### Pattern 1: Pure-domain replay (the backtest's whole reason to be cheap)

**What:** The entry rules are already pure functions. `computePickerSnapshot.ts` (the use-case)
does all the I/O through ports; `selectCandidates` + `scoreCalendarCandidates` (the domain) take
data in and return results with zero I/O. The backtest reuses the *domain* untouched and swaps the
*I/O source* from "latest cohort" to "every historical cohort."

**When to use:** Any time you need to run production decision logic over history. Build the exit
rules the same way — `evaluateExit(position, context)` pure — so the backtest treats exits
identically.

**Trade-offs:** Requires discipline that the loop touches no ports (all data pre-loaded). Pays for
itself: zero rule duplication, and any rule change is automatically reflected in the backtest.

```typescript
// apps/worker/src/backtest.ts  (composition root — may import multiple contexts' public surfaces)
import { selectCandidates, scoreCalendarCandidates } from "@morai/core"; // picker domain, unchanged
import { evaluateExit } from "@morai/core";                              // exits domain, unchanged

// 1. I/O PHASE (adapters) — read everything once, outside the loop
const cohorts = await readHistoricalCohorts();          // leg_observations grouped into 30-min slots
const events  = await readEconomicEvents();
const gexByCohort = await readHistoricalGex();
const closed  = await readClosedCalendarsWithRealizedPnl(); // the 13 validated-oracle calendars

// 2. PURE REPLAY (domain) — no ports touched here
for (const cohort of cohorts) {
  const { candidates } = selectCandidates(cohort.chain, events, params);
  const scored = scoreCalendarCandidates(candidates, gexByCohort.get(cohort.t) ?? null, params);
  // ...and for any position open at cohort.t: evaluateExit(position, contextAt(cohort.t))
}

// 3. SCORE (backtest domain) — did high-scoring terms track realized P&L?
const power = predictivePower(scored, closed);          // pure, fast-check tested
```

### Pattern 2: Derived-read context via application ports (exit advisor, following `analytics`)

**What:** `exits` reads other contexts' *data* through its own `ForVerbingNoun` driven ports,
re-declaring `StorageError` locally (journal/analytics/picker all do this today). It never imports
`journal/domain` or `analytics/domain`.

**When to use:** Every cross-context read in this milestone.

**Trade-offs:** Each new port needs a memory twin + Postgres repo + contract test in the same PR
(architecture rule 8). That is the cost of the boundary and it is non-negotiable here.

```typescript
// packages/core/src/exits/application/ports.ts  — imports ONLY @morai/shared
export type StorageError = { readonly kind: "storage-error"; readonly message: string };

// Position + its current mark/greeks/P&L — sourced from journal's latest calendar_snapshot + calendar row
export type ForReadingHeldPositions = () => Promise<Result<ReadonlyArray<HeldPosition>, StorageError>>;
// GEX context for the GAMMA trigger — mirror picker's GexContextForPicker shape (no cross-context import)
export type ForReadingGexContext = () => Promise<Result<GexContextForExits | null, StorageError>>;
export type ForReadingEconomicEvents = () => Promise<Result<ReadonlyArray<EconomicEvent>, StorageError>>;
export type ForPersistingExitVerdicts = (row: ExitVerdictRow) => Promise<Result<void, StorageError>>;
```

### Pattern 3: Cohort-clock idempotency (verdict persistence copies `picker_snapshot`)

**What:** The verdict row's `observed_at` is the **chain cohort's own quote time**, never `now()`.
Insert is `onConflictDoNothing` on the PK. A same-cohort re-trigger (observedAt does not advance)
is a silent no-op instead of PK-violating the terminal job into a retry loop — the exact WR-01
lesson the `picker_snapshot` repo already documents.

**When to use:** The `exit_verdicts` writer.

**Trade-offs:** First-write-wins means an in-cohort correction won't overwrite — correct for
append-only history, and consistent with how every derived table in this repo already behaves.

```sql
CREATE TABLE "exit_verdicts" (
  "observed_at" timestamptz NOT NULL,   -- the cohort clock (same instant the picker cycle used)
  "calendar_id" text        NOT NULL,
  "verdict"     jsonb        NOT NULL,   -- validated by a contracts Zod schema before insert
  PRIMARY KEY ("observed_at", "calendar_id")
);
-- insert: ON CONFLICT (observed_at, calendar_id) DO NOTHING  -- first-write-wins (WR-01), append-only
```

## Data Flow

### Exit-advice flow (runs each picker cycle)

```
fetch-schwab-chain → compute-bsm-greeks → snapshot-calendars → compute-analytics
     → compute-gex-snapshot → compute-picker → compute-exit-advice  (NEW terminal)
                                                       │
   reads (all already written this cycle):            │
     journal:   open calendars (openNetDebit, qty, front/back expiry, strike)
                + latest calendar_snapshots row per calendar (netMark, pnlOpen,
                  front/back IV, term_slope, net greeks, dteFront/dteBack, spot)
     analytics: latest gex_snapshot (flip, callWall, putWall, nearTerm)   → GAMMA trigger
     picker:    economic_events (FOMC/CPI/NFP)                             → EVT trigger
                                                       ▼
             evaluateExit(position, marketContext) per open calendar → ExitVerdict
                                                       ▼
             persist exit_verdicts (observed_at = cohort clock, first-write-wins)
```

**Why append after `compute-picker` (not parallel):** exit advice depends on `calendar_snapshots`
(from `snapshot-calendars`), `gex_snapshots`, and `economic_events` — **not** on picker's output.
It could run in parallel after `compute-gex-snapshot`. But the docs emphasise a single-trigger
linear chain (`fetch → bsm → snapshot → analytics → gex → picker`), so the lazy-correct move is:
`compute-picker` chain-enqueues `compute-exit-advice` as the new terminal job. Small latency cost,
preserves the invariant. Parallelize only if latency ever matters.

**Why no live leg re-resolve:** the latest `calendar_snapshots` row already carries `netMark`,
`pnlOpen`, front/back IV, `term_slope`, net greeks, and DTEs — everything the take/stop/TERM/
theta-runway rules need, computed and persisted one step earlier the *same* cycle by
`snapshot-calendars`. P&L% is just `(netMark − openNetDebit) / openNetDebit` (numerator on the
snapshot, denominator on the `Calendar` row). The advisor is a pure read over data that already
exists; it never calls Schwab/CBOE. That is why a new `ForReadingLatestSnapshotPerOpenCalendar`
journal port (snapshot row + `openNetDebit`/`qty` per open calendar) is the single new read the
exit advisor needs — not a live-chain resolver.

### Read flow (UI + MCP)

```
Analyzer held-positions panel  ─GET /api/exits→  getExitAdvice use-case
Claude Code  ─MCP get_exit_advice→               → read latest exit_verdicts per open calendar
                                                 → return verdict + triggered rules + P&L%
```

### VIX3M flow

```
fetch-rates (18:30 ET run) → fetchMacroSeries → FRED "VIXCLS3M" → macro_observations
   (one array entry; existing best-effort-per-series + (series_id,date) upsert unchanged)
        │
        └─ later: NEW macro→picker read port surfaces VIX + VIX3M to the crisis gates
           (VIX < 25 hard gate, VIX/VIX3M < 0.95 contango gate — the deferred picker-rules.md rows)
```

## Scaling Considerations

| Scale | Adjustments |
|-------|-------------|
| Today (1 trader, ~a dozen open calendars, chain since 2026-06-12) | Everything as described. Exit advice is a handful of pure evaluations per cycle; trivial. |
| Backtest over full `leg_observations` history | The only heavy read. Stream cohorts (don't load all rows at once) and hold the pre-loaded per-cohort context. This is exactly why it is a CLI, not a 900s-capped pg-boss handler. |
| More rules / longer history | Registry-driven scoring stays O(candidates × rules); backtest stays O(cohorts × candidates). No architectural change until history is years long. |

### Scaling Priorities

1. **First bottleneck: the backtest's history read**, not the compute. Chunk `leg_observations` by
   cohort and reuse the picker-chain cohort semantics (10-min lookback union, `DISTINCT ON
   (contract)` newest-wins) so one logical dual-source cycle isn't split or double-counted. Mirror
   `readLegObsForGex` / `picker-chain.ts` exactly.
2. **Second bottleneck: none realistic at this user count.** Do NOT build result-persistence
   infrastructure for the backtest until the "promote/demote weights with evidence" workflow
   actually needs stored runs. v1 emits a report to stdout/file.

## Anti-Patterns

### Anti-Pattern 1: Extending `picker_snapshot` to hold exit verdicts

**What people do:** Add a `verdicts[]` field to the picker snapshot blob "since it runs the same
cycle."
**Why it's wrong:** Different grain (per-calendar vs per-universe), different lifecycle (tied to
open positions vs the entry scan), and it couples the exit read path to picker's write path and
conflates two contexts in one row.
**Do this instead:** Own table `exit_verdicts` keyed `(observed_at, calendar_id)`, same idempotency
convention.

### Anti-Pattern 2: Reimplementing rule math in the backtest

**What people do:** Write a "backtest version" of the scoring so it can run over history.
**Why it's wrong:** Two sources of truth for the rules; they drift; the backtest then validates
something the live engine doesn't do.
**Do this instead:** Import and call the exact `selectCandidates` / `scoreCalendarCandidates` /
`evaluateExit`. They are already pure — feed them historical data. If a rule is *not* pure enough
to replay, that is a bug in the rule; fix it there.

### Anti-Pattern 3: Putting exit logic inside `journal`

**What people do:** "Journal owns the position, so put the advisor there."
**Why it's wrong:** Journal is the fills-source-of-truth context — "rebuilt from broker fills,
never hand-edited." Advisory logic that reads GEX/events and emits opinions does not belong in the
context whose discipline is *record only what actually happened*.
**Do this instead:** A separate derived-read `exits` context, reading journal position data through
a port — the same way `analytics` reads journal.

### Anti-Pattern 4: Running the backtest as a pg-boss job or server route

**What people do:** Reach for the job runner because "it's the worker."
**Why it's wrong:** No cadence, and the 900s handler cap (already a live hazard for the BSM drain)
throttles a full-history scan; a server route ties a long batch analysis to a request.
**Do this instead:** Operator CLI (`railway run bun run apps/worker/src/backtest.ts`) — the
`fix-pnl-reingest.ts` / `backfill-transactions.ts` precedent.

### Anti-Pattern 5: Deferring VIX3M ingestion until the gates are built

**What people do:** Bundle VIX3M into the playbook-port phase since that phase is what consumes it.
**Why it's wrong:** `macro_observations` persists only the latest value per day with **no
backfill** — every day without ingestion is permanently lost VIX3M history, and the crisis gates
plus their backtest both need history.
**Do this instead:** Land the one-line `VIXCLS3M` addition first, before its consumers exist, so
history starts accreting immediately.

## Integration Points

### New vs modified — explicit inventory

| Item | New / Modified | Where |
|------|----------------|-------|
| `exits` bounded context (domain registry, evaluate-exit, types, use-case, ports) | NEW | `packages/core/src/exits/` |
| `ForReadingLatestSnapshotPerOpenCalendar` (latest snapshot + openNetDebit/qty per open calendar) | NEW journal port | `journal/application/ports.ts` (+ memory twin + postgres repo + contract test) |
| `exit_verdicts` table + Postgres repo + memory twin + contract test | NEW | `packages/adapters/src/{postgres,memory}` + migration |
| `compute-exit-advice` pg-boss handler | NEW | `apps/worker/src/handlers/` |
| `compute-picker` handler → enqueue `compute-exit-advice` on success | MODIFIED (currently terminal) | `apps/worker/src/handlers/compute-picker.ts` + `schedule.ts` queue registration |
| `GET /api/exits` route + `get_exit_advice` MCP tool | NEW (architecture rule 9, same PR) | `apps/server/src/adapters/{http,mcp}/` |
| Exit-verdict + held-position Zod schemas | NEW | `packages/contracts/` |
| `backtest.ts` operator CLI | NEW | `apps/worker/src/` |
| `backtest` predictive-power domain (pure, fast-check tested) | NEW | `packages/core/src/backtest/domain/` |
| `VIXCLS3M` added to FRED series list | MODIFIED (one array entry) | `journal/application/fetchMacroSeries.ts` |
| macro→picker read port for VIX/VIX3M (crisis gates) | NEW (playbook-port phase) | picker application ports (+ twin + repo) |

### Internal boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `exits` ← `journal` | Application port (`ForReadingHeldPositions`) | Reads open calendars + latest snapshot; never imports `journal/domain` |
| `exits` ← `analytics` | Application port (`ForReadingGexContext`) | Re-declare a local `GexContextForExits` type, as picker did — no cross-context import |
| `exits` ← `picker` (events) | Application port (`ForReadingEconomicEvents`) | `economic_events` is picker-owned; read its data, not its domain |
| `backtest.ts` → picker/exits/journal | Public `index.ts` imports | Legal only because the CLI is a composition root (apps may import all contexts) |
| `compute-exit-advice` → use-case | Thin handler | Zod-guard → call use-case → throw on err. Zero business logic (architecture rule 3) |

### Suggested build order (with dependency rationale)

The milestone's stated order (PROJECT.md) is: exit advisor → backtest → playbook port. This
refines it by splitting the *cheap VIX3M ingestion* out of the playbook phase and moving it to the
front, for the no-backfill data-accretion reason.

1. **VIX3M ingestion** — one entry in `FRED_SERIES` (`fetchMacroSeries.ts`). No dependency; do it
   *first* so `VIXCLS3M` starts landing in `macro_observations` immediately (no backfill exists).
   Ships in an afternoon.
2. **Exit advisor** — the milestone headline. Depends only on data that already flows
   (`calendar_snapshots`, GEX, events). Delivers the exit rules the backtest needs. Build
   inward-out: domain registry (fast-check tested) → use-case + ports → table/repo/twin → wire into
   the chain → route + MCP + Analyzer held-positions panel.
3. **Backtest** — depends on **both** the entry domain (exists) and the exit domain (feature 2) so
   it can validate both. CLI + pure predictive-power kernel. Produces the evidence to promote
   experimental picker rules to scored (the PICK-04 gate `picker-rules.md` already references) and
   to weight the exit ladder.
4. **Playbook crisis gates** — the VIX < 25 / VIX/VIX3M < 0.95 gates + anti-criteria + sizing tiers
   + event-bucket. Land last: they consume the VIX3M history accumulating since step 1, and are
   best informed by step 3's backtest evidence. This is where the picker-rules.md deferred gates
   (and the new macro→picker read port) land.

## Sources

- `packages/core/src/picker/{domain,application}/*` — pure `selectCandidates`/`scoreCalendarCandidates`
  vs thin `computePickerSnapshot` orchestration (the replay-reuse basis) — HIGH
- `packages/adapters/src/postgres/repos/picker-snapshot.ts` + `picker-chain.ts` +
  `migrations/0015_picker_snapshot.sql` — append-only `onConflictDoNothing` cohort-clock
  idempotency (WR-01) and the cohort-union read semantics the backtest must mirror — HIGH
- `packages/core/src/journal/application/{ports.ts,snapshotCalendars.ts,getCalendarLifecycle.ts}` —
  open-calendar reads, `pnl_open`/`computeSnapshotPnl`, latest-snapshot semantics, the `Calendar`
  entity — HIGH
- `packages/core/src/journal/application/fetchMacroSeries.ts` — FRED series list (VIXCLS present,
  VIXCLS3M absent), best-effort-per-series + `(series_id,date)` upsert, no backfill — HIGH
- `apps/worker/src/{fix-pnl-reingest.ts,backfill-transactions.ts,handlers/compute-picker.ts}` —
  operator-CLI precedent + terminal chain-trigger pattern (compute-picker is currently terminal) — HIGH
- `docs/architecture/{hexagonal-ddd.md,jobs.md,picker-rules.md}`, `.claude/rules/architecture-boundaries.md` —
  cross-context-via-ports, memory-twin (rule 8), route+MCP-same-PR (rule 9), analytics-reads-journal
  precedent, deferred VIX gates — HIGH

---
*Architecture research for: v1.3 Picker Intelligence — exit advisor + backtest + VIX3M integration*
*Researched: 2026-07-09*
