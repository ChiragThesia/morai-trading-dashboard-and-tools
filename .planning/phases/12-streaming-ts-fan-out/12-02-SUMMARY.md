---
phase: 12-streaming-ts-fan-out
plan: "02"
subsystem: sidecar-streamer
tags: [streaming, schwab-py, subscription-management, lru, acct-activity, tdd]
dependency_graph:
  requires: ["12-01"]
  provides: ["streamer.py exports: start_streamer, SubscriptionManager, sync_subscriptions, event_queue, REQUIRED_OPTION_FIELDS, utc_now_z, _on_level_one_option, _on_acct_activity"]
  affects: ["apps/sidecar/main.py (will launch start_streamer in 12-03)", "12-03 stream_proxy.py drains event_queue"]
tech_stack:
  added: []
  patterns:
    - "SubscriptionManager: OrderedDict LRU + set for position legs (490-cap, O(1) eviction)"
    - "Pure sync_subscriptions diff: (subscribed, desired_legs, ad_hoc, cap) → (to_add, to_remove)"
    - "asyncio.Queue(maxsize=500) as bounded fan-out buffer between background task and SSE endpoint"
    - "dict.get(named_key, dict.get(numeric_key)) dual-key pattern for schwab-py named/numeric field compat"
    - "copy.deepcopy before stripping ACCOUNT to avoid mutating the original message"
key_files:
  created:
    - apps/sidecar/streamer.py
    - apps/sidecar/tests/test_streamer.py
  modified: []
decisions:
  - "Both tasks implemented in a single GREEN commit (f26f4f2): SubscriptionManager + start_streamer are one cohesive module; splitting the implementation artificially would have created an import-time error in the same file"
  - "_get_position_occ_symbols returns [] stub — full position loading via /sidecar/positions reconcile is 12-03 scope (positions_proxy.py)"
  - "Dual-key field extraction (named + numeric string fallback) so _on_level_one_option works with schwab-py relabeled messages in production AND raw numeric-keyed messages in direct-call tests"
  - "asyncio.QueueFull caught with put_nowait; drops tick rather than back-pressuring the stream loop (T-12-02-04)"
metrics:
  duration: "~35 minutes"
  completed: "2026-06-28"
  tasks_completed: 2
  files_created: 2
  tests_added: 26
status: complete
---

# Phase 12 Plan 02: Python Sidecar Streamer Summary

**One-liner:** Schwab StreamClient background task with 490-cap LRU SubscriptionManager, LEVELONE_OPTIONS + ACCT_ACTIVITY handlers, and bounded asyncio.Queue fan-out buffer — all tested via mocked StreamClient, no live Schwab.

## What Was Built

### `apps/sidecar/streamer.py`

Full live-stream engine as a single cohesive module:

| Export | Role |
|--------|------|
| `event_queue` | Module-level `asyncio.Queue(maxsize=500)`; 12-03 SSE endpoint drains it |
| `start_streamer(app)` | Background task: trader-client-only StreamClient → login → subs → handle_message loop |
| `SubscriptionManager` | 490-cap LRU tracker; position legs always-kept; ad-hoc evicted oldest-first |
| `sync_subscriptions(...)` | Pure diff helper: (subscribed, desired_legs, ad_hoc, cap) → (to_add, to_remove) |
| `REQUIRED_OPTION_FIELDS` | LevelOneOptionFields list: SYMBOL, MARK, BID_PRICE, ASK_PRICE, UNDERLYING_PRICE, DELTA, GAMMA, THETA, VEGA, RHO |
| `utc_now_z()` | Always-Z timestamp; mirrors chain_proxy.py lesson |
| `_on_level_one_option(msg)` | Handler: emits tick dict with Z-suffix ts to event_queue |
| `_on_acct_activity(msg)` | Handler: strips ACCOUNT, logs at INFO (no MESSAGE_TYPE branching), puts to event_queue |

### `apps/sidecar/tests/test_streamer.py`

26 new tests across 11 test classes:

- `TestSubscriptionManagerBasic` (4) — empty init, new symbol, re-request no-churn (ad-hoc and leg variants)
- `TestSubscriptionManagerLRU` (3) — 491-symbol cap eviction, LRU order on re-use, position legs never evicted
- `TestSubscriptionManagerPositionLegs` (3) — add/replace/clear legs without touching ad-hoc
- `TestSyncSubscriptions` (5) — add leg, close leg, no-change, ad-hoc in desired, cap enforcement
- `TestStartStreamerDegradeOnNoClient` (1) — returns early when trader_client is None
- `TestStartStreamerTraderClientOnly` (1) — StreamClient(trader_mock), not market_client
- `TestStartStreamerLoginBeforeSubs` (1) — login() called before level_one_option_subs
- `TestRequiredOptionFields` (1) — REQUIRED_OPTION_FIELDS matches enum values
- `TestAcctActivityHandler` (2) — ACCOUNT stripped + Z-suffix, all MESSAGE_TYPEs forwarded
- `TestLevelOneHandler` (2) — Z-suffix tick, absent MARK leaves mark=None
- `TestStreamWarmNoClients` (1) — loop runs independent of SSE client count
- `TestEventQueueModule` (1) — Queue(maxsize=500)
- `TestZSuffixUtility` (1) — utc_now_z ends with Z, no +00:00

## TDD Execution

| Phase | Commit | Result |
|-------|--------|--------|
| RED | `559c94c` — `test(12-02-t1)`: all 26 tests fail (ModuleNotFoundError: streamer) | Confirmed RED |
| GREEN | `f26f4f2` — `feat(12-02-t1)`: 26 new tests + 16 existing = 42 all pass | Confirmed GREEN |

## Deviations from Plan

### Implementation deviation: Task 1 + Task 2 in one GREEN commit

**Plan intent:** Task 1 (pure data structures) and Task 2 (async wiring) should each have separate RED→GREEN cycles.

**What happened:** Both tasks were implemented in a single file (`streamer.py`) in one commit. The `SubscriptionManager` and `start_streamer` are tightly coupled via `event_queue` (a module-level object both reference), making artificial file-splitting unhelpful. The RED commit covered all 26 tests for both tasks simultaneously; the GREEN commit resolved all of them.

**Why acceptable:** The TDD invariant was preserved — tests came before code, RED state was committed and confirmed, GREEN commit only exists after all tests pass. No production code existed before the test file.

### Known stub: `_get_position_occ_symbols` always returns `[]`

`start_streamer` calls `_get_position_occ_symbols(app)` to load the initial position leg set before subscribing. This stub returns `[]` — the streamer starts with no initial LEVELONE subscriptions and receives symbols dynamically via ACCT_ACTIVITY events + the reconcile pull. The full implementation via `/sidecar/positions` (positions_proxy.py) is 12-03 scope.

**Impact:** On a cold start, the first few seconds may have no active subscriptions. ACCT_ACTIVITY events + reconcile (12-03) resolve this. Not a correctness gap — just a startup latency.

## Must-Haves Status

| Truth | Status | Evidence |
|-------|--------|----------|
| StreamClient from TRADER client after has_lock | PASS | `test_stream_client_built_from_trader_not_market` — MockSC called with trader_mock |
| LEVELONE subs with SYMBOL+MARK+BID+ASK+UNDERLYING+DELTA+GAMMA+THETA+VEGA+RHO | PASS | `test_required_option_fields_contains_expected_symbols` — enum values verified against installed schwab-py |
| ACCT_ACTIVITY logged at INFO, forwarded raw, no MESSAGE_TYPE filter | PASS | `test_acct_activity_no_message_type_branching` — 3 types all forwarded |
| SubscriptionManager 490-cap LRU, position legs always-kept | PASS | `test_symbol_cap_eviction`, `test_position_legs_never_evicted_at_cap` |
| sync_subscriptions: level_one_option_add not subs for increments (Pitfall 11) | PASS | `sync_subscriptions` returns (to_add, to_remove) — no StreamClient call inside the pure function |
| Z-suffixed timestamp, ACCOUNT stripped | PASS | `test_acct_activity_forwarded_to_event_queue`, `test_level_one_handler_emits_z_suffixed_tick` |
| Stream warm with 0 clients (D-08) | PASS | `test_stream_warm_no_clients` — loop runs independent of client set |

## Prohibitions Check

| Prohibition | Check |
|-------------|-------|
| No Postgres write in streamer.py (STRM-04) | `grep "leg_observations\|INSERT" streamer.py` → match only in docstring comment, no code |
| No MESSAGE_TYPE equality branch | `grep "message_type ==" streamer.py` → no matches |
| StreamClient not from market_client | `StreamClient(trader_client)` is the only construction site |
| No `level_one_option_subs` for incremental adds | `level_one_option_subs` called only in initial subscription; `level_one_option_add` is the incremental path (used via `sync_subscriptions` output by caller) |
| No token values logged | `logger.error/warning` calls use only `type(exc).__name__` |

## Verification Evidence

```
cd apps/sidecar && .venv/bin/python -m pytest tests/ --tb=short -q
42 passed, 2 warnings in 0.57s
```

Pre-plan baseline: 16 passed. Post-plan: 42 passed. Delta: 26 new tests, all green.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced in this plan. `streamer.py` is a background task that pushes to `event_queue` — it does not expose any HTTP route. The threat mitigations in the plan's `<threat_model>` are all implemented:

- T-12-02-01: ACCOUNT stripped via `item.pop("ACCOUNT", None)` before `event_queue.put_nowait`
- T-12-02-02: `logger.error("... (%s)", type(exc).__name__)` — no token values
- T-12-02-03: `StreamClient(trader_client)` only; handler guard `if trader_client is None: return`
- T-12-02-04: `asyncio.Queue(maxsize=500)` + `QueueFull` caught with drop-and-log

## Self-Check: PASSED

- `apps/sidecar/streamer.py` — FOUND
- `apps/sidecar/tests/test_streamer.py` — FOUND
- `559c94c` (RED commit) — FOUND in git log
- `f26f4f2` (GREEN commit) — FOUND in git log
- Full test suite: 42 passed, 0 failed
