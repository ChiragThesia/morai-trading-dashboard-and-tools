# Phase 42: Design-system consolidation - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (user: "go for it do what you need to" after approving the shadcn-consolidation recommendation over daisyUI)

<domain>
## Phase Boundary

One reusable component system for every screen. The user's words: "the tables for position
on overview and all the other tables should look the same. Build a proper DESIGN system
component system that we can re-use — right now we have these desperate sources of things."

IN scope:
1. **DataTable primitive** — one table component; migrate Overview `PositionsTable` and the
   shared `CandidateTable` (desktop + mobile call sites) onto it.
2. **One Button** — fold the 3 `components/ui/button` call sites (Login.tsx,
   RebuildButton.tsx, ui/dialog.tsx internal) into `components/system/Button`; delete
   `ui/button.tsx`.
3. **Design tokens formalized** — panel gradient, line colors, text scale, spacing already
   live in tailwind config + `system/Panel`; document as the single source and sweep
   stragglers that hand-roll the same values.
4. **`docs/architecture/design-system.md`** — docs-before-architecture law; plus TOPIC-MAP
   row and rules "Where to Look" updates per docs.md rule.

OUT of scope (deferred):
- Journal has NO `<table>` (verified 2026-07-15) — nothing to migrate there.
- `PositionCard` (mobile) renders the same `buildRows` data as cards, not a table — stays.
- Chart components (Recharts) — untouched.
- daisyUI or any new dependency — RESEARCHED AND REJECTED 2026-07-15: CSS-only (no table
  behavior — our tables need sort state/aria-sort/sticky/selection), would be a third
  styling idiom on top of shadcn + system/, and its rounded SaaS look fights the dense
  terminal aesthetic. Zero new deps is a hard constraint.
</domain>

<decisions>
## Implementation Decisions

### DataTable shape (Claude's discretion, informed by existing code)
- Column-def pattern: `{ key, header, align?, mono?, sortable?, width?, render(row) }` —
  hand-rolled, NOT @tanstack/react-table (zero-new-deps; shadcn's official DataTable guide
  uses TanStack but our needs are covered by the existing `cycleSort`/`sortCandidates`
  logic already shipped in CandidateTable.tsx — reuse it, generalized).
- Behavior owned by DataTable: sticky header, sort cycling + `aria-sort`, row hover,
  selected-row highlight, row onClick, per-row trailing actions slot, internal-scroll
  wrapper className passthrough (no-scroll layout law: tables scroll inside their box,
  never the page).
- Chrome reference = CandidateTable's current look (newest, user-approved in Phase 41):
  10px mono numerics, dim uppercase header row, row hover bg, dense padding.
- testids preserved: DataTable takes a `rowTestId(row)` fn so existing
  `candidate-row-{id}` / positions-table testids survive migration — tests keep meaning.

### Migration order
1. DataTable primitive + its own test suite (TDD red first).
2. CandidateTable → thin wrapper over DataTable (its public API — candidates,
   pastedCandidates, sort, callbacks — stays stable so Analyzer desktop + mobile call
   sites and their tests are untouched where possible).
3. Overview PositionsTable → DataTable columns (live-greek overlay cells become render
   fns; VERDICT column, expiry cell, unlinked-verdicts list under table all preserved).
4. Button unification + token sweep + design-system doc.

### Button consolidation
- Keep `system/Button` (richer: variant+tone+active+focus-ring, 16 files already use it).
- `ui/dialog.tsx`'s internal Button usage swaps to system/Button; Login + RebuildButton
  likewise; delete `ui/button.tsx`. Visual drift on those 3 surfaces is acceptable and
  desired (that's the consolidation).

### Visual parity bar
- NOT pixel-identical: tables CONVERGE to the one DataTable chrome. Parity bar = every
  column/value/behavior present, no layout break, no page scroll at 1512x860 and
  2056x1329. Screenshot check via chrome-devtools at both sizes (standing permission).

### Hexagon/boundary notes
- All work in apps/web; no core/contracts/adapters changes. eslint boundaries unaffected.
- TDD: DataTable logic (sort cycling, aria-sort, selection) = component logic → red→green.
  Pure styling moves are exempt per tdd.md scope.
</decisions>

<code_context>
## Existing Code Insights

- `components/ui/` = shadcn primitives (badge, button, card, chart, dialog, input,
  separator, skeleton, slider, tabs, textarea, toggle-group, toggle, tooltip). No table.tsx.
- `components/system/` = Morai layer (Panel, PanelHeading, SectionLabel, Button, ChipRail,
  BulletGauge) — 16 files import from it.
- `CandidateTable.tsx` owns `cycleSort`, `sortCandidates`, `DEFAULT_CANDIDATE_SORT`,
  aria-sort headers, sticky thead, wrapperClassName internal scroll — the best existing
  table; generalize FROM it.
- `Overview.tsx` `PositionsTable` — TOS-style docked table, live BSM greek overlays,
  VERDICT chips, hovered/selected row state (D-05), `formatExpiryCell` exported for tests.
- Both trees mount per `useIsDesktop` switch; mobile Analyzer renders CandidateTable too
  (horizontal scroll OK, user-locked 2026-07-14).
- 883 web tests green pre-phase; Analyzer no-scroll layout shipped same day (3476b03).
</code_context>

<specifics>
## Specific Ideas

- User's screenshot complaint drove this: Overview positions table and Analyzer suggested
  table visibly different fonts/density/chrome. The two must be indistinguishable.
- Keep the no-scroll layout laws intact (Analyzer table flexes into leftover height —
  DataTable must support that wrapper mode).
</specifics>

<deferred>
## Deferred Ideas

- Journal lifecycle-table if one ever appears — must use DataTable.
- shadcn table.tsx primitive adoption for non-data tables (none exist today).
- Theming/theme-switcher (single dark terminal theme is locked).
</deferred>
