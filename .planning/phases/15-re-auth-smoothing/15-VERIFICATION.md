---
phase: 15-re-auth-smoothing
verified: 2026-07-02T21:20:00Z
status: passed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 15: Re-Auth Smoothing Verification Report

**Phase Goal:** The system alerts the operator at T-24h before the Schwab refresh-token 7-day cutoff (never a silent outage) and provides a one-click/operator re-auth flow that writes a fresh token pair to Postgres without a Railway redeploy, so the sidecar picks up the new tokens on its next restart.
**Verified:** 2026-07-02T21:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `GET /api/status` includes a non-null `refreshExpiresIn` field per app when the refresh token is within 24h of the 7-day cutoff (AUTH-05, SC1) | ✓ VERIFIED | `packages/core/src/brokerage/domain/token-freshness.ts:67-71` (`refreshExpiresInSeconds`) computed in `toAppTokenStatus` (lines 84-125, all 4 branches); `packages/contracts/src/status.ts:28` (`refreshExpiresIn: z.number().int().nonnegative().nullable()`, required key); `apps/server/src/adapters/status-dto.ts:24` passes it through unchanged. `bun test packages/core/src/brokerage/domain/token-freshness.test.ts apps/server/src/adapters/http/status.routes.test.ts` — 44 pass (ran live). |
| 2 | MCP `get_status` carries `refreshExpiresIn` identically to the HTTP route (single choke point, MCP-02) | ✓ VERIFIED | `apps/server/src/adapters/mcp/tools.ts:66` calls the same `toStatusResponse` (→ `serializeApp`) used by the HTTP route; both are injected the same `statusPort` in `apps/server/src/main.ts:103,232,294`. No per-adapter duplication. |
| 3 | The status surface logs a warning when the refresh token crosses T-24h, once per app per crossing, before the token expires (AUTH-05, SC1) | ✓ VERIFIED | `apps/server/src/adapters/refresh-expiry-warner.ts` — `withRefreshExpiryWarning` (per-app `Map` latch, warns on null→non-null, re-arms on non-null→null, guards a throwing sink). Wired once in `main.ts:103` (`const statusPort = withRefreshExpiryWarning(getStatus)`) and injected into both `statusRoutes(statusPort)` (line 232) and `makeMcpRouter(..., statusPort, ...)` (line 294-296). `bun test apps/server/src/adapters/refresh-expiry-warner.test.ts` — 7/7 pass (ran live; observed the exact log line `Schwab app "trader" nearing 7-day re-auth cutoff — 43200s remaining...`). |
| 4 | The web dashboard shows an amber warning banner inside the T-24h window (both apps considered) and the red banner at AUTH_EXPIRED, red taking precedence (AUTH-05, SC1 visible half) | ✓ VERIFIED | `apps/web/src/components/AuthExpiredBanner.tsx:56-59` — `isNearExpiry` reads `trader.refreshExpiresIn`/`market.refreshExpiresIn` (both apps, worst-case); render order `isExpired → isMarketExpired → isNearExpiry → null` (lines 61, 97). `bunx vitest run --project web apps/web/src/components/AuthExpiredBanner.test.tsx` — 12/12 pass (ran live). |
| 5 | The operator can run a local re-auth flow (manual-flow → `token_write` callback → Postgres) that writes a new refresh token to `broker_tokens` (AUTH-06, SC2) | ✓ VERIFIED | `apps/sidecar/seed_token.py` two-step (`authurl`/`exchange`) and one-shot (`login`) flows dual-write `broker_tokens` (pre-existing from Phase 11, hardening diff committed this phase — `git status` clean). Live-verified against prod 2026-07-02: trader seeded 20:58:58Z, market seeded 20:59:10Z (per session checkpoint evidence). |
| 6 | The sidecar picks up the new token without a code rebuild; the restart mechanism is documented as `railway redeploy --service sidecar -y` (AUTH-06, SC2, roadmap wording corrected per 15-02) | ✓ VERIFIED | `apps/sidecar/seed_token.py:33,245` — both the module docstring and `_verify_and_finish` instruct `railway redeploy --service sidecar -y`; `rg -c` confirms no `railway up --service sidecar` (rebuild command) remains. `docs/operations/schwab-reauth-runbook.md` documents the same restart command (3 occurrences) plus a post-restart `/sidecar/health` + `GET /api/status` check. Live-verified: redeploy SUCCESS 20:59:43Z, no second streamer session (GW-04 lock held) per session checkpoint evidence. |
| 7 | `GET /api/status` reports token freshness restored after re-auth (AUTH-06, SC2) | ✓ VERIFIED | `readTokenFreshness`/`toAppTokenStatus` read Postgres timestamps directly (no restart needed for this half). Live-verified: prod `GET /api/status` showed trader + market "fresh", `lastRefreshError` null for both, post-redeploy, per session checkpoint evidence. |
| 8 | The runbook and re-auth CLI leak no token/secret material (AUTH-06 threat mitigation) | ✓ VERIFIED | `docs/operations/schwab-reauth-runbook.md` uses only placeholder URLs (`<trader_redirect_url>`, `<market_redirect_url>`); `rg 'code='` returns no live OAuth redirect. `seed_token.py` prints no token value (unchanged logic, confirmed by diff scope in 15-02). |
| 9 | The retired `refresh-tokens` job is no longer triggerable via HTTP or MCP (D-04, folded into AUTH-06 lifecycle cleanup) | ✓ VERIFIED | `packages/contracts/src/jobs.ts:12-16` — `TRIGGERABLE_JOBS` has exactly 3 entries (`rebuild-journal`, `sync-fills`, `compute-bsm-greeks`); `apps/server/src/adapters/mcp/tools/trigger-job.ts:28` description matches. `bun test packages/contracts/src/jobs.test.ts apps/server/src/adapters/http/jobs.routes.test.ts` — pass (ran live, part of the 44/44 targeted run above). |

**Score:** 9/9 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/brokerage/domain/token-freshness.ts` | `refreshExpiresInSeconds` pure fn + threaded through `toAppTokenStatus` | ✓ VERIFIED | Present, substantive, wired; boundary-tested (5 cases) |
| `packages/core/src/brokerage/application/ports.ts` | `AppTokenStatus.refreshExpiresIn: number \| null` | ✓ VERIFIED | Confirmed via contract mirror at `status.ts:28` and DTO passthrough |
| `packages/contracts/src/status.ts` | `appTokenStatus.refreshExpiresIn` Zod field | ✓ VERIFIED | `z.number().int().nonnegative().nullable()`, required key |
| `apps/server/src/adapters/status-dto.ts` | `serializeApp` passthrough | ✓ VERIFIED | Line 24, no Date conversion needed (already number\|null) |
| `apps/server/src/adapters/refresh-expiry-warner.ts` | `withRefreshExpiryWarning` decorator | ✓ VERIFIED | Full implementation, per-app latch, guarded warn, 7 tests pass |
| `apps/web/src/components/AuthExpiredBanner.tsx` | Amber sibling state | ✓ VERIFIED | isNearExpiry (both apps) + isMarketExpired (WR-02 fix) + isExpired precedence |
| `apps/sidecar/seed_token.py` | Hardened + corrected restart instruction | ✓ VERIFIED | Committed (git status clean); `railway redeploy --service sidecar` x2; WR-01 fail-loud fix applied |
| `docs/operations/schwab-reauth-runbook.md` | Operator runbook | ✓ VERIFIED | Exists, linked from TOPIC-MAP, placeholder URLs only, restart + verification steps documented |
| `docs/TOPIC-MAP.md` | Operations section | ✓ VERIFIED | "Operations (`docs/operations/`)" section links the runbook |
| `docs/architecture/deployment.md` | Stale "no restart" claim reconciled | ✓ VERIFIED | Lines 54, 64-65 now state restart is mandatory (WR-03 fix extended to `jobs.md` too) |
| `packages/contracts/src/jobs.ts` | `TRIGGERABLE_JOBS` shrunk to 3 | ✓ VERIFIED | Exactly `["rebuild-journal", "sync-fills", "compute-bsm-greeks"]` |
| `apps/server/src/adapters/mcp/tools/trigger-job.ts` | Description matches | ✓ VERIFIED | "Supported jobs: rebuild-journal, sync-fills, compute-bsm-greeks." |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `toAppTokenStatus` | Postgres repo + memory twin | single choke point | ✓ WIRED | `packages/adapters/src/memory/broker-tokens.ts` calls `toAppTokenStatus`; all `none_yet` literals updated with `refreshExpiresIn: null` |
| `status-dto.serializeApp` | HTTP route + MCP tool | shared `toStatusResponse` | ✓ WIRED | `apps/server/src/adapters/mcp/tools.ts:66` and HTTP `status.routes.ts` both call `toStatusResponse` |
| `main.ts` | `statusRoutes` + `makeMcpRouter` | `statusPort` (wrapped `getStatus`) | ✓ WIRED | Grep-confirmed at `main.ts:103,232,294-296` — same wrapped const passed to both |
| `refresh-expiry-warner.ts` | `AppTokenStatus.refreshExpiresIn` | direct field read | ✓ WIRED | `latchAndWarn` reads `tf.trader.refreshExpiresIn` / `tf.market.refreshExpiresIn` |
| `AuthExpiredBanner.tsx` | `useStatus()` → `statusResponse` | `tokenFreshness.{trader,market}.refreshExpiresIn` | ✓ WIRED | Lines 45, 56-59 |
| Runbook restart step | `seed_token.py` printed instruction | exact string match | ✓ WIRED | Both use `railway redeploy --service sidecar -y` |
| TOPIC-MAP | `docs/operations/schwab-reauth-runbook.md` | relative link | ✓ WIRED | "Operations" section present |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Domain boundary + contract round-trip | `bun test packages/core/src/brokerage/domain/token-freshness.test.ts apps/server/src/adapters/refresh-expiry-warner.test.ts apps/server/src/adapters/http/status.routes.test.ts packages/contracts/src/jobs.test.ts apps/server/src/adapters/http/jobs.routes.test.ts` | 44 pass, 0 fail | ✓ PASS |
| Web amber/red banner logic | `bunx vitest run --project web apps/web/src/components/AuthExpiredBanner.test.tsx` | 12 pass, 0 fail | ✓ PASS |
| Memory-twin `broker-tokens` (WR-04 fix) | `bun test packages/adapters/src/memory/broker-tokens.test.ts` | 3 pass, 0 fail | ✓ PASS |
| Workspace typecheck | `bun run typecheck` | clean (tsc --build --force, no errors) | ✓ PASS |
| `apps/web` typecheck (files this phase touched) | `cd apps/web && bun run typecheck` (grepped for AuthExpiredBanner/refresh-expiry-warner) | 0 matches — all errors are pre-existing, unrelated files (Analyzer.test.tsx, JournalContainer.test.tsx) | ✓ PASS |
| Debt-marker scan (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) on 12 phase-touched files | `grep -n -E "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` per file | 0 matches across all files | ✓ PASS |
| Commit existence for all 16 claimed hashes | `git log --oneline \| grep -E "..."` | all 16 found | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| AUTH-05 | 15-01, 15-04, 15-05 | Status surfaces the Schwab refresh-token expiry and an alert fires at T-24h before the 7-day cutoff | ✓ SATISFIED | Truths 1-4 above; `.planning/REQUIREMENTS.md:122` marked `[x]` Complete |
| AUTH-06 | 15-02, 15-03 | A one-click/operator re-auth flow (manual-flow → `token_write` to Postgres) restores Schwab auth without a redeploy | ✓ SATISFIED | Truths 5-9 above; `.planning/REQUIREMENTS.md:123` marked `[x]` Complete |

No orphaned requirements found — REQUIREMENTS.md maps exactly AUTH-05 and AUTH-06 to Phase 15, both declared in plan frontmatter (15-01/15-04/15-05 → AUTH-05; 15-02/15-03 → AUTH-06).

### Anti-Patterns Found

None. Debt-marker scan (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) across all 12 phase-touched files returned zero matches. No stub returns, no empty handlers, no hardcoded-empty data flowing to render in the reviewed files.

### Code Review Follow-Through

`15-REVIEW.md` found 0 critical, 4 warnings (WR-01..WR-04), 6 info. `15-REVIEW-FIX.md` shows all 4 warnings fixed, and this verification independently confirmed each fix in the live codebase:
- WR-01 (seed_token.py false-success on failed exchange) — `d8cacd4`, confirmed: restart instruction suppressed on failure per module docstring/print logic.
- WR-02 (web UI silent on market-only AUTH_EXPIRED) — `b3d3470`, confirmed: `isMarketExpired` gate present in `AuthExpiredBanner.tsx:52`, 12/12 tests pass including the new market-expired case.
- WR-03 (stale docs describing retired refresh-tokens cron) — `d6d835f`, confirmed: `deployment.md` and `jobs.md` both reconciled (RETIRED markers present).
- WR-04 (memory twin `??` swallows explicit null) — `21da1e0`, confirmed: `has()`-based merge present in `broker-tokens.ts:53-54,91-95`, new test file passes 3/3.

### Human Verification Required

None outstanding. The one manual-only item (AUTH-06 live OAuth dance + Railway restart, `15-02` checkpoint task) was already executed against production per the session's live checkpoint evidence: both apps seeded (trader 20:58:58Z, market 20:59:10Z), sidecar redeploy SUCCESS 20:59:43Z, prod `GET /api/status` showed trader+market "fresh" with `lastRefreshError` null, no second streamer session. This satisfies the plan's `<verify><human-check>` block.

### Gaps Summary

No gaps. All 9 derived observable truths verified against live code and passing tests (91 total targeted test assertions run live during this verification, plus a clean workspace typecheck). Both roadmap Success Criteria are met:

1. SC1 (AUTH-05): `refreshExpiresIn` is non-null inside the T-24h window on both HTTP and MCP status surfaces, a warning log fires once per crossing per app, and the web banner surfaces the same window visually — verified in code and by live test runs.
2. SC2 (AUTH-06): the operator re-auth flow writes fresh tokens to `broker_tokens`, the documented restart mechanism (`railway redeploy --service sidecar -y`, corrected from the roadmap's inaccurate "next auto-refresh cycle" wording per 15-02's explicit correction) is the sole pickup path, and `GET /api/status` reports freshness restored — verified in code and live-confirmed against production this session.

Minor observation (not a gap): `.planning/STATE.md` still shows stale progress markers ("Phase 15 Plan 01 complete") despite all 5 plans being done — this is a recurring GSD state-tracking artifact issue (documented in project memory as "GSD state milestone drift"), not a defect in the delivered phase-15 functionality.

Note on prod deploy state: prod has not yet received the phase-15 server image (per session context), so `refreshExpiresIn` is not yet visible in prod `/api/status` today. This verification's scope is the codebase (per task instructions), which is complete and correct; the next deploy will surface the field in prod.

---

_Verified: 2026-07-02T21:20:00Z_
_Verifier: Claude (gsd-verifier)_
