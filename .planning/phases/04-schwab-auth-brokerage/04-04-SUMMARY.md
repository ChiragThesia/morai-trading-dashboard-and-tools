---
phase: 04-schwab-auth-brokerage
plan: "04"
subsystem: brokerage
tags: [schwab, chain-adapter, BRK-01, hexagonal, tdd, msw]
dependency_graph:
  requires: ["04-02"]
  provides: ["makeSchwabChainAdapter", "selectChainSource", "parseSchwabSymbol"]
  affects: ["packages/core/src/journal/application/ports.ts", "packages/adapters/src/index.ts", "packages/core/src/brokerage/index.ts", "packages/core/src/index.ts"]
tech_stack:
  added: []
  patterns: ["msw contract test mirroring cboe", "Zod safeParse boundary (T-04-14)", "Result<T,E> error paths", "Schwab padded-root → OCC conversion via formatOccSymbol"]
key_files:
  created:
    - packages/adapters/src/schwab/market/schwab-symbol.ts
    - packages/adapters/src/schwab/market/chain-adapter.ts
    - packages/adapters/src/schwab/market/chain-adapter.test.ts
    - packages/adapters/src/schwab/market/chain-adapter.contract.test.ts
    - packages/adapters/test/fixtures/schwab-chain.fixture.json
    - packages/core/src/brokerage/application/selectChainSource.ts
    - packages/core/src/brokerage/application/selectChainSource.test.ts
  modified:
    - packages/core/src/journal/application/ports.ts
    - packages/adapters/src/index.ts
    - packages/core/src/brokerage/index.ts
    - packages/core/src/index.ts
decisions:
  - "[BRK-01] Schwab chain adapter mirrors CBOE cboe.ts factory shape exactly; ForFetchingChain port unchanged"
  - "[D-07/D-08] selectChainSource: fresh/stale → Schwab; AUTH_EXPIRED/none_yet/err → CBOE"
  - "[D-12] SchwabChainResponseSchema.safeParse at adapter boundary; malformed → Result.err, never throw"
  - "[RESEARCH A3] symbol parameter is caller-supplied (not hardcoded $SPX) per open question resolution"
  - "[T-04-16] getAccessToken checked first; AUTH_EXPIRED short-circuits before network call"
  - "[T-04-15] Bearer token never logged; only {kind,message} returned on error"
  - "Schwab symbol 21-char padded format is structurally identical to OCC; parseSchwabSymbol feeds formatOccSymbol directly"
  - "callExpDateMap/putExpDateMap both flattened; strikePrice already in points (no ÷1000)"
  - "observedAt uses new Date() — Schwab chain response has no top-level timestamp field"
  - "z.record(z.string(), z.record(z.string(), z.array(...))) required for Zod v4 two-argument form"
metrics:
  duration_minutes: 13
  completed_date: "2026-06-20"
  tasks: 5
  files: 11
---

# Phase 04 Plan 04: Schwab Chain Adapter + Source Selector Summary

**One-liner:** Schwab market chain adapter (ForFetchingChain) with callExpDateMap flattener, OCC symbol conversion via parseSchwabSymbol, and Schwab-primary/CBOE-fallback selectChainSource selector.

## What Was Built

### parseSchwabSymbol (schwab-symbol.ts)
Pure, Result-returning converter for Schwab's 21-char padded-root option symbol format into `OccSymbolParsed` components. Feeds directly into `formatOccSymbol` from `@morai/shared` to produce the canonical OCC string. Handles all error cases (wrong length, bad type char, non-numeric date, invalid/zero strike) without throwing.

### makeSchwabChainAdapter (chain-adapter.ts)
Mirrors the `makeCboeChainAdapter` factory shape. Implements `ForFetchingChain` behind the same port as CBOE. Auth-check-first pattern (T-04-16): `getAccessToken()` is called before any network call; AUTH_EXPIRED short-circuits without touching Schwab's API. `SchwabChainResponseSchema.safeParse` at the boundary (T-04-14). Flattens both `callExpDateMap` and `putExpDateMap` into `RawQuote[]`. Field mapping: `bidPrice/askPrice/markPrice → bid/ask/mark`, `totalVolume → volume`, `strikePrice` already in points. Bearer token never logged (T-04-15). Symbol passed as injected parameter (RESEARCH A3 resolution).

### schwab-chain.fixture.json
Hand-crafted fixture with one call entry and one put entry at strike 5950, expiry 2026-06-20, underlyingPrice 5950.25. Placed at `packages/adapters/test/fixtures/` alongside the CBOE fixtures.

### chain-adapter.contract.test.ts
Mirrors `cboe.contract.test.ts` exactly. Runs `runChainContractTests` against the Schwab adapter backed by msw, proving the Schwab adapter satisfies the same `ForFetchingChain` contract as CBOE.

### ObservationRow.source + SnapshotRow.source widening
Changed from literal `"cboe"` to union `"cboe" | "schwab_chain"` in `packages/core/src/journal/application/ports.ts`. TYPE-ONLY change; no migration needed (DB enums already include `schwab_chain` from schema.ts). Type-level assignability tests confirm the widening.

### selectChainSource (selectChainSource.ts)
`async selectChainSource(deps) => Promise<ForFetchingChain>` — reads `readTokenFreshness`, returns `schwabFetchChain` when market is `fresh` or `stale` (D-07), returns `cboeFetchChain` on `AUTH_EXPIRED`, `none_yet`, `"none yet"` string, or any error from `readTokenFreshness` (D-08 safe default; journal never stalls).

### Index exports
`makeSchwabChainAdapter` exported from `packages/adapters/src/index.ts`. `selectChainSource` exported from `packages/core/src/brokerage/index.ts` and `packages/core/src/index.ts`.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED  | 133e077 — `test(04-04): add failing tests` | PASS — all 3 test files failed for correct reasons |
| GREEN | 862b7d0 — `feat(04-04): Schwab chain adapter + symbol converter + source selector` | PASS — 35/35 tests green |
| REFACTOR | n/a — no structural cleanup needed after green | — |

### RED gate confirmation
- `selectChainSource.test.ts`: failed with `Cannot find module './selectChainSource.ts'`
- `schwab-symbol.test.ts`: failed with `Cannot find module './schwab-symbol.ts'`
- `chain-adapter.test.ts`: failed with `Cannot find module './chain-adapter.ts'`

### GREEN gate: 35 tests, 4 test files
- schwab-symbol.test.ts: 9/9
- chain-adapter.test.ts: 15/15
- chain-adapter.contract.test.ts: 3/3
- selectChainSource.test.ts: 8/8

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `z.record` one-argument form rejected by Zod v4**
- Found during: GREEN phase typecheck
- Issue: `z.record(z.record(z.array(...)))` with one argument produced TS2554 (Expected 2-3 arguments, but got 1) in Zod v4
- Fix: Changed to `z.record(z.string(), z.record(z.string(), z.array(...)))` two-argument form with explicit key schema
- Files modified: packages/adapters/src/schwab/market/chain-adapter.ts
- Commit: 862b7d0

**2. [Rule 1 - Bug] Fixed type assertion in test file violating `@typescript-eslint/consistent-type-assertions`**
- Found during: lint
- Issue: `"SPX   260620P07100000" as ObservationRow["contract"]` triggered lint error `Do not use any type assertions`
- Fix: Replaced with `formatOccSymbol(...)` call from `@morai/shared` (the branded constructor that's allowed to use `as` internally per Phase 1 P02 decision)
- Files modified: packages/core/src/brokerage/application/selectChainSource.test.ts
- Commit: 862b7d0

**3. [Rule 1 - Bug] Fixed fixture path in chain-adapter.test.ts**
- Found during: initial GREEN attempt
- Issue: Import path `../../test/fixtures/schwab-chain.fixture.json` was relative to `src/schwab/market/` — resolves to `src/test/fixtures/` (doesn't exist); correct path needs `../../../test/fixtures/` to reach `packages/adapters/test/fixtures/`
- Fix: Updated import path to `../../../test/fixtures/schwab-chain.fixture.json`
- Files modified: packages/adapters/src/schwab/market/chain-adapter.test.ts
- Commit: 862b7d0

## Known Stubs

None. All fields wired from fixture. `observedAt` uses `new Date()` (injected clock not added — Schwab chain has no top-level timestamp; this is intentional behavior, not a stub).

## Threat Surface Scan

No new network endpoints or auth paths beyond what the plan's threat model covers:
- T-04-14: mitigated — SchwabChainResponseSchema.safeParse at boundary
- T-04-15: mitigated — Bearer token never logged; only {kind,message} on error
- T-04-16: mitigated — AUTH_EXPIRED short-circuits before network call
- T-04-17: accepted — 30-min cadence stays well under 120 req/min limit

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| schwab-symbol.ts exists | FOUND |
| chain-adapter.ts exists | FOUND |
| chain-adapter.contract.test.ts exists | FOUND |
| schwab-chain.fixture.json exists | FOUND |
| selectChainSource.ts exists | FOUND |
| RED commit 133e077 exists | FOUND |
| GREEN commit 862b7d0 exists | FOUND |
