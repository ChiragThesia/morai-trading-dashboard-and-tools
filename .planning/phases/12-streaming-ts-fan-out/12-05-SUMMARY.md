---
phase: "12-streaming-ts-fan-out"
plan: "05"
subsystem: "streaming-server"
status: complete
tags: ["sse", "streaming", "auth", "fan-out", "tdd", "hono"]
dependency_graph:
  requires: ["12-01", "12-04"]
  provides: ["stream-routes-server", "sidecar-sse-consumer", "positions-reconciler-real"]
  affects: ["apps/server", "packages/adapters"]
tech_stack:
  added: []
  patterns:
    - "Opaque ticket auth for EventSource (JWT → UUID mint/redeem, D-01)"
    - "Pitfall 7 split: makeStreamSseRouter (GET-only) outside JWT; streamRoutes inside authReadGroup"
    - "Injectable fetch for sidecar proxy tests (no msw in apps/server)"
    - "Zod safeParse on every sidecar frame — drop malformed, never cast"
    - "STRM-05 reconcile-first: GET /sidecar/positions pull before live ticks"
key_files:
  created:
    - "apps/server/src/adapters/http/stream.routes.ts"
    - "apps/server/src/adapters/http/stream.routes.test.ts"
    - "apps/server/src/adapters/http/sidecar-sse.ts"
    - "apps/server/src/adapters/http/sidecar-sse.test.ts"
    - "packages/adapters/src/sidecar/positions-reconciler.ts"
    - "packages/adapters/src/sidecar/positions-reconciler.test.ts"
  modified:
    - "apps/server/src/config.ts"
    - "apps/server/src/config.test.ts"
    - "apps/server/src/main.ts"
    - "packages/adapters/src/index.ts"
decisions:
  - "makeStreamSseRouter added to handle Hono first-match-wins routing for Pitfall 7 (GET outside JWT)"
  - "riskFreeRate=0.045 and dividendYield=0.013 hardcoded at boot (SOFR/SPX proxies)"
  - "SIDECAR_URL added to server config — same value as worker; operator must set on Railway server service"
metrics:
  duration: "~2h (across two sessions)"
  completed: "2026-06-28"
  tasks_completed: 4
  files_changed: 10
  tests_added: 29
---

# Phase 12 Plan 05: Server SSE Routes + Sidecar Consumer Summary

JWT-gated ticket mint + subscribe proxy + ticket-gated GET SSE with STRM-05 reconcile-first; real ForReconcilingPositions via GET /sidecar/positions; sidecar-sse consumer Zod-parsing frames into BSM-recomputed LiveGreekTicks; SIDECAR_URL config added; main.ts wired with Pitfall 7 mount discipline.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1+4 | streamRoutes factory: POST /api/stream/ticket + POST /api/stream/subscribe + GET /api/stream | 542c395 |
| 2 | sidecar-sse.ts consumer + positions-reconciler.ts real ForReconcilingPositions | 0caba65 |
| 3 | SIDECAR_URL config + main.ts wiring (Pitfall 7 mount order + boot calls) | ca45e5f |

## What Was Built

### stream.routes.ts — Three routes in one factory

`streamRoutes(deps)` exports all three SSE streaming routes:

- **POST /api/stream/ticket** (JWT-gated, inside authReadGroup): reads `jwtPayload.sub`, calls `mintTicket()`, returns `{ ticket: uuid }`. D-01 opaque ticket — no JWT ever appears in query params.
- **POST /api/stream/subscribe** (JWT-gated): Zod-parses body, validates OCC symbol via `parseOccSymbol` (400 + no sidecar call on junk), proxies to `{SIDECAR_URL}/sidecar/subscribe`; maps 503→503 AUTH_EXPIRED, other/transport→502 SidecarUnavailable. D-05, SC6.
- **GET /api/stream** (ticket-gated, OUTSIDE JWT group): redeems ticket via `redeemTicket` (401 on bad/expired/used), opens SSE via `hono/streaming`, registers with fan-out, sends `event: reconcile` FIRST (STRM-05), then 30s ping loop.

`makeStreamSseRouter(deps)` exports a GET-only router containing only the SSE handler — used in main.ts for the outside-JWT mount (Pitfall 7).

`JwtEnv` type exported for typed test apps.

### sidecar-sse.ts — SSE frame consumer

`connectToSidecarStream(sidecarUrl, deps)`:
- Fetches `GET {sidecarUrl}/sidecar/events` (throws on non-200)
- Splits ReadableStream on `\n\n` boundaries
- Finds `data:` line, JSON.parse in try/catch (drop on malformed)
- Zod `safeParse` against `sidecarTickSchema` (drop on schema mismatch — future fill events etc.)
- Calls `recompute(tick, rate, q, now)` — BSM greeks, never raw Schwab values (D-02)
- Calls `bufferTick(tick)` on successful recompute; skips on `LiveGreekSkip`
- ping frames (`data: `) detected and skipped without parse attempt

### positions-reconciler.ts — Real ForReconcilingPositions

`makeSidecarPositionReconciler({ fetch, baseUrl })`:
- `GET {baseUrl}/sidecar/positions`
- 503 → `err({ kind: "AuthExpired" })`
- non-200 → `err({ kind: "NetworkError" })`
- json()/parse failure → `err({ kind: "ParseError" })`
- 200 + valid body → `ok(ReadonlyArray<ReconciledPosition>)`
- Error logging: `e.constructor.name` only (V6 constraint — no message/token leak)

Exported from `packages/adapters/src/index.ts` as `makeSidecarPositionReconciler`.

### config.ts — SIDECAR_URL added

`SIDECAR_URL: z.string().url("SIDECAR_URL must be a valid URL")` added to `configSchema`.

**Operator deploy note (user_setup):** Set `SIDECAR_URL` on the Railway **server** service (same value already set on the worker service, e.g. `http://sidecar.railway.internal:8000`). This was previously missing from the server config — it is now required.

### main.ts — Pitfall 7 wiring + boot calls

Critical mount order (Hono first-match-wins):
1. `app.route("/api", makeStreamSseRouter(streamRouteDeps))` — GET /api/stream BEFORE authReadGroup
2. `authReadGroup.route("/", streamRoutes(streamRouteDeps))` — POST routes INSIDE authReadGroup

Boot calls added:
- `startFlushInterval()` — 1/sec coalescing fan-out (D-07)
- `void connectToSidecarStream(config.SIDECAR_URL, { fetch, recompute: recomputeLiveGreek, bufferTick, riskFreeRate: 0.045, dividendYield: 0.013, now })` — reconnect loop inside

## Test Coverage

| File | Tests |
|------|-------|
| stream.routes.test.ts | 15 (ticket mint, SSE auth, reconcile-first, subscribe proxy) |
| sidecar-sse.test.ts | 7 (valid frame, ping skip, malformed drop, schema mismatch, recompute skip, non-200 throw) |
| positions-reconciler.test.ts | 7 (200 ok, 503 AuthExpired, non-200 NetworkError, throw NetworkError, 200 bad-body ParseError, url check) |

All 155 server tests pass. All 390 adapters tests pass. Typecheck clean. Lint clean.

## Deviations from Plan

### Auto-added: makeStreamSseRouter export [Rule 2 - Missing Critical Functionality]

**Found during:** Task 3 (main.ts wiring)
**Issue:** The plan specified mounting the full `streamRoutes` factory both inside and outside `authReadGroup` to handle Pitfall 7. Hono routing is first-match-wins per HTTP method — if `streamRoutes` (with its POST /stream/ticket handler) were mounted on `app` before `authReadGroup`, POST requests would match the outer mount first, find `jwtPayload` unset, and return 401 even for authenticated users. There is no way to achieve correct Pitfall 7 separation with a single factory mounted twice.
**Fix:** Added `makeStreamSseRouter(deps)` to `stream.routes.ts` — a GET-only router containing only the SSE handler. Main.ts mounts this outside `authReadGroup` (for EventSource connections) and mounts the full `streamRoutes` inside `authReadGroup` (for JWT-protected POSTs).
**Files modified:** `apps/server/src/adapters/http/stream.routes.ts`, `apps/server/src/main.ts`
**Commit:** ca45e5f

### Lint fixes [Rule 1 - Bug]

**Found during:** Lint run after Task 3
- `sidecar-sse.ts`: `as unknown` on `JSON.parse` return removed (assignment to `unknown`-typed variable is sufficient — no assertion needed)
- `stream.routes.test.ts`: Five `!` non-null assertions replaced with `if (!x) throw new Error(...)` narrowing guards
- `positions-reconciler.test.ts`: `(input as Request).url` replaced with `input instanceof Request ? input.url : ""`
**Commit:** ca45e5f (same commit as Task 3)

## TDD Gate Compliance

The plan type is `tdd` requiring separate RED (test) and GREEN (implementation) commits. In practice:
- Tasks 1+4 test file (`stream.routes.test.ts`) and implementation (`stream.routes.ts`) were committed together in a single `feat` commit (542c395).
- Task 2 test files and implementations were committed together in a single `feat` commit (0caba65).

**Warning:** RED gate commits are missing for Tasks 1, 2, and 4. Tests were written before implementations (confirmed by previous session notes) but not committed at the RED phase separately. The RED→GREEN behavior was correct; only the commit discipline was not enforced.

No separate `test(...)` commits exist for this plan.

## Known Stubs

None. `riskFreeRate: 0.045` and `dividendYield: 0.013` in `main.ts` are documented approximations (SOFR/SPX 12m trailing yield), not stubs — they produce real output. These are noted with `// ponytail:` comments indicating when to promote to config fields.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-network-endpoint | apps/server/src/adapters/http/stream.routes.ts | GET /api/stream opened as public-net SSE endpoint; ticket auth is the sole gate — ticket TTL (30s) and single-use enforcement are the only controls; EventSource reconnect creates a new ticket-mint round-trip |
| threat_flag: sidecar-proxy | apps/server/src/adapters/http/stream.routes.ts | POST /api/stream/subscribe proxies arbitrary OCC symbol to sidecar; OCC validation prevents injection but sidecar response body is passed through verbatim on 200 |

## Self-Check: PASSED

Files exist:
- apps/server/src/adapters/http/stream.routes.ts — FOUND
- apps/server/src/adapters/http/sidecar-sse.ts — FOUND
- packages/adapters/src/sidecar/positions-reconciler.ts — FOUND

Commits exist:
- 542c395 (streamRoutes factory) — FOUND
- 0caba65 (sidecar-sse + reconciler) — FOUND
- ca45e5f (main.ts wiring) — FOUND
