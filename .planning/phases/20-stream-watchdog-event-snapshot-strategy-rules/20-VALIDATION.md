---
phase: 20
slug: stream-watchdog-event-snapshot-strategy-rules
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-05
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Test map derived from `20-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (`^4.1.8`) + fast-check 4 (`^4.8.0`) + testcontainers, per-package `test.projects` |
| **Config file** | `vitest.config.ts` (root, workspace-style `projects` glob) |
| **Quick run command** | `bun run test -- <path/to/file>.test.ts` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~full workspace suite (existing ~386+ tests) |

---

## Sampling Rate

- **After every task commit:** Run `bun run test -- <changed file>.test.ts`
- **After every plan wave:** Run `bun run test` (full workspace)
- **Before `/gsd-verify-work`:** Full suite green + `bun run typecheck && bun run lint`
- **Max feedback latency:** per-file run (seconds)

---

## Per-Task Verification Map

*Filled after planning (task IDs assigned by the planner). Seed rows below map each requirement to its target test file from RESEARCH.md § Phase Requirements → Test Map.*

| Req | Behavior | Test Type | Automated Command | File Exists |
|-----|----------|-----------|-------------------|-------------|
| WATCH-01 | `deriveStreamStatus` returns `quiet` when `isRth===false`, regardless of tick recency | unit + fast-check | `bun run test -- apps/web/src/lib/deriveStreamStatus.test.ts` | ❌ W0 |
| WATCH-01 | Status flips `stalled` exactly at/after threshold, never before (monotonic in elapsed) | fast-check | same file | ❌ W0 |
| WATCH-01 | Ping payload round-trips `streamPingEvent` Zod; malformed dropped (holds last-known-good) | unit | `bun run test -- packages/contracts/src/stream-events.test.ts` | ❌ W0 |
| SNAP-01 | `detectLargeMove` triggers at threshold boundary; prunes samples outside window | fast-check | `bun run test -- packages/core/src/streaming/domain/spot-move-detector.test.ts` | ❌ W0 |
| SNAP-01 | `isWithinCooldown` boundary: `==cooldownMs` NOT within, `<cooldownMs` IS | unit + fast-check | `bun run test -- packages/core/src/journal/domain/snapshot-cooldown.test.ts` | ❌ W0 |
| SNAP-01 | Postgres `MAX(time)` returns `null` on cold start, never throws | testcontainers | `bun run test -- packages/adapters/src/postgres/repos/calendar-snapshots.test.ts` | ❌ W0 |
| RULE-01 | annotations write/read round-trips via Postgres repo AND memory twin (contract parity) | testcontainers + memory | `bun run test -- packages/adapters/src/__contract__/calendar-event-annotations.contract.ts` | ❌ W0 |
| RULE-01 | `other` without note rejected at Zod boundary; listed enum without note accepted (D-21) | unit | `bun run test -- packages/core/src/journal/domain/rule-tags.test.ts` | ❌ W0 |
| RULE-01 | `rebuildJournal` never deletes `calendar_event_annotations` rows (D-09 regression guard) | integration | `bun run test -- packages/core/src/journal/application/rebuildJournal.test.ts` | ❌ W0 (extend) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/web/src/lib/deriveStreamStatus.test.ts` — extract pure `deriveStreamStatus` first (Pattern 1), then fast-check properties (quiet-dominates, stall-monotonic)
- [ ] `packages/contracts/src/stream-events.test.ts` — `streamPingEvent` round-trip (create if absent)
- [ ] `packages/core/src/streaming/domain/spot-move-detector.test.ts` — window-pruning + threshold-boundary + monotonicity properties
- [ ] `packages/core/src/journal/domain/snapshot-cooldown.test.ts` — boundary unit + monotonic-in-elapsed property
- [ ] `packages/adapters/src/__contract__/calendar-event-annotations.contract.ts` — memory-twin vs Postgres parity (mirror `calendar-events.contract.ts`)
- [ ] `packages/core/src/journal/domain/rule-tags.test.ts` — OTHER-requires-note Zod boundary (D-21)
- [ ] Framework install: none — Vitest/fast-check/testcontainers already configured project-wide.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| STALLED badge reads louder than benign staleness; force-reconnect flips to LIVE | WATCH-01 | Visual/interaction tone (D-20), live SSE state | Drive via chrome-devtools MCP: sever stream during RTH, confirm red STALLED + working force-reconnect (cancels pending backoff) |
| Event-move supplemental snapshot fires on a real >1% SPX move during RTH | SNAP-01 | Requires live market move; RTH-gated | Watch RTH session or proxy-verify via injected spot ticks; confirm one supplemental enqueue, cooldown-suppressed within 15min |
| Rule-tag control captures/edits ENTER/EXIT/ROLL in Journal thesis·review panel | RULE-01 | UI capture + read-view render | Drive via chrome-devtools MCP: set tags, reload, confirm persisted + inline render in trade timeline |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency acceptable (per-file quick run)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
