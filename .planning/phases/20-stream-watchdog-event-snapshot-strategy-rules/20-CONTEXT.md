# Phase 20: Stream Watchdog, Event Snapshot & Strategy Rules - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Three independent, individually-shippable tail items that close out v1.2 — ordered
cheapest/most-isolated first:

1. **WATCH-01** — honest 3-state, RTH-aware stream-health badge (LIVE / QUIET / STALLED)
   driven by a transport-level heartbeat decoupled from data cadence. Kills the Phase-12
   "badge lies LIVE" gap (can no longer show LIVE while ticks are stalled).
2. **SNAP-01** — a large SPX move on the live stream triggers a supplemental out-of-cycle
   journal snapshot via the existing snapshot job (ad-hoc enqueue), without duplicating the
   30-minute cadence.
3. **RULE-01** — record enter/exit/roll rules per trade and which rule fired, as a closed
   enum + structured tag. **A thin recording layer, NOT a rules-evaluation DSL.**

Scope clarifies HOW to implement these three; no new capabilities.
</domain>

<decisions>
## Implementation Decisions

### WATCH-01 — Stream Health Badge
- **D-01:** Three-state model replaces today's 4-state badge (`live`/`stale`/`reconnecting`/`poll`).
  **LIVE** = ticks arriving during RTH. **QUIET** = market closed (outside RTH / weekend /
  NYSE holiday) — benign gray. **STALLED** = RTH but ticks frozen past threshold **OR**
  transport dead — both fold into one honest red state. Directly closes the Phase-12
  "badge lies LIVE" debt.
- **D-02:** Stall threshold **~20s** — no `ticks` event while the transport/heartbeat is still
  alive during RTH → STALLED. Ticks resume → instant flip back to LIVE. (~20s ≈ 20× the ~1/sec
  cadence; tunable constant for research.)
- **D-03:** **Server emits RTH/market-state on the heartbeat (`ping`)**; client is
  authoritative-from-server. The heartbeat does double duty — proves transport liveness AND
  carries RTH truth, so the client needs no local clock. Additive to the stream contract +
  sidecar/server fan-out. Wires the currently-**ignored** client `ping` handler
  (`useLiveStream.ts` ~line 172).
- **D-11 (cold-start grace):** On cold connect or mid-reconnect during RTH (transport up, no
  tick yet), hold a neutral "connecting" look (reuse QUIET styling, no red) until the first
  tick (→LIVE) or the ~20s window elapses (→STALLED). No false red on page load; still goes
  honest-red if ticks never arrive.
- **D-17 (STALLED action):** STALLED exposes a **manual force-reconnect** action (mints a fresh
  single-use ticket, reconnects immediately) alongside the informational tooltip. Must **cancel
  the pending exp-backoff reconnect timer** to avoid double-connects.
- **D-20 (STALLED tone):** Exact visual tone **deferred to `/gsd-ui-phase 20`**. Intent locked:
  STALLED must read louder / more alarming than benign staleness ("your data is frozen").

### SNAP-01 — Event-Triggered Supplemental Snapshot
- **D-04:** Detection runs **server-side (headless)** — NOT the browser (a journaling feature
  must not depend on a tab being open). On trigger: ad-hoc `boss.send('snapshot-calendars', {},
  { singletonKey })`, reusing the existing RTH+holiday-gated job.
- **D-05:** "Large move" = SPX **absolute % move over a short rolling window** (~1% within ~5min).
  Percent is index-level robust; rolling window catches fast spikes/drops, not slow all-day
  drift. Exact %/window = tunable constants for research.
- **D-06:** Debounce = **cooldown vs ANY snapshot** (scheduled OR supplemental) within the last
  ~15min. Yields at most one supplemental between 30-min scheduled runs and skips firing right
  after a scheduled capture. ~15min tunable.
- **D-12 (provenance):** Add a **nullable trigger/reason marker** on the snapshot row
  (`scheduled` default vs `event-move`), non-destructive. Lets later "what happened" review
  filter to the event-triggered captures.
- **D-15 (gating + direction):** Detection is **RTH-gated** (skip off-hours — the job no-ops
  outside RTH anyway, so off-hours firing only enqueues dead jobs). Triggers on absolute % move
  in **either direction** (a >1% drop matters as much as a rally).

### RULE-01 — Strategy Rule Recording
- **D-07:** **3 enums keyed to event type** — ENTER / EXIT / ROLL, each attaching to its
  matching `CalendarEvent` type (OPEN→enter, CLOSE→exit, ROLL→roll). Prevents nonsense combos,
  keeps each list short. Recording layer, NOT a DSL.
- **D-08:** Rule enum **values research-proposed from the KB** (`calendar_spread.md` +
  `trade_management.md`), **user trims before lock**. Illustrative (non-final) seeds floated:
  EXIT = profit-target / max-loss / time-stop / thesis-invalidated; ROLL = defend-tested-side /
  roll-for-duration.
- **D-09:** Structured tag lives in a **SEPARATE annotations table keyed by `fillIdsHash`** —
  NOT a column on `calendar_events`. `rebuildJournal.ts` is delete-then-reinsert, so any column
  on `calendar_events` is wiped every rebuild (this is a **latent data-loss bug** for
  `entryThesis` today). The annotations table is orthogonal to the rebuilt ledger; the Journal
  joins events↔annotations on the stable `fillIdsHash`. Orphan-on-hash-change (event's fill
  composition shifts → new hash) = **log & orphan** (rare).
- **D-10 (capture UX):** Per-event rule control in the Journal **"thesis·review" panel**,
  **editable anytime** (an exit rule is only known at close → no forced-at-open). Free-text
  thesis **retained as optional supplement**. Include an **OTHER/unlisted** value.
- **D-13 (adapter surface):** New write use-case ships **HTTP route + MCP tool (read+write) in
  the same PR** (architecture §9). MCP tool lets Claude Code set/query rule tags.
- **D-14 (multiplicity):** **Multiple rules per event** — the annotation holds a SET of
  phase-appropriate rule values (multi-select → array column or join table). Route/MCP contract
  is list-shaped.
- **D-16 (backfill):** **No backfill** — annotations table ships empty. `entryThesis` column is
  deprecated/left in place (the rebuild-null bug makes surviving data near-moot).
- **D-21 (OTHER value):** Selecting OTHER **requires a short free-text note** (conditional-required
  validation in the contract + form); listed enum values keep free-text optional.
- **D-22 (review view):** Recorded rule tags render inline in the Journal **trade
  timeline/review (read) view** AND stay editable via the control — scan "which rule fired"
  across trades at a glance.

### Cross-Cutting
- **D-18 [informational] (sequencing):** Build cheapest-first **WATCH-01 → SNAP-01 → RULE-01**. **Ship each
  independently to prod** (three separate deploy+UAT cycles within the phase), not one bundled
  ship. Plans should be grouped so each feature is independently landable. *(Meta-decision:
  enforced structurally by wave order + per-feature ship markers in the plans, not a code
  must_have.)*
- **D-19 [informational] (UI-SPEC):** **Run `/gsd-ui-phase 20` before `/gsd-plan-phase 20`** — badge behavior
  (WATCH-01) + rule control in Journal (RULE-01) both touch UI. *(Process directive, already
  satisfied — 20-UI-SPEC.md exists and drives plans 20-03/20-11.)*

### Claude's Discretion (research/planner territory — not user-decided)
- **Enum DB representation:** recommend `text` + Zod validation at the boundary
  (parse-don't-cast; grows without `ALTER TYPE`) over a rigid Postgres native enum. Planner's call.
- **Exact tunable constants:** WATCH stall ~20s; SNAP move %, rolling window, cooldown ~15min.
- **Server-side detector placement + SPX spot tick source:** which process observes the spot
  tick and holds the `boss.send` capability (server SSE relay vs sidecar vs small consumer).
- **Port shapes, memory-twin parity, exact MCP tool signature, Journal panel placement.**
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase-level source of truth
- `.planning/ROADMAP.md` §"Phase 20: Stream Watchdog, Event Snapshot & Strategy Rules" — goal + 3 success criteria
- `.planning/REQUIREMENTS.md` — WATCH-01 (line ~78), SNAP-01 (line ~84), RULE-01 (line ~89)
- `.planning/research/FEATURES.md` — anti-features (bounded backoff, snapshot debounce,
  structured-not-free-text rules), stall-threshold conventions, priority table (all three are P1)

### WATCH-01 attach points
- `apps/web/src/hooks/useLiveStream.ts` — EventSource state machine (live/stale/reconnecting/poll),
  exp-backoff reconnect, **ignored `ping` handler (~line 172)** to be wired for heartbeat/RTH
- `apps/web/src/components/LiveStatusBadge.tsx` — presentational badge, per-state color tokens + dot
- `packages/core/src/journal/domain/rth-window.ts` — `isWithinRth` Intl `America/New_York` pattern
  (reference for the server-emitted RTH state)

### SNAP-01 attach points
- `apps/worker/src/handlers/snapshot-calendars.ts` — RTH+holiday-gated job; `boss.send` +
  `singletonKey` ad-hoc enqueue pattern (thin-adapter template)
- `packages/core/src/journal/application/snapshotCalendars.ts` — the snapshot use-case

### RULE-01 attach points
- `packages/core/src/journal/domain/calendar-event.ts` — `CalendarEvent` (OPEN/CLOSE/ROLL),
  `entryThesis` D-07 hook (line 48), `fillIdsHash` idempotency identity
- `packages/core/src/journal/application/rebuildJournal.ts` — **delete-then-reinsert** rebuild
  (the wipe mechanism that forces the separate annotations table, D-09)
- `packages/core/src/journal/application/syncFills.ts` — inserts events with `entryThesis: null`
- `packages/adapters/src/postgres/repos/calendar-events.ts` — `storeCalendarEvent`
  (`onConflictDoNothing` on `fill_ids_hash`), `deleteCalendarEvents`
- `packages/adapters/src/postgres/schema.ts` — `calendarEvents` + `calendars` `entryThesis`
  columns (~lines 72, 266)
- `apps/web/src/screens/Journal.tsx` — "thesis·review" panel (home of the rule control)
- `knowledge-base/grouped-data/calendar_spread.md` — rule enum seed (calendar-spread norms)
- `knowledge-base/grouped-data/trade_management.md` — rule enum seed (exit/management norms)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`LiveStatusBadge` + `useLiveStream`** — modify in place (4-state → 3-state); reconnect/backoff
  already exists, add heartbeat-timeout tracking + manual force-reconnect (D-17).
- **`snapshot-calendars` job + `boss.send`/`singletonKey`** — reuse verbatim for the ad-hoc
  supplemental enqueue (D-04); the job already self-gates RTH+holiday.
- **`isWithinRth` Intl pattern** — server already runs it; emit its result on the heartbeat (D-03).
- **`fillIdsHash`** — stable event identity; the annotations-table join key (D-09).
- **Button/Badge primitives (Phase 21)** — reuse for the badge + rule control UI.

### Established Patterns
- **Thin adapter:** array-guard → RTH/holiday gate → call use-case → map `Result` → `boss.send`
  (`snapshot-calendars.ts`).
- **pg-boss `singletonKey`** dedup for chained/ad-hoc enqueues.
- **`onConflictDoNothing` on `fill_ids_hash`** for idempotent event writes.
- **Zod-parse every stream frame; drop malformed, never cast** (`useLiveStream.ts`).
- **`Result<T,E>`, no `any`/`as`/`!`, parse-don't-cast** (typescript rule).
- **New use-case ⇒ HTTP route + MCP tool + in-memory twin in the same PR** (architecture §8/§9).

### Integration Points
- **Stream contract (`@morai/contracts`) + sidecar/server fan-out:** add RTH/market-state to the
  heartbeat payload (D-03).
- **New annotations table + Postgres repo + memory twin;** joined into the Journal read path.
- **New set-rule-tags / read-rule-tags use-case → HTTP route + MCP tool** (D-13, list-shaped D-14).
- **Snapshot row schema:** add nullable trigger-reason column (D-12).
- **Server-side move-detector** consuming the SPX spot tick → `boss.send('snapshot-calendars')`.
</code_context>

<specifics>
## Specific Ideas

- STALLED must read as a **real problem, louder than benign staleness** — directive for the UI-SPEC.
- Rule-enum starter seeds floated in discussion (illustrative, user trims): EXIT = profit-target /
  max-loss / time-stop / thesis-invalidated; ROLL = defend-tested-side / roll-for-duration.
- "OTHER" is an escape hatch, not a black hole — it **requires** a free-text note (D-21).
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

RULE-02 (rule-fired → outcome correlation report) is already tracked in
`.planning/REQUIREMENTS.md` §Future Requirements — needs accumulated tagged trades first, not
this phase.
</deferred>

---

*Phase: 20-stream-watchdog-event-snapshot-strategy-rules*
*Context gathered: 2026-07-04*
