---
status: testing
phase: 03-calendar-journal-mvp
source: [03-VERIFICATION.md]
started: 2026-06-14
updated: 2026-06-14
---

## Current Test

number: 1
name: MCP live transport — list_calendars matches HTTP
expected: |
  With the server running and the morai MCP configured in Claude Code, invoking
  `list_calendars` returns the same calendar list as `GET /api/calendars`.
awaiting: user response

## Tests

Run these on an RTH weekday (markets open) with the server running
(`railway run --service worker bun run dev`, or local with DATABASE_URL +
MCP_BEARER_TOKEN set) and the morai MCP server configured in Claude Code.
Items 2 and 4 need at least one snapshot/observation row, which only accrues
during Regular Trading Hours (the snapshot + BSM jobs are RTH+holiday gated).

### 1. MCP live transport — list_calendars
expected: `list_calendars` (MCP) returns the same list as `GET /api/calendars`.
result: [pending]

### 2. MCP live transport — get_journal (live data path)
expected: After a snapshot writes during RTH, `get_journal` (MCP) returns the
  same ordered snapshot series as `GET /api/journal/:calendarId` for the same id.
result: [pending]

### 3. MCP live transport — get_term_structure / get_skew
expected: Both return `{"observations":[]}` over the wire — a typed-empty result,
  never an error.
result: [pending]

### 4. MCP live transport — get_live_greeks
expected: Returns a typed greeks payload (or typed-empty legs when no Phase 2
  observation exists), never an error.
result: [pending]

### 5. trigger_job absence
expected: `trigger_job` does NOT appear in Claude Code's tool list (deferred to
  Phase 5, D-08).
result: [pending]

### 6. RTH / holiday no-op in production
expected: Triggering `snapshot-calendars` (or observing the worker) outside RTH
  or on an NYSE holiday logs an "outside RTH / holiday, skipping" no-op and writes
  no snapshot row.
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
