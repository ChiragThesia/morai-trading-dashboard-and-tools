# Phase 3: Calendar Journal (MVP) — Specification

**Created:** 2026-06-11
**Ambiguity score:** 0.13 (gate: ≤ 0.20)
**Requirements:** 8 locked

## Goal

A trader registers a calendar spread via `POST /api/calendars`, the `snapshot-calendars`
job writes one fully-populated `calendar_snapshots` row per open calendar every 30
minutes during RTH (skipping holidays), and both `GET /api/journal/:calendarId` and MCP
`get_journal` return the same ordered snapshot series from one shared Zod schema — the
end-to-end MVP anchor.

## Background

Phase 1 shipped the schema: `calendars` (underlying, strike ×1000, front/back expiry,
qty, status enum open/closed, open_net_debit, close_net_credit) and `calendar_snapshots`
(time-leading composite PK, all journal columns already defined: spot, net/front/back
marks, BSM front/back IV, vendor `*_iv_raw`, net greeks, term_slope, DTEs, pnl_open,
source enum) — both RLS-enabled, zero rows. Phase 2 shipped the data those snapshots
read: `leg_observations` with `bsm_*` greeks computed per observation, `isWithinRth()`
in core domain, three scheduled pg-boss jobs, and the `/api/status` + MCP `get_status`
pattern (route + tool sharing one contracts schema).

What does NOT exist: calendar ports/use-cases in `packages/core`, calendar/journal HTTP
routes, the `snapshot-calendars` job, any NYSE holiday awareness, and five of the six
MCP tools. The MCP server registers exactly one tool today.

## Requirements

1. **Calendar registration (CAL-01)**: `POST /api/calendars` registers an open calendar.
   - Current: `calendars` table exists, empty; no route, no port, no use-case.
   - Target: POST with `{underlying, strike, frontExpiry, backExpiry, qty, openNetDebit, openedAt?, notes?}` Zod-validated; returns 201 + created calendar with UUID; invalid body returns 400 with field errors.
   - Acceptance: POST round-trip test passes against real Postgres (testcontainers); invalid expiry order (back ≤ front) rejected 400.

2. **Calendar listing (CAL-04)**: `GET /api/calendars` lists open and closed calendars.
   - Current: no route.
   - Target: returns all calendars ordered `openedAt` desc, each with status; optional `?status=open|closed` filter.
   - Acceptance: list returns registered calendar; after close, same calendar appears with `status: "closed"`.

3. **Manual close (CAL-04)**: `POST /api/calendars/:id/close` closes a calendar.
   - Current: `status`/`closedAt`/`close_net_credit` columns exist; no write path.
   - Target: close with `{closeNetCredit}` sets `status=closed`, `closedAt`; closed calendars stop receiving snapshots; closing a non-existent or already-closed calendar returns 404/409.
   - Acceptance: close round-trip test; snapshot job test proves closed calendar gets no new row.

4. **Snapshot job (CAL-02)**: `snapshot-calendars` writes one journal row per open calendar per 30-min RTH slot.
   - Current: table fully defined, no job, no use-case.
   - Target: each row populates ALL columns: time, spot, net_mark, front_mark, back_mark, front_iv, back_iv (BSM-inverted), front_iv_raw, back_iv_raw (vendor), net_delta, net_gamma, net_theta, net_vega, term_slope = back_iv − front_iv, dte_front, dte_back, pnl_open, source. `pnl_open = (net_mark − open_net_debit) × qty × 100`. Composite PK (time, calendar_id) makes re-runs idempotent.
   - Acceptance: job test against real Postgres writes a complete row for an open calendar with leg data present; re-run same slot does not duplicate; pnl_open formula asserted exactly.

5. **Journal read (CAL-03)**: `GET /api/journal/:calendarId` returns the ordered snapshot series.
   - Current: no route, no use-case.
   - Target: ordered JSON array (time asc) of full snapshot objects for one calendar; unknown calendar returns 404; calendar with zero snapshots returns 200 + empty array.
   - Acceptance: after ≥1 snapshot, route returns array with all locked fields; order asserted; 404/empty cases tested.

6. **RTH + holiday no-op (CAL-05)**: jobs skip outside RTH and on NYSE holidays.
   - Current: `isWithinRth()` exists (phase 2); no holiday data anywhere.
   - Target: static NYSE full-closure holiday list for 2026–2027 as pure data in core domain; `snapshot-calendars` (and the phase 2 fetch chain via the same gate) logs "outside RTH / holiday, skipping" and writes nothing when gated. Early-close half days treated as normal days in v1.
   - Acceptance: unit tests for a 2026 holiday (e.g. 2026-07-03 observed July 4th), a weekend, and a normal RTH slot; job test proves zero rows written when gated.

7. **Six MCP tools (MCP-01 partial)**: `get_status`, `list_calendars`, `get_journal`, `get_live_greeks`, `get_term_structure`, `get_skew` registered and reachable.
   - Current: only `get_status` registered.
   - Target: all six tools callable; `get_live_greeks` returns latest bsm-greek legs for a calendar's contracts (phase 2 data); `get_term_structure` and `get_skew` return a TYPED EMPTY result (`{observations: []}`-shaped per contracts schema) because analytics compute lands in Phase 6 — never an error. `trigger_job` is explicitly deferred to Phase 5 (D-08 holds).
   - Acceptance: MCP test invokes each of the six tools and gets a schema-valid response; term-structure/skew return empty-typed payloads, exit code 0.

8. **Shared contracts (MCP-01/MCP-02)**: each route/tool pair shares one Zod schema from `packages/contracts`.
   - Current: `status.ts` contract exists (phase 2 pattern).
   - Target: calendar, journal, live-greeks, term-structure, skew schemas in `packages/contracts`; HTTP routes and MCP tools both import from there; no duplicated shape definitions.
   - Acceptance: grep proves routes and tools import the same contract symbols; contract test validates a snapshot row against the journal schema.

## Boundaries

**In scope:**
- Calendar register / list / manual-close vertical slices (route + use-case + ports + Postgres repo + memory twin + MCP tool where applicable)
- `snapshot-calendars` pg-boss job on the 30-min RTH cadence with full row contract
- NYSE holiday static list (2026–2027) in core domain + gating for snapshot AND existing fetch jobs
- Journal read surface: HTTP + MCP from shared contracts
- Six MCP tools registered (typed-empty for term-structure/skew)

**Out of scope:**
- `trigger_job` MCP tool — Phase 5 (jobs phase); D-08 ban on manual triggers stands
- Fill-based close / journal rebuild — Phase 5 (needs Schwab fills from Phase 4)
- Skew + term-structure computation — Phase 6 (tools return typed empty until then)
- Schwab anything — Phase 4
- Web UI — v1 exclusion (D19)
- Realized P&L / multi-spread strategies beyond single calendars — not in v1 requirements
- NYSE early-close (13:00 ET) handling — v1 treats half days as normal days

## Constraints

- Holiday source of truth: committed static list of NYSE full closures for 2026–2027, pure data in `packages/core` domain (no I/O, no new dependency).
- `pnl_open = (net_mark − open_net_debit) × qty × 100` (SPX multiplier 100, dollars).
- `net_mark = back_mark − front_mark` (long calendar: long back, short front); `term_slope = back_iv − front_iv`.
- Snapshot cadence identical to phase 2 fetch cadence (30-min RTH slots, ET) so journal rows align with leg observations.
- All external input Zod-parsed; hexagon law: snapshot logic in core, Drizzle/pg-boss in adapters/worker; strict TS (no any/as/!); TDD red→green; every use-case ships HTTP + MCP in the same change (MCP-02).
- Snapshot job must be idempotent per (time, calendar_id) — composite PK is the guard.

## Acceptance Criteria

- [ ] `POST /api/calendars` registers; `GET /api/calendars` lists it; MCP `list_calendars` returns the same list.
- [ ] `POST /api/calendars/:id/close` closes; closed calendars excluded from snapshotting; list shows both statuses.
- [ ] `snapshot-calendars` writes one complete row per open calendar per RTH slot; all 18 columns populated; pnl_open matches the locked formula; re-run is idempotent.
- [ ] `GET /api/journal/:calendarId` returns the ordered series; MCP `get_journal` returns the same data via the same contracts schema.
- [ ] Job no-ops with "outside RTH / holiday, skipping" log on weekends, outside 09:30–16:00 ET, and on 2026–2027 NYSE holidays — zero rows written.
- [ ] All six MCP tools reachable; `get_term_structure`/`get_skew` return typed empty results, never errors.
- [ ] Full suite green (typecheck, lint, tests incl. testcontainers) — no regression to phases 1–2.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                    |
|--------------------|-------|------|--------|------------------------------------------|
| Goal Clarity       | 0.90  | 0.75 | ✓      | Roadmap goal precise; schema pre-locks contract |
| Boundary Clarity   | 0.85  | 0.70 | ✓      | trigger_job conflict resolved (deferred) |
| Constraint Clarity | 0.85  | 0.65 | ✓      | pnl formula, holiday source, cadence locked |
| Acceptance Criteria| 0.85  | 0.70 | ✓      | Roadmap criteria 1–5 + close + idempotency |
| **Ambiguity**      | 0.13  | ≤0.20| ✓      |                                          |

## Interview Log

| Round | Perspective    | Question summary                          | Decision locked                                        |
|-------|----------------|-------------------------------------------|--------------------------------------------------------|
| 1     | Researcher     | Exact snapshot row contract ("…" in roadmap) | Fully expanded roadmap list incl. net greeks — matches existing schema columns |
| 1     | Researcher     | Is closing a calendar in scope?           | Yes — manual close endpoint; fill-based close stays Phase 5 |
| 1     | Researcher     | Holiday source of truth                   | Committed static NYSE list 2026–2027 in core; half days = normal days in v1 |
| 2     | Simplifier     | pnl_open definition                       | (net_mark − open_net_debit) × qty × 100, dollars       |
| 2     | Simplifier     | MCP-01 trigger_job vs criterion 5 conflict | trigger_job deferred to Phase 5; D-08 stands; six tools in Phase 3 |

---

*Phase: 03-calendar-journal-mvp*
*Spec created: 2026-06-11*
*Next step: /gsd-discuss-phase 3 — implementation decisions (how to build what's specified above)*
