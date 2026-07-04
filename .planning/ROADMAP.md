# Roadmap: Morai — Trading Dashboard & Tools

## Milestones

- ✅ **v1.0 Backend + Data Layer** — Phases 1-9 (shipped 2026-06-25)
- ✅ **v1.1 Real-Time Schwab Streaming** — Phases 10-15 (shipped 2026-07-02) — [archive](milestones/v1.1-ROADMAP.md)
- 🚧 **v1.2 Trade Picker & Dashboard Redesign** — Phases 16-20 (in progress)

Full phase details for both shipped milestones: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
(complete pre-archive snapshot). Milestone summaries: [MILESTONES.md](MILESTONES.md).

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

### 🚧 v1.2 Trade Picker & Dashboard Redesign (In Progress)

**Milestone Goal:** Ship the redesigned dashboard (Overview + Analyzer) to prod first, then power
the picker with the real scoring engine, while clearing v1.1 operational debt.

- [x] **Phase 16: Deploy Phase-15 Image** - Prod runs server+worker+web on the already-merged (completed 2026-07-03)
  phase-15 code before the ~2026-07-09 re-auth window

- [x] **Phase 17: Overview v2 Redesign + IV Calibration Fix** - Payoff-centered "TOS dock" (completed 2026-07-03)
  Overview live on prod, with per-position IV-calibrated T+0 scenario curves

- [x] **Phase 18: Analyzer → Picker UI Redesign** - Ranked-cards picker UI built contract-first (completed 2026-07-04)
  against typed fixtures, matching the approved mockup

- [ ] **Phase 19: Picker Engine + Economic Events** - Real `scoreCalendarCandidates` scoring wired
  into the picker UI, backed by a new FOMC/CPI/NFP economic-events context

- [ ] **Phase 20: Stream Watchdog, Event Snapshot & Strategy Rules** - Three independent tail
  items: honest stream-health badge, event-triggered journal snapshot, rule-firing recording

## Phase Details

### Phase 16: Deploy Phase-15 Image

**Goal**: Prod runs the phase-15 image on server, worker, and web so the T-24h re-auth alert
surface is verifiably live before the ~2026-07-09 re-auth window, giving every later v1.2 phase a
current (not stale) prod baseline to build on.
**Depends on**: Phase 15 (already-merged code; this phase is the deploy step)
**Requirements**: DEPLOY-04
**Success Criteria** (what must be TRUE):

  1. Server, worker, and web in prod are running the phase-15 build (verifiable via deployed
     version/status, not just a merged commit).

  2. The T-24h re-auth alert surface — amber banner, warn log, `refreshExpiresIn` — is visible on
     both status surfaces (HTTP `/api/status` and web) in prod.

  3. Existing live-stream, journal, COT, and FRED functionality shows no regression post-deploy.

**Plans**: 3/3 plans complete
**Wave 1**

- [x] 16-01-PLAN.md — Security remediation (remove accidental sidecar public domain, GW-05) + pre-deploy ground truth (baseline, migration parity, tree/test sanity)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 16-02-PLAN.md — Force-deploy stale server + worker, verify web current; build-proof via key-presence + deploy-timestamp correlation (D-01)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 16-03-PLAN.md — Regression smoke checklist (D-04) + T-24h alert-surface checkpoint 1 (D-02); records deferred ~07-08 + RTH follow-ups

### Phase 17: Overview v2 Redesign + IV Calibration Fix

**Goal**: Users see a payoff-centered Overview (variant B "TOS dock") whose T+0 scenario curve is
calibrated to each position's live-mark IV instead of a flat default guess.
**Depends on**: Phase 16
**Requirements**: OVW-01, OVW-02
**Success Criteria** (what must be TRUE):

  1. User sees the TOS-dock Overview layout in prod: full-width payoff hero with breakevens +
     T+0/@exp scenario strip at key levels (put wall / flip / spot / call wall / strikes),
     positions table docked below the graph, GEX rail right (gamma profile, GEX bars, level bar,
     net book greeks), pill header (SPX · netγ+regime · flip · VIX · VVIX · DFF · 10y2y · COT ·
     book P&L).

  2. The payoff T+0 curve uses per-position IV calibrated to the live mark via bisection (the
     core IV-inversion module), and never falls back to a flat `DEFAULT_IV` guess.

  3. A non-convergent calibration (deep-ITM/illiquid leg) shows a tagged result on screen instead
     of a silently wrong curve.

  4. Stale GEX data displays its snapshot timestamp so the user can tell it apart from live data.

**Plans**: 4/4 plans complete
**UI hint**: yes

**Wave 1** *(parallel — no file overlap)*

- [x] 17-01-PLAN.md — IV calibration module: `resolveLegIv` thin caller over the frozen `invertIv`
  (tagged non-convergence, REST-fallback price guard, cold-start ≠ non-conv) + BSM parity smoke test (OVW-02)

- [x] 17-02-PLAN.md — Scenario-engine: leg-level (front vs back) non-convergence exclusion +
  bounded scenario-strip key-level set with front-expiry header (OVW-01, OVW-02)

- [x] 17-03-PLAN.md — PayoffChart dual-curve highlight mode (dim net-book to 0.3, emphasize one
  position) + net-book "T+0 excludes N: IV n/a" note (OVW-01, OVW-02)

**Wave 2** *(blocked on Wave 1)*

- [x] 17-04-PLAN.md — Overview TOS-dock rewrite + wire calibrated IV, two-channel staleness badges,
  row-highlight; records the BookSummary DEFAULT_IV deferral (OVW-01, OVW-02)

### Phase 17.1: Overview Payoff — TOS-Fidelity Graph + Interactivity

**Goal**: Users get a Thinkorswim-grade payoff experience on the Overview: the combined risk-profile
graph visually matches TOS's Analyze → Risk Profile chart, a date picker projects the curve to a
chosen future date, individual real-book calendars can be toggled on/off in the graph, and the
positions box shows each calendar's leg expiration dates + DTEs + days-between. View-only — NO
simulated/example trades (that stays in the Analyzer).
**Depends on**: Phase 17 (extends the shipped Overview payoff hero + `repriceScenario` engine; the
Analyzer already implements date-forward projection + per-position include toggles over the SAME
engine — this ports a trimmed, view-only version onto the Overview).
**Requirements**: OVW-03, OVW-04, OVW-05, OVW-06
**Success Criteria** (what must be TRUE):

  1. (OVW-03) Each positions-box row shows both leg **expiration dates**, both **DTEs**, and the
     **days between** the two expiries (the calendar width) — not just today's `Nd → Nd`.

  2. (OVW-04) The Overview combined payoff graph **visually emulates the TOS Risk Profile combined
     chart** (ref: user TOS screenshots — smooth today/date curve + @exp curve, TOS-style axis ticks
     and scaling); the current wonky rendering (mixed round/key-level x-ticks, @exp dwarfing a
     near-flat T+0) is resolved.

  3. (OVW-05) A **date picker** (TOS "Date:" style) lets the user project the payoff curve to a
     chosen future date; the projection feeds the existing `daysForward` path of `repriceScenario`.

  4. (OVW-06) The user can **pick/choose which real-book calendars** are drawn on the graph
     (per-calendar series toggle, wired from the positions rows). No simulated/example calendars are
     ever added on the Overview (view-only).

**Design references**: user-provided TOS Analyze → Risk Profile screenshots (combined-graph shape +
date-picker widget) — save into `mockups/` during discuss-phase. `apps/web/src/screens/Analyzer.tsx`
is the working in-repo analog (days-forward slider + include checkboxes over the same engine).
**Plans**: 5/5 plans complete
**UI hint**: yes

**Wave 1** *(parallel — no file overlap)*

- [x] 17.1-01-PLAN.md — Timezone-safe date-projection lib (parse/day-math/clamp, NaN guard) (OVW-05)
- [x] 17.1-02-PLAN.md — PayoffChart TOS restyle: two-curve y-domain, derived x-ticks, prop-scoped curve colors + magenta token, WR-03 fix (OVW-04)
- [x] 17.1-03-PLAN.md — OVW-06 per-calendar chart wiring: lift `excluded` to single source, thread `included`, extend signature, CR-01 guard (OVW-06)

**Wave 2** *(blocked on Wave 1)*

- [x] 17.1-04-PLAN.md — OVW-05 date picker (native input + ‹›/Today) + `daysForward` wiring + TOS color application on the hero (OVW-05, OVW-04)

**Wave 3** *(blocked on Wave 2)*

- [x] 17.1-05-PLAN.md — OVW-03 positions-box expiry/DTE/width reformat (`Aug 8 → Sep 5` / `32d/59d · 27d wide`) (OVW-03)

### Phase 18: Analyzer → Picker UI Redesign

**Goal**: Users see the ranked-cards picker experience end-to-end against typed fixtures, with the
`packages/contracts` picker schema locked before the real engine lands, decoupling UX risk from
scoring-correctness risk.
**Depends on**: Phase 17 (decided build order — Overview ships to prod before Analyzer redesign
starts)
**Requirements**: ANLZ-01, ANLZ-02, ANLZ-03
**Success Criteria** (what must be TRUE):

  1. User sees a ranked candidate-cards rail with per-criterion score-breakdown bars, matching
     `mockups/playground-v4.html`, rendered from a contract-typed fixture set (`packages/contracts`
     picker schema authored in this phase).

  2. User can overlay a candidate on the payoff center (⊕ compare) and see its expected-move band
     and scenario strip.

  3. User sees a why-panel per candidate: term structure with leg dots + forward-vol bracket +
     event markers, plus an entry/exit plan card with +25% / −17.5% defaults.
**Plans**: 5/5 plans complete

Plans:
**Wave 1**

- [x] 18-01-PLAN.md — Picker Zod contract (pickerCandidate/pickerSnapshotResponse) + frozen playground-v4 fixture + guard case (ANLZ-01)
- [x] 18-02-PLAN.md — PayoffChart additive props: compareCurve + expectedMoveBand (ANLZ-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 18-03-PLAN.md — candidateToAnalyzerPosition adapter + debit=max-loss invariant (ANLZ-02)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 18-04-PLAN.md — Picker screen: ranked cards rail + payoff center (compare/EM band/scenario strip) (ANLZ-01/02)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 18-05-PLAN.md — Why-panel + term-structure + entry/exit plan + old-Analyzer retirement (ANLZ-03)

**UI hint**: yes

### Phase 19: Picker Engine + Economic Events

**Goal**: Real chain data and a new economic-events context feed the picker UI, replacing fixtures
with a live, honestly-staleness-labeled scoring engine.
**Depends on**: Phase 18 (contract must exist before the engine implements it; UI ships first per
decided build order)
**Requirements**: PICK-01, PICK-02, PICK-03
**Success Criteria** (what must be TRUE):

  1. `scoreCalendarCandidates` (core domain) scores put-calendar candidates over the latest chain
     snapshot using the 8 verified criteria from `calendar-selection-criteria.md` (FwdIV
     forward-variance edge, term-slope, per-leg event flags with front-event penalty, net θ>0,
     GEX fit, debit=max-loss, close-by-front-expiry, exit defaults); REFUTED criteria (IV-rank
     gates, −1..−3% IV-diff band, debit-%-of-back band) are absent; a negative FwdIV radicand
     returns a tagged guard result, never `NaN`.

  2. User can query scored candidates via `GET /api/picker/candidates` and the `get_picker_candidates`
     MCP tool; the Analyzer UI swaps its fixture import for this live data with no layout change.

  3. Chain-snapshot staleness ("as of" + source) is visible on every surface that shows candidate
     scores.

  4. Economic-events context (FOMC/CPI/NFP dates, stored with IANA timezone, refreshed by cron)
     feeds per-leg event-window flags into scoring; no separate events HTTP/MCP surface exists —
     flags ride inside the candidates payload only.
**Plans**: 7/9 plans executed

Plans:
**Wave 1**

- [x] 19-01-PLAN.md — Additive contract fields (source/context-status) + core picker port/type foundation
- [x] 19-02-PLAN.md — FwdIV guard + calendar-breakevens numeric primitives (fast-check)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 19-03-PLAN.md — Scoring + candidate-selection domain (port buildCandidates, real beVsEm)
- [x] 19-04-PLAN.md — Economic-events data path (FRED release/dates CPI/NFP + FOMC seed, memory+Postgres)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 19-05-PLAN.md — picker_snapshot append-history + chain read + [BLOCKING] migrate apply

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 19-06-PLAN.md — computePickerSnapshot + getPicker use-cases (D-17 degraded-context tagging)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 19-07-PLAN.md — Server: GET /api/picker/candidates route + get_picker_candidates MCP tool
- [ ] 19-08-PLAN.md — Worker: compute-picker chain job + fetch-economic-events weekly cron

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 19-09-PLAN.md — Web: usePicker hook + Analyzer fixture→live swap + staleness/context tags

**UI hint**: yes

### Phase 20: Stream Watchdog, Event Snapshot & Strategy Rules

**Goal**: Three independently shippable reliability/journaling gaps close out v1.2 — ordered
cheapest/most-isolated first per research.
**Depends on**: Phase 19
**Requirements**: WATCH-01, SNAP-01, RULE-01
**Success Criteria** (what must be TRUE):

  1. The live-stream badge is a three-state, RTH-aware indicator (LIVE / QUIET / STALLED) driven
     by a transport-level heartbeat decoupled from data cadence — it can no longer show LIVE while
     ticks are stalled.

  2. A large SPX move detected on the live stream triggers a supplemental out-of-cycle journal
     snapshot via the existing snapshot job (ad-hoc enqueue), without duplicating the 30-minute
     cadence.

  3. User can record enter/exit/roll rules per trade and which rule fired, as a closed enum +
     structured tag on the existing `entry_thesis` attach point — explicitly a thin recording
     layer, not a rules-evaluation DSL.

**Note**: The RULE-01 sub-item is the most open-ended item in the milestone (rule taxonomy,
firing-vs-execution boundary, how `entry_thesis` gets populated). Per research, it should get its
own discuss-phase before planning, scoped explicitly to "recording layer, not a DSL."
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|-----------------|--------|-----------|
| 1. Walking Skeleton | v1.0 | 6/6 | Complete | 2026-06-11 |
| 2. Market Data & BSM Engine | v1.0 | 12/12 | Complete | 2026-06-12 |
| 3. Calendar Journal (MVP) | v1.0 | 7/7 | Complete | 2026-06-14 |
| 4. Schwab Auth & Brokerage | v1.0 | 6/6 | Complete | 2026-06-20 |
| 5. Jobs, Fill Rebuild & Integrity | v1.0 | 15/16 | Complete | 2026-06-22 |
| 6. Derived Analytics | v1.0 | 8/8 | Complete | 2026-06-22 |
| 7. Trade History | v1.0 | 2/2 | Complete | 2026-06-22 |
| 8. Web Dashboard Backend | v1.0 | 8/8 | Complete | 2026-06-24 |
| 9. Web Dashboard Frontend | v1.0 | 10/10 | Complete | 2026-06-25 |
| 10. Stack Decisions Doc Update | v1.1 | 1/1 | Complete | 2026-06-25 |
| 11. Sidecar Scaffold + Auth Migration | v1.1 | 7/7 | Complete | 2026-06-25 |
| 12. Streaming + TS Fan-Out | v1.1 | 7/7 | Complete | 2026-06-29 |
| 13. COT Adapter | v1.1 | 6/6 | Complete | 2026-06-29 |
| 14. FRED Expansion | v1.1 | 7/7 | Complete | 2026-07-02 |
| 15. Re-Auth Smoothing | v1.1 | 5/5 | Complete | 2026-07-02 |
| 16. Deploy Phase-15 Image | v1.2 | 3/3 | Complete    | 2026-07-03 |
| 17. Overview v2 Redesign + IV Calibration Fix | v1.2 | 4/4 | Complete   | 2026-07-03 |
| 17.1. Overview Payoff — TOS Graph + Interactivity | v1.2 | 5/5 | Complete    | 2026-07-04 |
| 18. Analyzer → Picker UI Redesign | v1.2 | 5/5 | Complete    | 2026-07-04 |
| 19. Picker Engine + Economic Events | v1.2 | 7/9 | In Progress|  |
| 20. Stream Watchdog, Event Snapshot & Strategy Rules | v1.2 | 0/TBD | Not started | - |

## Backlog / Future Enhancements

*Unscheduled — not yet assigned to a phase.*

### Schwab client library — revisit vendored TS vs @sudowealth/schwab-api

**Decided 2026-06-21** (full analysis: `.planning/notes/schwab-client-decision.md`). Phase 4
UAT found the vendored chain adapter 502s on the live `$SPX` chain (missing scoping params, not
a missing library). Decision: fix vendored TS now (add `strikeCount`/`fromDate`/`toDate`);
**reject** the Python `schwab-py` sidecar for the pure-TS hexagon (v1.0 decision, now superseded
by v1.1 arch for streaming ownership — the sidecar is the right answer for streaming but not
for the hexagon core). Revisit TS client adoption behind ports, version-pinned, human-verify gate.

**Note:** Strategy rules (L4) and event-triggered supplemental snapshot, previously tracked here,
are now scheduled in Phase 20 (RULE-01, SNAP-01) — see Phase Details above.
