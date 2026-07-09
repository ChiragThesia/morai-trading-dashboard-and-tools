# Phase 26: Exit Advisor - Research

**Researched:** 2026-07-09
**Domain:** New `exits` bounded context (sibling to `picker`/`analytics`) — derived-read exit-verdict
engine for open SPX calendar spreads, on an existing hexagonal Bun/TS trading pipeline
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Table + keying (USER-LOCKED)**
- Table name `exit_verdicts`, keyed `(observed_at, calendar_id)`, `onConflictDoNothing` —
  first-write-wins on the cohort clock, the proven `picker_snapshot` convention at
  per-calendar grain. Append-only history. Migration 0020 (next free number).

**Bounded context (USER-LOCKED, research-confirmed)**
- New `exits` context sibling to `picker`, in the mould of `analytics`: reads
  position/mark/greeks/P&L from `journal`, GEX from `analytics`, events from `picker` — all
  through its OWN application ports (never a foreign `domain/` import); owns the exit-rule
  registry + `evaluateExit(position, context)` pure function; writes verdicts, never mutates
  journal. Hexagon law: core imports shared only.

**The playbook ladder (USER-LOCKED thresholds — encode EXACTLY, no re-derivation)**
- TAKE rungs: +5% / +10% / +15% profit on the fill-ledger basis (verdict names the rung).
- STOP rungs: −25% / −50%.
- TERM trigger: live front−back IV inversion ≥ 0.5pp (front IV − back IV ≥ 0.005 in IV
  points) → exit signal.
- GAMMA trigger: spot > 2% off strike AND front < 7 DTE.
- EVT trigger: tier-1 event (FOMC/CPI/NFP) ≤ 3 days from front expiry → EXIT-pre-event
  (mirrors the picker's exitPlan.closeByExpiry stamp — day BEFORE the event).
- ROLL: front < 14 DTE AND spot within ±1% of strike AND profit < 15% AND no blocking event
  → suggest haircut-priced replacement front (+14–21 DTE), priced with the SAME ORATS
  66%-width fill haircut the picker uses.
- Registry mirrors `rules.ts` style: typed rows with id, kind, formula, rationale, source;
  ships to UI as ruleSet (entry-methodology symmetry, EXIT-07).

**P&L basis (USER-LOCKED — money-code boundary)**
- Verdict %-P&L derives from the VALIDATED journal fill-ledger basis (openNetDebit etc.) +
  latest calendar snapshot netMark — NEVER a recomputed parallel P&L. READ-ONLY on all
  journal tables. Any change to fill/event/P&L computation itself = out of scope, stop and
  ask the user.
- No confidence percentages, no probabilities — verdict + rule id + raw metric only
  (EXIT-04; "no fabricated precision at n=13").

**Gating + hysteresis (USER-LOCKED)**
- Session/staleness-gated: verdicts computed on AH marks or stale/gap snapshot rows are
  INDICATIVE (display-labeled, never actionable STOP/TAKE alerts). Phase 25's freshness gate
  means new snapshots are clean; still gate on snapshot age + marketSession.
- Hysteresis banding: arm TAKE at +5%, don't flap it off below until profit < +3%; same
  pattern for STOP rungs (documented constants). No verdict flapping cycle-to-cycle on
  noise. Exact hysteresis constants: Claude's discretion, documented + tested.

**Job + alerts (USER-LOCKED)**
- `compute-exit-advice` = thin terminal pg-boss handler chained after `compute-picker`
  (single-trigger chain convention). No new cron.
- EXIT-09: only verdict CHANGES surface as alerts; STOP and EXIT-pre-event escalate
  distinctly (visual escalation in UI; no external notification system this phase unless one
  already exists — follow existing alert/badge conventions from WATCH-01).
- EXIT-10: advisor NEVER executes. No order-entry code anywhere.

**Surfaces**
- HTTP `GET /api/exits` (or /analytics/exits — follow existing route family conventions) +
  MCP `get_exit_advice` answering "what should I do with my open calendars?" with the same
  verdict payloads (MCP-02 parity).
- Analyzer held-positions panel: per-calendar verdict chips + exit ruleSet rendered from the
  engine payload (EXIT-07). UI phase → needs UI-SPEC (MetricChip/Button system language,
  Analyzer conventions).

**Testing**
- TDD red→green; testcontainers for the new repo + twin parity same PR (rule 8); fast-check
  for ladder/hysteresis boundary properties; distinct timestamps in fixtures (green-suite
  lesson).

### Claude's Discretion
- Exact hysteresis constants + naming.
- Verdict priority ordering when multiple rules fire simultaneously (e.g. STOP beats TAKE
  beats ROLL beats HOLD; EVT/TERM/GAMMA placement) — document the precedence ladder in the
  registry doc; research practitioner norms; encode ONE deterministic order.
- Alert surface mechanics (badge/chip conventions).
- Whether exit rules doc lives as docs/architecture/exit-rules.md mirroring picker-rules.md
  (recommended).

### Deferred Ideas (OUT OF SCOPE)
- Auto roll-order construction (order-entry boundary) — permanent defer.
- Tick-level re-evaluation — contradicts STRM-04 + 30-min cadence.
- External notifications (push/email) — only if an existing surface exists; else defer.
- Backtest of exit rules → Phase 27.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXIT-01 | Every open calendar gets a verdict each pipeline cycle — HOLD / TAKE (rung) / STOP / EXIT-pre-event from a typed registry | `exit-rules.ts` registry mirroring `rules.ts`; component inventory below |
| EXIT-02 | Verdicts derive from journal fill-ledger P&L + latest calendar snapshot (never recomputed) | P&L basis read surface fully traced (Q1 below): `pnlOpen` + `Calendar.openNetDebit` |
| EXIT-03 | TERM (≥0.5pp inversion), GAMMA (spot>2% off strike, front<7 DTE), EVT (tier-1 event ≤3d) | Trigger input inventory (Q2 below) — all three resolve to journal-owned/picker-events data, no new analytics/GEX port needed |
| EXIT-04 | Every verdict names the firing rule + raw metric, no confidence % | Registry pattern (`RuleMetadata`) + `ExitVerdict` payload shape below |
| EXIT-05 | Session/staleness-gated, hysteresis-banded, no flapping | Staleness/session gating (Q8) + hysteresis recommendation below |
| EXIT-06 | ROLL: front<14 DTE, spot ±1% of strike, profit<15%, no blocking event → haircut-priced replacement front | ROLL input inventory (Q2) — haircut fill function is NOT currently exported; flagged as a required extraction |
| EXIT-07 | Analyzer held-positions panel: verdict chips + ruleSet, entry-methodology symmetry | `ScoringMethodologyPanel` pattern in Analyzer.tsx traced as the mirror target |
| EXIT-08 | MCP tool `get_exit_advice`, same verdict payloads (MCP-02) | `registerGetPickerCandidatesTool` traced as the exact pattern to mirror |
| EXIT-09 | Only verdict CHANGES surface as alerts; STOP/EXIT-pre-event escalate distinctly | Verdict-change detection pattern (Q6) — requires reading the previous verdict row, a new read the milestone ARCHITECTURE doc did not spell out |
| EXIT-10 | Advisor never executes | Confirmed: no order-placement code exists anywhere in the repo today (`brokerage.routes.ts` is GET-only) — nothing to accidentally wire up |
</phase_requirements>

## Summary

The exit advisor is the highest-confidence, most template-following phase in this milestone. Every
input it needs — the validated P&L basis (`calendar_snapshots.pnl_open`), term structure
(`frontIv`/`backIv`), net greeks, spot, DTEs, and tier-1 economic events — already lands in
Postgres every 30-minute cycle from code shipped in Phases 19–25. Nothing needs a new external
adapter, a new fetch, or a new dependency. The entire feature is new *core domain* (a rule
registry + a pure evaluator) wired through *existing* read surfaces, following the `picker`
context's shape almost line for line: same registry-row style (`rules.ts` → `exit-rules.ts`), same
append-only idempotency convention (`picker_snapshot` → `exit_verdicts`, at per-calendar grain),
same terminal-chain wiring pattern (`compute-gex-snapshot` → `compute-picker` becomes
`compute-picker` → `compute-exit-advice`), same route/MCP pairing pattern
(`get_picker_candidates` → `get_exit_advice`).

Three findings correct or sharpen the milestone-level ARCHITECTURE.md sketch, discovered only by
reading the actual code this session. First, the GAMMA trigger ("spot > 2% off strike AND front <
7 DTE") reads *only* the calendar's own strike and the latest snapshot's spot/DTE — both already
journal-owned. It needs no GEX/analytics port at all, contradicting ARCHITECTURE.md's diagram
that routed GAMMA through `analytics`. Second, the ORATS 66%-width fill haircut used for ROLL
pricing (`buyFill`/`sellFill` in `candidate-selection.ts`) is a **module-private closure**, not an
exported function — the planner must extract it (or the exported `FILL_WIDTH_FRACTION` constant
must be paired with a newly-exported pure haircut function) before ROLL pricing can reuse it
without reimplementing the formula (the exact anti-pattern ARCHITECTURE.md itself warns against).
Third, hysteresis (EXIT-05) requires the evaluator to see the *previous cycle's* verdict for the
same calendar — `evaluateExit(position, context)` as sketched in ARCHITECTURE.md is one argument
short; it must be `evaluateExit(position, context, previousVerdict)`, which means the use-case
needs one more read (latest `exit_verdicts` row per calendar) before it can call the pure
evaluator. All three are resolved below, not left as open questions.

One live repo bug is worth flagging even though it predates this phase: the Postgres
`readJournal` implementation (`calendar-snapshots.ts`, `mapSnapshotRow`) silently **drops every
snapshot row whose `source` is `"schwab_chain"`**, keeping only `"cboe"`-sourced rows
(`if (row.source !== "cboe") return null`). This is dead-quiet data loss for any calendar whose
latest leg resolved from the Schwab chain. The exits context's new
`ForReadingLatestSnapshotPerOpenCalendar` port must NOT be implemented by reusing this function —
it should use a direct `DISTINCT ON (calendar_id) ORDER BY calendar_id, time DESC` query (the
`readSnapshotsForCycle` pattern, which selects fields directly with no source filter) instead.

**Primary recommendation:** Build `exits` as a pure derived-read context exactly mirroring
`picker`'s shape; add one journal port (`ForReadingLatestSnapshotPerOpenCalendar`, implemented via
a fresh per-calendar-latest query, NOT `readJournal`); skip the analytics/GEX port entirely (GAMMA
doesn't need it); extract the haircut fill formula to a shared exported function before ROLL uses
it; and thread `previousVerdict` explicitly through `evaluateExit` for hysteresis.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Verdict computation (rule registry + evaluator) | API / Backend (`packages/core/src/exits/domain`) | — | Pure domain logic, no I/O; mirrors `picker/domain/rules.ts` |
| Position + P&L + snapshot read | API / Backend (`journal` application port) | Database / Storage | Reuses validated fill-ledger; NEW port, but data already persisted |
| Event read (EVT trigger) | API / Backend (`picker` application port, reused) | — | `economic_events` already picker-owned; read-only cross-context port |
| Verdict persistence | Database / Storage (`exit_verdicts` table) | API / Backend (repo) | Append-only, cohort-clock idempotency — same tier as `picker_snapshot` |
| Chain trigger (job orchestration) | API / Backend (`apps/worker` pg-boss handler) | — | Thin adapter, zero business logic, mirrors `compute-gex-snapshot`→`compute-picker` |
| HTTP/MCP read surface | API / Backend (`apps/server`) | — | Read-only GET route + MCP tool, same pattern as `get_picker_candidates` |
| Held-positions panel rendering | Browser / Client (Analyzer.tsx) | Frontend Server (SSR none — Vite SPA) | Pure rendering of the engine payload — mirrors `ScoringMethodologyPanel` |
| Never-execute guard | API / Backend (absence of capability) | — | No order-placement port exists anywhere in the repo; nothing to gate |

## Standard Stack

**Zero new dependencies.** Every input and every technique this phase needs already lives in the
repo: Drizzle ORM + Zod (contracts), pg-boss (chain trigger), Vitest + fast-check + testcontainers
(TDD), and the existing `@morai/shared` `Result`/`assertDefined`/`isWithinRth` helpers. No package
installs, no version verification needed.

### Core (all existing, reused)

| Library | Version | Purpose | Why Standard (in this repo) |
|---------|---------|---------|------------------------------|
| Drizzle ORM | (pinned, unchanged) | `exit_verdicts` table + migration | Every other append-only table in this repo uses it |
| Zod (`@morai/contracts`) | (pinned, unchanged) | `ExitVerdict`/`HeldPosition` schema, validated on write AND read | Matches `pickerSnapshotResponse.parse` convention |
| pg-boss | (pinned, unchanged) | `compute-exit-advice` terminal handler | Existing single-trigger chain; `singletonKey` dedup |
| fast-check | (pinned, unchanged) | Hysteresis/ladder-boundary property tests | Existing convention for numerical rule code |
| testcontainers | (pinned, unchanged) | `exit_verdicts` repo contract test (SQL never mocked) | Existing convention (`tdd.md` rule) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending `picker_snapshot` with a `verdicts[]` field | Own `exit_verdicts` table | Rejected by CONTEXT.md and ARCHITECTURE.md — different grain (per-calendar vs per-universe), couples two contexts. Not revisited. |
| New GEX/analytics port for GAMMA | Journal-only spot+strike+DTE read | The locked GAMMA formula needs no wall data — analytics port would be unused code (YAGNI). |
| pg-boss cron for `compute-exit-advice` | Chain-trigger from `compute-picker` | User-locked; matches the single-trigger chain convention every other derived job uses. |

**Installation:** none — no new packages.

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** Every dependency used is already
in `package.json` and has been running in production since earlier v1.2/v1.3 phases.

## Architecture Patterns

### System Architecture Diagram

```
                     pg-boss chain (24/7, no RTH gate on compute; journal write IS RTH-gated)
fetch-schwab-chain → compute-bsm-greeks → snapshot-calendars → compute-analytics
     → compute-gex-snapshot → compute-picker → compute-exit-advice   (NEW terminal)
                                                       │
     reads (all already written earlier this cycle):  │
       journal:  open calendars (Calendar: strike, openNetDebit, qty, frontExpiry, backExpiry)
                 + latest calendar_snapshots row per open calendar
                   (netMark, pnlOpen, frontIv/backIv, netDelta/Gamma/Theta/Vega,
                    dteFront/dteBack, spot, time, source)          ← journal port (NEW)
       picker:   economic_events (FOMC/CPI/NFP rows = tier-1 by construction) ← reused port
       exits:    latest exit_verdicts row per calendar (for hysteresis)       ← NEW self-read
                                                       ▼
     evaluateExit(HeldPosition, MarketContext, previousVerdict) — PURE, per open calendar
       ├─ gate: session/staleness (AH/gap/NULL-greek → indicative, never actionable)
       ├─ STOP rungs (−25/−50%, hysteresis-banded)
       ├─ EXIT-pre-event (EVT: tier-1 event ≤3d from frontExpiry)
       ├─ GAMMA (spot >2% off strike AND frontDTE <7)
       ├─ TERM (frontIv − backIv ≥ 0.005)
       ├─ TAKE rungs (+5/+10/+15%, hysteresis-banded, highest qualifying rung)
       ├─ ROLL (frontDTE<14, spot within ±1% strike, profit<15%, no blocking event
       │         → haircut-priced replacement front +14-21d)
       └─ HOLD (default)
                                                       ▼
             persist exit_verdicts (observed_at = cohort clock, onConflictDoNothing
                                     on (observed_at, calendar_id))
                                                       ▼
  Read surfaces (no recompute — latest row only):
    Analyzer held-positions panel  ─GET /api/exits→   getExitAdvice use-case
    Claude Code                    ─MCP get_exit_advice→  → latest exit_verdicts per open calendar
```

### Recommended Project Structure

```
packages/core/src/exits/                    # NEW bounded context (sibling to picker/)
├── domain/
│   ├── exit-rules.ts        # THE registry (mirrors picker/domain/rules.ts): STOP/TAKE rungs,
│   │                        #   TERM/GAMMA/EVT/ROLL rows, precedence order as a typed list
│   ├── evaluate-exit.ts     # pure: (HeldPosition, MarketContext, PreviousVerdict|null)
│   │                        #   → ExitVerdict — the replay entrypoint (PICK-04 reuses this)
│   ├── types.ts             # HeldPosition, MarketContext, ExitVerdict, PreviousVerdict
│   └── *.test.ts             # fast-check on numeric triggers + hysteresis band boundaries
├── application/
│   ├── ports.ts             # ForReadingHeldPositions, ForReadingEconomicEvents (reused type),
│   │                        #   ForReadingLatestVerdictsPerCalendar (NEW self-read),
│   │                        #   ForPersistingExitVerdict
│   └── computeExitAdvice.ts # use-case: read positions+events+previous-verdicts → evaluate → persist
└── index.ts                 # public surface

packages/core/src/journal/application/ports.ts   # + ForReadingLatestSnapshotPerOpenCalendar (NEW)
packages/adapters/src/postgres/repos/journal...   # implementation: DISTINCT ON per-calendar-latest
                                                    # query — NOT a reuse of readJournal/mapSnapshotRow
                                                    # (avoids the schwab_chain-drop bug, see Pitfalls)

packages/core/src/picker/domain/candidate-selection.ts
  # MODIFIED: extract buyFill/sellFill (currently private closures) into an exported
  # haircutFill(quote, side) pure function — exits' ROLL pricing imports this, not a copy

packages/adapters/src/
├── postgres/repos/exit-verdicts.ts         # NEW repo + contract test
├── postgres/migrations/0020_exit_verdicts.sql
└── memory/exit-verdicts.ts                 # NEW twin (architecture rule 8)

apps/worker/src/handlers/compute-exit-advice.ts   # NEW terminal handler
apps/worker/src/handlers/compute-picker.ts        # MODIFIED: gains `boss` dep, sends
                                                    # "compute-exit-advice" on success
apps/worker/src/schedule.ts                        # MODIFIED: createQueue("compute-exit-advice")

apps/server/src/adapters/http/exits.routes.ts     # NEW: GET /api/exits
apps/server/src/adapters/mcp/tools.ts             # MODIFIED: + registerGetExitAdviceTool

apps/web/src/screens/Analyzer.tsx                  # MODIFIED: + held-positions panel
                                                     # (new component, mirrors ScoringMethodologyPanel)

docs/architecture/exit-rules.md                    # NEW — mirrors picker-rules.md format
docs/architecture/jobs.md                          # MODIFIED — extend the chain line (§75-78)
```

### Component Inventory (file-by-file, new vs modified)

| Component | New/Modified | Path | Mirrors |
|-----------|--------------|------|---------|
| Exit rule registry | NEW | `packages/core/src/exits/domain/exit-rules.ts` | `picker/domain/rules.ts` |
| Pure evaluator | NEW | `packages/core/src/exits/domain/evaluate-exit.ts` | `picker/domain/candidate-selection.ts` shape |
| Domain types | NEW | `packages/core/src/exits/domain/types.ts` | `picker/domain/types.ts` |
| Application ports | NEW | `packages/core/src/exits/application/ports.ts` | `picker/application/ports.ts` |
| Use-case | NEW | `packages/core/src/exits/application/computeExitAdvice.ts` | `picker/application/computePickerSnapshot.ts` |
| Read use-case | NEW | `packages/core/src/exits/application/getExitAdvice.ts` | `picker/application/getPicker.ts` |
| Journal port: latest snapshot per open calendar | NEW | `packages/core/src/journal/application/ports.ts` | none — genuinely new read shape |
| Journal Postgres impl | NEW | `packages/adapters/src/postgres/repos/calendar-snapshots.ts` (new function, NOT `readJournal`) | `readSnapshotsForCycle` query style |
| Haircut fill extraction | MODIFIED | `packages/core/src/picker/domain/candidate-selection.ts` | export what's currently private |
| `exit_verdicts` Postgres repo | NEW | `packages/adapters/src/postgres/repos/exit-verdicts.ts` | `picker-snapshot.ts` (composite PK version, mirrors `calendar-snapshots.ts` composite PK) |
| `exit_verdicts` memory twin | NEW | `packages/adapters/src/memory/exit-verdicts.ts` | `memory/picker-snapshot.ts` |
| Migration | NEW | `packages/adapters/src/postgres/migrations/0020_exit_verdicts.sql` | `0015_picker_snapshot.sql` (composite PK) |
| Contracts (Zod) | NEW | `packages/contracts/src/exits.ts` | `packages/contracts/src/picker.ts` |
| Worker handler | NEW | `apps/worker/src/handlers/compute-exit-advice.ts` | `apps/worker/src/handlers/compute-picker.ts` (currently terminal — becomes the template for a NEW terminal handler) |
| Worker handler | MODIFIED | `apps/worker/src/handlers/compute-picker.ts` | gains `boss` dep like `compute-gex-snapshot.ts` did |
| Queue registration | MODIFIED | `apps/worker/src/schedule.ts` | `createQueue("compute-picker")` line (chain-triggered, no cron) |
| Composition root wiring | MODIFIED | `apps/worker/src/main.ts` | lines ~281-286 pattern (`computeGexSnapshotHandler` gaining `boss`) |
| HTTP route | NEW | `apps/server/src/adapters/http/exits.routes.ts` | `picker.routes.ts` |
| MCP tool | NEW | `apps/server/src/adapters/mcp/tools.ts` (+function) | `registerGetPickerCandidatesTool` (lines 561-616) |
| Analyzer panel | NEW | `apps/web/src/screens/Analyzer.tsx` (+component) | `ScoringMethodologyPanel` (lines 282-...) |
| Docs | NEW | `docs/architecture/exit-rules.md` | `docs/architecture/picker-rules.md` |
| Docs | MODIFIED | `docs/architecture/jobs.md` (chain line, §75-78) | Docs-before-code rule (`.claude/rules/workflow.md`) |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exit-side fill pricing | A new haircut formula | Extract & reuse `FILL_WIDTH_FRACTION` (0.66) + the buy/sell haircut math from `candidate-selection.ts` | Two sources of truth for the same fill model drift (ARCHITECTURE.md Anti-Pattern 2); the number is already ORATS-sourced and tested |
| P&L percentage basis | A parallel P&L calculator | `SnapshotRow.pnlOpen` (already `(netMark−openNetDebit)*qty*100`) ÷ `(openNetDebit*qty*100)` | Reuses the validated fill-ledger oracle (−$319,850 incident fix); recomputing risks reintroducing the unit-mismatch bug |
| RTH/AH session labeling | A new session clock | `isWithinRth` + `isNyseHoliday` from `@morai/shared` (exact picker convention, `computePickerSnapshot.ts:357-358`) | Already the proven convention; a second implementation risks disagreeing with the picker's own AH chip on the same screen |
| Event blackout window math | New "days until event" logic | The `EVENT_BLACKOUT_DAYS` (3) + day-before-stamp logic already in `candidate-selection.ts:239-252` (`exitBeforeIso`) | The EXACT same formula (≤3 days, stamp day-before) is already coded and proven for entries; EVT just applies it to the calendar's fixed `frontExpiry` instead of a candidate's front leg |
| Idempotent per-calendar-per-cohort writes | Custom dedup logic | `onConflictDoNothing` on composite PK `(observed_at, calendar_id)` | Exact `calendar_snapshots` / `picker_snapshot` (WR-01) convention, proven at scale |

**Key insight:** almost nothing in this phase is genuinely new math — the picker context already
solved fill-haircut pricing, session labeling, and event-window arithmetic for the entry side.
Exit-side reuses the same formulas against different (already-open) positions. The only real new
domain logic is the STOP/TAKE ladder thresholds themselves and the hysteresis/precedence layer on
top.

## Input Source Table (trigger → source, file:line)

| Trigger | Inputs | Source (file:line / function) |
|---------|--------|-------------------------------|
| P&L basis (TAKE/STOP) | `openNetDebit`, `qty` | `journal/application/ports.ts:31` (`Calendar.openNetDebit`), read via `ForGettingOpenCalendars` (`ports.ts:104`) |
| P&L basis (TAKE/STOP) | `pnlOpen` (dollar P&L, already `(netMark−openNetDebit)*qty*100`) | `journal/application/ports.ts:225` (`SnapshotRow.pnlOpen`); formula in `snapshotCalendars.ts:112-118` (`computeSnapshotPnl`) |
| P&L basis (TAKE/STOP) | pct P&L = `pnlOpen / (openNetDebit*qty*100)` = `(netMark−openNetDebit)/openNetDebit` | Derived in the exits use-case — never recomputed independently, always from the two fields above |
| TERM | `frontIv`, `backIv` (numeric strings, `'NaN'` sentinel) | `journal/application/ports.ts:214-215` (`SnapshotRow.frontIv/backIv`), same row as P&L — NOT `term_structure_observations` (that table is picker-scored candidates, not open positions) |
| GAMMA | `spot` | `journal/application/ports.ts:210` (`SnapshotRow.spot`) |
| GAMMA | calendar `strike` | `journal/application/ports.ts:26` (`Calendar.strike`, ×1000 int — divide by 1000 before comparing to spot) |
| GAMMA | `dteFront` | `journal/application/ports.ts:223` (`SnapshotRow.dteFront`, integer calendar days) — **no analytics/GEX port needed**, contrary to milestone ARCHITECTURE.md's diagram |
| EVT | tier-1 events | `picker/application/ports.ts:29-33` (`EconomicEvent`, `name: "FOMC"\|"CPI"\|"NFP"` — tier-1-ness IS the type; no separate tier field/column), read via reused `ForReadingEconomicEvents` (`ports.ts:212`) |
| EVT | day-before-event stamp formula | `picker/domain/candidate-selection.ts:239-252` (`EVENT_BLACKOUT_DAYS = 3`; `exitBeforeIso` computation) — apply the identical formula to the held calendar's fixed `frontExpiry`, not a candidate's front leg |
| ROLL | candidate replacement front (+14–21 DTE) selection | New logic — but the DTE-window pattern mirrors `FRONT_DTE_MIN/MAX` (`candidate-selection.ts:58-59`, values 21/36) at a *different* window (14-21); read the same chain source the picker candidate scan uses (`ForReadingChainForPicker`, reused cross-context via a NEW `exits` port re-declaring the shape, journal/analytics precedent) |
| ROLL | haircut fill pricing | `candidate-selection.ts:73` (`FILL_WIDTH_FRACTION = 0.66`) + `candidate-selection.ts:224-227` (`buyFill`/`sellFill` — **currently private, must be exported**, see Pitfalls) |
| Session/staleness gate | `time` (observation instant) + `marketSession` | `SnapshotRow.time` (`ports.ts:208`); `marketSession` is NOT stored on `SnapshotRow` — compute it the same way the picker does: `isWithinRth(snapshot.time) && !isNyseHoliday(snapshot.time)` (`computePickerSnapshot.ts:357-358`), imported from `@morai/shared` |
| Verdict-change / hysteresis | previous cycle's verdict for this calendar | NEW self-read: `ForReadingLatestVerdictsPerCalendar` on the exits' own `exit_verdicts` table — no existing port covers this; must be added in the same PR as the writer |

## Precedence Ladder (web-researched, one deterministic order)

**Recommendation — evaluate in this order per open calendar, first match wins:**

1. **STOP** (−25% / −50%, hysteresis-banded) — capital preservation is non-negotiable and
   time-critical. Standard risk-order practice treats a stop as an urgent, market-order-style
   action versus a profit target's patient, limit-order-style action — stops are evaluated (and
   would fire) first when both conditions are live simultaneously. `[CITED: futures.stonex.com,
   metrotrade.com]`
2. **EXIT-pre-event (EVT)** — a tier-1 event ≤3 days from front expiry is a fixed calendar date,
   not a market-noise-driven trigger; it mirrors the picker's own `exitPlan.closeByExpiry`
   discipline (a hard, pre-computed date, not a live threshold) and is therefore evaluated ahead
   of the noisier continuous triggers below it. `[VERIFIED: in-repo, candidate-selection.ts:239-252]`
3. **GAMMA** — pin/whipsaw risk in the final DTE window compounds fastest of the remaining
   triggers: near expiry, at-the-money gamma sensitivity is reported at several multiples of the
   30-45 DTE baseline, and a single session's move can erase weeks of theta gain.
   `[CITED: menthorq.com, impliedoptions.com, daystoexpiry.com]`
4. **TERM** — front−back IV inversion means the calendar's structural edge (the reason it was
   entered) is gone; practitioner guidance treats a positive front-minus-back differential as a
   signal to act on before the position decays further, but it is a slower-moving structural
   signal than GAMMA's DTE-driven urgency. `[CITED: abovethegreenline.com — "check the
   differential ... if positive, the trade's structural advantage is gone"]`
5. **TAKE** (highest qualifying rung: +15% > +10% > +5%, hysteresis-banded) — profit-taking is
   patient by nature (a limit-style action); evaluated after every risk-driven trigger above.
   `[CITED: traderc.com, journalplus.co — 21-DTE/50%-profit-exit research]`
6. **ROLL** (front<14 DTE, spot within ±1% of strike, profit<15%, no blocking event) — a
   constructive continuation, evaluated only once nothing more urgent fired; matches this
   project's own PITFALLS.md guidance to "prefer ROLL over EXIT when the back leg is illiquid but
   the front is liquid" and the 21-DTE-roll literature's framing of rolling as routine position
   management, not an emergency action. `[CITED: traderc.com — 21-DTE rule; project PITFALLS.md
   Pitfall 9]`
7. **HOLD** — default, no rule fired.

This resolves the CONTEXT.md open discretion item verbatim: "STOP beats TAKE beats ROLL beats
HOLD; EVT/TERM/GAMMA placement" → the full order is
**STOP > EVT > GAMMA > TERM > TAKE > ROLL > HOLD**. Encode this order as an explicit
`EXIT_PRECEDENCE: ReadonlyArray<ExitRuleId>` constant in `exit-rules.ts` (not implicit `if/else`
chain order) so it is a reviewable, testable line, matching the `RULE_SET_METADATA` array
convention.

## Hysteresis Recommendation

Per-rung arm/disarm bands (documented constants, fast-check tested at the boundary):

| Rung | Arm at | Disarm below/above | Buffer |
|------|--------|---------------------|--------|
| TAKE +5% | ≥ +5.0% | < +3.0% | 2pp (user-specified verbatim in CONTEXT.md) |
| TAKE +10% | ≥ +10.0% | < +8.0% | 2pp (same pattern applied to the next rung) |
| TAKE +15% | ≥ +15.0% | < +13.0% | 2pp (same pattern) |
| STOP −25% | ≤ −25.0% | > −23.0% | 2pp ("same pattern for STOP rungs" per CONTEXT.md — identical absolute buffer, simplest defensible reading) |
| STOP −50% | ≤ −50.0% | > −48.0% | 2pp (same pattern) |
| TERM (0.5pp inversion) | ≥ 0.005 | < 0.003 | 0.2pp (proportional: same ~40% relative buffer as the TAKE rungs) |
| GAMMA (2% off strike) | > 2.0% | < 1.5% | 0.5pp (proportional buffer; the `frontDTE<7` half of the AND is itself monotonically decreasing within a session and needs no hysteresis) |
| EVT | date-based | n/a — no hysteresis | A calendar date does not flap; deterministic day-before stamp |

**Mechanism (resolves CONTEXT.md's open question on verdict-change detection):**
`evaluateExit` must be a 3-argument pure function: `(position: HeldPosition, context:
MarketContext, previousVerdict: PreviousVerdict | null) => ExitVerdict`. `previousVerdict` is
`{ verdict, rung/ruleId, armedAt }` read from the single most-recent `exit_verdicts` row for that
calendar (a NEW `ForReadingLatestVerdictsPerCalendar` port on the exits' own table). The
use-case's read order each cycle is: read open calendars → read latest snapshot per calendar →
read latest verdict per calendar (self-read) → read economic events → call `evaluateExit` per
calendar → persist. This is the one place ARCHITECTURE.md's sketched signature
(`evaluateExit(position, context)`, no previous-verdict argument) needs correcting before
planning — without it, EXIT-05's hysteresis requirement cannot be satisfied by a stateless pure
function alone.

**Verdict-CHANGE alert detection (EXIT-09):** after computing this cycle's verdict, compare
`(verdict, rung/ruleId)` against `previousVerdict`. Unequal → this row is a "change" and the
Analyzer/MCP payload marks it `changed: true` with `STOP`/`EXIT-pre-event` outcomes tagged
`escalate: true` for the UI to render distinctly (color/urgency), matching the existing
`marketSession === "after-hours"` alert-chip pattern in `Analyzer.tsx:316-322`
(`MetricChip alert`). No new notification infrastructure — confirmed no toast/push system exists
in `apps/web/src` today; the only two mounted alert-style surfaces are `LiveStatusBadge`
(`components/LiveStatusBadge.tsx`, WATCH-01) and the fixed-bottom `AuthExpiredBanner`
(`components/AuthExpiredBanner.tsx`). A per-calendar chip on the held-positions panel is the
correct-weight surface — a fixed-bottom banner is reserved for account-wide states (matches
`AuthExpiredBanner`'s scope, not a per-position concern).

## Common Pitfalls

### Pitfall 1: `readJournal`/`mapSnapshotRow` silently drops `schwab_chain`-sourced rows
**What goes wrong:** The Postgres `readJournal` implementation
(`packages/adapters/src/postgres/repos/calendar-snapshots.ts:332-337`, `mapSnapshotRow`) contains
`if (row.source !== "cboe") return null;` — this filters OUT every row whose `source` is
`"schwab_chain"`, keeping only `"cboe"`-sourced snapshot rows, even though `SnapshotRow.source` is
typed `"cboe" | "schwab_chain"` (`ports.ts:226`) and both are valid production values (dual-source
chain fetch, live since the chain-window-regression fix). If the NEW
`ForReadingLatestSnapshotPerOpenCalendar` port is implemented by reusing `readJournal` (or copying
its mapper), any calendar whose most recent leg resolution came from Schwab silently vanishes from
the exit advisor's view — indistinguishable from "no snapshot yet."
**Why it happens:** The comment above the guard describes it as defending against an "unexpected
source enum value," but the check is stricter than the type it is guarding — `"schwab_chain"` is
not unexpected, it is one of exactly two valid values.
**How to avoid:** Implement the new port with a direct `DISTINCT ON (calendar_id) ORDER BY
calendar_id, time DESC` select (matching the field-selection style of `readSnapshotsForCycle`,
`calendar-snapshots.ts:216-254`, which has no source filter), not by calling `readJournal` or
reusing `mapSnapshotRow`.
**Warning signs:** A calendar with fresh Schwab-sourced snapshots shows no exit verdict; the
exit-advisor test suite passes with CBOE-only fixtures but fails once a `schwab_chain` fixture row
is added.
**Phase to address:** Exit advisor phase (this phase) — flag to the planner as a required
regression test, not a re-fix of the underlying `readJournal` bug (out of scope; read-only on
journal, and this pre-existing bug affects `GET /journal/:id` too, which is not this phase's
concern to fix).

### Pitfall 2: ROLL pricing reimplements the haircut formula instead of importing it
**What goes wrong:** `buyFill`/`sellFill` in `candidate-selection.ts:224-227` are `const` closures
scoped inside `selectCandidates`, not exported. A naive implementation of ROLL pricing would
copy the formula (`bid + (ask-bid)*FILL_WIDTH_FRACTION` / `ask - (ask-bid)*FILL_WIDTH_FRACTION`)
rather than importing it, creating exactly the "two sources of truth for the fill model" drift
risk ARCHITECTURE.md's Anti-Pattern 2 warns against for the *entry* side, but here on the *exit*
side.
**Why it happens:** The function is currently private because nothing outside `selectCandidates`
needed it before this phase.
**How to avoid:** Extract `buyFill`/`sellFill` into an exported pure function (e.g.
`export function haircutFill(quote, side: "buy" | "sell"): number`) in `candidate-selection.ts` or
a shared picker-domain module, in the SAME PR that adds ROLL pricing. `FILL_WIDTH_FRACTION` is
already exported — only the two closures need promoting.
**Warning signs:** A `grep -n "0.66\|FILL_WIDTH_FRACTION" packages/core/src/exits/` finds a
hardcoded literal or a re-derivation instead of an import.
**Phase to address:** This phase, as a task inside the ROLL rule implementation.

### Pitfall 3: `evaluateExit` built stateless, hysteresis silently unimplementable
**What goes wrong:** If the planner follows ARCHITECTURE.md's sketched signature
(`evaluateExit(position, context)`) literally, EXIT-05's hysteresis requirement has no state to
compare against — every cycle recomputes from scratch and the "arm at X, disarm below Y" banding
described in CONTEXT.md and PITFALLS.md Pitfall 6 cannot be implemented without either (a) a third
argument carrying the previous verdict, or (b) a stateful/impure evaluator (forbidden — pure
domain).
**Why it happens:** The milestone-level ARCHITECTURE.md research predates CONTEXT.md's explicit
hysteresis lock and did not carry the signature through.
**How to avoid:** Use `evaluateExit(position, context, previousVerdict: PreviousVerdict | null)`
from the start; the use-case reads the previous verdict via the new self-read port before calling
the pure evaluator (see Hysteresis Recommendation above).
**Warning signs:** A fast-check property test that feeds two consecutive near-threshold P&L
values and asserts the verdict does NOT flip fails because the function has no memory of cycle N-1.
**Phase to address:** This phase — Wave 0 / domain-types task.

### Pitfall 4: Actionable verdict on AH/stale/gap marks
**What goes wrong:** Same class as PITFALLS.md Pitfall 7 (inherited from milestone research): a
verdict computed from an after-hours or stale snapshot fires an actionable STOP/TAKE badge the
user might act on off-hours.
**Why it happens:** The 24/7 chain-triggered cadence treats every cohort uniformly unless
explicitly gated.
**How to avoid:** Reuse `isWithinRth`/`isNyseHoliday` (exact picker convention) to compute
`marketSession` at evaluation time; when `after-hours`, OR when `SnapshotRow.time` is older than
`SNAPSHOT_LEG_STALENESS_TOLERANCE_MS` (45 min, `snapshotCalendars.ts:47`) relative to the cohort's
own `now`, OR when `frontIv`/`backIv`/any net-greek is the `'NaN'` sentinel, the verdict is
labeled `indicative: true` and MUST NOT render as an actionable STOP/TAKE badge (display-only,
"RTH will confirm" — exact wording from the picker's AH chip precedent).
**Note:** Phase 25's OPS-01 freshness gate means `snapshot-calendars` no longer WRITES spot=0/NaN
gap rows at all (it skips the calendar's cycle entirely) — so a "gap row" is now expressed as a
STALE (old) `time` on the latest available row, not a spot=0 row in the table. The staleness check
above (comparing `SnapshotRow.time` to now) is therefore the primary gate; the `'NaN'`-sentinel
check remains relevant for the D-06 NaN-continuity case (fresh legs, unsolved BSM).
**Phase to address:** This phase — the evaluator's first gate, before any rule row is checked.

### Pitfall 5: Dual verdict rows in one cohort (retry / race)
**What goes wrong:** A pg-boss retry of `compute-exit-advice` on a job that partially succeeded
(threw after persisting some but not all calendars' verdicts) could attempt a second write for the
same `(observed_at, calendar_id)`.
**How to avoid:** `onConflictDoNothing` on the composite PK — exactly the `calendar_snapshots` /
`picker_snapshot` convention. First-write-wins; a retry after partial success is a safe no-op for
the calendars that already got a row, and fills in the ones that didn't.
**Test:** contract test asserting a second insert with the same `(observed_at, calendar_id)` and a
DIFFERENT verdict blob does not overwrite the first (mirrors `picker-snapshot.contract.test.ts`'s
WR-01 assertion).
**Phase to address:** This phase — repo contract test, same PR as the writer.

### Pitfall 6: Never-execute guard has nothing to regress against
**What goes wrong:** EXIT-10 ("advisor never executes") is trivially satisfied today because no
order-placement port exists anywhere in this codebase (`brokerage.routes.ts:14` — "Read-only —
only GET endpoints (no order placement)" — confirmed by grep, zero POST/order-placement routes in
the entire `apps/server`). The risk is not that this phase adds execution capability directly, but
that a future phase could wire a "place order" adapter and accidentally let the exits context call
it if the port boundary isn't enforced.
**How to avoid:** The exits context's `application/ports.ts` should not import or reference
anything resembling `ForPlacingOrder`. Add one cheap regression test: a static assertion / grep-
based test asserting `exits/` contains no import of any brokerage write port. This is a "looks
done but isn't" checklist item, not a runtime guard (there is nothing to runtime-guard against
today).
**Phase to address:** This phase — one lightweight test in `exits/application/*.test.ts` or a
repo-wide lint rule addition if the pattern is judged worth codifying.

## Code Examples

### Chain-trigger handler pattern (mirror exactly)
```typescript
// Source: apps/worker/src/handlers/compute-gex-snapshot.ts (in-repo, verbatim pattern to copy)
export function makeComputeExitAdviceHandler(
  deps: { readonly computeExitAdviceUseCase: ForRunningComputeExitAdvice },
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    if (job === undefined) return;
    const result = await deps.computeExitAdviceUseCase();
    if (!result.ok) throw new Error(result.error.message);
    // Terminal job — no further enqueue (compute-exit-advice is the new last step).
  };
}

// compute-picker.ts gains a `boss` dep and this on success (mirrors compute-gex-snapshot.ts:42-46):
void deps.boss.send("compute-exit-advice", {}, {
  singletonKey: "triggered-by-picker",
}).catch((e: unknown) => {
  console.warn("compute-picker: failed to enqueue compute-exit-advice", e);
});
```

### P&L basis (never recompute — reuse verbatim)
```typescript
// Source: packages/core/src/journal/application/snapshotCalendars.ts:112-118 (computeSnapshotPnl)
// pnlOpen is ALREADY this, stored on the latest SnapshotRow:
//   pnlOpen = (netMark - openNetDebit) * qty * 100
// The exits use-case derives the ladder's percentage basis as:
const pctPnl = (netMark: number, openNetDebit: number): number =>
  (netMark - openNetDebit) / openNetDebit; // matches pnlOpen's numerator/denominator exactly
```

### EVT day-before-event stamp (reuse the exact formula, applied to a fixed frontExpiry)
```typescript
// Source: packages/core/src/picker/domain/candidate-selection.ts:239-252 (adapted)
// EVENT_BLACKOUT_DAYS = 3 (exported constant, already matches EXIT-03's "≤3 days" verbatim)
const feDay = isoDayNumber(calendar.frontExpiry);
let exitBeforeIso: string | null = null;
for (const ev of tier1Events) {
  const evDay = isoDayNumber(ev.date);
  if (evDay <= feDay && feDay - evDay <= EVENT_BLACKOUT_DAYS) {
    const dayBefore = new Date((evDay - 1) * 86_400_000).toISOString().slice(0, 10);
    if (exitBeforeIso === null || dayBefore < exitBeforeIso) exitBeforeIso = dayBefore;
  }
}
// exitBeforeIso !== null AND today >= exitBeforeIso → EXIT-pre-event verdict
```

### Session/staleness gate (reuse the exact picker convention)
```typescript
// Source: packages/core/src/picker/application/computePickerSnapshot.ts:357-358
import { isWithinRth, isNyseHoliday } from "@morai/shared";
const marketSession: "rth" | "after-hours" =
  isWithinRth(snapshot.time) && !isNyseHoliday(snapshot.time) ? "rth" : "after-hours";
```

## State of the Art

| Old Approach (this milestone's own retired history) | Current Approach | When Changed | Impact |
|--------------------------------------------------|-------------------|---------------|--------|
| Per-pair `term-inversion` hard gate at ENTRY | Retired — mild front-richness IS the entry edge; TERM only matters as an EXIT signal now | 2026-07-09 (Phase 19/20 rework, `picker-rules.md:49-52`) | Exits' TERM trigger is a genuinely new use of term-structure data, not a resurrection of the retired entry gate — different direction, different threshold (≥0.5pp inversion vs the old any-inversion gate) |
| Event-blackout as an entry BLOCK | `eventAdjustment` score penalty + `exitPlan.closeByExpiry` day-before stamp | 2026-07-09 (`picker-rules.md:43-47`) | The EVT trigger this phase builds is literally the exit half of a decision already made — reuse, not new design |

**Deprecated/outdated:** none specific to this phase — all referenced patterns are current
(2026-07-09 or later) production code.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Precedence ladder order (STOP > EVT > GAMMA > TERM > TAKE > ROLL > HOLD) is Claude's discretion per CONTEXT.md, informed by web sources but not user-confirmed | Precedence Ladder | Low — CONTEXT.md explicitly delegates this to Claude's discretion; if the user disagrees at discuss/plan-review time, it's a one-array reorder, not a rework |
| A2 | Hysteresis buffer sizes (2pp for TAKE/STOP, 0.2pp for TERM, 0.5pp for GAMMA) are Claude's discretion per CONTEXT.md; the TAKE +5/+3 pair is user-specified verbatim, the rest are proportional extrapolations | Hysteresis Recommendation | Low-Medium — CONTEXT.md explicitly delegates "exact constants" to discretion; wrong values would show as either flapping (too tight) or sluggish verdicts (too loose) in early production use, both cheaply observable and adjustable (named constants, not derived) |
| A3 | `GET /api/exits` mounts under the same authenticated `apiRouter` group as `/api/picker/candidates` (Bearer-token), not a separate `/analytics/exits` path | Component Inventory | Low — either path works; CONTEXT.md explicitly says "follow existing route family conventions," and `/api/exits` (sibling to `/api/picker`) is the more literal match since `exits` is its own bounded context, not a sub-resource of `analytics` |

## Open Questions

All open questions from CONTEXT.md and the milestone research are resolved above. No unresolved
gaps remain for planning.

1. **Verdict precedence when multiple rules fire simultaneously** — RESOLVED above (STOP > EVT >
   GAMMA > TERM > TAKE > ROLL > HOLD, with citations).
2. **Exact hysteresis constants** — RESOLVED above (per-rung table).
3. **How verdict-CHANGE detection works given append-only history** — RESOLVED: `evaluateExit`
   takes `previousVerdict` as an explicit third argument, sourced from a new self-read port on
   `exit_verdicts`; ARCHITECTURE.md's 2-argument sketch is corrected.
4. **Whether GAMMA needs an analytics/GEX port** — RESOLVED: no. The locked GAMMA formula
   (spot vs. the calendar's own strike, plus front DTE) is entirely journal-owned data.
5. **Whether the ORATS haircut fill function is directly importable for ROLL pricing** —
   RESOLVED: not yet — it must be extracted from private closures to an exported function first
   (flagged as Pitfall 2, a required task).
6. **Whether `docs/architecture/exit-rules.md` should exist** — RESOLVED (per CONTEXT.md's own
   recommendation, and confirmed by the docs-before-code rule in `.claude/rules/workflow.md`):
   yes, mirroring `picker-rules.md`'s exact section structure (rule kinds, candidate/position
   context, the ladder table, "how to add a rule," refuted-criteria section if any emerge).
7. **Whether `readJournal` can be reused for the new latest-snapshot-per-calendar port** —
   RESOLVED: no — it silently drops `schwab_chain` rows (Pitfall 1); implement a fresh query.

## Environment Availability

Not applicable — this phase adds zero new external dependencies, services, or CLI tools. Postgres
and pg-boss are already running and verified by every prior phase in this milestone (most recently
Phase 25's OPS-01/OPS-02 ops rider, which touched the exact `snapshot-calendars` /
`compute-bsm-greeks` handlers this phase's chain depends on).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (workspace root config: `vitest.config.ts`) + fast-check + testcontainers |
| Config file | `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/vitest.config.ts` |
| Quick run command | `bun run vitest run packages/core/src/exits` (domain/application, no containers) |
| Full suite command | `bun run test` (root `package.json` script: `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXIT-01 | Every open calendar gets exactly one verdict per cycle from the registry | unit | `vitest run packages/core/src/exits/application/computeExitAdvice.test.ts` | ❌ Wave 0 |
| EXIT-02 | Verdict % matches the journal-ledger oracle (a known trade) | unit (oracle) | `vitest run packages/core/src/exits/domain/evaluate-exit.test.ts -t "P&L basis"` | ❌ Wave 0 |
| EXIT-03 | TERM/GAMMA/EVT fire at exact locked thresholds | unit + fast-check (boundary) | `vitest run packages/core/src/exits/domain/exit-rules.test.ts` | ❌ Wave 0 |
| EXIT-04 | Verdict payload always names ruleId + raw metric, never a bare label or confidence % | unit (schema) | `vitest run packages/contracts/src/exits.test.ts` | ❌ Wave 0 |
| EXIT-05 | Verdict stable across ≥3 consecutive near-threshold cycles (no flapping) | fast-check (hysteresis property) | `vitest run packages/core/src/exits/domain/evaluate-exit.test.ts -t "hysteresis"` | ❌ Wave 0 |
| EXIT-05 | No actionable STOP/TAKE on AH/stale/NaN-greek cohort | unit | `vitest run packages/core/src/exits/domain/evaluate-exit.test.ts -t "indicative"` | ❌ Wave 0 |
| EXIT-06 | ROLL suggestion uses the SAME haircut fn as picker entries | unit (shared-function import assertion) | `vitest run packages/core/src/exits/domain/exit-rules.test.ts -t "roll pricing"` | ❌ Wave 0 |
| EXIT-06 | ROLL only fires within its exact AND-window (DTE, spot band, profit band, no blocking event) | fast-check (boundary) | `vitest run packages/core/src/exits/domain/exit-rules.test.ts -t "roll gate"` | ❌ Wave 0 |
| EXIT-07 | Held-positions panel renders verdict chips + ruleSet from the engine payload | component/integration | `vitest run apps/web/src/screens/Analyzer.test.tsx -t "held positions"` | ❌ Wave 0 |
| EXIT-08 | `get_exit_advice` MCP tool returns the SAME schema as `GET /api/exits` (MCP-02 parity) | integration | `vitest run apps/server/src/adapters/mcp/tools.test.ts -t "get_exit_advice"` | ❌ Wave 0 |
| EXIT-09 | Only verdict CHANGES are flagged; STOP/EXIT-pre-event escalate distinctly | unit | `vitest run packages/core/src/exits/application/computeExitAdvice.test.ts -t "change detection"` | ❌ Wave 0 |
| EXIT-10 | No order-placement import anywhere under `exits/` | static/grep regression | `grep -rL "ForPlacingOrder" packages/core/src/exits/` (must find nothing to place — inverted grep test or a repo-wide test asserting the import graph) | ❌ Wave 0 |
| — | `exit_verdicts` repo: composite-PK idempotency (WR-01-style, dual-write same cohort) | testcontainers (contract) | `vitest run packages/adapters/src/postgres/repos/exit-verdicts.contract.test.ts` | ❌ Wave 0 |
| — | Journal port: latest-snapshot-per-calendar does NOT drop `schwab_chain` rows | testcontainers (contract, regression for Pitfall 1) | `vitest run packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts -t "schwab_chain"` | ❌ Wave 0 (new test in existing file) |

### Sampling Rate
- **Per task commit:** `vitest run packages/core/src/exits` (domain-only, fast, no containers)
- **Per wave merge:** `bun run test` (full workspace suite, includes testcontainers)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/core/src/exits/domain/exit-rules.test.ts` — registry invariants (precedence order
      exhaustiveness, no refuted rule ids) + per-rule boundary tests (mirrors `rules.test.ts`)
- [ ] `packages/core/src/exits/domain/evaluate-exit.test.ts` — the pure evaluator, fast-check on
      hysteresis + gating + P&L-basis oracle
- [ ] `packages/core/src/exits/application/computeExitAdvice.test.ts` — use-case orchestration
      with in-memory ports
- [ ] `packages/adapters/src/postgres/repos/exit-verdicts.contract.test.ts` — testcontainers,
      composite-PK idempotency (mirrors `picker-snapshot.contract.test.ts` + `calendar-snapshots.
      contract.test.ts`'s composite-PK pattern)
- [ ] `packages/adapters/src/memory/exit-verdicts.contract.test.ts` — twin parity (architecture
      rule 8, same PR as the Postgres repo)
- [ ] New test case in `packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts`
      — regression for Pitfall 1 (a `schwab_chain`-sourced row must NOT be dropped by the new
      latest-snapshot-per-calendar query)
- [ ] `apps/server/src/adapters/mcp/tools.test.ts` — `get_exit_advice` tool, MCP-02 schema parity
      assertion against the HTTP route's contract
- [ ] `apps/web/src/screens/Analyzer.test.tsx` — held-positions panel rendering (new test cases
      inside the existing file)
- Framework install: none — Vitest, fast-check, testcontainers all already configured project-wide.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No (new surfaces reuse existing) | `GET /api/exits` mounts inside the existing authenticated `apiRouter` (Bearer-token group), same as `/api/picker/candidates` — no new auth code |
| V3 Session Management | No | Same session/token handling as every other authenticated route; no change |
| V4 Access Control | No | Single-user system; no new roles/permissions introduced |
| V5 Input Validation | Yes | `GET /api/exits` and `get_exit_advice` take no user input (latest-snapshot reads only, mirrors `get_picker_candidates`'s `inputSchema: {}`) — the validation surface is OUTPUT: every verdict blob is Zod-parsed via `packages/contracts/src/exits.ts` before persist AND after read (parse-don't-cast at both edges, matching `pickerSnapshotResponse.parse`) |
| V6 Cryptography | No | No new secrets, tokens, or crypto — pure derived-read feature |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Storage-error message leaking DB internals through the new route/MCP tool | Information Disclosure | Flat `{error:"internal"}` mapping (T-19-16 convention), exactly as `picker.routes.ts:32-35` and `tools.ts:590-592` already do — copy verbatim |
| A future phase accidentally wiring exits' verdicts to an order-placement call | Elevation of Privilege / Tampering (financial) | No order-placement port exists in the repo today (verified); Pitfall 6's regression test (no `ForPlacingOrder`-shaped import under `exits/`) is the durable guard against this ever landing silently |
| Corrupted/legacy `exit_verdicts` blob flowing into the domain as a silently-invalid shape | Tampering / Denial of Service (verdict readable as garbage) | Re-validate via the contracts Zod schema on read, not just on write — exact `readPickerSnapshot` convention (`picker-snapshot.ts:69`) |
| Retry/duplicate job execution double-writing a cohort's verdicts | Tampering (data integrity) | `onConflictDoNothing` composite PK — the proven WR-01 convention; covered by Pitfall 5 above |

## Sources

### Primary (HIGH confidence — read directly this session)
- `packages/core/src/picker/domain/rules.ts` — full registry pattern (weights, kinds, rationale/source columns)
- `packages/core/src/picker/domain/candidate-selection.ts` — haircut fill closures (private), EVENT_BLACKOUT_DAYS/exitBeforeIso formula, DTE window constants
- `packages/core/src/journal/application/{ports.ts,snapshotCalendars.ts,getCalendarLifecycle.ts,recomputeSnapshotPnl.ts}` — Calendar/SnapshotRow shapes, computeSnapshotPnl formula, OPS-01 freshness gate (45 min tolerance)
- `packages/core/src/journal/domain/rth-window.ts` — isWithinRth re-export convention
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` — readJournal/mapSnapshotRow (found the schwab_chain-drop bug), readSnapshotsForCycle query style, recomputeSnapshotPnl transaction pattern
- `packages/adapters/src/postgres/repos/picker-snapshot.ts` — composite/single-column idempotency convention, contract precedent
- `packages/core/src/picker/application/{ports.ts,computePickerSnapshot.ts}` — EconomicEvent shape (tier-1 = the type itself), marketSession computation, GexContextForPicker shape
- `apps/worker/src/handlers/{compute-picker.ts,compute-gex-snapshot.ts}` + `apps/worker/src/main.ts` (lines 230-300) + `apps/worker/src/schedule.ts` — exact chain-trigger wiring pattern to mirror
- `apps/server/src/adapters/http/picker.routes.ts` + `apps/server/src/adapters/mcp/tools.ts` (lines 561-616) — route/MCP pairing pattern (MCP-02)
- `apps/server/src/adapters/http/brokerage.routes.ts` — confirmed no order-placement route exists anywhere (EXIT-10 guard basis)
- `apps/web/src/screens/Analyzer.tsx` (lines 225-330) — ScoringMethodologyPanel, AH-indicative chip pattern, no held-positions panel exists yet
- `apps/web/src/components/{LiveStatusBadge.tsx,AuthExpiredBanner.tsx,ui/badge.tsx,system/index.tsx}` — confirmed alert-surface conventions, no toast system exists
- `docs/architecture/{picker-rules.md,jobs.md}` — registry-doc format to mirror; job chain doc that needs extending (docs-before-code rule)
- `packages/adapters/src/postgres/migrations/` (directory listing) — confirmed 0020 is the next free migration number
- `.planning/research/{SUMMARY.md,ARCHITECTURE.md,PITFALLS.md}` — milestone-level research (HIGH confidence, corroborated and refined by this session's direct code reads)

### Secondary (MEDIUM confidence — web, cross-checked against 2+ sources)
- [3 Types of Options Exit Strategies — Charles Schwab](https://www.schwab.com/learn/story/three-types-options-exit-strategies)
- [Automating exit strategies for options trades — E*TRADE](https://us.etrade.com/knowledge/library/options/automating-exit-strategies-for-options-trades)
- [Simultaneously Entering a Stop and Setting a Profit Target — StoneX](https://futures.stonex.com/blog/simultaneously-entering-a-stop-and-setting-a-profit-target)
- [Stop Loss and Take Profit Orders Explained — MetroTrade](https://www.metrotrade.com/stop-loss-and-take-profit-orders/)
- [The 21-DTE Rule and 50% Profit Exit — Trader Central](https://traderc.com/21-dte-50-percent-profit-exit-options/)
- [The 21 DTE Rule Explained — Days to Expiry](https://www.daystoexpiry.com/blog/the-21-dte-rule-explained-when-and-why-to-close-options-positions-early)
- [The Final Countdown: Managing Gamma Risk Near Expiration — MenthorQ](https://menthorq.com/guide/gamma-risk/)
- [Gamma Risk: Why Options Accelerate Near Expiration — ImpliedOptions](https://impliedoptions.com/blog/gamma-risk-why-options-accelerate-near-expiration)
- [Calendar Spreads for Options Traders — Above the Green Line](https://abovethegreenline.com/calendar-spread-options/)

### Tertiary (LOW confidence — single-source, directional only)
- None used for load-bearing claims; all web findings above were cross-checked against ≥2
  independent sources or the project's own already-cited PITFALLS.md sources (tastytrade,
  Option Alpha, OptionsTradingIQ — carried forward, not re-verified this session).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; every reused function/port verified by direct file read this session
- Architecture: HIGH — grounded in the actual codebase; three corrections to the milestone-level ARCHITECTURE.md sketch are verified against the live source (GAMMA needs no GEX port; haircut fn is private; evaluateExit needs a 3rd argument)
- Pitfalls: HIGH — the `schwab_chain`-drop bug (Pitfall 1) is a direct code read, not inference; all others are either in-repo verified or carried from the milestone PITFALLS.md (already HIGH confidence, web-grounded)
- Precedence ladder / hysteresis: MEDIUM — thresholds are user-locked (HIGH), but the ORDER and buffer sizes are Claude's discretion per CONTEXT.md, informed by cross-checked web sources but not user-confirmed (see Assumptions Log A1/A2)

**Research date:** 2026-07-09
**Valid until:** 30 days (stable in-repo patterns; no fast-moving external dependency in this phase)
