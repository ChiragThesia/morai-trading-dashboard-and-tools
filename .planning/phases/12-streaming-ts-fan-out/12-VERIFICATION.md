---
phase: 12-streaming-ts-fan-out
verified: 2026-06-28T20:45:00Z
status: human_needed
score: 3/6 must-haves verified
behavior_unverified: 3
overrides_applied: 0
behavior_unverified_items:
  - truth: "LEVELONE_OPTION updates log within 30s of market open for open position legs"
    test: "With at least one open position leg, watch sidecar logs at RTH open (9:30 ET)"
    expected: "LEVELONE_OPTIONS messages appear within 30s; sidecar logs show mark/delta/gamma/theta/vega/IV per leg OCC symbol"
    why_human: "Requires live Schwab streaming session + Regular Trading Hours — cannot be exercised offline; timing is a wall-clock invariant, not a static code property"
  - truth: "ACCT_ACTIVITY fill event appears in the sidecar stream within 10s of execution"
    test: "Execute a fill in the test account; observe sidecar ACCT_ACTIVITY log + SSE event"
    expected: "sidecar logs acct_activity within 10s; stream-fan-out receives the event; browser receives it over SSE"
    why_human: "Requires a live test-account fill during RTH; timing is a wall-clock invariant; MESSAGE_TYPE values are empirically unknown until first RTH UAT"
  - truth: "Ad-hoc OCC symbol streams live BSM greeks over the existing SSE (SC6 live tick arrival)"
    test: "At RTH, enter an arbitrary OCC symbol in the AdHocPicker; confirm BSM greeks animate in the AD HOC row over the SSE; clear it and confirm updates stop"
    expected: "Ticks arrive within ~30s of subscribe; AD HOC row animates with live BSM delta/gamma/theta/vega/IV; row is visually distinct from owned positions (AD HOC badge); clearing removes row"
    why_human: "The subscribe chain is automated-verified end-to-end; actual live tick arrival requires a live Schwab stream + RTH to exercise"
human_verification:
  - test: "LEVELONE timing at RTH open (SC1)"
    expected: "Sidecar logs LEVELONE_OPTIONS updates for open leg OCC symbols within 30 seconds of 9:30 ET market open"
    why_human: "Requires live Schwab streaming session + Regular Trading Hours"
  - test: "ACCT_ACTIVITY fill forwarding timing (SC2)"
    expected: "A fill executed in the test account appears as an ACCT_ACTIVITY SSE event within 10 seconds; ACCOUNT field is stripped; MESSAGE_TYPE is logged but not branched on"
    why_human: "Requires a live test-account fill during RTH; MESSAGE_TYPE values not known until empirical capture"
  - test: "Unauthenticated GET /api/stream and POST /api/stream/ticket rejected in browser (SC3 live edge)"
    expected: "From a logged-out browser, both EventSource connect and ticket mint return 401; no JWT appears in browser history or access logs"
    why_human: "Route placement is automated-verified; full browser EventSource + live Supabase session needed for the edge check"
  - test: "Ad-hoc OCC symbol live BSM greeks animate over SSE (SC6 live ticks)"
    expected: "At RTH, entering a valid OCC in the AdHocPicker causes BSM greeks to appear in the AD HOC row within ~30s; values update ~1/sec; clearing the picker stops updates"
    why_human: "Full subscribe chain is automated-verified; actual tick arrival requires live Schwab stream + RTH"
---

# Phase 12: Streaming + TS Fan-Out — Verification Report

**Phase Goal:** The sidecar streams live LEVELONE_OPTION data and ACCT_ACTIVITY fill events for open position legs and ad-hoc instrument lookups; `apps/server` multiplexes the sidecar's single SSE stream to N browser clients over an authed `GET /api/stream`; on cold start the sidecar reconciles current state; live greeks recomputed via BSM engine.

**Verified:** 2026-06-28T20:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC1) | LEVELONE_OPTION updates logged within 30s of market open; fields map to liveGreeks Zod contract | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Code path wired: `streamer.py:_on_level_one_option` → `event_queue` → `sidecar-sse.ts:connectToSidecarStream` → `recomputeLiveGreek` → `bufferTick`. `REQUIRED_OPTION_FIELDS` includes UNDERLYING_PRICE (field 35 for BSM spot). All 60 pytest + 1321 vitest pass. Live 30s timing requires RTH. |
| 2 (SC2) | ACCT_ACTIVITY fill appears in sidecar stream within 10s of execution; forwarded to server fan-out | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Code path wired: `streamer.py:_on_acct_activity` strips ACCOUNT, Z-suffixes ts, puts to `event_queue`. `streamFillEvent` uses `z.unknown()` for activity (no hard-coded MESSAGE_TYPE). Forwarded via `sidecar-sse.ts`. Live timing needs test-account fill at RTH. |
| 3 (SC3) | `GET /api/stream` delivers authed SSE; unauthenticated requests rejected at server edge | ✓ VERIFIED | `stream.routes.ts`: `redeemTicket(rawTicket)` returns 401 on missing/expired/used ticket. `makeStreamSseRouter` (GET only) mounted outside `authReadGroup`; `streamRoutes` POSTs inside `authReadGroup` (Supabase JWT required). Route placement tested: 155 server tests pass including 15 in `stream.routes.test.ts`. |
| 4 (SC4) | After sidecar restart, `/sidecar/positions` called; first SSE event reflects current state | ✓ VERIFIED | `positions_proxy.py`: `GET /sidecar/positions` calls `get_accounts(fields=['positions'])`, filters OPTION type, Z-suffixes `asOf`. `start_streamer` launched post-lock in `_acquire_lock_and_init`. `stream.routes.ts` sends `event: reconcile` FIRST via `deps.reconcilePositions()` before ping loop. `makeSidecarPositionReconciler` wired in `apps/server/src/main.ts:220-222`. 7 positions tests pass. |
| 5 (SC5) | `leg_observations` count unchanged during streaming-only session; no per-tick DB writes | ✓ VERIFIED | `strm04-regression.test.ts`: two testcontainers integration tests (BSM path + direct tick path) both assert `after === before` on `SELECT COUNT(*)::int AS cnt FROM leg_observations`. `stream-fan-out.ts` imports only `type LiveGreekTick` (no Postgres). `ticket-store.ts` has zero imports. `streamer.py` has explicit prohibition comment. Full 1321-test suite passes. |
| 6 (SC6) | Ad-hoc OCC streams live BSM greeks; added to subscription set (490-cap); result row visually distinguished | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Automated chain verified: `AdHocPicker` calls `subscribeAdHoc` → `POST /api/stream/subscribe` (JWT-gated) → `POST /sidecar/subscribe` → `request_ad_hoc_subscription` → `level_one_option_add` (never `subs` — Pitfall 11). `SubscriptionManager` enforces 490-cap LRU; position legs never evicted. AD HOC badge present in `Positions.tsx`. 5 subscribe tests pass + 11 useLiveStream tests. Live tick arrival needs RTH. |

**Score:** 3/6 truths verified (3 present + wired, behavior-unverified on RTH timing)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/contracts/src/stream-events.ts` | 4 Zod schemas (ticket, liveGreek, reconcile, fill) | ✓ VERIFIED | All 4 exported; `z.string().datetime()` rejects `+00:00`, requires `Z`; `streamFillEvent.activity = z.unknown()` (no MESSAGE_TYPE enum) |
| `packages/core/src/streaming/recompute-live-greek.ts` | BSM recompute from mark+spot; never raw Schwab greeks | ✓ VERIFIED | `recomputeLiveGreek`: price = mark ?? mid; `parseOccSymbol` for T; `invertIv` + `bsmGreeks`; typed skip never NaN. No framework imports. |
| `packages/core/src/streaming/ports.ts` | `ForReconcilingPositions`, `RawOptionTick`, `LiveGreekTick` | ✓ VERIFIED | All 4 types + port present; no hono/fastapi/process.env |
| `packages/adapters/src/memory/position-reconciler.ts` | In-memory twin for `ForReconcilingPositions` | ✓ VERIFIED | `makeMemoryPositionReconciler` exports frozen `ReadonlyArray<ReconciledPosition>`; 5 contract tests pass |
| `apps/sidecar/streamer.py` | StreamClient (trader only); 490-cap LRU; ACCT_ACTIVITY no-filter; Z timestamps; event_queue | ✓ VERIFIED | `StreamClient(trader_client)` only; `SubscriptionManager` CAP=490; `_on_acct_activity` forwards all types; `utc_now_z()` with `.replace("+00:00", "Z")`; 26 tests |
| `apps/sidecar/stream_proxy.py` | `GET /sidecar/events` SSE; `POST /sidecar/subscribe` OCC-validated | ✓ VERIFIED | `StreamingResponse` drains `event_queue`; `SubscribeRequest` Pydantic field_validator (21-char OCC regex); `request_ad_hoc_subscription` uses `level_one_option_add` not `subs`; 4 subscribe tests |
| `apps/sidecar/positions_proxy.py` | `GET /sidecar/positions`; Z-suffix asOf; option filter; 503 guard | ✓ VERIFIED | `get_accounts(fields=['positions'])`; `_utc_now_z()` with `.replace("+00:00", "Z")`; OPTION filter; 503 on absent trader_client or exception; 7 tests |
| `apps/sidecar/main.py` | streamer task post-lock; routers included; routes mounted | ✓ VERIFIED | `start_streamer` launched after lock in `_acquire_lock_and_init`; `stream_router`/`positions_router` included via `app.include_router()` at module level |
| `apps/server/src/adapters/http/ticket-store.ts` | Single-use opaque UUID; 30s TTL; injectable clock | ✓ VERIFIED | `mintTicket` + `redeemTicket`; `record.used = true` + `delete` before return (atomic single-use); no JWT/secret in record; 11 tests |
| `apps/server/src/adapters/http/stream-fan-out.ts` | Set fan-out + Map coalescer; dead-client cleanup; 1/sec flush | ✓ VERIFIED | `Set<SSEClient>` + `Map<occSymbol, LiveGreekTick>`; two dead-client paths (aborted + writeSSE rejection); `setInterval(flushTicks, 1_000)`; 11 tests |
| `apps/server/src/adapters/http/strm04-regression.test.ts` | testcontainers leg_observations count invariant | ✓ VERIFIED | Two cases (BSM path + direct tick): `after === before` on real Postgres 16 container; part of 155-test server suite |
| `apps/server/src/adapters/http/stream.routes.ts` | POST /ticket (JWT-gated), POST /subscribe (JWT-gated), GET /stream (ticket-gated, outside JWT) | ✓ VERIFIED | `streamRoutes` for POSTs inside `authReadGroup`; `makeStreamSseRouter` for GET outside (Pitfall 7 split); reconcile-first; OCC re-validated server-side before sidecar proxy |
| `apps/server/src/adapters/http/sidecar-sse.ts` | Frame consumer; Zod safeParse every frame; drop malformed | ✓ VERIFIED | `connectToSidecarStream`: splits on `\n\n`; `sidecarTickSchema.safeParse`; `recomputeLiveGreek` → `bufferTick`; ping skip; 7 tests |
| `packages/adapters/src/sidecar/positions-reconciler.ts` | Real `ForReconcilingPositions` via `GET /sidecar/positions` | ✓ VERIFIED | `makeSidecarPositionReconciler`; 503→AuthExpired; non-200→NetworkError; parse failure→ParseError; 7 tests |
| `apps/web/src/hooks/useLiveStream.ts` | Ticket-mint → EventSource; Zod parse every frame; subscribeAdHoc POST | ✓ VERIFIED | `apiFetch POST /api/stream/ticket` → `streamTicketResponse.parse` → `EventSource(?ticket=)`; D-04 state machine; `subscribeAdHoc` POSTs `/api/stream/subscribe`; 11 tests |
| `apps/web/src/components/LiveStatusBadge.tsx` | 4-state badge (LIVE/STALE/RECONNECTING/POLL) | ✓ VERIFIED | Presentational; `live-dot-pulse` CSS animation; correct color tokens per UI-SPEC Surface 3 |
| `apps/web/src/screens/Positions.tsx` | `useLiveStream()` wired; `AdHocPicker` wired; AD HOC row; live overlay | ✓ VERIFIED | `useLiveStream()` called in `Positions`; `AdHocPicker` calls `subscribeAdHoc` on valid OCC; AD HOC badge + `liveGreeks.get(adHocSymbol)` row; live cells with flash animation |
| `docs/architecture/streaming-fanout.md` | ADR before framework code | ✓ VERIFIED | 120-line ADR: pipeline diagram, ticket rationale, BSM rationale, STRM-04 display-only invariant, Z-suffix contract, hexagon table |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `streamer.py:_on_level_one_option` | `event_queue` | `put_nowait` | ✓ WIRED | QueueFull caught + dropped gracefully |
| `streamer.py:_on_acct_activity` | `event_queue` | `put_nowait` after `deepcopy` + ACCOUNT strip | ✓ WIRED | All MESSAGE_TYPEs forwarded; type-name logging only |
| `stream_proxy.py:GET /sidecar/events` | `streamer.event_queue` | `asyncio.Queue` drain | ✓ WIRED | Yields `data: {json}\n\n`; `_SSE_IDLE_TIMEOUT` ping |
| `apps/server:connectToSidecarStream` | `sidecar-sse.ts:sidecarTickSchema.safeParse` | `recomputeLiveGreek → bufferTick` | ✓ WIRED | `sidecar-sse.ts` Zod-parses each frame; BSM recompute; buffers in coalescer |
| `apps/server:startFlushInterval` | `stream-fan-out.ts:flushTicks` | `setInterval(1000)` | ✓ WIRED | `main.ts:279` — `startFlushInterval()` called at server boot |
| `AdHocPicker → subscribeAdHoc` | `POST /api/stream/subscribe` | `apiFetch` | ✓ WIRED | `useLiveStream.ts:subscribeAdHoc` confirmed in test 9 + test 10 |
| `POST /api/stream/subscribe` | `POST /sidecar/subscribe` | sidecar fetch proxy | ✓ WIRED | `stream.routes.ts`: OCC validated → `fetchFn(sidecarUrl + '/sidecar/subscribe')` |
| `POST /sidecar/subscribe` | `level_one_option_add` | `request_ad_hoc_subscription` | ✓ WIRED | `streamer.py:327-329` — `level_one_option_add(to_add)` NOT `level_one_option_subs` |
| `GET /api/stream` (on connect) | `reconcilePositions() → event: reconcile` | `stream.routes.ts:225-231` | ✓ WIRED | Reconcile sent FIRST before ping loop; graceful degradation on sidecar failure |
| `makeSidecarPositionReconciler` | `GET /sidecar/positions` | `fetch(baseUrl + '/sidecar/positions')` | ✓ WIRED | `main.ts:220-222`: wired as `reconcilePositions` dep in `streamRouteDeps` |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 60 Python sidecar tests pass | `cd apps/sidecar && .venv/bin/python -m pytest tests/ -q` | 60 passed, 0 failed | ✓ PASS |
| Full TS workspace suite (1321 tests) | `bun run test` | 1321 passed (145 files) | ✓ PASS |
| stream.routes tests (SC3 auth, SC4 reconcile-first) | `bun run test --project server -- stream.routes` | 155 passed | ✓ PASS |
| STRM-04 testcontainers regression gate | `bun run test --project server -- strm04-regression` | before=0, after=0 (both cases) | ✓ PASS |
| stream-events +00:00 rejection / Z accepted | `bun run test -- packages/contracts/src/stream-events.test.ts` | 17 passed | ✓ PASS |
| sidecar subscribe route (SC6 chain) | `cd apps/sidecar && .venv/bin/python -m pytest tests/test_stream_proxy.py -k subscribe` | 5 passed | ✓ PASS |
| sidecar positions proxy (SC4 reconcile) | `cd apps/sidecar && .venv/bin/python -m pytest tests/test_positions_proxy.py` | 7 passed | ✓ PASS |
| useLiveStream hook (ticket-mint, subscribeAdHoc POST) | `bun run test --project web -- useLiveStream` | 143 web tests passed | ✓ PASS |
| stream warm with 0 clients (D-08) | `cd apps/sidecar && .venv/bin/python -m pytest tests/test_streamer.py -k warm_no_clients` | 1 passed | ✓ PASS |
| typecheck clean | `bun run typecheck` | 0 errors | ✓ PASS |
| lint clean | `bun run lint` | 0 errors (2 pre-existing boundary selector warnings, not new) | ✓ PASS |

---

### Landmine Verification

| Landmine | Check | Status |
|----------|-------|--------|
| TRADER client only (not market) | `streamer.py:365` — `stream_client = StreamClient(trader_client)` | ✓ PASS |
| Advisory lock held before login() | `start_streamer` launched inside `_acquire_lock_and_init` after `pg_try_advisory_lock` succeeds; `login()` at `streamer.py:373` inside `start_streamer` | ✓ PASS |
| LEVELONE_OPTIONS plural (schwab-py method name) | `streamer.py:384` — `level_one_option_subs` for initial; incremental via `level_one_option_add` (Pitfall 11) | ✓ PASS |
| UNDERLYING_PRICE field 35 for BSM spot | `streamer.py:204` — `item.get("UNDERLYING_PRICE", item.get("35"))` dual-key | ✓ PASS |
| ACCT_ACTIVITY MESSAGE_TYPE not hard-coded | `streamFillEvent.activity = z.unknown()`; `_on_acct_activity` forwards all types without branching | ✓ PASS |
| Sidecar→TS timestamps Z-suffixed | `utc_now_z()` in `streamer.py:52`; `_utc_now_z()` in `positions_proxy.py:45`; both use `.replace("+00:00", "Z")` | ✓ PASS |
| No per-tick Postgres writes | `stream-fan-out.ts` imports only `type LiveGreekTick`; `ticket-store.ts` zero imports; `streamer.py` explicit prohibition; STRM-04 gate confirms | ✓ PASS |
| No `any`/`as`/`!` in TS streaming files | Lint passes 0 errors; `sidecar-sse.ts`, `stream.routes.ts`, `useLiveStream.ts` all comment-documented as no-cast | ✓ PASS |
| Core stays framework-free | `packages/core/src/streaming/` — no hono, fastapi, process.env, node I/O imports | ✓ PASS |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `apps/sidecar/streamer.py:286-292` | `_get_position_occ_symbols` returns `[]` (documented stub) | ℹ️ Info | Acknowledged: returns empty list; positions loaded via `/sidecar/positions` reconcile (12-03). Not a correctness gap — startup latency only |
| `apps/server/src/main.ts` | `riskFreeRate: 0.045` and `dividendYield: 0.013` hardcoded (marked `// ponytail:`) | ℹ️ Info | Documented approximations (SOFR / SPX 12m trailing yield). `ponytail:` tag flags for future promotion to config. No functional impact. |
| `apps/sidecar/main.py:378` | `# type: ignore[attr-defined]` on `app.state.stream_client = stream_client` | ℹ️ Info | Required because FastAPI's `State` type does not statically declare dynamic attributes; common FastAPI pattern, not a logic gap |

No TBD/FIXME/XXX/PLACEHOLDER debt markers in Phase 12 files.

---

### Requirements Coverage

| Requirement | Plans | Status | Evidence |
|-------------|-------|--------|----------|
| STRM-01 (LEVELONE_OPTIONS + BSM recompute + ad-hoc) | 12-01, 12-02, 12-03, 12-06 | ✓ Code SATISFIED / ⚠️ Live timing HUMAN_NEEDED | `recomputeLiveGreek`, `REQUIRED_OPTION_FIELDS`, `SubscriptionManager`, `AdHocPicker` all wired; live timing RTH-gated |
| STRM-02 (ACCT_ACTIVITY forwarding) | 12-02, 12-03 | ✓ Code SATISFIED / ⚠️ Live timing HUMAN_NEEDED | `_on_acct_activity` no-filter; `z.unknown()` activity; forwarding chain wired |
| STRM-03 (authed SSE; unauthenticated rejected) | 12-04, 12-05 | ✓ SATISFIED | Ticket gate + route placement + 155 server tests |
| STRM-04 (no per-tick writes) | 12-04 | ✓ SATISFIED | testcontainers count-invariant gate; no Postgres imports in hot path |
| STRM-05 (reconcile on restart/reconnect) | 12-03, 12-05 | ✓ SATISFIED | `positions_proxy.py` + `makeSidecarPositionReconciler` + reconcile-first in stream.routes.ts |

---

### Human Verification Required

### 1. LEVELONE Timing at RTH Open (SC1)

**Test:** With at least one open position leg in the test account, watch sidecar logs starting at 9:30 ET.
**Expected:** Within 30 seconds, sidecar logs show LEVELONE_OPTIONS messages with mark, delta, gamma, theta, vega, IV for each leg's OCC symbol. The server fan-out receives the ticks; browser Positions screen shows live BSM values updating ~1/sec.
**Why human:** Requires a live Schwab streaming session + Regular Trading Hours. The 30s timing bound is a wall-clock invariant. Discover actual `MESSAGE_TYPE` values here too (RESEARCH open question).

### 2. ACCT_ACTIVITY Fill Forwarding (SC2)

**Test:** Execute a fill in the test account during RTH. Observe sidecar logs and browser SSE.
**Expected:** Within 10 seconds, sidecar logs show `ACCT_ACTIVITY message_type=<type>` (type name logged, not branched on). Server fan-out receives the raw event. Browser receives the SSE frame. `sync-transactions` REST remains the authoritative fill source — the SSE event is display-only.
**Why human:** Requires a live test-account fill. MESSAGE_TYPE values are undocumented — empirical capture is the first RTH UAT action.

### 3. Unauthenticated SSE in Browser (SC3 live edge)

**Test:** From a logged-out browser, open devtools and attempt `new EventSource("/api/stream?ticket=invalid")` and `fetch("/api/stream/ticket", { method: "POST" })`.
**Expected:** Both return 401. No JWT appears in browser URL history or devtools network tab query strings. The opaque ticket flow (`POST /api/stream/ticket` → UUID → EventSource) works for an authenticated session.
**Why human:** Route placement and 401 logic are automated-verified. Full browser EventSource + live Supabase session is needed for the end-to-end live edge check.

### 4. Ad-Hoc OCC Live BSM Greeks at RTH (SC6 live ticks)

**Test:** At RTH, open the Positions screen. Enter a valid OCC symbol (e.g. a near-term SPX option) in the AdHocPicker and submit. Wait up to 30 seconds.
**Expected:** The AD HOC row animates with live BSM delta/gamma/theta/vega/IV values updating ~1/sec. The row has a distinct AD HOC badge vs. owned positions. Clicking × removes the row and stops updates.
**Why human:** The full subscribe chain is automated-verified (AdHocPicker → POST /api/stream/subscribe → sidecar level_one_option_add). Actual tick arrival requires a live Schwab stream at RTH.

---

### Gaps Summary

No gaps. All automated success criteria (SC3, SC4, SC5, SC6 chain) are verified by code evidence and passing test suites. The three human_needed items (SC1, SC2, SC6 live ticks) are inherently RTH-gated and correctly classified in the validation plan as manual-only.

The phase goal is achieved for everything that can be verified offline. The human verification items track the live Schwab streaming behaviors that require market hours, not missing implementation.

---

_Verified: 2026-06-28T20:45:00Z_
_Verifier: Claude (gsd-verifier)_
