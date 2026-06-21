# Phase 05: Jobs, Fill Rebuild & Integrity - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the background-jobs backbone and the trade-ledger layer of the journal:
all jobs behind a `JobQueue` port (pg-boss) with deterministic dedupe keys + idempotent
Zod-parsed handlers (JOB-01); the `refresh-tokens` job (JOB-02); the `compute-bsm-greeks`
backfill (JOB-03); and the heart — `sync-fills` pairs Schwab fills into a calendar's
OPEN/CLOSE/ROLL events with net debit/credit/P&L, plus a `rebuild-journal` path that
reconstructs that event layer entirely from fills (JRNL-01). Read-only brokerage continues
(consume transactions/fills; no order placement).

**The journal is a 4-layer system; Phase 5 builds Layer 1 only:**
- **L1 Trade ledger** (THIS PHASE): *what* I traded — OPEN/CLOSE/ROLL events, net debit/credit, realized P&L, per calendar + per leg.
- **L2 Greeks time-series** (built, Phase 2/3): *how* it moved — 30-min price + δ/γ/θ/vega in `calendar_snapshots`.
- **L3 Attribution** (DEFERRED → Phase 6): *why* it moved — decompose P&L into greek/event contributions, computed from L2.
- **L4 Strategy rules / gates** (DEFERRED → new phase): *why I acted* — enter/exit/roll rules + which rule fired.

</domain>

<decisions>
## Implementation Decisions

### Fill → event pairing (JRNL-01)
- **D-01:** Auto-match each Schwab fill to a calendar leg by parsing `fills.occSymbol`
  (OCC 21-char → underlying + expiry + strike + put/call) and matching the calendar's
  defined legs. No manual tagging in the happy path. Reuse Phase 4 `parseSchwabSymbol` /
  `formatOccSymbol`.
- **D-02:** Classify each fill OPEN (establishes/increases the intended leg) vs CLOSE
  (reduces/unwinds it), cross-checked against the calendar's `openedAt`/`closedAt`.
- **D-03 (ROLL is first-class):** ROLL is its own event type — NOT a bare close+open. A roll
  (close one expiry + open the next on the same thesis) is recorded as a ROLL event that
  references both legs, preserving the "same trade continued" chain. Without this, every
  rolled trade is misrepresented.
- **D-04:** Aggregate partial/multiple fills per leg — sum qty, qty-weighted average price.
- **D-05:** Fills matching no calendar → parked as `orphan` for later review. Never silently
  dropped; never auto-create a calendar.

### Journal event model
- **D-06:** Phase 5 introduces a calendar-event record (OPEN/CLOSE/ROLL) = the trade-ledger
  layer, distinct from the existing 30-min greeks `calendar_snapshots`. (Table shape is
  Claude's discretion — likely a `calendar_events` table FK'd to `calendars` + the source `fills`.)
- **D-07 (entry-thesis hook):** Add a MINIMAL free-text/tag "entry thesis" field per calendar
  (or per OPEN event) — explicitly NOT a rules engine, just an attach point so the future
  L4 strategy-rules layer has somewhere to hang. Cheap now, expensive to retrofit.

### P&L / net debit-credit (JRNL-01)
- **D-08:** Include commissions + fees (`fills.commission`, `fills.fees` exist) in net
  debit/credit. Sign: open debit positive, close credit negative.
- **D-09:** P&L = close credit − open debit − fees. Store BOTH the net-calendar number AND a
  per-leg breakdown (per-leg is required so L3 attribution can later ask "front leg vs back
  leg?"). Populates `calendars.openNetDebit` / `closeNetCredit` + the event/leg records.

### rebuild-journal scope (JRNL-01 / SC5)
- **D-10:** `rebuild-journal` reconstructs ONLY the event/position layer (OPEN/CLOSE/ROLL +
  net debit/credit/P&L) from fills, idempotently. It does NOT re-derive the 30-min greeks
  snapshots (fills carry no greeks). SC5 "matches the live snapshot rows" = the position/P&L
  fields reconcile — NOT greeks. Historical-chain replay is deferred.

### Jobs backbone (JOB-01)
- **D-11:** All jobs run behind the `JobQueue` port (pg-boss adapter) with deterministic
  dedupe keys + idempotent, Zod-parsed handlers (re-run produces no duplicate rows).
- **D-12:** Existing handlers (`compute-bsm-greeks`, `fetch-cboe-chain`, `fetch-schwab-chain`,
  `snapshot-calendars`, `fetch-rates`) + the new `sync-fills` / `refresh-tokens` get
  registered in the new `apps/worker/src/schedule.ts` and surfaced in `/api/status`
  `lastJobRuns`.

### refresh-tokens job (JOB-02)
- **D-13:** Runs 04:00 ET; refreshes both Schwab apps INDEPENDENTLY (one failing does not
  block the other); failures surface via the per-app `/api/status` flag + log.
- **D-14 (proactive expiry warning):** ALSO a daily check that WARNS when a refresh token
  nears its hard 7-day expiry, so the operator re-auths before a data gap (folds in the
  backlog re-auth-friction item). Channel this phase = status flag + log only.

### compute-bsm-greeks backfill (JOB-03)
- **D-15:** Drains `leg_observations WHERE bsm_iv IS NULL AND mark IS NOT NULL`, upserts
  computed IV/greeks, idempotent. SC3 = zero such rows remain after a run.

### Claude's Discretion
- `calendar_events` table shape + how ROLL references its legs; dedupe-key shapes per job
  (e.g. `{job_type}:{window_start}` scheduled, fill-id-based for sync-fills); orphan-review
  surface; leg-match tolerance + multi-calendar tie-breaking; pg-boss retry / dead-letter
  config; `trigger_job` MCP tool + HTTP route (SC5, MCP-02); RTH gating reuse.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 5 goal + 5 success criteria
- `.planning/REQUIREMENTS.md` — JOB-01, JOB-02, JOB-03, JRNL-01 (full text)

### Architecture (source of truth)
- `docs/architecture/jobs.md` — JobQueue port, dedupe, idempotency, RTH gating, refresh-tokens job
- `docs/architecture/data-model.md` — `calendars`, `calendar_snapshots`, `fills`, `orders`, `leg_observations`
- `docs/architecture/hexagonal-ddd.md` — ports/adapters dependency law
- `docs/architecture/mcp-and-plugins.md` — MCP-02 (trigger_job ships HTTP + MCP together)
- `docs/architecture/api-design.md` — `/api/status` `lastJobRuns` payload
- `docs/architecture/testing-tdd.md` — msw + testcontainers + in-memory twin

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `fills` table (`occSymbol`, `side`, `qty`, `price`, `commission`, `fees`, `raw`) + `orders` table — already scaffolded; `sync-fills` consumes these.
- `calendars` table already has `status`(open/closed) + `openedAt`/`closedAt` + `openNetDebit`/`closeNetCredit` — `sync-fills` populates these.
- `calendar_snapshots` = the 30-min greeks journal (L2) — untouched by Phase 5.
- Phase 4: `parseSchwabSymbol` / `formatOccSymbol` (OCC parse — reuse for leg matching); Schwab trader transactions feed → fills source; `broker_tokens` + per-app freshness + `selectChainSource` + AUTH_EXPIRED degradation (refresh-tokens + Schwab jobs respect it).
- Existing job handlers in `apps/worker/src/handlers/` (compute-bsm-greeks, fetch-cboe-chain, fetch-schwab-chain, snapshot-calendars, fetch-rates) — register in new `schedule.ts`.
- pg-boss already wired in `apps/worker/src/main.ts`.

### Established Patterns
- Hexagon: `core` imports `shared` only; pg-boss in adapters; Zod at boundaries; `Result<T,E>`; no any/as/!.
- TDD red→green; testcontainers for Postgres repos; msw for external HTTP; in-memory twins for ports.
- MCP-02: each use-case ships HTTP route + MCP tool together.

### Integration Points
- New `calendar_events` (OPEN/CLOSE/ROLL) + entry-thesis field on `calendars`.
- `sync-fills` reads `fills` + `calendars` (legs) → writes events + net debit/credit/P&L.
- `refresh-tokens` reads/writes `broker_tokens`; reads freshness for the proactive-expiry warning.
- `/api/status` gains `lastJobRuns` + the token pre-expiry warning flag.

</code_context>

<specifics>
## Specific Ideas

- "Journal history rebuilt from fills, never hand-written" (JRNL-01) — `rebuild-journal` is the source of truth for the L1 event layer.
- Per-leg P&L breakdown is a hard requirement (not optional) — it's what makes future attribution possible.
- ROLL must chain to its predecessor so a multi-roll trade reads as one continuous thesis.

</specifics>

<deferred>
## Deferred Ideas

- **L3 — P&L attribution** (decompose a calendar's move into θ/vega/δ + event contributions): → **Phase 6 (Derived Analytics)**. Data already captured in `calendar_snapshots`.
- **L4 — Strategy rules / logical gates** (record enter/exit/roll RULES + which rule fired per trade): → **NEW roadmap phase** (candidate). The D-07 entry-thesis hook is the minimal attach point. This is the user's stated end-goal ("improve our system/algo") but is its own capability.
- **Historical-snapshot replay** (re-fetch historical chains to recompute 30-min greeks): future, not Phase 5.
- **email/Slack notification channel** for token failure / pre-expiry alerts: future (status flag + log this phase).

</deferred>

---

*Phase: 05-jobs-fill-rebuild-integrity*
*Context gathered: 2026-06-21*
