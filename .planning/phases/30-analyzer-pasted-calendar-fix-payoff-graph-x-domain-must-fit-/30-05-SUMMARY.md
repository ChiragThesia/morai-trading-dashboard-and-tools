---
phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-
plan: 05
subsystem: api
tags: [hono, zValidator, mcp, picker, zod, hexagonal]

# Dependency graph
requires:
  - phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-
    provides: analyzeAdHocCalendarRequest/Response Zod contract pair (30-03) + makeAnalyzeAdHocCalendarUseCase/ForAnalyzingAdHocCalendar (30-04)
provides:
  - "POST /api/picker/analyze — authenticated HTTP route scoring one pasted PUT calendar"
  - "analyze_ad_hoc_calendar MCP tool — same use-case, same schema (MCP-02)"
  - "Server composition root now builds economicEventsRepo, pickerHistoryRepo, readGexContextForPicker, and composes analyzeAdHocCalendar"
affects: [30-06-web-paste-flow-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zod-validated mutation route (settings.routes.ts precedent) reused for a scoring endpoint, not just a write"
    - "MCP tool safeParse-the-same-schema pattern (registerSetRuleOverridesTool precedent) reused for analyze_ad_hoc_calendar"
    - "server.ts composition-root mapping closure (toAbsGammaStrike/readGexContextForPicker) copied verbatim from apps/worker/src/main.ts so both apps read the identical GexContextForPicker shape"

key-files:
  created: []
  modified:
    - apps/server/src/adapters/http/picker.routes.ts
    - apps/server/src/adapters/http/picker.routes.test.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/tools.test.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/main.ts
    - apps/server/src/config.ts

key-decisions:
  - "Both scored:true and scored:false map to HTTP 200 (never 404/500) — binding #2 overrides 30-PATTERNS.md's suggested 404-no-snapshot mirror; the plan's own must_haves/behavior spec is authoritative over the pattern-map's discretionary suggestion."
  - "registerAnalyzeAdHocCalendarTool registered in server.ts (not main.ts) — matches the established registerGetPickerCandidatesTool/registerSetRuleOverridesTool precedent exactly (MCP registration always lives in server.ts's per-request closure; main.ts only composes the use-case and passes it as an argument)."
  - "Added BSM_DIVIDEND_YIELD/BSM_RATE_FALLBACK to apps/server/src/config.ts (defaulted, matching apps/worker/src/config.ts's own defaults) — the server had never needed BSM rate/dividend tunables before this use-case; no new required Railway env var."

requirements-completed: [D-02]

coverage:
  - id: D1
    description: "POST /api/picker/analyze Zod-validates the body, calls the use-case, and returns 200 {scored, candidate, reason} for both scored:true and scored:false (no-snapshot) — never a hard error for the paste flow"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/picker.routes.test.ts#POST /picker/analyze"
        status: pass
    human_judgment: false
  - id: D2
    description: "The route is zValidator-gated by analyzeAdHocCalendarRequest (400 on backDte<=frontDte and on a client-supplied spot key via .strict()) and mounted inside the authenticated apiRouter"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/picker.routes.test.ts#returns 400 on an invalid body (backDte <= frontDte)"
        status: pass
      - kind: unit
        ref: "apps/server/src/adapters/http/picker.routes.test.ts#returns 400 on a body with a client-supplied spot key (.strict() rejects it)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A StorageError from the use-case maps to a flat {error:'internal'} 500 on both the HTTP route and the MCP tool, never leaking DB internals"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/picker.routes.test.ts#does not leak storage-error internals into the response (T-30-16)"
        status: pass
      - kind: unit
        ref: "apps/server/src/adapters/mcp/tools.test.ts#returns 'internal error' text on a storage error (never throws, T-30-16)"
        status: pass
    human_judgment: false
  - id: D4
    description: "analyze_ad_hoc_calendar MCP tool uses the SAME analyzeAdHocCalendarRequest/Response schema as the HTTP route, invoked via a real McpServer + InMemoryTransport client (not a direct use-case call)"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/mcp/tools.test.ts#analyze_ad_hoc_calendar MCP tool"
        status: pass
    human_judgment: false
  - id: D5
    description: "Server composition root composes analyzeAdHocCalendar with all 6 read ports (readPickerSnapshot, readGexContext, readEconomicEvents, readDailySpotCloses, readPickerSlopeHistory, readRuleOverrides), mirroring apps/worker/src/main.ts's own wiring"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "bun run typecheck (clean) + bun run test -- --project=server (265 passed)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-10
status: complete
---

# Phase 30 Plan 05: HTTP Route + MCP Tool for Ad-Hoc Analyze Summary

**`POST /api/picker/analyze` + `analyze_ad_hoc_calendar` MCP tool expose the ad-hoc scoring use-case over one shared `analyzeAdHocCalendarRequest`/`Response` schema — both adapters return 200 `{scored:false, reason}` (never a hard error) when scoring context is unavailable, and the server composition root now builds `economicEventsRepo`/`pickerHistoryRepo`/`readGexContextForPicker` mirroring the worker's own wiring.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-10T15:20Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- `pickerRoutes` now takes a second `ForAnalyzingAdHocCalendar` use-case and registers `POST /picker/analyze` (`zValidator("json", analyzeAdHocCalendarRequest)` → use-case → `Result` → `analyzeAdHocCalendarResponse.parse` → respond) — zero business logic in the handler, mounted inside the same authenticated `apiRouter` as `/api/picker/candidates`.
- `registerAnalyzeAdHocCalendarTool(server, analyzeAdHocCalendar)` in `tools.ts` mirrors `registerSetRuleOverridesTool`'s `safeParse`-the-same-schema pattern; `server.ts`'s `makeMcpRouter` gained an optional `analyzeAdHocCalendar` param and conditionally registers the tool, matching every other optional-tool precedent in the file.
- `main.ts` composes `analyzeAdHocCalendar = makeAnalyzeAdHocCalendarUseCase({...})` with all 6 read ports: reuses the already-built `gexSnapshotRepo`/`pickerSnapshotRepo`/`ruleOverridesRepo`, and adds the two repos + one mapping closure this route needed that no prior server use-case built — `economicEventsRepo` (`makePostgresEconomicEventsRepo`), `pickerHistoryRepo` (`makePostgresPickerHistoryRepo`), and `readGexContextForPicker`/`toAbsGammaStrike` (copied verbatim from `apps/worker/src/main.ts:544-569` so both apps map `GexSnapshotRow` → `GexContextForPicker` identically).
- Both `{scored:true, candidate, reason:null}` and `{scored:false, candidate:null, reason}` map to HTTP 200 / a structured MCP text payload — binding #2's "never a hard error for the paste flow" is honored by both adapters identically.
- 10 new tests across the two adapter surfaces: 6 route tests (200-scored, 200-scored:false, 400-refine, 400-strict-spot, 500-storage, no-leak) + 4 real-transport MCP tool tests (scored, no-snapshot, invalid-params via `.strict()`/refine, storage-error).

## Task Commits

Each task was committed atomically:

1. **Task 1: POST /picker/analyze route (Zod → use-case → Result mapping)** - `b9a7401` (feat)
2. **Task 2: analyze_ad_hoc_calendar MCP tool + server composition-root wiring** - `db7ecf9` (feat)

_Both tasks were TDD red→green: the new test cases were written first and confirmed to fail for the right reason (404 route-not-found / the referenced tool export not existing) before the implementation landed in the same commit — matches this repo's tdd.md single-commit-at-green convention (17.1-01/30-03/30-04 precedent)._

## Files Created/Modified
- `apps/server/src/adapters/http/picker.routes.ts` - `pickerRoutes` gains the `analyzeAdHocCalendar` param + `POST /picker/analyze` handler
- `apps/server/src/adapters/http/picker.routes.test.ts` - 6 new `POST /picker/analyze` tests
- `apps/server/src/adapters/mcp/tools.ts` - `registerAnalyzeAdHocCalendarTool`
- `apps/server/src/adapters/mcp/tools.test.ts` - 4 new `analyze_ad_hoc_calendar` tests via real McpServer + InMemoryTransport
- `apps/server/src/adapters/mcp/server.ts` - `makeMcpRouter` gains an optional `analyzeAdHocCalendar` param + conditional registration (required plumbing, MCP registration always lives here per the codebase's own precedent)
- `apps/server/src/main.ts` - composes `analyzeAdHocCalendar` with all 6 read ports; adds `economicEventsRepo`/`pickerHistoryRepo`/`readGexContextForPicker`/`toAbsGammaStrike`; wires it into both `pickerRoutes` and `makeMcpRouter`
- `apps/server/src/config.ts` - adds defaulted `BSM_DIVIDEND_YIELD`/`BSM_RATE_FALLBACK` (matches `apps/worker/src/config.ts`'s own defaults) so the use-case's `rate`/`dividendYield` deps have a config source

## Decisions Made
- Both `scored:true` and `scored:false` are HTTP 200 (binding #2) — this supersedes 30-PATTERNS.md's discretionary suggestion to mirror the GET route's 404-no-snapshot convention; the plan's own `must_haves.truths` and `<behavior>` block are the authoritative spec here, and the pattern map itself flagged this as a RESEARCH.md "Open Question 2" recommendation, not a locked decision.
- `registerAnalyzeAdHocCalendarTool` is registered in `server.ts`, not `main.ts` — `main.ts` only ever composes use-cases and passes them as arguments; every existing MCP tool (`get_picker_candidates`, `set_rule_overrides`, etc.) follows the same split, confirmed by `rg` showing zero `register*Tool(` calls in `main.ts`.
- `apps/server/src/config.ts` gained `BSM_DIVIDEND_YIELD`/`BSM_RATE_FALLBACK` with the exact same `.default()` values as the worker's config — no new required Railway env var, and no new config test needed (the worker's own `BSM_MAX_DTE`/`BSM_STRIKE_BAND_PCT`/etc. defaults have never had dedicated config tests either, consistent with the existing test-coverage boundary for defaulted tunables).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `BSM_DIVIDEND_YIELD`/`BSM_RATE_FALLBACK` to `apps/server/src/config.ts`**
- **Found during:** Task 2
- **Issue:** `makeAnalyzeAdHocCalendarUseCase` requires `rate`/`dividendYield` deps (mirroring the worker's `computePickerSnapshotUseCase` wiring), but the server's `config.ts` never had BSM tunables — only the worker did. Without this, `main.ts` would not compile.
- **Fix:** Added the same two defaulted fields from `apps/worker/src/config.ts` (`BSM_DIVIDEND_YIELD` default `0.013`, `BSM_RATE_FALLBACK` default `0.045`) to the server's config schema.
- **Files modified:** apps/server/src/config.ts
- **Verification:** `bun run typecheck` clean; no Railway env change required (both fields default).
- **Committed in:** db7ecf9 (Task 2 commit)

**2. [Rule 3 - Blocking] Edited `apps/server/src/adapters/mcp/server.ts` (not in the plan's `files_modified` list)**
- **Found during:** Task 2
- **Issue:** The plan's `files_modified` list only named `tools.ts`/`tools.test.ts`/`main.ts`, but MCP tool registration in this codebase always happens inside `makeMcpRouter`'s per-request closure in `server.ts` — `main.ts` never calls `register*Tool` directly (confirmed via `rg` showing every existing `register*Tool` call site lives in `server.ts`). The 30-04 SUMMARY already documented this exact convention for a prior phase's tool (19-07).
- **Fix:** Added an optional `analyzeAdHocCalendar` param to `makeMcpRouter` and a conditional `registerAnalyzeAdHocCalendarTool` call, matching every other optional-tool pattern already in the file.
- **Files modified:** apps/server/src/adapters/mcp/server.ts
- **Verification:** `bun run typecheck && bun run lint` clean; `bun run test -- --project=server` (265 tests) green.
- **Committed in:** db7ecf9 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking plumbing required for the design to compile and for the new tool to actually reach a client, matching established codebase precedent exactly)
**Impact on plan:** No scope creep — both fixes are wiring necessitated by the codebase's own existing conventions, not new architecture.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. `BSM_DIVIDEND_YIELD`/`BSM_RATE_FALLBACK` are defaulted; no new Railway env var needed.

## Next Phase Readiness
- The ad-hoc scoring use-case is now reachable over both authenticated HTTP (`POST /api/picker/analyze`) and MCP (`analyze_ad_hoc_calendar`) with one shared strict schema. A future plan (30-06, web paste-flow wiring per 30-CONTEXT.md's "Scoring path" discretion note) can call this endpoint from `Analyzer.tsx`'s `handlePasteAnalyze` via a new `useAnalyzeCalendar()` hook (30-PATTERNS.md's suggested shape) and remove the "Pasted calendar — not engine-scored" placeholder for successfully scored pastes.
- Full workspace test suite (279 files, 2999 tests) green after this plan; `bun run typecheck && bun run lint` clean.
- No blockers.

---
*Phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-*
*Completed: 2026-07-10*

## Self-Check: PASSED

All 7 created/modified files found on disk; both task commits (b9a7401, db7ecf9) verified present in git log.
