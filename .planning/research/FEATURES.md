# Feature Research — v1.3 Picker Intelligence

**Domain:** Single-user, self-hosted SPX calendar-spread trading system — held-position exit
advisor, options-strategy backtest harness, and a personal-playbook rule port. Extends an
existing entry picker (9-rule weighted registry), validated journal P&L, GEX/greeks/term-structure
analytics, and an MCP surface.
**Researched:** 2026-07-08
**Confidence:** MEDIUM-HIGH (exit-management and backtest-honesty norms are well-sourced and
cross-checked; the specific rule thresholds are the user's own already-validated playbook, not
re-derived here. This file supersedes the prior v1.2 FEATURES.md, which is archived with v1.2
milestone research.)

This file covers ONLY the three NEW v1.3 feature areas. Existing shipped features (entry picker,
journal, live greeks, GEX/skew, COT/FRED, economic events, MCP) are out of scope — see
`.planning/PROJECT.md`. Entry scoring criteria are NOT re-researched — see
`docs/architecture/picker-rules.md` (already adversarially verified) and
`.planning/research/calendar-selection-criteria.md`.

## The One Thing That Reframes Everything: Sample Size

Read this before the feature tables. It changes what the backtest feature is *allowed to be*.

The corpus is **13 validated closed calendars + ~1 month of stored chains** (`leg_observations`
since 2026-06-12). The statistical floors for a trading backtest (Bailey & López de Prado,
cross-checked against the standard literature) are:

- **~30 trades** — the bare statistical floor for any significance at all.
- **~100 trades** — basic reliability of aggregate metrics (win rate, P&L/day).
- **200–500 trades** — institutional confidence.
- And trade count alone is not enough: **500 trades in one regime is weaker than 100 across
  several.** One month of 2026-06/07 chains is a **single volatility regime.**

13 trades is **less than half the bare floor, inside one regime.** The consequences are hard
constraints on Feature 2, not soft cautions:

- **Per-rule weight OPTIMIZATION is impossible honestly.** 9 scored rules against 13 outcomes
  is more knobs than data — the definition of overfitting. The Probability of Backtest
  Overfitting is near-certain at this ratio; a Deflated Sharpe Ratio would deflate any headline
  number to nothing.
- **Parameter search (delta band, DTE window, thresholds) is worse** — continuous knobs fit to
  13 points give a perfect in-sample curve with zero out-of-sample meaning.
- **What IS honest:** deterministic replay with no lookahead, reproducing the 13 known
  outcomes as a *mechanics* check, and *directional* per-rule attribution flagged with its
  sample size. Never a re-weighting.

Every number the backtest emits must carry `n=13` and its date range. This constraint is woven
into the tables below and is the single most important thing the roadmap must respect. Confidence:
MEDIUM-HIGH (statistical consensus, multiple sources).

## Feature Landscape

### Table Stakes (Users Expect These)

Features the trader assumes exist. Missing = the feature feels broken or dishonest.

**Exit Advisor**

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Live P&L per open calendar (% of debit + $) | Every exit decision anchors on "where am I vs entry?" A verdict with no P&L is meaningless | LOW | Journal P&L fill-ledger already computes this (validated vs real-txn oracle, 13 calendars). Reuse, don't recompute |
| One clear verdict per position (HOLD/TAKE/STOP/ROLL/EXIT-pre-event) | Retail norm (tastytrade, tos): exit is an action verb attached to the position, not a metric dump | MEDIUM | New exit rule registry mirroring `packages/core/src/picker/domain/rules.ts`. One recommended action, always |
| The "why" — which rule fired + its raw metric | Entry picker already renders its methodology table from the engine; user expects symmetry on exits | LOW-MEDIUM | Ship the exit `ruleSet` to the UI exactly like `pickerSnapshotResponse.ruleSet` |
| Front DTE + time/gamma context | 21-DTE / terminal-gamma discipline is universal exit canon; drives GAMMA and ROLL triggers | LOW | Front DTE already on live greeks |
| Spot-vs-strike distance | GAMMA trigger (spot >2% off strike & front <7 DTE) | LOW | Spot + strike already present |
| Event proximity to front expiry | EVT trigger (tier-1 event ≤3d before front); entry already stamps `exitPlan.closeByExpiry` | LOW | `economic_events` adapter + the exitPlan stamp are the handoff contract |

**Backtest Harness (PICK-04)**

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Deterministic replay loop (chain@T → engine → walk forward → exit verdict → realized P&L) | This IS a backtest; anything less is a spreadsheet | MEDIUM-HIGH | Call the SAME `scoreCalendarCandidates` + exit registry — never re-implement the rules |
| Point-in-time correctness (no lookahead) | The #1 backtest bug; lookahead gives false confidence — worse than no backtest | MEDIUM-HIGH | `leg_observations` is timestamped; filter to as-of ≤T. Chronological replay IS walk-forward by construction |
| Mechanics validation vs the 13-trade oracle | The 13 closed calendars have validated real-fill P&L; the harness must reproduce their direction/rough magnitude or it's broken | MEDIUM | The honest, achievable win. If the sim says a winner lost, stop and fix the harness |
| Fill-haircut applied on BOTH entry and exit | Ranking on mid/theory overstates edge; P&L without the ORATS 66% cross is fantasy | MEDIUM | Same haircut model the entry universe already uses |
| Aggregate metrics with sample size stamped | Win rate, avg P&L, **P&L-per-day-in-trade** (tastytrade's preferred metric), max drawdown | LOW | Every number carries `n=13` + date range. No exceptions |

**Playbook Port**

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| VIX3M series ingestion (`VIXCLS3M`) | Prerequisite for the crisis gates; picker-rules doc explicitly defers them pending this series | LOW | FRED adapter live (8 series); this is series #9. Pure plumbing into `macro_observations` |
| Market-level crisis gates (VIX <25; VIX/VIX3M <0.95) | Standard discipline rails; drop all candidates in a crisis regime | LOW | GATES applied once at market level — NOT per-candidate. The retired per-pair term-inversion gate proved crisis logic belongs here |
| Anti-criteria gates (max open calendars, loss cooldown, trend filter) | Over-trading is the #1 retail account-killer; portfolio-level entry brakes | MEDIUM | Need open-position count + recent realized P&L — same state the exit advisor reads |

### Differentiators (Competitive Advantage)

Where Morai beats a generic tool. Aligns with the Core Value: *the engine picks with the user's
real criteria, now manages the whole trade loop.*

**Exit Advisor**

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Playbook-encoded verdict registry | HIS ladder (+5/+10/+15% takes, −25/−50% stops, EVT≤3d, TERM inversion ≥0.5pp, GAMMA, roll rule) auto-evaluated every cycle — not a generic 50%/21DTE. No retail tool does per-position verdicts from a personal playbook | MEDIUM | The headline differentiator. Mirror the entry registry's typed-row architecture |
| TERM trigger from live term structure | Exit on front−back IV inversion ≥0.5pp. Morai already computes term structure + forward vol per calendar (journal lifecycle graph) | MEDIUM | No retail tool watches term inversion as an exit signal |
| Precomputed every cycle, no manual trigger | Verdicts land on the `compute-picker` job cadence; the held-positions panel is always current | MEDIUM | Reuse the Phase-19 precompute pattern; append-history table like picker |
| MCP exit-verdict tool | "What should I do with my open calendars?" answerable in Claude Code | LOW-MEDIUM | Every surface ships HTTP+MCP (MCP-02) |
| Laddered TAKE (scale at +5 / more at +10 / full at +15) | The ladder is inherently multi-level; present tiered, not binary | MEDIUM | Verdict payload carries the rung, UI renders the ladder |

**Backtest Harness (PICK-04)**

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-rule DIRECTIONAL attribution (sign, not coefficient) | "Did high-scoring-rule trades beat low-scoring ones?" reported as a direction + `n`, never a re-weighting. Honest ablation at tiny n | LOW-MEDIUM | e.g. "fwdEdge pointed right on 8/11 trades where it had an opinion." Qualitative, evidence-flagged |
| Leave-one-rule-out ablation | Does dropping a rule change which candidate gets picked, and did that help or hurt? Reveals redundant rules cheaply, even at n=13 | LOW-MEDIUM | Many of 9 rules may be doing nothing; this is where you'd learn it |
| Replay-as-forward-test scaffolding | Built so the SAME harness gets more powerful as trades close and chains accumulate — validates mechanics today, calibrates weights when n≥30 | MEDIUM | The value compounds. Design for the future sample, ship for today's |

**Playbook Port**

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Sizing tiers by regime | Recommended contract count per VIX tier — extends the picker from "what structure" to "what AND how much," closing the entry side of the trade plan | MEDIUM | Discrete user-set tiers, NOT a derived optimum (see anti-features) |
| Event-calendar bucket (gap 3–10d cheap) | A distinct second play style: short-gap calendars that intentionally own an event in the window, alongside the main band-scan | MEDIUM | New universe-generation path in `candidate-selection.ts`; the `backEventBonus` experimental rule already gestures at it |
| Regime-tuned target delta (`autoTuneTargetDelta`) | VIX-tuned entry-band preference; deferred in picker-rules doc pending VIX3M | LOW-MEDIUM | Additive to the band-scan; only after crisis-gate infra lands |

### Anti-Features (Commonly Requested, Often Problematic)

Features that look good and create real problems. Naming them prevents scope creep and boundary
violations.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-execution of exits/rolls | "The advisor knows what to do, let it do it" | Crosses the read-only boundary. Stream is display-only (STRM-04); Morai never places orders. Auto-close needs order-entry auth and turns a data tool into a liable trading bot | Advise + alert; the human executes in the broker. **The single most important boundary to hold** |
| Confidence % / probability on a verdict | "78% confidence" feels rigorous | With 13 trades there is no basis to calibrate a probability — fabricated precision | Show which rule fired + the raw metric (profit %, DTE, IV spread). Let the number speak |
| Tick-level exit re-evaluation | "Real-time exits" | Contradicts STRM-04 (no per-tick writes) and the 30-min cadence; invites alert spam | Cycle-cadence verdicts + a "materially changed" delta highlighting new verdicts |
| Notification on every state | "Alert me on everything" | A verdict flipping HOLD→TAKE→HOLD is noise; over-managing is a documented failure mode | Surface only verdict CHANGES; escalate only the irreversible ones (STOP, EXIT-pre-event) |
| Automated weight promotion/demotion from the backtest | Milestone brief literally says "promote/demote weights with evidence" | At n=13 the evidence does not exist. Auto-promoting a rule because it "worked" on 13 trades is overfitting formalized | Backtest OUTPUTS a directional flag + `n`; a human decides. **Defer any promotion until n≥30 real closed trades.** picker-rules doc already gates promotion on PICK-04 — read "evidence" as "a real sample" |
| Optimizing rule parameters to fit the 13 | "Find the best delta band / DTE window" | Continuous knobs + 13 points = perfect in-sample fit, zero out-of-sample meaning | Parameters stay user-locked (already research-verified); the backtest reports how the LOCKED params did, never searches |
| Sharpe / fancy risk-adjusted metrics on 13 trades | "Institutional-grade stats" | A Sharpe from 13 trades is noise dressed as rigor; DSR deflates it to ~0 anyway | Raw win rate + P&L/day + `n`, with "not statistically significant" stated plainly |
| A backtesting DSL / configurable strategy language | "Make it flexible for any strategy" | YAGNI — one trader, one strategy family (SPX put calendars), one engine. A generic backtester is months of work for a "replay MY engine over MY chains" problem | A thin replay loop that calls the existing engine |
| Full regime-classification / ML market-timing model | "Detect the regime automatically" | PROJECT.md puts live trade-advice / regime scoring OUT OF SCOPE (the `trade-advisor` plugin owns it). Crisis gates are 2 thresholds, not a model | Two hard VIX gates as documented discipline rails. Respect the boundary |
| Porting the entire trade-advisor plugin | "Inherit the whole playbook" | Only the rules that map to the typed gate/score/universe structure belong in Morai; live discretionary analysis does not (out of scope) | Port crisis gates + sizing + anti-criteria + event bucket; leave live advice in the plugin |
| Kelly / optimal-f position sizing | "Size it optimally" | Kelly needs a reliable edge estimate — which the 13-trade sample cannot provide (same honesty wall as Feature 2) | Simple discrete VIX-regime tiers, user-set, not derived |
| Resurrecting per-pair crisis logic (term inversion) under a new name | "Protect against backwardation" | The per-pair `term-inversion` gate was already RETIRED — it deleted exactly the trades with edge. Registry test asserts it can't reappear | Crisis lives at MARKET level (VIX gates), never per-structure |

## Feature Dependencies

```
[VIX3M FRED series]
    └──enables──> [Crisis gates (VIX / VIX3M)]  ──part-of──> [Playbook Port]

[Journal P&L fill-ledger] (exists)
[Live greeks / front DTE / spot·strike] (exists)
[Term structure + forward vol] (exists)
[economic_events + exitPlan stamp] (exists)
[GEX walls] (exists)
    └──all feed──> [Exit Advisor]  ──MUST SHIP FIRST──

[Exit Advisor]  (provides the exit rules)
    └──required-by──> [PICK-04 Backtest]  (can't replay exits without exit rules)

[Entry engine: scoreCalendarCandidates] (exists)
[leg_observations chains] (exists)
[13 validated closed calendars = the oracle] (exists)
    └──all feed──> [PICK-04 Backtest]

[Open-position count + realized P&L] (established by Exit Advisor)
    └──shared-by──> [Anti-criteria gates in Playbook Port]

[Exit Advisor] ──enhances──> [Entry Picker] (reads the exitPlan the entry stamped)
[Playbook Port] ──must-not-resurrect──> [retired term-inversion gate]
```

### Dependency Notes

- **PICK-04 requires the Exit Advisor:** the backtest replays entry AND exit rules. You cannot
  simulate an exit without an exit-rule registry to run. This fixes the build order:
  **Exit Advisor → Backtest → Playbook Port**, exactly as PROJECT.md sequences it — confirmed.
- **Exit Advisor's data is ~90% flowing already:** P&L ledger, greeks, term structure, events,
  GEX all exist. That makes it the fastest to ship AND the highest core value (it closes the
  trade loop the user watches daily). Correct as feature #1.
- **Exit Advisor enhances the Entry Picker via the exitPlan stamp:** entry stamps
  `exitPlan.closeByExpiry` + `thetaCapturePct`; the exit advisor reads and evaluates against it.
  The stamp is the contract between the two engines — no new coupling.
- **Playbook Port is largely independent of the Backtest** but its anti-criteria (max open,
  loss cooldown) reuse the open-position + realized-P&L state the Exit Advisor establishes —
  a reason not to build the anti-criteria before Feature 1.
- **Crisis gates block on VIX3M ingestion** — a small, isolated prerequisite; land it first
  inside the Playbook Port phase.
- **Event-calendar bucket extends `candidate-selection.ts`** additively, alongside the band-scan;
  it does not modify the existing universe.

## MVP Definition

### Launch With (v1.3 core)

- [ ] **Exit Advisor — the 5 verdicts from the playbook ladder**, in an Analyzer held-positions
      panel + MCP tool. HOLD/TAKE/STOP/EXIT-pre-event as the spine (data all exists); each verdict
      carries the rule that fired + its raw metric. — *closes the trade loop, the milestone's
      headline value*
- [ ] **Exit `ruleSet` rendered from the engine** (like the entry methodology panel) — *symmetry
      the user expects; near-free reuse*

### Add After Validation (v1.x within the milestone)

- [ ] **ROLL verdict + roll-candidate suggestion** — *roll needs the fill-haircut model applied to
      the candidate front; more work than the other four verdicts, so it follows*
- [ ] **PICK-04 as MECHANICS VALIDATION** — deterministic no-lookahead replay that reproduces the
      13 oracle outcomes, plus directional per-rule attribution + leave-one-out ablation, every
      number stamped `n=13`. — *trigger: exit rules exist; explicitly NOT weight optimization*
- [ ] **Playbook Port core** — VIX3M ingestion → crisis gates (VIX/VIX3M) → anti-criteria
      (max open, loss cooldown). — *trigger: exit advisor established the open-position/P&L state*

### Future Consideration (defer)

- [ ] **Weight promotion/demotion from the backtest** — *defer until ≥30 real closed trades exist;
      the corpus cannot support it today*
- [ ] **Auto roll-order construction** — *boundary risk (order entry) + haircut modeling; advise
      only*
- [ ] **Sizing tiers + event-calendar bucket + autoTuneTargetDelta** — *the most-optional Playbook
      slice; time-box and drop first if the milestone runs long*

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Exit Advisor — HOLD/TAKE/STOP/EXIT verdicts + panel + MCP | HIGH | MEDIUM | P1 |
| Exit ruleSet rendered from engine | MEDIUM | LOW | P1 |
| PICK-04 replay + mechanics validation vs oracle | HIGH | MEDIUM-HIGH | P1 |
| PICK-04 directional attribution + ablation | MEDIUM | LOW-MEDIUM | P2 |
| ROLL verdict + roll-candidate suggestion | MEDIUM | MEDIUM-HIGH | P2 |
| VIX3M ingestion + crisis gates | MEDIUM | LOW | P2 |
| Anti-criteria gates (max open, cooldown) | HIGH | MEDIUM | P2 |
| Sizing tiers by regime | MEDIUM | MEDIUM | P3 |
| Event-calendar bucket | MEDIUM | MEDIUM | P3 |
| autoTuneTargetDelta | LOW | LOW-MEDIUM | P3 |
| Weight promotion from backtest | (negative until n≥30) | — | DEFER |

**Priority key:** P1 = must have for the milestone · P2 = should have, add when possible ·
P3 = nice to have · DEFER = blocked on more data.

## Competitor Feature Analysis

| Feature | tastytrade / tos | OptionStrat | Our Approach |
|---------|------------------|-------------|--------------|
| Exit presentation | Right-click position → close/roll/analyze by leg or spread; strategy studies label actions LX/SX | Color-coded P&L-over-time/IV payoff + probability (PoP, prob-touch) to plan exit timing | A single verdict per open calendar from the user's playbook ladder, with the firing rule + raw metric shown — precomputed every cycle |
| Exit rule basis | Generic canon: 50% profit OR 21 DTE | Manual read of payoff/greeks; no verdict | The trader's OWN ladder (+5/+10/+15, −25/−50, EVT/TERM/GAMMA, roll), auto-evaluated |
| Roll | Inline adjustment on the position (build the order) | Rebuild strategy manually | ROLL verdict names a candidate front as a suggestion; user executes (no auto-order) |
| Backtest | tastytrade research = large-n published studies (200k+ trades); no personal backtest | Third-party historical replay tools | Replay MY engine over MY chains; honest at n=13 = mechanics validation + directional attribution, NOT weight optimization |
| Crisis / regime | Discretionary; VIX awareness manual | None | Two hard VIX gates (VIX<25, VIX/VIX3M<0.95) as discipline rails at market level |

## Sources

- Exit-management norms (50% profit / 21-DTE dual rule, defined-risk 25–50% targets,
  P&L-per-day-in-trade metric): daystoexpiry.com, traderc.com, tastytrade support (Calendar
  Spreads / Spreads at Expiration) — MEDIUM (community/vendor canon, cross-checked).
- Backtest overfitting & minimum sample (30/100/200–500 floors, Deflated Sharpe Ratio, PBO,
  walk-forward vs random CV, purged K-fold): Bailey, Borwein, López de Prado & Zhu — *The
  Probability of Backtest Overfitting* (SSRN 2326253); backtestbase.com sample-size calculator —
  MEDIUM-HIGH (peer-reviewed statistical consensus).
- Rolling calendar spreads (front <7 DTE, drift-to-strike, IV-context roll triggers; roll
  mechanics): optionalpha.com, tradingblock.com, fastercapital.com — MEDIUM (community consensus).
- Per-rule attribution / signal quality (predictive-power necessary + PnL-contribution
  sufficient; ablation; return-source decomposition; interpretation-stability for concept drift):
  macrosynergy.com + ML-backtest literature — LOW (directional guidance, not tiny-sample-specific).
- Exit/position-management UX (OptionStrat payoff+probability; tos Position Statement
  right-click close/roll; LX/SX/LE/SE study labels): OptionStrat, thinkorswim learning center,
  options-america.com — MEDIUM (documented tool behavior).
- Project context: `.planning/PROJECT.md`, `docs/architecture/picker-rules.md`, and the user's
  `trade-advisor` playbook (reference spec, per PROJECT.md) — HIGH (canonical project sources).

---
*Feature research for: v1.3 Picker Intelligence — held-position exit advisor, options backtest
harness, personal-playbook port*
*Researched: 2026-07-08*
