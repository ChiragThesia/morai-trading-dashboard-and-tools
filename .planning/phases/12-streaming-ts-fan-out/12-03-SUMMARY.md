---
phase: 12-streaming-ts-fan-out
plan: "03"
subsystem: sidecar-streaming
tags: [sidecar, sse, streaming, positions, subscribe, sc6, strm-05]
dependency_graph:
  requires: [12-02]
  provides: [GET /sidecar/events, GET /sidecar/positions, POST /sidecar/subscribe, start_streamer wired]
  affects: [12-05-sidecar-sse-ts-consumer]
tech_stack:
  added: []
  patterns:
    - FastAPI StreamingResponse async generator SSE (Pattern 5)
    - Pydantic field_validator for OCC symbol validation
    - request_ad_hoc_subscription coordinator (level_one_option_add only — Pitfall 11)
    - login-after-lock streamer task lifecycle (Pattern 1)
key_files:
  created:
    - apps/sidecar/stream_proxy.py
    - apps/sidecar/positions_proxy.py
    - apps/sidecar/tests/test_stream_proxy.py
    - apps/sidecar/tests/test_positions_proxy.py
  modified:
    - apps/sidecar/streamer.py
    - apps/sidecar/main.py
decisions:
  - OCC validator uses re.compile + Pydantic field_validator (21-char pattern [A-Z ]{6}\d{6}[CP]\d{8}) — rejects malformed symbols with 422 before they reach the live StreamClient
  - request_ad_hoc_subscription returns None sentinel (not raise) when stream is not active — subscribe route maps None to 503 AUTH_EXPIRED (mirrors chain_proxy.py convention)
  - _SSE_IDLE_TIMEOUT module constant on stream_proxy allows monkeypatching in tests without 25s waits
  - route-mount tests use url_path_for + TestClient (no lifespan) — avoids env-var dependency in CI
  - positions_proxy calls get_accounts(fields=['positions']) — avoids separate account-hash lookup step
metrics:
  duration: "~45 minutes"
  completed: "2026-06-28"
  tasks_completed: 4
  files_changed: 6
  tests_added: 18
  tests_total: 60
status: complete
---

# Phase 12 Plan 03: Sidecar SSE + Positions Reconcile + Ad-hoc Subscribe Summary

Sidecar SSE transport + STRM-05 reconcile endpoint + SC6 subscribe path, all wired into the app lifecycle.

## One-liner

FastAPI SSE endpoint draining event_queue with ping keep-alive, Z-stamped positions reconcile proxy, OCC-validated ad-hoc activation route using level_one_option_add (never subs), and streamer task launched post-lock alongside keepalive.

## What Was Built

### Task 1: GET /sidecar/events (stream_proxy.py)

StreamingResponse generator that:
- Drains `streamer.event_queue` yielding `data: {json}\n\n` per event
- Emits `event: ping\ndata: \n\n` on 25s idle (Assumption A4) via `_SSE_IDLE_TIMEOUT` constant
- Stops cleanly when `await request.is_disconnected()` returns True (Pitfall 10 — awaited)
- Module docstring attests internal/private-net only (GW-05)

4 tests: seeded drain, idle ping, immediate disconnect, media-type.

### Task 2: GET /sidecar/positions (positions_proxy.py)

Near-copy of chain_proxy.py REST pattern:
- Pydantic `PositionItem` + `PositionsResponse` models with field names mirroring `brokerage.ts brokerPosition` (occSymbol, longQty, shortQty, marketValue, underlyingSymbol)
- `_utc_now_z()` helper ensures asOf ends in `Z` (Pitfall 5 / T-12-03-03)
- Filters OPTION positions only from schwab-py `get_accounts(fields=['positions'])` response
- 503 AUTH_EXPIRED guard for absent trader_client and any call exception (type(exc).__name__ only)

7 tests: shape, Z-suffix, option filter, field names, empty list, two 503 paths.

### Task 3: main.py wiring

Additions to `_acquire_lock_and_init` (all post-lock):
- `stream_router` and `positions_router` included via `app.include_router()`
- `streamer_task = asyncio.create_task(start_streamer(app))` created alongside `keepalive_task`
- `streamer_task` cancelled and awaited in the same `finally` block as `keepalive_task`
- `app.state.stream_client = None` and `app.state.subscription_manager = None` defaults added

3 route-mount tests: url_path_for check, 503 (not 404) for positions, 422/503 for subscribe.

### Task 4: POST /sidecar/subscribe + request_ad_hoc_subscription (SC6, D-05)

**streamer.py additions:**
- `start_streamer` now creates a `SubscriptionManager()` and sets `app.state.stream_client` + `app.state.subscription_manager` after `login()` so the subscribe route has live handles
- `request_ad_hoc_subscription(app, symbol)` coordinator:
  - Returns `None` when `stream_client` or `subscription_manager` is absent
  - Calls `subscription_manager.request_ad_hoc(symbol)` → `(to_add, to_evict)`
  - Applies diff via `level_one_option_add(to_add)` + `level_one_option_unsubs(to_evict)`
  - **NEVER calls `level_one_option_subs`** (Pitfall 11 — would reset the entire subscription set)

**stream_proxy.py additions:**
- `SubscribeRequest` Pydantic model with `@field_validator` enforcing OCC 21-char regex (`[A-Z ]{6}\d{6}[CP]\d{8}`) — FastAPI converts validation failure to 422
- `POST /sidecar/subscribe` route: OCC validate → stream_client guard (503) → `request_ad_hoc_subscription` → 200 `{subscribed, evicted}`

4 subscribe tests: valid→200+add, not-active→503, malformed→422, already-subscribed→200 no-churn.

## Commits

| Hash | Task | Description |
|------|------|-------------|
| 5c3ef33 | 1 | feat(12-03): GET /sidecar/events SSE endpoint draining event_queue with ping keep-alive |
| 47838ee | 2 | feat(12-03): GET /sidecar/positions STRM-05 reconcile endpoint |
| 2522e94 | 3 | feat(12-03): wire routers and streamer task in main.py (login-after-lock) |
| b1c4185 | 4 | feat(12-03): POST /sidecar/subscribe SC6 ad-hoc activation + request_ad_hoc_subscription |

## Verification Gates

### Automated (all green)

```
cd apps/sidecar && .venv/bin/python -m pytest tests/ -q
60 passed, 2 warnings in 0.62s
```

Previous: 42 tests. Added: 18 tests (4 stream events, 7 positions, 3 route-mount, 4 subscribe).

### Grep gates (all pass)

- `+00:00` emission: 0 matches in new files — all timestamps use `_utc_now_z()` with `.replace("+00:00", "Z")`
- `str(exc)` logging: 0 matches — all exceptions logged as `type(exc).__name__` only
- `level_one_option_subs` in `request_ad_hoc_subscription`: absent — only `level_one_option_add` and `level_one_option_unsubs` on the increment path (Pitfall 11 compliance)

## Deviations from Plan

### Auto-fix: lazy import for request_ad_hoc_subscription (Rule 3 — blocking import)

**Found during:** Task 1 implementation  
**Issue:** `stream_proxy.py` initially imported `request_ad_hoc_subscription` at module level, causing `ImportError` for all Task 1 tests because `streamer.py` didn't have that function yet (it's added in Task 4).  
**Fix:** Moved the import inside the `subscribe` route handler (`from streamer import request_ad_hoc_subscription` at call time). This allows Task 1 tests to import `stream_proxy` cleanly while Task 4 tests still work once the function is added.  
**Files modified:** `apps/sidecar/stream_proxy.py`

### Auto-fix: route-mount test strategy (Rule 3 — TestClient lifespan conflict)

**Found during:** Task 3  
**Issue:** The first route-mount test used `with TestClient(app) as client:` (lifespan context) which triggered `config.SidecarConfig()` validation — failing without real env vars in the test environment.  
**Fix:** Replaced with two strategies: (1) `app.url_path_for("stream_events")` for events route presence check (no HTTP, no lifespan); (2) plain `TestClient(app)` without `with` context for positions 503-not-404 check, matching the existing `test_chain_proxy.py` pattern.  
**Files modified:** `apps/sidecar/tests/test_stream_proxy.py`

## Known Stubs

None. All behaviors are wired:
- `stream_proxy.py GET /sidecar/events` drains the real `streamer.event_queue`
- `positions_proxy.py GET /sidecar/positions` calls `trader_client.get_accounts()`
- `stream_proxy.py POST /sidecar/subscribe` drives `request_ad_hoc_subscription` which calls the live `level_one_option_add`

## Threat Flags

No new threat surface beyond what the plan's threat model covers. All three endpoints are private-net only (GW-05), documented in module docstrings.

## Outstanding UAT (RTH manual gates — VALIDATION.md)

- **STRM-05:** After sidecar restart, `/sidecar/positions` returns current positions used to seed the first reconcile SSE event.
- **SC6:** POST `/sidecar/subscribe` for an arbitrary OCC symbol begins LEVELONE updates for it within ~30s during RTH.

## Self-Check: PASSED

- `apps/sidecar/stream_proxy.py` — created ✓
- `apps/sidecar/positions_proxy.py` — created ✓
- `apps/sidecar/tests/test_stream_proxy.py` — created ✓
- `apps/sidecar/tests/test_positions_proxy.py` — created ✓
- `apps/sidecar/streamer.py` — modified (request_ad_hoc_subscription + state exposure) ✓
- `apps/sidecar/main.py` — modified (router includes + streamer task) ✓
- All 4 task commits exist in git log ✓
- 60/60 tests pass ✓
