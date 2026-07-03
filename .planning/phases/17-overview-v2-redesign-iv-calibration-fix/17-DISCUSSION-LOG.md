# Phase 17 Discussion Log

**Date:** 2026-07-03
**Mode:** discuss (default) — user away during questioning; Claude captured recommended defaults per harness authorization.

## How this session ran

Prior context loaded (PROJECT.md, REQUIREMENTS.md OVW-01/02, ROADMAP Phase 17, v1.2 research
PITFALLS.md). Codebase scouted via grep (codegraph not initialized): found
`scenario-engine.ts` (flat per-leg IV — the DEFAULT_IV path to fix), `Overview.tsx`,
`PayoffChart.tsx`, `packages/quant` BSM engine, and the `overview-v2.html` design mockup.

Four phase-specific gray areas were presented for selection. The user did not respond within the
window (AFK). Rather than stall, Claude recorded recommended defaults for all four, each grounded
in the mockup / OVW reqs / research Pitfall 4 / existing code, and flagged them as override points
in CONTEXT.md.

## Gray areas + captured decisions (all recommended, override-able)

| Area | Options considered | Recommended default (CONTEXT.md) |
|---|---|---|
| Non-convergence display | hide T+0 + badge / @exp-only / marked estimate | D-02: no fabricated T+0 for the leg; draw @exp + "IV n/a" badge; net-book flags itself partial |
| Staleness surfacing | always-timestamp / amber-when-stale / threshold | D-03: both — always show timestamp + amber when age past threshold (mark >5min, GEX >cadence); Phase-17 scope is timestamp+threshold only, NOT the Phase-20 watchdog |
| Payoff scope + interactivity | net-only / per-position / net+toggle / drill-down | D-05: net book hero + light per-position row-highlight; no modal drill-down |
| Scenario strip levels | every strike / bounded key set; which @exp expiry | D-06/D-07: bounded key set (GEX walls/flip/spot + position strikes); @exp = front (nearest) expiry |

## Deferred / redirected

- Three-state LIVE/QUIET/STALLED stream watchdog → Phase 20 (WATCH-01).
- Per-position drill-down modal → later.
- Full-chain scenario strip → rejected (clutter).
- 2 weakly-matched "Untitled" pending todos → reviewed, not folded (too vague).

## Follow-up

User should review CONTEXT.md decisions D-01..D-07 and adjust any before `/gsd-plan-phase 17`.
Re-run `/gsd-discuss-phase 17` (choose "Update it") to revise interactively.
