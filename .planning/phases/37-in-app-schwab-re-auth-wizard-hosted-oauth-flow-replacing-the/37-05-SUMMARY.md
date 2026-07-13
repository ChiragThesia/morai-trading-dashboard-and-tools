---
phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the
plan: 05
subsystem: server-http
tags: [hono, zod, hexagonal, reauth, composition-root]

requires:
  - phase: 37-02
    provides: reauth contracts + core ports/use-cases + sidecar HTTP adapter
provides:
  - "POST /api/reauth/start and POST /api/reauth/exchange — JWT-gated, leak-free proxy routes"
  - "SIDECAR_ADMIN_TOKEN server config field"
  - "packages/adapters barrel export for makeSidecarReauthAdapter (was missing from 37-02)"
affects: [37-06 (web wizard calls these two endpoints), 37-07 (integration gate + deploy env)]

tech-stack:
  added: []
  patterns:
    - "Zero-logic Result-mapper route (settings.routes.ts precedent): zValidator input → use-case → generic 500 on err → contract-parse on ok"
    - "Composition-root wiring built before the apiRouter const so it is in scope for the CHAINED .route() call (required for hc<AppType>() RPC inference)"

key-files:
  created:
    - apps/server/src/adapters/http/reauth.routes.ts
    - apps/server/src/adapters/http/reauth.routes.test.ts
  modified:
    - apps/server/src/config.ts
    - apps/server/src/main.ts
    - packages/adapters/src/index.ts

key-decisions:
  - "POST /reauth/start's success body is built directly as { authUrl: result.value.authUrl }, NOT parsed through reauthStartResponse. That contract (packages/contracts/src/reauth.ts) requires a `state` field — it validates the sidecar's raw wire response inside reauth-adapter.ts (which does see state before stripping it). ForStartingReauth's Result type deliberately narrows to { authUrl } only per 37-02's own no-leak decision (T-37-06: state never crosses into TS). Parsing through reauthStartResponse here would throw a ZodError on every successful call. POST /reauth/exchange has no such mismatch — reauthExchangeResponse ({app, ok}) matches ForExchangingReauth's return shape exactly and is parsed as planned."
  - "reauthAdapter + startReauth/exchangeReauth use-cases are built immediately before `const apiRouter = new Hono()` (not literally adjacent to makeSidecarPositionReconciler, which is built AFTER apiRouter and is not part of its chain). The apiRouter chain requires these use-cases in scope at construction time to satisfy the hc<AppType>() RPC-inference requirement noted in the existing main.ts comment (chained .route() calls only, no post-hoc app.route() statements for this router)."

requirements-completed: [REAUTH-05]

coverage:
  - id: D1
    description: "config.ts parses SIDECAR_ADMIN_TOKEN (min 16 chars), mirroring MCP_BEARER_TOKEN"
    requirement: "REAUTH-05"
    verification:
      - kind: unit
        ref: "apps/server/src/config.ts (grep + tsc --noEmit)"
        status: pass
    human_judgment: false
  - id: D2
    description: "reauthRoutes: POST /reauth/start and /reauth/exchange are zero-logic Result-mappers; err → generic {error:\"internal\"} 500 with no upstream detail leaked; invalid body (400) never reaches the use-case"
    requirement: "REAUTH-05"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/reauth.routes.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "main.ts wires makeSidecarReauthAdapter → makeStartReauth/makeExchangeReauth → reauthRoutes, mounted on the apiRouter chain inside authReadGroup (Supabase JWT); no MCP tool references reauth"
    requirement: "REAUTH-05"
    verification:
      - kind: unit
        ref: "grep (makeSidecarReauthAdapter, reauthRoutes present; src/adapters/mcp/ has zero reauth references) + bun run typecheck"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-13
status: complete
---

# Phase 37 Plan 05: Server Re-auth Proxy Routes Summary

**Two JWT-gated Hono routes (`POST /api/reauth/{start,exchange}`) that proxy the browser to the 37-02 sidecar adapter as zero-logic, leak-free Result-mappers — plus the `SIDECAR_ADMIN_TOKEN` config field and composition-root wiring; MCP deliberately excluded from this privileged auth-minting surface.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `config.ts` gained `SIDECAR_ADMIN_TOKEN` (Zod `min(16)`), the shared secret the server uses to call the sidecar's admin surface.
- `reauth.routes.ts` — a `reauthRoutes(startReauth, exchangeReauth)` factory mirroring `settings.routes.ts`'s shape exactly: `zValidator` input parse → use-case call → generic `{error:"internal"}` 500 on `!result.ok` → success body out. 6 tests cover the 200/500/400 paths for both endpoints, including an explicit no-leak assertion (a fake error's detail string never appears in the response body).
- `main.ts` builds `makeSidecarReauthAdapter({fetch, baseUrl: config.SIDECAR_URL, adminToken: config.SIDECAR_ADMIN_TOKEN})`, wraps each side in `makeStartReauth`/`makeExchangeReauth`, and mounts `reauthRoutes(...)` on the `apiRouter` chain — inside the same `authReadGroup` Supabase-JWT gate as every other data route. No MCP tool touches reauth; `src/adapters/mcp/` is grep-confirmed clean.

## Task Commits

1. **Task 1: SIDECAR_ADMIN_TOKEN config** — `eacb925` (feat)
2. **Task 2: reauth.routes.ts — JWT-group proxy routes** — `81ee8db` (feat, TDD RED confirmed failing on missing module before GREEN)
3. **Task 3: wire adapter + use-cases into main.ts** — `64b47b8` (feat, includes the barrel-export fix below)

## Files Created/Modified

- `apps/server/src/config.ts` — `SIDECAR_ADMIN_TOKEN: z.string().min(16, ...)`
- `apps/server/src/adapters/http/reauth.routes.ts` — the two-route factory
- `apps/server/src/adapters/http/reauth.routes.test.ts` — 6 tests (200/500/400 × start/exchange)
- `apps/server/src/main.ts` — imports + adapter/use-case construction + `.route("/", reauthRoutes(...))` on the `apiRouter` chain
- `packages/adapters/src/index.ts` — added the missing `makeSidecarReauthAdapter`/`SidecarReauthAdapterDeps` barrel export (see Deviations)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `reauthStartResponse` contract mismatch with `ForStartingReauth`'s Result shape**
- **Found during:** Task 2, writing the RED test for `POST /reauth/start`'s success path.
- **Issue:** `packages/contracts/src/reauth.ts`'s `reauthStartResponse` is `.strict()` and requires both `authUrl` **and** `state`. But `ForStartingReauth`'s Result type (`packages/core/src/reauth/application/ports.ts`) only carries `{ readonly authUrl: string }` — 37-02's adapter deliberately drops the sidecar-issued CSRF `state` before it ever crosses into TS (its own documented T-37-06 decision). Calling `reauthStartResponse.parse(result.value)` on the route's success path would throw a `ZodError` (missing required `state`) on every single successful call. The `reauthStartResponse` schema is actually the validator for the sidecar's raw wire body inside `reauth-adapter.ts` (which does see `state` before stripping it) — not a schema this route's output can satisfy.
- **Fix:** `POST /reauth/start`'s success handler returns `c.json({ authUrl: result.value.authUrl })` directly — a plain typed pick, not an external/untrusted value needing a Zod round-trip. `POST /reauth/exchange` is unaffected: `reauthExchangeResponse` (`{app, ok}`) matches `ForExchangingReauth`'s return shape exactly and is parsed as the plan specified.
- **Files modified:** `apps/server/src/adapters/http/reauth.routes.ts`, `apps/server/src/adapters/http/reauth.routes.test.ts` (updated the 200 assertion to check the actual `{authUrl}` body instead of parsing through the mismatched contract).
- **Commit:** `81ee8db`
- **Scope note:** `packages/contracts/src/reauth.ts` itself was left untouched (out of scope, upstream/read-only for this plan) — it's plausible the schema was over-specified for a dual role (sidecar-wire validation vs. browser-facing response) that 37-02 didn't fully separate. Flagging for whoever next touches `packages/contracts/src/reauth.ts`.

**2. [Rule 3 - Blocking] `makeSidecarReauthAdapter` never exported from the `@morai/adapters` barrel**
- **Found during:** Task 3, wiring `main.ts`.
- **Issue:** `packages/adapters/src/sidecar/reauth-adapter.ts` exists with correct content (created by 37-02), but `packages/adapters/src/index.ts` never re-exported it — `import { makeSidecarReauthAdapter } from "@morai/adapters"` failed with `TS2724: has no exported member`. This wasn't a stale-build artifact (ruled out by running the canonical root `bun run typecheck`, which rebuilds in dependency order) — the export line was simply never added in 37-02.
- **Fix:** Added `export { makeSidecarReauthAdapter } from "./sidecar/reauth-adapter.ts";` + its `SidecarReauthAdapterDeps` type export, mirroring the adjacent `makeSidecarPositionReconciler` export exactly. Two lines, additive only, no behavior change to anything already exported.
- **Files modified:** `packages/adapters/src/index.ts`.
- **Commit:** `64b47b8`
- **Scope note:** This touches `packages/adapters`, nominally out of my file scope for this plan — but it isn't owned by either parallel executor (37-04 is in `apps/sidecar`, 37-06 is in `apps/web`), and 37-02 is already complete/committed. Without this fix, Task 3 cannot typecheck at all. Flagging to the team lead as a gap in 37-02's own deliverable — any other consumer of `@morai/adapters` needing this adapter would have hit the identical `TS2724`.

## Coordination Note (git index, not a code issue)

Task 1's commit (`eacb925`) unexpectedly swept in two files from the parallel 37-04 (sidecar) executor — `apps/sidecar/tests/conftest.py` and `apps/sidecar/tests/test_reauth_admin.py` — because `git commit -m ...` (no pathspec) commits the *entire* index, and those files happened to be staged by the other executor at that exact moment (we share one working tree/index, not isolated worktrees). No work was lost — the content is legitimate 37-04 output, just misattributed under my Task 1 commit message instead of 37-04's own. From Task 2 onward I switched to pathspec-scoped commits (`git commit -m "..." -- <exact files>`), which commits only the named paths regardless of what else is staged concurrently; Tasks 2 and 3 each show exactly the intended file count. No history rewrite was attempted (per the no-destructive-git rule) — flagging this so the team lead is aware when reviewing 37-04's own commit history.

## Issues Encountered

None beyond the two deviations above (both resolved, suite green, typecheck clean).

## User Setup Required

None for this plan. `SIDECAR_ADMIN_TOKEN` Railway env setup on both services is owned by 37-07 (already noted in the plan).

## Next Phase Readiness

- 37-06 (web wizard) has a real `POST /api/reauth/start` (returns `{authUrl}`) and `POST /api/reauth/exchange` (returns `{app, ok}`) to call, both behind the existing Supabase JWT the web app already sends.
- 37-07 (integration gate) should set `SIDECAR_ADMIN_TOKEN` on the Railway server service (same value as the sidecar's) and can verify end-to-end with the runbook.
- No blockers for 37-06 or 37-07 from this plan's output.

---
*Phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the*
*Completed: 2026-07-13*

## Self-Check: PASSED
All created/modified files confirmed present on disk; all 3 task commit hashes (eacb925, 81ee8db, 64b47b8) confirmed in `git log`. Full reauth-scoped test run: 5 test files, 29 tests passed. Root `bun run typecheck`: clean.
