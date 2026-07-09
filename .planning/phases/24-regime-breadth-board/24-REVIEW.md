---
phase: 24-regime-breadth-board
reviewed: 2026-07-09T00:00:00Z
depth: deep
files_reviewed: 15
files_reviewed_list:
  - packages/adapters/src/http/cboe-vix9d.ts
  - packages/adapters/src/memory/vix9d.ts
  - packages/adapters/src/http/fred.ts
  - packages/core/src/journal/application/fetchMacroSeries.ts
  - packages/core/src/journal/application/ports.ts
  - packages/contracts/src/macro.ts
  - packages/contracts/src/regime.ts
  - packages/core/src/analytics/domain/regime.ts
  - packages/core/src/analytics/application/getRegimeBoard.ts
  - apps/server/src/adapters/http/analytics.routes.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/adapters/mcp/server.ts
  - apps/server/src/main.ts
  - apps/worker/src/main.ts
  - apps/web/src/hooks/useRegimeBoard.ts
  - apps/web/src/components/RegimeBoard.tsx
  - apps/web/src/screens/Overview.tsx
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 24: Code Review Report

**Reviewed:** 2026-07-09
**Depth:** deep
**Files Reviewed:** 15 source files (+ their tests)
**Status:** issues_found

## Summary

Reviewed the Regime & Breadth board slice: the CBOE VIX9D adapter + in-memory twin,
the HY OAS / VIX9D additions to the macro fetch orchestration, the pure banding domain,
the `getRegimeBoard` use-case, the regime Zod contract, the HTTP route + `get_regime` MCP
tool, both composition roots, and the `RegimeBoard` hook + component.

The core logic is sound. **Banding matches `docs/architecture/regime-board.md` exactly**
at every `>=` cut (0.95/0.90 term structure, 115/100 VVIX, 1.1/1.0 VIX9D, 5.0/3.0 HY OAS),
verified against the doc's inclusive-on-the-stress-side semantics and covered by both
example and fast-check monotonicity tests. Missing-series omission is real (guarded
`!== undefined`, no `undefined` leak). `olderDate`/`latestRowPerSeries` use lexicographic
YYYY-MM-DD compare correctly.

I specifically hunted this repo's recurring green-suite failure modes and found the suite
holds this time: `fetchMacroSeries.test.ts` seeds a genuine VIX9D-fetch-failure case
proving `allSettled` independence (the other 10 series still persist, error names VIX9D);
`getRegimeBoard.test.ts` uses **distinct per-series dates** (VIXCLS 07-01 vs 07-08, VXVCLS
07-07) so `latestRowPerSeries` and `olderDate` are actually exercised, not masked by shared
timestamps; the CBOE adapter tests cover non-200, network throw, Zod-fail, null spot, `0`
spot, and the 20:00–24:00 ET date-boundary. No vacuous assertions found.

Two robustness/data-integrity concerns and one stale MCP description remain. No blockers.

## Warnings

### WR-01: Unguarded ratio division propagates a non-finite value that fails the board contract

**Status:** fixed (a3da1de) — guarded `Number.isFinite` before every indicator push (ratio
and direct-value); TDD RED (VIXCLS=0 denominator) → GREEN.

**File:** `packages/core/src/analytics/application/getRegimeBoard.ts:104,129`
**Issue:** Both ratio indicators divide without guarding the denominator:
`vixCls.value / vxvcls.value` and `vix9d.value / vixCls.value`. A `0` denominator yields
`Infinity` (or `NaN` for `0/0`). `regimeResponse.value` is `z.number()` (not `.finite()`),
so `Infinity` passes server-side `regimeResponse.parse`, then `JSON.stringify(Infinity)`
emits `null` — the client's `regimeResponse.parse(await res.json())` in `useRegimeBoard.ts`
then rejects `value: null` and throws, blanking the **entire** board (all 4 chips) rather
than omitting one indicator. A `NaN` value fails `regimeResponse.parse` server-side and
500s the whole `/analytics/regime` route. Real VIX/HY sources never emit `0`, so the
trigger probability is ~nil — hence WARNING not BLOCKER — but the failure mode is
all-or-nothing and there is no test for a zero/non-finite input, matching the "one bad
value takes down the whole payload" class this repo has been bitten by.
**Fix:** Guard finiteness before pushing, and omit like a missing series (consistent with
T-24-09):
```ts
const value = vixCls.value / vxvcls.value;
if (Number.isFinite(value)) {
  indicators.push({ id: "vix-term-structure", /* ... */ value, band: bandVixTermStructure(value), /* ... */ });
}
```
(same for `vix9d-vix`). Alternatively tighten the contract to `z.number().finite()` so a
bad value is caught at the boundary instead of silently serialized to `null`.

### WR-02: vix9d-vix ratio blends a live CBOE quote with a lagged FRED close; asOf hides the fresher input

**Status:** documented (95498f4) — "Known limitations" section added to
`docs/architecture/regime-board.md`, recording the cross-epoch caveat and gating Phase 28
from wiring this indicator into a hard gate until both legs share an observation time. No
code change (display-only, non-corrupting per the finding).

**File:** `packages/core/src/analytics/application/getRegimeBoard.ts:127-137`
**Issue:** The numerator `VIX9D` comes from CBOE's delayed-quotes endpoint (near-real-time,
refreshed every `fetch-rates` run), while the denominator `VIXCLS` comes from FRED, which
publishes only the prior session's EOD close (typically a day behind during RTH). The ratio
therefore divides today's intraday VIX9D by yesterday's VIXCLS close — two different
observation times — and `asOf` is set to `olderDate(...)` = the VIXCLS date, so the UI
stamps the chip with the *stale* date while displaying a ratio built from a *fresher*
numerator. During a fast intraday vol spike the stale denominator inflates the ratio and
can flip the band to `crisis` spuriously. By contrast `vix-term-structure` is coherent
(VIXCLS and VXVCLS are both FRED EOD, same lag). This is the documented formula
(regime-board.md: "CBOE `_VIX9D` / FRED `VIXCLS`") and is display-only + `[ASSUMED]` +
gated to Phase 28, so it is non-corrupting — but it is a genuine cross-time data-integrity
smell worth recording before Phase 28 wires it into a gate.
**Fix:** Either source the VIX denominator from the same CBOE delayed-quote surface as
VIX9D (an in-system `_VIX` quote) so numerator and denominator share an observation time,
or, if keeping FRED VIXCLS, add a same-day-availability check (skip the indicator when the
two input dates differ by more than N days) and document the cross-time caveat in the
indicator's `rationale`. Do not wire this indicator into a hard gate (Phase 28) until the
inputs are time-aligned.

## Info

### IN-01: get_macro MCP tool description is stale — omits the two Phase-24 series

**Status:** fixed (5309b20) — description now reads "9 FRED series ... BAMLH0A0HYM2 —
plus VVIX and VIX9D via CBOE", matching `MACRO_SERIES_IDS`.

**File:** `apps/server/src/adapters/mcp/tools.ts:686`
**Issue:** The `get_macro` tool description still reads "8 FRED series — DFF, DGS1MO,
DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS, VXVCLS — plus VVIX via CBOE". Phase 24 added
`BAMLH0A0HYM2` (9th FRED series) and `VIX9D` (CBOE) to the macro pipeline
(`DEFAULT_FRED_SERIES_IDS` now has 9; `MACRO_SERIES_IDS` has 11), so `get_macro` now
returns those series, but the description advertises neither — an MCP client (Claude) will
not know HY OAS or VIX9D are retrievable. No runtime impact; the schema
(`macroResponse`/`macroQuery`) is correct.
**Fix:** Update the description to "9 FRED series (… , BAMLH0A0HYM2) plus VVIX and VIX9D via
CBOE" to match `MACRO_SERIES_IDS`.

---

_Reviewed: 2026-07-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
