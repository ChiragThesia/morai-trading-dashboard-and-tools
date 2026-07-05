---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
plan: 03
subsystem: streaming
tags: [react, sse, zod, vitest, watchdog, ui-tokens]

# Dependency graph
requires:
  - phase: 20-01
    provides: "streamPingEvent Zod schema in @morai/contracts, deriveStreamStatus pure fn in apps/web/src/lib"
  - phase: 20-02
    provides: "GET /api/stream ping heartbeat carries server-authoritative { isRth: boolean }"
provides:
  - "useLiveStream hook wired to the ping heartbeat: tracks isRth + hasReceivedFirstTick, derives live/quiet/stalled via a shared elapsed-time interval, exposes reconnectNow() (D-17)"
  - "LiveStatusBadge restyled to the 3-state WATCH-01 alarm badge (live/quiet/stalled + CONNECTING copy condition), matching 20-UI-SPEC.md tokens exactly"
affects: [20-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single shared setInterval as the ONLY writer of a derived-state value (Pattern 1 grace-then-escalate timer) — event handlers (onerror/onopen/ping/ticks) only update raw inputs (refs), never the derived output directly"
    - "Fake timers installed BEFORE renderHook() so a mount-time setInterval is itself fake-timer-controlled; async setup (ticket mint) driven via explicit microtask flushing (`await Promise.resolve()` x N) instead of testing-library's real-timer-based `waitFor`, since the two timer regimes don't mix mid-test"

key-files:
  created:
    - apps/web/src/components/LiveStatusBadge.test.tsx
  modified:
    - apps/web/src/hooks/useLiveStream.ts
    - apps/web/src/hooks/useLiveStream.test.ts
    - apps/web/src/components/LiveStatusBadge.tsx
    - apps/web/src/screens/Overview.tsx
    - apps/web/src/screens/Overview.test.tsx

key-decisions:
  - "Dropped the 'reconcile' SSE listener from useLiveStream entirely rather than keeping an empty-bodied handler — under the new model it only ever set status directly (exactly what Pitfall 1 forbids), so removing it is a no-op behaviorally and less dead code than validating-and-discarding"
  - "STATUS_INTERVAL_MS = 2000ms (within the RESEARCH-recommended 1-5s band) — chosen for a responsive-but-cheap re-evaluation cadence, independent of the server's 30s ping interval (Pitfall 5)"
  - "LiveStatusBadge holds last-known-good via a useRef guard against an unrecognized status value (KNOWN_STATUSES set) — defensive per the plan's acceptance criteria, even though the TS union makes this unreachable through normal typed callers"
  - "STALL_THRESHOLD_MS is exported from useLiveStream.ts and imported into LiveStatusBadge.tsx (single source of truth for the '20s' in the STALLED tooltip copy) rather than duplicating the magic number"

patterns-established:
  - "Pattern 1 applied end-to-end: elapsed-time anchor (lastTickOrConnectAtRef) + last-known isRth, re-evaluated on a shared interval — no event handler sets the derived status directly"

requirements-completed: [WATCH-01]

coverage:
  - id: D1
    description: "useLiveStream wires the ping listener (streamPingEvent.safeParse), tracks isRth with last-known-good on malformed pings, and drops the 'reconcile' listener that used to set status directly"
    requirement: WATCH-01
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useLiveStream.test.ts#useLiveStream > a well-formed ping updates isRth"
        status: pass
      - kind: unit
        ref: "apps/web/src/hooks/useLiveStream.test.ts#useLiveStream > drops a malformed ping and retains last-known-good isRth (T-20-02)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A shared 2s interval derives live/quiet/stalled via deriveStreamStatus against the elapsed-time anchor + isRth — stall fires at the 20s boundary and recovers to live once ticks resume; isRth=false always wins to quiet"
    requirement: WATCH-01
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useLiveStream.test.ts#useLiveStream > transitions to 'stalled' after >= 20s of silence during RTH, and back to 'live' when ticks resume"
        status: pass
      - kind: unit
        ref: "apps/web/src/hooks/useLiveStream.test.ts#useLiveStream > derives 'quiet' when isRth is false, even once ticks are arriving (quiet wins, Pattern 1 branch order)"
        status: pass
    human_judgment: false
  - id: D3
    description: "es.onerror never sets status directly (Pitfall 1) — status only reaches 'stalled' once elapsed silence crosses the threshold, even immediately after a transport error"
    requirement: WATCH-01
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useLiveStream.test.ts#useLiveStream > es.onerror does not set status directly — only sustained elapsed silence reaches 'stalled' (Pitfall 1)"
        status: pass
    human_judgment: false
  - id: D4
    description: "reconnectNow() cancels the pending exp-backoff timer before reconnecting (no double-connect) and is re-entrancy-safe"
    requirement: WATCH-01
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useLiveStream.test.ts#useLiveStream > reconnectNow cancels the pending exp-backoff timer before reconnecting (D-17 double-connect guard)"
        status: pass
      - kind: unit
        ref: "apps/web/src/hooks/useLiveStream.test.ts#useLiveStream > reconnectNow is re-entrancy-safe — a second call while one is in flight is a no-op"
        status: pass
    human_judgment: false
  - id: D5
    description: "LiveStatusBadge renders exactly 3 states (LIVE/QUIET/STALLED) with the exact 20-UI-SPEC.md tokens; STALLED uses the down/red alarm token (never amber) and shows a working Reconnect-now button"
    requirement: WATCH-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/LiveStatusBadge.test.tsx#LiveStatusBadge > renders STALLED with the down/red alarm token (D-20) — never the retired amber token"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/LiveStatusBadge.test.tsx#LiveStatusBadge > renders the 'Reconnect now' button only when STALLED, and calls onReconnect on click"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/LiveStatusBadge.test.tsx#LiveStatusBadge > disables the force-reconnect button and relabels it 'Reconnecting…' while a manual reconnect is in flight"
        status: pass
    human_judgment: false
  - id: D6
    description: "CONNECTING is a copy-only condition (status==='quiet' AND isRth===true AND !hasReceivedFirstTick), sharing QUIET's exact visual classes — not a 4th status enum member"
    requirement: WATCH-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/LiveStatusBadge.test.tsx#LiveStatusBadge > shows CONNECTING copy under (status==='quiet', isRth===true, !hasReceivedFirstTick) — same classes as QUIET"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/LiveStatusBadge.test.tsx#LiveStatusBadge > does NOT show CONNECTING copy when isRth is null (true cold start, before any ping)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Manual chrome-devtools UAT: sever the stream during RTH → red STALLED reads as a fault in the live Overview UI; Reconnect-now flips to LIVE and cancels the pending backoff"
    human_judgment: true
    rationale: "Requires a real running server + browser session to sever an actual SSE connection and visually confirm the alarm tone/interaction — not something a unit test can observe end-to-end."

# Metrics
duration: 45min
completed: 2026-07-05
status: complete
---

# Phase 20 Plan 03: WATCH-01 Client Wiring — 3-State Stream Badge Summary

**`useLiveStream` now wires the previously-ignored SSE `ping` event into a shared elapsed-time interval that derives an honest live/quiet/stalled status (never LIVE while ticks are stalled), and `LiveStatusBadge` is restyled to the exact 3-state alarm-tone contract from 20-UI-SPEC.md with a working backoff-cancelling force-reconnect button — closing the Phase-12 "badge lies LIVE" debt.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-05T05:46Z
- **Tasks:** 2 completed
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments
- `useLiveStream.ts`: added an `es.addEventListener("ping", …)` that Zod-parses `streamPingEvent` and stores `isRth` (last-known-good on a malformed frame), tracks `hasReceivedFirstTick`/`lastTickOrConnectAt`, and runs a single shared 2s `setInterval` that is the ONLY place `status` is ever set — deriving `live`/`quiet`/`stalled` via 20-01's `deriveStreamStatus` against that elapsed-time anchor plus the last known `isRth` (RESEARCH Pattern 1).
- Removed the old 4-state `live`/`stale`/`reconnecting`/`poll` machine — `es.onerror`/`onopen` now only manage the EventSource lifecycle + exponential-backoff reconnect scheduling, never setting status directly (Pitfall 1). Dropped the now-inert `reconcile` listener (it only ever existed to set status directly, which the new model forbids).
- Added `reconnectNow()` (D-17): cancels the pending exp-backoff `setTimeout` before reconnecting immediately with a fresh ticket, guarded against re-entrancy with an in-flight ref, and exposes `isReconnecting` for the badge's button state.
- `LiveStatusBadge.tsx`: replaced the 4-key `STATUS_CONFIG` with the 3-key `live`/`quiet`/`stalled` record using the exact 20-UI-SPEC.md tokens — STALLED reuses the down/red alarm token (`text-down`/`bg-downd`/`ring-down/40`, D-20 resolution) instead of the retired amber "stale" look. CONNECTING is derived as a copy-only condition `(status==='quiet' && isRth===true && !hasReceivedFirstTick)` sharing QUIET's exact classes (D-11) — no 4th enum member (D-01). Renders an inline Phase-21 `Button variant="primary" size="xs"` "Reconnect now" CTA only in STALLED, disabling to "Reconnecting…" while `isReconnecting`. Holds last-known-good on an unrecognized status value via an internal ref guard.
- Wired `Overview.tsx`'s `LiveStatusBadge` call site to the hook's new `isRth`/`hasReceivedFirstTick`/`isReconnecting`/`reconnectNow` fields.

## Task Commits

Each task was committed atomically (RED+GREEN combined per commit, per this repo's `tdd.md` "commit at green only"):

1. **Task 1: useLiveStream — ping listener, elapsed-time interval, 3-state, force-reconnect** - `dc565b0` (feat)
2. **Task 2: LiveStatusBadge — 3-state + CONNECTING + force-reconnect (20-UI-SPEC)** - `193e622` (feat, bundled with the Rule-3 Overview.tsx/test.tsx compile fixes it depends on)

**Plan metadata:** `aca776c` (docs: log pre-existing out-of-scope apps/web type errors found during verification)

_Note: RED test run and GREEN implementation were verified via `bun run test` before each commit; both are folded into a single commit per this repo's `tdd.md` convention._

## Files Created/Modified
- `apps/web/src/hooks/useLiveStream.ts` - ping listener + elapsed-time interval + 3-state derivation + `reconnectNow`; drops the old 4-state machine and the inert `reconcile` listener
- `apps/web/src/hooks/useLiveStream.test.ts` - rewritten test-first: ping wiring, malformed-ping drop, interval-driven live/quiet/stalled derivation (fake timers installed before render), onerror-Pitfall-1, reconnectNow backoff-cancel + re-entrancy
- `apps/web/src/components/LiveStatusBadge.tsx` - 3-state `STATUS_CONFIG` with 20-UI-SPEC tokens, CONNECTING copy condition, force-reconnect button, last-known-good guard
- `apps/web/src/components/LiveStatusBadge.test.tsx` - new: all 3 states + CONNECTING condition + force-reconnect + last-known-good + Copywriting Contract tooltip copy (via `userEvent.hover` since base-ui Tooltip only mounts content when open)
- `apps/web/src/screens/Overview.tsx` - `LiveStatusBadge` call site wired to the hook's new fields; `PositionsTable`'s `isStale` check updated from `'stale'/'reconnecting'` to `'stalled'` (Rule 3 — compile-blocking type narrowing)
- `apps/web/src/screens/Overview.test.tsx` - `useLiveStream` mock + `setLiveStream` helper updated to the 3-state shape; POLL/STALE assertions renamed to QUIET/STALLED (Rule 3)

## Decisions Made
- Dropped the `reconcile` SSE listener entirely rather than keeping an empty-bodied handler that only validates and discards — under the new model it existed solely to set status directly, which Pitfall 1 explicitly forbids; removing it has the identical runtime effect (an unlistened named SSE event is simply ignored by `EventSource`) with less dead code.
- `STATUS_INTERVAL_MS = 2000ms`, chosen within the RESEARCH-recommended 1-5s band for a responsive-but-cheap re-evaluation cadence — independent of the server's 30s ping interval (Pitfall 5, confirmed no coupling was introduced).
- Exported `STALL_THRESHOLD_MS` from `useLiveStream.ts` and imported it into `LiveStatusBadge.tsx` rather than hardcoding "20" twice, keeping the tooltip's "20s" copy and the hook's actual threshold as a single source of truth.
- `LiveStatusBadge` holds last-known-good via a `useRef` + `KNOWN_STATUSES` set guard against an unrecognized status value — implemented per the plan's explicit acceptance criteria even though the TS union type makes this path unreachable through normal typed callers (tested via a `@ts-expect-error`-annotated re-render, not an `as` cast, per `typescript.md`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed `Overview.tsx`'s `isStale` check after the `LiveStreamStatus` type narrowing**
- **Found during:** Task 1, full `apps/web` typecheck after narrowing `LiveStreamStatus` to `live`/`quiet`/`stalled`
- **Issue:** `PositionsTable`'s `isStale = liveStatus === "stale" || liveStatus === "reconnecting"` compared against two literals that no longer exist in the type — a compile error, not a pre-existing one (directly caused by this plan's hook type change).
- **Fix:** Changed to `isStale = liveStatus === "stalled"` — STALLED now folds both "ticks frozen" and "transport dead" into one state (D-01), so this is the correct single replacement.
- **Files modified:** `apps/web/src/screens/Overview.tsx`
- **Verification:** `bun x tsc --noEmit -p apps/web/tsconfig.json` clean on this file; `bun run test -- apps/web/src/screens/Overview.test.tsx` green (35/35)
- **Committed in:** `193e622` (Task 2 commit — bundled since it's the same type-narrowing blast radius as the badge's prop wiring)

**2. [Rule 3 - Blocking] Updated `Overview.tsx`'s `LiveStatusBadge` call site + `Overview.test.tsx` mocks**
- **Found during:** Task 2, wiring the badge's new required props
- **Issue:** `LiveStatusBadge`'s `Props` gained `isRth`/`hasReceivedFirstTick`/`isReconnecting`/`onReconnect` — the existing call site and every `mockUseLiveStream.mockReturnValue`/`setLiveStream` fixture in `Overview.test.tsx` were missing these fields (compile errors) and asserted the retired `POLL`/`STALE` labels.
- **Fix:** Passed the hook's new destructured fields into the `LiveStatusBadge` JSX; updated the mock default, `afterEach` reset, `setLiveStream` helper (now `"live" | "quiet" | "stalled"`), and the two behavior tests' assertions/labels to `QUIET`/`STALLED`.
- **Files modified:** `apps/web/src/screens/Overview.tsx`, `apps/web/src/screens/Overview.test.tsx`
- **Verification:** `bun run test -- apps/web/src/screens/Overview.test.tsx` green (35/35); `bun x tsc --noEmit -p apps/web/tsconfig.json` shows zero errors in either file
- **Committed in:** `193e622` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking type-compile issues directly caused by this plan's `LiveStreamStatus`/`LiveStatusBadge` `Props` type changes)
**Impact on plan:** Both fixes were necessary consequences of the plan's own declared type changes (not scope creep) — no other files, features, or behaviors were touched.

## Issues Encountered
- **Fake-timers-vs-mount-time-`setInterval` pitfall (test infrastructure, not production code):** An earlier draft of `useLiveStream.test.ts` called `renderHook()` under real timers (using `waitFor` to observe the `FakeEventSource` instance), then switched to `vi.useFakeTimers()` mid-test to control the interval-driven status derivation. This silently failed — the shared `setInterval` is created synchronously during the mount effect, so if it's created while real timers are active, switching to fake timers afterward does NOT retroactively intercept it (fake timers only govern timers registered while they're installed); the interval kept ticking on the real wall clock in the background and the test's `vi.advanceTimersByTimeAsync()` calls had no effect on it. Fixed by installing `vi.useFakeTimers()` BEFORE `renderHook()` in every test that asserts on the derived `status`, and replacing `waitFor` (real-timer polling) with explicit microtask flushing (`await Promise.resolve()` x5) to drain `connect()`'s `await apiFetch(...)`/`await res.json()` chain — Promise microtasks resolve independently of which timer regime is active, so this works under either.
- **Full-repo `apps/web` `tsc --noEmit` surfaces 5 pre-existing errors** in files this plan never touches (`ErrorBoundary.tsx`/`.test.tsx`, `Button.tsx`'s own `buttonClass()` self-call, `useMacro.test.ts`, `JournalContainer.test.tsx`). Confirmed via `git status` that none of these files have pending changes and none reference `useLiveStream`/`LiveStatusBadge`/`Overview`. Logged to `deferred-items.md` per the Scope Boundary rule rather than fixed — also noted that the root `bun run typecheck` (`tsc --build --force`) does not include `apps/web` in its project references at all, so these were never caught by the project's own typecheck script.

## Threat Flags

None — all threats this plan addresses (T-20-02 ping-parse tampering, T-20-04 force-reconnect double-connect DoS, T-20-05 badge-shows-LIVE-while-stalled spoofing) are exactly the ones enumerated in the plan's own `<threat_model>`, and each has a corresponding passing unit test (see `coverage` D1/D4/D2-D3 above). No new network endpoints, auth paths, or trust-boundary-crossing surface was introduced beyond what the plan already registered.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WATCH-01 client-side wiring is complete and unit-tested end-to-end (ping → isRth, ticks → hasReceivedFirstTick/greeks, interval → 3-state status, onerror → backoff reconnect, reconnectNow → manual force-reconnect). This closes the Phase-12 "badge lies LIVE" debt.
- The one remaining WATCH-01 verification item is manual (D7 above): a chrome-devtools UAT pass against the live Overview UI (sever the stream during RTH → confirm the red STALLED alarm + working Reconnect-now), deferred to the phase's own UAT/ship cycle per the plan's `<output>` note ("ready for its own deploy + UAT cycle, D-18").
- No blockers for 20-04 (or SNAP-01/RULE-01, which are independent sub-items of this phase per 20-CONTEXT.md's scope boundary).

---
*Phase: 20-stream-watchdog-event-snapshot-strategy-rules*
*Completed: 2026-07-05*

## Self-Check: PASSED

All created/modified files verified present on disk; all task commit hashes
(`dc565b0`, `193e622`, `aca776c`) verified present in git log.
