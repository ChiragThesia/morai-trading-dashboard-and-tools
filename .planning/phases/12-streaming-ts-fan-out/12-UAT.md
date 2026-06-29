---
status: diagnosed
phase: 12-streaming-ts-fan-out
source: [12-01-SUMMARY.md, 12-02-SUMMARY.md, 12-03-SUMMARY.md, 12-04-SUMMARY.md, 12-05-SUMMARY.md, 12-06-SUMMARY.md]
started: 2026-06-29T16:15:35Z
updated: 2026-06-29T16:25:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing stopped — 2 issues diagnosed, 3 tests deferred; planning gap closure]

## Tests

### 1. Cold Start — Stream Connects + Reconcile
expected: Open morai.wtf fresh, log in, open Positions. Page loads, no errors, no blank state. Connection badge goes POLL → LIVE within a few seconds. Open legs are pre-populated by the reconcile event (STRM-05/SC4) before live ticks arrive.
result: pass

### 2. Live BSM Greeks on Open Legs (SC1)
expected: On Positions during RTH with at least one open option leg, the per-leg Δ/Γ/Θ/Vega/IV/Mark cells flash and update ~1/sec with live BSM values. Badge shows LIVE. First updates arrive within ~30s of opening the screen.
result: issue
reported: "why is the UI only refreshing when I refresh the page? I thought we were streaming?"
severity: major

### 3. Connection Status Badge States (D-04)
expected: Badge shows LIVE (teal pulse) while streaming. Briefly drop the connection (toggle wifi / sleep): badge → STALE (amber), then RECONNECTING; live cells dim by COLOR (not hidden, not opacity). On recovery the badge returns to LIVE and cells brighten. Tooltip shows last-update time.
result: issue
reported: "No LiveStatusBadge present on the rendered Overview screen (screenshot) — same orphaned-overlay root cause as test 2."
severity: major

### 4. Ad-Hoc OCC Live Greeks (SC6)
expected: In the AdHocPicker enter a valid near-term OCC symbol (e.g. an SPX option) and submit. Within ~30s an "AD HOC" badged row appears with live BSM Δ/Γ/Θ/Vega/IV updating ~1/sec, visually distinct from owned legs. Clicking × removes the row and updates stop. An invalid OCC shows an inline error with no row and no network call.
result: skipped
reason: Deferred — AdHocPicker no longer renders on Overview (moved to Analyzer in the 5→3 redesign). Same orphaned-overlay root cause as tests 2/3. Re-test after the Overview live-overlay fix.

### 5. ACCT_ACTIVITY Fill Event (SC2)
expected: Execute a fill in the test account during RTH. Within ~10s the fill propagates through the stream (sidecar logs ACCT_ACTIVITY; SSE event reaches the browser). sync-transactions REST remains the authoritative fill source — the SSE event is display-only. (Requires placing a real trade — skip if not testing fills today.)
result: skipped
reason: Deferred by user — requires placing a real trade; re-test alongside fix verification at RTH.

### 6. Unauthenticated SSE Rejected (SC3)
expected: From a logged-out browser devtools, `new EventSource("/api/stream?ticket=invalid")` and `fetch("/api/stream/ticket", { method: "POST" })` both return 401. No JWT ever appears in the URL/query string — only an opaque single-use ticket.
result: skipped
reason: Deferred by user — independent server-side check (not affected by the UI bug); re-test alongside fix verification.

## Summary

total: 6
passed: 1
issues: 2
pending: 0
skipped: 3
blocked: 0

## Gaps

- truth: "Open position leg greeks stream live over SSE — cells update ~1/sec without a page refresh (SC1)"
  status: failed
  reason: "User reported: why is the UI only refreshing when I refresh the page? I thought we were streaming?"
  severity: major
  test: 2
  root_cause: "The 5→3 screen redesign orphaned the Phase-12 streaming overlay. App.tsx mounts only Overview/Analyzer/Journal; Positions.tsx (which calls useLiveStream at line 617 and renders the live BSM overlay + LiveStatusBadge) is no longer imported anywhere — it is dead code. Shell.tsx folded 'Positions + Market into Overview', but the rebuilt Overview.tsx renders its OWN PositionsTable fed by usePositions() (30s REST poll) + computePositionGreeks (client BSM) and never imports useLiveStream or LiveStatusBadge. So the live SSE greeks never reach the rendered screen; greeks change only on the 30s poll or a manual refresh."
  artifacts:
    - path: "apps/web/src/screens/Overview.tsx"
      issue: "Mounted screen. Renders static PositionsTable from usePositions() 30s poll + computePositionGreeks; no useLiveStream / LiveStatusBadge import — no live overlay."
    - path: "apps/web/src/App.tsx"
      issue: "Routes Overview/Analyzer/Journal only; never imports or mounts Positions.tsx."
    - path: "apps/web/src/screens/Positions.tsx"
      issue: "Has the full useLiveStream() live-greeks overlay + AdHocPicker + LiveStatusBadge, but is orphaned/unmounted after the 5→3 redesign (dead screen)."
  missing:
    - "Mount useLiveStream() inside Overview.tsx (or its PositionsTable) and overlay live BSM Δ/Γ/Θ/Vega/IV/Mark with the .live-cell-flash key trick, falling back to polled values per symbol."
    - "Add <LiveStatusBadge status=…> to the OPEN POSITIONS · GREEKS section header so connection state (POLL/LIVE/STALE/RECONNECTING) is visible."
    - "Decide Positions.tsx disposition: port its live-overlay logic into Overview, then delete the dead screen (avoid two divergent positions tables)."
  debug_session: "(diagnosed inline during UAT — root cause conclusive, no debug session needed)"

- truth: "Connection status badge shows POLL/LIVE/STALE/RECONNECTING on the positions view (D-04)"
  status: failed
  reason: "No LiveStatusBadge present anywhere on the rendered Overview screen (screenshot)."
  severity: major
  test: 3
  root_cause: "Same as test 2 — LiveStatusBadge is only used in the orphaned Positions.tsx; Overview.tsx (mounted) never imports or renders it."
  artifacts:
    - path: "apps/web/src/screens/Overview.tsx"
      issue: "No LiveStatusBadge import/render."
  missing:
    - "Covered by the test-2 fix: adding useLiveStream + LiveStatusBadge to Overview restores the connection badge."
  debug_session: "(same root cause as test 2)"
