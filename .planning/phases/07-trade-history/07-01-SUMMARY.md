---
phase: 07-trade-history
plan: 01
subsystem: testing
tags: [mcp, vitest, zod, contracts, brokerage, schwab]

# Dependency graph
requires:
  - phase: 04-brokerage (BRK-02)
    provides: get_transactions MCP tool, getTransactions use-case, transactionsResponse contract, HTTP GET /api/transactions
provides:
  - Behavioral test coverage for the get_transactions MCP tool (valid-range, default-90d, AUTH_EXPIRED, contract parity)
  - get_transactions documented in docs/architecture/mcp-and-plugins.md tool-surface table
  - Verified MCP-02 parity is enforced at RUNTIME (not compile time) for the transactions contract
affects: [07-02-backfill, mcp-tools, brokerage]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reflect-handler test pattern: reach a registered MCP tool handler via Reflect.get(server, '_registeredTools') and Reflect.apply, narrowing through unknown (no any/as/!)"
    - "Faked function-type use-case at the seam stands in for the msw'd Schwab adapter (offline test)"
    - "Mutation-test to confirm TDD RED discipline when verifying pre-existing production code"

key-files:
  created:
    - apps/server/src/adapters/mcp/get-transactions.test.ts
  modified:
    - docs/architecture/mcp-and-plugins.md

key-decisions:
  - "MCP-02 'one-sided change fails typecheck' is NOT true for a transactions field rename — parity is enforced at runtime by transactionsResponse.parse(), not at compile time, because both bind sites pass into Zod .parse(unknown). Documented as a finding; Test D is the real backstop."
  - "Used `bun run vitest run get-transactions` from repo root — apps/server has no test script; the plan's `cd apps/server && bun run test` command does not exist."

patterns-established:
  - "Reflect-handler MCP tool test: mirrors mcp.test.ts getTriggerJobHandler for any new tool needing handler-level coverage"
  - "Captured-args fake to assert the default-window a handler computes (default-90d verification)"

requirements-completed: [BRK-03]

# Metrics
duration: 6min
completed: 2026-06-23
status: complete
---

# Phase 7 Plan 01: Verify + Document get_transactions MCP Tool Summary

**Behavioral test coverage (valid-range, default-90d, AUTH_EXPIRED paused payload, contract parity) for the existing get_transactions MCP tool, plus its tool-surface doc entry — proving BRK-03 acceptance against the Phase 4 tool without rebuilding it.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-23T02:17:05Z
- **Completed:** 2026-06-23T02:22:31Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Documented `get_transactions` in the MCP architecture tool-surface table (docs-first): mirrors `GET /api/transactions`, optional from/to (default last 90d), shared `transactionsResponse` contract, AUTH_EXPIRED paused payload.
- Added 4 behavioral tests against the existing tool (all pass): Test A valid-range → contract-valid payload; Test B default last-90d window ending today; Test C AUTH_EXPIRED → typed `brokerageAuthExpiredPayload` (no throw); Test D MCP-02 runtime parity backstop.
- Verified TDD RED discipline by mutation-testing the handler (broke the 90d default → Test B failed with a real assertion error, not an import error).
- Surfaced a genuine finding: the MCP-02 "one-sided change fails typecheck" claim does not hold for a transactions field rename — parity is enforced at **runtime**, not compile time.
- Full workspace suite green: 103 files, 949 tests pass (incl. testcontainers Postgres).

## Task Commits

Each task was committed atomically:

1. **Task 1: Docs-first — document get_transactions in MCP architecture doc** - `acdccdf` (docs)
2. **Task 2: Behavioral tests for the get_transactions MCP tool** - `3a5ae04` (test)

_Note: The production tool already existed (Phase 4 / BRK-02), so the TDD GREEN step was reaching the existing handler correctly — no new tool code. RED discipline was confirmed via mutation-testing rather than a temporary failing implementation, since the implementation already exists._

## Files Created/Modified
- `apps/server/src/adapters/mcp/get-transactions.test.ts` (created) - 4 behavioral tests for the get_transactions MCP tool via the Reflect-handler pattern; faked function-type use-case at the seam (no live Schwab).
- `docs/architecture/mcp-and-plugins.md` (modified) - Added `get_transactions` row + descriptive sentence to the tool-surface table.

## Decisions Made
- **MCP-02 parity is runtime, not compile-time, for this contract.** Renaming a `brokerTransaction` field (e.g. `tradeDate` → `tradeDateX`) and rebuilding declarations did NOT fail `bun run typecheck`, because both the HTTP route and the MCP tool feed data into `transactionsResponse.parse(...)` whose input type is `unknown`. The same rename DOES fail the get-transactions tests at runtime (parse throws). Test D is therefore the actual MCP-02 backstop. Kept the tool/contract unchanged — this is an expectation gap in the SPEC, not a tool defect.
- **Test runner command corrected.** `apps/server/package.json` has only a `dev` script; tests run through the root vitest workspace. Used `bun run vitest run get-transactions` from the repo root instead of the plan's `cd apps/server && bun run test get-transactions`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected the test-run command**
- **Found during:** Task 2 (running the verify step)
- **Issue:** The plan's verify command `cd apps/server && bun run test get-transactions` cannot run — `apps/server` has no `test` script; tests are run by the root vitest workspace.
- **Fix:** Ran `bun run vitest run get-transactions` from the repo root.
- **Files modified:** None (command-only).
- **Verification:** Command runs the single test file; 4/4 pass.
- **Committed in:** N/A (no file change)

---

**Total deviations:** 1 (1 blocking command correction)
**Impact on plan:** No scope creep. Tool and contract unchanged. The MCP-02 compile-time expectation was tested as the plan's `<verification>` requested and found to be runtime-enforced — recorded as a finding, no code change made.

## Issues Encountered
- **Stale prebuilt declarations masked the MCP-02 break test initially.** `@morai/contracts` resolves its `types` to `dist/index.d.ts` (gitignored prebuilt artifacts). Editing `src` alone left typecheck reading stale declarations. Rebuilt declarations (`tsc --emitDeclarationOnly`) before retesting; even with fresh declarations the rename did not trip typecheck — leading to the runtime-parity finding above. `dist/` reverted to clean state after testing.
- No tool defect found. The existing Phase 4 `get_transactions` tool passes all four behavioral tests as written.

## Known Stubs
None.

## Threat Flags
None — no new network endpoint, auth path, or schema introduced. The tool, contract, and wiring were unchanged; only a test and a doc entry were added.

## User Setup Required
None - no external service configuration required. Tests are fully offline (faked use-case at the seam).

## Next Phase Readiness
- BRK-03 verified and documented. The `get_transactions` MCP tool is now contract-locked by behavioral tests.
- Ready for 07-02 (BRK-04 historical backfill of `sync-transactions`).
- **Note for future hardening:** if compile-time MCP-02 enforcement is desired, the bind sites would need to consume the inferred `TransactionsResponse` output type into a typed variable rather than only passing data into `.parse(unknown)`. Out of scope for this plan.

---
*Phase: 07-trade-history*
*Completed: 2026-06-23*

## Self-Check: PASSED
- FOUND: apps/server/src/adapters/mcp/get-transactions.test.ts
- FOUND: docs/architecture/mcp-and-plugins.md
- FOUND: .planning/phases/07-trade-history/07-01-SUMMARY.md
- FOUND commit: acdccdf (Task 1 docs)
- FOUND commit: 3a5ae04 (Task 2 tests)
