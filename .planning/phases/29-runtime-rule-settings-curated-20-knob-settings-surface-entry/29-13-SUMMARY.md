---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
plan: 13
subsystem: api
tags: [hono, zod, mcp, rule-overrides, hexagonal-adapters, tdd]

# Dependency graph
requires:
  - phase: 29-02
    provides: "ruleOverrides / getRuleSettingsResponse / setRuleOverridesRequest / setRuleOverridesResponse contracts — the single validation seam this plan's route and MCP tools parse through"
  - phase: 29-08
    provides: "makePostgresRuleOverridesRepo (+ memory twin) — the shared repo instance main.ts already constructs and this plan reuses"
  - phase: 29-09
    provides: "makeGetRuleSettingsUseCase / makeSetRuleOverridesUseCase, computeEffective/mergeStoredOverrides — this plan's two use-cases"
  - phase: 29-12
    provides: "ruleOverridesRepo construction + main.ts's regime-board wiring precedent this plan's composition-root additions land after (sequential shared-file wiring)"
provides:
  - "GET/PUT /api/settings/rules — settingsRoutes factory, JWT-gated via authReadGroup"
  - "MCP get_rule_settings / set_rule_overrides tools sharing the SAME contract as the HTTP route"
  - "Server composition-root `defaults` computed from resolvePickerRuleConfig()/resolveExitRuleConfig()/resolveRegimeRuleConfig() with no overrides — the settings surface's defaults can never drift from the compile-time constants"
  - "resolvePickerRuleConfig/resolveExitRuleConfig/resolveRegimeRuleConfig (+ Config/Overrides types) now re-exported from the top-level @morai/core barrel — the ONE apps→core wiring point this plan needed"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "toOverridesPatch (settings.routes.ts + tools.ts) — a JSON round-trip past a mapped-type-vs-index-signature TS incompatibility: zod's z.infer output is a mapped type and does NOT get TypeScript's implicit-index-signature leniency that a hand-written interface gets, so a zod-parsed request body cannot be passed directly as a JsonObject-indexed core type without this conversion (confirmed via a real tsc repro, not assumed)"
    - "MCP inputSchema reuse via ZodObject.shape — set_rule_overrides' inputSchema is setRuleOverridesRequest.shape directly (no hand-mirrored field list), guaranteeing the MCP tool's declared shape can never drift from the HTTP contract"
    - "Composition-root defaults flattening — main.ts is the ONE apps→core call site for the three engines' resolve functions; it flattens their differently-shaped output (nested PickerRuleConfig/ExitRuleConfig/RegimeRuleConfig) into the contracts' flat ruleConfig field names, verified byte-for-byte against the live resolve output before wiring"

key-files:
  created:
    - apps/server/src/adapters/http/settings.routes.ts
    - apps/server/src/adapters/http/settings.routes.test.ts
  modified:
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/tools.test.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/main.ts
    - packages/core/src/index.ts
    - packages/core/src/exits/index.ts
    - packages/core/src/analytics/index.ts

key-decisions:
  - "PUT body cannot be passed directly to the settings use-cases' RuleOverridesPatch param — zod's mapped-type inference doesn't satisfy TS's index-signature assignability the way a hand-written type does. Verified with a real tsc repro (not assumed) before adding the JSON round-trip conversion (toOverridesPatch/isRuleOverridesPatch), matching the existing postgres/memory rule-overrides repos' own toJsonSafe idiom exactly."
  - "resolvePickerRuleConfig was already re-exported at the top @morai/core barrel from an earlier plan's picker/index.ts export, but resolveExitRuleConfig/resolveRegimeRuleConfig were NOT — added both to exits/index.ts and analytics/index.ts, then to the top-level barrel (Rule 3: blocking issue, the plan's Task 3 explicitly requires main.ts to call all three)."
  - "set_rule_overrides' inputSchema reuses setRuleOverridesRequest.shape (the raw ZodRawShape) rather than a hand-typed field list — since the nested picker/exits/regime schemas carry their OWN refines (weight-sum, hysteresis pairs), the MCP SDK's own shape-level validation rejects a bad weight sum before the handler runs; the bad-weight-sum test uses callToolHandlerDirect (bypassing SDK validation) to exercise the handler's own safeParse fallback, mirroring the existing get_rule_tags/set_rule_tags precedent for SDK-level-rejected input."
  - "GET route did not need the toOverridesPatch conversion — Zod's .parse(data: unknown) accepts any typed value, so passing the JsonObject-typed use-case result directly through getRuleSettingsResponse.parse(...) has no assignability issue."

requirements-completed: []

coverage:
  - id: D1
    description: "GET /api/settings/rules returns { defaults, overrides, effective }, JWT-gated via authReadGroup; PUT validates via the contract (unknown keys, weight-sum, single-sided hysteresis all 400) and returns the new effective config; { picker: null } resets that group to defaults"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/settings.routes.test.ts (9 tests: GET happy/override/500, PUT valid/reset/unknown-key/weight-sum/hysteresis/500)"
        status: pass
    human_judgment: false
  - id: D2
    description: "MCP get_rule_settings / set_rule_overrides tools share the SAME contract schemas as the HTTP routes; registered via the optional-param if(x!==undefined) idiom"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/mcp/tools.test.ts (11 new tests incl. two MCP-02 parity checks: tool payload === HTTP route payload for the same use-case)"
        status: pass
      - kind: integration
        ref: "apps/server/src/adapters/mcp/mcp.test.ts (unchanged assertions still pass — confirms the new optional trailing params don't break existing makeMcpRouter call sites)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Server composition root builds `defaults` from resolvePickerRuleConfig()/resolveExitRuleConfig()/resolveRegimeRuleConfig() (no hardcoded knob literals); settingsRoutes mounted under the JWT authReadGroup; typecheck + lint clean"
    verification:
      - kind: other
        ref: "bun run typecheck && bun run lint (workspace-wide, clean); ad-hoc bun script printing the three resolve functions' live output, hand-verified against the flattening logic and 29-CONTEXT.md's documented defaults"
        status: pass
      - kind: integration
        ref: "bun run test (full workspace: 275 files, 2928 tests, all green — confirms the barrel-export additions didn't regress any other consumer)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 13: Runtime Rule Settings — HTTP + MCP Surface Entry Summary

**GET/PUT /api/settings/rules (JWT-gated, Zod-validated) plus the get_rule_settings/set_rule_overrides MCP tool pair, both sharing the 29-02 contract, wired at the server composition root with defaults computed live from the three engines' own resolve functions — the curated ~20 knobs are now readable and writable over an authed HTTP + MCP surface with zero drift from the compile-time constants.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-10T00:50:00-05:00 (approx.)
- **Completed:** 2026-07-10T01:09:00-05:00
- **Tasks:** 3/3 completed
- **Files modified:** 9 (2 created, 7 modified)

## Accomplishments

- `settingsRoutes(getRuleSettings, setRuleOverrides)` — a Hono factory mirroring
  `journal-rules.routes.ts`'s thin-adapter shape exactly: `GET /settings/rules` parses the
  use-case result through `getRuleSettingsResponse`; `PUT /settings/rules` runs
  `zValidator("json", setRuleOverridesRequest)` (400s on unknown keys, a non-100 weight sum,
  or a single-sided hysteresis pair before the handler body ever runs), then parses through
  `setRuleOverridesResponse`. Zero business logic — parse → call → map Result → respond.
- `registerGetRuleSettingsTool` / `registerSetRuleOverridesTool` in `tools.ts`, registered in
  `server.ts`'s per-request closure via the SAME optional-param `if (x !== undefined)` idiom
  every prior MCP tool uses. `set_rule_overrides`'s `inputSchema` is
  `setRuleOverridesRequest.shape` directly — the MCP tool's declared parameter shape can never
  drift from the HTTP contract because it IS the HTTP contract's raw shape.
- Discovered (via a real `tsc` repro, not assumed) that a zod-inferred request body cannot be
  passed directly as `RuleOverridesPatch` — zod's mapped-type output doesn't get TypeScript's
  implicit-index-signature leniency that a hand-written type gets. Added `toOverridesPatch` /
  `isRuleOverridesPatch` (a JSON round-trip + type guard) in both `settings.routes.ts` and
  `tools.ts`, matching the existing postgres/memory rule-overrides repos' own `toJsonSafe`
  idiom exactly (no `as`, no `any`).
- `apps/server/src/main.ts` computes `ruleSettingsDefaults` ONCE at boot by calling
  `resolvePickerRuleConfig()`, `resolveExitRuleConfig()`, `resolveRegimeRuleConfig()` with no
  overrides, then flattens each engine's differently-shaped output into the contracts' flat
  field names (`deltaBandMin`, `vixLadder.normalMin/elevatedMin/crisisMin`,
  `exits.take.plus15Arm/Disarm`, `regime.vvixWarn`, etc.) — verified byte-for-byte against the
  live resolve output via an ad-hoc script before wiring, matching 29-CONTEXT.md's documented
  defaults exactly (deltaBandMin=-0.49, 9 weights summing to 100, VIX ladder 15/20/25, TAKE
  +15/+10/+5% rungs, STOP -50/-25% rungs, all 4 regime warn/crisis pairs).
- `resolvePickerRuleConfig`/`resolveExitRuleConfig`/`resolveRegimeRuleConfig` (+ their
  `*RuleConfig`/`*RuleOverrides` types) added to `exits/index.ts` and `analytics/index.ts`
  (picker's was already barreled) and re-exported from the top-level `@morai/core` barrel —
  the ONE `apps → core` call site this plan's Task 3 needed.
- `settingsRoutes(getRuleSettings, setRuleOverrides)` mounted inside `apiRouter` (under the
  JWT `authReadGroup` middleware, same trust boundary as every other data route); the two
  use-cases threaded into `makeMcpRouter(...)` as new trailing optional params.
- Full workspace test suite (275 files, 2928 tests) and `bun run typecheck && bun run lint`
  both clean after the barrel-export additions — no regression to any existing consumer.

## Task Commits

Each task was committed atomically:

1. **Task 1: settings.routes.ts — GET/PUT /api/settings/rules (auth-gated, Zod-validated)** -
   `9336330` (feat, TDD RED→GREEN — RED confirmed via a real failing run before the
   implementation file existed, then restored and confirmed GREEN)
2. **Task 2: MCP get_rule_settings / set_rule_overrides tools sharing the contract** -
   `99e1319` (feat)
3. **Task 3: server main.ts — wire settings use-cases with injected engine-computed defaults** -
   `39bbce5` (feat)

## Files Created/Modified

- `apps/server/src/adapters/http/settings.routes.ts` - `settingsRoutes` factory (GET/PUT
  `/settings/rules`), `toOverridesPatch`/`isRuleOverridesPatch` conversion helpers.
- `apps/server/src/adapters/http/settings.routes.test.ts` - 9 tests covering every
  `<behavior>` bullet (auth itself is verified structurally by the Task 3 mount, matching the
  established `journal-rules.routes.test.ts` precedent of not unit-testing auth at the
  isolated-route layer).
- `apps/server/src/adapters/mcp/tools.ts` - `registerGetRuleSettingsTool`,
  `registerSetRuleOverridesTool`, the same `toOverridesPatch`/`isRuleOverridesPatch` helpers.
- `apps/server/src/adapters/mcp/tools.test.ts` - 11 new tests incl. two MCP-02 parity checks
  (tool payload deep-equals the HTTP route payload for the same use-case + same input).
- `apps/server/src/adapters/mcp/server.ts` - two new optional trailing params
  (`getRuleSettings`, `setRuleOverrides`) on `makeMcpRouter`, registered via the existing
  `if (x !== undefined)` idiom.
- `apps/server/src/main.ts` - `ruleSettingsDefaults` construction (flattening the three
  engines' resolve-function output), `getRuleSettings`/`setRuleOverrides` use-case
  construction (reusing the existing `ruleOverridesRepo`), `settingsRoutes` mount inside
  `apiRouter`, and the two use-cases threaded into `makeMcpRouter`.
- `packages/core/src/index.ts` - re-exports `resolvePickerRuleConfig`/`resolveExitRuleConfig`/
  `resolveRegimeRuleConfig` (+ their Config/Overrides types) at the top-level barrel.
- `packages/core/src/exits/index.ts` / `packages/core/src/analytics/index.ts` - added
  `resolveExitRuleConfig`/`resolveRegimeRuleConfig` (+ types) to their bounded-context barrels
  (picker's `resolvePickerRuleConfig` was already exported there from an earlier plan).

## Decisions Made

- The PUT body's TS-incompatibility with `RuleOverridesPatch` (documented above under
  key-decisions) was confirmed empirically with a real `tsc --build` run against the actual
  project types before adding the conversion — not assumed from a simplified mental model.
  An initial scratch reproduction with hand-written (non-zod) types compiled fine, which would
  have led to a wrong "no conversion needed" conclusion; testing against the REAL zod-inferred
  contract types surfaced the actual mapped-type incompatibility.
- Barrel-export additions (`resolveExitRuleConfig`, `resolveRegimeRuleConfig`) are scoped
  strictly to what Task 3 needs — no speculative re-export of every domain function, matching
  the existing barrel's own selective-export convention.
- `set_rule_overrides`'s bad-weight-sum test uses `callToolHandlerDirect` (bypassing the MCP
  SDK's own shape-level validation) rather than the standard `callTool` helper, since
  `inputSchema.shape.picker` carries the SAME nested weight-sum refine as the contract — the
  SDK rejects it before the handler ever runs, exactly mirroring the existing
  `get_rule_tags`/`set_rule_tags` precedent for SDK-level-rejected input.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing `resolveExitRuleConfig`/`resolveRegimeRuleConfig` barrel exports**
- **Found during:** Task 3 (server main.ts wiring)
- **Issue:** The plan's Task 3 explicitly requires `main.ts` to call
  `resolvePickerRuleConfig()`, `resolveExitRuleConfig()`, `resolveRegimeRuleConfig()` — but
  only `resolvePickerRuleConfig` was re-exported from the top-level `@morai/core` barrel (from
  an earlier plan's `picker/index.ts` export); `exits/index.ts` and `analytics/index.ts` never
  exported their own resolve functions, so `apps/server` could not import them at all.
- **Fix:** Added `resolveExitRuleConfig`/`ExitRuleConfig`/`ExitRuleOverrides` to
  `exits/index.ts`, `resolveRegimeRuleConfig`/`RegimeRuleConfig`/`RegimeRuleOverrides` to
  `analytics/index.ts`, and re-exported all three resolve functions (+ types) from the
  top-level `packages/core/src/index.ts` barrel.
- **Files modified:** `packages/core/src/exits/index.ts`, `packages/core/src/analytics/index.ts`,
  `packages/core/src/index.ts`
- **Verification:** `bun run typecheck` clean; full workspace test suite (275 files, 2928
  tests) green after the change.
- **Committed in:** `39bbce5` (Task 3 commit)

**2. [Rule 1 - Bug] PUT body could not be passed directly to `RuleOverridesPatch`**
- **Found during:** Task 1 (`bun run typecheck` after the first draft of `settings.routes.ts`)
- **Issue:** The zod-inferred `SetRuleOverridesRequest` type is a mapped type; TypeScript does
  not extend its implicit-index-signature-assignability leniency to mapped types the way it
  does for hand-written interfaces, so `setRuleOverrides(body)` failed to typecheck
  (`Property 'picker' is incompatible with index signature`).
- **Fix:** Added `toOverridesPatch`/`isRuleOverridesPatch` — a JSON round-trip that drops the
  zod-inferred `| undefined` from optional fields, then a type-guard narrow to
  `RuleOverridesPatch` — matching the existing postgres/memory rule-overrides repos' own
  `toJsonSafe` idiom (same technique, new call site). Applied identically in the MCP
  `set_rule_overrides` tool (Task 2).
- **Files modified:** `apps/server/src/adapters/http/settings.routes.ts`,
  `apps/server/src/adapters/mcp/tools.ts`
- **Verification:** `bun run typecheck` clean; all route + MCP tests green, incl. the
  `{ picker: null }` reset-per-group round-trip test asserting the captured patch equals the
  original request body exactly.
- **Committed in:** `9336330` (Task 1 commit), `99e1319` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking barrel-export, 1 bug/typecheck-blocking
conversion). **Impact on plan:** Both auto-fixes were required to complete the plan's own
explicit Task 3 instructions and Task 1's typecheck requirement — no scope creep, no
speculative additions beyond what the tasks needed.

## Issues Encountered

None beyond the two auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The curated ~20 knobs are readable/writable over an authed HTTP + MCP surface with defaults
  sourced live from the engines — no drift possible between the displayed defaults and the
  compile-time constants (T-29-18 mitigated).
- `apps/server/src/main.ts`'s `getRuleSettings`/`setRuleOverrides` use-cases and
  `ruleSettingsDefaults` are available for 29-14 (or any follow-on plan) to reuse without
  re-deriving the flattening logic.
- No blockers. `bun run typecheck && bun run lint` clean workspace-wide; full test suite (275
  files, 2928 tests) green.

---
*Phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry*
*Completed: 2026-07-10*

## Self-Check: PASSED
