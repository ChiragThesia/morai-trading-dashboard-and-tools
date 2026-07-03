---
phase: 16-deploy-phase-15-image
plan: 02
subsystem: infra
tags: [railway, vercel, deploy, force-deploy, build-proof, timestamp-correlation, deploy-04]

# Dependency graph
requires:
  - phase: 16-deploy-phase-15-image
    plan: 01
    provides: pre-deploy baseline (stale server/worker at 21:27Z, web 220719f @ 22:12Z), GW-05 restored, deploy target sha 7a710b9, two known job errors baselined
provides:
  - Server + worker in prod running the phase-15 tip (fresh SUCCESS deploys created 2026-07-03T19:19Z, AFTER 0c5600f/IN-06 commit)
  - Build-proof block (refreshExpiresIn key-presence + deploy-timestamp correlation + worker-liveness + access-control spot-check)
  - Web-current confirmation (220719f via timestamp correlation; dashboard Source-panel sha deferred to Plan 03 operator checkpoint)
affects: [16-03 smoke+alert-surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "railway up deploy identity proven by createdAt timestamp correlation (commitHash null on CLI deploys), not a git sha — Pitfall 1"
    - "Worker liveness judged by CRON jobs firing post-deploy (fetch-schwab-chain, sync-fills); chain-triggered + on-demand jobs correctly stay idle and are NOT liveness signals"

key-files:
  created:
    - .planning/phases/16-deploy-phase-15-image/16-02-SUMMARY.md
  modified: []

key-decisions:
  - "Deployed server first then worker (Claude's discretion per D-03; no migration in play) so /api/status healthcheck was available sooner for Task 2"
  - "Web NOT redeployed — no evidence prod web is pre-phase-15; 22:12Z prod deploy correlates to 220719f. Definitive dashboard Source-panel sha confirmation deferred to Plan 03 operator web checkpoint (Vercel CLI JSON omits git sha, Open Q1)"
  - "Worker liveness judged by cron jobs (fetch-schwab-chain @19:31Z, sync-fills @19:51Z fired on the new image); chain-triggered jobs stay idle because fetch-schwab-chain is AUTH_EXPIRED (pre-existing baseline), which is expected, not a regression"

requirements-completed: []  # DEPLOY-04 spans the whole phase; criterion 1 met here, requirement closed by Plan 03

coverage:
  - id: DP1
    description: "Server + worker force-deployed to phase-15 tip; both most-recent deployments SUCCESS with createdAt >= DEPLOY_TIME_UTC (19:19:07Z), prior 21:27 builds REMOVED"
    requirement: "DEPLOY-04"
    verification:
      - kind: integration
        ref: "railway up --service server/worker; railway deployment list --json --limit 1 → status SUCCESS, createdAt 19:19:11.745Z (server) / 19:19:20.184Z (worker)"
        status: pass
    human_judgment: false
  - id: DP2
    description: "Build-proof: refreshExpiresIn key present on tokenFreshness.trader AND .market (value null, correct far from T-24h); deploy createdAt (19:19Z) after 0c5600f (2026-07-03T02:41:25Z) → IN-06 alert fix now in prod"
    requirement: "DEPLOY-04"
    verification:
      - kind: integration
        ref: "curl /api/status | jq has(refreshExpiresIn) → true/true; timestamp correlation 19:19Z > 02:41:25Z"
        status: pass
    human_judgment: false
  - id: DP3
    description: "Worker liveness: cron jobs fired on the new image post-deploy (fetch-schwab-chain @19:31:31Z, sync-fills @19:51:00Z); worker boot log @19:20:30Z 'pg-boss started; 10 queues created, 6 jobs scheduled'"
    requirement: "DEPLOY-04"
    verification:
      - kind: integration
        ref: "curl /api/status | jq .lastJobRuns lastErrorAt advancing past DEPLOY_TIME_UTC; Railway GraphQL deploymentLogs boot line"
        status: pass
    human_judgment: false
  - id: DP4
    description: "Access-control not regressed: /api/status → 200 unauthenticated (healthcheck stays public); /api/jobs → 401 unauthenticated (bearer group intact)"
    requirement: "DEPLOY-04"
    verification:
      - kind: integration
        ref: "curl -o /dev/null -w %{http_code}: /api/status=200, /api/jobs=401"
        status: pass
    human_judgment: false
  - id: DP5
    description: "Web confirmed current (220719f) via prod-deploy timestamp correlation (22:12Z); definitive dashboard Source-panel sha deferred to Plan 03; sidecar untouched"
    requirement: "DEPLOY-04"
    verification:
      - kind: manual_procedural
        ref: "vercel ls / inspect → newest prod READY @ 2026-07-02T22:12:01Z; dashboard Source-panel sha confirmation deferred to Plan 03 operator checkpoint"
        status: partial
    human_judgment: true
    rationale: "Vercel CLI JSON exposes no git-sha field (Open Question 1); timestamp correlation is strong evidence but the authoritative sha read is a dashboard-only operator action, scheduled in Plan 03"

# Metrics
duration: 20min
completed: 2026-07-03
status: complete
---

# Phase 16 Plan 02: Deploy Phase-15 Image + Build-Proof Summary

**Force-deployed the stale server + worker to the phase-15 tip via `railway up --service` (git push SKIPs them) — both landed fresh SUCCESS at 2026-07-03T19:19Z, AFTER the last phase-15 commit 0c5600f (IN-06 alert-copy fix), so timestamp correlation proves the stale-image gap is closed. Verified refreshExpiresIn key-presence on both apps, worker liveness via cron jobs firing on the new image, and access-control intact; web confirmed current at 220719f by timestamp with the dashboard sha read deferred to Plan 03. Sidecar untouched.**

## Performance

- **Duration:** ~20 min
- **DEPLOY_TIME_UTC (captured before deploy):** `2026-07-03T19:19:07Z`
- **Completed:** 2026-07-03
- **Tasks:** 2 (both auto; deploy/ops-only, zero source files)
- **Files modified:** 1 (this SUMMARY)

## Deploy-Proof Block

### Deploys (Task 1)

| Service | Status | createdAt | Prior build |
|---------|--------|-----------|-------------|
| **server** | **SUCCESS** | **2026-07-03T19:19:11.745Z** | 21:27:46Z build now REMOVED |
| **worker** | **SUCCESS** | **2026-07-03T19:19:20.184Z** | 21:27:52Z build now REMOVED |

- Both `createdAt` (19:19Z) are AFTER `DEPLOY_TIME_UTC` (19:19:07Z) — fresh deploys, not stale/skipped.
- Both `createdAt` (19:19Z) are AFTER `0c5600f` (2026-07-03T02:41:25Z, the IN-06 alert-copy fix and last phase-15 commit) → **the IN-06 fix is now in prod**. `railway up` deploys carry `commitHash: null` (Pitfall 1), so this **timestamp correlation is the proof of record**, not a git sha.
- Worker boot log @ 2026-07-03T19:20:30Z (Railway GraphQL deploymentLogs): `"pg-boss started; 10 queues created, 6 jobs scheduled"` — clean start; migrations an idempotent no-op (0013 already applied).
- Deploy order: server first (Claude's discretion, D-03; no migration in play) so its `/api/status` healthcheck was available sooner for Task 2. The server healthcheck (GET /api/status, 60s, ×5) gates its own cutover — a SUCCESS server deploy implies /api/status passed.

### Build marker — key-presence (Task 2, necessary)

```
curl /api/status | jq → { db: "ok",
  trader_key: true, market_key: true,   # has("refreshExpiresIn") on both apps
  trader_val: null, market_val: null }  # null is CORRECT — far from the T-24h window
```

`refreshExpiresIn` is present on both `tokenFreshness.trader` and `tokenFreshness.market`. The value is `null` today (far from the T-24h re-auth window) — that is the correct wire shape (a required key, null-when-far, never omitted), not a failure. Key-presence alone is **necessary but not sufficient** (the key predates the IN-06 fix, Pitfall 3) — which is why the timestamp correlation above is the real proof.

### Worker liveness (Task 2, proves the new image is RUNNING)

Cron jobs that fired on the NEW image, post-19:19Z deploy:
- `fetch-schwab-chain` cron executed @ **2026-07-03T19:31:31Z** (`lastErrorAt`) — failed `AUTH_EXPIRED`
- `sync-fills` cron executed @ **2026-07-03T19:51:00Z** (`lastErrorAt`) — failed the payload error

Both failures are the **two PRE-EXISTING baseline errors from Plan 01** (`fetch-schwab-chain` AUTH_EXPIRED, `sync-fills` "expected object, received null") — **NOT new regressions**. That the crons *ran at all* after 19:19Z proves the worker is live on the new image.

**Nuance (per the worker boot log / `schedule.ts`):** liveness is judged by CRON jobs only. `snapshot-calendars`, `compute-analytics`, `compute-gex-snapshot` are **chain-triggered only** (off `fetch-schwab-chain` success), `rebuild-journal` is on-demand, and `refresh-tokens` is **RETIRED** (GW-03 — sidecar is the sole token writer). Because `fetch-schwab-chain` is `AUTH_EXPIRED` (pre-existing), the chain-triggered jobs correctly stay idle — expected baseline state, **NOT a deploy regression**.

### Access-control spot-check (Task 2, V4 ASVS / T-16-05)

| Route | Unauthenticated result | Expected |
|-------|------------------------|----------|
| `/api/status` | **200** | 200 (healthcheck stays public) |
| `/api/jobs` | **401** `{"error":"Unauthorized"}` | 401 (MCP bearer group intact) |

The redeploy did not reorder middleware or expose a protected route.

### Web (Task 1 — verify-only, not redeployed)

- Newest Vercel production deployment: `morai-gu95vkfcc-projects-9dcb446e.vercel.app`, target=production, **READY**, created **2026-07-02T22:12:01Z** — correlates to the `220719f` push (all phase-15 web code incl. `AuthExpiredBanner`).
- Vercel CLI JSON exposes **no git-sha field** (Open Question 1). Timestamp correlation is strong evidence web is current; the **definitive dashboard "Source" panel sha read is DEFERRED to Plan 03's operator web checkpoint**.
- **Web was NOT redeployed** — no evidence prod web is pre-phase-15.

### Sidecar

- **Untouched.** No `railway up` and no `railway domain` against sidecar (GW-05 protocol from Plan 01 honored). Every railway command passed explicit `--service server` / `--service worker`.

## Task Commits

Both tasks are deploy/ops actions producing no source artifacts (`files_modified: []`) — no per-task file commits. The proof facts are recorded in this SUMMARY, which is the single artifact.

1. **Task 1: Force-deploy stale services + verify web** — `railway up --service server`, `railway up --service worker`; both SUCCESS @ 19:19Z; web verify-only. No repo commit.
2. **Task 2: Build-proof (key-presence + timestamp correlation + liveness + access-control)** — read-only /api/status + railway deployment list. No repo commit.

**Plan metadata:** committed with this SUMMARY + STATE.md + ROADMAP.md.

## Files Created/Modified
- `.planning/phases/16-deploy-phase-15-image/16-02-SUMMARY.md` — this file.

## Decisions Made
- Deployed server before worker (D-03 discretion; no migration in play) for earlier healthcheck availability.
- Web verify-only — the 22:12Z prod deploy correlating to 220719f is sufficient evidence not to redeploy; the authoritative dashboard sha read is deferred to Plan 03.
- Worker liveness judged by cron jobs; chain-triggered/on-demand/retired jobs staying idle is expected baseline, not a regression.

## Deviations from Plan

None — plan executed exactly as written. The `railway up` deploys, the build-proof checks, and the web verify-only path all followed the plan and RESEARCH pitfalls. The two pre-existing job errors (`fetch-schwab-chain` AUTH_EXPIRED, `sync-fills` null-payload) were correctly excluded from regression judgment per the Plan 01 baseline.

## Issues Encountered
- None affecting the plan. The two pre-existing prod job errors persist unchanged (out of this phase's scope, Pitfall 5). Worker-liveness confirmation on the chain-triggered analytics jobs was not observable in-window because their trigger (`fetch-schwab-chain`) is `AUTH_EXPIRED` — expected; liveness was proven via the cron jobs instead.

## User Setup Required
None — no external service configuration introduced by this plan.

## Next Phase Readiness
- **Plan 03 (smoke + alert-surface) is unblocked.** Server + worker provably run the phase-15 build (DEPLOY-04 criterion 1 met via fresh SUCCESS deploys + timestamp correlation). 
- **Carried for Plan 03:** confirm the web live prod deployment's commit sha via the Vercel dashboard "Source" panel (deferred from here — CLI omits sha); expected `220719f`.
- **Baseline (still excluded from regression judgment):** `fetch-schwab-chain` AUTH_EXPIRED, `sync-fills` null-payload.
- **Carried protocol:** never run `railway domain` against sidecar; every railway command needs explicit `--service`.

## Self-Check: PASSED
- File `.planning/phases/16-deploy-phase-15-image/16-02-SUMMARY.md` created (this file).
- Deploys verified live via `railway deployment list --json` (server SUCCESS @19:19:11.745Z, worker SUCCESS @19:19:20.184Z).
- No per-task commits expected (deploy/ops-only, `files_modified: []`) — nothing to grep-verify in git log beyond the metadata commit.

---
*Phase: 16-deploy-phase-15-image*
*Completed: 2026-07-03*
