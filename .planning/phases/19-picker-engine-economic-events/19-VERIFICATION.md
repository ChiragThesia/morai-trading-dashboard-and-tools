---
phase: 19-picker-engine-economic-events
verified: 2026-07-04T19:45:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:

  - test: "Load the Analyzer screen against a live picker_snapshot row (once the worker has computed one in a real environment) and visually confirm the ranked candidate rail renders correctly."
    expected: "Cards show real scores/breakdowns; each card's 'as of {HH:MM} · {source}' tag shows a genuinely fresh (green/up dot) reading for a recent snapshot; amber 'GEX unavailable'/'events unavailable' tags appear only when the corresponding context status is degraded; loading/error/cold-start/zero-filtered states each render their distinct copy at the right time."
    why_human: "Visual/UX correctness over live async data (5 mutually-exclusive rail states, a color-coded freshness dot, conditional amber tags) cannot be confirmed by grep or unit tests with mocked data alone — 19-09-SUMMARY.md explicitly recorded this manual UAT as 'not performed this session; flagged for the phase-level UAT pass,' and 19-VALIDATION.md lists the same item as its one Manual-Only Verification, still unchecked."

  - test: "Watch the first live RTH cycle after this phase is deployed: confirm compute-gex-snapshot's success enqueues compute-picker, and compute-picker actually persists a picker_snapshot row (check via GET /api/picker/candidates or the DB directly)."
    expected: "A fresh picker_snapshot row appears with observedAt stamped from the chain cohort's own data time (never now()), and GET /api/picker/candidates / get_picker_candidates return it without recomputing."
    why_human: "The full precompute chain (fetch-schwab-chain → … → compute-gex-snapshot → compute-picker) has never been exercised against a live Postgres + pg-boss instance in this session (19-08-SUMMARY.md: 'no Docker available for testcontainers' for that specific end-to-end path; wiring is typecheck/unit-test verified only). This is real-time, cross-service orchestration behavior that only a live run can confirm."

  - test: "Confirm fetch-economic-events' first live Friday-17:00-ET run successfully parses the real FRED release/dates response, and separately confirm the hand-authored FOMC_SEED dates are still accurate against the official Fed calendar."
    expected: "economic_events accumulates real CPI/NFP rows from FRED (Zod schema matches the live shape) and the FOMC seed dates match the Fed's published 2025/2026 schedule."
    why_human: "19-04-SUMMARY.md documents the FRED release/dates Zod schema was written from an assumed shape ('no live web/FRED access was available this session') and the FOMC_SEED was authored from training-knowledge recall, not a live source — both need a human/operator confirmation against the real external service and calendar, which cannot be grep-verified."
---

# Phase 19: Picker Engine + Economic Events Verification Report

**Phase Goal:** Real chain data and a new economic-events context feed the picker UI, replacing
fixtures with a live, honestly-staleness-labeled scoring engine.
**Verified:** 2026-07-04T19:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria from ROADMAP.md)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `scoreCalendarCandidates` scores put-calendar candidates over the latest chain snapshot using the 8 verified criteria; REFUTED criteria absent; negative FwdIV radicand returns a tagged guard, never NaN | ✓ VERIFIED | `packages/core/src/picker/domain/scoring.ts` implements fwdEdge (crit 1, via `computeFwdIv`), slope (crit 2), event penalty (crit 4, front-leg only), gexFit (crit 7), beVsEm (D-09 real ratio via `findBreakevens`); `candidate-selection.ts` implements delta-targeted strike selection, net-θ>0 filter (crit 6), debit=price-difference (crit 5), close-by-front-expiry via `exitPlan.closeByExpiry` (crit 8). `packages/contracts/src/picker.ts:34` closes the `breakdownEntry.criterion` enum to `slope\|fwdEdge\|gexFit\|eventAdjustment\|beVsEm` — `rg` confirms zero occurrences of IV-rank, IV-diff-band, or debit-%-of-back anywhere in `packages/core/src/picker`. `fwd-iv.ts:30-36`: `rad < 0` returns `{fwdIv:null, guard:"inverted"}`, else `{fwdIv:Math.sqrt(rad), guard:"ok"}` — never NaN, verified by fast-check property tests (36/36 picker domain tests pass). |
| 2 | User can query scored candidates via `GET /api/picker/candidates` and `get_picker_candidates` MCP tool; Analyzer swaps fixture for live data with no layout change | ✓ VERIFIED | `apps/server/src/adapters/http/picker.routes.ts` — thin `getPicker()` reader, 200/404/500 mapped correctly, mounted at `apiRouter` inside the same `authReadGroup` (Supabase JWT) as `/api/analytics/gex` (`main.ts:249-261,283-289`). `get_picker_candidates` registered in `apps/server/src/adapters/mcp/tools.ts:564` and wired in `server.ts:116`, same `pickerSnapshotResponse` schema. `apps/web/src/screens/Analyzer.tsx` no longer imports `pickerSnapshotFixture` — `usePicker()` is the sole data source (line 248); commit `3da99ba` confirms "no change to the 3-column grid, card anatomy, breakdown bars, why-panel, term-structure, or entry/exit plan." All pre-existing `Analyzer.test.tsx` suites pass unmodified against a mocked `usePicker()`. |
| 3 | Chain-snapshot staleness ("as of" + source) is visible on every surface that shows candidate scores | ✓ VERIFIED | `CandidateCard.tsx:72-79,117,149-150` renders `as of {HH:MM} · {source}` with a fresh/amber dot, sourced from the snapshot's `observedAt`/`source` (WR-03 fix — full ISO instant, not the date-only `asOf`); `Analyzer.tsx:400-402` threads `asOf`/`observedAt`/`source` into `CandidateRail` → each `CandidateCard`. `get_picker_candidates`/`GET /api/picker/candidates` both return the same `source`/`observedAt`/`asOf` fields in the payload — the only two surfaces that expose candidate scores (web rail, MCP/HTTP payload) both carry staleness. |
| 4 | Economic-events context (FOMC/CPI/NFP, cron-refreshed) feeds per-leg event-window flags into scoring; no separate events HTTP/MCP surface exists | ✓ VERIFIED | `candidate-selection.ts:114-120` `legSpansEvents` — pure ISO string-interval `(today, legExpiry]` test, wired into `frontEvents`/`backEvents` per candidate, consumed by `scoring.ts:132` (front-leg-only penalty, D-11). `packages/adapters/src/http/economic-events.ts` fetches FRED CPI/NFP `release/dates` and unions with `FOMC_SEED` (WR-05 fix: seed always returned regardless of FRED outcome). `apps/worker/src/schedule.ts:172` schedules `fetch-economic-events` weekly (Friday 17:00 ET). `rg` across `apps/server/src/adapters/{http,mcp}` confirms no economic-events route or MCP tool exists — the only reference is inside `get_picker_candidates`'s tool description text. |

**Score:** 4/4 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/picker/domain/scoring.ts` | `scoreCalendarCandidates`, closed-enum breakdown | ✓ VERIFIED | Exists, substantive, wired into `computePickerSnapshot.ts`, unit + property tested |
| `packages/core/src/picker/domain/candidate-selection.ts` | `selectCandidates`, delta-targeted universe | ✓ VERIFIED | Exists, substantive, wired, unit + property tested (incl. WR-04 collision regression) |
| `packages/core/src/picker/domain/fwd-iv.ts` | `computeFwdIv` never-NaN guard | ✓ VERIFIED | Exists, substantive, fast-check property tested |
| `packages/core/src/picker/domain/breakevens.ts` | `findBreakevens` bisection solver | ✓ VERIFIED | Exists, substantive, fast-check property tested |
| `packages/adapters/src/http/economic-events.ts` | FRED CPI/NFP + FOMC seed union | ✓ VERIFIED | Exists, WR-05-fixed, msw-tested |
| `packages/adapters/src/postgres/repos/picker-snapshot.ts` | Append-history, Zod-validated both seams | ✓ VERIFIED | Exists, WR-01-fixed (`onConflictDoNothing`), testcontainers-tested against real Postgres |
| `packages/adapters/src/postgres/repos/picker-chain.ts` | Latest put cohort + IV + source | ✓ VERIFIED | Exists, testcontainers-tested |
| `packages/core/src/picker/application/computePickerSnapshot.ts` | Orchestration: read→select→score→tag→rank→persist | ✓ VERIFIED | Exists, substantive, unit tested (11 tests incl. degraded-context, empty-cohort, zero-candidate cases) |
| `packages/core/src/picker/application/getPicker.ts` | Thin latest-row forwarder | ✓ VERIFIED | Exists, no recompute (`rg` confirms no select/compute/score substrings) |
| `apps/server/src/adapters/http/picker.routes.ts` | `GET /api/picker/candidates` | ✓ VERIFIED | Exists, wired into auth-gated apiRouter, 200/404/500 tested |
| `apps/server/src/adapters/mcp/tools.ts` (`get_picker_candidates`) | MCP tool, same schema | ✓ VERIFIED | Exists, registered, tested via real `McpServer` + `InMemoryTransport` |
| `apps/worker/src/handlers/compute-picker.ts` | Chain-triggered, terminal job | ✓ VERIFIED | Exists, RTH+holiday gated, no `boss.send` (terminal), unit tested |
| `apps/worker/src/handlers/fetch-economic-events.ts` | Weekly cron job | ✓ VERIFIED | Exists, scheduled Friday 17:00 ET, unit tested |
| `apps/web/src/hooks/usePicker.ts` | react-query hook | ✓ VERIFIED | Exists, mirrors `useCot`, 404→null semantics, tested (4/4) |
| `apps/web/src/screens/Analyzer.tsx` | Fixture→live swap, rail states | ✓ VERIFIED | Exists, fixture import removed, 5 rail states implemented, tested |
| `apps/web/src/components/picker/CandidateCard.tsx` | Staleness+source+context tags | ✓ VERIFIED | Exists, WR-02/WR-03 fixed, tested |
| `economic_events` table (migration 0014) | plain `date` column, composite PK | ✓ VERIFIED | `schema.ts:453` `eventDate: date("event_date")` — plain date, not timestamptz; migration applied to live schema per 19-05-SUMMARY.md |
| `picker_snapshot` table (migration 0015) | `timestamptz` PK + `jsonb` blob | ✓ VERIFIED | `schema.ts:472-473` — `observedAt: timestamp(..., {withTimezone:true}).primaryKey()`, `snapshot: jsonb`; migration applied to live schema |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `Analyzer.tsx` | `GET /api/picker/candidates` | `usePicker()` → `apiFetch` | WIRED | `usePicker.ts` calls the route, parses through `pickerSnapshotResponse`, `Analyzer.tsx:248` consumes it |
| `picker.routes.ts` / `get_picker_candidates` | `getPicker` use-case | Direct call, no recompute | WIRED | Both call `getPicker()` only; `rg` confirms no scoring-engine import in either adapter |
| `compute-gex-snapshot` | `compute-picker` | `boss.send("compute-picker", {}, {singletonKey:"triggered-by-gex"})` | WIRED | `compute-gex-snapshot.ts:51-54`; `compute-picker` has no `schedule()` call in `schedule.ts` (chain-triggered only, confirmed) |
| `candidate-selection.ts` (`legSpansEvents`) | `scoring.ts` (`eventAdjustment`) | `RawCandidate.frontEvents` → `EVENT_PENALTY` lookup | WIRED | `scoring.ts:132` reduces `frontEvents` through `EVENT_PENALTY`, front-leg only (D-11) |
| `computePickerSnapshot.ts` | `picker_snapshot` repo | `persistPickerSnapshot({observedAt: latestTime, snapshot})` | WIRED | `computePickerSnapshot.ts:319`; `observedAt` derives from cohort data time, never `now()` |
| Economic-events adapter | `economic_events` table | `fetch-economic-events` handler → `persistEconomicEvents` | WIRED | `fetch-economic-events.ts` fetch→persist; scheduled weekly in `schedule.ts` |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `bun run typecheck` (whole workspace) | `tsc --build --force` | exit 0, no errors | ✓ PASS |
| `bun run lint` (whole workspace) | `eslint .` | 0 errors (pre-existing boundary-selector warnings only) | ✓ PASS |
| Picker core domain/application tests | `bun run test -- packages/core/src/picker` | 6 files, 36/36 pass | ✓ PASS |
| Web picker hook/screen/card tests | `bun run test -- apps/web/src/hooks/usePicker.test.ts apps/web/src/screens/Analyzer.test.tsx apps/web/src/components/picker/CandidateCard.test.tsx` | 3 files, 53/53 pass | ✓ PASS |
| Server route + MCP + worker handler tests | `bun run test -- apps/server/.../picker.routes.test.ts apps/server/.../tools.test.ts apps/worker/.../compute-picker.test.ts apps/worker/.../fetch-economic-events.test.ts apps/worker/.../schedule.test.ts` | 5 files, 32/32 pass | ✓ PASS |
| WR-01 idempotency regression (real Postgres, testcontainers) | `bun run test -- packages/adapters/src/postgres/repos/picker-snapshot.contract.test.ts` | 7/7 pass, incl. "idempotent on duplicate observedAt (WR-01)" | ✓ PASS |
| WR-04 candidate-id collision regression | present in `candidate-selection.test.ts` | Exercised in full suite run | ✓ PASS |
| Full workspace suite (run once) | `bun run test` | 200 files, 1829/1829 pass | ✓ PASS |

### Code-Review Fix Pass (19-REVIEW.md)

All 5 WARNING findings verified fixed in current source, each with its own commit and regression test, all currently green:

| Finding | Fix Verified In | Commit |
|---|---|---|
| WR-01 (non-idempotent insert) | `picker-snapshot.ts:47` `onConflictDoNothing({target: observedAt})` + regression test | `1963b7a` |
| WR-02 (inverted caption) | `CandidateCard.tsx:57` `entry.rawValue > 0 ? "−" : "ok"` | `b4069cf` |
| WR-03 (date-only asOf) | `observedAt` added to contract + `CandidateCard.tsx` consumes it | `122ed87` |
| WR-04 (id collision) | `candidate-selection.ts:244` id includes `rung.label` + regression test | `9e89e60` |
| WR-05 (FOMC seed dropped) | `economic-events.ts:121-150` seed always unioned | `4e9c011` |

The 2 INFO findings (IN-01 source-from-lowest-strike, IN-02 unbounded historical events read) remain unaddressed — both are documented as accepted, non-blocking tradeoffs in 19-REVIEW.md and do not affect goal achievement.

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|---|---|---|---|
| PICK-01 | 19-01, 19-02, 19-03, 19-06, 19-08 | ✓ SATISFIED | Scoring engine, guards, compute-picker chain-trigger all present and tested |
| PICK-02 | 19-01, 19-05, 19-06, 19-07, 19-09 | ✓ SATISFIED | HTTP route, MCP tool, persistence, Analyzer live swap all present and tested |
| PICK-03 | 19-03, 19-04, 19-08 | ✓ SATISFIED | Economic-events adapter/repo/cron, per-leg event flags all present and tested |

No orphaned requirements — REQUIREMENTS.md rows for PICK-01/02/03 all trace to at least one plan's `requirements:` frontmatter.

### Anti-Patterns Found

None. Scanned all 26 phase-modified source files (contracts, core domain/application, adapters, server routes/MCP, worker handlers, web hook/screen/component) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|not yet implemented|coming soon` — zero matches. No debt markers.

### Human Verification Required

1. **Manual visual UAT of the Analyzer picker rail against live data** — 19-09-SUMMARY.md and 19-VALIDATION.md both explicitly flag this as not performed this session. Needs a human to load the Analyzer against a real `picker_snapshot` row and confirm the 5 rail states (loading/error/cold-start/zero-filtered/populated), the freshness dot, and the context-status tags render correctly.

2. **Live worker chain-trigger confirmation** — the full precompute chain (`compute-gex-snapshot` → `compute-picker`) has never run against a live Postgres + pg-boss instance in this session (no Docker/live DB for that specific end-to-end path). A human/operator should watch the first live RTH cycle post-deploy to confirm `compute-picker` actually fires and persists a row.

3. **FRED live-shape + FOMC-seed accuracy** — the FRED `release/dates` Zod schema was written from an assumed response shape (no live FRED access this session) and `FOMC_SEED` was authored from training-knowledge recall, not a live source. A human should confirm the first live Friday cron run parses successfully and that the FOMC dates match the Fed's published calendar.

### Gaps Summary

No gaps. All 4 phase Success Criteria are implemented, wired, and covered by passing automated tests (unit, property, testcontainers, msw) — including regression tests for all 5 code-review WARNING findings, all confirmed fixed in the current source. The full workspace suite (1829 tests), typecheck, and lint are all green. The only open items are inherent to going live for the first time (visual UAT of async UI states, and confirming the worker chain fires against a real deployed Postgres/pg-boss instance and a real FRED response) — these require a human/operator in a live environment and cannot be closed by further code changes in this verification pass.

---

_Verified: 2026-07-04T19:45:00Z_
_Verifier: Claude (gsd-verifier)_
