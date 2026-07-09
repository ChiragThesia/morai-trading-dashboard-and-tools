# Phase 23: VIX3M Ingestion - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning
**Source:** User-locked standing decisions (milestone kickoff message) + .planning/research/SUMMARY.md

<domain>
## Phase Boundary

VIX3M (FRED series `VXVCLS`) starts accreting daily in `macro_observations` alongside the
existing 8 series (7 FRED + VVIX). No consumer work — the regime board (Phase 24) and crisis
gates (Phase 28) read it later. The series has no backfill; every day skipped is permanently
lost, which is why this phase ships first and alone.

</domain>

<decisions>
## Implementation Decisions

### Series id (USER-LOCKED, live-verified)
- FRED series id is **`VXVCLS`** — live-verified 2026-07-09 (HTTP 200, daily, 4852 rows,
  current to 2026-07-07 = 19.01). `VIXCLS3M`, `VIX3M`, `VIX3MCLS`, `VXV` all 404. Any research
  doc that says `VIXCLS3M` is wrong; STACK.md's live verification is authoritative.
- One entry appended to `DEFAULT_FRED_SERIES_IDS` in
  `packages/core/src/journal/application/fetchMacroSeries.ts` (currently 7 ids).

### Behavior (inherit Phase 14 conventions exactly)
- Same twice-daily cadence, same job (`fetch-rates` / fetch-macro-series flow) — no new job.
- Failed `VXVCLS` fetch degrades exactly like the other series: Promise.allSettled
  per-series independence, fail-loud finish naming failed ids (D-07). Never a silent skip.
- Raw index-level value, NO /100 division (D-14) — VXVCLS is an index level like VIXCLS/VVIX.

### Surfaces
- Queryable via existing `GET /api/analytics/macro` + MCP `get_macro` with zero new
  endpoint work (they key off `macro_observations` series ids).
- `packages/contracts/src/macro.ts` series-id enum gains `VXVCLS` (Zod closed enum).
- UI display on Overview MacroCard is NOT required this phase (Phase 24 regime board owns
  presentation). If contracts/tests force a label, "VIX3M" is the display name.

### Tests (TDD red→green, repo rules)
- Memory twin (`packages/adapters/src/memory/fred-series.test.ts` seed) + contract test row
  for VXVCLS, same PR (architecture rule 8).
- `fetchMacroSeries.test.ts` expectation lists update (e.g. `[...DEFAULT_FRED_SERIES_IDS, "VVIX"]`).

### Claude's Discretion
- Whether MCP tool description strings enumerating series ids get updated (cosmetic).
- Exact test placement following existing file conventions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Macro pipeline (Phase 14 built it — this phase extends it)
- `packages/core/src/journal/application/fetchMacroSeries.ts` — `DEFAULT_FRED_SERIES_IDS` (the one-line change) + orchestration/D-07 semantics
- `packages/core/src/journal/application/ports.ts` — macro ports, D-14 raw-value note
- `packages/adapters/src/http/fred.ts` — parameterized FRED HTTP adapter (no change expected)
- `packages/contracts/src/macro.ts` — series-id Zod enum (gains VXVCLS)
- `packages/adapters/src/__contract__/macro-observations.contract.ts` — contract test
- `apps/worker/src/schedule.ts` — twice-daily cron (no change expected)

### Requirements
- `.planning/REQUIREMENTS.md` — MACRO-01
- `.planning/research/SUMMARY.md` — VXVCLS verification + "first and alone" rationale

</canonical_refs>

<specifics>
## Specific Ideas

- Verification of "accruing daily" success criterion: after deploy, a prod DB read
  (SELECT series, observed_at FROM macro_observations WHERE series='VXVCLS') proves day-one
  accrual — deploy same day as merge, since un-ingested days are permanently lost.

</specifics>

<deferred>
## Deferred Ideas

- Regime board display of VIX3M → Phase 24
- VIX/VIX3M crisis-gate consumption + fail-open/fail-closed decision → Phase 28

</deferred>

---

*Phase: 23-vix3m-ingestion*
*Context gathered: 2026-07-09 from user-locked milestone decisions*
