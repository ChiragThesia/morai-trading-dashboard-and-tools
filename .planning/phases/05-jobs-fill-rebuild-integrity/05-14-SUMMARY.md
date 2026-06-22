---
phase: 05-jobs-fill-rebuild-integrity
plan: 14
subsystem: jobs + journal
tags: [mcp, contracts, fills, hexToUuid, gap-closure, security]
requires:
  - triggerJobBodyFor (packages/contracts)
  - hexToUuid call site (packages/core syncTransactions)
provides:
  - MCP trigger_job rejects rebuild-journal without calendarId before enqueue (CR-A1)
  - collision-free deterministic fill ids — total nibble mapping (WR-A3)
  - extractLastError direct narrow (IN-A1)
affects:
  - apps/server MCP surface
  - fills.id derivation on the trade-ledger path
tech-stack:
  added: []
  patterns:
    - both adapter surfaces (HTTP + MCP) share one per-job contract (architecture-boundaries §9)
key-files:
  created: []
  modified:
    - apps/server/src/adapters/mcp/tools/trigger-job.ts
    - apps/server/src/adapters/mcp/mcp.test.ts
    - packages/core/src/journal/application/syncTransactions.ts
    - packages/core/src/journal/application/syncTransactions.test.ts
    - packages/adapters/src/postgres/repos/job-runs.ts
decisions:
  - "MCP trigger_job routes through triggerJobBodyFor(name) — same refinement the HTTP route uses"
  - "fills.id is a plain Postgres uuid → drop the RFC-4122 v5 version/variant rewrite that caused the dropped nibble"
  - "IN-A2 (real commission/fees + intraday filledAt) deferred: needs a docs-first brokerage domain change"
metrics:
  duration: ~25m
  completed: 2026-06-22
---

# Phase 5 Plan 14: Round-2 Gap Closure (CR-A1, WR-A3, IN-A1) Summary

Closed the round-2 BLOCKER and two independent warnings on the jobs + journal path:
the agent-driven MCP queue-flood (rebuild-journal without calendarId), the silent fill-drop
hash collision (dropped nibble 12), and a cosmetic job-runs narrow — all TDD red→green.

## What Was Built

### Task 1 — CR-A1: MCP/HTTP parity for trigger_job (commit e8de7a0)

The WR-04 fix was half-applied: the HTTP route required `calendarId` for `rebuild-journal`
via `triggerJobBodyFor(name)`, but the MCP `trigger_job` tool validated with an inline
`calendarId.optional()` schema and never called the refinement. So
`trigger_job {name:"rebuild-journal"}` with no calendarId still enqueued a null-keyed,
un-deduplicated rebuild — the exact queue flood WR-04 was raised to close, reachable through
the agent-driven MCP surface (a Claude tool loop).

Fix: the handler now (1) validates the job name against `z.enum(TRIGGERABLE_JOBS)`, then
(2) once the name is known, parses the calendarId-bearing body with
`triggerJobBodyFor(name).safeParse({ calendarId })` — exactly mirroring `jobs.routes.ts`.
On parse failure it returns MCP error content and **never calls enqueueJob**. The advertised
`inputSchema` shape is unchanged (`name` + `triggerJobPayload.shape.calendarId`), so the
MCP-02 single schema source is preserved. No `any`/`as`/`!` — the raw calendarId is read via
`Reflect.get(Object(args), "calendarId")`.

Tests (mcp.test.ts) reach the handler via the same Reflect pattern the CR-02 tests use, with
an injected enqueueJob spy:
- rebuild-journal, no calendarId → error content, enqueue spy NOT called (the blocker).
- rebuild-journal + valid uuid → enqueues once with the calendarId; returns `{ jobId }`.
- sync-fills, no calendarId → still enqueues once (calendarId stays optional for non-rebuild).

### Task 2 — WR-A3: total-nibble hexToUuid (commit 3567199)

`hexToUuid` set the UUID version to 5 via `"5" + h.slice(13,16)`, which **skipped input nibble
index 12**. Two distinct `(activityId, legIndex)` keys differing only at nibble 12 collided on
the fills `id` PK, and the second real fill was silently dropped by `onConflictDoNothing`.

Fix: lay the 32-nibble prefix into the canonical 8-4-4-4-12 positions **contiguously**
(`h[12..16)` is the third group, no skipped nibble) and remove the version/variant rewrite —
`fills.id` is a plain Postgres `uuid`, not validated as RFC-4122 v5, so the synthesized
version/variant digits were both unnecessary and the source of the dropped nibble. The function
stays pure (hasher injected). `hexToUuid` is now exported for direct testing.

Tests:
- collision regression: two 64-char digests identical except at nibble 12 → distinct UUIDs.
- total-mapping: flipping ANY of the 32 prefix nibbles changes the output (loop 0..31).
- shape preservation: output still matches the UUID regex.
- existing idempotency/determinism tests still green (same key → same id).

### Task 3 — IN-A1: extractLastError direct narrow (commit f45e505)

Replaced the `Object.entries` scan that searched for the single known `"message"` key with a
direct `in` + typeof narrow:
`typeof output === "object" && output !== null && "message" in output && typeof output.message === "string"`.
Behavior-preserving (same input → same output), so a refactor with green tests on both sides —
no new RED needed (tdd.md). The job-runs suite uses testcontainers; it is **skipped locally
because Docker is down** (documented Phase 2/3 behavior), and typecheck confirms the narrow.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Minor adjustment

- **hexToUuid exported.** The plan's RED tests assert `hexToUuid(d1) !== hexToUuid(d2)`
  directly, which requires the function to be importable. Added `export` to `hexToUuid`
  (previously module-private). No behavior change; enables the WR-A3 unit tests.

## Known Limitations (deferred)

- **IN-A2 (real commission/fees + intraday filledAt): NOT done here, not cheap.** The
  `BrokerTransaction` domain type (`packages/core/src/brokerage/application/ports.ts`) carries
  no `time`, `commission`, or per-leg `fees` fields, and the transactions adapter does not
  surface them. Threading real fees/time requires extending the brokerage domain type + the
  Schwab adapter parse/map + a docs-first architecture change (`docs/architecture/`). Realized
  P&L stays fee-blind until a dedicated plan populates per-leg fees. Tracked in STATE.

## Verification

- `cd apps/server && bunx vitest run mcp.test` — 22 passed (3 new trigger_job parity tests).
- `cd packages/core && bunx vitest run syncTransactions` — 8 passed (collision + total-mapping).
- `bunx vitest run job-runs` — skipped (Docker down); typecheck confirms the narrow.
- `bun run typecheck` — exits 0.
- `bun run lint` — exits 0 (pre-existing boundaries v5→v6 warning only).
- `bun run test` (full workspace) — 669 passed | 92 skipped (testcontainers, Docker down).

## Threat Mitigations Applied

- **T-05-14-01 (DoS, MCP trigger_job → enqueueJob):** mitigated — rebuild-journal without
  calendarId rejected BEFORE enqueue; no null-keyed un-deduplicated flood (CR-A1).
- **T-05-14-02 (Tampering, hexToUuid → fills.id PK):** mitigated — total nibble mapping;
  distinct (activityId, legIndex) keys never collide; onConflictDoNothing no longer drops a
  real fill (WR-A3).
- **T-05-14-03 (Info disclosure, MCP error content):** accepted — error text is a generic
  "calendarId is required for rebuild-journal", no secrets.

## Self-Check: PASSED

- apps/server/src/adapters/mcp/tools/trigger-job.ts — FOUND (modified, triggerJobBodyFor ×3)
- packages/core/src/journal/application/syncTransactions.ts — FOUND (modified, total mapping)
- packages/adapters/src/postgres/repos/job-runs.ts — FOUND (modified, direct narrow)
- Commit e8de7a0 — FOUND
- Commit 3567199 — FOUND
- Commit f45e505 — FOUND
