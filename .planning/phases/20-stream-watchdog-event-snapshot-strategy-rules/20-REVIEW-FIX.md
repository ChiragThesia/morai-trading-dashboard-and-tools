---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
fixed_at: 2026-07-05T14:40:00Z
review_path: .planning/phases/20-stream-watchdog-event-snapshot-strategy-rules/20-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 20: Code Review Fix Report

**Fixed at:** 2026-07-05T14:40:00Z
**Source review:** .planning/phases/20-stream-watchdog-event-snapshot-strategy-rules/20-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (CR-01 + WR-01..WR-05)
- Fixed: 6
- Skipped: 0
- Info findings (IN-01, IN-02): out of scope (critical_warning), not touched.

**Verification (final, whole repo):**
- `bun run test` — **212 files / 2041 tests passed** (baseline 211 / 2028; +1 file, +13 tests).
- `bun run typecheck` — clean (exit 0).
- `bun run lint` — clean (exit 0).

CR-01, WR-02, and WR-04 were fixed as one root-cause cluster (an untested
composition-root blob that could throw a synchronous `RangeError` into the
sidecar tick loop and, with no reconnect, permanently kill the live stream).

## Fixed Issues

### CR-01: `observeSpot` can throw into the synchronous tick loop and permanently kill the live stream

**Files modified:** `packages/core/src/journal/application/observeSpot.ts` (new), `packages/core/src/journal/application/observeSpot.test.ts` (new), `packages/core/src/journal/index.ts`, `packages/core/src/index.ts`, `apps/server/src/adapters/http/sidecar-sse.ts`, `apps/server/src/adapters/http/sidecar-sse.test.ts`
**Commits:** `386d777` (core guard + tests), `dab28ea` (sidecar call-site guard)
**Applied fix:** Root cause was an unvalidated timestamp reaching `isWithinRth`/`isNyseHoliday`, whose `Intl.DateTimeFormat.formatToParts` throws `RangeError` on an Invalid Date. The orchestration now lives in `makeSpotObserver`, which (1) rejects an unparseable `tsIso` with `Number.isNaN(Date.parse(...))` BEFORE the RTH gate, and (2) is a fully-wrapped `async` function that can neither throw nor reject into the caller. Defense-in-depth: the `deps.observeSpot?.(...)` call site in `sidecar-sse.ts` is now wrapped in try/catch (logs name only). Regression test drives the bad-timestamp path (no throw, no read/enqueue) plus a throwing-observeSpot test proving the stream still processes the frame.

### WR-01: Badge shows "QUIET / Market closed" during RTH for up to 30s while live ticks stream

**Files modified:** `apps/server/src/adapters/http/stream.routes.ts`, `apps/server/src/adapters/http/stream.routes.test.ts`
**Commit:** `7078537`
**Applied fix:** Emit one `ping` carrying the correct `isRth` immediately after the `reconcile` event — before the 30s keep-alive loop — in BOTH `streamRoutes` and `makeStreamSseRouter` (the hand-synced duplicates). The client now has server-authoritative `isRth` at connect instead of `null` for ~30s. Regression test reads the ping WITHOUT advancing fake timers and asserts `isRth === true` under an open-market clock.

### WR-02: `void connectToSidecarStream(...)` has no catch/reconnect

**Files modified:** `apps/server/src/adapters/http/sidecar-sse.ts`, `apps/server/src/adapters/http/sidecar-sse.test.ts`, `apps/server/src/main.ts`
**Commits:** `dab28ea` (reconnect loop + tests), `4f1863b` (main.ts wiring)
**Applied fix:** Added `runSidecarStreamWithReconnect` — a testable self-healing backoff loop around `connectToSidecarStream` (injectable `sleep`/`shouldContinue`/`onError`). A disconnect / non-200 / network error now reconnects after a backoff instead of leaving an unhandled rejection that ends the stream. `main.ts` fires this instead of the bare `void connectToSidecarStream(...)`, and the stale "reconnect handled inside connectToSidecarStream" comment was corrected. Regression tests cover both the failed-connect and clean-close reconnect paths.

### WR-04: Untested business logic embedded in the composition root

**Files modified:** `apps/server/src/main.ts` (plus the `makeSpotObserver` extraction from CR-01)
**Commit:** `4f1863b`
**Applied fix:** The `onSpotObserved` decision pipeline (parse → RTH/holiday gate → detectLargeMove → mutable window → cross-process cooldown → conditional enqueue) was extracted into `@morai/core`'s `makeSpotObserver` and is now unit-tested across 8 branches (bad-timestamp, off-hours, holiday, sub-threshold, enqueue-outside-cooldown, cooldown-suppressed, cooldown-read-error fail-safe, enqueue-throws). `main.ts` returns to pure composition — it only wires the DB cooldown read and the `jobBoss.send` enqueue side effect onto the observer.

### WR-05: `reconnectNow` can race an in-flight backoff reconnect and open a second EventSource

**Files modified:** `apps/web/src/hooks/useLiveStream.ts`, `apps/web/src/hooks/useLiveStream.test.ts`
**Commit:** `30647e6`
**Applied fix:** Added a `connectInFlightRef` guard held from the top of `connect()` through EventSource setup (cleared in a `finally`), shared by both the `scheduleReconnect` timer path and `reconnectNow`. A manual reconnect fired while a timer's `connect()` is mid-ticket-mint is now a no-op instead of opening a second concurrent EventSource that leaks the first. The regression test was proven red without the guard (1 failed) and green with it.

### WR-03: `contracts → core` boundary is wider than the documented "values-only" carve-out

**Files modified:** `packages/core/package.json`, `eslint.config.js`, `packages/contracts/src/journal-rules.ts`, `packages/adapters/vitest.config.ts`, `apps/server/vitest.config.ts`, `apps/worker/vitest.config.ts`, `apps/web/vitest.config.ts`
**Commit:** `2905c65`
**Applied fix:** Made the D-07 carve-out mechanical rather than comment-enforced. Added a `@morai/core/rule-tags` subpath export; gave the rule-tags value module its own ESLint `boundaries` element (`core-rule-tags`) declared before the generic `core` element; narrowed the `contracts` allow-list to `["shared","contracts","core-rule-tags"]`; and repointed the contracts import to the subpath. Verified negatively: an illicit `import { makeSetRuleTagsUseCase } from "@morai/core"` in contracts now fails lint ("no rule allowing dependencies from contracts to core"). Because the vitest configs alias the bare `@morai/core` to `src/index.ts` (a prefix rewrite that would produce `src/index.ts/rule-tags`), a more-specific `@morai/core/rule-tags` alias was added ahead of it in the four configs that alias core, so test-time resolution honors the subpath. `contracts`-package tests resolve natively via the new `exports` map.

---

_Fixed: 2026-07-05T14:40:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
