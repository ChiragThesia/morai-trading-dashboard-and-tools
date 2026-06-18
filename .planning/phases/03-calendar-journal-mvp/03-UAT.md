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
awaiting: fix + redeploy (transport bug blocks all live tests)

## Tests

Run these on an RTH weekday (markets open) with the server running
(`railway run --service worker bun run dev`, or local with DATABASE_URL +
MCP_BEARER_TOKEN set) and the morai MCP server configured in Claude Code.
Items 2 and 4 need at least one snapshot/observation row, which only accrues
during Regular Trading Hours (the snapshot + BSM jobs are RTH+holiday gated).

### 1. MCP live transport — list_calendars
expected: `list_calendars` (MCP) returns the same list as `GET /api/calendars`.
result: issue
reported: "morai MCP 'Failed to connect'. Live POST /mcp initialize returns content-type text/event-stream with content-length:0 (empty SSE, no data event). Curl confirms 200 w/ valid bearer, 401 without — server reachable + token valid, transport returns no body."
severity: blocker
root_cause: "apps/server/src/adapters/mcp/server.ts — both /mcp handlers call `void server.close()` synchronously after `transport.handleRequest()` returns. handleRequest returns a Response wrapping an open ReadableStream and dispatches `initialize` for async processing; server.close()→transport.close() walks _streamMapping and closes the stream controller before the InitializeResult is enqueued. Fix: match official SDK Hono example — `return transport.handleRequest(c.req.raw)` with no synchronous close (per-request server/transport GC after stream ends), or move cleanup to transport.onclose."
blocks: [2, 3, 4]

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
issues: 1
pending: 5
skipped: 0
blocked: 0

## Gaps

- truth: "morai MCP connects over the wire; POST /mcp initialize returns a non-empty response (InitializeResult)."
  status: failed
  reason: "User reported: morai MCP 'Failed to connect'. Live POST /mcp initialize returns text/event-stream with content-length:0 — empty SSE, no data event. Server reachable (200 w/ bearer, 401 without)."
  severity: blocker
  test: 1
  artifacts: [apps/server/src/adapters/mcp/server.ts]
  missing: ["non-empty initialize response", "end-to-end router test asserting non-empty POST /mcp body"]
  root_cause: "`void server.close()` runs synchronously after `transport.handleRequest()`, tearing down the SSE ReadableStream before the async InitializeResult is enqueued (SDK 1.29.0 webStandardStreamableHttp). Fix: drop the synchronous close (match official Hono example) or move to transport.onclose."
