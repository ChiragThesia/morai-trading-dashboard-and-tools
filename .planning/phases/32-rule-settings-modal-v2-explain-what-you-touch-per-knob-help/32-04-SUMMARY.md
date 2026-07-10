---
phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help
plan: 04
subsystem: api
tags: [preview, settings, mcp, http, dry-run, hexagonal]

requires:
  - phase: 32-01
    provides: "previewRuleOverridesRequest/Response contracts"
  - phase: 32-02
    provides: "makePreviewPickerRuleOverridesUseCase (picker branch)"
  - phase: 32-03
    provides: "makePreviewExitRuleOverridesUseCase (exits branch)"
provides:
  - "packages/core/src/settings/application/previewRuleOverrides.ts — makePreviewRuleOverridesUseCase (B4)"
  - "POST /api/settings/rules/preview (B7)"
  - "preview_rule_overrides MCP tool (B8, MCP-02 parity)"
affects:
  - "apps/web (Rule Settings modal v2 preview UI, later plans this phase)"

tech-stack:
  added: []
  patterns:
    - "A group absent from the combined use-case's input yields a null response branch (never computed) — distinct from the picker engine's own available:false cold-start state, which IS computed"
    - "JSON round-trip + shallow shape-guard predicate (mirrors rule-overrides-bridge.ts's toOverridesPatch, WR-01) bridges a zod-inferred body into a domain override type under exactOptionalPropertyTypes without an `as` cast"

key-files:
  created:
    - packages/core/src/settings/application/previewRuleOverrides.ts
    - packages/core/src/settings/application/previewRuleOverrides.test.ts
  modified:
    - packages/core/src/index.ts
    - apps/server/src/adapters/http/settings.routes.ts
    - apps/server/src/adapters/http/settings.routes.test.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/tools.test.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/main.ts

key-decisions:
  - "RulePreviewResult's picker/exits branches are null when the corresponding input group is ABSENT (branch skipped, zero I/O) — not when the engine reports an empty/cold-start result. This distinguishes 'user didn't stage this group' from 'staged but nothing to preview against' (picker's own available:false), matching the plan's exact 'a group absent from the input yields a null branch' wording."
  - "toPreviewInput does NOT reuse toOverridesPatch's RuleOverridesPatch output type — that type's index-signature JsonObject shape is not structurally assignable to the domain PickerRuleOverrides/ExitRuleOverrides types the preview ports require (named fields, not an index signature), unlike the PUT route's generic merge path. Instead each route/tool writes its own tiny JSON-round-trip + shape-guard predicate producing the correctly-typed RulePreviewInput, duplicated verbatim between the HTTP route and MCP tool (32-03 precedent: the shared bridge file is out of this task's files_modified scope)."
  - "PickerRuleOverrides/ExitRuleOverrides are imported into the combined use-case from each context's OWN public barrel (picker/index.ts, exits/index.ts) rather than via a Parameters<> derivation off the driver port — the top-level @morai/core barrel already re-exports these two types through the identical path (packages/core/src/index.ts's 29-13 section), so this is the established cross-context application-layer surface, not a domain/ import (architecture-boundaries §7)."
  - "The HTTP route maps the picker branch's available:false (cold start, computed but nothing to preview) to a null response.picker, same as an absent branch — the wire contract only distinguishes 'nothing to show', not 'why'."

requirements-completed: [B4, B7, B8]

coverage:
  - id: D1
    description: "ONE combined use-case branches per staged group; HTTP route + MCP tool both call it — no duplicated orchestration"
    requirement: B4
    verification:
      - kind: unit
        ref: "packages/core/src/settings/application/previewRuleOverrides.test.ts — only-picker-staged/only-exits-staged/both/neither branch tests"
        status: pass
      - kind: unit
        ref: "apps/server/src/adapters/mcp/tools.test.ts#MCP-02 parity (byte-parity): the tool returns the SAME payload as POST /api/settings/rules/preview for the SAME empty-groups body"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /api/settings/rules/preview validates strictly, calls the use-case, parses through previewRuleOverridesResponse, never persists"
    requirement: B7
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/settings.routes.test.ts#POST /api/settings/rules/preview (7 tests: 200+asOf, universe note, empty-group byte-parity, 400 unknown key, no-persist determinism, 500 storage error)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The MCP preview_rule_overrides tool shares the identical request/response schema and use-case with the HTTP route"
    requirement: B8
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/mcp/tools.test.ts#preview_rule_overrides MCP tool (4 tests incl. MCP-02 byte-parity against the live route)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Mounted behind the same Bearer/JWT gate as the existing settings PUT — no new unauthenticated surface"
    requirement: B7
    verification:
      - kind: unit
        ref: "apps/server/src/main.ts — settingsRoutes(...) mounted inside apiRouter/authReadGroup (unchanged group); makeMcpRouter call inside the existing bearer-gated /mcp/* mount"
        status: pass
    human_judgment: false

duration: ~1h
completed: 2026-07-10
status: complete
---

# Phase 32 Plan 04: Combined preview use-case + HTTP route + MCP twin Summary

**One combined settings-context preview use-case branches per staged group (picker/exits) over the two engine preview use-cases from Plans 02/03, exposed identically as `POST /api/settings/rules/preview` and the `preview_rule_overrides` MCP tool — the one seam that can never drift between transports.**

## Performance

- **Duration:** ~1h
- **Tasks:** 3
- **Files modified:** 9 (2 created, 7 modified)

## Accomplishments

- `makePreviewRuleOverridesUseCase` (B4): branches per staged group — `picker` present in the input calls `previewPicker`; `exits` present calls `previewExit`; a group absent from the input is never computed and its response branch is `null`. `asOf` is sourced from the picker branch when it was computed and reports `available: true`.
- Exported the three preview use-cases (combined + both engines) and every preview port/result/deps type through the top `packages/core/src/index.ts` barrel (Plans 02/03 deliberately deferred this edit to avoid a Wave-1 conflict).
- `POST /api/settings/rules/preview` (B7): `settingsRoutes` gains a third param; the route zValidator-parses the body against `previewRuleOverridesRequest` (identity-reused from `ruleOverrides`), converts it to `RulePreviewInput`, calls the combined use-case, maps the picker branch's `available:false` to a null response branch, and parses the result through `previewRuleOverridesResponse`. Mounted in the same authenticated `apiRouter`/`authReadGroup` as the existing GET/PUT.
- `preview_rule_overrides` MCP tool (B8): registers with the identical `previewRuleOverridesRequest`/`Response` schema and calls the SAME composed `previewRuleOverrides` use-case instance `main.ts` builds for the HTTP route — byte-parity is structural (same use-case instance), not merely tested-in.
- `main.ts` composes `previewPicker`/`previewExit`/the combined use-case from the already-built `pickerSnapshotRepo`/`ruleOverridesRepo`/`calendarsRepo`/exit-read closures (`readHeldPositionsForExits`, `readLatestSnapshotForExits`, `exitVerdictsRepo`, `economicEventsRepo`) — zero new repos, mirroring the worker's own `readOpenCalendars: calendarsRepo.getOpenCalendars` wiring convention.

## Task Commits

Each task was committed atomically:

1. **Task 1: Combined settings preview use-case + settings ports + top core barrel** — `d512e5f` (feat)
2. **Task 2: POST /api/settings/rules/preview route + tests + main.ts composition** — `f6f58dd` (feat)
3. **Task 3: MCP preview_rule_overrides twin + registration + main.ts pass-through** — `3fa6543` (feat)

_Followed project `tdd.md`'s "commit only at green" rule (32-02/32-03 precedent) — each task's test suite was run and confirmed green before its commit; no separate `test()`/`feat()` commit pair._

## Files Created/Modified

- `packages/core/src/settings/application/previewRuleOverrides.ts` — the combined use-case: `makePreviewRuleOverridesUseCase`, `PreviewRuleOverridesDeps`, `RulePreviewInput`, `RulePreviewResult`, `ForRunningPreviewRuleOverrides`.
- `packages/core/src/settings/application/previewRuleOverrides.test.ts` — 8 tests covering the four branch combinations, `asOf` sourcing (including the picker cold-start case), StorageError propagation from either engine, and port hygiene.
- `packages/core/src/index.ts` — exports the combined use-case + its types, plus the two engine preview use-cases + their port/result/deps types (deferred from Plans 02/03).
- `apps/server/src/adapters/http/settings.routes.ts` — `settingsRoutes` gains the `previewRuleOverrides` param + the `POST /settings/rules/preview` handler; `toPreviewInput`/`isPickerRuleOverridesShape`/`isExitRuleOverridesShape` helpers.
- `apps/server/src/adapters/http/settings.routes.test.ts` — 7 new tests for the preview route (200+asOf, universe note, empty-group byte-parity, 400 unknown key, no-persist determinism across two identical calls, 500 storage error); existing `buildTestApp` updated with a defaulted third arg.
- `apps/server/src/adapters/mcp/tools.ts` — `registerPreviewRuleOverridesTool` + the same `toPreviewInput`/shape-guard helpers duplicated verbatim (32-03 precedent).
- `apps/server/src/adapters/mcp/tools.test.ts` — 4 new tests for the tool (valid response, storage-error, invalid-params, and a live byte-parity assertion against the HTTP route for the same empty-groups body); fixed a pre-existing 2-arg `settingsRoutes(...)` call this plan's Task 2 signature change left broken.
- `apps/server/src/adapters/mcp/server.ts` — `makeMcpRouter` gains an optional `previewRuleOverrides` param, registered only when defined.
- `apps/server/src/main.ts` — composes `previewPicker`/`previewExit`/the combined use-case; mounts the route; passes the use-case into `makeMcpRouter`.

## Decisions Made

See `key-decisions` in the frontmatter. In short: (1) a group's response branch is null exactly when that group was absent from the request (not when the underlying engine reports an empty/cold-start result — those two are structurally distinct); (2) `toOverridesPatch`'s `RuleOverridesPatch` output type doesn't fit the preview ports' domain-typed staged params, so each adapter carries its own small JSON-round-trip + shape-guard bridge instead; (3) `PickerRuleOverrides`/`ExitRuleOverrides` are imported into the combined use-case via each context's own public barrel, matching the top-level `@morai/core` barrel's own re-export path.

## Deviations from Plan

**1. [Implementation detail] `toPreviewInput` does not literally reuse `toOverridesPatch`, despite the plan's read_first/behavior text suggesting it.**
- **Found during:** Task 2, while wiring the route.
- **Issue:** `toOverridesPatch`'s return type (`RuleOverridesPatch = {[group: string]: JsonObject | null | undefined}`) is an index-signature type built for the PUT route's generic merge step. The preview ports need the CONCRETE domain types `PickerRuleOverrides`/`ExitRuleOverrides` (named optional fields). A `JsonObject` value is not structurally assignable to those types without an `as` cast, which `.claude/rules/typescript.md` forbids.
- **Fix:** Wrote a parallel `toPreviewInput` (JSON round-trip + a shallow type-guard predicate, the same idiom `toOverridesPatch`/`isRuleOverridesPatch` already establish) that produces the correctly-typed `RulePreviewInput` directly. No cast anywhere in the diff.
- **Files modified:** `apps/server/src/adapters/http/settings.routes.ts`, `apps/server/src/adapters/mcp/tools.ts`.
- **Commits:** `f6f58dd`, `3fa6543`.

**2. [Rule 1 - bug] Fixed a pre-existing broken `settingsRoutes(...)` call in `tools.test.ts`.**
- **Found during:** Task 3, while typechecking.
- **Issue:** `tools.test.ts`'s `get_rule_settings` MCP-02 parity test called `settingsRoutes(getRuleSettingsOk, noopSetRuleOverrides)` with only 2 args — this plan's Task 2 change to `settingsRoutes`'s signature (3rd required param) made that call a type error.
- **Fix:** Added a `noopPreviewRuleOverrides` fake as the third argument.
- **Files modified:** `apps/server/src/adapters/mcp/tools.test.ts`.
- **Commit:** `3fa6543`.

## Issues Encountered

None beyond the typing friction documented above (Deviation 1).

## User Setup Required

None — no external service configuration required.

## Known Stubs

None. Both adapters are fully wired against the real combined use-case (composed from the real Plan 02/03 engines in `main.ts`) — no placeholder branch, no mock data path. Regime preview is deliberately NOT part of this response (client-side per `32-CONTEXT.md`'s resolved decision), which is a scoping fact, not a stub.

## Next Phase Readiness

- The server surface of Phase 32 is complete: `POST /api/settings/rules/preview` and `preview_rule_overrides` are both live, authenticated, strict-validated, and structurally never persist.
- Ready for the remaining phase plans (explainer registry UI, preview panel UI, regime client-side preview) to consume this endpoint/tool.
- No blockers.

---
*Phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: packages/core/src/settings/application/previewRuleOverrides.ts
- FOUND: packages/core/src/settings/application/previewRuleOverrides.test.ts
- FOUND: apps/server/src/adapters/http/settings.routes.ts (POST /settings/rules/preview handler present)
- FOUND: apps/server/src/adapters/mcp/tools.ts (registerPreviewRuleOverridesTool present)
- FOUND: .planning/phases/32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help/32-04-SUMMARY.md
- FOUND commit d512e5f (feat: combined settings preview use-case + top core barrel)
- FOUND commit f6f58dd (feat: POST /api/settings/rules/preview route + main.ts composition)
- FOUND commit 3fa6543 (feat: preview_rule_overrides MCP tool + registration + main.ts wiring)
