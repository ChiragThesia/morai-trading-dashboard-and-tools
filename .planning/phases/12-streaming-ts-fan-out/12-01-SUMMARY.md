---
phase: 12-streaming-ts-fan-out
plan: "01"
subsystem: streaming-contracts
tags: [streaming, contracts, bsm, tdd, zod, hexagonal]
dependency_graph:
  requires: []
  provides:
    - "@morai/contracts stream-events Zod schemas"
    - "@morai/core streaming ports (ForReconcilingPositions, RawOptionTick, LiveGreekTick, ReconciledPosition)"
    - "@morai/core recomputeLiveGreek pure function"
    - "@morai/adapters makeMemoryPositionReconciler in-memory twin"
    - "docs/architecture/streaming-fanout.md ADR"
  affects:
    - "packages/core — streaming bounded context added to barrel"
    - "packages/adapters — memory twin added to barrel"
    - "packages/contracts — stream-events added to barrel"
tech_stack:
  added:
    - "packages/core/src/streaming/ (streaming bounded context)"
  patterns:
    - "ForVerbingNoun function-type driven port (ForReconcilingPositions)"
    - "in-memory twin with contract test (architecture rule 8)"
    - "fast-check property test with parseOccSymbol-consistent T (timezone-safe)"
key_files:
  created:
    - "packages/contracts/src/stream-events.ts"
    - "packages/contracts/src/stream-events.test.ts"
    - "packages/core/src/streaming/ports.ts"
    - "packages/core/src/streaming/recompute-live-greek.ts"
    - "packages/core/src/streaming/recompute-live-greek.test.ts"
    - "packages/core/src/streaming/index.ts"
    - "packages/adapters/src/memory/position-reconciler.ts"
    - "packages/adapters/src/memory/position-reconciler.contract.test.ts"
    - "docs/architecture/streaming-fanout.md"
  modified:
    - "packages/contracts/src/index.ts"
    - "packages/core/src/index.ts"
    - "packages/adapters/src/index.ts"
    - "docs/architecture/stack-decisions.md"
    - "docs/TOPIC-MAP.md"
decisions:
  - "recomputeLiveGreek uses parseOccSymbol to compute T (not a separate UTC Date) — avoids timezone-driven T mismatch in the fast-check property test"
  - "streamFillEvent uses z.unknown() for activity field — ACCT_ACTIVITY MESSAGE_TYPE values are genuinely undocumented (Pitfall 1); no enum enforced"
  - "Stream greek fields are numbers (not strings) — diverges from live-greeks.ts string convention; stream payloads are ephemeral display data consumed directly by fmtGreek, not journal-formatted strings"
  - "D23 added to stack-decisions.md for SSE fan-out + opaque ticket pattern (docs-before-code)"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-28"
  tasks_completed: 3
  tests_added: 33
  files_created: 9
  files_modified: 5
status: complete
---

# Phase 12 Plan 01: Stream-Events Contracts, BSM Recompute, and Memory Twin Summary

**One-liner**: Typed stream payload schemas (Zod, +00:00 rejection), BSM live-greek recompute from sidecar mark+spot (D-02), ForReconcilingPositions port with in-memory twin, and streaming fan-out ADR before framework code.

## What Was Built

### Task 1: Stream-Events Zod Contract (09f4333)

Four Zod schemas in `packages/contracts/src/stream-events.ts`:

- `streamTicketResponse` — `{ ticket: uuid }` for POST /api/stream/ticket response (D-01)
- `streamLiveGreekEvent` — `occSymbol, mark, bid/ask (nullable), bsmIv/Delta/Gamma/Theta/Vega (numbers), ts (datetime)` — greek values are numbers, not strings (diverges from live-greeks.ts intentionally)
- `streamReconcileEvent` — `{ positions: [occSymbol, longQty, shortQty, underlyingSymbol, marketValue(nullable)], asOf }` for cold-start reconcile (STRM-05)
- `streamFillEvent` — `{ ts, activity: z.unknown() }` — permissive by design (ACCT_ACTIVITY MESSAGE_TYPE is undocumented, D-03/Pitfall 1)

All timestamp fields use `z.string().datetime()` which REJECTS `+00:00` and REQUIRES `Z`. This enforces the chain_proxy.py Z-suffix contract at the parse boundary (Pitfall 5).

17 tests, all green.

### Task 2: Core Streaming Port + BSM Recompute + In-Memory Twin (e3b541e, 915ead5)

**ports.ts** defines:
- `RawOptionTick` — nullable mark/bid/ask/underlyingPrice (Schwab sends only changed fields)
- `LiveGreekTick` — BSM-recomputed greeks, never Schwab raw greeks (D-02)
- `ReconciledPosition` — shape-parity with streamReconcileEvent positions items
- `ForReconcilingPositions` — driven port (function type, `() => Promise<Result<ReadonlyArray<ReconciledPosition>, StreamReconcileError>>`)

**recompute-live-greek.ts** implements `recomputeLiveGreek(tick, rate, q, now)`:
1. price = mark ?? (bid+ask)/2; skip (typed err) when unavailable or ≤ 0 (Pitfall 4)
2. parseOccSymbol to get expiry/strike/type; skip on bad symbol
3. T = years to expiry from `now`; skip when T ≤ 0 (Pitfall 4)
4. invertIv(price, S, K, T, r, q, type); skip on IvError
5. bsmGreeks(S, K, T, iv, r, q, type) → LiveGreekTick

11 tests: 10 example tests (ATM call, mark-absent fallback, T≤0 skip, bad symbol, etc.) + 1 fast-check property test (100 runs, seed=42). Property: bsmPrice(S, K, T, recoveredIv) ≈ mark within 1e-3 on all solvable ATM-ish inputs. Uses parseOccSymbol to compute T consistently (timezone-safe).

**makeMemoryPositionReconciler** in `packages/adapters/src/memory/position-reconciler.ts` — in-memory twin implementing ForReconcilingPositions (architecture rule 8). Seeds a frozen ReadonlyArray, resolves ok on every call.

5 contract tests verify: shape parity with streamReconcileEvent positions, nullable marketValue, idempotency.

All barrel exports added: `@morai/core`, `@morai/adapters`, `@morai/contracts`.

### Task 3: Streaming Fan-Out ADR (c8d1e54)

`docs/architecture/streaming-fanout.md` (120 lines, ≤250 limit):
- Full pipeline diagram (sidecar → asyncio.Queue → SSE → apps/server fan-out Set → browser)
- Ticket auth rationale (D-01: EventSource cannot send Authorization headers; ticket ≠ JWT-in-querystring)
- BSM recompute rationale (D-02: journal and live view must show the same numbers)
- Display-only invariant (STRM-04: leg_observations count must not grow during streaming)
- Dynamic subscription approach (D-03: position-reconcile diff, not MESSAGE_TYPE parsing)
- Coalescer + warm stream (D-07, D-08)
- Reconnect/stale UX (D-04, STRM-05)
- Z-suffix timestamp contract
- Hexagon placement table

`stack-decisions.md`: D23 row (SSE fan-out + opaque ticket) added to decision table + full D23 section with swap cost and revisit trigger.

`TOPIC-MAP.md`: streaming-fanout.md entry added.

## Verification Evidence

```
Test Files  3 passed (3)
     Tests  33 passed (33)
  Start at  18:45:49
  Duration  2.06s
```

- `bun run typecheck` — clean (no errors)
- `bun run lint` — 0 errors (including @typescript-eslint/consistent-type-assertions)
- Architecture grep: no hono/fastapi/process.env imports in `packages/core/src/streaming/`
- Docs acceptance criteria: streaming-fanout.md exists, TOPIC-MAP references it, stack-decisions.md contains "opaque"

## Must-Haves Status

| Must-Have | Status |
|-----------|--------|
| +00:00 ts rejected, Z accepted by streamLiveGreekEvent.parse | VERIFIED — test at stream-events.test.ts:56 |
| recomputeLiveGreek derives BSM IV + greeks from mark + underlying_price (D-02) | VERIFIED — ports.ts + recompute-live-greek.ts |
| Mark-absent fallback to (bid+ask)/2; typed skip when both unavailable or T<=0 | VERIFIED — tests at lines 57-86 |
| ForReconcilingPositions port with real-shape contract + in-memory twin | VERIFIED — ports.ts + position-reconciler.ts + contract test |
| packages/contracts/src/stream-events.ts with all 4 schemas | VERIFIED — all 4 exported |
| packages/core/src/streaming/recompute-live-greek.ts exports recomputeLiveGreek | VERIFIED |
| packages/core/src/streaming/ports.ts contains ForReconcilingPositions | VERIFIED |
| packages/adapters/src/memory/position-reconciler.ts exports makeMemoryPositionReconciler | VERIFIED |
| docs/architecture/streaming-fanout.md provides ADR before framework code | VERIFIED — committed before any Wave 2 code |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] fast-check property test: T timezone mismatch**

- **Found during**: Task 2, fast-check property run
- **Issue**: The property test computed T using a UTC midnight `expiryDate` while `parseOccSymbol` in `recomputeLiveGreek` uses local-time midnight (JavaScript `new Date(year, mm-1, dd)`). On a Pacific-time machine (UTC-7), this caused a ~7-hour T discrepancy. For short-dated options (~30 DTE), this produced a mark/reprice mismatch > 1e-3 and a false property failure.
- **Fix**: Property test now calls `parseOccSymbol(occSymbol)` to extract the expiry Date, then computes T from that Date (same as recomputeLiveGreek). The theoreticalMark is generated with this consistent T. The round-trip assertion is now timezone-safe.
- **Files modified**: `packages/core/src/streaming/recompute-live-greek.test.ts`
- **Commit**: e3b541e (included in Task 2 commit)

**2. [Rule 2 - Lint] Type assertion `as ReadonlyArray<ReconciledPosition>`**

- **Found during**: Task 2, `bun run lint`
- **Issue**: `Object.freeze([...seed]) as ReadonlyArray<ReconciledPosition>` triggered `@typescript-eslint/consistent-type-assertions` (no-as rule).
- **Fix**: Used typed variable declaration — `const frozenArr: ReadonlyArray<ReconciledPosition> = Object.freeze([...seed])`.
- **Files modified**: `packages/adapters/src/memory/position-reconciler.ts`
- **Commit**: 915ead5

## Known Stubs

None. This plan produces foundational contracts and compute — no UI rendering, no data sources. All exports are fully implemented.

## Threat Surface Scan

All new trust boundaries are within scope of the plan's threat model:

| Flag | File | Description |
|------|------|-------------|
| (none new) | — | No new network endpoints, auth paths, or file access patterns introduced in Plan 01. Threat model T-12-01-01 through T-12-SC all addressed as designed. |

## Self-Check: PASSED

```
[x] packages/contracts/src/stream-events.ts exists
[x] packages/core/src/streaming/recompute-live-greek.ts exists
[x] packages/core/src/streaming/ports.ts exists
[x] packages/adapters/src/memory/position-reconciler.ts exists
[x] docs/architecture/streaming-fanout.md exists
[x] Commits: 09f4333, e3b541e, c8d1e54, 915ead5 all present in git log
[x] 33 tests passing
[x] typecheck clean
[x] lint clean
```
