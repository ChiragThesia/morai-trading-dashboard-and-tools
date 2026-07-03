# Architecture Research — v1.2 Integration

**Domain:** Subsequent-milestone integration into an existing hexagonal (ports & adapters)
trading system
**Researched:** 2026-07-03
**Confidence:** HIGH (grounded directly in `docs/architecture/*`, `packages/core/src/**/ports.ts`,
`packages/adapters/src/**`, and `apps/web/src/**` — no external ecosystem research needed; this
is an internal-architecture-fit question, not a technology survey)

> Supersedes the previous (2026-06-25) contents of this file, which covered the v1.1 sidecar
> integration — that work is shipped and live in prod. See `.planning/milestones/` for the v1.1
> archive if that history is needed.

## Standard Architecture (unchanged baseline)

```
Browser (apps/web, Vercel)          Claude Code (MCP)
        │ Hono RPC (contracts)              │ streamable HTTP
        ▼                                   ▼
┌──────────────────────────────────────────────────────┐
│ apps/server — Hono API + MCP (driving adapters)       │
│  routes/*.routes.ts        mcp/tools/*.ts             │
└───────────────┬───────────────────────┬────────────────┘
                │ calls                 │ calls
                ▼                       ▼
┌──────────────────────────────────────────────────────┐
│ packages/core  — the hexagon (framework-free)         │
│  <context>/domain/       pure functions, no I/O       │
│  <context>/application/  ports.ts + use-case factories│
│  contexts today: journal, analytics, brokerage,       │
│  streaming                                            │
└───────────────┬───────────────────────┬────────────────┘
                │ implements ports       │ implements ports
                ▼                       ▼
┌──────────────────────────────────────────────────────┐
│ packages/adapters — postgres | http | schwab | sidecar│
│                      | pgboss | memory (twin per port)│
└───────────────┬───────────────────────┬────────────────┘
                ▼                       ▼
          Supabase Postgres      Schwab · CBOE · FRED · CFTC

packages/quant  — pure-leaf BSM math (D21). Imported by BOTH
                  packages/core AND apps/web. No I/O, no deps.
                  This is the ONE exception to "web imports
                  contracts only" — established precedent, not
                  a new pattern.
```

Per-context directory shape (see `journal`, `analytics`, `brokerage`): `domain/` (pure
functions) + `application/` (`ports.ts` + one file per use-case, `make*UseCase(deps)` factory).
`streaming` is the one flat exception (no domain/application split — small context). New v1.2
contexts should follow the domain/application split; keep the flat shape only if a context stays
this small.

Two conventions load-bearing for every feature below:

1. **"New use-case ⇒ HTTP route + MCP tool in the same PR"** (`architecture-boundaries.md`,
   rule 9) — the picker and events surfaces both need this pairing.
2. **"Docs before architecture changes"** (`workflow.md`) — every NEW bounded context, NEW
   table, or NEW cross-package dependency (the `@morai/quant` extension below) needs a
   `stack-decisions.md` entry / `data-model.md` table section BEFORE the implementing PR, not
   after.

## Feature-by-Feature Integration

### 1. Picker engine — `scoreCalendarCandidates`

| Aspect | Decision |
|---|---|
| Owning layer | **Core, new bounded context** `packages/core/src/picker/` |
| New vs modified | NEW context. Nothing existing changes. |
| New ports | None required for the scoring math itself (pure function). One new *use-case* composition (below), reusing existing ports. |
| New tables | **None.** Candidates are computed on demand from live chain + events + GEX; nothing is persisted (MVP). Open Question #2 in `calendar-selection-criteria.md` wants an in-house Vasquez-slope backtest over `leg_observations` — that is a separate, future analytics job, not the picker's live-scoring path. |
| Data flow | `ForFetchingChain` (existing, journal context) → build candidate structures (strike×DTE×delta enumeration) → attach `ForReadingEconomicEvents` flags (new, events context) → attach latest GEX (existing analytics-context read) → attach `ForReadingRate` (existing) → pure `scoreCalendarCandidates(candidates, context)` in `picker/domain/` → ranked list → route/MCP response |

**Why no port for the scoring function itself:** all 8 verified criteria in
`calendar-selection-criteria.md` reduce to arithmetic over values already resolved by the time
scoring runs (forward IV, term slope, event flags, delta, net theta, GEX proximity, debit). That
makes `scoreCalendarCandidates` a **pure domain function** — same shape as `bsmGreeks` or
`invertIv` — testable with fast-check property tests (e.g. an otherwise-identical candidate that
avoids event-spanning must never score lower than one that spans an event) with zero mocks.

**New domain types (`picker/domain/candidate.ts`):**
- `CalendarCandidate` — strike, front/back expiry, DTE pair, delta, frontIv/backIv, netTheta,
  netGamma-context (for GEX bonus), debit — the shape the use-case assembles per candidate.
- `ScoredCandidate` — `CalendarCandidate` + per-criterion score/flag breakdown + `totalScore` +
  human-readable labels (mirrors the "ranked-cards" UI need directly — see Feature 4).

**New application layer (`picker/application/`):**
- `ports.ts` — no NEW driven ports beyond `ForReadingEconomicEvents` (owned by the events
  context, imported here as a cross-context application-port TYPE — allowed; only cross-context
  `domain/` imports are forbidden per `hexagonal-ddd.md`).
- `buildScoredCandidates.ts` — the use-case: fetches chain + events + GEX + rate via injected
  ports, enumerates strike/DTE combinations from user-supplied filter params (DTE range, delta
  target — both explicitly still-open decisions per PROJECT.md), calls the pure scorer, returns
  `ReadonlyArray<ScoredCandidate>`.

**REFUTED criteria are a code-review/test gate, not just a doc note.** IV-rank gates, the
−1..−3% raw IV-diff band, and the 25–40% debit-of-back band must never appear as scoring terms
or filter predicates — treat their absence as a required assertion in the domain test suite
(a candidate satisfying one of the refuted "rules" but not the verified ones must NOT score
higher), so a future edit can't silently reintroduce them.

### 2. Economic-events adapter (FOMC/CPI/NFP)

| Aspect | Decision |
|---|---|
| Owning layer | **New bounded context** `packages/core/src/economic-events/` + new outbound adapters in `packages/adapters/src/http/` and `.../postgres/repos/` |
| New vs modified | Entirely NEW — no existing file touched except job registration tables (`TRACKED_JOBS`/`TRIGGERABLE_JOBS`, additive) |
| New port | `ForFetchingEconomicEvents(source: 'fomc' \| 'bls') → Result<ReadonlyArray<EconomicEvent>, FetchError>`, `ForPersistingEconomicEvent`, `ForReadingEconomicEvents(windowStart, windowEnd) → Result<ReadonlyArray<EconomicEvent>, StorageError>` |
| New table | `economic_events` — see Data Model below |
| Data flow | NEW `fetch-economic-events` cron (worker) → HTTP adapter(s) pull Fed FOMC yearly schedule + BLS CPI/NFP monthly release calendar → upsert `economic_events` → picker's `buildScoredCandidates` reads the table windowed to `[today, candidate.backExpiry]` → flags any leg whose expiry window brackets an event date (criterion 3) → penalty applied when the **front** leg specifically spans an event (criterion 4) |

**Design-stance deviation, called out on purpose.** `data-model.md`'s stance is "append-only
observation tables for anything time-stamped." `economic_events` is not an observation — it is a
**published schedule that can be revised** (BLS/Fed sometimes shift a release date). Model it
like `contracts` (first-seen/reference metadata, upsertable), not like `calendar_snapshots`:

```
economic_events
  id          uuid PK
  event_type  enum: FOMC | CPI | NFP
  event_date  date NOT NULL
  source      text            -- 'fomc' | 'bls'
  fetched_at  timestamptz     -- when this row was last confirmed/updated
UNIQUE (event_type, event_date)   -- idempotent upsert key; a revised date is a
                                  -- DELETE+INSERT (or explicit update), not a blind append
```

Migration: `packages/adapters/src/postgres/migrations/0014_economic_events.sql` (next free
number after `0013_macro_observations.sql`).

**Job cadence:** FOMC dates are published a year ahead (effectively static); CPI/NFP follow a
BLS monthly cadence. A weekly cron (e.g. `0 6 * * 1`, mirroring the COT weekly-fetch cadence in
`jobs.md`) is generous — daily is unnecessary churn. Follow the existing `fetch-rates` model:
best-effort per source, fail-loud if a source errors, never fabricate a date.

**Adapters needed:** two HTTP fetchers behind ONE port (`source` param) — Fed publishes FOMC
meeting dates as static HTML/PDF (may need a maintained-constant fallback given no clean JSON
API, similar in spirit to `nyse-holidays.ts`'s static calendar approach in `journal/domain/`);
BLS publishes CPI/NFP release schedules as JSON/HTML. Both get an in-memory twin
(`packages/adapters/src/memory/economic-events.ts`) per the "ship the in-memory twin" rule.

### 3. Picker API route + MCP tool

| Aspect | Decision |
|---|---|
| Owning layer | Driving adapters in `apps/server/src/adapters/http/` and `.../mcp/` |
| New vs modified | NEW route file, NEW MCP tool, NEW contracts file. No existing route touched. |
| New contract | `packages/contracts/src/picker.ts` — Zod schemas for the candidate-filter request and the `ScoredCandidate[]` response. **Author this file FIRST** (see Build Order) — it is the shape both the UI fixtures (Feature 4) and the eventual live route must match byte-for-byte. |
| Route | `GET /api/picker/candidates?underlying=SPX&dteMin=&dteMax=&deltaTarget=` → Zod-validate query → `buildScoredCandidates` use-case → `contracts.picker.candidatesResponse.parse(...)` |
| MCP tool | `get_picker_candidates` — same contract, same use-case, mirrors the `get_skew`/`get_term_structure` pairing pattern |

Matches the existing analytics-route shape exactly (`api-design.md`): empty array on "no
candidates match filter," never an error — "no data yet" is a normal state here too.

### 4. Analyzer + Overview redesigns (apps/web)

| Aspect | Decision |
|---|---|
| Owning layer | `apps/web` only. **Zero hexagon impact** — pure UI-layer work. |
| New vs modified | `Overview.tsx` (461 lines) and `Shell.tsx` (210 lines) get internal components EXTRACTED (modified); `Analyzer.tsx` (880 lines) gets redesigned against new fixtures (modified, large rewrite). |
| Extraction needed | `PositionsTable`, `BookSummary`, `SystemHealth` are currently **local functions inside `Overview.tsx`**, not importable components. `MarketStrip` is local to `Shell.tsx`. Overview v2 ("TOS dock" variant B) rearranges/reuses these — pull each into its own file under `apps/web/src/components/` (or a `screens/overview/` subfolder) before or during the redesign, not after — otherwise the redesign PR is one giant diff with no reviewable seams. |
| Picker UI (Analyzer) | Build against **fixtures**, not the live route. New `apps/web/src/lib/picker-fixtures.ts` exporting stub data typed as `z.infer<typeof contracts.picker.candidatesResponse>` (import the Zod schema from `@morai/contracts` even though the HTTP call isn't wired yet — this is what makes "contract-first" real instead of aspirational: the fixture can't drift from the eventual response because it's typed against the same schema). |

**Why UI-first-with-fixtures is the right call here (not just the user's stated preference):**
the picker engine's two open decisions (DTE range as filter vs. fixed rule; delta-target strike
enumeration) are UX-shaping — they determine what filter controls the ranked-cards rail needs.
Building the UI against a contracts-typed fixture first lets those UX questions get resolved by
looking at the mockup (`mockups/playground-v4.html`) before the engine's enumeration logic is
locked in, without the UI work blocking on — or being blocked by — engine work. When the engine
lands (Feature 1+3), swapping the fixture import for a real `hc<ApiType>()` call is a one-line
change per the existing Hono RPC pattern.

### 5. Scenario-engine IV calibration fix

| Aspect | Decision |
|---|---|
| Owning layer | **`packages/quant`** (the pure-leaf, not `apps/web` and not `packages/core`) |
| New vs modified | Extend `@morai/quant` (currently only exports `bsmPrice`/`bsmGreeks`/`bsmVega`) with an IV-inversion export; modify `apps/web/src/lib/scenario-engine.ts` to call it. |
| Why not fix it inline in scenario-engine.ts | `apps/web` cannot import `packages/core` (dependency law: `web → contracts only`, softened once already for `@morai/quant` — never for `core`). The equivalent algorithm already exists server-side as `invertIv` in `packages/core/src/journal/domain/iv-inversion.ts` (Newton-Raphson + bisection fallback). Two independently-maintained bisection solvers for the same math is exactly the class of drift D21 was created to prevent. |
| Precedent | This is a **repeat of D21**, not a new pattern: D21 moved `bsm.ts` out of `core/journal/domain/` down into `@morai/quant`, leaving a re-export shim in core so no call site changed (confirmed live in the codebase today: `core/journal/domain/bsm.ts` is exactly that shim). Do the same with `invertIv` — move it to `quant/src/iv-inversion.ts`, leave `core/journal/domain/iv-inversion.ts` as a shim re-exporting from `@morai/quant`, then `scenario-engine.ts` imports the real thing from `@morai/quant` directly. |
| Docs-first requirement | `stack-decisions.md` gets a new decision entry (next available, e.g. D24) documenting this extraction BEFORE the move, per the "docs before architecture changes" rule — same as D21's own entry. |

### 6. Live-stream stall watchdog

| Aspect | Decision |
|---|---|
| Owning layer | Driving adapter only — `apps/server` (SSE fan-out) + `apps/web` (stream hook). **No core/domain change required.** |
| New vs modified | Modify the existing SSE route in `apps/server/src/adapters/http/` (add a periodic heartbeat) and the existing client stream hook in `apps/web` (add a staleness timer). No new port — `apps/server`'s fan-out registry already owns the `Set<SSEStreamingApi>` and coalescer state; a heartbeat is additive to that same loop. |
| Root-cause framing | The existing STRM-05 "stale" badge only fires on a hard disconnect (`EventSource` `onerror`/close). The known gap ("badge lies LIVE") is a **silent stall**: the connection stays open but the sidecar/Schwab feed stops producing ticks. A hard-disconnect check cannot detect that — a heartbeat can. |
| Recommended shape | Server emits a periodic SSE heartbeat event (e.g. every 5s, piggybacking on the existing 1s coalescer flush interval — no new timer, just an event type) independent of whether real ticks arrived. Client tracks `lastEventAt` (tick OR heartbeat) and flips to a `stalled` UI state if `now − lastEventAt > threshold` while `readyState === OPEN`. This is the standard SSE liveness pattern — cheaper and more precise than a client-only "haven't gotten data in N seconds" guess, because it distinguishes "market is quiet" (ticks stop, heartbeats keep flowing) from "pipe is dead" (both stop). |
| Where NOT to put it | Do not push this into `packages/core/src/streaming/` as a "port." Liveness/heartbeat is transport plumbing (SSE-specific), not domain logic — it has no meaning outside the wire protocol, unlike `recomputeLiveGreek` which is genuinely pure math. Keep the hexagon out of it. |

### 7. Event-triggered supplemental snapshot job

| Aspect | Decision |
|---|---|
| Owning layer | Driving adapter (`apps/server`'s stream handler) triggers; **existing** `snapshotCalendars` use-case (journal context) executes. |
| New vs modified | Modify `apps/server`'s ACCT_ACTIVITY handling to additionally call the existing `ForEnqueueingJob` port; modify `snapshotCalendars.ts` use-case to accept an optional `calendarId` for a single-calendar out-of-cycle run (vs. the full RTH-cycle scan). No new port — `ForEnqueueingJob` already exists (`journal/application/ports.ts`) and is already wired for `trigger_job`/rebuild-journal. |
| New tables | None. Writes land in the same `calendar_snapshots` table through the same idempotent path. |
| Data flow | Sidecar `ACCT_ACTIVITY` event → server reconciles positions (existing flow) → if the reconcile reveals a fill/position change on an open calendar → `enqueueJob('snapshot-calendars', { calendarId }, dedupeKey)` → worker picks it up → normal `snapshotCalendars` path (fetch chain → compute → persist) → chain-triggers `compute-analytics` exactly as it already does |
| Dedupe key | Must NOT collide with the cron's `snapshot-calendars:{windowStart}` key (`jobs.md`'s existing pattern). Use a distinct namespace, e.g. `snapshot-calendars:event:{calendarId}:{minuteBucket}`, so a burst of fills in the same minute produces one supplemental run, not N. |

### 8. Strategy-rules engine (L4)

| Aspect | Decision |
|---|---|
| Owning layer | **New bounded context** `packages/core/src/strategy-rules/` |
| New vs modified | Entirely NEW. `calendars.entry_thesis` (already exists, D-07, nullable) becomes the attach point when an OPEN is associated with a rule that fired. |
| New ports | `ForStoringRule`, `ForListingRules`, `ForStoringRuleFiring`, `ForReadingRuleFirings` |
| New tables | `strategy_rules` (id, name, rule_type: enter\|exit\|roll, condition_json, active, created_at) and `rule_firings` (id, rule_id FK, calendar_id FK, fired_at, calendar_event_id FK NULL — links to the `calendar_events` row it corresponds to) |
| Data flow | NEW chain-triggered job `evaluate-strategy-rules` (fires after `snapshot-calendars`, same pattern as `compute-analytics`) reads active rules + latest `calendar_snapshots` → pure `evaluateRule(rule, snapshotContext): boolean` in `strategy-rules/domain/` → on true, writes a `rule_firings` row |
| Scope boundary — reaffirm at build time | PROJECT.md Out-of-Scope: "Live trade advice / regime scoring... Morai owns collected/historical data." A rule firing **records** that a condition became true — it must never auto-execute, auto-close, or push actionable "you should trade now" copy. This is the most speculative item in the milestone; scope it through its own discuss-phase before planning (rule condition DSL shape, whether firings surface as a passive log or a dashboard badge, how `entry_thesis` gets populated — operator-selected at OPEN time, or derived post-hoc from which rule's conditions matched). |

## New vs Modified — Summary Table

| Component | New | Modified | Untouched |
|---|---|---|---|
| `packages/core/src/picker/` | ✓ (domain + application) | | |
| `packages/core/src/economic-events/` | ✓ (domain + application) | | |
| `packages/core/src/strategy-rules/` | ✓ (domain + application) | | |
| `packages/core/src/journal/` (`snapshotCalendars.ts`) | | ✓ (optional `calendarId` param) | rest of journal context |
| `packages/quant` | | ✓ (add IV-inversion export) | `bsmPrice`/`bsmGreeks`/`bsmVega` |
| `packages/core/src/journal/domain/iv-inversion.ts` | | ✓ (becomes a re-export shim, D21-style) | |
| `packages/adapters/src/http/` | ✓ (FOMC/BLS fetchers) | | schwab, cboe, fred, cot fetchers |
| `packages/adapters/src/postgres/repos/` | ✓ (economic-events, strategy-rules) | | |
| `packages/adapters/src/postgres/migrations/` | ✓ 0014 (economic_events), later 0015 (strategy_rules + rule_firings) | | |
| `packages/adapters/src/memory/` | ✓ (twins for all new ports) | | |
| `packages/contracts/src/picker.ts` | ✓ | | |
| `packages/contracts/src/economic-events.ts` | ✓ (only if exposed as its own route; picker may be the sole consumer, in which case skip a standalone route and keep this internal to core) | | |
| `apps/server/src/adapters/http/picker.routes.ts` | ✓ | | |
| `apps/server/src/adapters/mcp/` | ✓ `get_picker_candidates` tool | | existing tools |
| `apps/server` SSE route | | ✓ (heartbeat) | ticket auth, coalescer core loop |
| `apps/server` ACCT_ACTIVITY handler | | ✓ (enqueue supplemental snapshot) | reconcile-on-connect flow |
| `apps/worker` job registration | | ✓ (add `fetch-economic-events`, `evaluate-strategy-rules` to `TRACKED_JOBS`) | existing crons |
| `apps/web/src/screens/Overview.tsx` | | ✓ (extract components, TOS-dock layout) | |
| `apps/web/src/screens/Analyzer.tsx` | | ✓ (picker redesign) | |
| `apps/web/src/components/Shell.tsx` | | ✓ (extract `MarketStrip`) | |
| `apps/web/src/lib/scenario-engine.ts` | | ✓ (call `@morai/quant` IV solver) | |
| `apps/web/src/lib/picker-fixtures.ts` | ✓ | | |
| `calendars.entry_thesis` column | | (already exists, D-07 — becomes a real attach point) | |

## Build Order (dependency-respecting, matches user-decided sequence)

The user's stated order is right; here is the dependency reasoning underneath each step, so a
future re-plan doesn't accidentally reorder something load-bearing.

1. **Phase-15 image deploy** (server+worker+web). Hard prerequisite for everything else — v1.1's
   T-24h re-auth alert isn't live in prod until this ships, and building v1.2 on top of a
   pre-15 prod image means testing against a known-stale surface. Zero architectural coupling to
   the rest of v1.2; it's purely "ship what's already merged."

2. **Overview v2 (TOS dock) + scenario-engine IV calibration fix.** These two are independent of
   each other but both independent of the picker work, so bundling them first is safe. The IV
   fix should land as the `@morai/quant` extraction (Feature 5) — do the D21-style move (docs
   entry → quant export → shim → scenario-engine call site) as ONE unit so `packages/core`'s
   `invertIv` call sites never see a behavior change mid-flight. Component extraction from
   `Overview.tsx`/`Shell.tsx` (Feature 4) should happen here too, even though Overview v2 doesn't
   strictly need Analyzer's picker components — it establishes the "components are files, not
   local functions" pattern the Analyzer redesign will lean on next.

3. **Analyzer → picker redesign, UI-first with fixtures.** This step has ONE real dependency
   that must land first even though it's not "engine work": **`packages/contracts/src/picker.ts`
   must exist before the fixtures do.** Write the Zod schema (candidate shape, score breakdown,
   filter params) as the very first task of this step — even before any UI code — so
   `picker-fixtures.ts` is typed against the real contract from day one instead of an ad-hoc
   shape that gets "reconciled" later. Everything else in this step (ranked-cards rail, filter
   controls, mockup fidelity to `playground-v4.html`) is pure `apps/web` work with zero backend
   dependency, which is exactly why it can run before the engine exists.

4. **Picker engine wires in** — `packages/core/src/picker/` + `packages/core/src/economic-events/`
   + routes/MCP. Internal ordering within this step:
   - Build `economic-events` context first (adapter + table + job) — it has no dependency on
     `picker` and the picker's event-flag criteria (3 and 4) need it as an input, not the other
     way around.
   - Build `picker/domain/` scoring functions second, test them against the verified criteria
     table with fixed inputs (no I/O needed yet) — this is where the REFUTED-criteria regression
     assertions belong.
   - Build `picker/application/buildScoredCandidates.ts` third, wiring in `ForFetchingChain`
     (existing), `ForReadingEconomicEvents` (just built), the analytics context's GEX read
     (existing), and `ForReadingRate` (existing).
   - Wire the route + MCP tool last, then swap `apps/web`'s fixture import for the live
     `hc<ApiType>()` call — this should be a small, low-risk diff precisely because step 3
     already built the UI against the contract this step fulfills.
   - Resolve the two open decisions (DTE range as user filter; delta-target strike enumeration)
     as part of this step's discuss-phase — they were deliberately left open until the picker's
     actual filter UI (built in step 3) existed to inform them.

5. **Tail: stall watchdog → event-triggered snapshot → strategy-rules (L4).** Ordered by
   independence and risk, cheapest/most-isolated first:
   - **Watchdog** first — pure `apps/server` + `apps/web` transport work, no core changes, no
     new tables, fully independent of the picker.
   - **Event-triggered snapshot** second — touches the same ACCT_ACTIVITY handler the watchdog
     work will have just been sitting next to, so doing it right after keeps that file's context
     warm, and it reuses `ForEnqueueingJob` (no new port work).
   - **Strategy-rules (L4)** last — the newest bounded context, the most open scope questions
     (rule DSL, firing-vs-execution boundary), and the one most likely to need its own
     discuss-phase before planning. Nothing else in the milestone depends on it landing.

## Anti-Patterns to Avoid

### Anti-Pattern: persisting picker scores "for consistency with the journal pattern"

**What people do:** because `calendar_snapshots` and the analytics tables are all
append-only-observation, it's tempting to give picker candidates the same treatment — a
`picker_candidates` observation table written on some cadence.
**Why it's wrong:** the picker is a live, on-demand query over a moving chain — there is no
"the candidate set as of 30 minutes ago" that matters the way a journal snapshot does. Persisting
it adds a write path, a staleness problem, and a migration for zero product value at this stage.
**Do this instead:** compute on request; revisit ONLY if/when the Vasquez-slope backtest (Open
Question #2) needs historical candidate scores to validate against, and even then that is a
separate analytics job over `leg_observations`, not the live picker path.

### Anti-Pattern: reusing `packages/core`'s `invertIv` directly from `apps/web`

**What people do:** "the algorithm already exists, just import it" — reaching across the
`web → core` boundary because it's the path of least resistance for a bug fix.
**Why it's wrong:** it is a hard dependency-law violation (`architecture-boundaries.md` rule 1)
and the ESLint boundary config will catch it (correctly) — the fix would arrive already broken
by design, or worse, get merged with an `eslint-disable` (explicitly forbidden).
**Do this instead:** the D21-pattern move into `@morai/quant` (Feature 5 above).

### Anti-Pattern: giving the events fetcher its own bounded-context ports file bolted onto `journal`

**What people do:** COT and macro-FRED ports both got appended directly into
`journal/application/ports.ts` (existing precedent in this codebase) even though neither is
journal-specific. It would be easy to do the same for economic events "since that's how COT/FRED
did it."
**Why it's wrong here specifically:** COT/FRED are read by journal/analytics use-cases that
already lived in that file, so the append was low-friction at the time. Economic events are read
ONLY by the new `picker` context — there's no journal use-case that needs them. Piling a fourth
unrelated vendor's ports onto an already-large `journal/application/ports.ts` makes that file
the de facto "everything" ports dump, which is the opposite of the bounded-context intent.
**Do this instead:** give economic-events its own context directory (Feature 2) — it is a new
enough concern, with a new enough table, that it earns the standard shape.

## Sources

- `docs/architecture/overview.md`, `hexagonal-ddd.md`, `data-model.md`, `jobs.md`,
  `api-design.md`, `mcp-and-plugins.md`, `streaming-fanout.md`, `stack-decisions.md` (D21) —
  read directly, 2026-07-03.
- `packages/core/src/{journal,analytics,brokerage,streaming}/**` — directory shape and existing
  port conventions, read directly.
- `packages/quant/src/**`, `packages/core/src/journal/domain/{bsm,iv-inversion}.ts` — confirmed
  the D21 shim pattern and located the un-migrated `invertIv`.
- `apps/web/src/{screens/Overview.tsx,screens/Analyzer.tsx,components/Shell.tsx,lib/scenario-engine.ts}`
  — confirmed local-function extraction candidates and the existing `@morai/quant` import
  precedent in web.
- `.planning/research/calendar-selection-criteria.md`, `.planning/PROJECT.md` — verified
  scoring criteria and milestone scope/sequencing constraints.

---
*Architecture research for: v1.2 Trade Picker & Dashboard Redesign integration*
*Researched: 2026-07-03*
