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

- [ ] **Phase 23: VIX3M Ingestion** - `VXVCLS` lands daily in `macro_observations`, first and
  alone, before any consumer needs its un-backfillable history

- [ ] **Phase 24: Regime & Breadth Board** - Overview shows an evidence-admitted regime/breadth
  board with per-indicator provenance (source + threshold rationale)

- [ ] **Phase 25: Data-Quality Ops Rider** - `snapshot-calendars` stops writing gap rows; a full
  BSM cohort recompute survives one handler cycle

- [ ] **Phase 26: Exit Advisor** - Every open calendar gets a HOLD/TAKE/STOP/ROLL/EXIT-pre-event
  verdict each cycle, from the user's own playbook ladder

- [ ] **Phase 27: PICK-04 Backtest Harness** - Operator CLI replays stored chains through the live
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

**Plans**: TBD

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

**Plans**: TBD
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

**Plans**: TBD

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

**Plans**: TBD
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

**Plans**: TBD

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

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 23 → 24 → 25 → 26 → 27 → 28

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 23. VIX3M Ingestion | 0/TBD | Not started | - |
| 24. Regime & Breadth Board | 0/TBD | Not started | - |
| 25. Data-Quality Ops Rider | 0/TBD | Not started | - |
| 26. Exit Advisor | 0/TBD | Not started | - |
| 27. PICK-04 Backtest Harness | 0/TBD | Not started | - |
| 28. Playbook Gates, Anti-Criteria & Sizing | 0/TBD | Not started | - |

## Backlog / Future Enhancements

*Unscheduled — not yet assigned to a phase.*

### Schwab client library — revisit vendored TS vs @sudowealth/schwab-api

**Decided 2026-06-21** (full analysis: `.planning/notes/schwab-client-decision.md`). Phase 4
UAT found the vendored chain adapter 502s on the live `$SPX` chain (missing scoping params, not
a missing library). Decision: fix vendored TS now (add `strikeCount`/`fromDate`/`toDate`);
**reject** the Python `schwab-py` sidecar for the pure-TS hexagon (v1.0 decision, now superseded
by v1.1 arch for streaming ownership — the sidecar is the right answer for streaming but not
for the hexagon core). Revisit TS client adoption behind ports, version-pinned, human-verify gate.
