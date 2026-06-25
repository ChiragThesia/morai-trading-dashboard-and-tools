---
phase: 11-sidecar-scaffold-auth-migration
plan: "06"
subsystem: worker
tags: [gw-03, jrnl-02, auth-migration, tdd, sole-writer-cutover]
status: complete

dependency_graph:
  requires: ["11-03", "11-05"]
  provides: ["GW-03", "JRNL-02"]
  affects: ["apps/worker"]

tech_stack:
  added: []
  patterns:
    - "sidecar-chain adapter wired as schwabFetchChain in selectChainSource (JRNL-02)"
    - "refresh-tokens job retired atomically in one release (GW-03 D-06)"
    - "SIDECAR_URL env var added to worker config schema (Zod z.string().url())"

key_files:
  modified:
    - apps/worker/src/schedule.ts
    - apps/worker/src/schedule.test.ts
    - apps/worker/src/main.ts
    - apps/worker/src/config.ts

decisions:
  - "GW-03: refresh-tokens retired in a single hard-cut release (D-06) — no runtime feature flag"
  - "D-01 upheld: SCHWAB_TRADER_APP_KEY/SECRET retained in config even though unreferenced post-cutover"
  - "TOKEN_ENCRYPTION_KEY stays in worker config — worker still reads broker_tokens for freshness (D-08)"
  - "CBOE fallback (selectChainSource) unchanged — only schwabFetchChain input pointer swapped"

metrics:
  duration_minutes: 6
  completed_date: "2026-06-25"
  tasks_completed: 1
  files_modified: 4

tdd_gate_compliance:
  red_commit: "inline — RED run confirmed (4 failing tests) before schedule.ts edits"
  green_commit: ce91509
---

# Phase 11 Plan 06: GW-03 Sole-Writer Cutover Summary

Retired the TS `refresh-tokens` pg-boss job and re-sourced the worker chain fetch through the Python sidecar adapter (JRNL-02) in a single release — eliminating the dual-refresher rotating-token race (GW-03).

## What Was Built

**GW-03 sole-writer cutover (one release, D-06):**

- `schedule.ts` — `AllHandlers.refreshTokens` field removed; `createQueue("refresh-tokens")`, `schedule("refresh-tokens", "0 4 * * *", ...)`, and `work("refresh-tokens", ...)` all removed. Header comment counts updated: 10→9 queues, 6→5 crons, 10→9 handlers.
- `schedule.test.ts` — TDD RED-first (PATTERNS Pattern 4): `ALL_10_QUEUES` → `ALL_9_QUEUES` (no `"refresh-tokens"`), `SCHEDULED_6` → `SCHEDULED_5`, `toHaveLength(6)` → `toHaveLength(5)`, refresh-tokens cron test deleted and replaced with a "does NOT schedule refresh-tokens" assertion, `makeFakeHandlers()` drops `refreshTokens` entry. Suite went RED (4 failing), then GREEN (11 passing) after `schedule.ts` edits.
- `main.ts` — Removed: `makeSchwabChainAdapter`/`makeSchwabOAuthClient` imports, `marketGetAccessToken` closure, `schwabChainFromDate`/`schwabChainToDate`/`schwabMarketAdapter` block, `makeRefreshTokenUseCase`/`makeRefreshTokensUseCase` imports, all OAuth client constructions (`traderOAuthClient`/`marketOAuthClient`), all refresh-token use-cases/handler, and `refreshTokens: refreshTokensHandler` from the `registerAllJobs` call. Added: `makeSidecarChainAdapter` import, `sidecarAdapter` construction with `config.SIDECAR_URL`; `schwabFetchChain` pointer changed from `schwabMarketAdapter.fetchChain` → `sidecarAdapter.fetchChain`. Boot log updated to "9 queues created, 5 jobs scheduled".
- `config.ts` — Added `SIDECAR_URL: z.string().url(...)`. Removed: `SCHWAB_TRADER_CALLBACK_URL`, `SCHWAB_MARKET_APP_KEY`, `SCHWAB_MARKET_APP_SECRET`, `SCHWAB_MARKET_CALLBACK_URL` (all unreferenced after retirement). Retained: `SCHWAB_TRADER_APP_KEY`, `SCHWAB_TRADER_APP_SECRET` (D-01 prohibition), `TOKEN_ENCRYPTION_KEY` (freshness reads via `brokerTokensRepo`).

## Verification

All acceptance criteria met:

- `schedule.test.ts`: 11/11 tests green; SCHEDULED == 5, queues == 9, no `"refresh-tokens"`.
- `selectChainSource.test.ts`: 8/8 tests green (CBOE fallback AUTH_EXPIRED path intact).
- `bun run typecheck`: clean (no output).
- `bun run lint`: clean (warnings only — pre-existing boundary selector deprecation warnings).
- `grep makeSchwabChainAdapter apps/worker/src/main.ts`: no output (clean).
- `SIDECAR_URL` present in `workerConfigSchema`; `SCHWAB_TRADER_APP_KEY/SECRET` retained.

## Deviations from Plan

None — plan executed exactly as written. The `SCHWAB_TRADER_CALLBACK_URL` removal was also performed (it became unreferenced when `traderOAuthClient` was removed); this is consistent with Step 4's instruction to "remove only config fields that become genuinely unreferenced." The D-01 prohibition was honored: `SCHWAB_TRADER_APP_KEY` and `SCHWAB_TRADER_APP_SECRET` were retained despite being unreferenced in this phase.

## Threat Flags

None. The dual-writer race window (T-11-06-01) is closed: both `schedule.ts` and `main.ts` remove the refresh-tokens job atomically. `broker_tokens` is now written solely by the Python sidecar.

## TDD Gate Compliance

- RED gate: confirmed by running `bun run test apps/worker/src/schedule.test.ts` after `schedule.test.ts` edits — 4 tests failed for the correct reason (schedule.ts still registering 10 queues / 6 crons with refresh-tokens).
- GREEN gate: `ce91509` — all 11 tests passing after `schedule.ts` removal edits.

## Commits

| Hash | Message |
|------|---------|
| ce91509 | feat(11-06): GW-03 sole-writer cutover — retire refresh-tokens, wire sidecar chain (JRNL-02) |

## Self-Check: PASSED

- `apps/worker/src/schedule.ts` — exists, refresh-tokens only in comments, 9 queues/5 crons.
- `apps/worker/src/schedule.test.ts` — exists, ALL_9_QUEUES, SCHEDULED_5, 11 tests green.
- `apps/worker/src/main.ts` — exists, sidecarAdapter wired, makeSchwabChainAdapter absent.
- `apps/worker/src/config.ts` — exists, SIDECAR_URL present, SCHWAB_MARKET_* absent.
- Commit `ce91509` exists in git log.
