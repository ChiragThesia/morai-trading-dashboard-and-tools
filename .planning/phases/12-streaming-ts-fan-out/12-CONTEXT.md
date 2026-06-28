# Phase 12: Streaming + TS Fan-Out - Context

**Gathered:** 2026-06-28
**Status:** Ready for planning

<domain>
## Phase Boundary

The sidecar opens a single Schwab streamer session and streams live `LEVELONE_OPTION`
(mark, bid/ask, IV) + `ACCT_ACTIVITY` (fill) events; `apps/server` fans that one stream out
to N browser clients over an authed `GET /api/stream` (Supabase JWT verified at the edge);
the browser shows live greeks (recomputed via BSM) for open calendar legs, with cold-start /
reconnect reconciled via a REST pull. Display-only — no per-tick Postgres writes (STRM-04);
`sync-transactions` (REST) stays the authoritative fill source.

**SCOPE EXPANSION (operator decision, 2026-06-28):** Phase 12 now also covers **ad-hoc
instrument lookup** — streaming + BSM for any OCC symbol the user pulls up, not just open
position legs. This **exceeds the locked STRM-01 text ("open position legs only")**. STRM-01
must be amended (or a new requirement added) and ROADMAP.md Phase 12 updated to reflect this
before/at planning. See D-05.
</domain>

<decisions>
## Implementation Decisions

### Stream Authentication (STRM-03)
- **D-01:** `GET /api/stream` authenticates via a **short-lived, single-use opaque ticket**,
  not a query-param JWT. Client POSTs (with its Supabase JWT, verified at the server edge as
  today) to mint a ~30s ticket; EventSource connects with `?ticket=…`. Rationale: EventSource
  can't send `Authorization` headers, and a query-param JWT leaks into server/proxy access
  logs and browser history. The ticket carries no secret and expires fast.

### Live Greeks Source (STRM-01)
- **D-02:** Live greeks/IV are **recomputed via the `@morai/quant` BSM engine** from the
  streamed mark (+ spot + rate), NOT taken from Schwab's raw `LEVELONE` greeks. Rationale:
  the entire app (journal, GEX, analytics) is BSM-derived; showing Schwab's raw greeks would
  put *different numbers* on the live view than the journal shows for the same leg. Live = the
  journal's math at streaming cadence. STRM-04 is unaffected (compute, not persistence).

### Subscription Lifecycle (STRM-01, STRM-02)
- **D-03:** The subscription set is **dynamic** — on an `ACCT_ACTIVITY` fill that opens a new
  leg, subscribe it; when a leg closes, unsubscribe it. A newly opened position streams live
  immediately without a restart. (Plus ad-hoc symbols per D-05.)

### Reconnect / Stale-Data UX (STRM-05)
- **D-04:** On a stream drop/reconnect, the browser **freezes the last values and shows a
  'stale' badge**, then swaps to fresh data when the reconcile REST pull lands. No data loss,
  no false confidence in stale numbers.

### Live Scope (expands STRM-01)
- **D-05:** Live streaming covers **open position legs AND ad-hoc instrument lookup** (any OCC
  symbol the user enters/selects). Needs an instrument-picker UI and relaxes the "legs-only"
  subscription guard. **This expands STRM-01** — update REQUIREMENTS.md + ROADMAP.md. Watch the
  500-symbol streamer cap (research note) now that the symbol set is user-driven, not just legs.

### UI Surfaces
- **D-06:** Live data renders on the **Positions / calendars view only** (live greeks/marks/P&L
  on open legs + the ad-hoc lookup surface). Not wired into the journal row or GEX this phase.

### Update Cadence
- **D-07:** Updates to the browser are **coalesced to ~1/sec per symbol** (not raw passthrough).
  Greeks don't need sub-second refresh; one update/sec/leg keeps the UI smooth and bandwidth low.

### Stream Lifecycle
- **D-08:** The Schwab stream is **kept warm during RTH** (held open in market hours regardless
  of connected viewers), rather than torn down when zero clients are connected. Instant first
  event; the single-streamer advisory lock (GW-04) still guards against a second session.

### Claude's Discretion
- SSE framing/format, ticket store (in-memory vs Postgres), fan-out implementation (in-process
  pub/sub), reconnect/backoff timing, and the exact BSM input plumbing are implementation
  details for research + planning.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + requirements
- `.planning/ROADMAP.md` § "Phase 12: Streaming + TS Fan-Out" — goal, success criteria, research flags, cross-cutting display-only constraint
- `.planning/REQUIREMENTS.md` — STRM-01..05 (note STRM-01 scope expansion per D-05)

### Architecture decisions
- `docs/architecture/stack-decisions.md` — D17 (streaming scoped to account/position legs, 500-symbol cap), D22 (schwab-py sidecar as 3rd Railway service)

### Existing sidecar (the streamer host — extend, don't rebuild)
- `apps/sidecar/main.py` — FastAPI lifespan: advisory-lock acquire → schwab clients → keep-alive/heartbeat (Phase 11 + this session)
- `apps/sidecar/advisory_lock.py` — GW-04 single-writer/single-streamer guard (`pg_try_advisory_lock(8876543210)`); login() must hold this before opening the stream
- `apps/sidecar/token_store.py` — dual-write token callbacks; the trader-token keep-alive (this session) keeps `/sidecar/positions` reconcile auth fresh
- `apps/sidecar/chain_proxy.py` — REST proxy pattern + the Zod-`.datetime()` `Z` contract (mirror this for any new sidecar→TS payload)

### Contracts + compute
- `packages/contracts/src/live-greeks.ts` — the `liveGreeks` Zod contract STRM-01 fields map to
- `packages/quant/src/bsm.ts` — BSM engine for live greek recompute (D-02)

### Server edge auth (the JWT-verify pattern to reuse for ticket minting)
- `apps/server/src/adapters/http/supabase-auth.ts` — Supabase JWT verify at the edge (Phase 8 JWKS ES256/HS256)

### Positions path (reconcile source — STRM-05)
- `packages/adapters/src/schwab/trader/positions-adapter.ts` + `apps/server/src/main.ts` (traderGetAccessToken) — current server-direct positions; STRM-05's `/sidecar/positions` reconcile endpoint is new this phase
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@morai/quant` BSM engine (`packages/quant/src/bsm.ts`): live greek recompute (D-02)
- Supabase JWT edge-verify (`supabase-auth.ts`): reuse for the ticket-mint endpoint's auth gate
- Sidecar advisory lock: already enforces single-streamer (GW-04) — streamer `login()` reuses it
- Trader-token keep-alive (this session): keeps the trader token fresh for `/sidecar/positions`
- `chain_proxy.py` payload shape + the Zod `.datetime()` `Z` lesson: any new sidecar→TS stream/positions payload must emit `Z`, not `+00:00`

### Established Patterns
- Hexagonal: stream port (`ForStreamingQuotes`-style) in core, sidecar/SSE in adapters
- Sidecar = sole Schwab boundary (GW-01); the streamer lives here, server only fans out
- Display-only constraint (STRM-04): no per-tick `leg_observations` writes — regression gate

### Integration Points
- Sidecar streamer → sidecar SSE/internal endpoint → server `GET /api/stream` fan-out → browser EventSource
- `ACCT_ACTIVITY` fills → dynamic (un)subscribe (D-03) + still flow to `sync-transactions` REST as authoritative
- Web Positions/calendars view (`apps/web`) consumes the SSE stream (D-06)
</code_context>

<specifics>
## Specific Ideas

- Operator intent for "live": monitor your own open calendars AND evaluate prospective ones via
  ad-hoc lookup (D-05) — the live view is the journal's BSM math, in real time.
</specifics>

<deferred>
## Deferred Ideas

- None deferred to other phases — the one scope question (ad-hoc lookup) was pulled INTO Phase 12
  per operator decision (D-05), not deferred.

### Reviewed Todos (not folded)
- 2 pending todos matched at low relevance (`general`, score 0.6) — `over-engineering-cleanup`
  and one other; both are cleanup, not streaming. Not folded into Phase 12.
</deferred>

---

*Phase: 12-streaming-ts-fan-out*
*Context gathered: 2026-06-28*
