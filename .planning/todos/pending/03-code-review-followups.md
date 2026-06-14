---
type: todo
created: 2026-06-14
source: 03-REVIEW.md
priority: low
milestone: v1.0
---

# Phase 3 code-review follow-ups (advisory, non-blocking)

From `03-REVIEW.md` / `03-VERIFICATION.md`. None block the Phase 3 goal; address
before the v1.0 milestone closes. Run `/gsd-code-review 3 --fix` to auto-apply,
or fix manually.

## Worth fixing (phase-3 code)

- **CR-01** `packages/adapters/src/postgres/repos/calendar-snapshots.ts:192` —
  dead conditional `row.source === "cboe" ? "cboe" : "cboe"`. Replace with
  `const source = row.source` (or parse the enum). Cosmetic; `source` is always
  `"cboe"` today.
- **CR-02** `apps/server/src/adapters/mcp/tools.ts` (~121, ~173) — `get_journal`
  / `get_live_greeks` use `z.object({...}).parse(args)` which throws ZodError on a
  bad `calendarId`. The SDK still returns a valid JSON-RPC error, but prefer
  `safeParse` + descriptive error text. (Only the analytics tools were required to
  never-error; they correctly don't.)
- **WR-01** same tools double-parse `args` — collapse to one parse.
- **WR-07** memory `readJournal` returns `[]` for unknown calendarId while Postgres
  returns `null` — twin-parity gap (architecture-boundaries §8); align the memory
  twin so it can exercise the 404 path.

## Pre-existing Phase-2 robustness (out of phase-3 scope)

- **CR-04** `leg-observations.ts` `readPendingObs` silently drops observations with
  no matching `contracts` row (orphan race if a run crashes between
  `persistObservations` and `upsertContracts`).
- **CR-05** `leg-observations.ts` `writeBsmResults` issues N individual UPDATEs with
  no transaction → partial-write risk; wrap in a transaction.
- **WR-05** `readPendingObs` builds expiry via `new Date(y, m-1, d)` (local time) —
  wrong on a non-ET server.

## Spec question (NOT a bug)

- **CR-03** `snapshotCalendars.ts` defaults a missing leg's mark to `0`, so `pnlOpen`
  populates with a real-looking number when a leg is absent. This MATCHES the locked
  D-06 decision (03-05-PLAN line 124, 03-CONTEXT: "pnl_open uses marks … marks default
  0 when a leg is null"). If NaN-stamping `pnlOpen`/`netMark` on a fully-missing leg is
  desired instead, that is a SPEC change for a future phase — re-decide in discuss/spec,
  not a phase-3 fix.
