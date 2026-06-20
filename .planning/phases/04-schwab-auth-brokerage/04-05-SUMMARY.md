---
phase: 04-schwab-auth-brokerage
plan: "05"
subsystem: brokerage
tags: [schwab, trader-adapter, BRK-02, positions, transactions, orders, account-hash, tdd, msw, mcp, hexagonal]
dependency_graph:
  requires:
    - "04-04 (Schwab chain adapter, parseSchwabSymbol)"
    - "04-02 (broker-tokens repo, OAuth client)"
  provides:
    - "makeAccountHashResolver: ForResolvingAccountHash (Pitfall 5 — hashValue not raw number)"
    - "makeSchwabPositionsAdapter: ForFetchingPositions with Zod safeParse (T-04-18)"
    - "makeSchwabTransactionsAdapter: ForFetchingTransactions with legs + positionEffect"
    - "makeSchwabOrdersAdapter: ForFetchingOrders read-only (T-04-22)"
    - "makeMemorySchwabTrader: in-memory twin for all four trader ports"
    - "makeGetPositionsUseCase / makeGetTransactionsUseCase / makeGetOrdersUseCase"
    - "positionsResponse / transactionsResponse / ordersResponse Zod schemas (MCP-02)"
    - "brokerageRoutes: GET /api/positions, /api/transactions, /api/orders"
    - "registerGetPositionsTool / registerGetTransactionsTool / registerGetOrdersTool"
    - "brokerageAuthExpiredPayload: D-09 paused shape for AUTH_EXPIRED (200 not 503)"
  affects:
    - "packages/core/src/brokerage/application/ports.ts (BrokerOrder, ForFetchingOrders, ForResolvingAccountHash)"
    - "packages/core/src/brokerage/index.ts (new use-case exports)"
    - "packages/core/src/index.ts (new use-case exports)"
    - "packages/adapters/src/index.ts (new trader adapter exports)"
    - "packages/contracts/src/index.ts (brokerage schema exports)"
    - "apps/server/src/adapters/mcp/tools.ts (3 new tools)"
    - "apps/server/src/adapters/mcp/server.ts (makeMcpRouter extended)"
    - "apps/server/src/main.ts (trader adapter wiring)"
tech_stack:
  added: []
  patterns:
    - "msw setupServer for Schwab trader endpoints (same lifecycle as chain-adapter)"
    - "Zod safeParse at boundary — passthrough + optional fields for MEDIUM-confidence API"
    - "ForFetchingPositions/Transactions/Orders/ForResolvingAccountHash ForVerbingNoun ports"
    - "brokerageAuthExpiredPayload: 200 paused shape for D-09 (not 503 — market flows unaffected)"
    - "MCP-02: shared schema between HTTP routes and MCP tools via @morai/contracts"
    - "traderGetAccessToken closure: reads broker_tokens at call time (JOB-02 refresh deferred)"
key_files:
  created:
    - "packages/adapters/src/schwab/trader/account-hash.ts"
    - "packages/adapters/src/schwab/trader/positions-adapter.ts"
    - "packages/adapters/src/schwab/trader/transactions-adapter.ts"
    - "packages/adapters/src/schwab/trader/orders-adapter.ts"
    - "packages/adapters/src/schwab/trader/trader-adapter.test.ts"
    - "packages/adapters/src/test/fixtures/schwab-positions.fixture.json"
    - "packages/adapters/src/test/fixtures/schwab-transactions.fixture.json"
    - "packages/adapters/src/memory/schwab-trader.ts"
    - "packages/core/src/brokerage/application/getPositions.ts"
    - "packages/core/src/brokerage/application/getPositions.test.ts"
    - "packages/core/src/brokerage/application/getTransactions.ts"
    - "packages/core/src/brokerage/application/getTransactions.test.ts"
    - "packages/core/src/brokerage/application/getOrders.ts"
    - "packages/contracts/src/brokerage.ts"
    - "apps/server/src/adapters/http/brokerage.routes.ts"
    - "apps/server/src/adapters/http/brokerage.routes.test.ts"
  modified:
    - "packages/core/src/brokerage/application/ports.ts (BrokerOrder, ForFetchingOrders, ForResolvingAccountHash)"
    - "packages/core/src/brokerage/index.ts (new use-case + type exports)"
    - "packages/core/src/index.ts (new use-case + type exports)"
    - "packages/adapters/src/index.ts (trader adapter + memory twin exports)"
    - "packages/contracts/src/index.ts (brokerage schema exports)"
    - "apps/server/src/adapters/mcp/tools.ts (3 new BRK-02 tool registrations)"
    - "apps/server/src/adapters/mcp/server.ts (optional getPositions/Transactions/Orders params)"
    - "apps/server/src/main.ts (trader adapter wiring + brokerage route mounting)"
decisions:
  - "[BRK-02] ForResolvingAccountHash resolves hashValue from /accounts/accountNumbers (Pitfall 5 mitigated)"
  - "[D-09] AUTH_EXPIRED → 200 with {paused:true,reason:AUTH_EXPIRED} not 503 — encodes in brokerageAuthExpiredPayload Zod schema shared by HTTP + MCP"
  - "[T-04-22] orders-adapter is GET-only — no write endpoints, no order placement this phase"
  - "[MCP-02] positionsResponse/transactionsResponse/ordersResponse in contracts/brokerage.ts — one source, two surfaces"
  - "[traderGetAccessToken] reads broker_tokens.readTokens at call time; null row → auth-expired; on-demand refresh deferred to JOB-02 (Phase 5)"
  - "[makeMcpRouter] getPositions/Transactions/Orders are optional params — backward compat with existing 4-arg call sites in mcp.test.ts"
  - "[memory/schwab-trader.ts] makeMemorySchwabTrader implements all four ports + seed* helpers (architecture-boundaries §8)"
metrics:
  duration_minutes: 70
  completed_date: "2026-06-20"
  tasks_completed: 11
  tasks_deferred: 0
  files_changed: 22
---

# Phase 04 Plan 05: Schwab Trader Adapter + Use-Cases + HTTP Routes + MCP Tools Summary

**One-liner:** Schwab trader adapter (positions/transactions/orders) with account hash resolution, Zod boundary parse, three read-only use-cases, shared contracts, HTTP routes, and MCP tools — all behind the same ports and honoring the D-09 AUTH_EXPIRED degradation contract.

## Tasks Completed

| # | Task | Commit | Key Artifacts |
|---|------|--------|---------------|
| 1 (RED) | Ports extension + fixtures + failing trader adapter tests | 7f4dcbd | ports.ts (BrokerOrder/ForFetchingOrders/ForResolvingAccountHash), fixtures, trader-adapter.test.ts (23 behaviors) |
| 2 (GREEN) | Trader adapters implementation | 2fcc239 | account-hash.ts, positions-adapter.ts, transactions-adapter.ts, orders-adapter.ts |
| 3 (WIRING) | In-memory twin for trader ports | 1d91594 | memory/schwab-trader.ts — seedPositions/Transactions/Orders/AccountHash helpers |
| 4 (RED) | Failing use-case tests | 7354383 | getPositions.test.ts (4 behaviors), getTransactions.test.ts (8 behaviors for tx + orders) |
| 5 (GREEN) | Use-case implementations | 74b0861 | getPositions.ts, getTransactions.ts, getOrders.ts + brokerage/index.ts + core/index.ts |
| 6 (RED) | Failing brokerage routes test + contracts | db099e1 | contracts/brokerage.ts (Zod schemas), brokerage.routes.test.ts (9 behaviors) |
| 7 (GREEN) | Brokerage HTTP routes | 3a675ff | brokerage.routes.ts — GET /api/positions, /transactions, /orders |
| 8 (GREEN) | MCP tools (positions, transactions, orders) | 10b0b6a | tools.ts + server.ts extended with 3 BRK-02 tools |
| 9 (WIRING) | main.ts wiring + lint fix | c2ea80d | main.ts trader wiring, adapters/index.ts, lint fix in trader-adapter.test.ts |

## TDD Gate Compliance

| Gate | Commit | Tests | Status |
|------|--------|-------|--------|
| RED (adapters) | 7f4dcbd | 23 behaviors in trader-adapter.test.ts | PASS — failed with Cannot find module |
| GREEN (adapters) | 2fcc239 | 23/23 | PASS |
| RED (use-cases) | 7354383 | 12 behaviors (getPositions + getTransactions/getOrders) | PASS — failed with Cannot find module |
| GREEN (use-cases) | 74b0861 | 12/12 | PASS |
| RED (routes) | db099e1 | 9 behaviors in brokerage.routes.test.ts | PASS — failed with Cannot find module |
| GREEN (routes) | 3a675ff | 9/9 | PASS |

## Verification Gates

- `bun run test`: 551/551 (58 test files) — PASS
- `bun run typecheck`: exit 0 — PASS
- `bunx eslint` on all changed files: 0 errors — PASS

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed `as string` type assertion in trader-adapter.test.ts**

- **Found during:** ESLint on changed files (post-implementation)
- **Issue:** `ok("test-access-token" as string)` triggered `@typescript-eslint/consistent-type-assertions` lint error
- **Fix:** Replaced with `const token: string = "test-access-token"; return async () => ok(token);`
- **Files modified:** `packages/adapters/src/schwab/trader/trader-adapter.test.ts`
- **Commit:** c2ea80d

**2. [Rule 2 - Missing Correctness] makeMcpRouter extended with optional params to preserve backward compat**

- **Found during:** Implementing server.ts extension
- **Issue:** mcp.test.ts calls `makeMcpRouter` with 4 args; adding 3 required params would break 19 existing tests
- **Fix:** Made `getPositions`, `getTransactions`, `getOrders` optional params; tools only registered when defined
- **Files modified:** `apps/server/src/adapters/mcp/server.ts`
- **Commit:** 10b0b6a

### Design Decisions

**D-09 Shape: 200 with paused payload (not 503)**

The plan said "200 with typed empty/paused payload or documented 503 — pick one shape". Chose `{paused:true,reason:"AUTH_EXPIRED"}` encoded in `brokerageAuthExpiredPayload` Zod schema. Rationale: 503 signals infrastructure failure; AUTH_EXPIRED is a known business state that clients should handle gracefully. The paused shape is parsed through the same Zod schema on both HTTP route and MCP tool surfaces.

**traderGetAccessToken closure**

Main.ts uses a closure that calls `brokerTokensRepo.readTokens("trader")` at call time (not at server startup). On-demand token refresh (JOB-02) deferred to Phase 5. Returns `err({kind:"auth-expired"})` for null/missing rows, satisfying D-09.

## Threat Surface Mitigations

| Threat | Mitigation Applied |
|--------|-------------------|
| T-04-18: Schwab response tampering | Zod safeParse at all adapter boundaries; failed parse → Result.err, never throw |
| T-04-19: Token in logs | Bearer token never logged; only {kind,message} returned on error |
| T-04-20: Raw account number in URLs | ForResolvingAccountHash fetches hashValue first; adapters receive hash not number |
| T-04-21: AUTH_EXPIRED DoS on trader | getAccessToken checked first before fetch; paused payload returned without network call |
| T-04-22: Accidental order placement | Only GET endpoints implemented; no write/trade routes in brokerage.routes.ts |

## Known Stubs

None — all three data adapters wired with real Schwab API URLs. The `traderGetAccessToken` closure reads from broker_tokens at call time; live responses require a funded account with valid tokens (human-gated per the plan's `<human-check>`).

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| packages/adapters/src/schwab/trader/account-hash.ts | FOUND |
| packages/adapters/src/schwab/trader/positions-adapter.ts | FOUND |
| packages/adapters/src/schwab/trader/transactions-adapter.ts | FOUND |
| packages/adapters/src/schwab/trader/orders-adapter.ts | FOUND |
| packages/adapters/src/memory/schwab-trader.ts | FOUND |
| packages/core/src/brokerage/application/getPositions.ts | FOUND |
| packages/core/src/brokerage/application/getTransactions.ts | FOUND |
| packages/core/src/brokerage/application/getOrders.ts | FOUND |
| packages/contracts/src/brokerage.ts | FOUND |
| apps/server/src/adapters/http/brokerage.routes.ts | FOUND |
| RED commit 7f4dcbd (adapter tests) | FOUND |
| GREEN commit 2fcc239 (adapters) | FOUND |
| RED commit 7354383 (use-case tests) | FOUND |
| GREEN commit 74b0861 (use-cases) | FOUND |
| RED commit db099e1 (routes test + contracts) | FOUND |
| GREEN commit 3a675ff (routes) | FOUND |
| GREEN commit 10b0b6a (MCP tools) | FOUND |
| GREEN commit c2ea80d (wiring + lint fix) | FOUND |
| bun run test: 551/551 | PASS |
| bun run typecheck: exit 0 | PASS |
| bunx eslint changed files: 0 errors | PASS |
