---
phase: 17
slug: overview-v2-redesign-iv-calibration-fix
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-03
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 17-RESEARCH.md §"Validation Architecture". Task-ID column is filled by the planner.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.8` (root `vitest run`); `apps/web` inherits workspace config, consistent with existing `scenario-engine.test.ts` |
| **Config file** | root `vitest.config.ts` (existing — no new config needed) |
| **Quick run command** | `vitest run apps/web/src/lib/iv-calibration.test.ts apps/web/src/lib/scenario-engine.test.ts` |
| **Full suite command** | `bun run test` (workspace-wide) |
| **Estimated runtime** | quick ~5s · full suite ~loaded (workspace) |

---

## Sampling Rate

- **After every task commit:** Run quick command (iv-calibration + scenario-engine specs)
- **After every plan wave:** Run `bun run test` — full workspace suite must stay green; `iv-inversion.test.ts`'s existing 1000-run fast-check properties MUST keep passing unchanged (this phase does not modify `invertIv`)
- **Before `/gsd-verify-work`:** Full suite green + `bun run typecheck` + `bun run lint`
- **Max feedback latency:** ~5 seconds (quick command)

---

## Per-Task Verification Map

| Task ID | Req | Behavior | Threat Ref | Test Type | Automated Command | File Exists | Status |
|---------|-----|----------|------------|-----------|-------------------|-------------|--------|
| TBD (planner) | OVW-02 | Per-leg IV calibration round-trips (ATM/ITM/OTM/near-zero-vega) via `invertIv` reuse | — | property (fast-check) | `vitest run apps/web/src/lib/iv-calibration.test.ts` | ❌ W0 | ⬜ pending |
| TBD (planner) | OVW-02 | Non-convergent leg (deep-ITM/illiquid fixture) returns tagged `err`, never `DEFAULT_IV` | T-17 silent-numeric-corruption | unit | `vitest run apps/web/src/lib/iv-calibration.test.ts` | ❌ W0 | ⬜ pending |
| TBD (planner) | OVW-02 | Back-leg-non-convergent excludes BOTH T+0 and @exp for that position (Pitfall 1 refinement) | — | unit | `vitest run apps/web/src/lib/scenario-engine.test.ts` | ❌ W0 (extend) | ⬜ pending |
| TBD (planner) | OVW-02 | Front-leg-non-convergent excludes T+0 only; @exp still renders | — | unit | `vitest run apps/web/src/lib/scenario-engine.test.ts` | ❌ W0 (extend) | ⬜ pending |
| TBD (planner) | OVW-02 | Cold-start (no live tick, no REST marketValue) does not spuriously show "IV n/a" (Pitfall 2) | — | unit | `vitest run apps/web/src/lib/iv-calibration.test.ts` | ❌ W0 | ⬜ pending |
| TBD (planner) | OVW-02 | REST-fallback price derivation guards `netQty === 0` / `marketValue === null` (Pitfall 3) | T-17 div-by-zero/NaN | unit | `vitest run apps/web/src/lib/iv-calibration.test.ts` | ❌ W0 | ⬜ pending |
| TBD (planner) | OVW-02 | Stale GEX displays its snapshot timestamp (D-03) | — | unit/manual | `vitest run apps/web/src/screens/Overview.test.tsx` (reuse Market `relAge` pattern) | ⚠️ verify W0 | ⬜ pending |
| TBD (planner) | OVW-01 | Row-highlight dims net-book curves, highlights selected position (D-05) | — | component | `vitest run apps/web/src/components/charts/PayoffChart.test.tsx` | ⚠️ verify W0 | ⬜ pending |
| TBD (planner) | OVW-01 | Scenario-strip level set caps to a readable count, dedupes, sorts ascending (D-06) | — | unit | `vitest run apps/web/src/lib/scenario-engine.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/web/src/lib/iv-calibration.ts` + `iv-calibration.test.ts` — new module (thin caller over `invertIv`); TDD red→green with fast-check property + unit tests per the map above
- [ ] Extend `apps/web/src/lib/scenario-engine.test.ts` — add front-leg-vs-back-leg non-convergence fixtures (Pitfall 1)
- [ ] Verify whether `apps/web/src/components/charts/PayoffChart.test.tsx` exists; create it for the dimmed/highlighted dual-curve mode (D-05) if absent
- [ ] Verify whether `apps/web/src/screens/Overview.test.tsx` exists and its current coverage; scope one for the TOS-dock rewrite

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TOS-dock layout renders in prod matching `overview-v2.html` | OVW-01 | Visual fidelity vs mockup is a human judgement | Deploy; compare Overview screen to `mockups/overview-v2.html` (payoff hero, breakevens, T+0/@exp strip, docked positions, GEX rail, pill header) |
| Amber staleness tint reads correctly against live vs frozen data | OVW-02 | Requires live/stale market states to observe | Observe during + outside RTH: live mark amber > 5 min, GEX amber > refresh cadence |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
