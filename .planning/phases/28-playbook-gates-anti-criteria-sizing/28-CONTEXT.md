# Phase 28: Playbook Gates, Anti-Criteria & Sizing - Context

**Gathered:** 2026-07-09 (draft — TWO OPEN USER DECISIONS below block planning)
**Status:** AWAITING USER at discuss-gate (per milestone kickoff: "Phase 28: crisis gates banded... fail-closed vs fail-open on missing VIX3M → ASK ME at that phase's discuss; anti-criteria thresholds → ASK ME")
**Source:** User-locked milestone kickoff + REQUIREMENTS PLAY-01..05 + research SUMMARY/PITFALLS

<domain>
## Phase Boundary

The picker inherits the rest of the playbook: market-level crisis gates (VIX ≥ 25, VIX/VIX3M ≥
0.95 — banded penalty-over-cliff, hysteresis), anti-criteria brakes (max open, loss cooldown,
sustained trend), VIX-tiered discrete sizing, event-calendar bucket (3-10d gap second universe),
autoTuneTargetDelta. Requirements PLAY-01..05.

</domain>

<decisions>
## Implementation Decisions

### Locked (from kickoff + requirements + research)
- Crisis gates BANDED with hysteresis, penalty-over-cliff (retired-gate scar: hard cliffs
  deleted trades with edge). Board (Phase 24) shows gate state.
- VIX/VIX3M ratio for the gate: BOTH legs must be same-epoch — Phase 24's regime-board
  Known-limitations note REQUIRES the gate not consume the mixed-epoch VIX9D-style ratio;
  VIX (VIXCLS) + VIX3M (VXVCLS) are both FRED EOD — aligned. Gate reads FRED pair. (VIX ≥ 25
  leg: VIXCLS EOD — accept T-1 lag as the daily regime filter, stamp as-of, per PITFALLS 10.)
- Sizing tiers: discrete user-set contract counts per VIX regime tier — NEVER derived optimum.
- Event-calendar bucket (PLAY-04): second universe path for short-gap (3-10d) calendars
  intentionally owning an event, event-appropriate rules — separate ruleSet rows, backEventBonus
  precursor exists as experimental.
- autoTuneTargetDelta (PLAY-05): additive, only after crisis-gate infra live. Most-optional —
  time-box and drop first if phase runs long (research flag).
- New macro→picker read port (VIX/VIX3M current values into picker context).
- Weight discipline: gates are GATES (universe filters/penalties), not score weights — active
  score weights stay sum-100 untouched.

### ⛔ OPEN — USER DECISION 1: fail-closed vs fail-open on missing VIX3M
Crisis gate behavior when VXVCLS (or VIXCLS) has no fresh row (FRED outage/holiday gap):
- fail-closed = block all new entries on missing data (safe, but a FRED hiccup silences the
  picker; VXVCLS history only accretes since 2026-07-09 — thin early history)
- fail-open = compute without the gate + loud "gate blind" flag on the board/snapshot
  (keeps picker alive, risks trading blind into a spike)
- middle option: fail-open with age tolerance (gate uses last value ≤ N business days old,
  N=2-3; older → fail-closed/open per choice)
RESEARCH leans: explicit decision required, document either way (PITFALLS 10).

### ⛔ OPEN — USER DECISION 2: anti-criteria thresholds (PLAY-02)
From the trade-advisor playbook, need user-confirmed values:
- Max open calendars: N = ? (candidate: 5? user has run 5 open concurrently)
- Loss cooldown: pause new entries for D days after a realized loss ≥ X% (candidates: D=2-3
  business days, X = any realized STOP-level loss ≥25%?)
- Sustained-trend filter: definition + threshold (candidate: |20d SPX return| or close<20d-avg
  streak ≥ K days — user's TOS fragility leg used close < 20d avg)

### Claude's Discretion (after the two decisions)
- Hysteresis band widths for the crisis gates (e.g. block ≥25 / re-open <24; block ≥0.95 /
  re-open <0.93) — mirror exit-advisor hysteresis conventions, document + test.
- Penalty shape between calm and crisis (linear score penalty band vs single penalty step).
- VIX tier boundaries for sizing (e.g. <15 / 15-20 / 20-25 / ≥25) — user sets the CONTRACT
  COUNTS per tier; tier edges Claude proposes, user confirms at UAT.

</decisions>

<canonical_refs>
## Canonical References

- `docs/architecture/picker-rules.md` — "Deferred to the playbook-port phase" section (the
  contract this phase fulfills) + gate discipline
- `docs/architecture/regime-board.md` — Known limitations (epoch-alignment requirement for gates)
- `docs/architecture/exit-rules.md` — hysteresis conventions to mirror
- `packages/core/src/picker/domain/rules.ts` + candidate-selection.ts — gate registry + universe
- `packages/core/src/exits/` — Phase 26 patterns (read ports, hysteresis)
- `.planning/phases/27-pick-04-backtest-harness/` — backtest evidence informs gate/sizing tiers
- `.planning/REQUIREMENTS.md` PLAY-01..05

</canonical_refs>

<specifics>
## Specific Ideas

- Gate state payload on picker_snapshot (gate: {vix, vix3m, ratio, state: open|penalty|blocked,
  asOf}) so Analyzer + regime board render it (PLAY-01 "board shows the gate state").
- PLAY-04 bucket: universe fork keyed on gap-days ∈ [3,10] + owned tier-1 event ∈ (front, back].

</specifics>

<deferred>
## Deferred Ideas

- Weight promotion from backtest — n≥30 gate.
- ML regime classification — out of scope table.

</deferred>

---

*Phase: 28-playbook-gates-anti-criteria-sizing*
*Context drafted 2026-07-09 — blocked on 2 user decisions*
