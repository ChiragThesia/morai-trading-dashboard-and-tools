---
phase: 38
slug: live-spx-spot-across-the-app-fan-the-already-flowing-sidecar
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-13
---

# Phase 38 — Validation Strategy

Formalized from 38-RESEARCH.md's "Validation Architecture" section (plan-checker
blocker #1); requirement IDs are the LIVE-01..05 set minted at planning. Every plan's
`<verify>` provides the automated command referenced below.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (TS)** | Vitest (workspace: contracts/server/web) + Testing Library (web components) + testcontainers (STRM-04 no-persistence gate) |
| **Framework (sidecar)** | pytest + pytest-asyncio (`apps/sidecar`), `unittest.mock` AsyncMock/MagicMock for the schwab-py boundary — no live Schwab |
| **Quick run (TS)** | `bun run test -- --run <file>.test.ts` |
| **Quick run (sidecar)** | `cd apps/sidecar && .venv/bin/pytest tests/test_streamer.py -x` |
| **Full suite** | `bun run test` (TS workspace) + `.venv/bin/pytest` (from `apps/sidecar/`) |
| **Note** | jsdom honesty (catch #20): every live-value fixture uses a DELIBERATELY non-round literal distinct from any `gex.spot`/EOD/5800 fallback, so an assertion can only pass on the real live path. No log line prints token/response-body content (`type(exc).__name__` / `err.name` only). |

## Sampling Rate

- **Per task commit:** the touched layer's quick-run command above.
- **Per wave merge:** full `bun run test` + full sidecar `pytest`.
- **Phase gate (38-07):** both suites + `bun run typecheck` + `bun run lint` green;
  the phase's acceptance bar is the live RTH human UAT — the header SPX chip ticking
  ~1/sec + live regime gauges + honest quiet/stalled revert on morai.wtf.

## Per-Requirement Verification Map

| Requirement | Behavior validated | Test file / command | Test Type |
|-------------|--------------------|---------------------|-----------|
| LIVE-01 | `streamSpotEvent`/`streamIndicesEvent` parse a Z-suffixed frame, REJECT `+00:00`, accept per-symbol null; existing greek/ping schemas unchanged | `bun run test -- --run packages/contracts/src/stream-events.test.ts` (38-01) | Vitest unit |
| LIVE-02 | `broadcastSpot` fires at the guarded `observeSpot` tick site (zero new Schwab calls); a throwing callback never severs the stream; indices frame routes to `broadcastIndices` and returns early | `bun run test -- --run apps/server/src/adapters/http/sidecar-sse.test.ts` (38-03) | Vitest unit |
| LIVE-02 | On-change throttle: repeated spot value → flush no-op; changed value → one `"spot"` event ≤1/sec; dead-client cleanup carries to spot/indices lanes | `bun run test -- --run apps/server/src/adapters/http/stream-fan-out.test.ts` (38-03) | Vitest unit |
| LIVE-02 | STRM-04: the spot/indices lanes write zero `leg_observations` rows (pure in-memory) | `bun run test -- --run apps/server/src/adapters/http/strm04-regression.test.ts` (38-03) | Vitest + testcontainers |
| LIVE-03 | `start_indices_poll` emits one Z-suffixed `indices` frame per mocked `get_quotes`; a missing symbol → null for that field only; a `get_quotes` throw is swallowed and the loop continues; NO `is_rth` guard | `cd apps/sidecar && .venv/bin/pytest tests/test_streamer.py -x` (38-02 Task 2) | pytest (mocked market_client) |
| LIVE-03 | Exact Schwab VIX-family symbols + response shape confirmed live BEFORE the parser is built | 38-02 Task 1 `checkpoint:human-verify` (`get_quotes` smoke test) | human-verify |
| LIVE-04 | A `"spot"`/`"indices"` SSE event updates `liveSpot`/`liveIndices`; malformed frame dropped, last-good retained; spot has its OWN freshness stamp (never paints the greeks badge live) | `bun run test -- --run apps/web/src/hooks/useLiveStream.test.ts` (38-04) | Vitest/jsdom |
| LIVE-04 | Model engine `spot` is live-aware (live only while `status==="live"`), `displaySpot` is nullable (never 5800); `liveSpot`/`liveIndices` exposed | `bun run test -- --run apps/web/src/screens/overview-mobile/useOverviewModel.test.ts` (38-04, NEW renderHook) | Vitest/jsdom |
| LIVE-04 | Desktop SPX chip + GEX-rail markers + Key-levels "Spot" row (`keyLevelsFor(gex, spot)`) all render the live-aware spot; live tint only while live; `status:"quiet"` → EOD value | `bun run test -- --run apps/web/src/screens/Overview.test.tsx` (38-05 Task 1) | Vitest + Testing Library |
| LIVE-04 | Mobile hero SPX live-aware + honest tint; MobileMarketSection Key-levels "Spot" row reads `m.spot` | `bun run test -- --run apps/web/src/screens/overview-mobile/MobileHero.test.tsx apps/web/src/screens/overview-mobile/MobileMarketSection.test.tsx` (38-05 Task 2) | Vitest + Testing Library |
| LIVE-05 | The 3 broker-quotable gauges display live values with a client-recomputed band (`bandVixTermStructure`/`bandVvix`/`bandVix9dRatio`); GateChip + stored `indicator.band` + `hy-oas` untouched; footer reverts to "EOD · as of …" on quiet/stalled; per-symbol-null → that row stays EOD | `bun run test -- --run apps/web/src/components/RegimeBoard.test.tsx` (38-06 Task 1) | Vitest + Testing Library |
| LIVE-05 | MarketRail forwards `liveIndices`/`liveStatus` to RegimeBoard and never calls `useLiveStream` (D-06); RegimeBoard is memoized — an unchanged-`liveIndices` parent re-render does not re-render the rail (Pitfall 4) | `bun run test -- --run apps/web/src/screens/MarketRail.test.tsx apps/web/src/screens/Overview.test.tsx` (38-06 Task 2) | Vitest + Testing Library |
| LIVE-01..05 | Integration gate: full TS suite + sidecar pytest + typecheck + lint; deploy; live RTH UAT | 38-07 gate commands + human UAT | full suite + human-verify |

## Cross-Cutting Negative Assertions (every layer)

- **One SPX number:** `grep -n 'keyLevelsFor(gex)' Overview.tsx MobileMarketSection.tsx` returns
  NOTHING after 38-05 (every call passes the `spot` override — a bare `gex\??\.spot` grep cannot
  see the `keyLevelsFor(gex)` Spot-row read, so this is the gate that catches it), and no bare
  `gex.spot` read survives on the in-scope surfaces outside an honest-badge fallback (Pitfall 1).
- **Gate-EOD boundary:** `usePicker().gate` / GateChip, the stored `indicator.band` gate path, the
  `/api/analytics/regime` EOD source, and `hy-oas` are never fed live values (asserted in
  RegimeBoard.test.tsx); FRED ingestion / `getRegimeBoard.ts` untouched.
- **No silent stale-as-live:** live value/tint shown ONLY while `status==="live"`; never a
  `liveSpot ?? gex.spot` fallback (catch #26) — asserted in the hook, model, and consumer tests.
- **No RTH special-casing in the poll:** grep confirms no `is_rth`/`is_open` guard in
  `start_indices_poll` (Pitfall 6).
- **No second stream consumer:** grep confirms `MarketRail.tsx` has no `useLiveStream` import (D-06).

## Wave 0 Requirements

- [ ] `apps/web/src/screens/overview-mobile/useOverviewModel.test.ts` — NEW (renderHook harness,
  copies Overview.test.tsx's `vi.mock` hook block; 38-04). Every other test file already exists
  and is EXTENDED: stream-events.test.ts, stream-fan-out.test.ts, strm04-regression.test.ts,
  sidecar-sse.test.ts, useLiveStream.test.ts, Overview.test.tsx, MobileHero.test.tsx,
  MobileMarketSection.test.tsx, RegimeBoard.test.tsx, MarketRail.test.tsx, test_streamer.py.
- [ ] Framework install: none — Vitest and pytest are fully configured already (RESEARCH "Wave 0
  Gaps: None").

## Known Weaker Gate (accepted)

The React re-render guard (Pitfall 4, 38-06) is asserted via a render-count spy / memo-identity
check in MarketRail.test.tsx, not a real-browser profiler trace — jsdom cannot measure the
column-wide 1/sec repaint the profiler would. The memo-identity assertion is the constructible
proxy at the unit layer; the true confirmation is the 38-07 live RTH UAT (the rail must not visibly
churn at spot cadence).
