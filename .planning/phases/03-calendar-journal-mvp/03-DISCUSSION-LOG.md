# Phase 3: Calendar Journal (MVP) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-13
**Phase:** 03-calendar-journal-mvp
**Areas discussed:** Leg identity (call/put gap), Strike shape, Job orchestration, Missing/out-of-filter leg, Net greeks scaling, NaN legs

---

## Leg identity (call/put gap)

| Option | Description | Selected |
|--------|-------------|----------|
| Add `option_type` column + migration | NOT NULL enum (C/P) on calendars + Zod field on POST; snapshot matches legs by (underlying, strike, type, expiry) | ✓ |
| Separate front/back leg symbols | Store two OCC symbols on the calendar; most precise, pushes symbol-format into the API | |
| Infer from existing data | No schema change; look up whichever type has observations — fragile (both C and P exist) | |

**User's choice:** Add `option_type` column + migration
**Notes:** Schema gap — calendars table had no option type; blocked CAL-01/CAL-02 leg resolution.

## Strike shape

| Option | Description | Selected |
|--------|-------------|----------|
| Same strike only (true calendar) | One `strike` column (existing); both legs share it; diagonals deferred | ✓ |
| Allow per-leg strikes (diagonal) | front_strike/back_strike columns; wider scope, needs migration | |

**User's choice:** Same strike only

## Job orchestration

| Option | Description | Selected |
|--------|-------------|----------|
| Chain off compute completion | compute-bsm-greeks enqueues snapshot-calendars on success (D-07 pattern); greeks fresh | ✓ |
| Independent schedule, read latest | Own cron, reads most-recent; can race a half-computed slot | |
| Single combined job | Fold snapshot into compute; violates one-job-one-responsibility | |

**User's choice:** Chain off compute completion

## Missing/out-of-filter leg

| Option | Description | Selected |
|--------|-------------|----------|
| Targeted fetch for registered legs | fetch-cboe-chain fetches union of band-filter + every open calendar's exact contracts | ✓ |
| Skip + log when leg missing | Snapshot only calendars with both legs observed; long back legs silently get no journal | |
| Widen fetch DTE filter | Bump maxDte globally; inflates every fetch ~2× | |

**User's choice:** Targeted fetch for registered legs
**Notes:** Deliberate Phase 2 fetch extension owned by Phase 3 — calendar registry drives what must be observed.

## Net greeks scaling

| Option | Description | Selected |
|--------|-------------|----------|
| Per-spread, qty-scaled, ×100 | net = (back − front) × qty × 100; consistent with pnl_open | ✓ |
| Per-spread, unscaled | back − front only; consumer scales later | |
| Per-leg, both stored | No netting; schema has only net_* columns | |

**User's choice:** Per-spread, qty-scaled, ×100

## NaN legs

| Option | Description | Selected |
|--------|-------------|----------|
| Store NaN, still write row | front_iv/back_iv = 'NaN' (T-02-16 convention) when unsolvable; raw IV + marks populate; journal continuous | ✓ |
| Skip snapshot when any leg NaN | No row if either leg NaN; creates gaps during extreme vol | |

**User's choice:** Store NaN, still write row

## Claude's Discretion

- Port names and use-case factory wiring (follow Phase 2 `ForVerbingNoun` / `makeXxx(deps)` conventions).
- Holiday list internal representation (Set vs array) — pure data in core domain.

## Deferred Ideas

- Diagonal spreads / per-leg strikes — future.
- NYSE early-close (13:00 ET) handling — v1 treats half days as normal.
- `trigger_job` MCP tool — Phase 5 (D-08).
- Multi-leg / non-calendar strategies — not in v1.
