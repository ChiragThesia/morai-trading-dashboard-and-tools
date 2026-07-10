---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Picker Intelligence
current_phase: 32
current_phase_name: Rule Settings modal v2 — explain what you touch
status: in-progress
stopped_at: Completed 32-01-PLAN.md
last_updated: "2026-07-10T19:17:00.909Z"
last_activity: 2026-07-10
last_activity_desc: Phase 32 Plan 01 complete
progress:
  total_phases: 10
  completed_phases: 9
  total_plans: 54
  completed_plans: 49
  percent: 91
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-03)

**Core value:** For any calendar, answer "how did price and greeks move over the life of this trade?" — collected automatically, queryable by API and Claude Code.
**Current focus:** Phase 31 — Risk Profile KISS redesign + macro gauges

## Current Position

Phase: 32 — Rule Settings modal v2 — explain-what-you-touch: per-knob help (what it gates/scores, unit, direction of effect), which engine output it changes, and a staged-change impact preview (dry-run scoring against latest snapshot showing candidate/gate deltas BEFORE save); current modal shows bare numbers with zero context (user feedback 2026-07-10)
Plan: 32-01 complete (of 6) — contract-package foundations: RULE_EXPLAINERS registry + preview request/response schema
Status: In progress — 32-02..32-06 remaining
Last activity: 2026-07-10 — Phase 32 Plan 01 complete

## Open follow-ups (not phase-22 blockers)

1. **Journal snapshot data ~74% gaps** — flagship open calendar (65aac62e) has 46 snapshots but only 12 non-gap (10 on Jul 01, 2 on Jul 03); Jun 23-26 all gap (spot=0/NaN), Jun 27-30 empty (worker-down window). The lifecycle feature works and renders honestly, but real-world richness is throttled by the `snapshot-calendars` job writing gap rows. Fix the snapshot pipeline so calendars accumulate clean non-gap series. **Now scheduled as Phase 25 (OPS-01).**
2. **`GET /api/journal//rules` → 401** — empty calendarId (Phase-20 `useRuleTags` missing the `enabled: !!calendarId` guard that `useLifecycle` got in 22-04). Fires once on Journal mount. Pre-existing, still open.

## Milestone v1.3 Summary

**6 phases, 28 requirements (OPS-01..02, MACRO-01..03, BOARD-01..03, EXIT-01..10, BT-01..05, PLAY-01..05)**

Research-validated build order (`.planning/research/SUMMARY.md`, confirmed dependency-correct
across all 4 research files):

- Phase 23 (MACRO-01) → Phase 24 (MACRO-02..03, BOARD-01..03) → Phase 25 (OPS-01..02) →
  Phase 26 (EXIT-01..10) → Phase 27 (BT-01..05) → Phase 28 (PLAY-01..05)

- VIX3M ingestion is first and alone — `macro_observations` has no backfill, so every day
  skipped before Phase 23 ships is permanently lost crisis-gate/backtest history.

- Ops rider (Phase 25) lands before the inference features it protects — both the exit advisor
  and the backtest inherit the pipeline's gap-row/BSM-timeout defects directly; a silent data bug
  becomes a confident wrong verdict once an advisor reads it.

- Exit Advisor (26) strictly precedes Backtest (27) — the backtest replays the exit-rule registry
  the advisor builds; it cannot validate rules that don't exist yet.

- Playbook gates (28) land last — they consume the VIX3M history accruing since Phase 23 and are
  informed by Phase 27's backtest evidence.

Key risks carried into planning:

1. **n=13 sample-size wall** (Phase 27) — 9 free weights fit to 13 correlated trades is
   overfitting formalized. The backtest is a refutation/mechanics-validation tool, never a
   weight-fitter; every number stamped `n=`; automated promotion blocked until n≥30.

2. **In-sample leakage / late-solved BSM** (Phase 27) — every distributional stat must be
   point-in-time; the free oracle is that replaying a historical cohort must reproduce its
   recorded live `picker_snapshot` score exactly.

3. **Exit-verdict / regime-gate flapping** (Phases 26, 28) — hysteresis/banding required; the
   codebase already retired per-pair hard gates for deleting trades with edge — penalty band over
   a cliff.

4. **Acting on stale/AH/gap marks** (Phase 26) — session- and gap-aware; verdicts on AH/gap
   cohorts are display-only, never actionable STOP/TAKE.

5. **Fail-open vs fail-closed on missing VIX3M** (Phase 28) — open decision, must be resolved and
   documented during that phase's planning.

6. **FRED series id is `VXVCLS`** (Phase 23) — live-verified 2026-07-09; `VIXCLS3M`/`VIX3MCLS`/
   `VXV` all 404. Some research docs still say `VIXCLS3M` — treat STACK.md's live verification as
   authoritative.

Regression gates (must survive every phase, carried from v1.0/v1.1/v1.2):

- SPX OI=0 / SPY proxy (~10.048×)
- CBOE timestamps are UTC (not ET)
- GEX put-sign (negative gamma for puts)
- 65,534-param insert limit (chunk at ≤2,000 rows)
- REFUTED picker criteria (IV-rank gates, −1..−3% IV-diff band, debit-%-of-back band,
  per-pair crisis gates) must never be re-encoded

- Advisor/backtest never execute — advise + alert only (STRM-04 read-only boundary)

## Milestone v1.2 Summary

**5 phases, 12 requirements (DEPLOY-04, OVW-01..02, ANLZ-01..03, PICK-01..03, WATCH-01, SNAP-01, RULE-01)**

User-decided build order (confirmed, research-validated as dependency-correct):

- Phase 16 (DEPLOY-04) → Phase 17 (OVW-01..02) → Phase 18 (ANLZ-01..03) → Phase 19 (PICK-01..03) → Phase 20 (WATCH-01, SNAP-01, RULE-01)
- Strictly sequential — each phase is a prerequisite prod baseline or contract for the next
  (deploy → dashboard live → UI contract-first → engine wires in real data → independent tail).

Key risks carried into planning:

1. Re-auth window ~2026-07-09 — Phase 16 must ship before then or the T-24h alert isn't live.
2. Stale/mis-sourced chain data silently feeding picker scores — `observedAt`/`source` required
   at the port signature (Phase 19), not caught later in QA.

3. FwdIV radicand goes negative under term-structure inversion — tagged `Result` variant required,
   never a silent `NaN` (Phase 19).

4. Economic-event dates stored as fixed UTC instead of America/New_York + IANA tz — same bug class
   as the CBOE-UTC lesson, inverted direction (Phase 19).

5. IV-calibration bisection hanging/garbage on deep-ITM/illiquid legs — tagged non-convergence
   result required (Phase 17).

6. Stream watchdog crying wolf on quiet markets or staying silent during a real stall — needs a
   three-state (LIVE/QUIET/STALLED) RTH-aware state machine (Phase 20).

7. Strategy-rules (RULE-01) scope creeping into a rules-evaluation DSL — explicitly a thin
   recording layer; needs its own discuss-phase before planning (Phase 20).

Regression gates (must survive every phase, carried from v1.0/v1.1):

- SPX OI=0 / SPY proxy (~10.048×)
- CBOE timestamps are UTC (not ET)
- GEX put-sign (negative gamma for puts)
- 65,534-param insert limit (chunk at ≤2,000 rows)
- REFUTED picker criteria (IV-rank gates, −1..−3% IV-diff band, debit-%-of-back band) must never
  be encoded — regression-assert their absence in Phase 19

## Performance Metrics

**Velocity:**

- Total plans completed (v1.0): 76
- Average duration: ~13 min
- Total execution time: ~40 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-walking-skeleton | P01+P02+P03 | ~40 min | ~13 min |
| 02 | 12 | - | - |
| 08 | 8 | - | - |
| 13 | 6 | - | - |
| 14 | 7 | - | - |
| 15 | 5 | - | - |
| 16 | 3 | - | - |
| 17.1 | 5 | - | - |
| 18 | 5 | - | - |
| 19 | 9 | - | - |
| 23 | 1 | - | - |
| 25 | 2 | - | - |
| 26 | 6 | - | - |
| 27 | 6 | - | - |
| 24 | 5 | - | - |
| 28 | 6 | - | - |
| 29 | 14 | - | - |
| 30 | 6 | - | - |
| 31 | 2 | - | - |

**Recent Trend:**

- Last 5 plans: 17-P04 (~40 min), 17.1-P01 (~12 min), 17.1-P02 (~9 min), 17.1-P03 (~3 min), 17.1-P04 (~8 min)
- Trend: Stable

*Updated after each plan completion*
| Phase 01-walking-skeleton P01 | 20 | 2 tasks | 15 files |
| Phase 01-walking-skeleton P02 | 8 | 2 tasks | 10 files |
| Phase 01-walking-skeleton P03 | 12 | 2 tasks | 15 files |
| Phase 01-walking-skeleton P04 | 8 | 2 tasks | 22 files |
| Phase 01-walking-skeleton P05 | 25 | 3 tasks | 21 files |
| Phase 03-calendar-journal-mvp P01 | 6 | 2 tasks | 7 files |
| Phase 03-calendar-journal-mvp P03 | 15 | 3 tasks | 18 files |
| Phase 03-calendar-journal-mvp P04 | 8 | 2 tasks | 6 files |
| Phase 03 P05 | 19 | 4 tasks | 17 files |
| Phase 03 P06 | 16 | 3 tasks | 20 files |
| Phase 04 P01 | 7 | 4 tasks (1 deferred) | 18 files |
| Phase 04 P02 | 20 | 4 tasks | 15 files |
| Phase 04 P04 | 13 | 5 tasks | 11 files |
| Phase 04-schwab-auth-brokerage P03 | 15 | - tasks | - files |
| Phase 04-schwab-auth-brokerage P05 | 70 | 11 tasks | 22 files |
| Phase 04-schwab-auth-brokerage P06 | 10 | 3 tasks | 4 files |
| Phase 05 P03 | 12 | 1 tasks | 2 files |
| Phase 05 P02 | 25 | - tasks | - files |
| Phase 05 P04 | 14 | 3 tasks | 14 files |
| Phase 05 P05 | 22 | 2 tasks | 19 files |
| Phase 05 P06 | 22 | 1 tasks | 2 files |
| Phase 05-jobs-fill-rebuild-integrity P07 | 11 | 3 tasks | 13 files |
| Phase 05-jobs-fill-rebuild-integrity P08 | 25 | 2 tasks | 12 files |
| Phase 05-jobs-fill-rebuild-integrity P10 | 10 | 2 tasks | 12 files |
| Phase 05-jobs-fill-rebuild-integrity P11 | 30 | 2 tasks | 5 files |
| Phase 05 P15 | 33min | 2 tasks | 16 files |
| Phase 06 P01 | 12 | 3 tasks | 15 files |
| Phase 06 P02 | 5min | 2 tasks | 5 files |
| Phase 06 P03 | 10min | 2 tasks | 8 files |
| Phase 06 P04 | 17min | 3 tasks | 30 files |
| Phase 06 P05 | 16min | 3 tasks | 33 files |
| Phase 06 P06 | 50m | 3 tasks | 10 files |
| Phase 06 P07 | 25m | 2 tasks | 3 files |
| Phase 06 P08 | 8min | 3 tasks | 12 files |
| Phase 07 P01 | 6min | 2 tasks | 2 files |
| Phase 07 P02 | 7min | 3 tasks | 9 files |
| Phase 08 P01 | 3 | 1 tasks | 1 files |
| Phase 08 P02 | 5 | 3 tasks | 8 files |
| Phase 08-web-dashboard-backend-gex-auth-rpc P04 | 2 | - tasks | - files |
| Phase 08 P05 | 11 | 2 tasks | 10 files |
| Phase 08 P06 | 7 | 2 tasks | 7 files |
| Phase 08 P07 | 9 | 3 tasks | 11 files |
| Phase 09 P01 | 5 | 3 tasks | 6 files |
| Phase 09 P02 | 334 | 3 tasks | 8 files |
| Phase 09 P03 | 13 | 3 tasks | 25 files |
| Phase 09 P04 | 17min | 3 tasks | 9 files |
| Phase 09 P09 | 10 | 2 tasks | 4 files |
| Phase 09 P06 | 10 | 3 tasks | 9 files |
| Phase 09 P07 | 9 | 3 tasks | 8 files |
| Phase 09 P08 | 11 | 3 tasks | 9 files |
| Phase 09 P10 | 75m | 3 tasks | 9 files |
| Phase 11 P01 | 3 | 3 tasks | 7 files |
| Phase 11 P03 | 5m | 4 tasks | 5 files |
| Phase 11 P05 | 8m | 2 tasks | 10 files |
| Phase 11-sidecar-scaffold-auth-migration P06 | 6 | 1 tasks | 4 files |
| Phase 11-sidecar-scaffold-auth-migration P07 | 3 | 2 tasks | 3 files |
| Phase 13 P01 | 8 | 3 tasks | 10 files |
| Phase 13-cot-adapter P03 | 8 | 2 tasks | 6 files |
| Phase 13-cot-adapter P04 | 415 | 3 tasks | 8 files |
| Phase 13-cot-adapter P05 | 6 | 2 tasks | 5 files |
| Phase 13 P06 | 9 | 2 tasks | 6 files |
| Phase 12 P07 | 13m | 3 tasks | 6 files |
| Phase 14 P01 | 18min | 3 tasks | 8 files |
| Phase 14 P02 | 12min | 1 tasks | 4 files |
| Phase 14 P03 | 15min | 3 tasks | 10 files |
| Phase 14 P04 | 10min | 2 tasks | 6 files |
| Phase 14 P05 | 20min | 3 tasks | 5 files |
| Phase 14 P06 | 15min | 3 tasks | 6 files |
| Phase 14 P07 | 15min | 3 tasks tasks | 6 files files |
| Phase 15 P01 | 8min | 2 tasks | 13 files |
| Phase 15-re-auth-smoothing P03 | 7min | 1 tasks | 4 files |
| Phase 15 P04 | 10min | 2 tasks | 3 files |
| Phase 15-re-auth-smoothing P05 | 8min | 1 tasks | 2 files |
| Phase 15-re-auth-smoothing P02 | 25min | 3 tasks | 4 files |
| Phase 16 P16-01 | 14 | 3 tasks | 1 files |
| Phase 16 P16-02 | 20 | 2 tasks | 1 files |
| Phase 16 P16-03 | 12 | 2 tasks | 1 files |
| Phase 17-overview-v2-redesign-iv-calibration-fix P01 | 10min | 2 tasks | 5 files |
| Phase 17-overview-v2-redesign-iv-calibration-fix P02 | 15min | 2 tasks | 2 files |
| Phase 17-overview-v2-redesign-iv-calibration-fix P03 | 10min | 1 tasks | 2 files |
| Phase 17-overview-v2-redesign-iv-calibration-fix P04 | 40min | 2 tasks tasks | 3 files files |
| Phase 17.1 P01 | 12min | 2 tasks | 2 files |
| Phase 17.1 P02 | 9min | 3 tasks | 3 files |
| Phase 17.1 P03 | 3min | 3 tasks | 2 files |
| Phase 17.1 P04 | 8min | 3 tasks | 3 files |
| Phase 17.1 P05 | 12min | 2 tasks | 2 files |
| Phase 18 P01 | 25min | 2 tasks | 4 files |
| Phase 18 P02 | 7min | 2 tasks | 2 files |
| Phase 18 P03 | 12min | 2 tasks | 2 files |
| Phase 18 P04 | 40min | 3 tasks | 5 files |
| Phase 18 P05 | 25min | 3 tasks | 20 files |
| Phase 19 P01 | ~12min | 3 tasks | 4 files |
| Phase 19 P02 | 15min | 2 tasks | 4 files |
| Phase 19 P03 | 16min | 2 tasks | 5 files |
| Phase 19 P04 | 15min | 3 tasks | 13 files |
| Phase 19 P19-05 | 22min | 3 tasks tasks | 14 files files |
| Phase 19 P06 | 15min | 2 tasks | 4 files |
| Phase 19 P07 | 18min | 3 tasks | 9 files |
| Phase 19 P08 | 20min | 3 tasks | 12 files |
| Phase 19 P09 | ~20min | 3 tasks | 6 files |
| Phase 20 P01 | 15min | 2 tasks | 4 files |
| Phase 29 P01 | 4min | 2 tasks | 3 files |
| Phase 29 P02 | 12min | 1 tasks | 3 files |
| Phase 29 P03 | 6min | 3 tasks | 6 files |
| Phase 29 P04 | 12min | 2 tasks | 4 files |
| Phase 29 P05 | ~15min | 2 tasks | 4 files |
| Phase 29 P06 | 4min | 2 tasks | 4 files |
| Phase 29 P07 | 8min | 1 tasks | 3 files |
| Phase 29 P09 | 22min | 2 tasks | 8 files |
| Phase 29 P08 | 25min | 2 tasks | 10 files |
| Phase 29 P10 | 25min | 2 tasks | 6 files |
| Phase 29 P12 | 10min | 2 tasks | 3 files |
| Phase 29 P11 | 20min | 2 tasks | 3 files |
| Phase 29 P13 | 35min | 3 tasks | 9 files |
| Phase 29 P14 | ~20min | 2 tasks | 5 files |
| Phase 30 P01 | 15min | 3 tasks | 8 files |
| Phase 30 P03 | 8min | 2 tasks | 5 files |
| Phase 30 P02 | 12min | 2 tasks | 6 files |
| Phase 30 P04 | 25min | 2 tasks | 6 files |
| Phase 30 P05 | ~35min | 2 tasks | 7 files |
| Phase 30 P06 | ~30min | 3 tasks | 8 files |
| Phase 31 P01 | ~20min | 2 tasks tasks | 3 files files |
| Phase 31 P02 | 6m | 2 tasks | 8 files |
| Phase 32 P01 | 1min | 2 tasks | 6 files |

## Accumulated Context

### Roadmap Evolution

- Phase 8 added (2026-06-23): Web Dashboard — React/Vite/Tailwind/shadcn frontend (apps/web) on Hono RPC + new GEX analytics endpoint. 5 screens prototyped as HTML mockups in `mockups/` (overview, analyzer, positions, journal, market).
- Phases 10-15 added (2026-06-25): Milestone v1.1 — Real-Time Schwab Streaming. schwab-py sidecar as sole Schwab boundary; live stream; COT + expanded FRED.
- Phases 16-20 added (2026-07-03): Milestone v1.2 — Trade Picker & Dashboard Redesign. Deploy
  phase-15 image → Overview v2 + IV-calibration fix → Analyzer→picker UI (contract-first against
  fixtures) → picker engine + economic-events adapter (real data) → tail (stream watchdog,
  event-triggered snapshot, strategy-rules L4 recording layer). Backlog items "strategy rules"
  and "event-triggered snapshot" (previously in ROADMAP.md Backlog section) are now scheduled in
  Phase 20 as RULE-01 and SNAP-01.

- Phases 23-28 added (2026-07-09): Milestone v1.3 — Picker Intelligence. VIX3M ingestion (alone,
  no-backfill) → regime/breadth board (user-added, evidence-gated) → data-quality ops rider →
  exit advisor → PICK-04 backtest harness (n=13 refutation-only) → playbook crisis gates/
  anti-criteria/sizing. `.planning/research/SUMMARY.md` confirms the dependency order across all
  4 research files; 28/28 requirements mapped, no orphans.

- Phase 30 added (2026-07-09): Analyzer pasted-calendar fix — payoff graph x-domain fits the
  full tent (tails + BEs clipped today; user screenshot 2026-07-09 shows 7500P pasted with apex
  at right edge, left tail cut), and pasted calendars get real engine entry analysis instead of
  "Pasted calendar — not engine-scored" placeholders.

- Phase 29 added (2026-07-09): Runtime Rule Settings — curated ~20-knob settings surface
  (entry/picker weights + bands, exit advisor rungs, regime warn/crisis bands) stored as a single
  JSONB overrides row merged over code defaults (worker job start + server request time);
  gear-icon modal in the top bar. User-approved override of T-28-11 (constants-file-as-only-source).
  Hysteresis arm/disarm pairs edited as validated pairs; normalizers, event penalties, gexFit
  credits, liquidity internals stay code-only.

### Decisions

Cleared at v1.1 close — full log in PROJECT.md Key Decisions table; per-plan decisions in
`.planning/milestones/v1.1-ROADMAP.md` and phase SUMMARY files. v1.2 research (dependencies,
pitfalls, phase ordering) is in `.planning/research/SUMMARY.md` and
`.planning/research/calendar-selection-criteria.md`.

- [Phase ?]: Phase 16: NEVER run 'railway domain' against the sidecar — it creates-on-first-use even with --service (re-broke GW-05 during 16-01 verify); verify sidecar domain state via Railway dashboard/GraphQL only
- [Phase ?]: Phase 16: railway up gives commitHash null — prove deploy identity by createdAt timestamp correlation, not git sha (Pitfall 1)
- [Phase ?]: Phase 16: worker liveness judged by CRON jobs firing post-deploy; chain-triggered/on-demand/retired jobs staying idle is expected baseline, not a regression
- [Phase ?]: Phase 17-01: apps/web now depends on @morai/core (package.json + tsconfig + vitest alias) to import the frozen invertIv solver from its package root per D-01 — core is hexagon-pure so this is browser-bundle-safe
- [Phase ?]: Phase 17-01: OQ1 resolved — packages/core/.../bsm.ts is a re-export shim of @morai/quant's bsmPrice; the two BSM 'engines' are the same function, no reconciliation needed
- [Phase 17-02]: frontIvStatus/backIvStatus made OPTIONAL on AnalyzerPosition (default 'ok') so Analyzer.tsx's 3 existing construction sites (owned by Plan 04) don't need out-of-scope edits in this plan
- [Phase 17-02]: bookPL excludes on EITHER frontIvStatus OR backIvStatus non-convergence (not just front) via a shared includedForT0 predicate — required by the plan's own behavior spec and T-17-03 threat mitigation, not just the action text's front-only shorthand
- [Phase 17-02]: 'each position's short/long strikes' (D-06) collapses to ONE strike per position in buildScenarioStrip — calendarNetPrice prices both calendar legs at the same extractStrike(pos) value; no separate front-strike field exists today
- [Phase ?]: [Phase 17-03]: highlightActive derived purely from highlightedPositionId !== null (curves/count independent optional props) so dimming can apply even before Plan 04 wires overlay curve data
- [Phase ?]: [Phase 17-03]: T0 exclusion note rendered as an HTML div inside PayoffChart's own wrapper (not SVG text), since PayoffChart doesn't own the page-level legend row — Overview.tsx owns that, out of this plan's file scope
- [Phase ?]: [Phase 17-03]: only the two net-book curve LinePath elements (T+0, @exp) get the stroke-opacity 0.3 dim — breakeven marker lines and fan curves untouched, matching acceptance criteria's literal scope
- [Phase 17-04]: Cold-start (no-price) legs excluded from T+0/@exp pricing (never a guessed IV) but do NOT show the 'IV n/a' badge — only a genuine IvError does (AnalyzerPosition status is 2-state, no 'no-data-yet' variant)
- [Phase 17-04]: Payoff hero prices calendars only (pairPositionsIntoCalendars) — singles remain table-only rows; prod book has 0 singles today, documented scoping decision not a silent gap
- [Phase 17-04]: Market.tsx: exported relAge/GEX_FRESH_MS (pure additive) so Overview.tsx reuses them verbatim per the plan's own interface contract
- [Phase ?]: 17.1-01: single commit per task at green (project tdd.md rule) instead of separate RED/GREEN commits
- [Phase ?]: 17.1-02: buildXTicks step formula uses (max-min)/targetCount not /(targetCount-1) — the plan's own acceptance criteria (step 200, matching today's hardcoded ticks) override RESEARCH.md's worked example, which snapped to step 250
- [Phase ?]: 17.1-03: excludedCalendars controlled-component wiring landed in Task 1's commit (not Task 2) since Task 1's own RED test requires the checkbox to functionally reach the chart curve
- [Phase ?]: 17.1-04: ‹/› step handlers clamp via resolveDaysForward(prev, today, maxDaysForward) BEFORE incrementing (not raw date+delta on the stored ISO string) — avoids drift past the bound on repeated clicks
- [Phase ?]: 17.1-04: daysForward feeds ONLY the main scenario useMemo (net-book curves) — the row-highlight overlay scenario intentionally stays on daysForward:0, matching the plan's explicit scope
- [Phase ?]: 17.1-04: TOS magenta/cyan hex values remain [ASSUMED] (RESEARCH A1) pending an end-of-phase human pixel-check against reference screenshots not yet re-dropped to mockups/tos-reference/ — not a blocker for this plan
- [Phase ?]: 17.1-05: formatExpiryCell takes a discriminated-union input (calendar/single) rather than CalendarGroup/BrokerPositionResponse directly — decoupled from pair-calendars.ts types, trivially unit-testable with literal values
- [Phase ?]: 17.1-05: single-leg parse-failure DTE now defaults to 0 (was whole-cell dash) — consistent with pair-calendars.ts's own dte() helper default; no test asserted old behavior, no unparseable occSymbols in current book
- [Phase ?]: 18-01: guard-case candidate (7450-guard-inverted) is a constructed data point (front IV 15.5% > back IV 10.5% at 21/45 DTE), not a literal mockup row
- [Phase ?]: 18-01: guard-case debit computes to -802.82 (a credit) — accepted as the mathematically honest BSM output under term-structure inversion, not an authoring error
- [Phase ?]: 18-01: NOT marking ANLZ-01/02/03 complete despite them appearing in this plan's requirements frontmatter — 18-01 only ships the contract/fixture foundation; 18-02..18-05 still list the same IDs as their own scope (actual UI delivery). Marking complete now would be a false-positive signal; defer to the plan(s) that actually ship the rendered feature.
- [Phase ?]: 18-02: compareCurve is a separate conditional layer next to (not inside) the retired rollCurve block, not a repurposing
- [Phase ?]: 18-02: expectedMoveBand reuses the existing Zero-line layer's zeroY value (not recomputed) and is placed before all curve layers in JSX source order so it can never occlude T+0/@exp
- [Phase ?]: 18-02: buildXScale/INNER_W added to PayoffChart.tsx's existing test-only re-export line (test infra, no behavior change) so tests assert exact spot±em pixel positions
- [Phase ?]: 18-02: NOT marking ANLZ-02 complete — this plan ships only PayoffChart chart primitives; the user-facing overlay capability ANLZ-02 describes lands in 18-04's picker screen
- [Phase 18]: 18-03: TOLERANCE=2500 for the debit=max-loss invariant is a genuine BSM-model constant (deep-ITM European put with r>0 can price below intrinsic on repriceScenario's fixed 6900-7900 grid), empirically derived via probe scripts, not a fudge factor
- [Phase 18]: 18-03: fast-check property test's candidate debit is computed via the same bsmPrice formula scenario-engine.ts's private entryNetPrice uses, not an arbitrary number - proves the same debit-vs-worst-case relationship as the fixture example test
- [Phase 18]: 18-03: Task 1 (adapter+mapping) and Task 2 (debit invariant) landed in one commit since both share candidate-to-position.test.ts, authored in a single TDD RED->GREEN cycle (matches 17.1-01 precedent)
- [Phase ?]: 18-04: Breakdown-bar captions per criterion (vol-pts v / percent / ok-minus) are an authored formatting choice mirroring the mockup — UI-SPEC only locks the fwd-edge guard-case n/a caption
- [Phase ?]: 18-04: CandidateRail extracted+exported from Analyzer.tsx so the empty-state branch is directly unit-testable without module-mocking @morai/contracts (Analyzer is fixture-only, zero props, D-02b)
- [Phase ?]: 18-04: ScenarioStrip shows numeric-only level headers (no put-wall/flip semantic labels), matching Overview.tsx's buildScenarioStrip reuse precedent
- [Phase ?]: EntryExitPlan target/stop use |debit|x pct with a fixed +/- sign (never propagates a negative debit's raw sign) to avoid a double-negative on the guard candidate
- [Phase ?]: TermStructureChart converts event ISO dates to DTE via a fixed, fixture-verified reference date (2026-07-02) - no explicit asOf field exists in the fixture
- [Phase ?]: Deleted the now-orphaned RollConfig type alongside rollScenario (delete-if-orphaned, D-04a, one level deeper than the plan's explicit list)
- [Phase ?]: 19-01: Task 1+2 combined into one commit (shared picker.test.ts suite, tdd.md commit-at-green-only rule) — matches 17.1-01/18-03 precedent
- [Phase ?]: 19-01: ports.ts exports 9 ForVerbingNoun ports not 8 — plan's own action text + downstream needs (19-PATTERNS.md) list 9; acceptance criteria count was a plan authoring bug
- [Phase 19-02]: computeFwdIv guards on radicand<0 (not literal rad>0) -- resolves plan-text contradiction, matches truths/behavior/CONTEXT.md
- [Phase 19-02]: findBreakevens uses separate frontStrike/backStrike fields matching PickerCandidateDomain leg shape from 19-01
- [Phase 19-02]: breakevens fast-check property domain bounded to near-ATM strikes (90-110% spot) + 8% IV floor -- wider bounds hit bsmPrice floating-point noise on deep-OTM/near-zero-IV combos, not a real market condition
- [Phase 19]: 19-03: dedupe-by-construction (nearest qualifying back expiry per deltaRung+frontExpiry) instead of a post-hoc score-based dedupe, since selection has no score
- [Phase 19]: 19-03: inverted term structure zeroes the fwdEdge score contribution outright (not merely fwdEdge=0 through the normal window), never rewarding an inverted structure
- [Phase 19]: 19-03: NOT marking PICK-01/PICK-03 complete -- this plan ships selectCandidates/scoreCalendarCandidates only; compute-picker use-case, HTTP/MCP wiring, and the economic-events adapter land in 19-04..19-09
- [Phase ?]: 19-04: added packages/core/src/picker/index.ts barrel (Rule 3) so EconomicEvent/ForFetchingEconomicEvents/etc. reach @morai/adapters via @morai/core -- no prior 19-01..03 plan needed cross-package consumption
- [Phase ?]: 19-04: FOMC_SEED dates authored from training-knowledge recall of the Fed's published 2025/2026 schedule (no live FRED_API_KEY/web access this session) -- documented as needing periodic refresh
- [Phase ?]: 19-04: NOT marking PICK-03 complete -- this plan ships only the adapter/repo data path; cron wiring (19-08) and scoring/candidates-payload integration land in later plans
- [Phase ?]: 19-05: picker_snapshot uses observed_at as PK (instant uniqueness IS the append-idempotency guard, no surrogate uuid); INSERT-only, never onConflictDoUpdate (D-06 append-history)
- [Phase ?]: 19-05: JSONB blob validated through pickerSnapshotResponse on BOTH write and read (T-19-10) — bad blob rejected before insert (0 rows), corrupted stored row surfaces StorageError on read
- [Phase ?]: 19-05: migrations 0014+0015 applied+verified LIVE — economic_events.event_date=date, picker_snapshot.observed_at=timestamptz, snapshot=jsonb
- [Phase ?]: PICKER_TOP_N=8 matches the mockup's own top.slice(0,8) cap (D-03)
- [Phase ?]: GEX degraded-context zeroing reuses scoring.ts's null-passthrough; events zeroing is a post-scoring breakdown override + score recompute (EconomicEvent has no fetchedAt, so events staleness = now() minus furthest known event date exceeding a 14-day window)
- [Phase 19]: 19-07: added getPicker optional param to makeMcpRouter (server.ts) between getMacro and getPositions -- MCP tool registration happens in server.ts's per-request closure, not main.ts, so touching server.ts was required plumbing not itemized in the plan's files_modified list
- [Phase 19]: 19-07: exported ForRunningGetPicker/makeGetPickerUseCase (@morai/core) and makePostgresPickerSnapshotRepo/makeMemoryPickerSnapshotRepo (@morai/adapters) -- built in 19-05/19-06 but never re-exported through the package barrels
- [Phase 19]: 19-07: get_picker_candidates MCP tool tested via a real McpServer + InMemoryTransport-linked Client (genuine handler invocation) rather than only calling the use-case directly, avoiding the weaker existing get_status test precedent
- [Phase 19-08]: absGammaStrike derived at the composition root from GexSnapshotRow.strikes (max abs-gex strike) since GexSnapshotRow has no such field
- [Phase 19-08]: reworded compute-picker terminal-job comments from 'no boss.send' to 'no further enqueue' so the plan's own literal-grep acceptance criterion passes
- [Phase 19-09]: usePicker's queryFn returns null (not a thrown Error) on a 404 -- the cold-start no-snapshot response is honest 'nothing computed yet', distinct from a real fetch failure, so Analyzer can render 'Picker warming up' instead of the generic error state
- [Phase 19-09]: Analyzer.tsx collapses usePicker's data (PickerSnapshotResponse | null | undefined) into one snapshot: PickerSnapshotResponse | null local via data ?? null, simplifying every downstream guard to a single snapshot !== null check
- [Phase 19-09]: AdHocCalendarAnalysis's non-nullable gex prop falls back to 0 for a null putWall/flip/callWall (best-effort ad-hoc panel, never scored) -- also fixed 3 pre-existing typecheck errors on the exact lines this task rewrote
- [Phase 19-09]: CandidateCard's staleness tag reads pickerSnapshotResponse.asOf (a date-only string) literally per the plan's own task text, NOT the picker_snapshot row's observedAt timestamp (which the HTTP route currently discards) -- flagged as a known limitation/follow-up, safe failure direction (never falsely reads fresh)
- [Phase 20-01]: deriveStreamStatus placed in apps/web/src/lib (not hooks/) so it carries zero React import and is unit-testable standalone, mirroring rth-window.ts's caller-passes-now purity idiom
- [Phase 20-01]: dropped an automated "no Date.now()/no React import" source-text purity test (import.meta.url did not resolve to file:// scheme in this repo's Vitest config) — verified the same property manually via grep instead
- [Phase 20-01]: NOT marking WATCH-01 complete in REQUIREMENTS.md despite it appearing in this plan's requirements frontmatter — 20-01 ships only the contract schema + pure derivation foundation; the user-facing three-state badge ships in 20-03 per ROADMAP.md ("WATCH-01 ships" annotation), matching the 18-01/19-04 precedent
- [Phase ?]: 29-01: rule_overrides is a single-row JSONB table keyed by fixed literal id 'default' (mirrors broker_tokens.app_id, no DB CHECK constraint); this explicitly overrides Phase 28 T-28-11 -- constants remain DEFAULTS, overrides row is an explicit visible layer merged at consumption time
- [Phase 29]: 29-02: weight-sum enforced as HARD VALIDATION (reject non-100), not server-side normalization
- [Phase 29]: 29-02: picker.weights all-9-or-none needs no separate completeness refine — Zod's own required-field check on the non-optional pickerWeightsShape object does it
- [Phase 29]: 29-02: exits.take/exits.stop use flat arm/disarm field names (plus15Arm/plus15Disarm etc.), not nested {arm,disarm} pairs, per plan action text
- [Phase 29]: 29-03: deltaMin clamp bounds against the effective (possibly overridden) deltaMax, not the DELTA_BAND_MAX constant
- [Phase 29]: 29-03: debitFitFraction cheap-floor/expensive-zero edges stay code-only constants; only the ideal-band midpoint is overridable
- [Phase 29-04]: resolveEntryGate's vixTier output field is optional (not required) so computePickerSnapshot.ts's toEntryGateState() needed zero out-of-scope changes — keeps this plan's files_modified scope to exactly entry-gate/sizing + tests
- [Phase 29-04]: resolveEntryGate's vixLadder param takes pre-built ReadonlyArray<VixLadderRow> rows, not raw boundary overrides -- callers call resolveVixLadder() first, then pass rows in — matches the plan's own literal type spec; keeps resolveEntryGate agnostic of the raw override shape
- [Phase ?]: 29-05: resolveTakeRung/resolveStopRung use an explicit switch on rung.label (no lookup table, no as casts) to stay within typescript.md strictness
- [Phase ?]: 29-05: evalStop/evalTake gained an optional rungs param defaulting to STOP_RUNGS/TAKE_RUNGS so only evaluateExit's own call sites needed to pass config.stopRungs/config.takeRungs
- [Phase ?]: 29-06: exported the eight WARN/CRISIS constants from regime.ts (were module-private) so rule-config.ts can reference them by name in its ?? fallback idiom
- [Phase ?]: 29-07: PickerRuleOverrides uses flat field names matching the contracts pickerOverrides group; PickerRuleConfig uses the plan-pinned nested shape; single-field isolation proven via 12 deterministic tests, idempotency via a real fast-check property over all 12 fields
- [Phase ?]: computeEffective/mergeStoredOverrides use a generic JsonObject-shaped deep-merge (no picker/exits/regime field names) so the settings context never imports contracts or engine domain code — engine-agnostic by construction, zero as casts
- [Phase ?]: Deep (not group-level shallow) recursion at every nesting level — correct for both picker's atomic all-or-none sub-objects and exits' partial per-rung patches with the same merge function
- [Phase 29-08]: added packages/adapters/src/__contract__/rule-overrides.contract.ts (not itemized in the plan's files_modified list) — matches the codebase-wide convention every other multi-adapter repo uses for its shared contract-test logic
- [Phase 29-08]: RuleOverrides (contracts) → StoredRuleOverrides (core JsonObject) conversion uses a JSON.parse(JSON.stringify(...)) round-trip behind a typed isJsonObject guard to drop zod's optional `| undefined` fields under exactOptionalPropertyTypes — zero as/any
- [Phase ?]: [Phase 29-10]: readRuleOverrides errors/malformed picker groups degrade to resolvePickerRuleConfig(undefined) defaults, never fail compute-picker — matches the file's best-effort convention (readDailySpotCloses/readPickerSlopeHistory), distinct from the gate's fail-CLOSED posture
- [Phase ?]: [Phase 29-10]: autoTuneTargetDelta gained an optional ladder param and ScoringParams gained debitBand — plumbing the plan's own objective threading map required but files_modified omitted (candidate-selection.ts, scoring.ts)
- [Phase ?]: 29-12: readRuleOverrides read AFTER the readMacroObservations early-return — a macro-read failure short-circuits without an unnecessary overrides read
- [Phase ?]: 29-12: isRegimeRuleOverrides narrows a flat 8-field optional-number group (no nested sub-objects) — simpler than picker's multi-shape isPickerRuleOverrides guard
- [Phase ?]: compute-exit-advice wired exclusively into worker ComputeExitAdviceDeps, not server GetExitAdviceDeps
- [Phase ?]: 29-13: zod-inferred mapped types don't get TS implicit-index-signature leniency — verified via a real tsc repro before adding the toOverridesPatch JSON round-trip conversion (same idiom as the existing rule-overrides repos' toJsonSafe)
- [Phase ?]: 29-13: resolveExitRuleConfig/resolveRegimeRuleConfig were missing from the top @morai/core barrel (only resolvePickerRuleConfig was exported) — added to exits/index.ts + analytics/index.ts + top barrel, the ONE apps-to-core wiring point Task 3 needed
- [Phase ?]: Editing sends the full edited group object on Save, not a leaf-level patch — every leaf is already rendered from effective, and the server's weight-sum/hysteresis refinements require complete sub-objects anyway
- [Phase ?]: flatten/lookup/unflatten helpers in RuleSettingsModal.tsx operate on unknown-typed params (never an index-signature type) to sidestep the zod mapped-type-vs-index-signature TS incompatibility documented in 29-13
- [Phase ?]: 30-01: repriceScenario's domain param defaults to the old SPOT_GRID_MIN/MAX constants so every existing caller needs zero changes
- [Phase ?]: 30-01: findZeroCrossings moved (not duplicated) from PayoffChart.tsx into scenario-engine.ts as a shared export for payoff-domain.ts's wide-pass
- [Phase ?]: 30-01: Analyzer.tsx/Overview.tsx PayoffChart call sites pass a literal {min:6900,max:7900} placeholder domain (ponytail-flagged) since domain became required in this plan but real computePayoffDomain screen-wiring is deferred to 30-02
- [Phase 30-03]: analyzeAdHocCalendarRequest omits spot entirely and is .strict() so a client-supplied spot key is rejected (T-30-06 threat mitigation)
- [Phase 30-03]: resolveEventExit extracted verbatim (same day-number math, same earliest-event selection) into an exported pure function; selectCandidates calls it with zero behavior change
- [Phase 30-03]: barrel-exported both new contract schemas through packages/contracts/src/index.ts (plumbing not itemized in files_modified) so 30-04/30-05 can import them from @morai/contracts
- [Phase 30-02]: computePayoffDomain's strike anchors are filtered through includedForT0 — an excluded/non-convergent position must not widen the domain since it never contributes to either curve
- [Phase 30]: 30-04: no application/index.ts barrel created -- no such file exists anywhere in this codebase; re-exports land in picker/index.ts + top-level packages/core/src/index.ts matching every other bounded context's precedent
- [Phase 30]: 30-04: isPickerRuleOverrides exported from computePickerSnapshot.ts alongside toPickerCandidateDomain/applyGatePenalty/zeroEventAdjustment so the ad-hoc use-case resolves fresh rule overrides via the SAME narrowing logic, never a second copy
- [Phase ?]: 30-05: both scored:true and scored:false map to HTTP 200 (binding #2) -- overrides 30-PATTERNS.md's discretionary 404-no-snapshot suggestion
- [Phase ?]: 30-05: registerAnalyzeAdHocCalendarTool registered in server.ts not main.ts -- matches every existing MCP tool's registration split
- [Phase ?]: 30-05: added defaulted BSM_DIVIDEND_YIELD/BSM_RATE_FALLBACK to apps/server/src/config.ts matching the worker's own defaults -- no new required Railway env var
- [Phase ?]: 30-06: isPastedId() removed entirely -- all 4 gates (3 note-gates + Risk-profile subline) key off candidate.breakdown.length===0 instead of the pasted id
- [Phase ?]: 30-06: a failed POST /api/picker/analyze adds no card (mirrors a parse failure) -- id/seq reservation deferred so a failed request never consumes a pasted-N sequence number
- [Phase ?]: 30-06: apps/web has no msw dependency -- useAnalyzeCalendar.test.ts mirrors useRuleSettings.test.ts's apiFetch-mock harness instead of the plan's msw note
- [Phase ?]: 31-01: PinnedMarker reworked from {x,label,anchorEnd} to {x,clampedTo} -- fixed-lane single-glyph edge arrows (EDGE_ARROW_LANE_Y) replace in-chart wall/flip text labels entirely (KISS collision fix, DEFECT-1)
- [Phase ?]: 31-02: bandWarn/bandCrisis required (not optional) on regimeIndicator — fail-loud on a stale response
- [Phase ?]: 31-02: gauge marker color reads server-computed indicator.band verbatim, never recomputed client-side
- [Phase ?]: Explainer registry keyed by ruleConfig's real 43 dotted leaf paths; completeness enforced by a recursive schema walk, never a hand-copied path array

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase-15 image not deployed**: prod runs the pre-phase-15 image — T-24h re-auth alert
  surface (refreshExpiresIn, amber banner, warn log) not live until server+worker+web deploy.
  Next re-auth window ~2026-07-09. This is now Phase 16 of the v1.2 roadmap — the milestone's
  first and most time-sensitive phase.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Web UI | apps/web React SPA (D19) | v2 | Architecture |
| Streaming | Sub-minute full-chain market data | v2 | Architecture (500-symbol cap) |
| Scale | Timescale hypertable migration (D7) | v2 trigger | Architecture |
| Multi-user | API auth beyond single bearer token | v2 | Architecture |
| Test isolation | Postgres leg-observations contract tests have cross-test contamination (re-persist/large-batch idempotency failures are flaky) | future | Phase 03 P06 |
| Realized P&L | IN-A2 — real per-leg commission/fees + intraday filledAt: BrokerTransaction domain type carries no time/commission/fees fields; needs docs-first brokerage domain + Schwab adapter change. Realized P&L stays fee-blind until a dedicated plan. | future | Phase 05 P14 |
| Go-live: migration 0011 | `bun run migrate` (direct DATABASE_URL 5432) to apply token_json to live Supabase — file committed, testcontainer-applied; live apply pending prod-up | go-live UAT | Phase 11 P02 |
| Go-live: sidecar deploy | Create Railway sidecar service (railway.sidecar.toml, NO public domain GW-05), set 6 env vars + SIDECAR_URL on server/worker, run one-time Schwab OAuth dance to seed token_json, verify /sidecar/health ok + not public | go-live UAT | Phase 11 P05 |
| Picker | PICK-04 — term-slope signal backtest over `leg_observations` (validate Vasquez cross-sectional finding on SPX time-series) | now v1.3 Phase 27 (BT-01..05) | REQUIREMENTS.md Future Requirements |
| Picker | PICK-05 — event-premium weighting by surprise magnitude | v1.2.x backlog | REQUIREMENTS.md Future Requirements |
| Strategy Rules | RULE-02 — rule-fired → outcome correlation report (needs RULE-01 data accumulated) | v1.2.x backlog | REQUIREMENTS.md Future Requirements |

Items acknowledged and deferred at v1.1 milestone close on 2026-07-02:

| Category | Item | Status |
|----------|------|--------|
| uat_gap | Phase 03: 03-UAT.md — 2 pending scenarios | testing (v1.0-era) |
| uat_gap | Phase 04: 04-UAT-BUGFIX-SUMMARY.md | unknown (v1.0-era) |
| uat_gap | Phase 04: 04-UAT.md | partial (v1.0-era) |
| uat_gap | Phase 14: 14-UAT.md | passed (scanner false positive) |
| verification_gap | Phase 03: 03-VERIFICATION.md | human_needed (v1.0-era) |
| verification_gap | Phase 11: 11-VERIFICATION.md | human_needed — closed via 11-UAT.md 5/5 pass |
| verification_gap | Phase 12: 12-VERIFICATION.md | human_needed — closed via 12-UAT.md 6/6 pass (2026-07-01) |
| todo | 03-code-review-followups.md | low, advisory |
| todo | over-engineering-cleanup.md | ponytail-audit 2026-06-22 |

Items acknowledged and deferred at v1.2 milestone close on 2026-07-06 (override_closeout):

| Category | Item | Status |
|----------|------|--------|
| debug | journal-pnl-ground-truth | resolved — P&L fixed + 13 calendars oracle-verified 2026-07-05; session marker stale |
| uat_gap | Phase 17.1: 17.1-UAT.md | passed — 0 pending scenarios |
| verification_gap | Phase 20: 20-VERIFICATION.md | human_needed — WATCH-01 confirmed live in prod |
| verification_gap | Phase 22: 22-VERIFICATION.md | human_needed — live UAT 2/2 PASSED on morai.wtf |
| todo | 03-code-review-followups.md | low, advisory (carried from v1.1) |
| todo | over-engineering-cleanup.md | ponytail-audit 2026-06-22 (carried from v1.1) |
| context_open_questions | Phase 22: 22-CONTEXT.md (3) | resolved during execution — UI-SPEC locked |

## Session Continuity

Last session: 2026-07-10T19:16:20.434Z
Stopped at: Completed 31-02-PLAN.md
Resume file: 

None
