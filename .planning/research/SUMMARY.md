# Project Research Summary

**Project:** Morai Trading Dashboard & Tools — v1.2 Trade Picker & Dashboard Redesign
**Domain:** Single-user, self-hosted SPX options trading system — dashboard redesign +
candidate-scoring engine added onto an existing hexagonal (ports & adapters) production app
**Researched:** 2026-07-03
**Confidence:** MEDIUM-HIGH

## Executive Summary

v1.2 is a subsequent-milestone integration, not a greenfield build: six new capabilities
(economic-events calendar, dashboard redesign, IV-calibration fix, trade-picker scoring engine,
strategy-rules recording, stream watchdog, event-triggered snapshot) land on top of a shipped
Bun/Hono/Supabase/Drizzle/pg-boss hexagonal system. The headline finding across all four research
tracks is convergent: nothing here needs a new dependency or a new architectural pattern. Every
feature maps onto an existing precedent already in the codebase — the FRED adapter shape, the
`iv-inversion.ts` bisection, the Drizzle-migration-per-context pattern, the pg-boss ad-hoc
`send()`, three already-installed chart libraries (or plain SVG, per the approved mockups), and
the D21 `packages/quant` extraction precedent. The job is disciplined reuse and correct sequencing,
not technology selection.

The recommended approach mirrors the user's own decided build order, which the architecture
research independently confirms is dependency-correct: (1) ship the pending phase-15 image so v1.2
isn't built on a stale prod baseline, (2) Overview v2 + the IV-calibration fix together (both
independent of the picker, and the IV fix is a repeat of the already-proven D21
core→quant-extraction pattern), (3) Analyzer→picker UI built contract-first against Zod-typed
fixtures (decouples UX risk from scoring-correctness risk), (4) the picker engine + economic-events
adapter wire real data in (events adapter first, since picker criteria 3/4 depend on it), and (5)
three independent tail items (stall watchdog, event-triggered snapshot, strategy-rules L4) ordered
cheapest/most-isolated first.

The key risk is not "will this work" but "will it silently produce wrong numbers or scope-creep."
Pitfalls research surfaces five correctness traps that must be closed at the type level, not caught
in QA: stale/mis-sourced chain data flowing into scores with no visible staleness signal; the
FwdIV formula's radicand going negative under term-structure inversion (bare `Math.sqrt` → silent
`NaN` propagating into rankings); economic-event dates stored as fixed UTC instead of
America/New_York-with-DST (mirror image of the already-learned CBOE-UTC lesson); the IV-calibration
bisection hanging or converging to garbage on deep-ITM/illiquid legs; and a naive stream watchdog
that either cries wolf during quiet markets or stays silent during a real stall. A sixth,
process risk — big-bang UI rewrites breaking a screen in daily personal trading use — is already
mitigated by the user's own contract-first/staged sequencing, provided execution doesn't collapse
it back into one PR under schedule pressure. A seventh — the strategy-rules engine ballooning into
a generic rules DSL nobody asked for — is a scope-discipline risk to flag explicitly at plan time,
not a technical one.

## Key Findings

### Recommended Stack

Zero new npm/pip dependencies for all six v1.2 capabilities. Economic events (FOMC/CPI/NFP) reuse
the already-live `FRED_API_KEY` and the existing `fred.ts` adapter shape for CPI/NFP release
dates, plus a small hand-maintained static table for FOMC (no JSON/ICS feed exists federally, and
FOMC dates are announced ~12 months ahead and essentially never move). Dashboard redesign charts
reuse one of three already-installed chart libraries (`@visx/*`, `echarts`, `uplot`) or plain
hand-rolled SVG — the approved mockups (`playground-v4.html`, `overview-v2.html`) already prove
plain SVG suffices and is what should be ported. IV calibration extends the existing
`iv-inversion.ts` bisection rather than adding a numerical/root-finding package. Strategy-rules
persistence and the economic-events table both reuse Drizzle + Postgres migrations, the same
pattern as `macro_observations`. The stall watchdog and event-triggered snapshot are standard-
library `setInterval`/pg-boss `send()` usage — no new tooling.

**Core technologies (all pre-existing, being extended not replaced):**
- FRED `releases/dates` API: CPI/NFP scheduled dates — already-keyed, free, JSON, no scraping
- `packages/core/src/journal/domain/iv-inversion.ts`: bisection to extend for per-position calibration
- Drizzle + Postgres migrations: `economic_events`, `strategy_rules`/`rule_firings` tables
- Existing `@visx`/`echarts`/`uplot` or plain SVG: redesign charts, matches decided mockups exactly
- pg-boss `send()` (ad-hoc, alongside existing `schedule()`): event-triggered snapshot

### Expected Features

**Must have (table stakes, matches every comparable screener — TOS, OptionStrat, ONE):**
- Ranked candidate list sorted by composite score, with a per-candidate "why-panel" score breakdown
- Visible "as of" chain-snapshot timestamp + staleness indicator distinct from "no data"
- Payoff diagram per candidate, one click away (BSM engine already shipped)
- DTE range and delta-target filters
- Economic-event flag per candidate leg, shown as day-count/icon not raw data
- Stream connection badge (LIVE/STALE/DISCONNECTED) — closes an already-flagged v1.1 gap
- Rule-fired tag recorded at entry, structured (enum), not free text

**Should have (differentiators — no mainstream retail tool does these):**
- Forward-IV (not raw IV diff) as the primary edge metric — a genuine analytical edge, verified in
  `calendar-selection-criteria.md`
- GEX-fit folded directly into the picker score, not a separate dashboard tab
- Event-premium-aware baseline (strip event-spanning expiries before computing "clean" forward vol)
- Event-triggered supplemental snapshot on large SPX moves — no comparable tool does off-cadence capture

**Defer (v1.2.x / v2+):**
- Rule-fired → outcome correlation report (needs a population of tagged trades first)
- Event-premium magnitude weighting (binary flag is the v1.2 scope)
- Full backtesting engine, auto-execution, multi-underlying screener — all explicitly out of scope
  per PROJECT.md boundaries (trade-advisor plugin territory, SPX-only constraint D17)

### Architecture Approach

Standard hexagonal extension: each new capability gets its own bounded context under
`packages/core/src/` (`picker/`, `economic-events/`, `strategy-rules/`) following the
domain/application split, with driven adapters in `packages/adapters/` and driving adapters
(HTTP route + MCP tool, paired per rule 9) in `apps/server`. The picker's scoring function itself
needs no new port — it's a pure domain function over already-resolved inputs, tested the same way
as `bsmGreeks`. The IV-calibration fix is a D21-style extraction into `packages/quant` (the one
sanctioned `web`-importable pure-leaf package), not a fix inline in `apps/web` or a reach across
the `web→core` boundary. UI redesign work is contract-first: `packages/contracts/src/picker.ts` is
authored before any UI code, and the Analyzer redesign builds against Zod-typed fixtures so the
eventual swap to a live route is a one-line change.

**Major components:**
1. `packages/core/src/picker/` (NEW) — pure `scoreCalendarCandidates` domain logic + `buildScoredCandidates` use-case, composing existing chain/GEX/rate ports plus the new events port
2. `packages/core/src/economic-events/` (NEW) — FOMC/CPI/NFP fetch, upsert (revisable schedule, not append-only observation), and windowed read
3. `packages/quant` (extended) — IV-inversion solver moved here from `core/journal/domain`, `apps/web`'s scenario-engine calls it directly
4. `apps/web` Overview/Analyzer (modified) — component extraction (`PositionsTable`, `MarketStrip`, etc. become real files) + picker UI built against contract-typed fixtures
5. `packages/core/src/strategy-rules/` (NEW, tail) — closed-enum rule recording + firing ledger over the existing `entry_thesis` attach point

### Critical Pitfalls

1. **Stale/partial chain data silently feeds scoring** — require an explicit `observedAt` +
   `source` on every chain snapshot the scoring port consumes; reject/flag rather than score
   silently against stale or CBOE-fallback data; surface age on every ranked card.
2. **FwdIV radicand goes negative under term-structure inversion** — `Math.sqrt(negative)` is a
   silent `NaN` that still sorts; use a tagged `Result` variant for the inverted case, decided once
   at spec time, and property-test against inverted-curve fixtures.
3. **Economic-event dates stored as fixed UTC instead of `America/New_York` + IANA tz** — same bug
   class as the CBOE-UTC lesson, inverted direction; also needs an annual re-seed process and a
   startup staleness-warning check so the calendar doesn't silently go stale after year-end.
4. **IV-calibration bisection hangs/garbage on deep-ITM or illiquid legs** — cap iterations, return
   a tagged non-convergence result (never the last iterate), use mid price per the existing
   discrepancy-doc convention, and property-test ATM/deep-ITM/deep-OTM/near-zero-vega fixtures.
5. **Stream watchdog false-positives on quiet markets or silence during a real stall** — decouple
   from data cadence with a transport-level heartbeat; three-state badge (LIVE/QUIET/STALLED), not
   two; replay-test both a known-quiet period and a simulated RTH stall.

Two additional risks worth carrying into planning even though they didn't make the top five:
big-bang UI rewrites breaking a screen in daily personal use (mitigated by the already-decided
contract-first staging — don't collapse it under schedule pressure), and the strategy-rules engine
scope-creeping into a generic rules DSL (constrain to closed-enum-plus-free-text explicitly in that
phase's plan).

## Implications for Roadmap

The user has already decided the build order; research confirms it is dependency-correct and
should be used as-is rather than re-derived. Below, mapped to phase language for roadmap creation.

### Phase 1: Deploy phase-15 image (prod baseline)
**Rationale:** Hard prerequisite — v1.1's re-auth alert isn't live in prod until this ships; every
subsequent phase should be built/tested against a current, not stale, prod surface. Zero
architectural coupling to the rest of v1.2.
**Delivers:** Server+worker+web running the already-merged phase-15 code in prod.
**Addresses:** N/A (ops/deploy only).
**Avoids:** Building v1.2 on top of an untested pre-15 baseline.

### Phase 2: Overview v2 redesign + scenario-engine IV calibration fix
**Rationale:** Both are independent of the picker track, so bundling them first is safe and
delivers visible value early. The IV fix is a repeat of the proven D21 extraction pattern
(`packages/quant`), not a new architectural decision. Component extraction from
`Overview.tsx`/`Shell.tsx` here establishes the "components are files" pattern the Analyzer
redesign leans on next.
**Delivers:** TOS-dock Overview layout live in prod; IV-calibration solver moved to
`@morai/quant` with a convergence-failure result type; extracted `PositionsTable`/`BookSummary`/
`SystemHealth`/`MarketStrip` as real components.
**Uses:** `packages/quant` extension (Feature 5 in ARCHITECTURE.md), existing 3 chart libraries or
plain-SVG port from `overview-v2.html`.
**Implements:** D21-style shim pattern; docs-first `stack-decisions.md` entry (next D-number)
before the `packages/quant` move, per the project's docs-before-architecture rule.
**Avoids:** Pitfall 4 (bisection non-convergence/deep-ITM garbage) and Pitfall 6 (big-bang rewrite
— keep this phase UI-and-solver-fix only, no picker engine work mixed in).

### Phase 3: Analyzer → picker UI redesign, contract-first against fixtures
**Rationale:** The picker engine's two open decisions (DTE-range filter shape, delta-target strike
enumeration) are UX-shaping; resolving them by building the UI against the mockup first, before the
engine's enumeration logic locks in, decouples UX risk from scoring-correctness risk. Zero backend
dependency once the contract exists.
**Delivers:** Ranked-cards rail UI matching `playground-v4.html`, wired to
`packages/contracts/src/picker.ts` (authored first, before any UI code) and a typed
`picker-fixtures.ts` stub.
**Addresses:** Ranked candidate list + why-panel, staleness indicator, DTE/delta filters, payoff
diagram (table-stakes features from FEATURES.md).
**Avoids:** Pitfall 6 (big-bang rewrite) by keeping engine work explicitly out of this phase.

### Phase 4: Picker engine + economic-events adapter (real data wired in)
**Rationale:** Picker scoring criteria 3/4 (event flags, event-penalty) depend on the events
adapter, so it must land first within this phase, not the other way around. Internal order:
events context → picker domain (pure scoring, tested against verified/refuted criteria) →
picker application (wires in existing chain/GEX/rate ports) → route/MCP → swap the fixture import
for the live call.
**Delivers:** `packages/core/src/economic-events/` (FOMC/CPI/NFP, upsertable table,
weekly cron), `packages/core/src/picker/` (pure `scoreCalendarCandidates` + `buildScoredCandidates`
use-case), `GET /api/picker/candidates` route + `get_picker_candidates` MCP tool.
**Addresses:** Economic-event flag, forward-IV differentiator, GEX-fit differentiator,
event-premium-aware baseline (FEATURES.md differentiators).
**Avoids:** Pitfall 1 (stale-chain scoring — `observedAt`/`source` required at the port signature),
Pitfall 2 (FwdIV radicand — property-test inverted-curve fixtures, tagged result not `NaN`),
Pitfall 3 (event-date timezone/staleness — IANA tz storage, startup staleness check). REFUTED
scoring criteria (IV-rank gates, raw IV-diff band, 25-40% debit band) must be encoded as regression
assertions, not just doc notes.

### Phase 5: Tail — stall watchdog → event-triggered snapshot → strategy-rules (L4)
**Rationale:** Ordered cheapest/most-isolated-and-lowest-risk first. Watchdog is pure transport
plumbing with no core changes. Event-triggered snapshot reuses the existing `ForEnqueueingJob`
port and touches the same ACCT_ACTIVITY handler the watchdog work just modified (context stays
warm). Strategy-rules is last because it has the most open scope questions and is most likely to
need its own discuss-phase before planning.
**Delivers:** Three-state stream badge (LIVE/QUIET/STALLED) with heartbeat decoupled from data
cadence; debounced ad-hoc `snapshot-calendars` job triggered off ACCT_ACTIVITY reconcile; closed-
enum `strategy_rules`/`rule_firings` tables recording which rule fired against `entry_thesis`.
**Addresses:** Stream badge and rule-tag table-stakes features; closes the documented v1.1
"badge lies LIVE" gap.
**Avoids:** Pitfall 5 (watchdog false-positives/missed-stall — RTH-vs-quiet state machine, replay
tests both directions) and Pitfall 7 (rules-engine scope creep — closed enum + free text, explicit
non-goal statement in the phase plan, no generic condition grammar, no rule-editor UI).

### Phase Ordering Rationale

- Dependencies flow one direction: events adapter → picker scoring → picker UI-with-real-data;
  nothing later in the sequence is a blocking dependency for anything earlier.
- Grouping follows blast-radius: prod-deploy (zero app-logic risk) → independent UI+solver fixes →
  UI-only redesign against stubs → real engine wiring → fully independent tail items. Risk and
  scope-ambiguity increase through the sequence, which is also the safest order to build public-
  API/schema decisions on top of increasingly-stable ground.
- This ordering directly avoids Pitfall 6 (big-bang rewrite) by construction — UI and engine are
  different phases — and surfaces Pitfall 3/1/2 at the one phase (4) where the events/scoring
  contracts are actually being designed, which is the only point those guards can be added cheaply.

### Research Flags

Phases likely needing deeper research during planning (`--research-phase`):
- **Phase 4 (Picker engine + economic-events adapter):** BLS/Fed release-id lookups still need
  confirming (Employment Situation `release_id` not nailed down in this pass — resolve via
  `fred/releases?search_text=Employment+Situation`); the DTE-range/delta-target enumeration
  decisions are explicitly still open and need to be resolved during this phase's discuss-phase.
- **Phase 5, strategy-rules (L4) sub-item:** scope boundary (rule DSL shape vs. closed enum,
  firing-vs-execution boundary, how `entry_thesis` gets populated) is the most open-ended item in
  the milestone and should get its own discuss-phase before planning, per PITFALLS.md.

Phases with standard patterns (skip research-phase):
- **Phase 1 (deploy):** pure ops, already-merged code, no research needed.
- **Phase 2 (Overview v2 + IV fix):** D21 extraction is a proven in-repo precedent; mockups already
  decided.
- **Phase 3 (Analyzer UI, contract-first):** UI work against an already-approved mockup and a
  Zod-schema-first fixture pattern already used elsewhere in the codebase.
- **Phase 5, watchdog and event-triggered-snapshot sub-items:** both are `setInterval`/pg-boss
  `send()` usage over existing infrastructure — standard, no external research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verdict is "zero new dependencies" grounded directly in existing `package.json`/codebase inspection, not external survey; the two external facts (FRED endpoint param, no FOMC JSON feed) are cross-checked against official docs |
| Features | MEDIUM-HIGH | Comparable-tool behavior (TOS, OptionStrat, ONE, Edgewonk, SpotGamma) is well-documented via official docs/guides; the single-user scope judgment call is this project's own explicit constraint (PROJECT.md), not externally sourced |
| Architecture | HIGH | Grounded directly in `docs/architecture/*`, existing `ports.ts` files, and existing directory shapes — an internal-fit question, not an ecosystem survey |
| Pitfalls | MEDIUM | Project-specific pitfalls (chain staleness, CBOE-UTC precedent, IV-discrepancy doc, watchdog gap) are HIGH — grounded in this project's own docs/incidents; external domain pitfalls (Newton-Raphson near-zero-vega, watchdog heartbeat patterns, strangler-fig rewrite risk, YAGNI) are MEDIUM — cross-checked across multiple sources but no single official-docs citation |

**Overall confidence:** HIGH — this milestone is dominated by internal-architecture-fit questions
where the codebase itself is the primary source, not external technology research.

### Gaps to Address

- FRED release_id for "Employment Situation" (NFP) was not confirmed in this research pass —
  resolve via a one-off API query during Phase 4 before hardcoding the constant.
- DTE-range-as-filter vs. fixed-rule, and delta-target strike enumeration, are both still open
  product decisions (noted in PROJECT.md) — deliberately deferred to Phase 4's discuss-phase so the
  Phase 3 UI can inform them; do not resolve prematurely in Phase 3.
- Strategy-rules (L4) scope (rule DSL shape, firing-vs-execution boundary, `entry_thesis` population
  mechanism) is unresolved by design — needs its own discuss-phase before Phase 5's rules sub-item
  is planned.
- Vasquez slope signal's transfer to SPX (criterion 2 in `calendar-selection-criteria.md`) is
  flagged there as needing a separate in-house backtest — explicitly out of v1.2 scope, tracked as
  a P2/P3 backlog item, not a gap this milestone must close.

## Sources

### Primary (HIGH confidence)
- In-repo: `docs/architecture/{overview,hexagonal-ddd,data-model,jobs,api-design,mcp-and-plugins,streaming-fanout,stack-decisions}.md`
- In-repo: `packages/core/src/{journal,analytics,brokerage,streaming}/**`, `packages/quant/src/**`
- In-repo: `packages/adapters/src/http/fred.ts`, `packages/adapters/src/postgres/migrations/0013_macro_observations.sql`
- In-repo: `apps/web/src/{screens/Overview.tsx,screens/Analyzer.tsx,components/Shell.tsx,lib/scenario-engine.ts}`, `apps/web/package.json`
- `.planning/research/calendar-selection-criteria.md` (adversarially verified scoring criteria — canonical, not re-derived)
- `.planning/PROJECT.md`, `.planning/ROADMAP.md` (scope, constraints, decided build order)
- `docs/iv-engine-discrepancy-and-solver.md` (mid-price convention, solver design precedent)
- FRED API docs: `fred/releases/dates` — https://fred.stlouisfed.org/docs/api/fred/releases_dates.html
- FRED release id 10 = Consumer Price Index — https://fred.stlouisfed.org/release?rid=10
- thinkorswim Spread Hacker / Scan manual (official docs), OptionNet Explorer official site/User Guide

### Secondary (MEDIUM confidence)
- Federal Reserve Board FOMC meeting calendars (HTML only, no feed) — federalreserve.gov
- BLS schedule of releases (HTML only; subject to delay, e.g. Oct 2025 shutdown) — bls.gov/schedule
- Edgewonk, OptionStrat, SpotGamma feature pages; Forex Factory calendar conventions
- Interactive Brokers Quant News / HyperVolatility — Newton-Raphson near-zero-vega non-convergence
- websocket.org, oneuptime.com — heartbeat/ping-pong watchdog best practices
- Strangler Fig pattern write-ups (algomaster.io, Future Processing) — incremental vs. big-bang rewrite risk

### Tertiary (LOW confidence)
- None flagged — all research converged on codebase-grounded or officially-documented answers.

---
*Research completed: 2026-07-03*
*Ready for roadmap: yes*
