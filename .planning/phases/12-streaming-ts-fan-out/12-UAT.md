---
status: diagnosed
phase: 12-streaming-ts-fan-out
source: [12-07-SUMMARY.md, 12-06-SUMMARY.md, 12-05-SUMMARY.md, 12-03-SUMMARY.md, 12-02-SUMMARY.md]
started: 2026-06-29T16:15:35Z
updated: 2026-06-30T16:55:00Z
---

## Current Test

[RTH UAT 2026-06-30 — live stream end-to-end debugged via Chrome DevTools.
12-07 UI overlay VERIFIED working; live ticks blocked by a backend cascade.
4 root causes fixed + deployed this session; 3 remain (keep-alive + client reconnect).]

## Tests

### 1. Cold start — overlay + badge present (12-07 gap closure)
expected: Overview shows the live overlay + LiveStatusBadge in the "Open positions · greeks" header; positions reconcile.
result: pass
note: Verified via DevTools — badge renders, positions table + greeks render, bundle index-CYOGFG7p.js (post-fix) served. 12-07's orphaned-overlay gap is CLOSED.

### 2. Live greeks update ~1/sec (SC1 / STRM-01)
expected: Δ/Γ/Θ/Vega + Net val/Unreal flash ~1/sec over the live SSE stream.
result: issue
reported: "POLL then stale" — badge never reaches LIVE; greek cells never flash (0 .live-cell).
severity: major

### 3. Connection badge states (D-04)
expected: POLL → LIVE; on drop STALE/RECONNECTING.
result: issue
reported: Badge wiring works (POLL→STALE observed) but never reaches LIVE because no ticks are delivered (see gaps).
severity: major

### 4. Ad-hoc OCC greeks (SC6) — Analyzer
result: skipped
reason: Deferred — blocked by the same stream cascade; re-test after live path is green.

### 5. ACCT_ACTIVITY fill (SC2)
result: skipped
reason: Deferred — requires a real trade; re-test alongside the live path.

### 6. Unauthenticated SSE rejected (SC3)
result: pass
note: Verified via curl 2026-06-30 — POST /api/stream/ticket, GET /api/stream (bad/no ticket) all return 401. Endpoints exist; no JWT in URL (opaque ticket).

## Summary

total: 6
passed: 2
issues: 2
pending: 0
skipped: 2
blocked: 0

## Fixed this session (deployed)

The live stream was never integration-tested end-to-end against the real
Bun/Railway/sidecar stack — every layer had a contract/config bug, all masked by
mocked unit tests. Fixed + deployed 2026-06-30:

1. **Vercel build cache shipped stale bundles** — `VERCEL_FORCE_NO_BUILD_CACHE=1` in
   `vercel.json` (commit ce7e0d0). Root: restored build cache re-emitted the pre-12-07
   bundle for a 12-07 commit.
2. **Sidecar streamer spun on `ConnectionClosedOK`** — wrapped login→subscribe→pump in a
   reconnect loop (commit 549bf9e, `apps/sidecar/streamer.py`). Root: caught every
   exception and `continue`d on a dead socket.
3. **Streamer subscribed ZERO legs** — `_get_position_occ_symbols` was a `[]` stub; now
   fetches open OPTION legs via the trader client, reusing `positions_proxy._extract_positions`
   (commit 07c76d3). Root: nothing subscribed the open legs to LEVELONE.
4. **Client ignored named SSE events** — `useLiveStream` only handled `onmessage`
   (unnamed); server sends `event:"ticks"` (JSON array), `event:"reconcile"`, `event:"ping"`.
   Now `addEventListener("ticks"/"reconcile")` + array parse (commit df428f5). Root: 12-06
   FakeEventSource dispatched via `onmessage`, hiding the named-event contract.

## Gaps (remaining — diagnosed, NOT yet fixed)

- truth: "Open-leg greeks stream live ~1/sec (SC1/STRM-01)"
  status: failed
  severity: major
  test: 2
  root_cause: |
    Bun's default `idleTimeout` (10s) closes idle SSE connections. Both keep-alive
    intervals exceed it, so every SSE connection dies at ~10s:
      - server → browser ping = 30s (apps/server/src/adapters/http/stream.routes.ts:237)
      - sidecar /sidecar/events ping = 25s (apps/sidecar/stream_proxy.py:29, _SSE_IDLE_TIMEOUT)
    Server log evidence: "[Bun.serve]: request timed out after 10 seconds" and
    "socket closed unexpectedly path: .../sidecar/events code: ECONNRESET".
    So the browser SSE is killed at 10s AND the server→sidecar feed ECONNRESETs at ~10s
    (no ticks ever reach the fan-out). DevTools network: /api/stream [200] then a reconnect
    with the SAME single-use ticket → [401].
  fixes_needed:
    - "Server: set `idleTimeout` on Bun.serve in apps/server/src/main.ts (max 255s; e.g. 120) so SSE connections aren't killed at 10s. The server is served via Bun (the `[Bun.serve]` log) — find the serve/export-default config and add idleTimeout."
    - "Sidecar: lower `_SSE_IDLE_TIMEOUT` in apps/sidecar/stream_proxy.py from 25s to <10s (e.g. 5s) so the server's fetch-to-sidecar read stays fed and doesn't ECONNRESET."
    - "Optional/backstop: lower the server→browser ping in stream.routes.ts:237 from 30_000 to <10_000."

- truth: "Live stream survives a disconnect (badge recovers to LIVE)"
  status: failed
  severity: major
  test: 2, 3
  root_cause: |
    apps/web/src/hooks/useLiveStream.ts es.onerror only sets status 'stale' and relies on
    EventSource's NATIVE auto-reconnect — which reuses the consumed single-use ticket in the
    URL → 401 (EventSource then gives up permanently). So any drop = permanent STALE until a
    full page reload. DevTools: reqid 148 GET /api/stream?ticket=T [200], reqid 149 same
    ticket [401].
  fixes_needed:
    - "In es.onerror: close the EventSource (stop native reconnect), then schedule a manual reconnect via connect() (which mints a FRESH ticket via POST /api/stream/ticket) with exponential backoff + jitter; reset backoff on es.onopen. Add a test (FakeEventSource) asserting a 2nd ticket mint + 2nd EventSource after an error."

## Re-verify after fixes

`/gsd-verify-work 12` during RTH, OR via Chrome DevTools: load morai.wtf → Overview →
badge POLL→LIVE within a few sec, greek cells flash ~1/sec (.live-cell present), and the
SSE connection survives past 10s (no instant [401] reconnect).
