# Roadmap: Morai — Trading Dashboard & Tools

## Milestones

- ✅ **v1.0 Backend + Data Layer** — Phases 1-9 (shipped 2026-06-25)
- ✅ **v1.1 Real-Time Schwab Streaming** — Phases 10-15 (shipped 2026-07-02) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Trade Picker & Dashboard Redesign** — Phases 16-22 (shipped 2026-07-06) — [archive](milestones/v1.2-ROADMAP.md)
- 🚧 **v1.3 Picker Intelligence** — Phases 23-28 (in progress)

Full phase details for shipped milestones live in their archives. Milestone summaries: [MILESTONES.md](MILESTONES.md).

## Phases

<details>
<summary>✅ v1.0 Backend + Data Layer (Phases 1-9) — SHIPPED 2026-06-25</summary>

- [x] Phase 1: Walking Skeleton (6/6 plans) — monorepo + hexagon + DB + deployed status endpoint
- [x] Phase 2: Market Data & BSM Engine (12/12 plans) — completed 2026-06-12
- [x] Phase 3: Calendar Journal MVP (7/7 plans) — completed 2026-06-14
- [x] Phase 4: Schwab Auth & Brokerage (6/6 plans) — completed 2026-06-20
- [x] Phase 5: Jobs, Fill Rebuild & Integrity (15/16 plans) — completed 2026-06-22
- [x] Phase 6: Derived Analytics (8/8 plans) — completed 2026-06-22
- [x] Phase 7: Trade History (2/2 plans) — completed 2026-06-22
- [x] Phase 8: Web Dashboard Backend (8/8 plans) — completed 2026-06-24
- [x] Phase 9: Web Dashboard Frontend (10/10 plans) — completed 2026-06-25

</details>

<details>
<summary>✅ v1.1 Real-Time Schwab Streaming (Phases 10-15) — SHIPPED 2026-07-02</summary>

- [x] Phase 10: Stack Decisions Doc Update (1/1 plans) — completed 2026-06-25
- [x] Phase 11: Sidecar Scaffold + Auth Migration (7/7 plans) — completed 2026-06-25
- [x] Phase 12: Streaming + TS Fan-Out (7/7 plans) — completed 2026-06-29
- [x] Phase 13: COT Adapter (6/6 plans) — completed 2026-06-29
- [x] Phase 14: FRED Expansion (7/7 plans) — completed 2026-07-02
- [x] Phase 15: Re-Auth Smoothing (5/5 plans) — completed 2026-07-02

</details>

<details>
<summary>✅ v1.2 Trade Picker & Dashboard Redesign (Phases 16-22) — SHIPPED 2026-07-06</summary>

- [x] Phase 16: Deploy Phase-15 Image (3/3 plans) — completed 2026-07-03
- [x] Phase 17: Overview v2 Redesign + IV Calibration Fix (4/4 plans) — completed 2026-07-03
- [x] Phase 17.1: Overview Payoff — TOS-Fidelity Graph + Interactivity (5/5 plans) — completed 2026-07-04
- [x] Phase 18: Analyzer → Picker UI Redesign (5/5 plans) — completed 2026-07-04
- [x] Phase 19: Picker Engine + Economic Events (9/9 plans) — completed 2026-07-04
- [x] Phase 20: Stream Watchdog, Event Snapshot & Strategy Rules (11/11 plans) — completed 2026-07-05
- [x] Phase 21: Control Affordance & Button System (6/6 plans) — completed 2026-07-05
- [x] Phase 22: Journal Calendar-Lifecycle Graph (6/6 plans) — completed 2026-07-05

Full details: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

</details>

### 🚧 v1.3 Picker Intelligence (In Progress)

**Milestone Goal:** Close the trade loop — the engine that picks entries with the user's real
criteria learns to manage exits, proves its rules on his own trade history, and inherits the rest
of his trading-knowledge playbook. Every rule research-grounded — "no feeling."

- [x] **Phase 23: VIX3M Ingestion** - `VXVCLS` lands daily in `macro_observations`, first and (completed 2026-07-09)
  alone, before any consumer needs its un-backfillable history

- [x] **Phase 24: Regime & Breadth Board** - Overview shows an evidence-admitted regime/breadth (completed 2026-07-09)
  board with per-indicator provenance (source + threshold rationale)

- [x] **Phase 25: Data-Quality Ops Rider** - `snapshot-calendars` stops writing gap rows; a full (completed 2026-07-09)
  BSM cohort recompute survives one handler cycle

- [x] **Phase 26: Exit Advisor** - Every open calendar gets a HOLD/TAKE/STOP/ROLL/EXIT-pre-event (completed 2026-07-09)
  verdict each cycle, from the user's own playbook ladder

- [x] **Phase 27: PICK-04 Backtest Harness** - Operator CLI replays stored chains through the live (completed 2026-07-09)
  entry+exit rules, honest at n=13 (refutation-only, never a weight-fitter)

- [ ] **Phase 28: Playbook Gates, Anti-Criteria & Sizing** - Market-level crisis gates,
  anti-criteria brakes, and VIX-tiered sizing complete the picker's playbook port

## Phase Details

### Phase 23: VIX3M Ingestion

**Goal**: VIX3M (FRED `VXVCLS`) starts accreting daily in `macro_observations` alongside the
existing 8 series, before any consumer (crisis gates, regime board, backtest) needs its history —
the series has no backfill, so every day skipped is permanently lost.
**Depends on**: Nothing new — extends the existing FRED macro pipeline from Phase 14 (v1.1)
**Requirements**: MACRO-01
**Success Criteria** (what must be TRUE):

  1. VIX3M's current value is queryable via the existing `GET /api/analytics/macro` and MCP
     `get_macro` surfaces, alongside the other 8 series, on the same twice-daily cadence.

  2. VIX3M has been accruing daily in `macro_observations` since this phase deployed — no gap on
     day one.

  3. A failed FRED fetch for `VXVCLS` degrades the same way the other 8 series already do (a
     visible error state, never a silent skip).

**Plans**: 1/1 plans complete

- [x] 23-01-PLAN.md — VXVCLS added to DEFAULT_FRED_SERIES_IDS + MACRO_SERIES_IDS enum (TDD), memory-twin + contract parity rows, docs counts corrected

### Phase 24: Regime & Breadth Board

**Goal**: The user can see the market's regime/breadth state at a glance on the Overview tab —
every indicator admitted only after documented research evidence, each showing its threshold
state and its "why."
**Depends on**: Phase 23 (VIX3M is one of the board's inputs; the board reads from the
now-accreting macro pipeline)
**Requirements**: MACRO-02, MACRO-03, BOARD-01, BOARD-02, BOARD-03
**Success Criteria** (what must be TRUE):

  1. Every indicator on the board was admitted only after a documented source + rationale was
     recorded (mirroring `picker-rules.md`'s evidence discipline) — no indicator ships without a
     citation.

  2. Overview tab shows a regime/breadth board: each indicator's current value, threshold band
     (calm/warning/crisis), and as-of date.

  3. Each board indicator exposes its "why" (source + threshold rationale) the same way the
     Analyzer scorecard exposes rule provenance.

  4. Board data is available via an HTTP route and an MCP tool (MCP-02 convention).

  5. Indicators update on a daily cadence with as-of dates stamped — EOD data is never presented
     as if it were intraday.

**Plans**: 5/5 plans complete

- [x] 24-01-PLAN.md — Docs-first (regime-board.md evidence table + refutations) + HY OAS (BAMLH0A0HYM2) into FRED macro pipeline
- [x] 24-02-PLAN.md — CBOE _VIX9D adapter (clone of cboe-vvix) + port + in-memory twin + macro-orchestration/worker wiring
- [x] 24-03-PLAN.md — regimeResponse contract + 4 pure banding functions (named threshold constants, fast-check)
- [x] 24-04-PLAN.md — getRegimeBoard use-case (computed-on-read, missing→omit, as-of) + GET /api/analytics/regime + get_regime MCP tool
- [x] 24-05-PLAN.md — Overview "Regime & breadth" board UI (chip grid, band triad, provenance tooltip) per UI-SPEC

**UI hint**: yes

### Phase 25: Data-Quality Ops Rider

**Goal**: The pipeline the inference features depend on stops producing silent data corruption —
journal snapshots stop gapping, and a full BSM cohort recompute reliably finishes within one job
cycle.
**Depends on**: Nothing new — fixes the existing `snapshot-calendars`/`compute-bsm-greeks`
pipeline; sequenced here so Exit Advisor and Backtest never inherit its defects
**Requirements**: OPS-01, OPS-02
**Success Criteria** (what must be TRUE):

  1. Newly-taken open-calendar journal snapshots have complete price/greek data going forward —
     no more spot=0/NaN gap rows under normal market conditions (root cause fixed, not
     gap-filled after the fact).

  2. A full BSM cohort recompute completes within a single pg-boss handler cycle during normal
     chain volume, without hitting the 900s timeout-and-retry dance.

**Plans**: 2/2 plans complete

Plans:

- [x] 25-01-PLAN.md — OPS-01: LegSnapshot.time freshness gate — snapshot-calendars skips missing/stale legs instead of writing gap rows (TDD)
- [x] 25-02-PLAN.md — OPS-02: compute-bsm-greeks batch-commit loop + wall-clock budget — durable per-batch drain under the 900s cap (TDD)

### Phase 26: Exit Advisor

**Goal**: Every open calendar gets one clear, explainable verdict each picker cycle — from the
user's own playbook ladder, never a bare or fabricated-confidence call.
**Depends on**: Phase 25 (verdicts must not be computed on gap rows or a partially-solved BSM
cohort)
**Requirements**: EXIT-01, EXIT-02, EXIT-03, EXIT-04, EXIT-05, EXIT-06, EXIT-07, EXIT-08, EXIT-09,
EXIT-10
**Success Criteria** (what must be TRUE):

  1. Every open calendar shows a verdict each cycle — HOLD, TAKE (+5/+10/+15% ladder rung), STOP
     (−25/−50%), or EXIT-pre-event — naming the rule that fired and its raw metric, with no bare
     or fabricated-confidence verdicts.

  2. Verdicts derive from the validated journal fill-ledger P&L and the latest calendar snapshot,
     and are session/staleness-gated with hysteresis — no flapping on AH-indicative marks or gap
     rows.

  3. TERM, GAMMA, and EVT triggers fire per their documented thresholds (front−back IV inversion
     ≥0.5pp; spot >2% off strike with front <7 DTE; tier-1 event ≤3 days from front expiry), and a
     ROLL verdict suggests a haircut-priced replacement front when its conditions are met.

  4. The Analyzer shows a held-positions panel with per-calendar verdict chips and the exit rule
     set rendered from the engine (entry-methodology symmetry), and the MCP tool answers "what
     should I do with my open calendars?" with the same verdict payloads.

  5. Only verdict changes surface as alerts — STOP and EXIT-pre-event escalate distinctly, no
     spam — and the advisor only ever advises: it never places or modifies an order.

**Plans**: 6/6 plans complete

- [x] 26-01-PLAN.md — Docs (exit-rules.md) + haircut extraction + exits contracts/types/ports interface
- [x] 26-02-PLAN.md — Exit-rule registry + pure evaluateExit (precedence, hysteresis, gating, ROLL) [TDD]
- [x] 26-03-PLAN.md — Migration 0020 + exit_verdicts repo/twin + journal latest-snapshot port [TDD]
- [x] 26-04-PLAN.md — computeExitAdvice/getExitAdvice use-cases + worker chain trigger + EXIT-10 guard [TDD]
- [x] 26-05-PLAN.md — GET /api/exits route + get_exit_advice MCP tool (MCP-02 parity) [TDD]
- [x] 26-06-PLAN.md — Analyzer held-positions panel + exit rules panel (per 26-UI-SPEC)

**UI hint**: yes

### Phase 27: PICK-04 Backtest Harness

**Goal**: The operator can replay stored chain history through the exact same entry+exit rule
functions used live, proving their mechanics honestly — without lookahead, survivorship bias, or
a false claim of statistical power at n=13.
**Depends on**: Phase 26 (replays the exit-rule registry Phase 26 builds; needs both entry and
exit domains to exist)
**Requirements**: BT-01, BT-02, BT-03, BT-04, BT-05
**Success Criteria** (what must be TRUE):

  1. Operator can run a CLI that replays stored chains (since 2026-06-12) through the same pure
     entry+exit rule functions with point-in-time correctness — no lookahead, `observedAt ≤ T`
     filtering enforced.

  2. Replaying a historical cohort reproduces that cohort's recorded live `picker_snapshot` score
     exactly — the leakage oracle that catches percentile/lookahead bugs automatically.

  3. The harness reproduces the 13 closed calendars' validated outcomes (direction + rough
     magnitude), with the same fill-haircut function applied on both entry and exit.

  4. Per-rule directional attribution and leave-one-rule-out ablation are reported with every
     number stamped `n=` and its date range, persisted append-only to `backtest_runs`.

  5. The harness never writes weights — its output is directional evidence a human reads; weight
     promotion stays gated until n≥30 real closed trades.

**Plans**: 6 plans

- [x] 27-01-PLAN.md — Docs + migration 0021 backtest_runs + INSERT-only repo/twin + backtest module skeleton
- [x] 27-02-PLAN.md — Reuse seams: additive @morai/core exports + ablation weights seam + computeLegPairMetrics extraction
- [x] 27-03-PLAN.md — Point-in-time readers: as-of-T chain (no-lookahead) + as-of-T RV20 + cohort ledger + source-inclusive history
- [x] 27-04-PLAN.md — Report kernel (fast-check): directional attribution + ablation-delta + seeded bootstrap CI + coverage
- [x] 27-05-PLAN.md — Replay engine: leakage oracle (BT-02) + 13-trade exit reproduction (BT-03) + full-universe hypothetical (BT-04)
- [x] 27-06-PLAN.md — runBacktest report assembly + DATABASE_URL-only CLI + BT-05 no-write-path guard

### Phase 28: Playbook Gates, Anti-Criteria & Sizing

**Goal**: The picker inherits the rest of the user's playbook — it computes nothing new to enter
when the market itself says don't, brakes on the user's own risk rules, and sizes and buckets
trades the way he already does by hand.
**Depends on**: Phase 24 (crisis gates read the VIX3M/regime history the board established),
Phase 27 (gate thresholds and sizing tiers are informed by the backtest's directional evidence)
**Requirements**: PLAY-01, PLAY-02, PLAY-03, PLAY-04, PLAY-05
**Success Criteria** (what must be TRUE):

  1. The picker computes nothing new to enter when VIX ≥ 25 or VIX/VIX3M ≥ 0.95 — banded with
     hysteresis, not a hard cliff — and the regime board reflects the gate's current state.

  2. New entries pause automatically when an anti-criteria brake trips: too many open calendars,
     a recent realized-loss cooldown, or a sustained adverse trend.

  3. The picker recommends a discrete, user-set contract count per VIX regime tier — never a
     derived optimum.

  4. Short-gap (3-10 day) event calendars are scored through a separate, event-appropriate rule
     set from the standard band-scan universe.

  5. The band scan's target-delta preference is VIX-tuned (`autoTuneTargetDelta`), applied
     additively and only after the crisis-gate infrastructure is live.

**Plans**: 6 plans

- [ ] 28-01-PLAN.md — Docs + shared VIX ladder + market-level entry-gate domain (banding, hysteresis, GATE BLIND) [PLAY-01]
- [ ] 28-02-PLAN.md — New recent-closed-calendars port/repo/twin + anti-criteria brakes domain [PLAY-02]
- [ ] 28-03-PLAN.md — Use-case wiring + additive gate snapshot payload + composition root [PLAY-01, PLAY-02]
- [ ] 28-04-PLAN.md — VIX-tiered discrete sizing + autoTuneTargetDelta (experimental/deferrable) [PLAY-03, PLAY-05]
- [ ] 28-05-PLAN.md — Event-calendar bucket: second universe + separate rule set [PLAY-04]
- [ ] 28-06-PLAN.md — UI (board gate state + Analyzer sizing/bucket) + MCP surface + UAT checkpoint [PLAY-01, PLAY-03, PLAY-04]

## Progress

**Execution Order:**
Phases execute in numeric order: 23 → 24 → 25 → 26 → 27 → 28

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 23. VIX3M Ingestion | 1/1 | Complete    | 2026-07-09 |
| 24. Regime & Breadth Board | 5/5 | Complete    | 2026-07-09 |
| 25. Data-Quality Ops Rider | 2/2 | Complete    | 2026-07-09 |
| 26. Exit Advisor | 6/6 | Complete    | 2026-07-09 |
| 27. PICK-04 Backtest Harness | 6/6 | Complete    | 2026-07-09 |
| 28. Playbook Gates, Anti-Criteria & Sizing | 0/6 | Not started | - |

## Backlog / Future Enhancements

*Unscheduled — not yet assigned to a phase.*

### Schwab client library — revisit vendored TS vs @sudowealth/schwab-api

**Decided 2026-06-21** (full analysis: `.planning/notes/schwab-client-decision.md`). Phase 4
UAT found the vendored chain adapter 502s on the live `$SPX` chain (missing scoping params, not
a missing library). Decision: fix vendored TS now (add `strikeCount`/`fromDate`/`toDate`);
**reject** the Python `schwab-py` sidecar for the pure-TS hexagon (v1.0 decision, now superseded
by v1.1 arch for streaming ownership — the sidecar is the right answer for streaming but not
for the hexagon core). Revisit TS client adoption behind ports, version-pinned, human-verify gate.

### Phase 29: Runtime Rule Settings — curated ~20-knob settings surface (entry/picker weights + bands, exit advisor rungs, regime bands) stored as JSONB overrides over code defaults, gear-icon modal in top bar

**Goal:** Make the hard-coded trading rule thresholds adjustable at runtime. A curated ~20-knob
subset (entry/picker weights + bands, exit-advisor TAKE/STOP rungs, regime warn/crisis bands)
becomes editable through a single JSONB overrides row merged over the code defaults at consumption
time (worker compute-picker/compute-exit-advice job start, server regime request time), surfaced
by a gear-icon modal in the top bar grouped by engine with reset-to-defaults per group. Omitting
an override reproduces today's behavior byte-identically (backtest leakage-oracle safe).
**Requirements**: none mapped — user-added phase; scope defined by 29-CONTEXT.md locked decisions
**Depends on:** Phase 28
**Plans:** 5/14 plans executed

Plans:
**Wave 1**

- [x] 29-01-PLAN.md — Docs-before-code: rule_overrides decision + rule-overrides.md + TOPIC-MAP (T-28-11 override)
- [x] 29-02-PLAN.md — Contract: rule-settings Zod schema (whitelist, weight-sum + hysteresis-pair refines)
- [x] 29-03-PLAN.md — Picker scalar seams: candidate-selection deltaMax/frontDte, rules debitFit, brakes maxOpen
- [x] 29-04-PLAN.md — Picker ladder/sizing seams: resolveVixLadder + resolveEntryGate ladder + resolveSizingTier override
- [x] 29-05-PLAN.md — Exits seam + resolveExitRuleConfig (evaluateExit 4th config arg)
- [ ] 29-06-PLAN.md — Regime seam + resolveRegimeRuleConfig (four band thresholds)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 29-07-PLAN.md — resolvePickerRuleConfig merge fn (fast-check, byte-identical omission)
- [ ] 29-09-PLAN.md — Settings core: ports + getRuleSettings/setRuleOverrides + merge helpers

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 29-08-PLAN.md — Storage: ruleOverrides table + migration 0022 [BLOCKING] + repo + memory twin

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 29-10-PLAN.md — Picker consumption wiring: fresh read + config thread + effective ruleSet stamp
- [ ] 29-12-PLAN.md — Regime consumption wiring: fresh read per request + banding

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 29-11-PLAN.md — Exits consumption wiring: fresh read + evaluateExit config (worker root)
- [ ] 29-13-PLAN.md — Server surface: GET/PUT /api/settings/rules + MCP tools + engine-computed defaults

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 29-14-PLAN.md — Web: useRuleSettings hook + gear-icon settings modal (human-verify)

### Phase 30: Analyzer pasted-calendar fix — payoff graph x-domain must fit the full tent (both tails + BEs currently clipped, e.g. 7500P pasted shows apex at right edge and left tail cut), and pasted calendars must get real entry analysis (engine scoring) instead of 'Pasted calendar — not engine-scored' in WHY THIS CALENDAR / ENTRY-EXIT PLAN panels

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 29
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 30 to break down)
