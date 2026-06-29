---
phase: 12-streaming-ts-fan-out
plan: "04"
subsystem: streaming-server-core
tags: [streaming, auth, fan-out, testcontainers, tdd, sse, opaque-ticket]
dependency_graph:
  requires:
    - "@morai/core recomputeLiveGreek + LiveGreekTick (12-01)"
  provides:
    - "apps/server mintTicket/redeemTicket — opaque single-use 30s ticket store (D-01)"
    - "apps/server registerClient/unregisterClient/bufferTick/flushTicks/startFlushInterval — SSE fan-out + coalescer (D-07)"
    - "apps/server STRM-04 testcontainers regression gate (T-12-04-04)"
  affects:
    - "apps/server — ticket-store.ts, stream-fan-out.ts consumed by stream.routes.ts (12-05)"
    - "packages/adapters — sql re-exported for server integration tests"
    - "apps/server vitest.config.ts — name=server, globalSetup (shared Postgres container)"
tech_stack:
  added:
    - "apps/server: vitest globalSetup (shared with packages/adapters testcontainers harness)"
  patterns:
    - "Opaque single-use UUID ticket with injectable clock (D-01)"
    - "Set<SSEClient> fan-out + Map<occSymbol, LiveGreekTick> coalescer (D-07)"
    - "Two dead-client cleanup paths: aborted=true + writeSSE rejection (Pitfall 6)"
    - "testcontainers count-invariant regression gate (STRM-04)"
key_files:
  created:
    - "apps/server/src/adapters/http/ticket-store.ts"
    - "apps/server/src/adapters/http/ticket-store.test.ts"
    - "apps/server/src/adapters/http/stream-fan-out.ts"
    - "apps/server/src/adapters/http/stream-fan-out.test.ts"
    - "apps/server/src/adapters/http/strm04-regression.test.ts"
    - "apps/server/src/vitest.d.ts"
  modified:
    - "apps/server/vitest.config.ts (name=server, globalSetup)"
    - "apps/server/tsconfig.json (exclude test files + vitest.d.ts from tsc)"
    - "packages/adapters/src/index.ts (re-export sql from drizzle-orm)"
decisions:
  - "resetForTesting() exported from stream-fan-out.ts for test isolation — module-level Set/Map accumulates across tests without it; underscored-name pattern signals test-only intent"
  - "sql re-exported from @morai/adapters rather than imported directly from drizzle-orm in server tests — drizzle-orm symlink in apps/server/node_modules is a bun workspace artifact that Vite's transform pipeline cannot resolve (Rule 3 auto-fix)"
  - "globalSetup references packages/adapters/test/globalSetup.ts directly — avoids duplicating the testcontainers spin-up logic; dynamic imports in globalSetup resolve from the file's own location, so testcontainers resolves from adapters/node_modules correctly"
  - "tsconfig.json exclude for test files + vitest.d.ts — mirrors packages/adapters pattern; prevents vitest module augmentation from leaking into main compilation and breaking test-file type imports"
  - "STRM-04 test includes two cases: one with recomputeLiveGreek (real BSM path) and one with a synthetic tick (direct fan-out path) — covers both routes to bufferTick/flushTicks"
metrics:
  duration: "~12 minutes"
  completed: "2026-06-28"
  tasks_completed: 3
  tests_added: 22
  files_created: 6
  files_modified: 3
status: complete
---

# Phase 12 Plan 04: Ticket Store + Fan-Out Hub + STRM-04 Regression Gate Summary

**One-liner**: Opaque single-use 30s UUID ticket store (D-01), Set-based SSE fan-out with 1/sec per-symbol coalescer and dual dead-client cleanup (D-07/Pitfall 6), and a testcontainers leg_observations count-invariant gate proving no streaming path writes to Postgres (STRM-04).

## What Was Built

### Task 1: Opaque Single-Use Ticket Store — f020938 (RED) + 7611594 (GREEN)

`apps/server/src/adapters/http/ticket-store.ts` — two named exports, module-level `Map<string, TicketRecord>`:

- `mintTicket(userId, now?)`: `crypto.randomUUID()` + 30s TTL. Multiple tickets per userId allowed.
- `redeemTicket(ticket, now?)`: Returns userId exactly once. Returns null for unknown, expired, or already-used tickets. Lazy cleanup (delete on null return + on successful redemption). `record.used = true` + `ticketStore.delete(ticket)` before returning userId — single-use invariant holds even if somehow called twice in the same tick.
- Injectable clock (`now: NowFn = Date.now`) for deterministic TTL tests without real timers.
- TicketRecord contains ONLY `{userId, exp, used}` — no JWT, secret, or extractable claim (T-12-04-02).
- No Postgres/Drizzle import (STRM-04 compliant).

11 tests covering: UUID format, multiple tickets per userId, valid redemption, single-use (replay), unknown ticket, expiry at boundary, 1ms past boundary, cross-user isolation, double-expired redemption.

### Task 2: SSE Fan-Out Hub + Coalescer — 1accf68 (RED) + 95c276a (GREEN)

`apps/server/src/adapters/http/stream-fan-out.ts` — structural `SSEClient` type + module-level `Set<SSEClient>` + `Map<occSymbol, LiveGreekTick>`:

- `registerClient(stream)` / `unregisterClient(stream)`: Set membership.
- `bufferTick(tick)`: `tickBuffer.set(tick.occSymbol, tick)` — latest-wins coalescing (D-07).
- `flushTicks()`: No-op on empty buffer or no clients. Serialises buffered ticks to one `"ticks"` SSE event, clears buffer, iterates clients:
  - Path 1 (Pitfall 6): `stream.aborted === true` → `clients.delete(stream)` before writeSSE.
  - Path 2 (Pitfall 6): `stream.writeSSE(...).catch(() => clients.delete(stream))` — `void`-ed to satisfy no-floating-promises.
- `startFlushInterval()`: `setInterval(flushTicks, 1_000)` for the composition root.
- `resetForTesting()`: clears both Set and Map between test cases.
- Only import: `type LiveGreekTick from "@morai/core"` (no Postgres, STRM-04 compliant).

11 tests covering: register/unregister, D-07 coalescing (latest overwrites), buffer clears after flush, no-op on empty buffer, no-op on no clients, aborted=true cleanup (path 1), writeSSE-rejection cleanup (path 2), multi-client flush, startFlushInterval return value.

### Task 3: STRM-04 Testcontainers Regression Gate — 723267e

`apps/server/src/adapters/http/strm04-regression.test.ts` — two integration tests against a real Postgres 16 container:

1. **BSM path**: `recomputeLiveGreek(rawTick, 0.045, 0.013, now)` → `bufferTick` → `flushTicks` → `count(leg_observations)` unchanged.
2. **Direct synthetic tick path**: construct `LiveGreekTick` directly → `bufferTick` → `flushTicks` → count unchanged.

Both assert `after === before` (count invariant). Fails the build if any streaming path ever inserts a `leg_observations` row (T-12-04-04).

Infrastructure changes:
- `apps/server/vitest.config.ts`: added `name: "server"` (enables `--project server` filter), `globalSetup: ["../../packages/adapters/test/globalSetup.ts"]` (shared Postgres testcontainer).
- `apps/server/tsconfig.json`: `exclude: ["src/**/*.test.ts", "src/vitest.d.ts"]` — mirrors adapters pattern; prevents vitest augmentation from leaking into production TS compilation.
- `apps/server/src/vitest.d.ts`: `ProvidedContext.dbUrl: string | undefined` type declaration for `inject("dbUrl")`.
- `packages/adapters/src/index.ts`: re-exported `sql` from `drizzle-orm` (see deviations).

## Test Results

```
Test Files  14 passed (14)
     Tests  130 passed (130)
  Duration  2.57s (container startup included)

Postgres 16 container: started + migrations applied + stopped (globalSetup lifecycle)
STRM-04 count: before=0, after=0 (both test cases)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] drizzle-orm import fails from server test context**
- **Found during:** Task 3 (first STRM-04 test run)
- **Issue:** `import { sql } from "drizzle-orm"` in `strm04-regression.test.ts` raised "Cannot find package 'drizzle-orm'". The `drizzle-orm` symlink in `apps/server/node_modules/` is a bun workspace artifact (two conflicting symlinks: `drizzle-orm` and `drizzle-orm 2`) that Vite's transform pipeline could not resolve.
- **Fix:** Added `export { sql } from "drizzle-orm"` to `packages/adapters/src/index.ts`. The adapters package owns drizzle-orm (architecture rule); re-exporting the `sql` tag through the adapters barrel is consistent with that ownership. Test file changed to `import { sql, makeDb } from "@morai/adapters"`.
- **Files modified:** `packages/adapters/src/index.ts`, `apps/server/src/adapters/http/strm04-regression.test.ts`
- **Commit:** 723267e

**2. [Rule 1 - Bug] Three `as` type assertions in fan-out test violated no-as ESLint rule**
- **Found during:** Task 3 lint run (lint ran over Task 2 artifacts)
- **Issue:** `JSON.parse(...) as unknown[]` and `parsed[0] as { mark: number; occSymbol: string }` triggered `@typescript-eslint/consistent-type-assertions: never`.
- **Fix:** Replaced with Zod-based parsing: `ticksPayload.parse(JSON.parse(...))` using a local `z.array(z.object({ mark: z.number(), occSymbol: z.string() }))` schema (parse-don't-cast per CLAUDE.md).
- **Files modified:** `apps/server/src/adapters/http/stream-fan-out.test.ts`
- **Commit:** 723267e

**3. [Rule 3 - Blocking] vitest.d.ts inclusion broke existing test type imports**
- **Found during:** Task 3 typecheck
- **Issue:** Adding `apps/server/src/vitest.d.ts` with `/// <reference types="vitest" />` was picked up by `tsc --build` (tsconfig `"include": ["src"]`). The vitest module augmentation conflicted with `@types/bun`'s vitest declarations, causing `Module '"vitest"' has no exported member 'it'` errors in pre-existing test files.
- **Fix:** Added `"exclude": ["src/**/*.test.ts", "src/vitest.d.ts"]` to `apps/server/tsconfig.json`, mirroring `packages/adapters/tsconfig.json`.
- **Files modified:** `apps/server/tsconfig.json`
- **Commit:** 723267e

## Threat Mitigations Applied (from plan threat model)

| Threat | Mitigation |
|--------|------------|
| T-12-04-01 Spoofing | `crypto.randomUUID()` (unguessable) + `used=true+delete` on first redemption + 30s TTL. Replay and expiry return null. |
| T-12-04-02 Info Disclosure | TicketRecord holds only `{userId, exp, used}` — no JWT/secret/claim. Verified by grep: only JSDoc comments reference JWT. |
| T-12-04-03 DoS (Set growth) | Two dead-client cleanup paths in `flushTicks`. Coalescer bounds per-symbol to one tick/flush. |
| T-12-04-04 Tampering (hidden write) | STRM-04 testcontainers gate (count invariant) confirmed: before=0, after=0. |
| T-12-SC | Zero new packages — `crypto.randomUUID` is Bun built-in; `hono/streaming` already installed. |

## Self-Check: PASSED

```bash
# ticket-store.ts — no Postgres/JWT imports:
grep -n "^import" apps/server/src/adapters/http/ticket-store.ts
# (no output — no imports at all)

# stream-fan-out.ts — only @morai/core type import:
grep -n "^import" apps/server/src/adapters/http/stream-fan-out.ts
# import type { LiveGreekTick } from "@morai/core";

# All plan commits exist:
git log --oneline | grep "12-04"
# 723267e feat(12-04): STRM-04 testcontainers...
# 95c276a feat(12-04): implement SSE fan-out hub...
# 1accf68 test(12-04): add failing fan-out tests...
# 7611594 feat(12-04): implement mintTicket/redeemTicket...
# f020938 test(12-04): add failing ticket-store tests...
```
