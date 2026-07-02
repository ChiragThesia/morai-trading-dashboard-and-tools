---
phase: 15-re-auth-smoothing
plan: 04
subsystem: auth
tags: [schwab-oauth, status-endpoint, mcp, logging, decorator-pattern]

# Dependency graph
requires:
  - phase: 15-01
    provides: "refreshExpiresIn field on AppTokenStatus/TokenFreshnessMap (computed by toAppTokenStatus, non-null only inside the T-24h window)"
provides:
  - "withRefreshExpiryWarning: a ForGettingStatus decorator that logs a single warning line per app per T-24h crossing"
  - "single composition-root choke point (main.ts statusPort) shared by GET /api/status and MCP get_status"
affects: [15-05, auth, status-endpoint, mcp-get-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ForVerbingNoun decorator pattern: a driving-port decorator (ForGettingStatus -> ForGettingStatus) that adds a side effect without changing the payload, wired once at the composition root instead of duplicated per adapter"
    - "In-process per-app latch (Map<AppId, boolean>) for dedup-on-transition logging (fires on null->non-null, re-arms on non-null->null)"

key-files:
  created:
    - apps/server/src/adapters/refresh-expiry-warner.ts
    - apps/server/src/adapters/refresh-expiry-warner.test.ts
  modified:
    - apps/server/src/main.ts

key-decisions:
  - "Dedup semantics: log only on the null->non-null transition (first crossing), stay silent while latched, re-arm on return to null — matches D-03 'first crosses T-24h' precisely and avoids spamming on every 30s poll"
  - "Warning message avoids the literal word 'token' entirely (uses 'app', 'cutoff', 'expiry') to satisfy the no-secret-shaped-material discipline even though the plan only required no token VALUE — the word itself was excluded by the test to keep the log line unambiguously non-sensitive"
  - "Single composition-root wiring: getStatus wrapped once into statusPort in main.ts, injected into both statusRoutes and makeMcpRouter — no logging logic duplicated into status.routes.ts or the MCP tool"

patterns-established:
  - "Pattern: driving-port decorators for cross-cutting side effects (warning logs, future audit logs) belong in apps/server/src/adapters/ and are wired once at the composition root, never inside route/tool files"

requirements-completed: [AUTH-05]

coverage:
  - id: D1
    description: "withRefreshExpiryWarning decorator logs exactly one warning per app per T-24h crossing (null->non-null), stays silent while latched, re-arms after return to null, tracks trader/market independently, never fires on 'none yet'"
    requirement: AUTH-05
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/refresh-expiry-warner.test.ts#withRefreshExpiryWarning warns once on null->non-null, not again while latched, again after re-arm (trader)"
        status: pass
      - kind: unit
        ref: "apps/server/src/adapters/refresh-expiry-warner.test.ts#withRefreshExpiryWarning tracks trader and market independently — trader crossing does not suppress market"
        status: pass
      - kind: unit
        ref: "apps/server/src/adapters/refresh-expiry-warner.test.ts#withRefreshExpiryWarning never warns when tokenFreshness is 'none yet'"
        status: pass
    human_judgment: false
  - id: D2
    description: "Warn message contains appId + seconds remaining and never contains 'token'/'refresh_token' substrings (no-secret-in-logs discipline, T-15-09); decorator is a pure passthrough and a throwing warn sink cannot break the response (T-15-11)"
    requirement: AUTH-05
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/refresh-expiry-warner.test.ts#withRefreshExpiryWarning warn message contains appId and seconds, never token/refresh_token material"
        status: pass
      - kind: unit
        ref: "apps/server/src/adapters/refresh-expiry-warner.test.ts#withRefreshExpiryWarning returns the same StatusPayload it received (pure passthrough)"
        status: pass
      - kind: unit
        ref: "apps/server/src/adapters/refresh-expiry-warner.test.ts#withRefreshExpiryWarning never throws even when the warn callback throws"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both GET /api/status and MCP get_status flow through the single wrapped statusPort — one warning choke point wired once at the composition root, no per-adapter duplication"
    requirement: AUTH-05
    verification:
      - kind: integration
        ref: "apps/server/src/adapters/http/status.routes.test.ts (13 tests, unchanged behavior after statusPort swap)"
        status: pass
      - kind: integration
        ref: "apps/server/src/adapters/mcp/mcp.test.ts (26 tests, unchanged behavior after statusPort swap)"
        status: pass
      - kind: other
        ref: "grep confirms no console.warn added inside packages/core or duplicated into status.routes.ts / mcp/server.ts"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-02
status: complete
---

# Phase 15 Plan 04: Refresh-Expiry Warning Log Summary

**A `withRefreshExpiryWarning` ForGettingStatus decorator with an in-process per-app latch, wired once at the composition root so GET /api/status and MCP get_status share a single T-24h warning-log choke point.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-02T19:29Z (approx, from first task commit)
- **Completed:** 2026-07-02T19:31Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- Implemented `withRefreshExpiryWarning`, a pure `ForGettingStatus -> ForGettingStatus` decorator with a closure-local `Map<AppId, boolean>` latch: warns once when `refreshExpiresIn` crosses null->non-null, stays silent while latched, re-arms on a return to null.
- Warning messages carry only `appId` + seconds-remaining; a dedicated test asserts the message excludes the literal substrings `"token"` and `"refresh_token"`.
- Wired the decorator exactly once in `apps/server/src/main.ts` — the wrapped `statusPort` is injected into both `statusRoutes(...)` and `makeMcpRouter(...)`, so the warning fires once per crossing regardless of transport, with zero duplication inside `status.routes.ts` or the MCP tool.

## Task Commits

Each task was committed atomically (TDD RED->GREEN plus wiring):

1. **Task 1 RED: failing test for withRefreshExpiryWarning** - `18486b5` (test)
2. **Task 1 GREEN: implement withRefreshExpiryWarning decorator** - `f947c3f` (feat)
3. **Task 2: wire the warner once in the composition root** - `657c32c` (feat)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `apps/server/src/adapters/refresh-expiry-warner.ts` - `withRefreshExpiryWarning` decorator: per-app latch, guarded warn call, pure passthrough of the underlying `StatusPayload`.
- `apps/server/src/adapters/refresh-expiry-warner.test.ts` - 7 tests covering latch/re-arm, per-app independence, "none yet" no-op, no-secret-in-message assertion, passthrough identity, throwing-warn guard, and default-console.warn wiring.
- `apps/server/src/main.ts` - imports `withRefreshExpiryWarning`, constructs `statusPort` once after `getStatus`, and passes `statusPort` to both `statusRoutes(...)` and `makeMcpRouter(...)` in place of the raw `getStatus`.

## Decisions Made
- Dedup semantics locked as the RESEARCH-provisional reading: log on first null->non-null crossing only, re-arm on return to null (not fire-on-every-poll, not once-per-process-lifetime).
- The warning message text deliberately avoids the word "token" altogether (uses "app"/"cutoff"/"expiry" instead of "refresh token") — the acceptance test enforces this at the substring level, not just "no raw token value."
- No new port/type needed: the decorator only reads the existing `AppTokenStatus.refreshExpiresIn` field shipped in 15-01; no changes to `packages/core`.

## Deviations from Plan

None — plan executed exactly as written. Both tasks matched their `<action>` and `<acceptance_criteria>` without requiring architectural changes, blocking fixes, or missing-functionality additions.

## Issues Encountered

The first implementation's warning message used the phrase "refresh token" in the log line ("Schwab refresh token for app... expires in..."), which failed the RED-locked "must not contain 'token'" assertion. Reworded the message to avoid the literal word "token" (now: `Schwab app "{appId}" nearing 7-day re-auth cutoff — {n}s remaining, re-auth required before expiry`). Re-ran the test suite green after the wording fix — no rule invoked, this was iterating inside Task 1's own RED->GREEN loop before the GREEN commit was made.

## User Setup Required

None - no external service configuration required. The warning is a passive log line; it will appear in Railway server logs the next time an app's `refreshExpiresIn` first goes non-null (naturally, ~24h before the next weekly Schwab re-auth cutoff).

## Next Phase Readiness

- AUTH-05's log half is complete. Plan 15-05 (if it covers the browser-facing "alert" / banner side of SC1) can rely on the same `refreshExpiresIn` field already surfaced through `statusResponse` (15-01) — no new backend work needed for that half.
- No blockers. `bun run typecheck`, `bun run lint`, `refresh-expiry-warner.test.ts`, `status.routes.test.ts`, and `mcp.test.ts` are all green on `main` at commit `657c32c`.

---
*Phase: 15-re-auth-smoothing*
*Completed: 2026-07-02*
