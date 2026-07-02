---
status: testing
phase: 12-streaming-ts-fan-out
source: [12-07-SUMMARY.md, 12-06-SUMMARY.md, 12-05-SUMMARY.md, 12-03-SUMMARY.md, 12-02-SUMMARY.md]
started: 2026-06-29T16:15:35Z
updated: 2026-07-02T00:50:00Z
---

## Current Test

number: 4
name: Ad-hoc OCC greeks (SC6) — Analyzer
expected: |
  Enter an OCC option symbol in the Analyzer; live Δ/Γ/Θ/Vega stream for it ~1/sec.
awaiting: RTH session (market closed 19:45 CT at last check — needs live ticks)

<!-- Re-test 2026-07-01 RTH: tests 2-5 reset to pending after keep-alive +
     fresh-ticket-reconnect fixes deployed (commits 17bda79/21ea2ab/6b52bca).
     Tests 1 & 6 remain pass from 2026-06-30. Test 3 passed 2026-07-01 evening
     via DevTools error-injection harness (see note). -->]

## Tests

### 1. Cold start — overlay + badge present (12-07 gap closure)
expected: Overview shows the live overlay + LiveStatusBadge in the "Open positions · greeks" header; positions reconcile.
result: pass
note: Verified via DevTools — badge renders, positions table + greeks render, bundle index-CYOGFG7p.js (post-fix) served. 12-07's orphaned-overlay gap is CLOSED.

### 2. Live greeks update ~1/sec (SC1 / STRM-01)
expected: Δ/Γ/Θ/Vega + Net val/Unreal flash ~1/sec over the live SSE stream.
result: pass
note: Re-verified 2026-07-01 RTH — badge reaches LIVE, greek cells flash ~1/sec. Keep-alive + fresh-ticket-reconnect fixes confirmed working in-browser.

### 3. Connection badge states (D-04)
expected: POLL → LIVE; on drop STALE/RECONNECTING.
result: pass
note: |
  Verified 2026-07-01 ~19:50 CT via Chrome DevTools against prod (morai.wtf):
  - Connect: badge reaches LIVE on load (reconcile path; tick path confirmed in test 2 RTH).
  - Drop: injected `error` event on the live EventSource (initScript-tracked instance —
    CDP offline emulation does NOT sever an established SSE socket, so error injection
    is the honest client-side harness). Badge sequence observed: LIVE → STALE → LIVE.
  - Recovery: first EventSource closed (readyState 2), SECOND ticket minted
    (POST /api/stream/ticket [200]), second EventSource opened with a DIFFERENT ticket
    → /api/stream [200]. No 401, no permanent-stale. Fresh-ticket reconnect confirmed
    end-to-end against prod.
  - RECONNECTING intermediate not captured at 50ms sampling — onopen→reconcile completes
    in <50ms on a healthy network. State machine code path exists (useLiveStream.ts onopen).

### 4. Ad-hoc OCC greeks (SC6) — Analyzer
expected: Enter an OCC option symbol in the Analyzer; live Δ/Γ/Θ/Vega stream for it ~1/sec.
result: [pending]

### 5. ACCT_ACTIVITY fill (SC2)
expected: On a real trade fill, the position/greeks reconcile live (ACCT_ACTIVITY event triggers a re-fetch).
result: [pending]

### 6. Unauthenticated SSE rejected (SC3)
result: pass
note: Verified via curl 2026-06-30 — POST /api/stream/ticket, GET /api/stream (bad/no ticket) all return 401. Endpoints exist; no JWT in URL (opaque ticket).

## Summary

total: 6
passed: 4
issues: 0
pending: 2
skipped: 0
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

5. **Bun 10s idleTimeout killed every SSE connection** — `idleTimeout: 255` on Bun.serve,
   sidecar `_SSE_IDLE_TIMEOUT` 25s→5s, server→browser ping 30s→<10s (commits
   17bda79/21ea2ab). VERIFIED 2026-07-01 RTH (test 2 re-pass: connection survives,
   greeks flash ~1/sec).
6. **Native EventSource reconnect reused the consumed single-use ticket → permanent 401**
   — es.onerror now closes the EventSource and manually reconnects via connect() with a
   FRESH ticket + exponential backoff (commit 6b52bca, useLiveStream.ts). VERIFIED
   2026-07-01 evening (test 3 pass: LIVE→STALE→LIVE, 2nd ticket minted, 2nd stream [200]).

## Gaps (remaining — diagnosed, NOT yet fixed)

- truth: "Badge reflects reality during a SILENT stall (no socket error event)"
  status: open
  severity: minor
  test: 3 (observation — not a test-3 fail; drop/recovery itself passes)
  root_cause: |
    useLiveStream.ts has no staleness watchdog: status only changes on EventSource
    events (onerror/onopen/ticks/reconcile). If the socket starves WITHOUT erroring
    (NAT half-open, silent upstream stall — reproduced via CDP offline emulation:
    65s+ with zero events and badge still LIVE), the badge lies LIVE indefinitely.
    lastTickAt is only used for tooltip text (LiveStatusBadge.tsx), not staleness.
    Real socket closes (server FIN/RST, restart, wifi drop) DO fire onerror and are
    covered by the fresh-ticket reconnect — this gap is only the no-error starve case.
  fixes_needed:
    - "Optional watchdog in useLiveStream: track last-event time (any of ping/ticks/reconcile — requires listening to 'ping' too) and flip status to 'stale' + force close/reconnect if silent > ~30s. Test via FakeEventSource with advanced timers."

## Re-verify remaining (tests 4-5 — need RTH)

`/gsd-verify-work 12` during RTH (08:30-15:00 CT):
- Test 4: Analyzer → enter OCC symbol → live greeks ~1/sec (SC6).
- Test 5: on a real fill, positions/greeks reconcile live (ACCT_ACTIVITY → re-fetch).
