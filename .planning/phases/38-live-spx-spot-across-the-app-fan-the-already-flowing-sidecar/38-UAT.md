---
status: testing
phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar
source: [38-VERIFICATION.md]
started: 2026-07-14T06:20:00Z
updated: 2026-07-14T06:20:00Z
---

## Current Test

number: 1
name: Live SPX header chip ticks during RTH
expected: |
  On morai.wtf during RTH, the desktop header SPX chip ticks ~1/sec (matching the
  positions LIVE cadence), tinted live (text-blue) with the live dot; off-RTH or on
  quiet/stalled it reverts to the stale-styled EOD gex.spot (text-dim), never a frozen
  fabricated number and never 5800.
awaiting: user response

## Tests

### 1. Live SPX header chip ticks during RTH
expected: Chip ticks ~1/sec live-tinted during RTH; honest EOD stale style off-RTH.
result: [pending — needs live RTH session; runnable via chrome-devtools at next market open]

### 2. Regime rail gauges live→EOD revert
expected: |
  During RTH the vix-term-structure / vvix / vix9d-vix gauges show live values with
  client-recomputed band tint + 'LIVE' footer; on quiet/stalled they revert to EOD
  indicator.value + 'EOD · as of …' footer. Entry-gate verdict chip and hy-oas never
  move with the live stream.
result: [pending — needs live RTH session; partial evidence 2026-07-13: VIX 17.17 live vs 15.84 stale observed]

### 3. Deployed prod images carry Phase 38 code
expected: |
  Railway sidecar runs start_indices_poll, Railway server fans 'spot'/'indices' SSE
  lanes, morai.wtf serves live-aware Overview + regime rail.
result: [pending confirmation — orchestrator deployed server+sidecar+web 2026-07-13; spot chip + live VIX observed on morai.wtf same evening]
