# Phase 7: Trade History (raw view + backfill) — Specification

**Created:** 2026-06-22
**Ambiguity score:** 0.13 (gate: ≤ 0.20)
**Requirements:** 2 locked (BRK-03, BRK-04)

## Goal

Expose the user's Schwab trade transactions through an MCP `get_transactions` tool (date-ranged, over the existing shared contract), and add a historical **backfill** entrypoint that runs `sync-transactions` over an arbitrary past date range (chunked to Schwab's lookback cap, idempotent) so trade history flows into `fills` → calendar events. Both are buildable and testable OFFLINE (msw + testcontainers); live execution depends on Schwab auth + a healthy deploy, which are out of this phase's code scope.

## Background

Phase 4 built the read path: `getTransactions(from, to)` use-case (`brokerage/application/getTransactions.ts`) → Schwab transactions adapter (`GET /trader/v1/accounts/{hash}/transactions?startDate&endDate&types=TRADE`, arbitrary range) → HTTP `GET /transactions?from=&to=` (default last 90d) → shared `transactionsResponse` Zod contract. Phase 5 built `sync-transactions` (`BrokerTransaction[]` → `fills` rows, idempotent via deterministic ids) wired to a rolling 7-day window in `apps/worker/src/main.ts`. **Two gaps:** (1) despite the contract comment claiming HTTP↔MCP parity, NO brokerage MCP tool is registered — `apps/server/src/adapters/mcp/tools.ts` registers only `get_status`, `list_calendars`, `get_journal`, `get_live_greeks`, `get_term_structure`, `get_skew`, `trigger_job`; `get_transactions` does not exist as an MCP tool. (2) `sync-transactions` only ever runs a rolling 7-day window — there is no way to pull history.

## Requirements

1. **BRK-03 — `get_transactions` MCP tool**: pull trade transactions for a date range via MCP.
   - Current: `getTransactions` use-case + HTTP route + `transactionsResponse` contract exist; no MCP tool wraps them.
   - Target: a `get_transactions` MCP tool accepting optional `from`/`to` (YYYY-MM-DD; default last 90 days, mirroring the HTTP route) that calls the SAME `getTransactions` use-case and returns the SAME `transactionsResponse` schema from `@morai/contracts` (MCP-02). AUTH_EXPIRED → the typed `brokerageAuthExpiredPayload` (not an error/throw). Registered on the MCP server.
   - Acceptance: with the Schwab adapter mocked (msw), the MCP tool returns a `transactionsResponse`-valid payload for a given range; a one-sided contract field change fails `bun run typecheck`; AUTH_EXPIRED input yields the typed paused payload.

2. **BRK-04 — historical trade-history backfill**: run `sync-transactions` over an arbitrary past range.
   - Current: `sync-transactions` is wired only to a rolling 7-day window; no historical entrypoint.
   - Target: a backfill entrypoint (CLI, e.g. `apps/worker/src/backfill-transactions.ts`, run via a `bun run` script) that runs the `sync-transactions` use-case over a caller-supplied `[from, to]`, automatically **chunked** into windows within Schwab's transactions lookback cap (≤ 1 year per call; document the resolved cap), writing `fills`. Idempotent — re-running the same range produces no duplicate `fills` rows (deterministic fill ids). It does NOT itself require live auth to build/test (msw + in-memory/testcontainer twins); a live run needs valid tokens.
   - Acceptance: with mocked transactions spanning multiple chunks, the backfill writes the expected `fills` for the full range (chunk boundaries correct, no gaps/overlap-dupes); a second run over the same range adds 0 rows (idempotency, testcontainer or in-memory twin).

## Boundaries

**In scope:**
- `get_transactions` MCP tool (date-ranged) over the existing shared contract (MCP-02 completion for transactions).
- Historical backfill CLI for `sync-transactions` (chunked, idempotent) — populates `fills`; existing `sync-fills` / `rebuild-journal` journal them into calendar events.
- Schwab lookback chunking logic + documentation of the cap.
- Tests: msw for the Schwab adapter path; in-memory/testcontainer for fills idempotency.

**Out of scope:**
- The live Schwab OAuth dance — operator-interactive, prerequisite for a live run, not code (deferred).
- The prod deploy fix (Railway db-down / redeploy) — ops, tracked separately.
- `get_positions` / `get_orders` MCP tools — same pattern; trivial follow-up, not required by the trades ask (note them, don't build unless free).
- Calendar registration / leg-matching changes — backfilled trades that don't match a registered calendar park as orphans (existing `sync-fills` behavior); journaling completeness is a calendar-setup concern, not this phase.
- Any web UI.

## Constraints

- MCP-02: `get_transactions` MUST reuse the one `transactionsResponse` schema in `@morai/contracts` (no second/inline schema); a one-sided change fails typecheck.
- Hexagon: backfill chunking that is pure logic (date-window math) lives in `packages/core` (imports only `@morai/shared`); the CLI is a thin driving adapter; Schwab HTTP stays in the adapter; no `any`/`as`/`!`.
- Idempotency: backfill relies on `sync-transactions`' deterministic fill ids; re-run over any range = 0 new rows.
- Schwab transactions API caps lookback (~1 year) and range-per-call — chunk accordingly; surface a clear error if a requested range exceeds what Schwab allows rather than silently truncating.
- TDD: msw at the network layer for the Schwab adapter; testcontainers (or in-memory twin) for fills idempotency; fast-check for the chunking date-window math.

## Acceptance Criteria

- [ ] `get_transactions` MCP tool registered; returns `transactionsResponse`-valid data for a date range (msw); default last-90d when params omitted.
- [ ] `get_transactions` shares the `@morai/contracts` schema with the HTTP route; one-sided change fails typecheck (MCP-02).
- [ ] `get_transactions` AUTH_EXPIRED → typed `brokerageAuthExpiredPayload`, no throw.
- [ ] Backfill CLI runs `sync-transactions` over `[from,to]`, chunked within the Schwab lookback cap, writing `fills` for the full range with correct chunk boundaries.
- [ ] Backfill is idempotent — second run over the same range adds 0 `fills` rows.
- [ ] Chunking date-window math covered by fast-check (no gaps, no overlap-dupes, respects cap).
- [ ] `bun run typecheck` + `bun run lint` clean; full suite green.

## Edge Coverage

**Coverage:** 5/5 applicable edges resolved · 0 unresolved

| Category | Requirement | Status | Resolution / Reason |
|----------|-------------|--------|---------------------|
| Idempotency | BRK-04 | ✅ covered | re-run → 0 rows (deterministic fill ids); acceptance + test |
| Chunk boundaries | BRK-04 | ✅ covered | fast-check window math: no gaps/overlap-dupes; respects cap |
| Lookback cap exceeded | BRK-04 | ✅ covered | surface a clear error, don't silently truncate (constraint) |
| Contract parity | BRK-03 | 🧪 backstop | one-sided change fails typecheck — compile-level check |
| AUTH_EXPIRED | BRK-03 | ✅ covered | typed paused payload, not throw (acceptance) |

## Prohibitions (must-NOT)

**Coverage:** 3/3 applicable prohibitions resolved · 0 unresolved

| Prohibition (must-NOT statement) | Requirement | Status | Verification / Reason |
|----------------------------------|-------------|--------|------------------------|
| MUST NOT define a second/inline transactions schema for MCP | BRK-03 | resolved / test | reuse `transactionsResponse`; one-sided change fails typecheck |
| MUST NOT silently truncate a requested range beyond Schwab's cap | BRK-04 | resolved / test | explicit error; test asserts it |
| MUST NOT double-write fills on backfill re-run | BRK-04 | resolved / test | idempotency test (0 new rows) |

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                            |
|--------------------|-------|------|--------|--------------------------------------------------|
| Goal Clarity       | 0.88  | 0.75 | ✓      | MCP tool + chunked backfill, both well-defined   |
| Boundary Clarity   | 0.88  | 0.70 | ✓      | auth/deploy/UI/positions-orders explicitly out   |
| Constraint Clarity | 0.82  | 0.65 | ✓      | MCP-02, hexagon, lookback chunking, idempotent   |
| Acceptance Criteria| 0.85  | 0.70 | ✓      | 7 falsifiable criteria                            |
| **Ambiguity**      | 0.13  | ≤0.20| ✓      |                                                  |

## Interview Log

| Round | Perspective     | Question summary                          | Decision locked                                                  |
|-------|-----------------|-------------------------------------------|------------------------------------------------------------------|
| 1     | Researcher      | Does a trades read path exist?            | Yes — getTransactions use-case + HTTP + contract; NO MCP tool    |
| 2     | Simplifier      | Raw view, journaled, or both?             | Both — get_transactions MCP first, backfill-to-journal next      |
| 3     | Boundary Keeper | Build now vs wait on auth/deploy?         | Build offline now (msw/testcontainers); auth + deploy are yours  |
| 3     | Boundary Keeper | positions/orders MCP tools too?           | Out of scope — transactions only; trio is a trivial follow-up    |
| 4     | Failure Analyst | Schwab lookback limit?                     | Chunk ≤ 1yr/call; error (not truncate) if range exceeds the cap  |

---

*Phase: 07-trade-history*
*Spec created: 2026-06-22*
*Next step: plan → execute (offline, TDD); live pull after operator does Schwab auth + deploy fix*
