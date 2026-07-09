# Deferred Items — Phase 28

## `apps/web` is not wired into the root `tsc --build` project graph

**Found during:** 28-06, Task 1 self-verification (running `bunx tsc --build apps/web/tsconfig.json
--force` directly, since `bun run typecheck` — `tsc --build --force` against the root
`tsconfig.json` — never checks `apps/web` at all).

**Issue:** The root `tsconfig.json`'s `references` array lists `packages/shared`,
`packages/contracts`, `packages/core`, `packages/adapters`, `apps/server`, `apps/worker` — but
**not** `apps/web`. `bun run typecheck` (the project's only typecheck script) therefore silently
never typechecks the web app, on any branch, ever. A direct `tsc --build apps/web/tsconfig.json
--force` surfaces 13 pre-existing errors unrelated to this plan's files:

- `apps/web/src/components/ErrorBoundary.tsx` / `.test.tsx` — missing `override` modifiers (2),
  implicit `any` params in the test (2)
- `apps/web/src/components/system/Button.tsx(97,48)` — `exactOptionalPropertyTypes` violation
- `apps/web/src/hooks/useMacro.test.ts(60-61)` — index-signature property access
  (`noPropertyAccessFromIndexSignature`)
- `apps/web/src/lib/candidate-to-position.test.ts(117)`, `apps/web/src/lib/tos-order.test.ts(44)`
  — `exitPlan` literals missing `thetaCapturePct` (added by an earlier Phase-28-adjacent plan)
- `apps/web/src/lib/parsed-calendar-to-candidate.ts(18)` — `PickerCandidate` literal missing
  `context`/`bucket` (added by Plans 28-03/28-05)
- `apps/web/src/screens/Analyzer.test.tsx(892)` — `gateDrops` literal missing
  `termInverted`/`eventBlackout`
- `apps/web/src/screens/JournalContainer.test.tsx(99)` — a `Promise<T | undefined>` not
  assignable to `Promise<T>`

**Why deferred, not fixed:** None of these files are in 28-06's `files_modified` list and none
were touched by this plan's changes (confirmed via a before/after error-count diff: 15 → 13,
where the 2 fixed were `CandidateCard.test.tsx`'s `thetaCapturePct` gaps — in-scope, since that
file IS a 28-06 target — and Analyzer.tsx's pre-existing missing `RuleSetEntry` barrel export,
fixed as a one-line addition to the same `packages/contracts/src/index.ts` export block this
plan already needed to touch for `PickerGate`/`PickerSizing`). The remaining 13 are unrelated,
scattered across files this plan never opens — fixing them is a separate cleanup task, not part
of "board gate chip + Analyzer sizing count + bucket label."

**Recommendation:** A future phase/plan should either (a) add `apps/web` to the root
`tsconfig.json`'s `references` so `bun run typecheck` actually covers it, then fix the resulting
backlog, or (b) add a dedicated `apps/web`-only typecheck script if there's a reason to keep it
out of the root build graph. Left as-is here — this plan's own new/changed files
(`RegimeBoard.tsx`, `EntryExitPlan.tsx`, `CandidateCard.tsx`, `Analyzer.tsx`,
`packages/contracts/src/index.ts`) introduce zero new errors, verified via the same direct
`tsc --build apps/web/tsconfig.json --force` command.
