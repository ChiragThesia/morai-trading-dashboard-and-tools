---
phase: 07-trade-history
kind: review-fixes
source: 07-REVIEW.md
status: complete
date: 2026-06-22
---

# Phase 7 Review Fixes

Focused fix round for the warnings + cheap info items in
[07-REVIEW.md](07-REVIEW.md). No new plan — direct review-fix on the MAIN working tree
(branch `plan/07-trade-history`), atomic commit per fix at green. All four warnings and
all three info items addressed. No architectural changes (no Rule 4 escalations).

## Fixes Applied

| ID | What | Commit |
|----|------|--------|
| IN-01 + WR-04 (core) | Export `inclusiveDays` from `chunkDateRange` (one date-math impl); add `SCHWAB_TX_MAX_RANGE_DAYS` (per-call window) distinct from `SCHWAB_TX_LOOKBACK_MAX_DAYS` (total span), both as core domain constants | `88ef285` |
| WR-01 + WR-04 (wiring) + IN-01 + IN-02 | Zod-parse CLI `<from>`/`<to>` as real YYYY-MM-DD dates at the composition root; wire `SCHWAB_TX_MAX_RANGE_DAYS` as the per-call `maxDays` so chunking splits in production; reuse core `inclusiveDays`; document the per-call account-hash resolution; update `docs/architecture/jobs.md` | `ef2a1a0` |
| WR-02 | `get_transactions` fetch-error branch now returns `JSON.stringify({ error })` instead of a bare `"internal error"` string (JSON.parse-safe for clients); add Test E | `2120b26` |
| WR-03 | Stabilize default-90d test: accept `seenTo ∈ {yesterday, today}` instead of strict `=== today`; the 90-day span stays the deterministic check | `076db38` |
| IN-03 | Reconcile `get_transactions` req-id to BRK-03 (Phase 7) in tool comment + test header (SPEC frames it as new work; Phase 4 built only the read path) | `d31f32e` |

## Details

### WR-01 — Parse, don't cast (CLI args)
`apps/worker/src/backfill-transactions.ts`. `process.argv` `from`/`to` now go through a
Zod schema (`/^\d{4}-\d{2}-\d{2}$/` + a `.refine` round-trip guard that rejects JS Date
rollovers like `2026-13-40`) before `runBackfill`. Invalid input → clear per-field error
+ `exit 1`, never a silently-rolled-over range.

### WR-02 — Structured error payload (MCP client landmine)
`apps/server/src/adapters/mcp/tools.ts`. The non-auth (`fetch-error`) branch of
`registerGetTransactionsTool` emitted a bare `"internal error"` string — an MCP client
doing `JSON.parse(text)` would throw. It now emits the `{ error }` envelope already used
elsewhere in the file (the `"invalid params"` branch). MCP-02 success path untouched (no
second schema). Test E feeds `err({ kind: "fetch-error" })` and asserts the result is
JSON-parseable with a string `error` field.

### WR-03 — Default-90d midnight-UTC flake
`apps/server/src/adapters/mcp/get-transactions.test.ts`. The handler has no injected
clock; a UTC-midnight crossing between the handler's `new Date()` and the test's could
flip `seenTo` by a day. Clock injection was out of scope (larger refactor on a Phase-4
read path), so the minimal close is `expect([yesterday, today]).toContain(seenTo)`. The
`daysBetween(seenFrom, seenTo) === 90` assertion is internally consistent and remains the
real check.

### WR-04 — Chunking now exercised in production
The over-cap guard and the per-window `maxDays` were the same constant (365), so any
within-lookback range produced exactly one chunk — the multi-window loop never iterated
outside tests. Split into two cohesive core domain constants:
`SCHWAB_TX_LOOKBACK_MAX_DAYS = 365` (total-span rejection) and
`SCHWAB_TX_MAX_RANGE_DAYS = 90` (per-call window passed to `chunkDateRange`). Because the
per-call cap is smaller, the chunk loop actually splits in production. A comment flags
that the 90-day per-call value must be CONFIRMED against Schwab's real limit on the first
live run. `docs/architecture/jobs.md` updated to describe the two caps. New test asserts a
~181-day within-lookback span splits into >1 window each ≤ 90 days.

### IN-01 — Deduped date math
`inclusiveDays` and `DAY_MS` were duplicated in the worker CLI and core. The worker now
imports `inclusiveDays` from `@morai/core` (shares `chunkDateRange`'s `toEpochMs`/`DAY_MS`).
A core test asserts `inclusiveDays` agrees with `chunkDateRange`'s window coverage (no
off-by-one drift).

### IN-02 — Dead accountHash placeholder
`fetchTransactionsResolved` ignores its first arg and re-resolves the hash per call. The
sentinel value passed to `runBackfill` is renamed to
`"resolved-per-call-see-fetchTransactionsResolved"` with an inline comment explaining the
resolver is authoritative on the CLI path. Left in place (the use-case factory requires
the field) rather than refactored — a clarifying comment was the cheap, correct fix.

### IN-03 — Req-id drift
The tool comment + test header labelled `get_transactions` as BRK-02 / "already exists
(Phase 4)". The 07-SPEC Background explicitly frames the MCP tool as new BRK-03 work
(Phase 4 built only the use-case + HTTP route + contract, no MCP tool). The SPEC is
authoritative and internally consistent; both comments were aligned to BRK-03.

## Skipped

None. All four warnings and all three info items were addressed. Clock injection for
WR-03 (the reviewer's "preferred" option) was deliberately not done — it is a larger
refactor on a Phase-4 read-path tool, outside a focused review-fix round; the tolerance
window closes the actual flake.

## Verification

- `bun run typecheck` — clean (tsc --build --force, no errors)
- `bun run lint` — clean (eslint ., no errors; only pre-existing boundary-plugin
  deprecation warnings)
- `bun run test` — **976 passed (106 files)**, full vitest workspace incl. testcontainers

No `any`/`as`/`!` introduced. Hexagon respected: `inclusiveDays` + both Schwab caps live
in `@morai/core` (imports only `@morai/shared`); the CLI stays a thin composition root.

## Self-Check: PASSED

- All five commits present in `git log` (`88ef285`, `ef2a1a0`, `2120b26`, `076db38`, `d31f32e`).
- All touched files exist and compile.
