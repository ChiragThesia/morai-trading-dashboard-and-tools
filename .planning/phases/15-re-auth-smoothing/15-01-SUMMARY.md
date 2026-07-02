---
phase: 15-re-auth-smoothing
plan: 01
subsystem: auth
tags: [zod, typescript, brokerage-domain, status-contract, mcp]

# Dependency graph
requires:
  - phase: 05-jobs-fill-rebuild-integrity
    provides: token-freshness.ts domain (isNearExpiry, toAppTokenStatus, WARN_THRESHOLD_MS/SEVEN_DAYS_MS constants)
provides:
  - refreshExpiresInSeconds pure domain function (T-24h boundary, null outside window, 0 past cutoff)
  - refreshExpiresIn field on domain AppTokenStatus and the appTokenStatus Zod contract
  - refreshExpiresIn passthrough in status-dto.ts serializeApp (HTTP + MCP get_status both carry it)
affects: [15-04 (warning log consumes refreshExpiresIn), 15-05 (amber banner consumes refreshExpiresIn)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AUTH-05 status-surface backbone: one domain function (refreshExpiresInSeconds) feeds one choke point (toAppTokenStatus), which both the Postgres repo and the memory twin call — zero adapter-level duplication"
    - "status-dto.serializeApp remains the sole Date/number-to-wire mapper for both the HTTP route and the MCP get_status tool (MCP-02 by construction)"

key-files:
  created: []
  modified:
    - packages/core/src/brokerage/domain/token-freshness.ts
    - packages/core/src/brokerage/domain/token-freshness.test.ts
    - packages/core/src/brokerage/application/ports.ts
    - packages/contracts/src/status.ts
    - packages/contracts/src/status.test.ts
    - apps/server/src/adapters/status-dto.ts
    - apps/server/src/adapters/http/status.routes.test.ts
    - packages/adapters/src/memory/broker-tokens.ts
    - packages/core/src/journal/application/getStatus.test.ts
    - packages/core/src/brokerage/application/selectChainSource.test.ts
    - packages/core/src/brokerage/application/refreshTokens.test.ts
    - apps/worker/src/handlers/fetch-schwab-chain.test.ts
    - apps/web/src/components/AuthExpiredBanner.test.tsx

key-decisions:
  - "refreshExpiresIn is a REQUIRED (non-optional) key on both the domain type and the Zod contract — null when far from expiry, never omitted, so the wire shape stays stable and statusResponse.parse never has to distinguish 'missing' from 'not near expiry'"
  - "Representation locked per plan's provisional decision: non-negative integer seconds, null OUTSIDE the T-24h window (the field IS the alert signal, not a general countdown)"
  - "AUTH_EXPIRED branch of toAppTokenStatus yields refreshExpiresInSeconds(...) too (not hardcoded 0) — an 8-day-old row naturally clamps to 0 via Math.max(0, ...), so AUTH_EXPIRED and near-expiry-but-not-yet-expired share one code path"

patterns-established:
  - "refreshExpiresInSeconds mirrors isNearExpiry's pure-fn shape (no I/O, now injected) and reuses its constants rather than introducing new ones"

requirements-completed: [AUTH-05]

coverage:
  - id: D1
    description: "refreshExpiresInSeconds(refreshIssuedAt, now) returns null outside the T-24h warn window and a non-negative integer of seconds-until-7d-cutoff inside it, clamping to 0 past the hard cutoff"
    requirement: "AUTH-05"
    verification:
      - kind: unit
        ref: "packages/core/src/brokerage/domain/token-freshness.test.ts#refreshExpiresInSeconds"
        status: pass
    human_judgment: false
  - id: D2
    description: "toAppTokenStatus populates refreshExpiresIn on every app status: null for none_yet, and refreshExpiresInSeconds(...) for AUTH_EXPIRED/stale/fresh (0 for an already-past-cutoff row)"
    requirement: "AUTH-05"
    verification:
      - kind: unit
        ref: "packages/core/src/brokerage/domain/token-freshness.test.ts#toAppTokenStatus"
        status: pass
      - kind: integration
        ref: "apps/server/src/adapters/http/status.routes.test.ts#serializes Date token-freshness to ISO strings (regression: Date≠string 500)"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/status (and MCP get_status by construction, sharing status-dto.serializeApp) carries refreshExpiresIn per app and round-trips through statusResponse.parse without a Date/undefined leak — non-null integer for a near-expiry app, null for a far-from-expiry app"
    requirement: "AUTH-05"
    verification:
      - kind: integration
        ref: "apps/server/src/adapters/http/status.routes.test.ts#round-trips a non-null integer refreshExpiresIn for a near-expiry app (AUTH-05)"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-02
status: complete
---

# Phase 15 Plan 01: refreshExpiresIn Status-Surface Backbone Summary

**Added `refreshExpiresIn` (seconds until the 7-day Schwab refresh-token cutoff, non-null only inside the T-24h warn window) to the token-freshness domain, the `statusResponse` Zod contract, and the status serialization chain, so both `GET /api/status` and MCP `get_status` carry it automatically.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-02T14:00:10-05:00 (Task 1 commit)
- **Completed:** 2026-07-02T14:07:47-05:00 (Task 2 commit)
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments
- New pure domain function `refreshExpiresInSeconds(refreshIssuedAt, now)` — boundary-tested at just-under/exactly-at/just-over the 6-day (T-24h) threshold, clamps to 0 past the 7-day hard cutoff, reuses the existing `SEVEN_DAYS_MS`/`WARN_THRESHOLD_MS` constants and `isNearExpiry`.
- `AppTokenStatus` (domain, `ports.ts`) and `appTokenStatus` (Zod contract, `status.ts`) both gained a required `refreshExpiresIn: number | null` field.
- `toAppTokenStatus` is now the single computation point: `null` on the `none_yet` branch, `refreshExpiresInSeconds(row.refreshIssuedAt, now)` on `AUTH_EXPIRED`/`stale`/`fresh` — the Postgres repo and the in-memory twin both call it, so there is zero duplication.
- `status-dto.ts`'s `serializeApp` passes `refreshExpiresIn` straight through (already a plain `number | null`, no `.toISOString()` needed) — both the HTTP `/api/status` route and MCP `get_status` inherit it automatically (MCP-02 by construction).
- Every downstream `AppTokenStatus`/`appTokenStatus` literal across the workspace (memory twin, core/contracts/server/worker/web test fixtures) updated to supply the new field; a new round-trip assertion in `status.routes.test.ts` proves a near-expiry app carries a non-null integer and a far-from-expiry app carries `null` through `statusResponse.parse`.

## Task Commits

Each task was committed as a single green commit (see Deviations — this repo's `.claude/rules/tdd.md` mandates "commit at green only", so RED and GREEN were not split into separate commits):

1. **Task 1: refreshExpiresInSeconds pure domain function (RED→GREEN, isolated)** - `b4aafde` (feat)
2. **Task 2: Thread refreshExpiresIn through the type, contract, DTO, and every constructor (atomic green)** - `b43743d` (feat)

**Plan metadata:** committed alongside this SUMMARY (see final metadata commit).

## Files Created/Modified
- `packages/core/src/brokerage/domain/token-freshness.ts` - Added `refreshExpiresInSeconds`; threaded `refreshExpiresIn` through all 4 `toAppTokenStatus` return branches
- `packages/core/src/brokerage/domain/token-freshness.test.ts` - New `describe("refreshExpiresInSeconds", ...)` boundary block (5 cases)
- `packages/core/src/brokerage/application/ports.ts` - `AppTokenStatus.refreshExpiresIn: number | null` added
- `packages/contracts/src/status.ts` - `appTokenStatus.refreshExpiresIn: z.number().int().nonnegative().nullable()` added
- `packages/contracts/src/status.test.ts` - Two existing fixtures extended with `refreshExpiresIn`
- `apps/server/src/adapters/status-dto.ts` - `serializeApp` passes `refreshExpiresIn` through unchanged
- `apps/server/src/adapters/http/status.routes.test.ts` - Existing fixture extended + new near-expiry/far-from-expiry round-trip assertions
- `packages/adapters/src/memory/broker-tokens.ts` - 6 `none_yet` literal `AppTokenStatus` constructions gained `refreshExpiresIn: null`
- `packages/core/src/journal/application/getStatus.test.ts` - Fixture extended (`trader` null, `market` AUTH_EXPIRED → 0)
- `packages/core/src/brokerage/application/selectChainSource.test.ts` - 4 fixture pairs (8 literals) extended
- `packages/core/src/brokerage/application/refreshTokens.test.ts` - `makeFreshnessMap` helper extended
- `apps/worker/src/handlers/fetch-schwab-chain.test.ts` - Fixture extended
- `apps/web/src/components/AuthExpiredBanner.test.tsx` - `makeStatusData` fixture extended (apps/web has its own `tsc --noEmit`, not covered by root `bun run typecheck`)

## Decisions Made
- `refreshExpiresIn` is a required key (not optional) on both the domain type and the Zod contract, per the plan's explicit instruction — a far-from-expiry app sends `null`, it is never omitted. This keeps the wire shape stable and avoids `exactOptionalPropertyTypes` undefined-leak risk.
- The `AUTH_EXPIRED` branch of `toAppTokenStatus` calls `refreshExpiresInSeconds(...)` rather than hardcoding `0` — an 8-day-old row naturally clamps to `0` via the function's own `Math.max(0, ...)`, so there is one code path instead of a special case.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical / project-rule conflict] Combined RED and GREEN into single green commits instead of separate `test(...)`/`feat(...)` commits**
- **Found during:** Task 1
- **Issue:** The GSD executor's default TDD protocol commits RED (failing test) and GREEN (implementation) as two separate commits. This project's `.claude/rules/tdd.md` explicitly states "Commit only at green. Never commit with a failing suite" — a hard project convention that conflicts with a mid-transaction failing-suite commit. Prior phase execution (Phase 3, recorded in project memory) already established the precedent of skipping the RED commit and grep-verifying per plan.
- **Fix:** Wrote the failing test first, ran it, confirmed it failed for the right reason (missing export), then implemented and committed test+implementation together as a single `feat(...)` commit at green, for both Task 1 and Task 2.
- **Files modified:** N/A (process decision, not a file change)
- **Verification:** RED failure shown in this session before implementation (`SyntaxError: Export named 'refreshExpiresInSeconds' not found`); GREEN run shown passing (18/18) before commit.
- **Committed in:** `b4aafde`, `b43743d`

**2. [Rule 3 - Blocking] Added a round-trip assertion + near-expiry fixture in `status.routes.test.ts` and fixed `apps/web`'s separate `tsc --noEmit` (not covered by root `bun run typecheck`)**
- **Found during:** Task 2
- **Issue:** The plan's `<action>` mandated adding the field to "every remaining AppTokenStatus / appTokenStatus literal that must gain the field" and enumerated via "the compiler and failing fixtures." `apps/web` is not in the root `tsconfig.json`'s project references, so `bun run typecheck` at the repo root silently skips it; `AuthExpiredBanner.test.tsx`'s `makeStatusData` fixture would have shipped broken (missing required field) without a separate `cd apps/web && bun run typecheck` pass.
- **Fix:** Ran `apps/web`'s own `tsc --noEmit` explicitly, confirmed the only 2 new errors were the `refreshExpiresIn`-missing ones (rest were pre-existing unrelated debt, confirmed via `git stash` diff), and fixed the 2 fixture literals.
- **Files modified:** `apps/web/src/components/AuthExpiredBanner.test.tsx`
- **Verification:** `cd apps/web && bun run typecheck` shows zero `refreshExpiresIn`/`AuthExpiredBanner` errors after the fix; `bun run test` full suite green (1358 passed, 168 skipped — skips are pre-existing Docker-less testcontainers gaps, unrelated to this plan).
- **Committed in:** `b43743d`

---

**Total deviations:** 2 (1 process convention applied per project rule, 1 blocking gap closed)
**Impact on plan:** No scope creep — both were necessary to satisfy the plan's own acceptance criteria ("workspace typecheck ... clean") and this repo's TDD commit convention. All AUTH-05 status-surface backbone work is exactly as specified in the plan.

## Issues Encountered
- `bun run typecheck` at the repo root does not cover `apps/web` (it is not in the root `tsconfig.json` project references — only `packages/*` and `apps/server`/`apps/worker` are). Resolved by running `apps/web`'s own `tsc --noEmit` directly. This is a pre-existing gap in the workspace typecheck script, not introduced by this plan; flagging here for awareness in future phases touching `apps/web` fixtures.
- `gsd-tools query requirements.mark-complete AUTH-05` marked AUTH-05 fully "Complete" in `REQUIREMENTS.md` after this plan alone. AUTH-05 ("Status surfaces the Schwab refresh-token expiry **and an alert fires at T-24h**") is declared in the frontmatter of three plans in this phase (15-01, 15-04, 15-05) — this plan only ships the status-surface half (SC1); the T-24h alert (15-04) and amber banner (15-05) are still pending. Reverted the checkbox and traceability-table row back to `[ ]` / "Pending" in `.planning/REQUIREMENTS.md` so the doc doesn't claim the requirement is done before it actually is. `requirements-completed: [AUTH-05]` in this SUMMARY's frontmatter is left as-is per template instruction (verbatim copy of the plan's own `requirements:` field, not a completion claim) — 15-05's SUMMARY should be the one that flips AUTH-05 to Complete.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `refreshExpiresIn` is live on the domain type, the Zod contract, and both HTTP + MCP status surfaces — 15-04 (warning log) and 15-05 (amber banner) can now read it directly with no further plumbing.
- Workspace typecheck (root + `apps/web`) and full test suite (1358 passed) are green; no blockers for the next wave.

---
*Phase: 15-re-auth-smoothing*
*Completed: 2026-07-02*

## Self-Check: PASSED
