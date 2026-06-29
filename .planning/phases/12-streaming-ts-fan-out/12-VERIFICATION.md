---
phase: 12-streaming-ts-fan-out
verified: 2026-06-29T20:30:00Z
status: human_needed
score: 4/5 must-haves verified
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 3/6 must-haves verified
  gaps_closed:
    - "Live SSE greeks never reached the rendered screen (useLiveStream orphaned in dead Positions.tsx — now wired into Overview)"
    - "No LiveStatusBadge visible on Overview (now rendered in 'Open positions · greeks' header)"
    - "CR-01 correctness bug: net greeks over-scaled by netQty² instead of netQty — fixed with 4 RED→GREEN lock-in tests"
  gaps_remaining: []
  regressions: []
behavior_unverified_items:
  - truth: "Opening the mounted Overview screen during RTH, open-position greek cells update ~1/sec over the live SSE stream WITHOUT a page refresh, flashing on each tick (STRM-01 live timing)"
    test: "Open Overview at RTH open (9:30 ET) with at least one open position leg; watch greek cells"
    expected: "Δ/Γ/Θ/Vega + Net val + Unreal cells flash and update approximately once per second; badge shows LIVE; no page refresh needed"
    why_human: "The wiring is fully present (useLiveStream → resolveLivePositionRow → live-cell-flash). The ~1/sec live timing is a wall-clock invariant requiring a live Schwab SSE stream during RTH — cannot be exercised offline."
human_verification:
  - test: "Live BSM greeks update ~1/sec in Overview during RTH (SC1 / STRM-01)"
    expected: "Δ/Γ/Θ/Vega + Net val + Unreal cells flash and animate without page refresh; badge LIVE; updates within ~30s of RTH open"
    why_human: "Code path fully wired (verified); the ~1/sec timing guarantee requires a live Schwab stream at RTH"
  - test: "Connection status badge states: STALE → RECONNECTING → LIVE cycle (D-04)"
    expected: "Drop connection (toggle wifi/sleep) → badge STALE, live cells dim via .live-cell.stale color (not opacity). On recovery → badge LIVE, cells brighten"
    why_human: "CSS and class logic verified by test; end-to-end badge state transitions require a live stream session to exercise the state machine"
  - test: "LEVELONE timing at RTH open (SC1)"
    expected: "Within 30s of 9:30 ET, sidecar logs LEVELONE_OPTIONS ticks with mark/delta/gamma/theta/vega/IV per leg OCC symbol; server fan-out receives them; browser live overlay updates"
    why_human: "Requires live Schwab streaming session + RTH — 30s timing bound is a wall-clock invariant"
  - test: "ACCT_ACTIVITY fill forwarding timing (SC2)"
    expected: "A fill in the test account appears as ACCT_ACTIVITY SSE event within ~10s; sidecar logs the message_type; server fan-out receives; browser gets the frame"
    why_human: "Requires a live test-account fill at RTH; MESSAGE_TYPE values undocumented until empirical capture"
  - test: "Unauthenticated SSE rejected in browser (SC3 live edge)"
    expected: "Logged-out browser: EventSource with invalid ticket and POST /api/stream/ticket both return 401; no JWT in URL or network log"
    why_human: "Route placement and 401 logic automated-verified; full browser EventSource + live Supabase session needed for the edge check"
  - test: "Ad-hoc OCC live BSM greeks on Analyzer (SC6)"
    expected: "At RTH, enter a valid OCC in the AdHocPicker on Analyzer; AD HOC row animates with live BSM values within ~30s; clearing the picker stops updates"
    why_human: "Subscribe chain automated-verified; tick arrival requires live Schwab stream + RTH"
---

# Phase 12: Streaming + TS Fan-Out — Verification Report (Re-verification after 12-07 gap closure)

**Phase Goal:** The sidecar streams live LEVELONE_OPTION + ACCT_ACTIVITY data; live greeks/IV recomputed via BSM; apps/server multiplexes the sidecar's single SSE stream to N browser clients over an authed GET /api/stream (Supabase JWT → short-lived opaque ticket); cold-start/reconnect reconcile via REST so the live view has no gaps.

**Verified:** 2026-06-29T20:30:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plans 12-07 + CR-01 fix)

---

## Goal Achievement

### Re-Verification Context

The prior VERIFICATION (2026-06-28) scored 3/6 with `human_needed`. UAT (12-UAT.md) diagnosed two **major** gaps — tests 2 and 3:

- **Test 2**: Live BSM greeks never reached the rendered screen. Root cause: the 5→3 screen redesign orphaned the live overlay in `Positions.tsx` (dead code). The mounted `Overview.tsx` polled via `usePositions()` + static `computePositionGreeks` and never imported `useLiveStream`.
- **Test 3**: No `LiveStatusBadge` visible on Overview. Same root cause.

Plan 12-07 closed both gaps. Subsequent code review (12-REVIEW.md) found **CR-01**: net greeks over-scaled by `netQty²` in both the new resolver and Overview's `netGreeksForLegs`, fixed in commit `112d1b1` with 4 RED→GREEN lock-in tests.

This re-verification checks 12-07's five must-haves and the CR-01 fix against the actual codebase.

---

### Observable Truths — 12-07 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Greek cells update ~1/sec over live SSE in Overview during RTH without page refresh (STRM-01 live timing) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Wiring fully present: `useLiveStream()` called in Overview (line 407); `resolveLivePositionRow` used per-row (line 218) and for Net total (line 177); `.live-cell-flash` key includes `liveTs` (e.g. `key={\`${r.key}-delta-${liveTs ?? ""}\`}`); per-symbol static fallback (empty `liveGreeks` Map → static path). 161 web tests pass. Live timing wall-clock invariant requires RTH. |
| 2 | `LiveStatusBadge` in 'Open positions · greeks' header shows POLL/LIVE/STALE/RECONNECTING (D-04) | ✓ VERIFIED | `LiveStatusBadge` imported at Overview.tsx:12, rendered at line 420 inside a `flex items-center gap-2` div beside `SectionLabel`. Overview.test.tsx: `getByText("POLL")` (line 148), `getByText("LIVE")` (line 163), `getByText("STALE")` (line 174) — all pass. |
| 3 | Stream-stale cells dim by COLOR via `.live-cell.stale` — never opacity — numbers stay readable (Surface 2 / a11y) | ✓ VERIFIED | `index.css:130-132`: `.live-cell.stale { color: var(--color-dim); }` — CSS property is `color`, not `opacity`. `liveCellCn()` in Overview (line 168-171) returns `"live-cell stale"` when `isStale`. Overview.test.tsx line 175: `container.querySelector(".live-cell.stale")` is non-null on stale status. |
| 4 | Symbol with no live tick falls back to polled/static value per-symbol — no blank cell, no crash | ✓ VERIFIED | `live-position-greeks.ts` lines 78-130: `liveGreeks.get(leg.occSymbol)` returns `undefined` → static path (`computePositionGreeks` + `marketValue`). Test 1 (fast-check property): empty Map → output byte-identical to static math. Test 4 (mixed legs): one leg with tick, one without — contributions sum correctly. |
| 5 | Exactly one positions table remains (Overview); Positions.tsx + its test are removed | ✓ VERIFIED | `apps/web/src/screens/` contains 11 files — no `Positions.tsx`, no `Positions.test.tsx`. `rg "screens/Positions\|from.*./Positions" apps/web/src/` returns 0 matches. Only Overview renders a positions table. |

**Score:** 4/5 truths verified (1 present + wired, behavior-unverified on RTH timing)

---

### CR-01 Correctness Bug Fix

**Bug:** `computePositionGreeks` returns `kernel × netQty` (signed). Both the live overlay and Overview's `netGreeksForLegs` then multiplied by `nq = netQty × 100`, yielding `kernel × netQty² × 100`. This is correct only for `|netQty| = 1` (single-lot). For a 2-lot long leg: greeks 2× over-stated. For any short leg: sign flipped (netQty² is always positive).

**Fix in commit 112d1b1 — all three sites corrected:**

| File | Fix |
|------|-----|
| `apps/web/src/lib/live-position-greeks.ts:109-129` | Static branch: `× 100` only (not `× nq`). Live branch: `× nq` only (not `× netQty × nq`). Comments reference CR-01. |
| `apps/web/src/screens/Overview.tsx:59-64` | `netGreeksForLegs`: `× 100` only. Comment: "computePositionGreeks already applied netQty; apply ONLY the ×100 contract multiplier — multiplying by netQty×100 double-applies netQty (CR-01)." |
| `apps/web/src/lib/live-position-greeks.test.ts:50-55` | Test helper `netGreeksForLegs`: same `× 100` fix. |

**Lock-in tests (4 RED→GREEN, commit 112d1b1):**

| Test | Covers |
|------|--------|
| `static 2-lot long leg: greeks scale by ×100, not ×nq (×200)` | Multi-lot magnitude — would fail with the buggy ×nq |
| `live 2-lot long leg: greeks = tick.bsm* × netQty × 100, not × netQty² (×400)` | Live multi-lot magnitude |
| `static short 1-lot leg: greeks are signed by netQty (short put flips sign)` | Sign correctness on short — would fail if `nq²` drops the sign |
| `live short 1-lot leg: greeks = tick.bsm* × netQty × 100 (signed by short netQty)` | Live short sign |

Verified present in `live-position-greeks.test.ts` at lines 313-360, inside `describe("resolveLivePositionRow — CR-01 net-qty scaling regression")`.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/lib/live-position-greeks.ts` | Pure `resolveLivePositionRow` resolver; exports `LiveRowResult` | ✓ VERIFIED | 142 lines. Exports `resolveLivePositionRow` and `LiveRowResult`. Static path multiplies `× 100` only (CR-01 fixed). Live path multiplies `× nq`. `liveGreeks.get()` narrowed with `!== undefined` (no `!`/`as`). |
| `apps/web/src/lib/live-position-greeks.test.ts` | Unit + fast-check tests; CR-01 regression suite | ✓ VERIFIED | 362 lines. 8 example tests + 2 fast-check properties + 4 CR-01 regression tests. All pass (161 web tests total). |
| `apps/web/src/screens/Overview.tsx` | Mounts `useLiveStream`; overlays live cells; renders `LiveStatusBadge` | ✓ VERIFIED | `useLiveStream()` at line 407; `resolveLivePositionRow` imported at line 8, used at lines 177 + 218; `LiveStatusBadge` at line 420. `netGreeksForLegs` corrected for CR-01. |
| `apps/web/src/screens/Overview.test.tsx` | Live overlay wiring tests (badge, .live-cell, .live-cell.stale, static fallback) | ✓ VERIFIED | `useLiveStream` mock hoisted before `Overview` import. 4 live-overlay tests: POLL badge (148), no live-cell on empty map (155), LIVE + .live-cell (163-165), STALE + .live-cell.stale (174-175). |
| `apps/web/src/screens/Positions.tsx` | DELETED | ✓ VERIFIED (absent) | File not present in screens dir. |
| `apps/web/src/screens/Positions.test.tsx` | DELETED | ✓ VERIFIED (absent) | File not present in screens dir. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `Overview.tsx` | `useLiveStream.ts` | `useLiveStream()` called in `Overview` component | ✓ WIRED | Line 5 import; line 407-411 call; destructures `greeks`, `status`, `lastTickAt` |
| `Overview.tsx` | `live-position-greeks.ts` | `resolveLivePositionRow` per-row + Net total | ✓ WIRED | Line 8 import; line 218 per-row; line 177 Net total (included legs flat-map) |
| `Overview.tsx` | `LiveStatusBadge.tsx` | Badge rendered in 'Open positions · greeks' header | ✓ WIRED | Line 12 import; line 420 render with `status={liveStatus}` and `lastTickAt={liveLastTickAt}` |
| `PositionsTable` | `liveGreeks` + `liveStatus` props | Passed from `Overview` to `PositionsTable` | ✓ WIRED | Lines 152-158 prop types; lines 423-428 call site |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Web test suite (all 23 files) | `bun run test --project web` | 161 passed, 0 failed, 23 files | ✓ PASS |
| CR-01 regression suite (4 lock-in tests) | Part of above run | All 4 tests in `CR-01 net-qty scaling regression` describe block pass | ✓ PASS |
| Positions.tsx/test absent, no source references | `rg "screens/Positions\|from.*./Positions" apps/web/src/` | 0 matches | ✓ PASS |
| `.live-cell.stale` uses color not opacity | `rg "live-cell.stale" apps/web/src/index.css` | `color: var(--color-dim)` — no `opacity` property | ✓ PASS |

---

### Requirements Coverage — Phase 12 (12-07 scope: STRM-01, STRM-05)

| Requirement | Plans | Description | Status | Evidence |
|-------------|-------|-------------|--------|----------|
| STRM-01 | 12-01, 12-02, 12-03, 12-06, **12-07** | Live LEVELONE_OPTION + BSM recompute + ad-hoc; **live greeks reach the rendered screen** | ✓ Code SATISFIED / ⚠️ Live timing RTH-gated | 12-07 closed the UI wiring gap. `useLiveStream` mounted in Overview; `resolveLivePositionRow` overlays ticks per row; badge wired. CR-01 scaling fix ensures greeks correct for multi-lot. |
| STRM-05 | 12-03, 12-05 | On (re)connect, sidecar reconciles current state | ✓ SATISFIED | Unchanged from prior verification: `positions_proxy.py` + `makeSidecarPositionReconciler` + reconcile-first in `stream.routes.ts` |

**STRM-02, STRM-03, STRM-04** verified in the prior VERIFICATION (2026-06-28): SC3/SC4/SC5 code-verified by test suites; STRM-02 live timing RTH-gated. These are not in 12-07 scope and unchanged by this plan.

**Note on REQUIREMENTS.md checkmarks:** STRM-03 and STRM-04 are checked `[ ]` in REQUIREMENTS.md but were code-verified in the initial VERIFICATION (155 server tests including auth gates, STRM-04 testcontainers count-invariant). The checkbox state reflects a REQUIREMENTS.md update gap, not missing implementation.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `live-position-greeks.ts:134` | `liveTs` selection uses lexicographic string compare | ⚠️ Warning (WR-02, deferred) | Flash-key / stale-dim only — not the displayed numbers. Sidecar emits uniform-precision `Z` timestamps, so in practice this is safe. Deferred per code review. |
| `Overview.test.tsx:46-47` | `as unknown as ReturnType<...>` cast in test mock (eslint-disabled) | ℹ️ Info (IN-01, deferred) | Test-only; low risk. eslint-disable comment present. Deferred per code review. |

No `TBD`, `FIXME`, or `XXX` markers in 12-07 files.

---

### Gaps Summary

No gaps. All code-verifiable truths are verified. The one `⚠️ PRESENT_BEHAVIOR_UNVERIFIED` item (live 1/sec streaming during RTH) was correctly classified in the prior verification and remains RTH-gated — it is not a missing implementation.

The gap-closure plan 12-07 fully resolved the two UAT failures:
1. Live SSE greeks now reach the mounted Overview (useLiveStream wired, resolveLivePositionRow threaded in).
2. LiveStatusBadge now appears in the 'Open positions · greeks' header.
3. CR-01 net-greek scaling bug fixed across all three sites with 4 RED→GREEN lock-in tests.

---

### Human Verification Required

### 1. Live BSM Greeks Update ~1/sec in Overview During RTH (SC1 / STRM-01)

**Test:** With at least one open position leg, open Overview at RTH market open (9:30 ET). Watch the greek cells for 60 seconds.
**Expected:** Δ/Γ/Θ/Vega + Net val + Unreal cells flash (violet pulse) and update approximately once per second without a page refresh. Badge shows LIVE. First updates arrive within ~30s of RTH open.
**Why human:** Wiring is fully present and code-verified. The ~1/sec live timing and first-tick latency are wall-clock invariants that require a live Schwab SSE stream during Regular Trading Hours.

### 2. STALE/RECONNECTING Badge Cycle (D-04)

**Test:** During an active RTH stream, briefly drop the connection (toggle wifi or put laptop to sleep) then restore.
**Expected:** Badge transitions LIVE → STALE (amber) → RECONNECTING → LIVE. Live cells dim via `.live-cell.stale` color change (numbers still readable, not hidden or faded via opacity). On recovery cells brighten.
**Why human:** The CSS class logic and `.live-cell.stale { color: var(--color-dim) }` are verified. The end-to-end state-machine transitions require a live stream session to exercise.

### 3. LEVELONE Timing at RTH Open (SC1)

**Test:** Watch sidecar logs starting at 9:30 ET with an open leg.
**Expected:** Within 30 seconds, sidecar logs LEVELONE_OPTIONS messages with mark/delta/gamma/theta/vega/IV for each leg's OCC symbol.
**Why human:** Requires live Schwab streaming session + RTH. Discover actual MESSAGE_TYPE values here.

### 4. ACCT_ACTIVITY Fill Forwarding Timing (SC2)

**Test:** Execute a fill in the test account during RTH. Observe sidecar logs and browser SSE.
**Expected:** Within ~10 seconds, sidecar logs an ACCT_ACTIVITY event (message_type logged, not branched on). Server fan-out receives it. Browser gets the SSE frame.
**Why human:** Requires a live test-account fill. MESSAGE_TYPE values undocumented until empirical capture.

### 5. Unauthenticated SSE Rejected in Browser (SC3 Live Edge)

**Test:** From a logged-out browser devtools: `new EventSource("/api/stream?ticket=invalid")` and `fetch("/api/stream/ticket", { method: "POST" })`.
**Expected:** Both return 401. No JWT in URL or devtools network query strings.
**Why human:** Route placement and 401 logic are automated-verified. Full browser EventSource + live Supabase session needed for the edge check.

### 6. Ad-Hoc OCC Live BSM Greeks on Analyzer (SC6)

**Test:** At RTH, open Analyzer and enter a valid OCC symbol in the AdHocPicker. Wait up to 30 seconds.
**Expected:** AD HOC row animates with live BSM delta/gamma/theta/vega/IV. Row has distinct AD HOC badge. Clicking × removes row and stops updates.
**Why human:** Full subscribe chain automated-verified (AdHocPicker → POST /api/stream/subscribe → sidecar level_one_option_add). Actual tick arrival requires live Schwab stream + RTH.

---

_Verified: 2026-06-29T20:30:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Plan 12-07 gap closure + CR-01 correctness fix_
