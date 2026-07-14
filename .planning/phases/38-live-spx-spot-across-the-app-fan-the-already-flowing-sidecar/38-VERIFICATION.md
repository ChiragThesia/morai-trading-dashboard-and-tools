---
phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar
verified: 2026-07-14T06:12:56Z
status: human_needed
score: 8/8 code-verifiable truths verified (2 live-RTH/deploy confirmations pending human)
behavior_unverified: 0
overrides_applied: 0
re_verification:
  # No — initial verification
human_verification:
  - test: "On morai.wtf during RTH, watch the desktop header SPX chip for ~30s"
    expected: "The SPX number ticks ~1/sec (matching the positions LIVE cadence), tinted live (text-blue) with the live dot; off-RTH or on quiet/stalled it reverts to the stale-styled EOD gex.spot (text-dim), never a frozen fabricated number and never 5800."
    why_human: "Real ~1/sec repaint cadence on the deployed browser cannot be measured in jsdom; market was closed at verification time. The on-change/live-vs-EOD state transitions themselves are unit-tested and pass — this confirms them end-to-end on the live wire."
  - test: "On morai.wtf during RTH, watch the regime rail's VIX / VVIX / VIX-term-structure / VIX9D-VIX gauges, then observe them again after RTH close (or force a quiet/stalled stream)"
    expected: "While live: the 3 broker-quotable gauges (vix-term-structure, vvix, vix9d-vix) show live values with a client-recomputed band tint and a 'LIVE' footer. On quiet/stalled: they revert to the EOD indicator.value and the 'EOD · as of …' footer. The entry-gate verdict chip and hy-oas never move with the live stream."
    why_human: "Live VIX-family values (~20s poll) and the live→EOD footer revert are runtime observations against the live sidecar; the display-live/gate-EOD boundary is unit-tested and passes, but real-wire confirmation needs an authenticated RTH session."
  - test: "Confirm the deployed prod images carry the Phase 38 code: sidecar (VIX poll) + server (spot/indices fan-out) on Railway, web on Vercel"
    expected: "The deployed sidecar runs start_indices_poll, the deployed server fans the 'spot'/'indices' SSE lanes, and morai.wtf serves the live-aware Overview + regime rail. Team lead reports this deployed 2026-07-13."
    why_human: "Railway/Vercel deploy state is operational and cannot be verified from the codebase. The 38-07 plan explicitly documented deploy notes but left execution to the orchestrator (commit ab0cde1 recorded the phase 'blocked at live RTH UAT')."
---

# Phase 38: Live market data via sidecar (SPX spot + VIX family) Verification Report

**Phase Goal:** The sidecar is the sole LIVE market-data source: SPX spot is fanned to every browser as an additive on-change SSE event (~1/sec, zero new Schwab calls) and drives every spot surface (header chip, payoff marker + T+0, gamma-profile marker, net greeks, mobile hero); the regime rail's VIX/VVIX/ratio gauges show live values via a ~20s sidecar poll — all with honest stale-fallback badges (catch #26) and the DISPLAY-LIVE/GATE-EOD LAW keeping every gate, crisis band, and hysteresis on the stored EOD macro_observations.

**Verified:** 2026-07-14T06:12:56Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

Every requirement-level and integration-level truth is verified in the codebase AND
confirmed by a passing behavioral test run (I re-ran the phase's suites myself — see
Behavioral Spot-Checks). The two remaining items are live-market observations (the ~1/sec
header cadence and live regime values during RTH) plus the operational deploy confirmation
— all three pre-classified by the team lead as human-verification items, not gaps, because
the market was closed at verification time and deploy state is not codebase-observable.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **LIVE-01** Additive contract: `streamSpotEvent {spot, ts}` + `streamIndicesEvent {vix,vvix,vix9d,vix3m, ts}`, each `ts` Z-required / `+00:00`-rejected, indices fields nullable; `streamLiveGreekEvent`/`streamPingEvent` unchanged | ✓ VERIFIED | `packages/contracts/src/stream-events.ts:107,124` — both `z.string().datetime()`; test 32/32 pass incl. `+00:00` reject for both events + existing-schema-unchanged cases |
| 2 | **LIVE-02** SPX spot fanned as named `spot` SSE event, ZERO new Schwab calls (reuses arriving `underlyingPrice`), on-change ≤1/sec, malformed/throwing frame never severs the stream, zero `leg_observations` writes | ✓ VERIFIED | `sidecar-sse.ts:336` broadcastSpot at same guarded `underlyingPrice>0` site as observeSpot (swallow-and-log); `stream-fan-out.ts:144` flushSpot on-change throttle; tests 49/49 + STRM-04 4/4 (testcontainers, real Postgres) pass |
| 3 | **LIVE-03** Sidecar polls `$VIX/$VVIX/$VIX9D/$VIX3M` via `get_quotes` on fixed ~20s interval, NO `is_rth` guard, per-symbol failure tolerated, one Z-suffixed `indices` frame per poll onto `event_queue`; symbols confirmed live before parser built | ✓ VERIFIED | `streamer.py:516` start_indices_poll (INDICES_POLL_INTERVAL_S=20.0, no RTH gate), `_extract_last_price` degrades to None; `main.py:208` lifecycle wired; 38-A1-PROBE.md confirmed live 2026-07-13 RTH; pytest 38/38 pass |
| 4 | **LIVE-04** `useLiveStream` exposes `liveSpot`/`liveIndices` on their OWN freshness stamp (spot-only feed never paints greeks badge live); every spot surface (header chip, payoff+T+0, gamma-profile marker, net greeks, mobile hero, both Key-levels rows) reads ONE live-aware seam; honest badge — live only while `status==='live'`, never `liveSpot ?? gex.spot`, header/hero never 5800 | ✓ VERIFIED | `useLiveStream.ts:282,290,292` own `lastSpotAtRef` + Zod safeParse; `useOverviewModel.ts:449,451` live-gated `spot`/`displaySpot`; consumers wired (Overview.tsx header/markers, MobileHero, MobileMarketSection); no bare `keyLevelsFor(gex)` remains; web tests 187/187 pass |
| 5 | **LIVE-05** DISPLAY-LIVE/GATE-EOD: 3 broker-quotable gauges show live value + client-recomputed band while live; entry-gate chip, stored `indicator.band`, `/api/analytics/regime` EOD source and `hy-oas` untouched; quiet/stalled reverts to EOD value + 'EOD · as of…' footer; MarketRail never calls `useLiveStream` (D-06); RegimeBoard memoized (Pitfall 4) | ✓ VERIFIED | `RegimeBoard.tsx:612-617` live gated on `liveStatus==='live'`, `664` `memo(RegimeBoardImpl)`, banders from `@morai/core`; `MarketRail.tsx:75` forwards props, no hook call; RegimeBoard.test.tsx Phase-38 block (live/EOD-revert/gate-isolation/per-symbol-null) + MarketRail.test.tsx (forward/no-hook/memo) pass |
| 6 | **Integration gate:** full TS workspace suite + sidecar pytest green, root typecheck + lint clean | ✓ VERIFIED | 38-07-SUMMARY D1: 3490 TS tests / 93 pytest / typecheck+lint pass; I independently re-ran all phase suites (310 tests across contracts/server/sidecar/web) — all green |
| 7 | During RTH the header SPX chip moves ~1/sec matching the positions LIVE cadence, on the deployed site | ⚠ HUMAN | Real repaint cadence not measurable in jsdom; market closed at verify time — the underlying state transitions are unit-tested + pass |
| 8 | New sidecar (poll) + server (fan-out) images deployed to Railway; web on Vercel | ⚠ HUMAN | Operational, not codebase-observable; team lead reports deployed 2026-07-13; 38-07 documented deploy notes, orchestrator executes |

**Score:** 6/8 truths verified in code with passing tests; 2 routed to human verification (live-RTH observation + deploy confirmation). All 5 requirement contracts (LIVE-01..05) are fully code-verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/contracts/src/stream-events.ts` | streamSpotEvent + streamIndicesEvent + types | ✓ VERIFIED | Both schemas present, Z-required ts, nullable indices; existing schemas untouched; imported+safeParsed in useLiveStream |
| `apps/sidecar/streamer.py` | start_indices_poll + interval + parser | ✓ VERIFIED | start_indices_poll, INDICES_POLL_INTERVAL_S=20.0, _extract_last_price/_build_indices_frame; put_nowait onto event_queue |
| `apps/sidecar/main.py` | indices_poll_task lifecycle | ✓ VERIFIED | create_task in both init paths (lines 208, 283), cancel + cleanup on shutdown |
| `apps/server/.../stream-fan-out.ts` | bufferSpot/flushSpot + bufferIndices/flushIndices on 1s interval | ✓ VERIFIED | On-change throttle (value + serialized-snapshot equality), dead-client cleanup, one startFlushInterval drives all lanes, no Postgres import |
| `apps/server/.../sidecar-sse.ts` | broadcastSpot at observeSpot site + indices branch → broadcastIndices | ✓ VERIFIED | dispatchFrame: indices parsed first (early return), broadcastSpot sibling to observeSpot, both swallow-and-log |
| `apps/server/src/main.ts` | broadcastSpot/broadcastIndices wired | ✓ VERIFIED | Lines 679-680 wire to bufferSpot/bufferIndices; startFlushInterval() at 645 |
| `apps/web/src/hooks/useLiveStream.ts` | liveSpot/liveIndices + listeners + own freshness ref | ✓ VERIFIED | State + `spot`/`indices` addEventListener with safeParse + own lastSpotAtRef; malformed → drop, retain last-good |
| `apps/web/.../useOverviewModel.ts` | live-aware spot + displaySpot + keyLevelsFor override | ✓ VERIFIED | spot (line 449) + displaySpot (451) live-gated; keyLevelsFor(gex, spot?) optional override; railGreeks/scenario/payoff consume live spot |
| `apps/web/src/screens/Overview.tsx` | header chip + GEX markers read displaySpot/spot | ✓ VERIFIED | PillHeader displaySpot ("—" when null, live tint), GammaProfile+GexByStrike spot={spot}, keyLevelsFor(gex, spot), MarketRail props |
| `apps/web/.../MobileHero.tsx` | SPX segment live-aware honest tint | ✓ VERIFIED | spot: number\|null, liveStatus gate, "—" when null, never 5800 |
| `apps/web/src/components/RegimeBoard.tsx` | live display + client band recompute for 3 rows | ✓ VERIFIED | liveValueFor + LIVE_BAND_FNS, live gated on status, memo-wrapped export |
| `apps/web/src/screens/MarketRail.tsx` | forwards liveIndices/liveStatus, no hook | ✓ VERIFIED | Props forwarded to RegimeBoard; only a `type` import of useLiveStream, never a call |
| `docs/architecture/stack-decisions.md` | D27 live-market flow + display-live/gate-EOD law | ✓ VERIFIED | D27 section records full flow + the LAW; decision table row present |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| stream-events.ts | useLiveStream.ts | streamSpotEvent/streamIndicesEvent safeParse per frame | ✓ WIRED |
| streamer.py | stream_proxy (event_queue) | put_nowait({type:'indices',...}) | ✓ WIRED |
| main.py | streamer.py | create_task(start_indices_poll(app)) both init paths | ✓ WIRED |
| sidecar-sse.ts | stream-fan-out.ts | main.ts wires broadcastSpot/Indices → bufferSpot/Indices | ✓ WIRED |
| stream-fan-out.ts | useLiveStream.ts | named 'spot'/'indices' SSE events consumed by addEventListener | ✓ WIRED |
| useLiveStream.ts | useOverviewModel.ts | destructures liveSpot/liveIndices; live-aware spot seam | ✓ WIRED |
| useOverviewModel.ts | Overview.tsx | displaySpot/spot/liveStatus → PillHeader + GexRail; keyLevelsFor(gex, spot) | ✓ WIRED |
| useOverviewModel.ts | MobileHero / MobileMarketSection | m.displaySpot → hero; m.spot → keyLevelsFor(gex, spot) | ✓ WIRED |
| useOverviewModel.ts | MarketRail.tsx | Overview passes liveIndices/liveStatus; MarketRail forwards to RegimeBoard | ✓ WIRED |
| RegimeBoard.tsx | @morai/core | bandVixTermStructure/bandVvix/bandVix9dRatio recompute live band | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| Overview header chip | displaySpot | model live-gated seam ← liveSpot (SSE) or gex.spot (query) | Yes (live SSE or EOD query; null→"—") | ✓ FLOWING |
| RegimeBoard gauges | liveValue | liveIndices (SSE) gated on status, else indicator.value (regime query) | Yes (live poll or EOD; per-symbol null→that row EOD) | ✓ FLOWING |
| MobileHero SPX | spot (displaySpot) | model live-gated seam | Yes (never 5800; null→"—") | ✓ FLOWING |
| Key-levels Spot rows | keyLevelsFor(gex, spot) | live-aware spot override | Yes (override threads live spot at both call sites) | ✓ FLOWING |

The live cadence itself (data arriving ~1/sec during RTH) is the human item — the wiring
that carries it is proven; the wire only carries real data during an authenticated RTH session.

### Behavioral Spot-Checks

Re-ran the phase's own suites in-process (not trusting SUMMARY claims). All green.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| LIVE-01 contract (Z/+00:00, nullable, unchanged) | `bun run test -- --run packages/contracts/.../stream-events.test.ts` | 32/32 | ✓ PASS |
| LIVE-02 fan-out + dispatch (on-change, sever-safety) | `bun run test -- --run .../stream-fan-out.test.ts .../sidecar-sse.test.ts` | 49/49 | ✓ PASS |
| LIVE-02 STRM-04 zero leg_observations (testcontainers) | `bun run test -- --run .../strm04-regression.test.ts` | 4/4 (real Postgres) | ✓ PASS |
| LIVE-03 sidecar poll (null-tolerance, swallow, Z, no-RTH) | `.venv/bin/pytest tests/test_streamer.py` | 38/38 | ✓ PASS |
| LIVE-04/05 hook + model + consumers + regime | `bun run test -- --run useLiveStream/useOverviewModel/RegimeBoard/MarketRail/MobileHero/MobileMarketSection/Overview` | 187/187 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| LIVE-01 | 38-01 | Additive spot + indices stream contract (Z-suffix) | ✓ SATISFIED | Truth 1 |
| LIVE-02 | 38-03 | SPX spot fanned, zero new Schwab calls, on-change | ✓ SATISFIED | Truth 2 |
| LIVE-03 | 38-02 | Sidecar VIX-family ~20s poll, no RTH gate | ✓ SATISFIED | Truth 3 |
| LIVE-04 | 38-04, 38-05 | useLiveStream liveSpot/liveIndices + every spot surface live-aware, honest badge | ✓ SATISFIED | Truth 4 |
| LIVE-05 | 38-06 | DISPLAY-LIVE/GATE-EOD regime gauges | ✓ SATISFIED | Truth 5 |

All 5 requirement IDs accounted for; each is claimed by a plan's `requirements:` frontmatter
and verified. No ORPHANED requirements (REQUIREMENTS.md maps only LIVE-01..05 to Phase 38,
all claimed). 38-07 declares LIVE-01..05 as the integration-gate cross-check.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/HACK/PLACEHOLDER in any modified production file | — | None (debt-marker gate PASS) |

One deliberate `ponytail:` simplification comment in stream-fan-out.ts (value-equality
throttle, no epsilon) and one in RegimeBoard.tsx (GAUGE_SCALE fallback) — both are
intentional, documented shortcuts with stated ceilings, not debt markers.

**Informational (not a Phase 38 gap):** 38-07-SUMMARY discloses 8 residual errors under
apps/web's own strict `tsc --noEmit` — a gate NOT covered by root `bun run typecheck` because
apps/web is outside the root project references. The tsc errors introduced by Phase 38's own
files (38-04/38-06) were cleared (commit b81eab3); the 8 residual errors are pre-existing debt
in unrelated files (+ one 22-call-site test helper). Root typecheck + lint — the project's
actual gate — are clean. This is disclosed standing debt, not a regression from this phase.

### Human Verification Required

Three items — all live-market/operational, pre-classified by the team lead as human items
(the market was closed at verification time; deploy state is not codebase-observable). Every
underlying behavior they confirm is already unit/integration-tested and passing.

1. **Header SPX chip live cadence (RTH)** — On morai.wtf during RTH, the desktop header SPX
   chip ticks ~1/sec (live-tinted, live dot), and reverts to the stale-styled EOD gex.spot on
   quiet/stalled or off-RTH. Never frozen-fabricated, never 5800.

2. **Regime rail live values + EOD revert (RTH)** — The vix-term-structure / vvix / vix9d-vix
   gauges show live values with client-recomputed band tint + 'LIVE' footer while live, and
   revert to EOD value + 'EOD · as of…' footer on quiet/stalled. The entry-gate chip and
   hy-oas never move with the live stream.

3. **Deploy confirmation** — Sidecar (VIX poll) + server (spot/indices fan-out) live on
   Railway, web on Vercel. Team lead reports deployed 2026-07-13.

### Gaps Summary

No gaps. All five requirement contracts (LIVE-01..05) and the integration gate are verified in
the codebase with passing behavioral tests that I re-ran independently. Every key link is
wired, every artifact is substantive and data flows through it, no debt markers, no blocker
anti-patterns. The phase goal is achieved in code; what remains is live-RTH visual
confirmation and deploy sign-off, which by nature require a human on the deployed site during
market hours — the reason the status is `human_needed` rather than `passed`.

---

_Verified: 2026-07-14T06:12:56Z_
_Verifier: Claude (gsd-verifier)_
