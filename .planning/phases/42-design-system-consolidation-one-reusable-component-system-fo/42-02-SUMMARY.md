---
phase: 42-design-system-consolidation-one-reusable-component-system-fo
plan: 02
subsystem: ui
tags: [react, typescript, design-system, migration]

requires:
  - "DataTable<T> primitive (42-01)"
provides:
  - "CandidateTable as a thin DataTable<PickerCandidate> wrapper — public API byte-stable"
  - "DataTableColumn.headerTestId optional field (additive extension, rail-sort-{key} preservation)"
affects: [42-05-docs-and-phase-gate]

tech-stack:
  added: []

key-files:
  - apps/web/src/components/picker/CandidateTable.tsx
  - apps/web/src/components/system/DataTable.tsx
---

# Plan 42-02 Summary — CandidateTable → DataTable wrapper

**Status:** COMPLETE (1/1 tasks) · commit `48f15fb`

## What shipped

- `CandidateTable.tsx` rewritten as a thin wrapper over `DataTable<PickerCandidate>`:
  hand-rolled `<thead>/<tbody>/SortableHeader/CandidateRow` JSX replaced by a
  `DataTableColumn<PickerCandidate>[]` array (score/name/debit/Δ/Γ/θ/vega/IV f-b/event/
  combine columns). Net −24 lines.
- Public exports byte-stable: `CandidateTable`, `CandidateTableProps`, `cycleSort`,
  `sortCandidates`, `DEFAULT_CANDIDATE_SORT`, `compactCalendarName`, `CandidateSortKey`,
  `CandidateSortState`. `Analyzer.tsx` / `AnalyzerMobile.tsx` untouched (git diff empty).

## Deviations

- **Rule 3 (blocking):** DataTable had no per-column header testid; plan truths require
  `rail-sort-{key}` to survive verbatim. Added optional `headerTestId?: string` to
  `DataTableColumn<T>` + wired both `<th>` branches — additive, mirrors `rowTestId`.
- **exactOptionalPropertyTypes:** optional props (`wrapperTestId`, `tableClassName`)
  passed via conditional spread (documented typescript.md pitfall).
- **Ops:** executor lost file access mid-session (macOS TCC outage) after verification,
  before commit — orchestrator committed the verified work verbatim on resume.

## Verification

- 237/237 tests green: `Analyzer.test.tsx`, `analyzer-mobile/`, `components/picker`,
  `components/system` — zero test-file edits.
- `tsc --noEmit` at the 10-error pre-existing baseline (incl. Button.tsx line-98 error,
  last touched phase 35 — NOT this phase).
- No `<thead|<tbody|SortableHeader` remnants; no new `as`/`any`/`!`.
