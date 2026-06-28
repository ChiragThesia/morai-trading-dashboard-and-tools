# Phase 12: Streaming + TS Fan-Out - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-28
**Phase:** 12-streaming-ts-fan-out
**Areas discussed:** Stream auth, Live greeks source, Subscription lifecycle, Reconnect UX, Live scope, UI surfaces, Tick cadence, Stream lifecycle

---

## Stream Authentication

| Option | Description | Selected |
|--------|-------------|----------|
| Short-lived opaque ticket | POST with JWT → ~30s single-use ticket; EventSource uses ?ticket=. JWT never in URLs/logs | ✓ |
| JWT as query param | Simplest; JWT leaks into proxy/server logs + browser history | |
| httpOnly cookie | EventSource sends cookie; adds a cookie-session path vs current bearer JWT | |

**User's choice:** Short-lived opaque ticket
**Notes:** Matches the roadmap's preferred option (query-param JWTs leak into logs).

---

## Live Greeks Source

| Option | Description | Selected |
|--------|-------------|----------|
| Stream Schwab's LEVELONE greeks directly | Lowest latency; live numbers differ from journal's BSM | |
| Recompute via BSM per tick | Live matches journal methodology; adds compute + spot/rate inputs | ✓ |
| Schwab live + BSM on demand | Hybrid; more moving parts | |

**User's choice:** Recompute via BSM (free-text: "the live should always go through BSM right")
**Notes:** Whole app is BSM-derived; consistency with the journal matters more than raw latency. Live = journal math at streaming cadence.

---

## Subscription Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Dynamic — sub/unsub on fills | New position streams live immediately; closed legs drop | ✓ |
| Static per session | Fixed until restart/reconnect; new opens not live until reconcile | |

**User's choice:** Dynamic
**Notes:** —

---

## Reconnect / Stale-Data UX

| Option | Description | Selected |
|--------|-------------|----------|
| Freeze last values + 'stale' badge | Keep last greeks dimmed/badged; swap on reconcile | ✓ |
| Blank / spinner until fresh | Hide values during gap | |
| Keep last values, no indicator | Simplest; risks trusting stale numbers | |

**User's choice:** Freeze + stale badge
**Notes:** —

---

## Live Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Open position legs only (matches STRM-01) | Stream/BSM only currently-open legs | |
| Open legs + ad-hoc instrument lookup | Also stream any OCC symbol the user pulls up — EXCEEDS STRM-01 | ✓ |

**User's choice:** Open legs + ad-hoc — then, on the scope fork, **Expand Phase 12 now**
**Notes:** Operator chose to expand the phase rather than defer. STRM-01 must be amended + ROADMAP updated. Streaming foundation + dynamic-subscription make ad-hoc mechanically cheap; cost is the picker UI + relaxing the legs-only guard + 500-symbol-cap attention.

---

## UI Surfaces

| Option | Description | Selected |
|--------|-------------|----------|
| Positions / calendars view only | Live on open legs + ad-hoc surface; least wiring | ✓ |
| Positions + dedicated live panel | Always-on live strip | |
| Everywhere greeks render | Positions + journal row + GEX live | |

**User's choice:** Positions / calendars view only
**Notes:** —

---

## Tick Cadence

| Option | Description | Selected |
|--------|-------------|----------|
| Coalesce to ~1/sec per symbol | Smooth, low bandwidth | ✓ |
| ~250ms (4/sec) | Snappier, ~4x traffic | |
| Every tick (raw) | Max fidelity; can flood UI | |

**User's choice:** ~1/sec coalesced
**Notes:** —

---

## Stream Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Tear down after idle | Frees streamer session when 0 clients; cold-start reconcile covers correctness | |
| Keep warm during RTH | Stream held open in market hours regardless of viewers; instant first event | ✓ |

**User's choice:** Keep warm during RTH
**Notes:** Single-streamer advisory lock (GW-04) still guards a second session.

---

## Claude's Discretion

- SSE framing/format, ticket store, fan-out implementation, reconnect/backoff timing, BSM input plumbing.

## Deferred Ideas

- None to other phases (ad-hoc lookup pulled into scope, not deferred).
- 2 low-relevance general todos reviewed, not folded.
