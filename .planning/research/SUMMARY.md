# Project Research Summary

**Project:** Morai — Trading Dashboard & Tools
**Domain:** Real-time brokerage data integration (Schwab options) for a self-hosted trading journal
**Researched:** 2026-06-25
**Confidence:** MEDIUM

## Executive Summary

Milestone v1.1 makes a single Python **schwab-py sidecar** the sole Schwab boundary — it owns
OAuth, the token lifecycle, all Schwab REST calls, and the one allowed streamer websocket. This
fixes the 30-min access-token staleness (schwab-py auto-refreshes), adds a real-time live-positions
feed (marks, per-leg greeks, fills), and re-sources the existing 30-min snapshot journal through the
sidecar. COT positioning and an expanded FRED macro layer are added as auth-free TS adapters. UI
panels are deferred to a separate UI-rebuild milestone — v1.1 ships data/backend/contracts + a live
stream the future UI consumes.

The keystone finding: schwab-py v1.5.1 exposes `client_from_access_functions` with custom
token read/write callbacks, so the sidecar reads and writes the **existing `broker_tokens` Postgres
row** — no schema change, no token file volume, and a clean single-owner of Schwab auth. This
directly resolves the user's hard constraint ("I don't want two things to maintain for auth"):
there is exactly **one** auth burden (Schwab's weekly OAuth re-login, a server-side hard limit no
client escapes). CBOE and COT are auth-free; FRED is a set-once free key. No external data vendor
(and no second auth) is introduced.

The main risks are all sequencing/ops, not feasibility: the **dual-refresher rotating-token race**
(Schwab invalidates the old refresh token on each refresh, so the TS daily job must be retired
*before* the sidecar goes active), the **7-day headless re-auth** (no browser on Railway — needs an
operator manual-flow workflow + a T-24h alert or it's a silent weekly outage), and the **one-session
-per-account** streamer limit (a second login kills the first — needs a Postgres advisory lock to
survive Railway redeploys). The full SPX chain **cannot** be streamed (~500-symbol cap vs
2,000–5,000 contracts), so streaming is scoped to position legs only and GEX/journal stay
REST-snapshot jobs.

## Key Findings

### Recommended Stack

A minimal Python sidecar (`apps/sidecar/`) wrapping schwab-py, deployed as a 3rd Railway service via
its own Dockerfile. It exposes a REST proxy + an SSE stream to the TS server only (never
internet-reachable). COT and FRED stay in the existing TS hexagon. Detail: `STACK.md`.

**Core technologies:**
- **schwab-py v1.5.1** (Python ≥3.10, MIT, actively maintained): Schwab OAuth + REST + StreamClient — the reason to go Python; hand-rolling the streamer in TS is the pain we're avoiding.
- **`client_from_access_functions` + Postgres token callbacks**: sidecar reads/writes the existing `broker_tokens` row — sole token owner, no schema change.
- **FastAPI + uvicorn + sse-starlette**: minimal async sidecar that can bridge schwab-py's asyncio StreamClient to SSE (Flask cannot without threading hacks).
- **`cot-reports` v0.1.3** (no auth): CFTC COT fetch, TFF report, E-mini S&P 500 filter — a weekly TS worker job, not a sidecar concern.
- **FRED (existing TS adapter)**: expand series only (DFF, DGS3MO, DGS1MO, SOFR, T10Y2Y, T10Y3M, VIXCLS) + set the unset prod key. VVIX is NOT on FRED → source from the existing CBOE adapter.

### Expected Features

Detail: `FEATURES.md`.

**Must have (table stakes):**
- Live positions feed — marks + per-leg greeks (LEVELONE_OPTION fields 28–32) + IV (VOLATILITY field 10) + fills (ACCT_ACTIVITY), streamed for position legs only.
- Journal re-sourced through the sidecar (REST chain snapshot job, unchanged cadence ~30 min — chain can't stream).
- One Schwab auth, weekly re-auth smoothed (alert + one-click/operator re-auth).

**Should have (competitive):**
- COT weekly positioning context (regime, not a timing signal; store `as_of` Tue separately from `published_at` Fri).
- Expanded FRED macro layer (short rate / curve spread / VIX) for an SPX options trader.
- Event-triggered supplemental journal snapshot on large underlying moves (P2 — depends on the live stream).

**Defer (v2+ / separate milestone):**
- All visual UI panels (macro, COT, live positions) — separate UI-rebuild milestone.
- External historical-options vendor feed — **rejected**: paid + a second auth; self-collection wins.

**Definitive verdict — historical option data:** Schwab offers **NO** historical option chains/greeks
(the chain endpoint's fromDate/toDate filters *expirations*, not observation dates; price-history is
equities/indices only). Every external vendor (ORATS $99+/mo, Polygon $29+/mo, CBOE DataShop ~$380/mo
+ separate SPX license, Databento $199/mo with no greeks) is paid and a separate auth. **Self-collection
forward (journal, since Jun-12) is the chosen answer** — zero incremental cost, and vendor greeks
wouldn't match Morai's own BSM anyway. No closed trade needs backfill.

### Architecture Approach

The hexagon is untouched: all six brokerage ports (`ForFetchingChain`, `ForFetchingPositions`,
`ForFetchingTransactions`, `ForFetchingOrders`, `ForResolvingAccountHash`, `ForReadingTokens`) keep
their signatures; only the TS adapter implementations change — the sidecar becomes the HTTP target.
Detail: `ARCHITECTURE.md`.

**Major components:**
1. **Python sidecar (`apps/sidecar/`)** — sole Schwab auth owner; full-proxy of Schwab REST (issues the call itself, eliminating the stale-token window); one streamer websocket; SSE stream + REST proxy to the TS server only.
2. **TS server fan-out (`apps/server`)** — consumes the sidecar's single SSE stream and multiplexes to N browsers over `GET /api/stream` (Hono `streamSSE`); Supabase JWT (JWKS ES256) verified at this edge; browser passes JWT as an EventSource query param.
3. **TS Schwab adapters (`packages/adapters`)** — become thin HTTP clients to the sidecar's REST proxy; existing REST-snapshot jobs (chain/journal) call the sidecar instead of Schwab.
4. **COT + FRED adapters (`packages/adapters/src/http`)** — auth-free; COT = new `fetch-cot` weekly job (Fri 18:00 ET) + `cot_observations` table; FRED = extend `fetch-rates` series list.

**Stream vs journal are parallel paths:** the stream is **display-only** (no per-tick Postgres writes,
in-memory last-known-value); `sync-transactions` (REST) stays the authoritative fill source; the
journal stays a REST-snapshot job. Cold-start/gap-fill = REST reconcile on (re)connect.

### Critical Pitfalls

Top items from `PITFALLS.md`:

1. **Dual-refresher rotating-token race** — Schwab invalidates the old refresh token on each refresh; the TS daily job + sidecar racing → `invalid_grant` within one 30-min cycle. **Avoid:** a dedicated auth-migration phase that removes the TS refresh job *before* the sidecar goes active. One owner, always.
2. **7-day headless re-auth** — no browser on Railway. **Avoid:** operator runs `client_from_manual_flow` locally, the token_write callback persists to Postgres, the sidecar picks it up; add a T-24h expiry alert + a `/sidecar/reauth` endpoint or the first weekly expiry is a silent outage. Confirm CBOE fallback works before go-live.
3. **One streamer session per account** — a second `login()` (restart, retry, redeploy overlap) instantly kills the first. **Avoid:** a Postgres advisory lock so only one sidecar instance streams.
4. **Streaming the full chain** — ~500-symbol cap → silent drops. **Avoid:** stream position legs only (2–30 symbols); GEX stays a REST-snapshot batch job.
5. **Don't regress 4 known Morai gotchas** — SPX OI=0/SPY proxy (~10.048×), CBOE UTC timestamps, GEX put-sign, 65,534-param insert chunking — keep their property tests as non-negotiable regression gates.

## Implications for Roadmap

Suggested phase structure (continues numbering from v1.0 → **Phase 10+**):

### Phase 10: Stack-Decisions Doc Update
**Rationale:** Docs-before-code rule — adding Python is an architecture change. Unblocks everything.
**Delivers:** `stack-decisions.md` entries: D16 (TS OAuth client) superseded, D17 (streaming deferred) lifted, new decision for the Python sidecar as a 3rd Railway service.
**Avoids:** undocumented architecture drift (workflow rule violation).

### Phase 11: Sidecar Scaffold + Auth Migration
**Rationale:** Everything depends on the sidecar being the sole Schwab gateway; the auth migration is blocking and must precede streaming. Hardest phase.
**Delivers:** `apps/sidecar/` (FastAPI + schwab-py + Postgres token callbacks), Python CI lanes, Railway service; TS refresh job retired FIRST, sidecar refresher second; advisory lock; reconnect policy; CBOE fallback confirmed.
**Uses:** schwab-py `client_from_access_functions`, existing `broker_tokens` table.
**Avoids:** dual-refresher race (#2 above).

### Phase 12: Streaming + TS Server Fan-Out
**Rationale:** Requires a stable sidecar. Adds the live feed.
**Delivers:** LEVELONE_OPTION (position legs) + ACCT_ACTIVITY ingestion, StreamManager + SSE fan-out, `GET /api/stream` with JWT at the edge, Zod stream contracts, backpressure + write-amplification guard.
**Implements:** components 1–2 above.

### Phase 13: COT Adapter
**Rationale:** Independent of the sidecar — parallel-able with Phase 14.
**Delivers:** `cot-reports` fetch, `cot_observations` table (as_of vs published_at), weekly `fetch-cot` job, API/MCP read surface.

### Phase 14: FRED Expansion
**Rationale:** Independent of the sidecar — parallel-able with Phase 13. Minimal effort.
**Delivers:** set prod `FRED_API_KEY`, add series (DFF/DGS3MO/DGS1MO/SOFR/T10Y2Y/T10Y3M/VIXCLS), VVIX via CBOE adapter.

### Phase 15: 7-Day Re-Auth Smoothing
**Rationale:** Depends on the sidecar (`/health`, `/sidecar/reauth`).
**Delivers:** T-24h expiry alert, one-click/operator re-auth flow, operator runbook.

### Phase Ordering Rationale

- Docs → sidecar/auth → streaming is a strict dependency chain (each needs the prior).
- COT (13) and FRED (14) have zero sidecar dependency and can run in parallel with each other / the streaming work.
- Re-auth smoothing (15) is last because it consumes the sidecar's health + reauth endpoints.
- The auth migration is isolated into its own phase precisely so the dual-refresher race is closed before any streaming work begins.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 11:** Railway private networking config for sidecar↔server (private network vs public URL).
- **Phase 12:** ACCT_ACTIVITY `MESSAGE_TYPE` values (empirical — not publicly documented); EventSource JWT-query-param vs opaque-ticket/cookie security choice.
- **Phase 13:** exact CFTC COT DataFrame column names for the schema.

Phases with standard patterns (skip research-phase):
- **Phase 10** (doc edit), **Phase 14** (FRED series add + env var), **Phase 15** (alert + endpoint — established patterns).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | schwab-py version/methods/streamer fields verified vs PyPI + readthedocs + source; 500-symbol cap from community ref, not official portal |
| Features | HIGH | Historical-options verdict definitive from official docs; vendor pricing from marketing pages (MEDIUM); COT/FRED structural facts HIGH |
| Architecture | MEDIUM | Hexagon boundary HIGH (codebase read); auth-migration sequence + gap-fill are first-principles/industry-standard, no schwab-py-specific prior art |
| Pitfalls | HIGH | Auth/token mechanics + streamer session limit confirmed across docs + multiple community integrations; Morai gotchas are first-party history |

**Overall confidence:** MEDIUM

### Gaps to Address

- **500-symbol streamer cap exact source:** confirm on the Schwab Developer Portal during Phase 11; scope subscriptions to legs-only regardless (safe under any cap).
- **ACCT_ACTIVITY message-type values:** discover empirically once the sidecar runs (Phase 12); don't hard-code from assumption.
- **Railway private networking:** verify at Phase 11 infra setup (prefer private network, no egress cost).
- **EventSource JWT-as-query-param vs opaque ticket:** security decision in Phase 12 (query-param JWTs leak into logs — prefer a short-lived ticket if cheap).
- **CFTC COT column names:** confirm before writing the `cot_observations` schema (Phase 13).

## Sources

### Primary (HIGH confidence)
- schwab-py readthedocs (auth, client, streaming) — token callbacks, REST methods, LEVELONE_OPTION field numbers, historical-options limitation
- CFTC publicreporting.cftc.gov + official COT schedule — report types, E-mini S&P code, Tue-data/Fri-release lag
- fred.stlouisfed.org — series existence (DFF/DGS*/SOFR/T10Y2Y/T10Y3M/VIXCLS); VVIX absence
- Morai codebase (brokerage ports, broker_tokens schema, existing jobs) + project history (Phase 2 lessons, tos-studies, MEMORY.md)

### Secondary (MEDIUM confidence)
- schwab-client-js DeveloperReference — 500-symbol streamer cap
- QuantConnect / Schwabdev community integrations — one-session-per-account behavior
- Vendor marketing pages (ORATS, Polygon, CBOE DataShop, Databento) — historical-options pricing tiers
- FastAPI docs + sse-starlette PyPI; Hono `streamSSE` docs — SSE topology

### Tertiary (LOW confidence)
- Community code examples — COT DataFrame filter strings, ACCT_ACTIVITY message structure (validate empirically)

---
*Research completed: 2026-06-25*
*Ready for roadmap: yes*
