# Phase 28: Playbook Gates, Anti-Criteria & Sizing - Context

**Gathered:** 2026-07-09 (user answered both gate questions in-session — decisions final below)
**Status:** Ready for planning
**Source:** User-locked milestone kickoff + REQUIREMENTS PLAY-01..05 + research SUMMARY/PITFALLS + user answers 2026-07-09

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

### ✅ USER DECISION 1 (2026-07-09): missing-data gate = AGE-TOLERANCE
- Gate uses the last FRED value up to **3 business days old** (T-1 lag is normal FRED
  behavior). Older than 3 business days → data treated as MISSING → gate **fails CLOSED**
  (blocks new entries) with a loud "GATE BLIND" flag on the regime board and picker snapshot.
- Never silent: the blind state is always visible where the gate state renders.

### ✅ USER DECISION 2 (2026-07-09): anti-criteria thresholds
- **Max open calendars: 6** — new entries pause when open count ≥ 6.
- **Loss cooldown: realized loss ≥ 25% → 2 business days** — any calendar closed at or
  beyond the −25% STOP rung pauses new entries for 2 business days.
- **Sustained-trend filter: DROPPED (user challenged necessity; orchestrator concurred).**
  Rationale recorded: crisis gates cover vol-regime danger; deltaNeutral scoring + GAMMA/
  STOP exits cover directional blowthrough; n=13 gives no honest calibration basis for a
  price-trend brake. Deferred — revivable when backtest directional-attribution at larger n
  supplies evidence. Document in the playbook-gates doc as a deferred row with this
  rationale (PLAY-02 delivered as two brakes, third consciously deferred — NOT silently
  dropped).

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
