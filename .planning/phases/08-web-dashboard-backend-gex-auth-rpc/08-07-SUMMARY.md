---
phase: 08-web-dashboard-backend-gex-auth-rpc
plan: "07"
subsystem: server/http-adapters, server/mcp-adapters, config
tags: [gex, auth, cors, rpc, supabase-auth, hono-jwt, mcp-02]
dependency_graph:
  requires: ["08-01", "08-05"]
  provides: ["GET /api/analytics/gex", "get_gex MCP tool", "AppType export", "Supabase Auth JWT gate", "CORS-first middleware"]
  affects: ["apps/server/src/main.ts", "apps/server/src/config.ts"]
tech_stack:
  added: ["hono/jwt (HS256 offline verify)", "hono/cors (exact-origin CORS)"]
  patterns: ["CORS-first middleware", "JWT auth group (authReadGroup)", "chained apiRouter for AppType inference", "registerGetGexTool no-input MCP pattern"]
key_files:
  created:
    - apps/server/src/adapters/http/gex.routes.ts
    - apps/server/src/adapters/http/gex.routes.test.ts
    - apps/server/src/adapters/http/auth-integration.test.ts
    - apps/server/src/app-type.assert.ts
  modified:
    - apps/server/src/config.ts
    - apps/server/src/config.test.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/adapters/mcp/mcp.test.ts
    - apps/server/src/main.ts
    - .env.example
decisions:
  - "CORS applied as FIRST middleware on app (Pitfall 7) — preflight OPTIONS must return headers before JWT gate can reject"
  - "Chained apiRouter pattern (.route().route().route()) required for AppType inference (RESEARCH A5/Pattern 6)"
  - "getGex added as optional param in makeMcpRouter (before getPositions) to preserve backward compat with existing call sites"
  - "A1 Supabase JWT algorithm gate is operator-deferred (requires Dashboard access) — HS256 code path proven by integration tests"
  - "Auth integration tests placed in auth-integration.test.ts (separate from gex.routes.test.ts) for test isolation and clarity"
metrics:
  duration: "~9 min"
  completed: "2026-06-24T16:25:55Z"
  tasks: 3
  files: 11
status: complete
---

# Phase 08 Plan 07: GEX Endpoint + Auth + AppType Summary

GEX read endpoint + MCP tool over shared Zod contract, Hono AppType export for typed RPC, Supabase Auth JWT gate + exact-origin CORS for all read endpoints.

## What Was Built

### Task 1: Config env vars + GEX route + get_gex MCP tool (GEX-01/GEX-02, MCP-02)

**Config (config.ts + config.test.ts + .env.example):**
- Added `SUPABASE_JWT_SECRET: z.string().min(32, ...)` and `WEB_ORIGIN: z.string().url(...)` to configSchema
- Added 7 new config.test.ts assertions: reject missing/short secret, reject non-URL origin, value never echoed in ZodError message (T-01-12)
- Updated mcp.test.ts testConfig to include both new fields (fixes typecheck)
- Added both vars to .env.example with dev defaults and inline documentation

**GEX route (gex.routes.ts):**
- `gexRoutes(getGex: ForRunningGetGex)` factory returning a Hono router with `GET /gex`
- 200 + gexSnapshotResponse.parse(result) on stored row; 404 `{error:"no-snapshot"}` on null; 500 `{error:"internal"}` on err
- Pure stored-row read — no buildProfile/strikeGex/bsmGreeks/recompute (D-01)
- Date computedAt serialized to ISO string before contract parse (mirrors analytics.routes.ts pattern)

**MCP tool (tools.ts + server.ts):**
- Added `registerGetGexTool(server, getGex)` with `inputSchema: {}` (no-input pattern)
- null → `{error:"no-snapshot"}` structured text payload (never throws)
- Parses through the SAME gexSnapshotResponse schema as HTTP route (MCP-02)
- Wired `getGex?` as optional param in `makeMcpRouter` (positional arg before `getPositions?`)
- `if (getGex !== undefined)` guard in `makeServerAndTransport` for backward compat

**TDD:** RED (Cannot find module gex.routes.ts) → GREEN (17 tests pass across gex.routes.test.ts + config.test.ts)

### Task 2: main.ts refactor — CORS-first + Supabase Auth read group + chained apiRouter + AppType (SC-3/SC-4)

- Added `import { jwt } from "hono/jwt"`, `import { cors } from "hono/cors"`, `import { gexRoutes } from "./adapters/http/gex.routes.ts"`
- Added `makePostgresGexSnapshotRepo` + `makeGetGexUseCase` wiring (gex read use-case)
- Applied CORS as FIRST middleware: `app.use("/*", cors({ origin: config.WEB_ORIGIN, credentials: true, ... }))` — exact origin, never `*` (Pitfall 7 / T-08-AUTH3)
- Replaced statement-style read routes with ONE chained `apiRouter` (required for AppType inference — RESEARCH A5/Pattern 6)
- `apiRouter` includes all prior read routes + `.route("/analytics", gexRoutes(getGex))`
- Wrapped in `authReadGroup`: `authReadGroup.use("/*", jwt({ secret: config.SUPABASE_JWT_SECRET, alg: "HS256" }))` — offline HS256, no network call (T-08-AUTH2 anti-pattern avoided)
- `jobsGroup` (bearerAuth on /api/jobs/*) and `/mcp` mount remain UNCHANGED (D-02 scope)
- `makeMcpRouter` call updated to pass `getGex` (new arg position 7, before `getPositions`)
- Created `app-type.assert.ts`: `hc<AppType>("http://localhost:3000")` typecheck-only proof (SC-3/RPC-01)
- Added `export type AppType = typeof app` at bottom of main.ts (RPC-01)

**Verification:** `bun run typecheck && bun run lint` both exit 0; `hc<AppType>()` assertion compiles

### Task 3: Auth integration tests + A1 gate (SC-4/AUTH-01)

Created `auth-integration.test.ts` with 12 integration cases:
- **(a) No-JWT → 401:** GET /api/status and GET /api/analytics/gex both return 401 without Authorization header (T-08-AUTH1)
- **(b) Valid HS256 JWT → passes gate:** Jwt.sign() from `hono/utils/jwt` with test secret + alg HS256; response is 404 (no-snapshot, not 401) proving the gate was passed (T-08-AUTH2 / A2)
- **(b) JWT signed with Jwt.sign() proves offline path:** header.alg = "HS256" confirmed; no supabase.auth.getUser() network call
- **(c) Tampered/invalid/wrong-key JWT → 401:** tampered signature, invalid string, and wrong-secret token all rejected (T-08-AUTH2)
- **(d) Preflight OPTIONS from WEB_ORIGIN → CORS headers:** Access-Control-Allow-Origin = TEST_WEB_ORIGIN (not `*`); Access-Control-Allow-Credentials = "true"; Pitfall 7 confirmed — preflight not 401'd before headers returned
- **(e) Other origin → no WEB_ORIGIN allow-origin:** request from `http://evil.example.com` does not receive `http://localhost:5173` in allow-origin (T-08-AUTH3)

**A1 manual gate (operator-deferred):** Confirms Supabase JWT algorithm is HS256 (Dashboard → Settings → API → JWT settings). If RS256 is found: switch `jwt({ secret, alg: "HS256" })` to `verifyWithJwks` path (RESEARCH A1). Follows Phase 3/4/5 operator-deferred precedent — all automated verification is complete.

**Full workspace:** 115 test files, 1067 tests pass; typecheck + lint clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] mcp.test.ts testConfig missing SUPABASE_JWT_SECRET + WEB_ORIGIN**
- **Found during:** Task 2 typecheck (`bun run typecheck`)
- **Issue:** Adding two required fields to configSchema caused testConfig in mcp.test.ts to fail the `satisfies Config` type assertion (TS1360/TS2345)
- **Fix:** Added `SUPABASE_JWT_SECRET` and `WEB_ORIGIN` to testConfig in mcp.test.ts
- **Files modified:** apps/server/src/adapters/mcp/mcp.test.ts
- **Commit:** a5a8fb7 (included in Task 1 commit)

**2. [Rule 1 - Bug] gex.routes.test.ts line 100 `as` type assertion violated lint rule**
- **Found during:** Task 1 lint check
- **Issue:** `const body = (await res.json()) as Record<string, unknown>` triggered `@typescript-eslint/consistent-type-assertions` error
- **Fix:** Rewrote to use `const body: unknown = await res.json()` + `gexSnapshotResponse.parse(body)` + `Object.keys(parsed)` — eliminating the assertion while keeping the same test intent
- **Files modified:** apps/server/src/adapters/http/gex.routes.test.ts
- **Commit:** a5a8fb7

**3. [Rule 3 - Blocking] makeMcpRouter positional arg mismatch after adding getGex?**
- **Found during:** Task 2 typecheck
- **Issue:** Adding `getGex?` as a new optional param at position 7 (before getPositions?) caused main.ts's existing call to pass `getPositions` (a `ForGettingPositions`) where `getGex` (`ForRunningGetGex`) was now expected — TS2345
- **Fix:** Updated main.ts's `makeMcpRouter` call to explicitly pass `getGex` at position 7; updated GEX repo + use-case wiring in main.ts simultaneously
- **Files modified:** apps/server/src/main.ts
- **Commit:** 604c062

## Auth Gates

None encountered. The A1 Supabase JWT algorithm confirmation is an operator gate (not an agent auth failure) — documented as operator-deferred above.

## Known Stubs

None. All data paths are wired to real use-cases. The GEX route returns a genuine stored-row read from `makeGetGexUseCase` → `makePostgresGexSnapshotRepo`. The `{error:"no-snapshot"}` 404 is the clean no-data state, not a stub.

## Threat Flags

No new threat surface introduced beyond what the plan's threat model covers. All STRIDE mitigations are verified:
- T-08-AUTH1: proven by integration test (a) — no-JWT → 401
- T-08-AUTH2: proven by integration tests (b)+(c) — HS256 verify, tampered/wrong-key → 401
- T-08-AUTH3: proven by integration tests (d)+(e) — exact-origin CORS, no wildcard
- T-08-AUTH4: config.test.ts proves value not echoed in error (T-01-12)
- T-08-AUTH5: gex.routes.ts maps null → `{error:"no-snapshot"}`, err → `{error:"internal"}`
- T-08-AUTH6: A1 gate confirmed as operator-deferred (HS256 code path proven by tests)
- T-08-SC: no new packages (hono/jwt + hono/cors are Hono 4.12 builtins)

## Self-Check: PASSED

**Files exist:**
- FOUND: apps/server/src/adapters/http/gex.routes.ts
- FOUND: apps/server/src/adapters/http/gex.routes.test.ts
- FOUND: apps/server/src/adapters/http/auth-integration.test.ts
- FOUND: apps/server/src/app-type.assert.ts

**Commits exist:**
- FOUND: a5a8fb7 (Task 1 — config + GEX route + get_gex MCP tool)
- FOUND: 604c062 (Task 2 — main.ts CORS + auth + chained apiRouter + AppType)
- FOUND: 0981aca (Task 3 — auth integration tests)

**Acceptance criteria:**
- `export type AppType = typeof app` at line 254 in main.ts (RPC-01)
- `origin: config.WEB_ORIGIN` at line 187 in main.ts (T-08-AUTH3)
- No wildcard origin in main.ts (EoP prohibition confirmed)
- 115 test files, 1067 tests pass
- typecheck + lint both exit 0
