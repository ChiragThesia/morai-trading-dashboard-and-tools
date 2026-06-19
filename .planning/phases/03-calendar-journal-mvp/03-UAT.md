---
status: testing
phase: 03-calendar-journal-mvp
source: [03-VERIFICATION.md]
started: 2026-06-14
updated: 2026-06-18
---

## Current Test

number: 2
name: MCP live transport — get_journal (live data path)
expected: |
  After a snapshot writes during RTH, `get_journal` (MCP) returns the same ordered
  snapshot series as `GET /api/journal/:calendarId`. Needs a registered calendar.
awaiting: decision — register a test calendar in prod to exercise live-data path

## Tests

Run these on an RTH weekday (markets open) with the server running
(`railway run --service worker bun run dev`, or local with DATABASE_URL +
MCP_BEARER_TOKEN set) and the morai MCP server configured in Claude Code.
Items 2 and 4 need at least one snapshot/observation row, which only accrues
during Regular Trading Hours (the snapshot + BSM jobs are RTH+holiday gated).

### 1. MCP live transport — list_calendars
expected: `list_calendars` (MCP) returns the same list as `GET /api/calendars`.
result: pass
verified: |
  2026-06-18 — fix deployed (PR #2, server.ts premature server.close()). Live
  `initialize` now returns full InitializeResult (serverInfo morai 1.0.0).
  `claude mcp list` → morai ✔ Connected. list_calendars (MCP) = {"calendars":[]}
  == GET /api/calendars {"calendars":[]} (empty table — both match).
note: |
  Was an issue (blocker): morai 'Failed to connect' — POST /mcp initialize
  returned text/event-stream content-length:0 (empty SSE). Root cause: both /mcp
  handlers called `void server.close()` synchronously after handleRequest, tearing
  down the SSE ReadableStream before the InitializeResult was enqueued
  (SDK 1.29.0 webStandardStreamableHttp). Fixed by returning handleRequest directly
  (matches official SDK Hono example). RED 631cdd2 → GREEN af74633 → merged c5675b6.

### 2. MCP live transport — get_journal (live data path)
expected: After a snapshot writes during RTH, `get_journal` (MCP) returns the
  same ordered snapshot series as `GET /api/journal/:calendarId` for the same id.
result: [pending]
note: |
  No-data path verified live: get_journal (MCP) for an unregistered uuid →
  {"error":"not found"} (typed not-found, no crash). Full live-data path needs a
  registered calendar + an RTH snapshot row; calendars table is currently empty.

### 3. MCP live transport — get_term_structure / get_skew
expected: Both return `{"observations":[]}` over the wire — a typed-empty result,
  never an error.
result: pass
verified: "2026-06-18 — both return {\"observations\":[]} over /mcp, repeated 2× each, consistent."

### 4. MCP live transport — get_live_greeks
expected: Returns a typed greeks payload (or typed-empty legs when no Phase 2
  observation exists), never an error.
result: pass
verified: |
  2026-06-18 — get_live_greeks (valid uuid, no observation) →
  {"calendarId":"…","legs":[]} (typed-empty, never error). Malformed uuid →
  clean JSON-RPC -32602 input-validation error (SDK inputSchema), not a crash.

### 5. trigger_job absence
expected: `trigger_job` does NOT appear in Claude Code's tool list (deferred to
  Phase 5, D-08).
result: pass
verified: "2026-06-18 — tools/list over /mcp returns exactly 6 tools (get_status, list_calendars, get_journal, get_live_greeks, get_term_structure, get_skew); no trigger_job."

### 6. RTH / holiday no-op in production
expected: Triggering `snapshot-calendars` (or observing the worker) outside RTH
  or on an NYSE holiday logs an "outside RTH / holiday, skipping" no-op and writes
  no snapshot row.
result: [pending]
note: |
  Cannot observe now — checked at 13:53 ET (RTH open), so the no-op branch is not
  exercised. Gating logic verified in code (03-VERIFICATION 5/5). Needs an
  after-16:00-ET / weekend / NYSE-holiday log capture to confirm live.

## Summary

total: 6
passed: 4
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

- truth: "morai MCP connects over the wire; POST /mcp initialize returns a non-empty response (InitializeResult)."
  status: resolved  # fixed PR #2 (RED 631cdd2 → GREEN af74633 → merged c5675b6), verified live 2026-06-18
  reason: "User reported: morai MCP 'Failed to connect'. Live POST /mcp initialize returns text/event-stream with content-length:0 — empty SSE, no data event. Server reachable (200 w/ bearer, 401 without)."
  severity: blocker
  test: 1
  artifacts: [apps/server/src/adapters/mcp/server.ts]
  missing: ["non-empty initialize response", "end-to-end router test asserting non-empty POST /mcp body"]
  root_cause: "`void server.close()` runs synchronously after `transport.handleRequest()`, tearing down the SSE ReadableStream before the async InitializeResult is enqueued (SDK 1.29.0 webStandardStreamableHttp). Fix: drop the synchronous close (match official Hono example) or move to transport.onclose."
