---
phase: 27-pick-04-backtest-harness
plan: 05
subsystem: backend
tags: [typescript, hexagonal, backtest, picker, exits, zod, vitest, tdd]

requires:
  - phase: 27-pick-04-backtest-harness
    provides: "27-01's ports/domain types, 27-02's reuse seams (selectCandidates/scoreCalendarCandidates/evaluateExit/haircutFill/computeLegPairMetrics threaded to @morai/core + the weights ablation seam), 27-03's readChainAsOf/readDailySpotClosesAsOf/readPickerSnapshotsInRange/readFullSnapshotHistoryForCalendar readers, 27-04's report kernel"
provides:
  - "replayPickerCohort — BT-02 leakage oracle: replays a stored picker_snapshot cohort through the untouched selectCandidates/scoreCalendarCandidates/rankAndCapCandidates, asserts exact score reproduction per candidate id, guards on ruleSet drift first"
  - "replayExitsForCalendar — BT-03 13-trade walk-forward: walks a closed calendar's full snapshot history through evaluateExit, compares the modeled trajectory (haircutFill-priced entry+exit) against the calendar_events.realizedPnl fills-ledger oracle"
  - "replayHypotheticalEntry — BT-04 input: scores the full (uncapped) candidate universe at a cohort through the untouched engine, forward-walks each to a simulated P&L via computeLegPairMetrics + evaluateExit, honors an ablation weights override, skips gap cohorts"
  - "All three replay use-cases + their Deps/outcome types threaded through packages/core/src/backtest/index.ts"
affects: [27-06-replay-cli]

tech-stack:
  added: []
  patterns:
    - "Backtest-owned local Zod schemas re-validate the untyped Record<string,unknown> snapshot blob (core cannot import @morai/contracts) — parse only the subset fields each replay needs, never the whole PickerSnapshotResponse"
    - "Self-import of @morai/core from within packages/core/src/backtest/*.ts (proven by 27-02's reuse-exports.test.ts) — the sanctioned way a sibling bounded context inside core pulls the threaded reuse seam"
    - "haircutFill-priced entry/exit on real as-of-T chain quotes, falling back to the calendar's own real openNetDebit / the row's raw netMark when no quote is found — never inventing data"
    - "OccSymbol re-branding via parseOccSymbol/formatOccSymbol (parse, don't cast) when a raw chain-leg string needs to satisfy a branded LegSnapshot.occSymbol"

key-files:
  created:
    - packages/core/src/backtest/application/replayPickerCohort.ts
    - packages/core/src/backtest/application/replayPickerCohort.test.ts
    - packages/core/src/backtest/application/replayExitsForCalendar.ts
    - packages/core/src/backtest/application/replayExitsForCalendar.test.ts
    - packages/core/src/backtest/application/replayHypotheticalEntry.ts
    - packages/core/src/backtest/application/replayHypotheticalEntry.test.ts
  modified:
    - packages/core/src/backtest/index.ts

key-decisions:
  - "Testcontainers deviation: the plan called each replay test an 'integration test (testcontainers)', but packages/core has no tsconfig reference to @morai/adapters and no testcontainers devDependency (architecture-boundaries §2 hard constraint — core imports @morai/shared only). Every other application-layer use-case test in this codebase (computePickerSnapshot.test.ts, computeExitAdvice.test.ts, getCot.test.ts) already uses in-memory port fakes for exactly this reason. Followed that established precedent instead of the plan's literal wording — CLAUDE.md's workflow.md Order of Authority puts architecture rules above plan instructions."
  - "replayPickerCohort.test.ts's 'stored' fixture is produced by actually RUNNING makeComputePickerSnapshotUseCase once (not a hand-derived expected value) — a genuine two-path determinism proof: the live use-case and the replay both consume the same chain fixture and must produce byte-identical scores."
  - "'Full universe including gate-dropped strikes' (BT-04 must_haves wording) is structurally unimplementable without reimplementing candidate-selection.ts's gates: picker_snapshot only ever persists gate-drop COUNTS, never candidate identities, and selectCandidates has no bypass export. Documented in the file header as a ponytail: comment — 'full universe' is implemented as every strike selectCandidates itself returns, uncapped by rankAndCapCandidates's top-8, the maximal achievable reduction through the untouched engine. Upgrade path named: an additive includeGateDropped diagnostic export to candidate-selection.ts in a future plan."
  - "replayExitsForCalendar's entry/exit pricing: haircutFill on real as-of-T chain quotes (mirrors candidate-selection.ts's open-debit formula for entry, its inverse for close) when a quote is found at the calendar's openedAt / exit-row time; falls back to the calendar's real openNetDebit / the exit row's raw netMark when no chain quote exists — never fabricating a haircut from absent data."
  - "replayHypotheticalEntry reuses the cohort's FROZEN gex/gexContextStatus fields (same Pattern 1 the BT-02 oracle uses) rather than re-deriving GEX, since this replay iterates the identical stored-snapshot ledger BT-02 does — no new as-of-T GEX read needed (RESEARCH's own Open Question #1 resolution)."
  - "zeroEventAdjustment and SNAPSHOT_LEG_STALENESS_TOLERANCE_MS/isLegFresh are small (3-8 line) private helpers in computePickerSnapshot.ts/snapshotCalendars.ts that this plan's file scope doesn't touch — mirrored locally with an explicit doc comment citing the source, rather than exporting them (which would require editing picker/journal files outside this plan's files_modified list)."

patterns-established:
  - "PICK-04 replay seam: every replay function takes a plain deps object of already-shipped ports (27-01/27-03) + returns Result<T, StorageError>, matching the rest of the codebase's use-case convention even though these aren't classic ForRunningX driver ports (06's runBacktest is the actual orchestrator/composition point)"

requirements-completed: [BT-01, BT-02, BT-03, BT-04]

coverage:
  - id: D1
    description: "Replaying a stored historical cohort reproduces its recorded picker_snapshot score EXACTLY per candidate id; a mismatch names the diverging id/rule; ruleSet drift is flagged separately, not as a false leakage alarm"
    requirement: "BT-02"
    verification:
      - kind: unit
        ref: "packages/core/src/backtest/application/replayPickerCohort.test.ts#replayPickerCohort"
        status: pass
    human_judgment: false
  - id: D2
    description: "The 13-trade walk-forward reproduces the fills-ledger oracle's direction (haircutFill-priced entry+exit, gap rows never selected as the exit trigger, first-actionable-row semantics)"
    requirement: "BT-03"
    verification:
      - kind: unit
        ref: "packages/core/src/backtest/application/replayExitsForCalendar.test.ts#replayExitsForCalendar"
        status: pass
    human_judgment: false
  - id: D3
    description: "The full-universe hypothetical replay scores every cohort through the untouched engine, honors an ablation weights override, and skips gap/degenerate cohorts"
    requirement: "BT-04"
    verification:
      - kind: unit
        ref: "packages/core/src/backtest/application/replayHypotheticalEntry.test.ts#replayHypotheticalEntry"
        status: pass
    human_judgment: false

duration: 65min
completed: 2026-07-09
status: complete
---

# Phase 27 Plan 05: Replay Use-Cases Summary

**Three replay paths (leakage oracle, 13-trade walk-forward, hypothetical full-universe simulation) wired atop the untouched picker/exit engine — zero reimplementation, all three TDD'd against real in-memory port fakes since core can't reach testcontainers.**

## Performance

- **Duration:** 65 min
- **Started:** 2026-07-09T12:15:00Z
- **Completed:** 2026-07-09T13:20:00Z
- **Tasks:** 3
- **Files modified:** 7 (6 created, 1 modified)

## Accomplishments

- `replayPickerCohort` (BT-02): reproduces a stored `picker_snapshot` cohort's exact score per candidate by replaying chain-as-of-observedAt through `selectCandidates` → `scoreCalendarCandidates` → the `eventsContextStatus` post-step → `rankAndCapCandidates`, reusing the frozen `gex`/`events`/status fields verbatim. Guards on ruleSet drift first (rules.ts changing later is flagged, never reported as leakage); diffs by `Map<id>`, never array position; a score mismatch names the diverging candidate id and the specific breakdown criterion.
- `replayExitsForCalendar` (BT-03): walks a closed calendar's full snapshot history (source-inclusive, including `schwab_chain` rows) through the untouched `evaluateExit` with hysteresis threaded forward, comparing the modeled direction/magnitude against `calendar_events.realizedPnl` summed over CLOSE/ROLL (the Phase-22-validated fills ledger). Entry and exit are priced via the shared `haircutFill` on real as-of-T chain quotes when available, falling back to the calendar's real `openNetDebit` / the exit row's raw `netMark` otherwise. A gap/stale/AH row is never selected as the exit trigger.
- `replayHypotheticalEntry` (BT-04 input): scores the full (uncapped) candidate universe at a cohort through the untouched engine, accepting an optional per-rule `weights` override (27-02's ablation seam), then forward-walks each candidate through `evaluateExit` on a synthetic `MarketContext` assembled via `computeLegPairMetrics` from the as-of-T chain slice. GEX reuses the cohort's frozen snapshot fields; economic events use the current live read with a documented leakage caveat attached to every outcome alongside the late-BSM-optimism caveat. Gap/degenerate cohorts never simulate at a fabricated price.
- All three functions + their `Deps`/outcome types are now value-exported from `packages/core/src/backtest/index.ts`, ready for 06's `runBacktest` orchestrator.

## Task Commits

Each task was committed atomically:

1. **Task 1: replayPickerCohort — BT-02 leakage oracle + ruleSet-drift guard** - `2d24b38` (feat)
2. **Task 2: replayExitsForCalendar — BT-03 13-trade walk-forward vs the fills-ledger oracle** - `ac128ab` (feat)
3. **Task 3: replayHypotheticalEntry — BT-04 full-universe entry+exit simulation** - `4d89b6b` (feat, includes the `backtest/index.ts` barrel thread)

_Each task's tests were run RED-verified (a targeted guard/gate was temporarily disabled to confirm the corresponding test fails for the right reason) before landing GREEN, then committed as one `feat` per task — matching this phase's own established task-level TDD granularity (27-01 through 27-04 precedent)._

## Files Created/Modified

- `packages/core/src/backtest/application/replayPickerCohort.ts` — BT-02 leakage oracle; a backtest-owned local Zod schema re-validates the untyped stored snapshot blob
- `packages/core/src/backtest/application/replayPickerCohort.test.ts` — 8 tests: baseline determinism (built by actually running the live use-case once), stale-events reproduction, ruleSet-drift guard, corrupted-score hard failure, membership mismatch, gate-drop mismatch, malformed-blob error, chain-read error propagation
- `packages/core/src/backtest/application/replayExitsForCalendar.ts` — BT-03 13-trade oracle; haircutFill-priced entry/exit with a real-value fallback
- `packages/core/src/backtest/application/replayExitsForCalendar.test.ts` — 7 tests: TAKE/STOP direction reproduction, gap-row-never-selected + first-actionable-row-wins, exact haircut-formula pricing, empty-history degenerate case, StorageError propagation ×2
- `packages/core/src/backtest/application/replayHypotheticalEntry.ts` — BT-04 full-universe simulation; OccSymbol re-branding via parseOccSymbol/formatOccSymbol
- `packages/core/src/backtest/application/replayHypotheticalEntry.test.ts` — 6 tests: full-universe scoring with caveats, weights-override ranking change, gap-cohort skip, degenerate-spot skip, malformed-blob error, chain-read error propagation
- `packages/core/src/backtest/index.ts` — threads all three replay use-cases + their types

## Decisions Made

See `key-decisions` in frontmatter for the full rationale on each. Summary:
- Testcontainers → in-memory port fakes (hard architecture-boundaries constraint, matches existing codebase precedent).
- "Gate-dropped strikes" in BT-04's full-universe replay is structurally unrecoverable without reimplementing candidate-selection; documented as a ponytail: comment with a named upgrade path rather than silently dropping the requirement or attempting a scope-creeping reimplementation.
- Two small, unexported picker/journal helpers (`zeroEventAdjustment`, the leg-staleness tolerance) are mirrored locally rather than exported, since exporting them would require editing files outside this plan's `files_modified` scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed a strike-unit mismatch in replayHypotheticalEntry's leg lookup**
- **Found during:** Task 3 (writing the integration test — 0 outcomes were produced instead of the expected non-empty set)
- **Issue:** `candidate.frontLeg.strike`/`backLeg.strike` are already converted to POINTS (`RawCandidateLeg`'s own convention), but `ChainLegQuoteAsOf.strike` is still the raw ×1000 int convention. The leg lookup compared points against ×1000, so every candidate's front/back leg was reported "missing," NaN-propagated through `computeLegPairMetrics`, and every candidate was silently skipped as indicative.
- **Fix:** Multiply `candidate.frontLeg.strike`/`backLeg.strike` by 1000 before matching against the chain (mirrors `candidate-selection.ts`'s own ×1000→points conversion boundary, applied in reverse).
- **Files modified:** `packages/core/src/backtest/application/replayHypotheticalEntry.ts`
- **Verification:** All 6 tests in `replayHypotheticalEntry.test.ts` pass; confirmed via a standalone debug script that raw candidates were non-zero but simulated outcomes were zero before the fix, and non-zero after.
- **Committed in:** `4d89b6b` (Task 3 commit — the fix landed before the commit, no separate fix commit needed)

**2. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes violation passing `weights` through**
- **Found during:** Task 3 (`bun run typecheck`)
- **Issue:** Spreading `{ ..., weights }` where `weights: Partial<Record<...>> | undefined` violates `exactOptionalPropertyTypes: true` when the caller omits the ablation override (same class of issue 27-02 already hit and documented).
- **Fix:** Conditionally spread `...(weights !== undefined ? { weights } : {})` so the key is omitted entirely rather than set to `undefined`.
- **Files modified:** `packages/core/src/backtest/application/replayHypotheticalEntry.ts`
- **Verification:** `bun run typecheck` clean.
- **Committed in:** `4d89b6b`

---

**Total deviations:** 2 auto-fixed (1 blocking bug, 1 type-strictness bug)
**Impact on plan:** Both fixes were required for correctness; no scope creep. The strike-unit bug would have silently produced an empty backtest report (every candidate skipped) had it shipped.

## Issues Encountered

None beyond the two deviations above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- 27-06 (replay CLI + report assembly) can now import `replayPickerCohort`, `replayExitsForCalendar`, and `replayHypotheticalEntry` from `packages/core/src/backtest/index.ts` and wire them against the real Postgres/memory repos already shipped in 27-01/27-03, feeding their outputs into 27-04's report kernel (`directionalAttribution`, `ablationDelta`, `bootstrapCi`, `coveragePercent`).
- Full monorepo suite (258 files, 2606 tests, including testcontainers) green; `bun run typecheck` and `bun run lint` both clean.
- The BT-04 "gate-dropped strikes" gap (documented in key-decisions) is a known, flagged limitation 06's report should surface as a caveat, or a future plan could close with an additive `includeGateDropped` diagnostic export.
- No blockers.

---
*Phase: 27-pick-04-backtest-harness*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 7 created/modified files verified present on disk; all 3 task commits (`2d24b38`, `ac128ab`, `4d89b6b`) verified present in git history.
