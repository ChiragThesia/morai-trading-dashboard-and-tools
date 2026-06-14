# Phase 3: Calendar Journal (MVP) - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Register a calendar spread via the API; a `snapshot-calendars` job writes one
fully-populated `calendar_snapshots` row per open calendar every 30-min RTH slot
(skipping holidays); `GET /api/journal/:calendarId` and MCP `get_journal` return the
same ordered series from one shared contracts schema. The end-to-end MVP anchor:
register → snapshot → read, via both HTTP and MCP.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**8 requirements are locked.** See `03-SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `03-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- Calendar register / list / manual-close vertical slices (route + use-case + ports + Postgres repo + memory twin + MCP tool where applicable)
- `snapshot-calendars` pg-boss job on the 30-min RTH cadence with full row contract
- NYSE holiday static list (2026–2027) in core domain + gating for snapshot AND existing fetch jobs
- Journal read surface: HTTP + MCP from shared contracts
- Six MCP tools registered (typed-empty for term-structure/skew)

**Out of scope (from SPEC.md):**
- `trigger_job` MCP tool — Phase 5 (D-08 ban on manual triggers stands)
- Fill-based close / journal rebuild — Phase 5
- Skew + term-structure computation — Phase 6 (tools return typed empty)
- Schwab anything — Phase 4
- Web UI — v1 exclusion (D19)
- Realized P&L / multi-spread strategies beyond single calendars
- NYSE early-close (13:00 ET) handling — half days treated as normal in v1

</spec_lock>

<decisions>
## Implementation Decisions

### Calendar leg identity
- **D-01:** Add an `option_type` enum column (`C`/`P`, NOT NULL) to the `calendars` table via a Drizzle migration, plus a matching Zod field on `POST /api/calendars`. A calendar is one option type across both legs. The schema today has no type column — without it the snapshot cannot pick the right `leg_observations`. The snapshot resolves each leg by `(underlying, strike, option_type, expiry)` → `contracts.occSymbol` → latest `leg_observations` row.
- **D-02:** Same-strike only (true calendar). The existing single `strike` column serves both legs. Diagonals / per-leg strikes are deferred — no `front_strike`/`back_strike` split in v1.

### Job orchestration
- **D-03:** `snapshot-calendars` chains off `compute-bsm-greeks` completion (the same `boss.send(...)` success-trigger pattern fetch→compute already uses, D-07 style). Slot order is fetch → compute → snapshot, so greeks are fresh when the snapshot reads them. Snapshot reads the rows compute just wrote. NOT an independent cron (avoids racing a half-computed slot), NOT folded into the compute handler (one-job-one-responsibility).
- **D-04:** Targeted fetch for registered legs. `fetch-cboe-chain` is extended so each slot fetches the union of (a) the existing band/DTE filter AND (b) the exact contracts of every open calendar. This guarantees the snapshot always has its legs even when a calendar's back leg exceeds the ≤90-DTE / ±10% strike filter. This is a deliberate Phase 2 fetch-handler/use-case extension owned by Phase 3 (the calendar registry drives what must be observed).

### Snapshot computation
- **D-05:** Net greeks are position-level: `net_greek = (back_greek − front_greek) × qty × 100` for delta/gamma/theta/vega (long calendar = long back, short front). Consistent with the locked `pnl_open = (net_mark − open_net_debit) × qty × 100`. `net_mark = back_mark − front_mark`, `term_slope = back_iv − front_iv`. The journal stores true position exposure (net_delta in $/point), not per-unit.
- **D-06:** NaN-leg handling: if a leg's `bsm_iv` is NaN-stamped (unsolvable) for the slot, the snapshot STILL writes the row — storing numeric `'NaN'` (same convention as `leg_observations` T-02-16) for the affected `front_iv`/`back_iv` and any net greek that depends on the NaN leg. Raw IV (`*_iv_raw`) and marks still populate. The journal stays continuous; gaps are visible-as-NaN rather than missing rows (which would drop out exactly during extreme-vol moments).

### Claude's Discretion
- Exact port names (`ForRegisteringCalendar`, `ForSnapshottingCalendars`, etc.) and use-case factory wiring follow the established Phase 2 `ForVerbingNoun` + `makeXxx(deps)` conventions — planner's call within the hexagon law.
- Holiday list internal representation (Set of ISO dates vs array) — planner's call; must be pure data in core domain.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase
- `.planning/phases/03-calendar-journal-mvp/03-SPEC.md` — Locked requirements, boundaries, acceptance criteria. MUST read before planning.

### Schema & data shape
- `packages/adapters/src/postgres/schema.ts` — `calendars` (gets `option_type` column, D-01) + `calendar_snapshots` (18-column journal target, already defined) + `contracts` (occSymbol ↔ strike/expiry/type lookup the snapshot joins through) + `leg_observations` (the bsm greeks the snapshot reads).

### Phase 2 patterns to mirror (established, working in prod)
- `packages/core/src/journal/application/fetchChain.ts` — `isInFilter` band/DTE gate the targeted-fetch extension (D-04) augments; use-case factory + port shape to mirror for calendar use-cases.
- `packages/core/src/journal/application/computeBsmGreeks.ts` + `apps/worker/src/handlers/fetch-cboe-chain.ts` — the `boss.send(...).catch(...)` success-chain pattern `snapshot-calendars` extends (D-03); pg-boss `createQueue` requirement for any new queue.
- `packages/adapters/src/postgres/repos/leg-observations.ts` — chunked-insert pattern (≤2,000 rows, 65,534-param limit) and `parseOccSymbol`/`formatOccSymbol` round-trip the snapshot's leg-resolution reuses.
- `packages/core/src/journal/domain/rth-window.ts` — `isWithinRth()` the snapshot/fetch gate calls; holiday list lands alongside it in core domain (D, CAL-05).
- `apps/server/src/adapters/mcp/tools.ts` + `packages/contracts/src/status.ts` — the route+tool-share-one-contract pattern all six MCP tools and their HTTP routes follow (MCP-02).
- `packages/core/src/journal/domain/dte.ts` — `computeT`/DTE helpers for `dte_front`/`dte_back`.

### Project rules (always)
- `.claude/rules/architecture-boundaries.md`, `tdd.md`, `typescript.md` — hexagon law, TDD red→green, no any/as/!, Zod at boundaries, in-memory twin per port, HTTP+MCP per use-case.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `calendar_snapshots` table: all 18 columns already defined (incl. vendor `*_iv_raw`, `source` enum, composite PK `(time, calendar_id)` for idempotency) — no snapshot-table migration needed.
- `isWithinRth()` (core) — the RTH half of the CAL-05 gate already exists; only the holiday list is new.
- BSM greeks per contract already computed and stored in `leg_observations.bsm_*` by Phase 2 — the snapshot reads, never recomputes pricing.
- `parseOccSymbol`/`formatOccSymbol` (shared) — leg-symbol resolution.

### Established Patterns
- Vertical slice = port (`ForVerbingNoun`) + use-case factory (`makeXxx(deps)`) + Postgres repo + in-memory twin + HTTP route + MCP tool + shared contract, all in one change (MCP-02).
- Append-only / idempotent writes via composite PK + chunked inserts.
- Job = pg-boss queue (must `createQueue` first) + thin worker handler (Zod-guard payload → use-case → Result) + success-chain `boss.send`.

### Integration Points
- `calendars` table: needs the `option_type` migration (D-01) — the one schema change.
- `fetch-cboe-chain` handler/use-case: extended for targeted registered-leg fetch (D-04) — touches Phase 2 code.
- `compute-bsm-greeks` handler: gains a `boss.send('snapshot-calendars')` success trigger (D-03).
- `apps/server` MCP server + HTTP router: five new tools/routes registered alongside `get_status`.

</code_context>

<specifics>
## Specific Ideas

- Calendar spread convention: long the back expiry, short the front (debit calendar) — drives all the `back − front` netting signs (net_mark, net greeks).
- Journal should read like a continuous time series even through unsolvable-vol slots — hence NaN-in-row over skip-row (D-06).

</specifics>

<deferred>
## Deferred Ideas

- Diagonal spreads / per-leg strikes — future enhancement; v1 is same-strike only (D-02).
- NYSE early-close (13:00 ET half days) — v1 treats them as normal RTH days (SPEC out-of-scope).
- `trigger_job` MCP tool for manually firing the snapshot — Phase 5 (D-08 ban holds).
- Multi-leg / non-calendar strategies — not in v1 requirements.

</deferred>

---

*Phase: 3-calendar-journal-mvp*
*Context gathered: 2026-06-13*
