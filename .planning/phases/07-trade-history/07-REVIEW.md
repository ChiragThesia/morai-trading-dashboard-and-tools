---
phase: 07-trade-history
reviewed: 2026-06-22T21:40:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - packages/core/src/journal/application/chunkDateRange.ts
  - apps/worker/src/backfill-transactions.ts
  - apps/server/src/adapters/mcp/get-transactions.test.ts
  - packages/core/src/journal/application/chunkDateRange.test.ts
  - packages/core/src/journal/application/chunkDateRange.property.test.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-06-22T21:40:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found (no blockers)

## Summary

Reviewed the Phase 7 (Trade History) delta: the pure `chunkDateRange` date-window
chunker (BRK-04), the `backfill-transactions` CLI + orchestrator (BRK-04), and the
`get-transactions` MCP tool behavioral tests (BRK-03).

**Core verdict on the highest-risk item (`chunkDateRange`): correct.** I traced the
date math by hand and against fast-check. All boundary invariants hold:
- Contiguous, no gaps, no overlap-dupes (each day in exactly one window) — verified
  by the property tests (numRuns=1000) and worked examples.
- `first.from === from`, `last.to === to`, `next.from === prev.to + 1 day`.
- Every window ≤ maxDays inclusive; ragged last chunk handled; single-day and
  exact-multiple cases covered.
- Typed `err` on `maxDays <= 0`, `from > to`, AND malformed date strings
  (`Number.isNaN` guard — a real safety net the SPEC didn't even ask for).
- UTC-only math (`...T00:00:00Z` + `.toISOString().slice(0,10)`) — no local-time/DST
  drift, no leap-day off-by-one. Confirmed leap boundaries (2024-02-28→03-01) chunk
  correctly via the property test's 2020-base span generator.
- Hexagon-pure: imports only `@morai/shared`, no `node:*`. Compliant.

I ran all 23 tests across the 4 reviewed test files — **all pass** (1.16s).

The over-cap policy writes nothing on rejection (checks ordered before the chunk loop),
idempotency rides on `syncTransactions`' deterministic `(activityId:legIndex)` ids
(unchanged by the backfill loop), and there are **no `any`/`as`/`!` violations** (only
`as const`, which the rules permit). No blockers.

The findings below are robustness, coverage, and design-smell issues — the
no-blocker bill is genuine, but the warnings are real and should be addressed.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: CLI accepts and forwards unvalidated date strings (no YYYY-MM-DD format check)

**File:** `apps/worker/src/backfill-transactions.ts:148-156`
**Issue:** The CLI only checks `from`/`to` are non-empty, then forwards them straight to
`runBackfill`. A caller passing `01/01/2026`, `2026-1-1`, or `2026-13-40` gets no
format validation at the boundary. The hexagon's `chunkDateRange` does catch malformed
dates via `Number.isNaN(fromMs)` and returns a typed err, so the failure is surfaced
(`console.error` + `exit 1`), NOT silent — which is why this is a warning, not a
blocker. But note `new Date("2026-13-40T00:00:00Z")` does NOT produce NaN in all engines
(JS Date rolls some out-of-range components over), so a "valid-looking but wrong" date
could chunk a range the operator never intended without any signal. The rules require
"Parse, don't cast — every external input goes through Zod before use"
(typescript.md). `process.argv` is external input and is not Zod-parsed.
**Fix:** Parse args with a Zod schema at the composition root before calling
`runBackfill`:
```ts
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const argSchema = z.object({ from: ymd, to: ymd });
const parsed = argSchema.safeParse({ from: rawFrom ?? "", to: rawTo ?? "" });
if (!parsed.success) {
  console.error(`backfill-transactions: ${parsed.error.issues[0]?.message ?? "bad args"}`);
  process.exit(1);
}
```

### WR-02: `get-transactions.test.ts` does not cover the non-auth fetch-error branch

**File:** `apps/server/src/adapters/mcp/get-transactions.test.ts:97-170`
**Issue:** Tests A/B/C/D cover success, default-90d, AUTH_EXPIRED, and contract parity —
but NOT the `result.error.kind !== "auth-expired"` branch in the handler
(`tools.ts:419`), which returns the plain string `"internal error"` (not JSON, not a
contract payload). An MCP client doing `JSON.parse(text)` on that branch throws. The
test suite gives false confidence that "errors are handled" when one error shape is
actually a JSON.parse landmine for the client, and it is the one branch with no
assertion. (The shape is inherited from the Phase-4 `get_orders` pattern, so it is not a
Phase-7 regression — but it is now in scope because BRK-03 asks for the transactions
tool's error handling to be verified.)
**Fix:** Add a test feeding `err({ kind: "fetch-error", message: "..." })` and assert
the handler does not throw and returns content the client can handle. Separately,
consider making the non-auth branch emit a structured JSON error envelope rather than a
bare string so clients can always `JSON.parse`.

### WR-03: Default-90d test (Test B) has a midnight-UTC flakiness window

**File:** `apps/server/src/adapters/mcp/get-transactions.test.ts:115-135`
**Issue:** The handler computes `to = new Date().toISOString().slice(0,10)` internally;
the test then computes `today = new Date().toISOString().slice(0,10)` separately and
asserts `seenTo === today`. If the run crosses UTC midnight between the handler call and
the test's `new Date()`, `seenTo` is yesterday and `today` is the new day → the test
fails spuriously. Low probability but real, and the codebase elsewhere injects `now`
specifically to avoid this. (`daysBetween(seenFrom, seenTo) === 90` is internally
consistent and safe; only the `=== today` line is exposed.)
**Fix:** Either inject a `now` clock into the tool (preferred — makes the default-window
math deterministic and testable) or, minimally, snapshot once and assert against a
freshly-computed expected from the SAME snapshot in the test. If injection is out of
scope, assert `seenTo` is one of `{yesterday, today}` to close the boundary.

### WR-04: Over-cap span cap equals per-window cap → chunking never splits in production

**File:** `apps/worker/src/backfill-transactions.ts:104-110, 214`
**Issue:** `SCHWAB_TX_LOOKBACK_MAX_DAYS = 365` is used BOTH as the total-span rejection
threshold (line 105) AND as the per-window `maxDays` the CLI passes (line 214). Any span
that survives the over-cap guard (≤ 365 inclusive days) therefore always produces
exactly ONE chunk of ≤ 365 days — the multi-window loop never iterates more than once in
the real CLI. The chunk-splitting behavior is only ever exercised by tests that override
`maxDays: 30`. This is not a correctness bug (output is right), but it means: (a) the
central feature of BRK-04 ("chunked into windows within Schwab's cap") is effectively
inert in production, and (b) if Schwab's true *per-call* range limit is smaller than its
*lookback* limit (the SPEC notes "caps lookback AND range-per-call"), production calls
could exceed the per-call cap with no chunking to save them. The SPEC distinguishes the
two caps; the code collapses them into one constant.
**Fix:** If Schwab's per-call range limit differs from the lookback limit, introduce a
separate `SCHWAB_TX_MAX_DAYS_PER_CALL` and pass THAT as `maxDays` while keeping the
365-day lookback as the total-span guard — then chunking actually does work in
production. If they are genuinely identical, add a comment stating so explicitly and
note that chunking is a defensive no-op, so a future reader does not assume it splits.

## Info

### IN-01: `DAY_MS` and UTC date-parsing duplicated across files

**File:** `apps/worker/src/backfill-transactions.ts:43,77-81` and `packages/core/src/journal/application/chunkDateRange.ts:39,42-44`
**Issue:** `const DAY_MS = 86_400_000` is defined in both files, and `inclusiveDays`
re-implements the same `new Date(ymd + "T00:00:00Z").getTime()` parsing already present
as `toEpochMs` inside `chunkDateRange`. Two copies of date math is exactly the kind of
drift that produces boundary bugs later.
**Fix:** Export a small pure `inclusiveDays(from, to)` (or the day-parse helper) from
core alongside `chunkDateRange` and reuse it in the backfill, so the cap check and the
chunker share one date-math implementation.

### IN-02: Dead/misleading `accountHash` dep in the CLI wiring

**File:** `apps/worker/src/backfill-transactions.ts:189-201, 210`
**Issue:** `accountHash: "resolved-at-call-time"` is passed into `runBackfill`, but the
production `fetchTransactionsResolved` ignores its first arg (`_accountHash`) and
re-resolves the hash per call. The deps field is a placeholder string that does nothing
in this wiring — confusing for a reader who assumes the passed `accountHash` is
authoritative.
**Fix:** Either document inline why `accountHash` is unused on the CLI path (the resolver
is authoritative) or drop `accountHash` from `RunBackfillDeps` and have the orchestrator
not thread an account hash it never meaningfully uses. (The use-case factory takes it, so
this needs a small refactor — acceptable to leave with a clarifying comment.)

### IN-03: BRK-02/BRK-03 requirement-id drift between SPEC, tool comment, and test

**File:** `apps/server/src/adapters/mcp/tools.ts:377` and `get-transactions.test.ts:6`
**Issue:** The SPEC Background asserts NO `get_transactions` MCP tool existed and frames
it as new work (BRK-03). The tool comment labels it BRK-02 ("Phase 4"), and the test
header says the tool "already exists (BRK-02)". The tool IS registered (server.ts:85) and
the tests verify it, so behavior is fine — but the requirement-id provenance is
inconsistent across three artifacts, which will confuse traceability audits.
**Fix:** Reconcile the SPEC Background with reality (the tool predated this phase; Phase 7
added the verifying tests + the backfill). One-line correction in the SPEC or a note in
the phase SUMMARY.

---

_Reviewed: 2026-06-22T21:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
