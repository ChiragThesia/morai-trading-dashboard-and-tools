---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
verified: 2026-07-05T14:55:55Z
status: human_needed
score: 16/16 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "WATCH-01 — observe the live badge in a real browser session during RTH: confirm it shows LIVE while ticks stream, flips to CONNECTING (quiet styling) on cold connect for up to ~20s, and flips to STALLED (red, with 'Reconnect now' action) if ticks are frozen for >=20s while the transport is still up or dead."
    expected: "Badge never shows LIVE while ticks are actually stalled; STALLED reads as a genuine red alarm, not benign gray; 'Reconnect now' mints a fresh ticket and clears the stall without a double-connect."
    why_human: "Requires a real SSE connection against deployed server/sidecar during RTH, and/or deliberately freezing ticks — cannot be produced by static analysis or the unit/integration suite, which uses fake timers and injected deps."
  - test: "WATCH-01 — observe the badge outside RTH (evening/weekend) and confirm it shows QUIET, not STALLED, even though no ticks are arriving."
    expected: "QUIET (benign gray), no alarm styling, tooltip reads 'Market closed — outside regular trading hours.'"
    why_human: "Depends on wall-clock RTH state and a live server heartbeat; not exercisable in the unit suite."
  - test: "SNAP-01 — inject or wait for a real >=1% SPX move within a ~5min rolling window during RTH and confirm exactly one supplemental snapshot fires (trigger='event-move' in the DB row), a second move within the ~15min cooldown does NOT fire another snapshot, and no snapshot fires for the same move pattern outside RTH."
    expected: "One `calendar_snapshots` row with trigger='event-move' per qualifying move; cooldown suppresses a second row within ~15min; zero rows off-hours even if the price swing pattern would otherwise qualify."
    why_human: "Requires a live SPX tick stream and either a real large move or an injected one against the deployed sidecar/server — the unit tests validate the pipeline's branches with synthetic inputs/mocked cooldown reads, not a live end-to-end fire against Postgres."
---

# Phase 20: Stream Watchdog, Event Snapshot & Strategy Rules Verification Report

**Phase Goal:** Three independently shippable reliability/journaling gaps close out v1.2 —
ordered cheapest/most-isolated first per research (WATCH-01 stream badge, SNAP-01 event
snapshot, RULE-01 strategy-rule recording).
**Verified:** 2026-07-05T14:55:55Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | WATCH-01: pure 3-state derivation (LIVE/QUIET/STALLED + cold-start CONNECTING) exists and is correctly ordered | ✓ VERIFIED | `apps/web/src/lib/deriveStreamStatus.ts` — locked branch order (isRth===false→quiet, isRth===null→connecting, elapsed<threshold→live/connecting, else stalled); `deriveStreamStatus.test.ts` exercises all branches; passes in full suite |
| 2 | WATCH-01: server emits RTH truth on the heartbeat, client is authoritative-from-server | ✓ VERIFIED | `apps/server/src/adapters/http/stream.routes.ts` `handleStreamSse` — single shared handler (post-WR-01-dup fix) sends a `ping` with `isRth` immediately after `reconcile`, then every 30s; `stream.routes.test.ts` asserts `isRth===true` without advancing fake timers |
| 3 | WATCH-01: client wires ping + elapsed-time timer into the 3-state model, never sets status from `onerror`/`onopen` directly | ✓ VERIFIED | `apps/web/src/hooks/useLiveStream.ts` — `es.addEventListener("ping", ...)` updates `isRthRef`/`isRth`; a single `setInterval` re-evaluates `deriveStreamStatus` every 2s against `lastTickOrConnectAtRef`; `onerror`/`onopen` only manage transport lifecycle (Pitfall 1 documented and tested: `"es.onerror does not set status directly..."`) |
| 4 | WATCH-01: badge renders 3 states + honest STALLED alarm + manual force-reconnect (D-17) | ✓ VERIFIED | `apps/web/src/components/LiveStatusBadge.tsx` — `STATUS_CONFIG` maps live/quiet/stalled to distinct tokens (down/red ring for stalled per D-20), CONNECTING derived as copy-only condition; "Reconnect now" button wired to `onReconnect` only when `effectiveStatus==="stalled"`; `LiveStatusBadge.test.tsx` in review file list |
| 5 | WATCH-01: manual reconnect cannot race a timer-driven reconnect into a double EventSource (WR-05) | ✓ VERIFIED | `connectInFlightRef` guard shared by `scheduleReconnect`'s `connect()` and `reconnectNow` in `useLiveStream.ts`; named regression test `"reconnectNow does not open a 2nd EventSource while a timer-driven connect is mid-mint (WR-05)"` passes standalone (`bunx vitest -t "WR-05"` → 1 passed) |
| 6 | WATCH-01 live visual behavior (LIVE→QUIET→STALLED transition against a real stream) | ⚠️ deferred to human | See Human Verification #1/#2 — inherently live/deploy-gated per phase brief |
| 7 | SNAP-01: rolling-window absolute-%-move detector + cooldown gate exist as pure domain logic | ✓ VERIFIED | `packages/core/src/journal/domain/snapshot-cooldown.ts` (`isWithinCooldown`) + `detectLargeMove` (imported from `../../streaming/index.ts`) — both covered by dedicated unit tests |
| 8 | SNAP-01: snapshot row carries trigger provenance ('scheduled' vs 'event-move'), additive/nullable | ✓ VERIFIED | Migration `packages/adapters/src/postgres/migrations/0016_snapshot_trigger.sql` — nullable `trigger` text column, no backfill; `schema.ts:107` `trigger: text("trigger")`; worker handler defaults absent/invalid to `"scheduled"` (D-12) |
| 9 | SNAP-01: tick→RTH/holiday-gate→detect→cross-process-cooldown→enqueue pipeline is wired and cannot throw into the sidecar tick loop | ✓ VERIFIED | `packages/core/src/journal/application/observeSpot.ts` (`makeSpotObserver`) — Invalid-Date guard BEFORE the RTH gate (fixes CR-01), full try/catch, `async`/never-throws contract; wired in `apps/server/src/main.ts` (`spotObserver.observe`) and defense-in-depth try/catch at the `sidecar-sse.ts` call site; named test `"skips an unparseable timestamp without throwing and never reads/enqueues (CR-01)"` passes standalone |
| 10 | SNAP-01: off-hours no-op, sub-threshold no-op, cooldown suppression, fail-safe on cooldown-read error | ✓ VERIFIED | `observeSpot.test.ts` — 8 named branch tests (off-hours, holiday, sub-threshold, enqueue-outside-cooldown, cooldown-suppressed, cooldown-read-error fail-safe, enqueue-throws, bad-timestamp) all pass in the full 2042-test run |
| 11 | SNAP-01 live behavior (a real/injected large move fires exactly one snapshot; cooldown suppresses a second; off-hours no-op against live Postgres) | ⚠️ deferred to human | See Human Verification #3 — inherently live/deploy-gated per phase brief |
| 12 | RULE-01: closed, event-keyed enums (ENTER/EXIT/ROLL) — recording only, no evaluation/condition logic | ✓ VERIFIED | `packages/core/src/journal/domain/rule-tags.ts` — three Zod enums + exhaustive `ruleTagEnumForEventType` switch (OPEN→enter, CLOSE→exit, ROLL→roll); file-level comment states "Recording-only — NO evaluation/condition logic"; grep for `condition`/`evaluat` across rule-tags.ts, setRuleTags.ts, getCalendarEventsWithRules.ts returns only boundary-documentation comments, zero logic |
| 13 | RULE-01: annotations live in a separate, no-FK table keyed by `fillIdsHash`, survives `rebuildJournal`'s delete-then-reinsert (D-09) | ✓ VERIFIED | Migration `0017_calendar_event_annotations.sql` — `varchar(64) PRIMARY KEY` on `fill_ids_hash`, deliberately no FK; dedicated regression test `rebuildJournal.test.ts::"RULE-01/D-09: a fillIdsHash annotation survives a full delete-then-reinsert rebuild cycle unchanged"` exists and passes in the full suite |
| 14 | RULE-01: read/write use-cases + HTTP routes + MCP tools ship together (D-13), list-shaped multi-tag writes (D-14), OTHER requires a note (D-21) | ✓ VERIFIED | `getCalendarEventsWithRules.ts` / `setRuleTags.ts` (core use-cases) → `journal-rules.routes.ts` (GET/PUT, thin adapter, JWT-gated) → `get_rule_tags`/`set_rule_tags` MCP tools in `apps/server/src/adapters/mcp/tools.ts` reusing the SAME `setRuleTagsRequest`/`getEventsWithRulesResponse` contracts; `journal-rules.ts` contract has `tags: z.array(ruleTag).max(5)` (list-shaped) and an OTHER-requires-note refine |
| 15 | RULE-01: Journal UI capture control (ENTER/EXIT/ROLL toggle chips + OTHER note, editable anytime) + read-view pill | ✓ VERIFIED | `apps/web/src/screens/Journal.tsx` imports `enterRuleTag`/`exitRuleTag`/`rollRuleTag` from `@morai/core`, renders `RuleTagChips` per event type wired to `useRuleTags`'s `saveRuleTags`/`retryRuleTags`, plus a `data-testid="rule-tags-pill"` read-view element |
| 16 | RULE-01: `contracts→core` boundary for the rule-tag enums is mechanically scoped, not comment-enforced (WR-03) | ✓ VERIFIED | `eslint.config.js` — dedicated `core-rule-tags` boundary element scoped to `rule-tags.ts` only, declared before the generic `core` element; `contracts` allow-list is `["shared","contracts","core-rule-tags"]` (no longer the full `core` barrel); `packages/core/package.json` exports `./rule-tags` subpath |

**Score:** 16/16 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/lib/deriveStreamStatus.ts` | Pure 3-state derivation fn | ✓ VERIFIED | Exists, substantive, unit-tested, imported by `useLiveStream.ts` |
| `apps/web/src/hooks/useLiveStream.ts` | Ping/timer wiring, 3-state public status | ✓ VERIFIED | Exists, substantive, wired into `deriveStreamStatus`, consumed by `LiveStatusBadge` via props |
| `apps/web/src/components/LiveStatusBadge.tsx` | Presentational badge, 3 states + STALLED action | ✓ VERIFIED | Exists, substantive, wired (imports `LiveStreamStatus`/`STALL_THRESHOLD_MS` from the hook) |
| `apps/server/src/adapters/http/stream.routes.ts` | Server-emitted `isRth` on heartbeat | ✓ VERIFIED | Single shared `handleStreamSse` (WR-01-dup fix removed the hand-synced duplicate) |
| `packages/core/src/journal/domain/snapshot-cooldown.ts` | Cooldown predicate | ✓ VERIFIED | `isWithinCooldown` + `SNAPSHOT_COOLDOWN_MS`, unit-tested |
| `packages/core/src/journal/application/observeSpot.ts` | detect→cooldown→enqueue orchestration | ✓ VERIFIED | `makeSpotObserver`, 8-branch tested, wired into `main.ts` |
| `packages/adapters/src/postgres/migrations/0016_snapshot_trigger.sql` | Nullable trigger column | ✓ VERIFIED | Present, additive, matches `schema.ts` |
| `apps/worker/src/handlers/snapshot-calendars.ts` | Trigger payload parsing | ✓ VERIFIED | Parses optional `trigger`, defaults to `"scheduled"` |
| `packages/core/src/journal/domain/rule-tags.ts` | Event-keyed closed enums | ✓ VERIFIED | 3 Zod enums + exhaustive resolver, exported via `@morai/core/rule-tags` subpath |
| `packages/adapters/src/postgres/migrations/0017_calendar_event_annotations.sql` | Orthogonal no-FK annotations table | ✓ VERIFIED | `varchar(64) PRIMARY KEY`, no FK, RLS enabled |
| `packages/core/src/journal/application/getCalendarEventsWithRules.ts` / `setRuleTags.ts` | Read/write use-cases | ✓ VERIFIED | Present, substantive, wired into routes + MCP tools |
| `apps/server/src/adapters/http/journal-rules.routes.ts` | GET/PUT rule-tag routes | ✓ VERIFIED | Thin adapter (zod-parse → use-case → map Result → respond), JWT-gated in `main.ts` |
| `apps/server/src/adapters/mcp/tools.ts` (get_rule_tags/set_rule_tags) | MCP tool parity | ✓ VERIFIED | Reuses the SAME contract schemas as the HTTP routes |
| `apps/web/src/screens/Journal.tsx` + `useRuleTags.ts` | Capture UI | ✓ VERIFIED | ENTER/EXIT/ROLL chip rows wired to `saveRuleTags`/`retryRuleTags`; read-view pill present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `apps/server/src/adapters/http/sidecar-sse.ts` (dispatchFrame) | `packages/core` `makeSpotObserver` | `deps.observeSpot?.(...)` call, wrapped in try/catch | WIRED | Sidecar tick dispatch calls the injected `observeSpot` deps hook; call site guarded so a future throwing callback still cannot kill the stream |
| `apps/server/src/main.ts` | `runSidecarStreamWithReconnect` | composition-root wiring | WIRED | Replaces the previously-uncaught `void connectToSidecarStream(...)` (WR-02 fix); self-healing backoff loop |
| `apps/web/src/hooks/useLiveStream.ts` | `apps/web/src/lib/deriveStreamStatus.ts` | direct import + `setInterval` re-evaluation | WIRED | Confirmed via source read — the *only* place `status` is set |
| `apps/web/src/screens/Journal.tsx` | `apps/web/src/hooks/useRuleTags.ts` | `saveRuleTags`/`retryRuleTags` destructured and called from chip `onChange`/`onRetry` | WIRED | Confirmed via source read |
| `apps/server/src/adapters/http/journal-rules.routes.ts` | `packages/core` use-cases | constructor params `getEventsWithRules`, `setRuleTags` | WIRED | Wired at `main.ts:273` (`journalRulesRoutes(calendarsRepo.getCalendarById, getEventsWithRules, setRuleTags)`) |
| `packages/contracts/src/journal-rules.ts` | `packages/core/src/journal/domain/rule-tags.ts` | `@morai/core/rule-tags` subpath import | WIRED | Enums single-sourced; mechanically enforced via ESLint `core-rule-tags` boundary element |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full workspace suite is green | `bun run test` (run once) | 212 test files / 2042 tests passed | ✓ PASS |
| Typecheck clean | `bun run typecheck` | exit 0, no errors | ✓ PASS |
| Lint clean | `bun run lint` | exit 0 (only pre-existing plugin-config warning, no rule violations) | ✓ PASS |
| CR-01 bad-timestamp guard (named test) | `bunx vitest run packages/core/src/journal/application/observeSpot.test.ts -t "CR-01"` | 1 passed | ✓ PASS |
| WR-05 double-connect guard (named test) | `bunx vitest run apps/web/src/hooks/useLiveStream.test.ts -t "WR-05"` | 1 passed | ✓ PASS |
| No unresolved debt markers in phase-touched files | grep for TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER across 19 phase-touched core files | zero matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| WATCH-01 | 20-01, 20-02, 20-03 | 3-state RTH-aware stream badge, transport heartbeat decoupled from data cadence | ✓ SATISFIED (mechanism); live-transition observation → human_needed | Truths 1-5, 6 |
| SNAP-01 | 20-04, 20-05, 20-06 | Event-triggered supplemental snapshot, cooldown-gated, provenance-tagged | ✓ SATISFIED (mechanism); live-fire observation → human_needed | Truths 7-10, 11 |
| RULE-01 | 20-07, 20-08, 20-09, 20-10, 20-11 | Thin recording layer for enter/exit/roll rules, not a DSL | ✓ SATISFIED | Truths 12-16 |

No orphaned requirements found — WATCH-01/SNAP-01/RULE-01 are the only IDs mapped to Phase 20 in REQUIREMENTS.md and all three are claimed and covered by the 11 plans.

### Anti-Patterns Found

None. Scanned all 19 phase-touched core/adapter/route files for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon" — zero matches. No stub returns, no hardcoded-empty renders, no console.log-only handlers found in the files read.

The code review (`20-REVIEW.md`) found 1 critical + 5 warnings + 2 info; the fix pass (`20-REVIEW-FIX.md`) resolved all 6 in-scope findings (critical + 5 warnings), verified against a full green re-run (212/2041 at fix time; now 212/2042 — consistent with the +1 file/+13 tests the fix report claims). IN-01 and IN-02 (info-level) were explicitly left unaddressed as out of scope — neither blocks the phase goal (IN-01 is dead defensive code, IN-02 is a minor data-quality nit on duplicate tags, not incorrect behavior).

### Human Verification Required

1. **WATCH-01 — live badge transition during RTH**
   **Test:** Open the app during regular trading hours against the deployed server/sidecar; observe the badge on connect, then simulate/wait for a tick stall (or disconnect the sidecar) for >=20s.
   **Expected:** Badge shows CONNECTING (quiet styling, no red) briefly on cold connect, then LIVE once ticks arrive; if ticks stop for >=20s while RTH is true, badge flips to STALLED (red, alarm styling) with a working "Reconnect now" action that does not double-connect.
   **Why human:** Requires a live SSE connection during market hours and/or deliberately induced staleness — not reproducible by the fake-timer unit suite.

2. **WATCH-01 — QUIET outside RTH**
   **Test:** Open the app outside trading hours (evening/weekend) against the deployed server.
   **Expected:** Badge shows QUIET (benign gray), never STALLED, with tooltip "Market closed — outside regular trading hours."
   **Why human:** Depends on live wall-clock RTH state from the deployed server's heartbeat.

3. **SNAP-01 — live event-triggered snapshot fires exactly once, cooldown suppresses a second, off-hours no-op**
   **Test:** During RTH, either wait for a real >=1% SPX move within ~5min, or inject one via a controlled test tick against staging; verify exactly one `calendar_snapshots` row appears with `trigger='event-move'`; confirm a second qualifying move within ~15min does not produce a second row; confirm the same detector logic produces zero rows if replayed off-hours.
   **Expected:** Exactly one event-move row per qualifying move, cooldown-suppressed duplicates, and zero off-hours firings.
   **Why human:** Requires a live tick stream hitting the deployed server's `observeSpot` wiring and a real Postgres cooldown read across the worker/server process boundary — the unit suite validates each branch with synthetic/mocked inputs, not an end-to-end live fire.

### Gaps Summary

No gaps. All 16 derived truths across WATCH-01/SNAP-01/RULE-01 are backed by existing, substantive, wired, and tested code — including the 6 code-review findings from `20-REVIEW.md`, all resolved and re-verified in `20-REVIEW-FIX.md` against a green 212-file/2042-test full suite, clean typecheck, and clean lint (independently re-run and confirmed during this verification, not merely trusted from the SUMMARY). The RULE-01 "recording layer, not a DSL" boundary was explicitly checked (grep for evaluation/condition logic) and holds — no rule-firing/evaluation logic was introduced.

The three residual items are inherently live/deploy-gated (a real SSE stream's visible state transitions, and a real/injected large SPX move firing against a live Postgres instance across process boundaries) and cannot be verified by static analysis or the existing test suite, consistent with how Phase 17's live items were handled. These route to human verification, not to gaps — the underlying mechanisms are present, correct, and covered by passing unit/integration tests exercising every branch (including the specific bad-timestamp, cooldown-suppression, and off-hours-skip paths).

---

_Verified: 2026-07-05T14:55:55Z_
_Verifier: Claude (gsd-verifier)_
