---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Trade Picker & Dashboard Redesign
current_phase: 17
current_phase_name: overview-v2-redesign-iv-calibration-fix
status: executing
stopped_at: Completed 17-03-PLAN.md
last_updated: "2026-07-03T22:31:08.928Z"
last_activity: 2026-07-03
last_activity_desc: Phase 17 execution started
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 7
  completed_plans: 6
  percent: 20
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-03)

**Core value:** For any calendar, answer "how did price and greeks move over the life of this trade?" — collected automatically, queryable by API and Claude Code.
**Current focus:** Phase 17 — overview-v2-redesign-iv-calibration-fix

## Current Position

Phase: 17 (overview-v2-redesign-iv-calibration-fix) — EXECUTING
Plan: 4 of 4
Status: Ready to execute
Last activity: 2026-07-03 — Phase 17 execution started

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

**Recent Trend:**

- Last 5 plans: P01 (~20 min), P02 (~8 min), P03 (~12 min), P04 (~8 min)
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
| Picker | PICK-04 — term-slope signal backtest over `leg_observations` (validate Vasquez cross-sectional finding on SPX time-series) | v1.2.x backlog | REQUIREMENTS.md Future Requirements |
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

## Session Continuity

Last session: 2026-07-03T22:31:08.919Z
Stopped at: Completed 17-03-PLAN.md
Resume file: None

## Operator Next Steps

- Plan the first v1.2 phase: `/gsd-plan-phase 16`
