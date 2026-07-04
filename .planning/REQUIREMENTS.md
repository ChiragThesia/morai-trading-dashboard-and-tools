# Requirements: Morai — v1.2 Trade Picker & Dashboard Redesign

**Defined:** 2026-07-03
**Core Value:** For any calendar, answer "how did price and greeks move over the life of this
trade?" — collected automatically, queryable by API and Claude Code. v1.2 adds the forward
half: help pick the next calendar, and make the dashboard show the book payoff-first.

## v1.2 Requirements

Requirements for this milestone. Each maps to roadmap phases. Build order is user-decided:
deploy → Overview+IV fix live on prod → Analyzer redesign (fixtures-first) → picker engine →
tail.

### Deploy

- [x] **DEPLOY-04**: Prod runs the phase-15 image on server, worker, and web; the T-24h
  re-auth alert surface (amber banner, warn log, `refreshExpiresIn` on both status surfaces)
  is verifiably live before the ~2026-07-09 re-auth window

### Overview Redesign

- [x] **OVW-01**: User sees a payoff-centered Overview (variant B "TOS dock"): full-width
  payoff hero with breakevens + T+0/@exp scenario strip at key levels (put wall / flip /
  spot / call wall / strikes), positions table docked below the graph, GEX rail right
  (gamma profile, GEX bars, level bar, net book greeks), pill header (SPX · netγ+regime ·
  flip · VIX · VVIX · DFF · 10y2y · COT · book P&L)

- [x] **OVW-02**: Payoff T+0 curve uses per-position IV calibrated to the live mark
  (bisection via the core IV-inversion module, tagged non-convergence result — never a flat
  DEFAULT_IV guess); stale GEX displays its snapshot timestamp

- [x] **OVW-03**: Each positions-box row shows both leg expiration dates + both DTEs + the
  days between the two expiries (the calendar width), not just today's `Nd → Nd`

- [x] **OVW-04**: The Overview payoff graph visually emulates the TOS Analyze → Risk Profile
  combined chart (magenta today/date curve + cyan @exp, TOS axis ticks + auto-scaling); the
  prior wonky rendering (mixed round/key-level x-ticks, @exp dwarfing a near-flat T+0) is resolved

- [x] **OVW-05**: A TOS-style date picker (calendar + day-step arrows) projects the payoff curve
  to a chosen future date via the scenario-engine `daysForward` path; the @exp curve stays fixed

- [x] **OVW-06**: The user can pick/choose which real-book calendars are drawn on the graph
  (per-calendar selection following TOS's Risk Profile include behavior); no simulated/example
  calendars are ever added on the Overview (view-only)

### Analyzer → Picker Redesign

- [x] **ANLZ-01**: User sees a ranked candidate-cards rail with per-criterion score-breakdown
  bars, rendered from contract-typed fixtures until the engine lands (contract-first:
  `packages/contracts` picker schema defined in this phase)

- [x] **ANLZ-02**: User can overlay a candidate on the payoff center (⊕ compare) with
  expected-move band and scenario strip

- [x] **ANLZ-03**: User sees a why-panel per candidate: term structure with leg dots +
  forward-vol bracket + event markers, and an entry/exit plan card (+25% / −17.5% defaults)

### Picker Engine

- [x] **PICK-01**: `scoreCalendarCandidates` (core domain) scores put-calendar candidates over
  the latest chain snapshot using the 8 verified criteria from
  `.planning/research/calendar-selection-criteria.md` (FwdIV forward-variance edge, term-slope,
  per-leg event flags with front-event penalty, net θ>0, GEX fit, debit=max-loss,
  close-by-front-expiry, exit defaults); REFUTED criteria (IV-rank gates, −1..−3% IV-diff band,
  debit-%-of-back band) are absent; FwdIV radicand<0 returns a tagged guard result; the scoring
  contract carries `observedAt`/`source` staleness fields

- [x] **PICK-02**: User can query scored candidates via HTTP route + MCP tool; the Analyzer UI
  swaps fixtures for real data; chain-snapshot staleness ("as of") is visible on every surface

- [ ] **PICK-03**: Economic-events context provides FOMC/CPI/NFP dates (FRED `releases/dates`
  for CPI/NFP + static hand-refreshed FOMC seed), stored with IANA timezone, refreshed by cron;
  per-leg event-window flags feed scoring and ride in the candidates payload (internal-only —
  no separate events API surface in v1.2)

### Stream Health

- [ ] **WATCH-01**: Live-stream badge is a three-state, RTH-aware indicator (LIVE / QUIET /
  STALLED) driven by a transport-level heartbeat — the badge can no longer show LIVE while
  ticks are stalled

### Journal

- [ ] **SNAP-01**: A large SPX move detected on the live stream triggers a supplemental
  out-of-cycle journal snapshot (existing snapshot job, ad-hoc enqueue)

### Strategy Rules

- [ ] **RULE-01**: User can record enter/exit/roll rules per trade and which rule fired
  (closed enum + structured tag on the existing `entry_thesis` attach point, D-07);
  explicitly a thin recording layer, NOT a rules-evaluation DSL

## Future Requirements

Deferred to a later milestone. Tracked but not in the current roadmap.

### Picker

- **PICK-04**: Term-slope signal backtest over `leg_observations` (validate Vasquez
  cross-sectional finding on SPX time-series)

- **PICK-05**: Event-premium weighting by surprise magnitude (open question in research)

### Strategy Rules

- **RULE-02**: Rule-fired → outcome correlation report (needs RULE-01 data accumulated)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Full multi-country economic calendar | Single-symbol (SPX) tool needs only FOMC/CPI/NFP window flags — anti-feature per research |
| Separate events HTTP/MCP surface | Internal-only; event flags ride in candidates payload. Add later if a raw-events UI need emerges |
| Rules-evaluation DSL / config engine | Single user; L4 is a recording layer. DSL is the highest over-engineering risk flagged in research |
| Live trade advice / regime timing | `trade-advisor` plugin boundary holds — picker scores *structures*, not timing |
| Backtesting engine | PICK-04 is a one-off analysis, not an engine; defer |
| Full-chain streaming for the picker | 500-symbol cap (D17); picker scores the 30-min snapshot with honest staleness display |
| IV-rank gates, IV-diff bands, debit-%-of-back bands | Adversarially REFUTED in calendar-selection-criteria.md — must never be encoded |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEPLOY-04 | Phase 16 | Complete |
| OVW-01 | Phase 17 | Complete |
| OVW-02 | Phase 17 | Complete |
| OVW-03 | Phase 17.1 | Complete |
| OVW-04 | Phase 17.1 | Complete |
| OVW-05 | Phase 17.1 | Complete |
| OVW-06 | Phase 17.1 | Complete |
| ANLZ-01 | Phase 18 | Complete |
| ANLZ-02 | Phase 18 | Complete |
| ANLZ-03 | Phase 18 | Complete |
| PICK-01 | Phase 19 | Complete |
| PICK-02 | Phase 19 | Complete |
| PICK-03 | Phase 19 | Pending |
| WATCH-01 | Phase 20 | Pending |
| SNAP-01 | Phase 20 | Pending |
| RULE-01 | Phase 20 | Pending |

**Coverage:**

- v1.2 requirements: 12 total
- Mapped to phases: 12/12 ✓
- Unmapped: 0

---
*Requirements defined: 2026-07-03*
*Last updated: 2026-07-03 — roadmap created, Phases 16-20 (v1.2)*
