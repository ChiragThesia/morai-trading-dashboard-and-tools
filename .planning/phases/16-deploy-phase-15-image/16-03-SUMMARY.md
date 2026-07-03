---
phase: 16-deploy-phase-15-image
plan: 03
subsystem: infra
tags: [smoke-test, regression, deploy-04, alert-surface, refresh-expires-in, mcp, follow-ups]

# Dependency graph
requires:
  - phase: 16-deploy-phase-15-image
    plan: 01
    provides: pre-deploy error baseline (fetch-schwab-chain AUTH_EXPIRED, sync-fills null-payload), GW-05 restored
  - phase: 16-deploy-phase-15-image
    plan: 02
    provides: server+worker on phase-15 tip (SUCCESS @19:19Z), refreshExpiresIn key-presence, web@220719f, access-control intact
provides:
  - Post-deploy regression smoke result (get_status/get_journal/get_cot/get_macro) — no NEW regression, both baseline errors self-recovered
  - Alert-surface checkpoint-1 confirmation (refreshExpiresIn key on /api/status AND operator-observed web poll; AuthExpiredBanner ships via web@220719f)
  - DEPLOY-04 criteria 2 (checkpoint 1) + 3 (no regression) met — closes DEPLOY-04
  - Two scheduled follow-ups recorded (checkpoint 2 ~2026-07-08 live amber banner; RTH live-stream check next session)
affects: [17-overview-v2]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MCP smoke checks run over the stateless /mcp streamable-HTTP JSON-RPC transport via curl (bearer = Railway MCP_BEARER_TOKEN) when no MCP client is at hand — tools/call with name+arguments, parse the SSE `data:` line"
    - "Regression judgment diffs post-deploy lastJobRuns against the Plan 01 baseline; a baseline error that has a LATER lastSuccessAt is self-recovered, not a live regression"

key-files:
  created:
    - .planning/phases/16-deploy-phase-15-image/16-03-SUMMARY.md
  modified: []

key-decisions:
  - "Spoke the MCP protocol over /mcp via curl (bearer from Railway MCP_BEARER_TOKEN) because no morai MCP client was live in-session — the plan's stated fallback; recorded which transport was used per check"
  - "Judged the two Plan 01 baseline errors self-recovered (both have a lastSuccessAt AFTER their lastErrorAt on the new image) — strengthens the no-regression verdict rather than counting as live failures"
  - "Live-stream check deferred to the next RTH session (plan ran at 16:09 ET, just past the 16:00 ET close; 07-04 is a holiday weekend, next session ~Mon 2026-07-06) — RTH-bound per D-04, not a phase blocker"
  - "Checkpoint 2 (live amber banner during the real ~2026-07-08 T-24h window) recorded as a scheduled follow-up UAT item, NOT a same-day gate — the amber banner cannot be forced (D-02)"

requirements-completed: [DEPLOY-04]  # DEPLOY-04 spans the phase; criterion 1 met in Plan 02, criteria 2 (checkpoint 1) + 3 met here — requirement now closed

coverage:
  - id: SM1
    description: "get_status: db ok, both apps fresh, refreshExpiresIn null on both; lastJobRuns shows only the two Plan 01 baseline errors, BOTH self-recovered (later lastSuccessAt) — no NEW post-deploy regression"
    requirement: "DEPLOY-04"
    verification:
      - kind: integration
        ref: "curl /mcp tools/call get_status (bearer) + curl /api/status | jq — db=ok; trader/market fresh + refreshExpiresIn=null; fetch-schwab-chain lastSuccessAt 20:01:00Z > lastErrorAt 19:31:31Z; sync-fills lastSuccessAt 20:10:30Z > lastErrorAt 19:51:00Z"
        status: pass
    human_judgment: false
  - id: SM2
    description: "get_journal: open calendar returns 46 snapshots; latest at 2026-07-03T19:02:02Z (last expected RTH slot given the ~16:00 ET close and pending chain cascade) — not unbounded staleness, tied to pre-existing cascade timing not this deploy"
    requirement: "DEPLOY-04"
    verification:
      - kind: integration
        ref: "curl /mcp tools/call get_journal calendarId=65aac62e-... → snapshots[45].time=2026-07-03T19:02:02.031Z, source=cboe"
        status: pass
    human_judgment: false
  - id: SM3
    description: "get_cot: latest weekly CFTC TFF row returned (asOf 2026-06-23, publishedAt 2026-07-01, 26 rows)"
    requirement: "DEPLOY-04"
    verification:
      - kind: integration
        ref: "curl /mcp tools/call get_cot → 26 rows, newest asOf 2026-06-23 contract 13874A"
        status: pass
    human_judgment: false
  - id: SM4
    description: "get_macro: 8 FRED/VVIX series present and non-empty (DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS, VVIX)"
    requirement: "DEPLOY-04"
    verification:
      - kind: integration
        ref: "curl /mcp tools/call get_macro → 8 series, values through 2026-07-01..07-03"
        status: pass
    human_judgment: false
  - id: AS1
    description: "Alert-surface checkpoint 1: refreshExpiresIn key present on tokenFreshness.trader AND .market on /api/status (value null, correct outside window) AND on the operator-observed web /api/status poll; AuthExpiredBanner ships in the deployed web bundle (web@220719f); amber banner correctly not showing"
    requirement: "DEPLOY-04"
    verification:
      - kind: manual_procedural
        ref: "Operator opened https://morai.wtf, DevTools Network → /api/status poll carries both refreshExpiresIn keys (null); curl /api/status | jq .tokenFreshness confirms server-side; dashboard/positions/GEX render; no amber banner (null = outside T-24h window)"
        status: pass
    human_judgment: true
    rationale: "Live web render + the browser's polled response are operator-observable facts (D-02 checkpoint 1); the operator confirmed 'verified' and pasted the live poll response"
  - id: AS2
    description: "Job chain confirmed healthy on the new image (operator's fresher read): fetch-schwab-chain 20:01:00Z, snapshot-calendars 20:01:30Z (CHAIN fired), compute-bsm-greeks 20:01:25Z, sync-fills 20:10:30Z; server uptime ~3125s ≈ boot 19:18Z (matches deploy)"
    requirement: "DEPLOY-04"
    verification:
      - kind: manual_procedural
        ref: "Operator-pasted /api/status poll (later than the 20:01 executor read) — full trigger chain recovered and firing"
        status: pass
    human_judgment: true
    rationale: "Chain-trigger recovery (snapshot-calendars firing off fetch-schwab-chain success) is the strongest liveness signal; observed post-checkpoint in the operator's response"

# Metrics
duration: 12min
completed: 2026-07-03
status: complete
---

# Phase 16 Plan 03: Regression Smoke + T-24h Alert-Surface Checkpoint 1 Summary

**Ran the D-04 manual smoke checklist against the freshly-deployed phase-15 image (get_status/get_journal/get_cot/get_macro over the MCP `/mcp` transport + curl) and found NO new regression — the only two `lastJobRuns` errors are the exact Plan 01 baseline pair, and both self-recovered (each has a later `lastSuccessAt` on the new image). The operator confirmed the live prod web app (dashboard/positions/GEX render) and the T-24h alert-surface wiring — `refreshExpiresIn` present (null, correct) on both apps in the browser's `/api/status` poll and via server curl, with `AuthExpiredBanner` shipping in web@220719f and correctly not rendering outside the window. DEPLOY-04 criteria 2 (checkpoint 1) and 3 (no regression) are met; DEPLOY-04 closes. Two follow-ups recorded (not blockers): the ~2026-07-08 live amber-banner observation and the RTH-bound live-stream check.**

## Performance

- **Duration:** ~12 min (one checkpoint pause for operator web verification)
- **Completed:** 2026-07-03
- **Tasks:** 2 (1 auto smoke + 1 blocking human-verify checkpoint)
- **Files modified:** 1 (this SUMMARY; deploy/ops-only phase, zero source)

## Task 1 — Regression Smoke Checklist (D-04), diffed against the Plan 01 baseline

Run over the morai MCP tools via the stateless `/mcp` streamable-HTTP JSON-RPC transport (`tools/call` with `name`+`arguments`), bearer = Railway `MCP_BEARER_TOKEN` — no morai MCP client was live in-session, so the plan's documented fallback (speak the protocol via curl) was used. The public `/api/status` part was also hit anonymously via curl.

| Check | Tool used | Result |
|-------|-----------|--------|
| **get_status** | `/mcp` get_status + curl `/api/status` | `db: "ok"`; `trader` + `market` both `"fresh"`, `refreshExpiresIn: null` on both (correct, far from T-24h window). |
| **get_journal** | `/mcp` get_journal (open calendar `65aac62e-…`) | 46 snapshots; latest `2026-07-03T19:02:02.031Z` (spot 7498.85, source `cboe`). |
| **get_cot** | `/mcp` get_cot | 26 rows; latest weekly `asOf 2026-06-23`, `publishedAt 2026-07-01T16:48:14Z`, contract `13874A`. |
| **get_macro** | `/mcp` get_macro | 8 FRED/VVIX series present + non-empty: DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS, VVIX (values through 07-01..07-03). |
| **Live-stream (badge + ticking greeks)** | RTH-bound (D-04) | **Deferred** — plan ran at 20:09 UTC / 16:09 ET, just past the 16:00 ET close. |

### Regression judgment vs. Plan 01 baseline (Pitfall 5)

The two pre-existing baseline errors are **excluded** from regression judgment AND have both self-recovered on the new image — the strongest possible outcome:

- **`fetch-schwab-chain`** — `lastErrorAt 2026-07-03T19:31:31Z` (AUTH_EXPIRED, baseline) but **`lastSuccessAt 2026-07-03T20:01:00.913Z`** (later → recovered).
- **`sync-fills`** — `lastErrorAt 2026-07-03T19:51:00Z` (payload error, baseline) but **`lastSuccessAt 2026-07-03T20:10:30Z`** (later → recovered; operator's fresher read).
- `compute-bsm-greeks` (2026-07-01 timeout) and `fetch-rates` (2026-06-30 insert conflict) `lastError`s are stale/pre-existing, unchanged — informational only, not this phase's scope.

**No NEW post-deploy job error on any previously-healthy job.** The `get_journal` latest slot (19:02Z) reflects the analytics chain's cascade timing (`compute-analytics` last success 19:02:34Z) at the RTH close, not the phase-15 deploy — it is the last expected RTH slot, not unbounded staleness. **D-04 criterion 3 (no regression) is met.**

## Task 2 — Web Eyeball + T-24h Alert-Surface Checkpoint 1 (D-02) — OPERATOR CONFIRMED

Operator opened the prod web app and typed "verified", pasting the live `/api/status` poll:

- **Dashboard / positions / GEX charts** — all render ("yup").
- **Alert-surface wiring (checkpoint 1):** the web app's `/api/status` poll carries `tokenFreshness.trader.refreshExpiresIn` and `tokenFreshness.market.refreshExpiresIn` (both `null`), both apps `"fresh"`. The **amber banner correctly does NOT show** (null = outside the T-24h window). `AuthExpiredBanner` ships in the deployed bundle via **web@220719f** (Plan 02).
- **Server-side confirmation:** executor's `curl -s .../api/status | jq '.tokenFreshness'` showed `refreshExpiresIn` present (null) on both apps — matches the browser's polled response.

### Fresher liveness signal from the operator (post-checkpoint, later than the 20:01 executor read)

The full job trigger chain has **recovered and is healthy on the new image** — strengthens the no-regression verdict:

- `fetch-schwab-chain` lastSuccessAt **20:01:00Z** (recovered from the 19:31 AUTH_EXPIRED)
- `snapshot-calendars` lastSuccessAt **20:01:30Z** — **CHAIN fired** (proves the fetch-chain → snapshot-calendars trigger chain works end-to-end on the new image)
- `compute-bsm-greeks` lastSuccessAt **20:01:25Z**
- `sync-fills` lastSuccessAt **20:10:30Z** (recovered from the 19:51 payload error)
- server uptime ~3125s ≈ boot **19:18Z** (matches the Plan 02 deploy)

**D-04 criterion 2 checkpoint 1 (alert surface live on both status surfaces) is met.**

## Scheduled Follow-Ups (recorded, NOT phase blockers)

1. **Checkpoint 2 — live amber banner + warn log (~2026-07-08 T-24h window).** During the real re-auth window (next Schwab refresh-token expiry ~2026-07-09), observe the amber `AuthExpiredBanner` on web + the `refresh-expiry-warner.ts` warn log while running the re-auth runbook (`docs/operations/schwab-reauth-runbook.md`) anyway — the observation is free. Cannot be forced (D-02 rejected forcing a near-expiry token state); this is the deferred half of the two-checkpoint D-02 verification, explicitly NOT a same-day gate.
2. **RTH-bound live-stream check.** Verify the live badge + ticking greeks during the next RTH session — deferred because this plan ran just past the 16:00 ET close and 2026-07-04 is a holiday weekend. Next expected session **~Mon 2026-07-06 ET** (pending standard exchange-calendar confirmation).

## DEPLOY-04 Closure

| Criterion | Status | Evidence |
|-----------|--------|----------|
| 1 — server/worker/web run the phase-15 build | met (Plan 02) | SUCCESS deploys @19:19Z + timestamp correlation past 0c5600f; web@220719f |
| 2 — T-24h alert surface live (checkpoint 1) | **met (this plan)** | refreshExpiresIn key on `/api/status` AND operator-observed web poll; AuthExpiredBanner in bundle |
| 2 — checkpoint 2 (live amber banner) | scheduled follow-up ~07-08 | cannot be forced (D-02) — deferred UAT item, not a gate |
| 3 — no regression (journal/COT/FRED/stream) | **met (this plan)** | smoke checklist clean; both baseline errors self-recovered; live-stream deferred to next RTH |

DEPLOY-04 is closed for phase purposes; checkpoint 2 + the RTH stream check remain open as recorded post-phase follow-ups.

## Task Commits

Both tasks are read-only smoke/verification producing no source artifacts (`files_modified: []`) — no per-task file commits. Task 1 was executed by the agent; Task 2 was an operator-driven web verification. The facts are recorded in this SUMMARY, the single artifact.

1. **Task 1: Regression smoke checklist** — read-only MCP/curl reads. No repo commit.
2. **Task 2: Web eyeball + alert-surface checkpoint 1** — operator-confirmed ("verified"). No repo commit.

**Plan metadata:** committed with this SUMMARY + STATE.md + ROADMAP.md.

## Files Created/Modified
- `.planning/phases/16-deploy-phase-15-image/16-03-SUMMARY.md` — this file (smoke result + alert-surface checkpoint-1 confirmation + two follow-ups).

## Decisions Made
- Used the `/mcp` streamable-HTTP transport via curl (bearer from Railway `MCP_BEARER_TOKEN`) for the four MCP checks — the plan's documented fallback when no MCP client is live; recorded the transport per check.
- Treated the two Plan 01 baseline errors as self-recovered (each has a later `lastSuccessAt`) rather than live failures — the correct regression judgment per Pitfall 5.
- Deferred the RTH live-stream check to the next session (past the ET close + holiday weekend) and recorded checkpoint 2 as a scheduled follow-up — both per D-02/D-04, neither a phase blocker.

## Deviations from Plan

None — plan executed exactly as written. The two pre-existing job errors were correctly excluded from regression judgment and observed to have self-recovered; the RTH stream check and checkpoint 2 were deferred as the plan specifies, not silently dropped.

## Issues Encountered
- None affecting the plan. The `get_journal` latest slot (19:02Z) is the analytics-chain cascade timing at the RTH close, tied to the pre-existing baseline (chain was briefly AUTH_EXPIRED at 19:31 before recovering at 20:01), not a deploy regression.

## User Setup Required
None — no external service configuration introduced by this plan.

## Next Phase Readiness
- **DEPLOY-04 closed** — prod runs the phase-15 build with the T-24h alert surface live and no functional regression. Phase 16 (Deploy Phase-15 Image) is complete; Phase 17 (Overview v2 + IV-calibration fix) builds on this current prod baseline.
- **Open follow-ups carried past phase close:** (1) checkpoint 2 live amber banner + warn log ~2026-07-08 during the real re-auth window; (2) RTH live-stream check ~Mon 2026-07-06.
- **Carried protocol (from Plans 01/02):** never run `railway domain` against the sidecar; every railway command needs explicit `--service`; `railway up` deploy identity proven by createdAt timestamp, not git sha.

## Self-Check: PASSED
- File `.planning/phases/16-deploy-phase-15-image/16-03-SUMMARY.md` created (this file).
- No per-task source commits expected (deploy/ops-only, `files_modified: []`) — nothing to grep-verify in git log beyond the metadata commit.

---
*Phase: 16-deploy-phase-15-image*
*Completed: 2026-07-03*
