---
phase: 12-streaming-ts-fan-out
plan: "06"
subsystem: web-ui
tags: [streaming, sse, react, live-greeks, tdd]
status: complete

dependency_graph:
  requires: ["12-01", "12-05"]
  provides: [useLiveStream, LiveStatusBadge, AdHocPicker, PositionsLiveOverlay]
  affects: [apps/web/src/screens/Positions.tsx]

tech_stack:
  added: []
  patterns:
    - EventSource ticket-auth (mint via apiFetch POST → connect with ?ticket=)
    - Zod parse-don't-cast on every SSE frame (drop malformed, never cast)
    - D-04 state machine (poll→live→stale→reconnecting→live)
    - React key trick for CSS animation re-trigger (key={tick.ts})
    - .live-cell/.live-cell.stale color dim (NOT opacity) for stale UX
    - FakeEventSource vitest pattern (vi.stubGlobal EventSource)

key_files:
  created:
    - apps/web/src/hooks/useLiveStream.ts
    - apps/web/src/hooks/useLiveStream.test.ts
    - apps/web/src/components/LiveStatusBadge.tsx
  modified:
    - apps/web/src/index.css
    - apps/web/src/screens/Positions.tsx
    - apps/web/src/screens/Positions.test.tsx

decisions:
  - "FakeEventSource class with static instances[] + vi.stubGlobal (jsdom has no EventSource)"
  - "subscribeAdHoc is plain async arrow (no useCallback) — closes over nothing stateful"
  - "hasEverDisconnectedRef (useRef not useState) distinguishes initial onopen from reconnect onopen"
  - "adHocSymbol lives in Positions component (lifted state); AdHocPicker is controlled"
  - "React key trick on tick.ts triggers .live-cell-flash re-animation without useRef toggling"
  - "No new shadcn installs — Badge/Input/Button/Tooltip/Separator all pre-installed"

metrics:
  duration: "~2h"
  completed: "2026-06-28"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 6
---

# Phase 12 Plan 06: Web Live-Streaming UI Summary

One-liner: SSE live-greeks hook with ticket-auth, 4-state D-04 machine, Zod-parse every frame, 4-state connection badge, stale color-dim, and OCC ad-hoc picker — all on Positions screen only (D-06).

## Tasks

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | useLiveStream hook + failing tests (TDD) | 5673cd5 | Complete |
| 2 | LiveStatusBadge + index.css animations | b45d157 | Complete |
| 3 | Positions.tsx live overlay + AdHocPicker | 2ff08cd | Complete |

## What Was Built

### Task 1 — useLiveStream hook (TDD red→green)

`apps/web/src/hooks/useLiveStream.ts` implements:

- **Ticket mint**: `apiFetch POST /api/stream/ticket` (Supabase-authed) → Zod-parse `streamTicketResponse` → `new EventSource(/api/stream?ticket=<ticket>)`.
- **D-04 state machine**: `poll` (initial) → `live` (first tick) → `stale` (onerror) → `reconnecting` (onopen after disconnect, tracked via `hasEverDisconnectedRef`) → `live` (reconcile event).
- **Frame parsing**: every `onmessage` JSON-parsed then tried against `streamLiveGreekEvent.safeParse` then `streamReconcileEvent.safeParse`; neither match = silent drop (T-12-06-01).
- **subscribeAdHoc**: `apiFetch POST /api/stream/subscribe` — real network POST, no second EventSource opened (SC6). Throws `StreamSubscribeError` on non-2xx.
- **Teardown**: `cancelled` flag + `esRef.current.close()` on unmount.

Test suite: 11 tests, FakeEventSource with `dispatchMessage/Error/Open` helpers, `vi.stubGlobal("EventSource", FakeEventSource)`.

### Task 2 — LiveStatusBadge + CSS animations

`apps/web/src/components/LiveStatusBadge.tsx`: pure presentational, 4 states per UI-SPEC Surface 3:
- LIVE: `#26a69a` text + `.live-dot` pulse animation (6px teal, 2s infinite)
- STALE: `#f0b429` amber on `#161d2b` raise background
- RECONNECTING: `#7b8696` muted on raise background
- POLL: `#566273` dim, transparent background

Tooltip: `"Last update: HH:mm:ss"` / `"…(stream lost)"` / `"No data received yet."`

`apps/web/src/index.css` additions:
- `@keyframes cell-flash` (violetd → transparent, 300ms ease-out) + `.live-cell-flash`
- `.live-cell` (color transition 500ms) + `.live-cell.stale` (color: --color-dim)
- `@keyframes live-dot-pulse` (scale 1.0→1.4→1.0, 2s) + `.live-dot`

### Task 3 — Positions live overlay + AdHocPicker

`apps/web/src/screens/Positions.tsx` extensions:

- `useLiveStream()` called in `Positions` component (D-06 — this screen only; not wired to journal or GEX).
- `adHocSymbol: string | null` state managed in `Positions`, passed down to `AdHocPicker`.
- `PositionCard` receives `liveGreeks`, `liveStatus`, `liveLastTickAt` props:
  - Live BSM values overlay per-leg table cells (Δ, Γ, Θ, Vega, IV, Mark) with `key={tickKey}` → `.live-cell-flash` re-triggers each tick.
  - Mark + Unreal KPIs also get live overlay + flash keys.
  - `.live-cell.stale` applied to live-sourced cells when `status === "stale" | "reconnecting"` (color dim, NOT CSS opacity — SC2 / a11y constraint).
  - Position heading badge replaced with `<LiveStatusBadge status={liveStatus} lastTickAt={liveLastTickAt} />` (Surface 3).
  - Polling values remain as fallback when no tick exists for the symbol.
- `AdHocPicker` component (Surface 4):
  - `parseOccSymbol(trimmed)` client-side OCC validation on submit — inline error copy, no POST on invalid.
  - On valid: `await subscribeAdHoc(sym)` (POST /api/stream/subscribe — not a no-op, SC6) → `onSetAdHocSymbol(sym)`.
  - AD HOC row: shows `legLabel`, DTE, live BSM values from `liveGreeks.get(adHocSymbol)` once ticks arrive (key trick for flash); waiting copy until first tick.
  - "AD HOC" badge distinguishes from owned positions (Surface 4).
  - × clears via `onClearAdHoc` → `setAdHocSymbol(null)`.
  - Single active symbol (one subscribe at a time).
- `Separator` placed between PositionsList and AdHocPicker in the Open card.
- `Positions.test.tsx`: `vi.mock("../hooks/useLiveStream.ts")` added; all 143 web tests pass.

## SC6 Confirmation

`subscribeAdHoc` in `useLiveStream.ts`:
```typescript
const res = await apiFetch("/api/stream/subscribe", {
  method: "POST",
  body: JSON.stringify({ symbol }),
});
if (!res.ok) throw new StreamSubscribeError(res.status);
```
Test 9 asserts: `mockApiFetch` called with `"/api/stream/subscribe"` + `{ method: "POST", body: JSON.stringify({ symbol }) }`. Test 10 asserts: still exactly 1 EventSource instance after subscribeAdHoc. Both pass.

`AdHocPicker` calls `await subscribeAdHoc(trimmed)` on valid OCC submit. The AD HOC row reads from `liveGreeks.get(adHocSymbol)` — ticks arrive over the existing EventSource once the server activates the subscription.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod UUID validation failure in test fixture**
- **Found during:** Task 1 RED phase
- **Issue:** Test `TICKET = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"` — Zod v4 validates UUID version/variant bits; "cccc" (starts 'c') fails fourth-segment variant check.
- **Fix:** Changed to RFC-4122 compliant UUIDv4: `TICKET = "550e8400-e29b-41d4-a716-446655440000"`
- **Files modified:** `apps/web/src/hooks/useLiveStream.test.ts`

**2. [Rule 1 - Bug] Lint: `as` type assertion in test error narrowing**
- **Found during:** Task 1 GREEN phase
- **Issue:** `(caughtError as Error).name` violated `@typescript-eslint/consistent-type-assertions`.
- **Fix:** `instanceof` narrowing: `if (!(caughtError instanceof Error)) throw new Error(...); expect(caughtError.name)...`
- **Files modified:** `apps/web/src/hooks/useLiveStream.test.ts`

### TDD Gate Compliance

RED and GREEN commits were combined in `5673cd5` due to test fixture bugs discovered after stub was written. The functional state is correct (11 tests GREEN, full implementation committed). The gate ran in spirit if not in distinct commit order.

## Known Stubs

None. All live-greeks paths fall back to static polling values (not hardcoded) when no tick exists.

## Threat Flags

No new network endpoints introduced. `AdHocPicker` calls existing `subscribeAdHoc` (already threat-modeled as T-12-06-02 in plan). No new auth paths or file access patterns.

## Self-Check

- [x] `apps/web/src/hooks/useLiveStream.ts` — FOUND
- [x] `apps/web/src/hooks/useLiveStream.test.ts` — FOUND
- [x] `apps/web/src/components/LiveStatusBadge.tsx` — FOUND
- [x] `apps/web/src/screens/Positions.tsx` — FOUND
- [x] `apps/web/src/index.css` — FOUND (animations block added)
- [x] Commits 5673cd5, b45d157, 2ff08cd — all present
- [x] 143 web tests pass (`bun run test --project web`)
- [x] `bun run typecheck` — clean
- [x] `bun run lint` — clean (boundary warnings pre-existing)

## Self-Check: PASSED
