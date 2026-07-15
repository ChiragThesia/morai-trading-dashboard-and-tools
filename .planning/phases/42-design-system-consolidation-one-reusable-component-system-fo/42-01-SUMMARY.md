---
phase: 42-design-system-consolidation-one-reusable-component-system-fo
plan: 01
subsystem: ui
tags: [react, typescript, generics, design-system, tdd]

requires: []
provides:
  - "DataTable<T> generic presentational table primitive (components/system/DataTable.tsx)"
  - "DataTableColumn<T> / DataTableProps<T> types"
  - "Barrel exports (DataTable, DataTableColumn, DataTableProps) from components/system/index.tsx"
affects: [42-02-analyzer-candidatetable-migration, 42-03-overview-positionstable-migration]

tech-stack:
  added: []
  patterns:
    - "First generic React component in the codebase: `export function DataTable<T,>(...)` trailing-comma disambiguator"
    - "Presentational-only component contract: no internal useState, all state (sort/selection/hover) caller-owned via props + callbacks"
    - "Column-def primitive: DataTableColumn<T>.render(row) as the single cell-rendering seam, replacing per-table hand-rolled <td> markup"

key-files:
  created:
    - apps/web/src/components/system/DataTable.tsx
    - apps/web/src/components/system/DataTable.test.tsx
  modified:
    - apps/web/src/components/system/index.tsx

key-decisions:
  - "DataTable owns only <thead> + one <tr> per row (+ optional renderRowDetail/footer slots) — it does NOT own empty-state copy, pagination, or a hardcoded 'selected' boolean; callers pass rowClassName(row) so CandidateTable's left-border tint and Overview's flat highlight stay distinct treatments, per UI-SPEC's explicit unresolved-but-recommended choice."
  - "renderRowDetail(row) and footer are both caller-composed React nodes rendered as-is inside <tbody> — DataTable does not interpret their contents, keeping it a pure layout primitive for Plan 03's detail-row + Net-total-row use case."

requirements-completed: []

coverage:
  - id: D1
    description: "DataTable<T> renders sticky-header table with sort/aria-sort, row hover, per-row testids, caller-supplied row classes — fully presentational (no internal useState)"
    verification:
      - kind: unit
        ref: "apps/web/src/components/system/DataTable.test.tsx (13 tests, all passing)"
        status: pass
    human_judgment: false
  - id: D2
    description: "DataTable supports renderRowDetail(row) extra-<tr> and footer tbody-content slots for Overview's future detail + Net-total rows"
    verification:
      - kind: unit
        ref: "apps/web/src/components/system/DataTable.test.tsx#renderRowDetail(row) emits an extra <tr>...; #footer node renders inside tbody..."
        status: pass
    human_judgment: false
  - id: D3
    description: "DataTable + DataTableColumn + DataTableProps exported from components/system/index.tsx barrel"
    verification:
      - kind: unit
        ref: "rg -n \"export { DataTable }|export type { DataTableColumn, DataTableProps }\" apps/web/src/components/system/index.tsx"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-15
status: complete
---

# Phase 42 Plan 01: DataTable<T> Primitive Summary

**Generic presentational `DataTable<T>` component in `components/system/` — one column-def-driven table primitive (sticky header, sort/aria-sort, row hover, per-row testids, `renderRowDetail`/`footer` slots) generalized verbatim from `CandidateTable.tsx`'s chrome, authored TDD red-first as the codebase's first generic component.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-07-15
- **Tasks:** 2/2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `DataTable<T>` built and barrel-exported: sticky `<thead>`, sortable columns with correct `aria-sort`/glyph, caller-owned `onSortChange`/`onRowClick`/`onRowMouseEnter`/`onRowMouseLeave`, `rowClassName(row)`, `renderRowDetail(row)`, and `footer` slots — zero internal `useState`.
- 13 red-first tests covering every behavior bullet in the plan (row rendering, column render order, `align`, sort/aria-sort states, click callbacks, hover callbacks, row class, detail row, footer, structural chrome).
- Confirmed genuine RED (import-resolution failure, not a syntax/assertion mismatch) before implementing.

## Task Commits

Each task was committed atomically:

1. **Task 1a (RED): DataTable test suite** - `7fc738c` (test)
2. **Task 1b (GREEN): DataTable implementation** - `2eb77bf` (feat)
3. **Task 2: barrel export** - `3e0be06` (feat)

_TDD task: test → feat commits, as required by tdd.md gate sequence._

## Files Created/Modified
- `apps/web/src/components/system/DataTable.tsx` - the generic presentational table primitive
- `apps/web/src/components/system/DataTable.test.tsx` - 13-test red-first suite against a synthetic `TestRow`
- `apps/web/src/components/system/index.tsx` - barrel re-export of `DataTable`/`DataTableColumn`/`DataTableProps`, one-line doc-comment update

## Decisions Made
- Kept `renderRowDetail`/`footer` as opaque `React.ReactNode` passthroughs (no schema DataTable interprets) — this is what lets Plan 03's Overview verdict-detail row and Net-total row stay caller-composed without DataTable growing a bespoke "detail row" or "summary row" API.
- Used the synthetic `TestRow` type per RESEARCH's Open Question 2 recommendation rather than importing `@morai/contracts` domain types into a unit test.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The plan's acceptance-criteria grep for `useState|useReducer` and `" as "/": any"/"!."` both return exactly the pre-existing comment-only false-positive pattern also present in `CandidateTable.tsx` (`No any/as/!.` doc comment, `import * as React`) — no real violation. `tsc --noEmit` is at 9 pre-existing errors (baseline drift from the plan's stated 10, unrelated to this plan's files — confirmed none reference `DataTable.tsx`/`DataTable.test.tsx`).

## Next Phase Readiness
`DataTable<T>` is built, tested, and barrel-exported — nothing consumes it yet. Plan 02 (CandidateTable thin-wrapper migration) and Plan 03 (Overview PositionsTable migration) can now render through it.

---
*Phase: 42-design-system-consolidation-one-reusable-component-system-fo*
*Completed: 2026-07-15*

## Self-Check: PASSED
All created files and commit hashes verified present.
