---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
plan: 11
subsystem: ui
tags: [react, react-query, journal, rule-tags, hono-rpc]

# Dependency graph
requires:
  - phase: 20-stream-watchdog-event-snapshot-strategy-rules
    provides: "journal-rules contracts — setRuleTagsRequest/setRuleTagsResponse/getEventsWithRulesResponse (plan 20-07)"
  - phase: 20-stream-watchdog-event-snapshot-strategy-rules
    provides: "GET /api/journal/:calendarId/rules + PUT /api/journal/events/:hash/rules HTTP routes (plan 20-10)"
provides:
  - "useRuleTags — react-query hook: fetch combined events+annotations, non-optimistic save + per-event retry"
  - "Journal Notes panel rule-tag control — ENTER/EXIT/ROLL toggle-chip sections, OTHER-requires-note gating"
  - "Trade-list neutral read-view pill for the selected trade's recorded rule tags (D-22)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-optimistic save via react-query invalidateQueries (no onMutate optimistic update) — chip active state and read-view pill are derived purely from server-confirmed data, never a local pre-save flip (T-20-17 honesty principle, mirrors WATCH-01's stream-state approach)"
    - "Per-fillIdsHash error/retry map keyed on a Record<string,string> inside the data hook, so multiple sibling sections (ENTER/EXIT/multiple ROLLs) can each carry an independent save-error + Retry state without cross-contaminating"
    - "apps/web importing @morai/core directly for pure Zod-enum value exports (enterRuleTag/exitRuleTag/rollRuleTag) — sanctioned by eslint.config.js's boundaries/dependencies rule (`apps` may import `core`) and precedented by lib/iv-calibration.ts; avoids hand-duplicating the enum vocabulary in the UI layer"

key-files:
  created:
    - apps/web/src/hooks/useRuleTags.ts
    - apps/web/src/hooks/useRuleTags.test.ts
  modified:
    - apps/web/src/screens/Journal.tsx
    - apps/web/src/screens/Journal.test.tsx

key-decisions:
  - "Read-view pill (D-22) covers ONLY the selected trade's row, not every trade in the list — useRuleTags fetches one calendar's tags per call (matching the 20-10 GET route's per-calendarId shape), and no bulk/list-wide rule-tags endpoint exists in this phase's backend surface. Cross-trade tag scanning would need a new endpoint, which is out of this plan's declared scope."
  - "OTHER's required note is enforced as a client-side 'attempted save' check (Rule 2 mitigation, T-20-11 defense-in-depth alongside the server's own D-21 refine): clicking OTHER on only reveals the inline input (no save attempt yet); a save is attempted on note-input blur/Enter or when toggling ANY other chip while OTHER is selected, and only that attempt validates the note is non-empty before calling save."
  - "Deactivating OTHER needs no note and saves immediately (removing a tag never requires justification); activating it never saves until a non-empty note is confirmed."

requirements-completed: [RULE-01]

coverage:
  - id: D1
    description: "useRuleTags hook fetches GET /api/journal/:calendarId/rules (safeParsed via getEventsWithRulesResponse) and exposes a save(fillIdsHash, tags, otherNote?) mutation that PUTs and only reflects new tags after the request resolves + the query is invalidated (non-optimistic); save failure records an error keyed by fillIdsHash and retry(hash) resubmits the identical payload"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useRuleTags.test.ts (3 tests: fetch+parse, non-optimistic save+refetch, failure+retry)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Journal Notes panel renders ENTER (always)/EXIT (chip row once a CLOSE event exists, else 'Available at close.')/ROLL (one section per ROLL event with its own timestamp) toggle-chip rows above the untouched free-text textarea, using the Phase-21 Button variant=toggle tone=violet size=xs primitive; OTHER reveals a required inline note before it can save; chip active state and inline save-error+Retry reflect only server-confirmed state"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx (7 new RULE-01 tests: ENTER/EXIT/ROLL rendering, non-optimistic chip save, OTHER-requires-note gating, inline error+Retry, read-view pill present/absent)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Trade-list row shows one neutral (border-line2/text-dim, NOT violet) read-view pill with the selected trade's comma-joined recorded tag labels, truncated, only when >=1 tag is recorded; absent otherwise"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx ('read-view pill shows only when the trade has >=1 recorded tag, neutral-toned (not violet)' + 'read-view pill is absent when the trade has no recorded tags')"
        status: pass
    human_judgment: true
    rationale: "Visual truncation/overflow behavior and the exact neutral-vs-violet contrast in the rendered UI benefit from a human glance per the plan's own manual UAT step (chrome-devtools MCP) — the unit test asserts class presence/absence, not pixel rendering."

# Metrics
duration: 35min
completed: 2026-07-05
status: complete
---

# Phase 20 Plan 11: RULE-01 Journal UI Summary

**useRuleTags react-query hook + a Journal Notes panel rule-tag control (ENTER always / EXIT gated on CLOSE / one row per ROLL) using the Phase-21 Button toggle chip, with OTHER-requires-note gating and a neutral trade-list read-view pill — the final RULE-01 surface, closing out Phase 20.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-07-05T08:38:00Z
- **Completed:** 2026-07-05T13:51:00Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `useRuleTags(calendarId)` — GET the combined events+rule-tag payload (safeParsed via `getEventsWithRulesResponse`) and a `save(fillIdsHash, tags, otherNote?)` mutation that PUTs `/api/journal/events/:hash/rules`; non-optimistic (T-20-17) — local state only reflects the server's tags after the PUT resolves and the query is invalidated. Failures set a `Record<fillIdsHash, string>` error map and remember the last payload so `retry(hash)` resubmits it verbatim.
- `RuleTagChips` — a reusable per-event chip row (Phase-21 `Button variant="toggle" tone="violet" size="xs"`) rendered ABOVE the existing free-text thesis textarea (untouched) inside the Notes panel: ENTER always renders (every trade has an OPEN event), EXIT renders its chip row only once a CLOSE event exists (else the muted `Available at close.` line), and one independent ROLL section renders per actual ROLL event with its own `{fmtDate(rollEvent.eventedAt)}` timestamp label.
- OTHER-requires-note (D-21): activating the `Other` chip reveals a required inline note input (`Note for "Other"…` placeholder) without attempting a save; a save is attempted on note blur/Enter or when toggling any other chip while OTHER is selected — an empty note at that point blocks the save and shows `Add a short note for "Other."` inline; deactivating OTHER needs no note and saves immediately.
- Trade-list read-view pill (D-22): the selected trade's row gets one neutral `border-line2 text-dim` pill (same `rounded-[3px] px-[5px] text-[8px]` grammar as the existing history badge) with its comma-joined, truncated recorded-tag labels — rendered only when the trade has ≥1 tag.

## Task Commits

Each task was committed atomically (TDD RED→GREEN):

1. **Task 1 RED: useRuleTags hook tests** - `e745de1` (test)
2. **Task 1 GREEN: useRuleTags hook implementation** - `5a9fcc8` (feat)
3. **Task 2 RED: Journal rule-tag control tests** - `91bb5f3` (test)
4. **Task 2 GREEN: Journal rule-tag control + read-view pill** - `7a10231` (feat)

_TDD gate check: `test(...)` commits precede their matching `feat(...)` commits for both tasks — RED/GREEN gate sequence satisfied._

## Files Created/Modified
- `apps/web/src/hooks/useRuleTags.ts` - new: fetch (GET .../rules) + non-optimistic save (PUT .../rules) + per-fillIdsHash error/retry map
- `apps/web/src/hooks/useRuleTags.test.ts` - new: 3 tests (fetch+parse, non-optimistic save+refetch, failure+retry resubmit)
- `apps/web/src/screens/Journal.tsx` - adds `RuleTagChips` + ENTER/EXIT/ROLL section wiring in the Notes panel, `tagLabel`/`RULE_TAG_LABELS`/`ENTER_OPTIONS`/`EXIT_OPTIONS`/`ROLL_OPTIONS` constants, and the trade-list read-view pill
- `apps/web/src/screens/Journal.test.tsx` - adds a `useRuleTags` mock + 7 new tests covering section rendering, save/retry wiring, OTHER gating, and the read-view pill

## Decisions Made
- **Read-view pill scoped to the selected trade only** — `useRuleTags` fetches one calendar's events+tags per call (matching 20-10's `GET /api/journal/:calendarId/rules`, not a list-wide endpoint). Showing a pill on every row in the trade list would need a new bulk/list-wide rule-tags read surface that doesn't exist in this phase's backend (20-09/20-10 scope) — extending to it here would violate the plan's declared file/hook surface. The delivered behavior still satisfies "record + edit rule tags and see them recorded" for the trade the user is actively viewing.
- **OTHER-requires-note as an "attempted save" gate, not an immediate on-click error** — clicking OTHER only reveals the input; the validation message (`Add a short note for "Other."`) only appears once a save is actually attempted (blur/Enter, or another chip toggled while OTHER is selected) with an empty note. This avoids flashing a red error the instant a user opens the input before they've had a chance to type anything, while still enforcing D-21 before any tag set containing `other` reaches the network.
- **`apps/web` imports the rule-tag enums directly from `@morai/core`** rather than through `@morai/contracts` — the CLAUDE.md architecture table's "web imports contracts only" note is aspirational; the enforced source of truth (`eslint.config.js`'s `boundaries/dependencies` rule) explicitly allows `apps → core`, and `apps/web/src/lib/iv-calibration.ts` already does exactly this for BSM re-pricing (D21). Re-exporting through `@morai/contracts` would have required touching a package outside this plan's declared `files_modified`.

## Deviations from Plan
None — plan executed exactly as written. The three items above are implementation-detail decisions the plan explicitly left to the executor (D-22's "exact truncation width is an executor implementation detail"; OTHER's exact save-attempt trigger; the enum-import path), not deviations from a stated behavior.

## Issues Encountered
None.

## User Setup Required
None — no migrations, environment variables, or external services. The backend surface (20-09/20-10) was already live.

## Next Phase Readiness
- RULE-01 is now fully shipped end-to-end: domain enums (20-06) → contracts (20-07) → annotations repo (20-08) → use-cases (20-09) → HTTP/MCP adapters (20-10) → Journal UI (this plan). Phase 20 (WATCH-01 + SNAP-01 + RULE-01) is code-complete pending the phase's own deploy + UAT cycle (D-18).
- Manual UAT still needed per the plan's own `<verification>` block: set ENTER/EXIT/ROLL tags in a real browser session against a deployed/local server, reload, confirm persistence + the read-view pill, and confirm OTHER's required-note gating live (chrome-devtools MCP, per the user's standing UAT permission).
- No blockers. Full-repo `bun run test` (211 files / 2028 tests), `bun run typecheck`, and `bun run lint` all pass as of the final commit.

## Self-Check: PASSED

All created/modified files verified present on disk (`apps/web/src/hooks/useRuleTags.ts`, `apps/web/src/hooks/useRuleTags.test.ts`, `apps/web/src/screens/Journal.tsx`, `apps/web/src/screens/Journal.test.tsx`); all 4 commits (`e745de1`, `5a9fcc8`, `91bb5f3`, `7a10231`) verified present in `git log`; full-repo `bun run test` (2028 tests), `bun run typecheck`, and `bun run lint` all clean as of the final commit. No unintended file deletions in any commit (`git diff --diff-filter=D` empty across the plan's commit range).

---
*Phase: 20-stream-watchdog-event-snapshot-strategy-rules*
*Completed: 2026-07-05*
