---
phase: 24-regime-breadth-board
verified: 2026-07-09T02:20:00Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 24: Regime & Breadth Board Verification Report

**Phase Goal:** The user can see the market's regime/breadth state at a glance on the Overview
tab — every indicator admitted only after documented research evidence, each showing its
threshold state and its "why."
**Verified:** 2026-07-09
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every indicator admitted only with documented source + rationale (regime-board.md citations; RSP:SPY refutation documented) | ✓ VERIFIED | `docs/architecture/regime-board.md` has a 4-row "Admitted indicators" table (vix-term-structure, vvix, vix9d-vix, hy-oas) each with formula/inputs, band cuts, threshold rationale, source URLs, verification date 2026-07-09. A "Refuted / Dropped" table documents RSP:SPY equal-weight breadth (reason: no server-fetchable source, Stooq bot-walled, Schwab sidecar has no equity-quote surface), plus VVIX/VIX ratio, VIX9DCLS (hallucinated FRED series), and HYG — each with a revival path. |
| 2 | Overview shows board: per indicator value, calm/warning/crisis band, as-of date | ✓ VERIFIED | `apps/web/src/components/RegimeBoard.tsx` renders one `regime-chip-{id}` per present indicator with `regime-value-{id}` (value.toFixed(2)), `regime-band-{id}` (band-colored dot via `BAND_CLASSES` calm→up/warning→amber/crisis→down), `regime-asof-{id}` ("as of {date}"). Mounted on `Overview.tsx` (line 1158) between "Positioning & macro detail" and "Book & system" sections, confirmed via grep and RTL mount test. |
| 3 | Per-indicator "why" (source + threshold rationale) exposed like Analyzer provenance | ✓ VERIFIED | Each chip has a `regime-why-{id}` ⓘ Tooltip trigger (clone of the existing Overview "IV n/a" Badge+Tooltip pattern) whose `TooltipContent` renders `indicator.source` and `indicator.rationale` as two separate text nodes read directly from the payload — not hardcoded per-indicator UI copy. Backed by `getRegimeBoard.ts`'s `META` table, sourced from `regime-board.md`. |
| 4 | Board data via HTTP route AND MCP tool | ✓ VERIFIED | `GET /analytics/regime` in `apps/server/src/adapters/http/analytics.routes.ts` (line 165) and `registerGetRegimeTool`/`get_regime` in `apps/server/src/adapters/mcp/tools.ts` (line 737) both call the same `getRegimeBoard` use-case and both parse the result through the identical `regimeResponse` Zod schema from `@morai/contracts` (confirmed via grep — same import in both files, MCP-02 convention). Both wired in `apps/server/src/main.ts` reusing the existing `macroObservationsRepo` (zero new repo/table). |
| 5 | Daily cadence, as-of stamped, EOD never presented as intraday | ✓ VERIFIED | `regimeIndicator.asOf` is `z.string().date()` (date-only, contract-level rejection of any intraday timestamp — confirmed in `packages/contracts/src/regime.ts` and its test). `getRegimeBoard.ts` computes `asOf` as the row's own date for single-input indicators and the OLDER of two input dates for ratio indicators (`olderDate` helper, never overstates freshness). VIX9D + HY OAS ride the existing twice-daily `fetch-rates` cron (no new job) — worker wiring confirmed in `apps/worker/src/main.ts`. `useRegimeBoard.ts` refetches on a 30-min/staleTime-900s cadence matching `useMacro`'s class. |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `docs/architecture/regime-board.md` | Evidence table + Refuted/Dropped section | ✓ VERIFIED | 4 admitted indicators + 4 refuted candidates, source/rationale/verification-date per row |
| `packages/contracts/src/regime.ts` | `regimeIndicator`/`regimeResponse` Zod schemas | ✓ VERIFIED | `id,label,value,band(calm\|warning\|crisis),asOf(date-only),source,rationale,inputs?` — matches exactly |
| `packages/core/src/analytics/domain/regime.ts` | 4 pure banding fns, named constants | ✓ VERIFIED | `bandVixTermStructure` (0.90/0.95), `bandVvix` (100/115), `bandVix9dRatio` (1.0/1.1), `bandHyOas` (3.0/5.0) — cuts match spec exactly, no magic numbers |
| `packages/core/src/analytics/application/getRegimeBoard.ts` | `makeGetRegimeBoardUseCase`, missing-input omission, older-date asOf | ✓ VERIFIED | Confirmed: omits indicator when a required series has no row; `olderDate()` helper for ratio indicators; empty store → `ok([])` |
| `apps/server/src/adapters/http/analytics.routes.ts` | `GET /analytics/regime` | ✓ VERIFIED | Line 165, parses through `regimeResponse`, maps `StorageError` → flat `{error:"internal"}` 500 |
| `apps/server/src/adapters/mcp/tools.ts` | `get_regime` MCP tool | ✓ VERIFIED | Line 737, `registerGetRegimeTool`, same `regimeResponse` parse |
| `apps/web/src/components/RegimeBoard.tsx` | Chip grid, band+asof+tooltip | ✓ VERIFIED | Renders per-present-indicator chips, band coloring, provenance tooltip |
| `apps/web/src/screens/Overview.tsx` | Mounts RegimeBoard | ✓ VERIFIED | Line 1158, `<RegimeBoard />` inside a "Regime & breadth" section between the two named sibling sections |
| `packages/core/src/journal/application/fetchMacroSeries.ts` | `BAMLH0A0HYM2` in `DEFAULT_FRED_SERIES_IDS` | ✓ VERIFIED | Present (line 51), 9 FRED ids total |
| `packages/contracts/src/macro.ts` | `MACRO_SERIES_IDS` includes `BAMLH0A0HYM2` + `VIX9D` | ✓ VERIFIED | 11 ids total, both present at end of array |
| `apps/worker/src/main.ts` | `makeCboeVix9dAdapter` wired | ✓ VERIFIED | Line 43 import, line 188 instantiation, line 196 passed into `makeFetchMacroSeries` deps |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `getRegimeBoard.ts` | `regime.ts` domain | 4 banding fn calls | ✓ WIRED | `bandVixTermStructure`, `bandVvix`, `bandVix9dRatio`, `bandHyOas` all imported and invoked per indicator |
| `analytics.routes.ts` | `regime.ts` contract | `regimeResponse.parse()` before `c.json` | ✓ WIRED | Confirmed at line 173 |
| `mcp/tools.ts` | `regime.ts` contract | `regimeResponse.parse()` before returning content | ✓ WIRED | Confirmed at line 758 — same schema instance as the route (MCP-02) |
| `main.ts` (server) | `getRegimeBoard.ts` | `makeGetRegimeBoardUseCase({readMacroObservations: macroObservationsRepo.readMacroObservations})` | ✓ WIRED | Reuses existing repo, no new table |
| `useRegimeBoard.ts` | `RegimeBoard.tsx` | React Query `data` prop | ✓ WIRED | `data.map(...)` renders chips only for present indicators |
| `Overview.tsx` | `RegimeBoard.tsx` | `<RegimeBoard />` mount | ✓ WIRED | Between the two specified sibling sections |
| `apps/worker/src/main.ts` | `cboe-vix9d.ts` | `makeCboeVix9dAdapter` → `fetchVix9dQuote` dep | ✓ WIRED | VIX9D piggybacks the existing fetch-rates cron |

### Behavioral Spot-Checks / Automated Verification

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Typecheck | `bun run typecheck` | Clean (`tsc --build --force` — no errors) | ✓ PASS |
| Targeted regime + macro test suite | `bun run test -- packages/contracts/src/regime.test.ts packages/core/src/analytics/domain/regime.test.ts packages/core/src/analytics/application/getRegimeBoard.test.ts apps/server/src/adapters/http/analytics.routes.test.ts apps/web/src/components/RegimeBoard.test.tsx apps/web/src/screens/Overview.test.tsx packages/core/src/journal/application/fetchMacroSeries.test.ts packages/contracts/src/macro.test.ts packages/adapters/src/http/cboe-vix9d.test.ts packages/adapters/src/memory/vix9d.test.ts` | 10 files / 132 tests passed | ✓ PASS |
| Docs counts corrected | `grep -n "Eleven series" docs/architecture/data-model.md` + `jobs.md` BAMLH0A0HYM2/VIX9D references | Both docs updated to 11 series, TOPIC-MAP.md links regime-board.md | ✓ PASS |

Full workspace suite not re-run (executors reported 2375 green at HEAD, per instructions not to rerun).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MACRO-02 | 24-01, 24-02 | Evidence-discipline citation before shipping an indicator | ✓ SATISFIED | regime-board.md evidence table |
| MACRO-03 | 24-01, 24-04 | New series ingested w/o migration; asOf never overstates freshness | ✓ SATISFIED | BAMLH0A0HYM2/VIX9D text-column ingestion; olderDate() helper; date-only asOf contract |
| BOARD-01 | 24-03, 24-04, 24-05 | Value + band + as-of visible per indicator | ✓ SATISFIED | RegimeBoard.tsx chips |
| BOARD-02 | 24-03, 24-04, 24-05 | Payload-carried source + rationale (not hardcoded UI copy) | ✓ SATISFIED | META table in getRegimeBoard.ts + verbatim tooltip render |
| BOARD-03 | 24-04 | HTTP + MCP over one schema | ✓ SATISFIED | analytics.routes.ts + mcp/tools.ts both parse regimeResponse |

No orphaned requirements found for this phase in REQUIREMENTS.md beyond those declared across the 5 plans.

### Anti-Patterns Found

None. No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers found in the phase's modified files. No
hardcoded empty-array stub returns — `getRegimeBoard.ts`'s use-case reads real
`macro_observations` rows via the existing port; band functions are total, pure, and
threshold-constant-driven (no magic numbers, confirmed above). Web component only omits
missing indicators (by design, matches spec) — never renders a fabricated/placeholder chip.

### Human Verification Required

None required to pass this verification. The plan's own `<human-check>` (24-05 Task 2) — visual
UAT of chip grid, band triad colors, tooltip hover, section placement on the live Overview tab —
is explicitly deferred to end-of-phase / orchestrator's next step per `human_verify_mode=end-of-phase`
and the phase's own deploy-not-yet-done state (VIX9D/HY-OAS values populate only after
`macro_observations` accrues post-deploy). This is noted per the verification rules as an
orchestrator/human item, not a gap in the built code.

### Gaps Summary

No gaps found. All 5 roadmap success criteria are directly traceable to real, wired, non-stub
code: the evidence doc exists with citations and refutations; the board renders value/band/as-of
per indicator on Overview; provenance is payload-driven (not hardcoded UI strings); the HTTP
route and MCP tool share one Zod schema; and as-of is date-only with an explicit older-date rule
for ratio indicators so EOD data is never presented as intraday. Typecheck is clean and the
targeted regime/macro test suite (132 tests across contracts, domain, use-case, route, and web
component) passes.

---

_Verified: 2026-07-09T02:20:00Z_
_Verifier: Claude (gsd-verifier)_
