---
phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar
plan: 02
subsystem: sidecar
tags: [sidecar, streaming, live-spot, vix, rest-poll]
dependency graph:
  requires: []
  provides:
    - "start_indices_poll(app) — REST get_quotes poll loop for the VIX family"
    - "INDICES_POLL_INTERVAL_S (20.0) + INDICES_SYMBOLS module constants"
    - "indices_poll_task sidecar lifecycle wiring"
  affects:
    - apps/sidecar/stream_proxy.py (unchanged — drains the new indices frames generically)
    - "38-03 (server fan-out/dispatch for the new indices frame type)"
tech-stack:
  added: []
  patterns:
    - "REST get_quotes poll loop mirroring start_streamer's task shape (while True + sleep, type-name-only error logging)"
    - "Z-suffixed timestamp via utc_now_z(), stamped from sidecar receipt time (quote.quoteTime is unreliable — never read)"
key-files:
  created: []
  modified:
    - apps/sidecar/streamer.py
    - apps/sidecar/main.py
    - apps/sidecar/tests/test_streamer.py
decisions:
  - "VIX-family symbols confirmed live via A1 checkpoint (38-A1-PROBE.md, orchestrator-run 2026-07-13 RTH): $VIX/$VVIX/$VIX9D/$VIX3M all return HTTP 200 in ONE get_quotes batch call — no per-symbol fallback path built (Assumption A3 batch-400 behavior never observed)."
  - "Level read from quote.lastPrice; quote.quoteTime is None in the live response and is never used — ts is stamped from sidecar receipt time (utc_now_z()) instead."
  - "get_quotes called with no fields kwarg (unlike level_one_option_subs) — the live probe/RESEARCH confirmed the default response already carries the quote object."
metrics:
  duration: "~35m"
  completed: 2026-07-13
status: complete
---

# Phase 38 Plan 02: Sidecar VIX-family REST poll loop Summary

Added `start_indices_poll(app)` — a background REST poll loop that fetches `$VIX`/`$VVIX`/`$VIX9D`/`$VIX3M` via `get_quotes` every 20 seconds and emits one Z-suffixed `indices` frame onto the sidecar's existing `event_queue`, wired into the same lock-scoped task lifecycle as `keepalive_task`/`streamer_task`.

## Task 1 — A1 checkpoint (resolved by orchestrator probe)

Not re-probed. Per the teammate message, the checkpoint was already resolved by a live orchestrator-run probe (`38-A1-PROBE.md`, 2026-07-13 ~16:55Z, live RTH, prod sidecar container). Result: **CONFIRMED** — all of `$VIX`/`$VVIX`/`$VIX9D`/`$VIX3M`/`$SPX` returned HTTP 200 with `assetMainType: "INDEX"` and a populated `quote.lastPrice` in a single batch `get_quotes` call. Binding facts carried into Task 2:

1. Use `quote.lastPrice` (not mark/bid/ask, which are null/absent for cash indices).
2. `quote.quoteTime` was `None` in the live response — never depend on it; the frame's `ts` is stamped from sidecar receipt time (`utc_now_z()`).
3. Response is keyed by the literal `$`-prefixed symbol string.
4. All four symbols + `$SPX` succeeded in ONE batch call — no whole-batch-400 or per-symbol-error behavior was observed, so the plan's conditional per-symbol `get_quote` fallback (Assumption A3) was not built; batch `get_quotes` is used directly.

## Task 2 — `start_indices_poll` (TDD)

**RED** (`e8649a2`): added `TestIndicesPoll` to `apps/sidecar/tests/test_streamer.py` — 6 tests covering the emitted frame shape (Z-suffixed, all four fields), a missing symbol degrading to `None` while the other three stay populated, a `get_quotes` exception being swallowed (loop reaches `sleep`, no frame pushed), a `QueueFull` being caught without raising, graceful degrade when `market_client` is `None`, and the `INDICES_POLL_INTERVAL_S` constant. Confirmed all 6 failed with `ImportError` before implementation.

**GREEN** (`d22f758`): added to `apps/sidecar/streamer.py`:
- `INDICES_POLL_INTERVAL_S = 20.0` and `INDICES_SYMBOLS = ["$VIX", "$VVIX", "$VIX9D", "$VIX3M"]` (plain module constants, not a `SidecarConfig` field, per RESEARCH placement guidance).
- `_extract_last_price(raw, symbol)` — pulls `quote.lastPrice` per symbol, degrading to `None` (never raising) on a missing/malformed entry.
- `_build_indices_frame(raw)` — maps the four symbols to `{type: "indices", vix, vvix, vix9d, vix3m, ts}` via `utc_now_z()`.
- `start_indices_poll(app)` — `while True:` loop reading `app.state.market_client` (never `trader_client` — quotes are market data, mirrors `chain_proxy.py`), calling `get_quotes(INDICES_SYMBOLS)`, building the frame, and `event_queue.put_nowait(...)` inside a `try/except QueueFull` (mirrors `_on_level_one_option`'s guard). A `get_quotes`/parse exception is caught and logged as `type(exc).__name__` only, then the loop continues to `sleep`. When `market_client` is `None` it logs a warning and keeps looping (self-heals once `_init_schwab_clients` re-inits). No `is_rth()`/`is_open()` guard exists — confirmed by grep.

## Task 3 — `main.py` lifecycle wiring

Committed at `caf7746`. In `_acquire_lock_and_init`, `indices_poll_task` is created via `asyncio.create_task(start_indices_poll(app))` immediately after `streamer_task`, and cancelled + awaited in the same `finally` block that tears down `keepalive_task`/`streamer_task` (on lock loss or shutdown). The Phase-37 `reinit_schwab_session` cancel/recreate path (used by the re-auth wizard's exchange route) was also extended to include `indices_poll_task` in both its cancel-list and its recreate block, so a wizard re-auth doesn't leave a stale (though functionally harmless, since it reads `app.state.market_client` fresh each iteration) task running. `app.state.indices_poll_task` defaults to `None` at both the lifespan-reset site and the module-level pre-lifespan defaults, matching `keepalive_task`/`streamer_task`.

## Verification

- `cd apps/sidecar && .venv/bin/pytest tests/test_streamer.py -x -q` → 38 passed.
- `cd apps/sidecar && .venv/bin/pytest tests/ -q` → **90 passed**, 7 warnings (all pre-existing, unrelated to this change — a `RuntimeWarning: coroutine ... was never awaited` from `AsyncMockMixin` in pre-existing streamer reconnect tests, and a `StarletteDeprecationWarning`).
- `grep -n "is_rth\|is_open" apps/sidecar/streamer.py` → only match is inside `start_indices_poll`'s own docstring confirming the guard's absence ("no is_rth() guard"), not an actual guard call.
- `grep -n "start_indices_poll\|indices_poll_task" apps/sidecar/main.py` → confirms creation + cancel/await in both `_acquire_lock_and_init` and `reinit_schwab_session`.

## Deviations from Plan

None — plan executed as written. The one conditional branch in the plan (per-symbol `get_quote` fallback if the checkpoint reported whole-batch-400 behavior) was correctly *not* built because the A1 probe reported clean HTTP 200 for the whole batch.

## Known Stubs

None. `start_indices_poll` is fully wired end-to-end within its scope (sidecar only); the frame it emits is consumed generically by the unchanged `stream_proxy.py` SSE generator. Server-side dispatch/fan-out for the `"indices"` frame type is out of scope for this plan (38-03).

## Threat Flags

None beyond what the plan's own `<threat_model>` already covers (T-38-02 DoS-resilience, T-38-03 info-disclosure via type-name-only logging, T-38-06 accept, T-38-SC accept) — no new endpoints, no new trust boundary beyond the existing Schwab REST → sidecar boundary this task adds a poll against.

## Self-Check: PASSED

- `apps/sidecar/streamer.py` — FOUND, contains `start_indices_poll`, `INDICES_POLL_INTERVAL_S`.
- `apps/sidecar/main.py` — FOUND, contains `indices_poll_task` wiring.
- `apps/sidecar/tests/test_streamer.py` — FOUND, contains `TestIndicesPoll`.
- Commit `e8649a2` (test RED) — FOUND in `git log`.
- Commit `d22f758` (feat GREEN) — FOUND in `git log`.
- Commit `caf7746` (main.py wiring) — FOUND in `git log`.
