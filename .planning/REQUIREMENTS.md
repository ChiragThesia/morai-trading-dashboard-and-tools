# Requirements: Morai v1.3 Picker Intelligence

**Defined:** 2026-07-09
**Core Value:** The journal — plus, this milestone: the engine that picks entries with the user's
real criteria learns to manage exits, proves its rules on his own history, and inherits the rest
of his playbook. Every rule research-grounded — "no feeling."

## v1.3 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Ops rider (defect fixes the new features consume)

- [ ] **OPS-01**: snapshot-calendars no longer writes empty/gap journal rows — open-calendar
      series are complete going forward (root-cause the ~74% gap-row windows)
- [ ] **OPS-02**: compute-bsm-greeks commits work in batches so a full-cohort drain survives the
      900s pg-boss handler cap without the timeout+retry dance

### Macro & regime data (day-one plumbing — no backfill exists)

- [ ] **MACRO-01**: VIX3M ingested daily from FRED (`VXVCLS`) into macro_observations alongside
      the existing 8 series
- [ ] **MACRO-02**: Regime/breadth indicator set researched online and admitted only with
      documented evidence (candidates: RSP:SPY equal-weight breadth ratio, VIX9D/VIX and
      VVIX/VIX ratios, term-structure state, FRED movement series) — each indicator carries a
      source + rationale in docs, mirroring picker-rules.md discipline
- [ ] **MACRO-03**: Evidence-admitted indicators are ingested/computed on a daily cadence with
      as-of dates stamped (EOD data never presented as intraday)

### Regime board (Overview tab)

- [ ] **BOARD-01**: Overview tab shows a visible regime/breadth board: each indicator with
      current value, threshold state (calm/warning/crisis banding), and as-of date
- [ ] **BOARD-02**: Each board indicator exposes its "why" (source + threshold rationale) the
      same way the Analyzer scorecard exposes rule provenance
- [ ] **BOARD-03**: Board data ships HTTP + MCP (MCP-02 convention)

### Exit advisor

- [ ] **EXIT-01**: Every open calendar gets a verdict each pipeline cycle — HOLD / TAKE (with
      ladder rung +5/+10/+15%) / STOP (−25/−50%) / EXIT-pre-event — from a typed exit-rule
      registry mirroring rules.ts
- [ ] **EXIT-02**: Verdicts derive from the validated journal fill-ledger P&L basis (never a
      recomputed parallel P&L) and the latest calendar snapshot (netMark, term structure, greeks)
- [ ] **EXIT-03**: TERM trigger fires on live front−back IV inversion ≥0.5pp; GAMMA trigger on
      spot >2% off strike with front <7 DTE; EVT trigger on tier-1 event ≤3d from front expiry
- [ ] **EXIT-04**: Each verdict names the rule that fired and its raw metric (no bare verdicts,
      no fabricated confidence percentages)
- [ ] **EXIT-05**: Verdicts are session/staleness-gated with hysteresis banding — no flapping on
      AH-indicative marks or gap rows
- [ ] **EXIT-06**: ROLL verdict: when front <14 DTE, spot within ±1% of strike, profit <15%, and
      no blocking event — advisor suggests a haircut-priced replacement front (+14–21 DTE)
- [ ] **EXIT-07**: Analyzer shows a held-positions panel with per-calendar verdict chips + the
      exit ruleSet rendered from the engine (entry-methodology symmetry)
- [ ] **EXIT-08**: MCP tool answers "what should I do with my open calendars?" with the same
      verdict payloads
- [ ] **EXIT-09**: Only verdict CHANGES are surfaced as alerts; STOP and EXIT-pre-event escalate
      distinctly (no alert spam)
- [ ] **EXIT-10**: Advisor never executes — advise + alert only (STRM-04 read-only boundary)

### PICK-04 backtest harness

- [ ] **BT-01**: Operator CLI replays stored chains (leg_observations since 2026-06-12) through
      the SAME pure entry + exit rule functions with point-in-time correctness (no lookahead;
      as-of ≤T filtering)
- [ ] **BT-02**: Replay of a historical cohort reproduces the recorded live picker_snapshot score
      for that cohort (leakage oracle — catches percentile leakage and late-solved-BSM lookahead)
- [ ] **BT-03**: Harness reproduces the 13 closed calendars' validated outcomes (direction +
      rough magnitude) with fill-haircut applied on entry AND exit — mechanics validation
- [ ] **BT-04**: Per-rule directional attribution + leave-one-rule-out ablation reported with
      every number stamped `n=` and date range; report persisted append-only (backtest_runs)
- [ ] **BT-05**: The harness never writes weights — outputs are directional evidence flags a
      human reads; weight promotion stays gated until n≥30 real closed trades

### Playbook gates & sizing

- [ ] **PLAY-01**: Market-level crisis gates: picker computes nothing new to enter when VIX ≥ 25
      or VIX/VIX3M ≥ 0.95 (banded/dated — lean penalty-over-cliff per the retired-gate lessons;
      board shows the gate state)
- [ ] **PLAY-02**: Anti-criteria brakes: max open calendars, loss cooldown (recent realized loss
      pauses new entries), sustained-trend filter — thresholds from the trade-advisor playbook,
      confirmed with user at phase discuss
- [ ] **PLAY-03**: Sizing tiers: recommended contract count per VIX regime tier (discrete,
      user-set — never a derived optimum)
- [ ] **PLAY-04**: Event-calendar bucket: second universe path for short-gap (3–10d) calendars
      that intentionally own an event, scored with event-appropriate rules
- [ ] **PLAY-05**: autoTuneTargetDelta: VIX-tuned target-delta preference applied to the band
      scan (additive, after crisis-gate infra lands)

## Future Requirements

Deferred. Tracked but not in the v1.3 roadmap.

- **Weight promotion/demotion from backtest evidence** — blocked until n≥30 real closed trades
- **Auto roll-order construction** — order-entry boundary; advise only
- **Tick-level exit re-evaluation** — contradicts STRM-04 + 30-min cadence

## Out of Scope

Explicit exclusions with reasoning.

| Feature | Reason |
|---------|--------|
| Auto-execution of exits/rolls | Read-only boundary (STRM-04); Morai never places orders |
| Confidence %/probabilities on verdicts | No calibration basis at n=13 — fabricated precision |
| Backtest DSL / generic strategy language | YAGNI — one trader, one strategy family, one engine |
| Kelly / optimal-f sizing | Needs a reliable edge estimate the sample cannot provide |
| Rule-parameter optimization against the 13 trades | Overfitting formalized; params stay user-locked |
| Per-pair crisis gates (term-inversion revival) | Retired 2026-07-09 — deleted trades with edge; crisis lives at market level |
| ML regime-classification model | Two threshold gates suffice; live advice stays in the trade-advisor plugin |

## Traceability

Filled by roadmap creation.

| Requirement | Phase |
|-------------|-------|
