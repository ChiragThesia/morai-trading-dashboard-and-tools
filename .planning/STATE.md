---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Trade Picker & Dashboard Redesign
status: planning
last_updated: "2026-07-03T17:02:11.110Z"
last_activity: 2026-07-03
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-03)

**Core value:** For any calendar, answer "how did price and greeks move over the life of this trade?" — collected automatically, queryable by API and Claude Code.
**Current focus:** v1.2 Trade Picker & Dashboard Redesign — defining requirements

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-07-03 — Milestone v1.2 started

## Milestone v1.1 Summary

**6 phases, 18 requirements (GW-01..05, STRM-01..05, JRNL-02, COT-01..02, MAC-01..02, AUTH-05..06, DOC-01)**

Strict dependency chain:

- Phase 10 (DOC-01) → Phase 11 (GW-01..05, JRNL-02) → Phase 12 (STRM-01..05) → Phase 15 (AUTH-05..06)
- Phases 13 (COT-01..02) and 14 (MAC-01..02) are independent; can run parallel with 12 and each other.

Key risks carried into planning:

1. Dual-refresher rotating-token race — Phase 11 must retire TS refresh job BEFORE sidecar goes active.
2. One-streamer-per-account limit — Postgres advisory lock required before any streaming work.
3. 7-day headless re-auth gap — CBOE fallback must be confirmed live before Phase 12 go-live.
4. ACCT_ACTIVITY message types undocumented — discover empirically in Phase 12; do not hard-code.

Regression gates (must survive every phase):

- SPX OI=0 / SPY proxy (~10.048×)
- CBOE timestamps are UTC (not ET)
- GEX put-sign (negative gamma for puts)
- 65,534-param insert limit (chunk at ≤2,000 rows)

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

## Accumulated Context

### Roadmap Evolution

- Phase 8 added (2026-06-23): Web Dashboard — React/Vite/Tailwind/shadcn frontend (apps/web) on Hono RPC + new GEX analytics endpoint. 5 screens prototyped as HTML mockups in `mockups/` (overview, analyzer, positions, journal, market).
- Phases 10-15 added (2026-06-25): Milestone v1.1 — Real-Time Schwab Streaming. schwab-py sidecar as sole Schwab boundary; live stream; COT + expanded FRED.

### Decisions

Cleared at v1.1 close — full log in PROJECT.md Key Decisions table; per-plan decisions in
`.planning/milestones/v1.1-ROADMAP.md` and phase SUMMARY files.

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase-15 image not deployed**: prod runs the pre-phase-15 image — T-24h re-auth alert
  surface (refreshExpiresIn, amber banner, warn log) not live until server+worker+web deploy.
  Next re-auth window ~2026-07-09. (v1.0 db-down/FRED_API_KEY blockers resolved during v1.1.)

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Web UI | apps/web React SPA (D19) | v2 | Architecture |
| Streaming | Sub-minute full-chain market data | v2 | Architecture (500-symbol cap) |
| Scale | Timescale hypertable migration (D7) | v2 trigger | Architecture |
| Multi-user | API auth beyond single bearer token | v2 | Architecture |
| Test isolation | Postgres leg-observations contract tests have cross-test contamination (re-persist/large-batch idempotency failures are flaky) | future | Phase 03 P06 |
| Realized P&L | IN-A2 — real per-leg commission/fees + intraday filledAt: BrokerTransaction domain type carries no time/commission/fees fields; needs docs-first brokerage domain + Schwab adapter change. Realized P&L stays fee-blind until a dedicated plan. | future | Phase 05 P14 |
| Event-triggered snapshot | Supplemental out-of-cycle snapshot on large underlying moves (via stream) | v1.2 | SUMMARY.md |
| Go-live: migration 0011 | `bun run migrate` (direct DATABASE_URL 5432) to apply token_json to live Supabase — file committed, testcontainer-applied; live apply pending prod-up | go-live UAT | Phase 11 P02 |
| Go-live: sidecar deploy | Create Railway sidecar service (railway.sidecar.toml, NO public domain GW-05), set 6 env vars + SIDECAR_URL on server/worker, run one-time Schwab OAuth dance to seed token_json, verify /sidecar/health ok + not public | go-live UAT | Phase 11 P05 |

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

Last session: 2026-07-02T21:05:20.217Z
Stopped at: Completed 15-05-PLAN.md
Resume file: None

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
