# Phase 42: Design-system consolidation - Research

**Researched:** 2026-07-15
**Domain:** Internal codebase-pattern consolidation (React/TS component API design) — not a
technology-selection phase. Zero new dependencies.
**Confidence:** HIGH — every claim below is grounded in a direct read of the live source
(`apps/web/src/**`), not external docs. No ecosystem/package research was needed (no new
libraries), so the `tool_strategy` provider seam (Context7/web search) was not invoked —
there is nothing external to look up. All findings are `[VERIFIED: codebase read]` unless
marked otherwise.

## Summary

This phase is a convergence refactor inside `apps/web` only: two independently-evolved
tables (`CandidateTable.tsx`, `Overview.tsx`'s `PositionsTable`) and two Button
implementations (`components/system/Button`, `components/ui/button`) collapse onto one
`DataTable` primitive and one `Button`. The UI-SPEC (checker-approved 6/6) has already
pinned the exact column-def shape, chrome classes, and copy contract — this research adds
the engineering facts the planner needs that the UI-SPEC deliberately left open: the exact
public API surface both tables currently expose (so the DataTable wrapper is byte-faithful),
every test file that pins a testid/behavior (so migration doesn't silently break green
tests), and one load-bearing discovery — **`docs/architecture/design-system.md` already
exists** (a 38-line stub, not yet listed in `TOPIC-MAP.md`) — so this phase's docs task is
an *update + index*, not a *create*.

Two additional hand-rolled-hex sites were found beyond what CONTEXT/UI-SPEC called out:
`Login.tsx` and `RebuildButton.tsx` both inline the exact `Panel` gradient
(`linear-gradient(180deg, #0f1521, #0c111a)` + `#1b2433` border) and duplicate half the
token palette as literal hex in `style={}` props. These are two of the three Button
call-sites already in scope for migration — the token sweep and the Button migration should
land together on these two files, not as separate passes.

**Primary recommendation:** Build `DataTable.tsx` test-first as a pure, generic, presentational
component (`sort`/`selection` state stays caller-owned per UI-SPEC), migrate `CandidateTable`
first (it already has the "best" chrome and the richest existing test coverage via
`Analyzer.test.tsx`/`AnalyzerMobile.test.tsx`), then `PositionsTable`, then fold the 3 Button
call-sites (which are also the worst token-hygiene offenders) in the same pass as the token
sweep, and finally update (not create) `docs/architecture/design-system.md` + add its missing
`TOPIC-MAP.md` row.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DataTable primitive (render/sort/selection chrome) | Browser / Client (`apps/web/src/components/system/`) | — | Pure presentational React component; no data fetching, no server/API involvement. |
| CandidateTable / PositionsTable (data → rows) | Browser / Client (`apps/web/src/screens/*`, `components/picker/*`) | — | Callers own row-building (`buildRows`, candidate arrays already fetched via `usePicker`/`useOverviewModel`) and pass mapped rows into DataTable; no new data flow. |
| Button consolidation | Browser / Client | — | Pure UI atom; `ui/dialog.tsx`'s base-ui `render` prop-merge is a client-only composition concern. |
| Design tokens | Browser / Client (`apps/web/src/index.css` `@theme`, compiled by Tailwind v4 at build time) | — | CSS custom properties, no runtime/server dependency. |
| `docs/architecture/design-system.md` | Docs (not a runtime tier) | — | Documentation artifact; `docs.md` rule governs, not an architecture-boundaries tier. |

No API/Backend, CDN, or Database tier involvement anywhere in this phase — confirmed by
CONTEXT.md ("All work in apps/web; no core/contracts/adapters changes").

<phase_requirements>
## Phase Requirements

No formal requirement IDs are assigned to Phase 42 (roadmap-evolution phase, added directly
to `STATE.md`'s Roadmap Evolution log on 2026-07-15, not derived from `REQUIREMENTS.md`).
The phase's scope is instead defined entirely by `42-CONTEXT.md`'s `<domain>`/`<decisions>`
sections and `42-UI-SPEC.md`'s Migration Manifest (both LOCKED). Traceability for this phase
is: CONTEXT §1-4 IN-scope bullets → UI-SPEC "Migration Manifest" 5-step list → this
RESEARCH's findings below.
</phase_requirements>

## Standard Stack

### Core

No new libraries. Every dependency this phase touches is already installed:

| Library | Version (verified `apps/web/package.json`) | Purpose | Why no change |
|---------|------|---------|---------------|
| `react` | 19.2.7 | DataTable is a plain generic function component | Already the project's runtime |
| `typescript` | 6.0.3 | Generic `DataTableColumn<T>` under `strict`+`exactOptionalPropertyTypes` | No new tooling needed |
| `tailwindcss` | 4.3.1 (CSS-first `@theme`, no `tailwind.config.js` file exists) | Token compilation | Tokens already declared in `index.css` |
| `@base-ui/react` | 1.6.0 | `ui/dialog.tsx`'s `DialogPrimitive.Close render={<Button/>}` prop-merge | Button migration must stay compatible with this exact version's `render` clone-merge behavior |
| `class-variance-authority` | 0.7.1 | Used only by the *retiring* `ui/button.tsx` — not needed by `system/Button` (uses hand-rolled lookup maps, see Code Examples) | Confirms deleting `ui/button.tsx` removes the project's only `cva`-based button (nothing else needs it kept) |
| `clsx` / `tailwind-merge` | 2.1.1 / 3.6.0 | `cn()` helper (`apps/web/src/lib/utils.ts`) — both DataTable and Button already use this | No change |
| `lucide-react` | 1.21.0 | `dialog.tsx`'s `XIcon` — unaffected by the Button swap | No change |

### Supporting

None — this phase adds zero new supporting libraries by design (CONTEXT: "Zero new deps is
a hard constraint").

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `DataTable` | `@tanstack/react-table` | REJECTED per CONTEXT 2026-07-15: existing `cycleSort`/`sortCandidates` already cover this project's actual needs (3-column sort, no pagination/filtering); adding TanStack is a new dependency for capability already shipped. |
| Hand-rolled `DataTable` | daisyUI `table` component | REJECTED per CONTEXT 2026-07-15: CSS-only (no sort state/aria-sort/sticky/selection behavior — this project's tables need all four); would be a third styling idiom stacked on shadcn + system/; visual language (rounded SaaS) fights the dense terminal aesthetic already locked in `09-UI-SPEC.md`. |

**Installation:** none — no `npm install` step in this phase.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero external packages (CONTEXT: "Zero new
dependencies (daisyUI/TanStack REJECTED"). The Package Legitimacy Gate is skipped —
there is nothing to run `npm view` or `gsd-tools query package-legitimacy check` against.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │            index.css  @theme                │
                    │   (token source of truth — bg/panel/line/    │
                    │    violet/up/down/amber/txt/dim/…)           │
                    └───────────────┬───────────────────────────────┘
                                    │ Tailwind utility classes
                                    ▼
        ┌───────────────────────────────────────────────────────────┐
        │        components/system/ (Molecules layer)                │
        │  Panel · PanelHeading · SectionLabel · Stat · MetricChip   │
        │  Button (SOLE, after this phase)                            │
        │  DataTable  ← NEW THIS PHASE (generic <T>, presentational) │
        └───────┬───────────────────────────────┬─────────────────────┘
                │ column-defs + rows              │ variant/tone/size
                ▼                                 ▼
  ┌─────────────────────────┐      ┌──────────────────────────────────┐
  │ CandidateTable.tsx       │      │  Button call sites:               │
  │ (thin wrapper over        │      │  Login.tsx · RebuildButton.tsx   │
  │  DataTable; owns          │      │  ui/dialog.tsx (internal close)  │
  │  cycleSort/sortCandidates)│      └──────────────────────────────────┘
  └───────┬──────────────────┘
          │ imported by (unchanged call sites)
          ▼
  ┌─────────────────┐   ┌──────────────────────┐
  │ Analyzer.tsx      │   │ AnalyzerMobile.tsx    │
  │ (desktop rail)     │   │ (mobile, h-scroll)    │
  └─────────────────┘   └──────────────────────┘

  ┌───────────────────────────┐
  │ Overview.tsx PositionsTable │ ← migrates onto DataTable columns
  │ (live-greek overlay cells,   │   (detail-row/total-row stay
  │  VERDICT chips, D-05 select) │    caller-composed, see below)
  └───────────────────────────┘
```

A reader traces the primary flow: `index.css` tokens compile into Tailwind classes → the
`system/` molecule layer (including the new `DataTable`) consumes those classes → the two
screen-level tables (`CandidateTable`, `PositionsTable`) build column-defs/rows and pass them
into `DataTable` → the screens (`Analyzer`, `AnalyzerMobile`, `Overview`) mount those wrapper
components unchanged.

### Recommended Project Structure

No new directories. One new file:

```
apps/web/src/components/system/
├── index.tsx          # existing barrel — add `export { DataTable } from "./DataTable.tsx"`
├── Button.tsx          # existing, unchanged (already the target)
├── DataTable.tsx        # NEW — generic column-def table primitive
└── DataTable.test.tsx    # NEW — sort cycling / aria-sort / rowTestId / sticky-header assertions
```

`components/picker/CandidateTable.tsx` stays (thin wrapper, not deleted — CONTEXT migration
order step 2). `components/ui/button.tsx` is deleted (migration order step 4).

### Pattern 1: Column-def generic component with `exactOptionalPropertyTypes`

**What:** `DataTable<T>` takes `columns: ReadonlyArray<DataTableColumn<T>>` and
`rows: ReadonlyArray<T>`; every column's `render(row: T): React.ReactNode` closes over the
row.

**When to use:** Any tabular data render where columns are heterogeneous cell types (text,
formatted numbers, badges, action buttons) — exactly `CandidateTable`'s and `PositionsTable`'s
current shape.

**Example (verified pattern — no existing generic `<T>` component exists yet in this codebase
to copy from; this is a new idiom, so `exactOptionalPropertyTypes` compliance must be hand-verified
by the executor, not copied from a working precedent):**

```typescript
// apps/web/src/components/system/DataTable.tsx — pattern only, not the literal file
export interface DataTableColumn<T> {
  readonly key: string;
  readonly header: React.ReactNode;
  readonly align?: "left" | "right";       // optional — exactOptionalPropertyTypes means
                                             // callers must OMIT the key, never pass `undefined`
  readonly sortable?: boolean;
  readonly render: (row: T) => React.ReactNode;
}

// exactOptionalPropertyTypes pitfall: a caller building this array conditionally must use
// object-spread to omit the key, NOT `align: condition ? "left" : undefined`:
const col: DataTableColumn<Row> = {
  key: "name",
  header: "Calendar",
  render: (r) => r.name,
  ...(isLeftAligned ? { align: "left" as const } : {}),   // correct
  // align: isLeftAligned ? "left" : undefined,             // WRONG — violates exactOptionalPropertyTypes
};
```

### Pattern 2: Sort state stays in the CALLER, not in DataTable

**What:** `sort`/`onSortChange` are props DataTable renders (`aria-sort`, click handler) but
never owns internally — both `CandidateTable` (via `useState<CandidateSortState>` in
`Analyzer.tsx`/`AnalyzerMobile.tsx`) and any future `PositionsTable` sort keep their own
`useState`.

**When to use:** Whenever two independent tree mounts of the "same" table need independent
sort state (exactly the desktop-rail vs. mobile-tree split today — `AnalyzerMobile.tsx` line
106 `useState<CandidateSortState>(DEFAULT_CANDIDATE_SORT)` is fully independent of
`Analyzer.tsx`'s own).

**Example:**
```typescript
// Source: apps/web/src/screens/analyzer-mobile/AnalyzerMobile.tsx:106-109 (existing, verbatim)
const [sort, setSort] = useState<CandidateSortState>(DEFAULT_CANDIDATE_SORT);
const handleSortChange = (key: CandidateSortKey): void => {
  setSort((prev) => cycleSort(prev, key));
};
```

### Pattern 3: `rowTestId(row)` function prop, not a static prefix string

**What:** DataTable takes `rowTestId: (row: T) => string` as a REQUIRED prop (no default) so
the two current per-row-key testid conventions (`candidate-row-${c.id}`,
`position-row-${r.key}`) survive verbatim — there is no shared prefix to generalize (`id` vs
`key` are different field names on different row shapes).

**Example (verbatim from CandidateTable.tsx:118 and Overview.tsx:190):**
```tsx
<tr data-testid={`candidate-row-${candidate.id}`} ...>   // CandidateTable today
<tr data-testid={`position-row-${r.key}`} ...>            // PositionsTable today
```

### Anti-Patterns to Avoid

- **A shared "container" testid the two current tables don't have:** neither table exposes a
  single `data-testid="candidate-table"` / `"positions-table"` container today (only
  `wrapperTestId` on the *mobile* CandidateTable call site, and only per-row testids
  elsewhere). Inventing a new container testid is unrequested surface area — tests assert
  per-row testids, not a container.
- **Collapsing CandidateTable's `border-l-2 border-l-violet` selected-row style with
  PositionsTable's `bg-raise/20` highlighted-row style into one hardcoded "selected" boolean
  prop** — UI-SPEC explicitly locks these as two DIFFERENT visual treatments exposed via a
  caller-supplied `rowClassName(row)` function, not a shared boolean.
- **Building a generic `actions` prop for the trailing action cell** — both tables render
  their action cell (Combine/Remove for CandidateTable, checkbox-include for PositionsTable)
  as an ordinary LAST column with its own `onClick={(e) => e.stopPropagation()}`. Do not add a
  dedicated `actions` API neither table needs (UI-SPEC "What DataTable does NOT own").

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sort cycling state machine | A new sort-toggle implementation | `cycleSort()` (CandidateTable.tsx:61-64), generalized verbatim into DataTable | Already correct, already tested indirectly via `Analyzer.test.tsx` sort-cycle assertions (lines 242-264) — a rewrite risks silently changing the 2-state (desc→asc, new-col→desc) cycle behavior. |
| Sort comparator | A generic multi-column sort function | `sortCandidates()`'s pattern (`sortValue` switch + desc/asc flip), adapted per-table since PositionsTable has no sortable columns today (only CandidateTable does) | PositionsTable currently has ZERO sort UI — do not add sortable columns to it as a side effect of the DataTable migration; UI-SPEC does not request it. |
| Button variant/tone system | A new CVA (`class-variance-authority`) variant config, matching `ui/button.tsx`'s pattern | `system/Button`'s existing hand-rolled `VARIANT_CLASS`/`TOGGLE_ACTIVE_CLASS`/`TOGGLE_INACTIVE_CLASS` lookup maps (Button.tsx:39-60) | `system/Button` is the KEEP side of the consolidation — do not reintroduce `cva` (only `ui/button.tsx`, which is being deleted, uses it). Tailwind can't interpolate a dynamic class name, which is exactly why the lookup-map pattern exists (Button.tsx's own doc comment). |
| Token palette | New CSS custom properties or a `tailwind.config.js` `theme.extend.colors` block | `index.css`'s existing `@theme` block (Tailwind v4 CSS-first config — **no `tailwind.config.js` file exists in this repo**, confirmed by `find` returning nothing) | Adding a config file would create a second, competing token-declaration surface. |

**Key insight:** every "hard part" of this phase (sort cycling, aria-sort, button variant
resolution, sticky header, dense-table density) is already solved, tested indirectly, and
shipped in production. The work is extraction/generalization, not invention — treat any new
logic in `DataTable.tsx` beyond what's listed above as scope creep unless the UI-SPEC or
CONTEXT explicitly calls for it.

## Runtime State Inventory

Not applicable — this is a pure code-refactor phase, not a rename/rebrand/migration phase.
No stored data, live service config, OS-registered state, or secrets are touched.
**Nothing found in any category** — verified by CONTEXT.md's own scope statement ("All work
in apps/web; no core/contracts/adapters changes") and confirmed by grep: no database,
migration, or env-var references appear anywhere in `42-CONTEXT.md` or `42-UI-SPEC.md`.

## Common Pitfalls

### Pitfall 1: `docs/architecture/design-system.md` already exists — this is an UPDATE, not a CREATE

**What goes wrong:** A plan/executor that treats "write `docs/architecture/design-system.md`"
as scaffolding a brand-new file will silently overwrite the existing 38-line doc (already
covers Layers/Tokens/Rules-for-screens/Reference) instead of extending it, and may re-author
content that conflicts with what's already there (e.g. the existing doc already says "Atoms
→ `components/ui/*`" — after this phase, `ui/button.tsx` is deleted and `system/Button` is
the sole button, so the Atoms row's prose needs a one-line correction, not a rewrite).
**Why it happens:** CONTEXT.md/UI-SPEC.md phrasing ("`docs/architecture/design-system.md` —
docs-before-architecture law") reads like new-file scaffolding language.
**How to avoid:** Read the existing file first (`docs/architecture/design-system.md`, 38
lines, already committed). Add a `DataTable` row to the Molecules table, correct the Atoms
row's Button reference, and — separately — **add the missing `docs/TOPIC-MAP.md` row**: the
file exists on disk but has NO entry in `TOPIC-MAP.md`'s Architecture table today (confirmed
by grep — `design-system.md` does not appear in the 17-row Architecture index). This is
itself a pre-existing `docs.md` rule violation ("Create docs without updating TOPIC-MAP") this
phase should fix regardless of the table/button work.
**Warning signs:** A plan task titled "create docs/architecture/design-system.md" (should be
"update"); a diff that replaces the whole file rather than adding sections.

### Pitfall 2: Two Button call-sites hand-roll the exact `Panel` gradient as inline hex

**What goes wrong:** `Login.tsx` (lines 98-99, 228-229, plus 6 more hex literals for text
colors) and `RebuildButton.tsx` (lines 70-71, plus 8 more) both inline
`background: "linear-gradient(180deg, #0f1521, #0c111a)"` / `border: "1px solid #1b2433"` —
the EXACT values `Panel`'s className (`bg-gradient-to-b from-panel to-panel2 ring-1
ring-line`) already encodes. If the Button migration in these two files touches only the
`<Button>` JSX and leaves the surrounding hex-styled wrapper `<div>`s untouched, the "token
sweep" (CONTEXT §3, UI-SPEC "Sweep scope") is incomplete — these are the two clearest,
highest-value sweep targets and they are ALSO two of the three Button call sites already
being edited this phase.
**Why it happens:** Both components predate `system/Button`/`Panel` (Login.tsx's own header
comment cites "09-UI-SPEC.md" — an earlier phase) and were never revisited.
**How to avoid:** When migrating `Login.tsx`'s and `RebuildButton.tsx`'s Button usage, do the
inline-hex sweep on the SAME files in the same task (they're already open) rather than
deferring to a separate generic "grep the whole repo" pass. `RebuildButton.tsx`'s dialog
wrapper (`style={{ background: "linear-gradient(...)", border: "1px solid #1b2433", maxWidth:
400 }}`) can become `<DialogContent className="max-w-[400px]">` composed with `Panel`'s
existing gradient utility classes, or at minimum use the token utility classes instead of
literal hex (`bg-gradient-to-b from-panel to-panel2` / `border-line`).
**Warning signs:** `grep -rn "linear-gradient\|#0f1521\|#1b2433" apps/web/src` still returns
hits in `Login.tsx`/`RebuildButton.tsx` after the phase's Button-migration commits land.

### Pitfall 3: `ui/dialog.tsx`'s `render={<Button ... />}` prop-merge is UNVERIFIED against `system/Button`

**What goes wrong:** `ui/dialog.tsx` uses base-ui's clone-and-merge `render` prop twice
(`DialogPrimitive.Close render={<Button variant="ghost" ... />}` at line 63-69, and
`render={<Button variant="outline" />}` at line 110). Base-ui's `render` prop clones the
given element and merges its own a11y/event props (`onClick`, `aria-*`, possibly a `ref`)
onto it. `system/Button` spreads `...props` onto a native `<button>` via
`React.ComponentProps<"button">` and is a plain function component with **no
`React.forwardRef`** — if base-ui's merge mechanism requires attaching a ref to the rendered
element (common for popup/focus-trap libraries), an un-forwarded ref on `system/Button` could
silently no-op (focus management inside the dialog) rather than throw.
**Why it happens:** This is a genuinely unverified integration point — the UI-SPEC itself
flags it as "NOT resolved here" (`42-UI-SPEC.md` "Known integration risk" callout).
**How to avoid:** Per UI-SPEC's own instruction, the executor MUST smoke-test both
`DialogPrimitive.Close render={<Button .../>}` sites after swapping the import (open the
dialog, click the corner ✕, click the footer Close, confirm focus returns to the trigger —
not just a visual screenshot). If base-ui's ref requirement turns out to be load-bearing,
`system/Button` needs `React.forwardRef` added (a small, additive change, not a redesign) —
flag this as a possible Task in the plan rather than assuming the spread-props pattern is
sufficient.
**Warning signs:** Dialog closes visually but focus doesn't return to the trigger element
after using either close button; a React console warning about function components not
supporting `ref`.

### Pitfall 4: `exactOptionalPropertyTypes` on DataTable's generic column-def

**What goes wrong:** `align?: "left" | "right"` under this project's `exactOptionalPropertyTypes`
tsconfig option means `{ align: undefined }` is a TYPE ERROR distinct from omitting the key —
a naive `align: condition ? "left" : undefined` ternary (common React idiom) will not compile.
This has already bitten this codebase in prior phases (`29-13` STATE.md decision: "zod-inferred
mapped types don't get TS implicit-index-signature leniency").
**Why it happens:** `strict-boolean-expressions` + `exactOptionalPropertyTypes` together are
stricter than the React-ecosystem-standard optional-prop idiom most examples online use.
**How to avoid:** Use object-spread to conditionally include/omit the key (see Pattern 1's
code example above), never a ternary that can resolve to `undefined` for an optional field.
**Warning signs:** `tsc --noEmit` (or `bun run typecheck`) fails with "Type 'X | undefined' is
not assignable to type 'X'" on a column-def literal that looks syntactically correct.

### Pitfall 5: PositionsTable's expandable detail row / Net total row have no DataTable home yet

**What goes wrong:** UI-SPEC explicitly flags this as an **open implementation choice** (not
resolved): does `DataTable` grow a `renderRowDetail?(row)` escape hatch for the
verdict-detail `<Fragment>` (Overview.tsx lines 306-313) and the Net summary `<tr>` (lines
317-368), or does `PositionsTable` keep composing its own `<tbody>` and only route the
`<thead>`/base-row markup through `DataTable`? A plan that silently picks one without calling
it out risks the executor inventing a bespoke API mid-implementation.
**Why it happens:** Neither existing table has this problem today (CandidateTable has no
detail row or total row) — it's PositionsTable-only, discovered only when migrating the
second table.
**How to avoid:** The planner should make this decision explicit as its own task/decision
point rather than leaving it for the executor to discover mid-migration. Given "what DataTable
does NOT own" (UI-SPEC) already excludes empty-state and column filtering as out-of-scope
generic features, the lower-risk choice is: DataTable renders `<thead>` + one `<tr>` per row
via `columns`, and `PositionsTable` renders its own `<tbody>` wrapper with the detail/total
rows interleaved AFTER calling a `<DataTable rows={rows} columns={columns} bodyOnly />`-style
partial, OR (simpler) `PositionsTable` does not use `<DataTable>`'s full `<table>` wrapper at
all and instead reuses only its exported header-cell/row-cell sub-pieces. Either is
CONTEXT-compliant ("either approach satisfies 'one DataTable, converged chrome'") — the
planner must pick one and state it, not defer to execution time.
**Warning signs:** A DataTable PR that grows an `expandedRow`/`totalRow` prop nobody asked for
(scope creep on a component CandidateTable never needed), or a PositionsTable migration that
duplicates DataTable's header/sort markup by hand (defeating the whole consolidation).

### Pitfall 6: jsdom matchMedia stub is required for EVERY desktop-tree test touching CandidateTable

**What goes wrong:** `Analyzer.tsx` renders `<AnalyzerMobile>` instead of its own desktop tree
when `useIsDesktop()` returns false, and jsdom has no real `matchMedia` implementation. Every
test in `Analyzer.test.tsx` that needs the desktop `CandidateTable` (not the mobile one) stubs
`window.matchMedia` via `Object.defineProperty` before rendering and calls
`Reflect.deleteProperty(window, "matchMedia")` in cleanup (confirmed: 13 occurrences of this
exact stub/cleanup pair in `Analyzer.test.tsx`). A new `DataTable.test.tsx` that tests the
primitive in isolation does NOT need this (it's not gated by `useIsDesktop`), but any executor
adding assertions to `Analyzer.test.tsx` for the migrated `CandidateTable` MUST follow the
existing per-`it()` stub/cleanup pattern, not assume a global `beforeEach` covers it (it
doesn't — the pattern is per-test, verified at lines 155, 202, 311, 461, 543, 590, 815, 849,
884, 1032, 1135, 1250, 1312).
**Why it happens:** jsdom has no native `matchMedia`; the codebase's existing workaround is
deliberately scoped per-test (not global) because most `Analyzer.test.tsx` tests want the
MOBILE tree by default (jsdom's default `matchMedia` absence resolves to "not desktop").
**How to avoid:** Copy the exact existing stub pattern verbatim (`Object.defineProperty(window,
"matchMedia", {...})` at test start, `Reflect.deleteProperty(window, "matchMedia")` at test
end) for any new/modified desktop-path test in `Analyzer.test.tsx`.
**Warning signs:** A new desktop-path test silently renders `AnalyzerMobile`'s markup instead
of the desktop `CandidateRail`, causing testid lookups to fail with a confusing "unable to
find element" rather than an obviously-wrong-tree error.

### Pitfall 7: No existing generic `<T>` component to copy from

**What goes wrong:** A search for `^export function \w+<T` across `apps/web/src` returns
ZERO matches — `DataTable<T>` will be the FIRST generic component in this codebase. There is
no established local idiom for generic-component `exactOptionalPropertyTypes` compliance, JSX
generic-arrow-function syntax choices, or displayName conventions to mirror.
**Why it happens:** Every existing UI component in `apps/web` is concretely typed to one
domain shape (candidates, positions, etc.) — genericity was never needed before this phase.
**How to avoid:** Since `DataTable.tsx` will be authored as `.tsx` (not `.ts`), use the
`<T,>` trailing-comma syntax (or an explicit `extends unknown` clause) to disambiguate the
generic from JSX in `.tsx` files — a well-known TS/JSX gotcha, not this codebase's own
convention. Write `DataTable.test.tsx` FIRST (TDD red) with a concrete test-only row type
(e.g. `interface TestRow { id: string; name: string }`) to prove the generic API before
wiring either real table onto it.
**Warning signs:** `tsc` parse errors like "JSX element 'T' has no corresponding closing tag"
if the generic syntax is written without the disambiguating comma/extends clause.

## Code Examples

Verified patterns from the live source (all `[VERIFIED: codebase read]` — direct file reads
of `apps/web/src/**`, no external docs consulted since there are no new libraries):

### Existing sort-cycle state machine (generalize verbatim into DataTable)

```typescript
// Source: apps/web/src/components/picker/CandidateTable.tsx:61-64
export function cycleSort(current: CandidateSortState, clicked: CandidateSortKey): CandidateSortState {
  if (current.key !== clicked) return { key: clicked, dir: "desc" };
  return { key: clicked, dir: current.dir === "desc" ? "asc" : "desc" };
}
```

### Existing sortable-header aria-sort pattern (generalize into DataTable's header cell)

```tsx
// Source: apps/web/src/components/picker/CandidateTable.tsx:66-88
function SortableHeader({ sortKey, sort, onSortChange }: {...}): React.ReactElement {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th
      className="cursor-pointer border-b border-line px-2 py-1.5 text-right font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase hover:text-txt"
      aria-sort={ariaSort}
      data-testid={`rail-sort-${sortKey}`}
      onClick={() => { onSortChange(sortKey); }}
    >
      {SORT_LABEL[sortKey]}
      {active && <span className="ml-0.5">{sort.dir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}
```

### Existing Button variant/tone lookup-map pattern (KEEP — do not reintroduce cva)

```typescript
// Source: apps/web/src/components/system/Button.tsx:39-60
const VARIANT_CLASS: Record<Exclude<ButtonVariant, "toggle">, string> = {
  primary: "bg-violet text-bg border border-violet hover:bg-violet/85",
  secondary: "bg-raise text-txt border border-line2 hover:border-violet/60 hover:bg-violet/10",
  ghost: "bg-transparent text-dim border border-transparent hover:text-txt hover:bg-line/60",
  destructive: "bg-transparent text-dim border border-transparent hover:text-down hover:bg-down/15",
};
```

### Existing per-row testid convention (preserve, don't generalize into a shared prefix)

```tsx
// Source: apps/web/src/components/picker/CandidateTable.tsx:118 (candidate rows)
<tr data-testid={`candidate-row-${candidate.id}`} ...>
// Source: apps/web/src/screens/Overview.tsx:190 (position rows)
<tr data-testid={`position-row-${r.key}`} ...>
```

### Existing matchMedia stub pattern (copy verbatim for any new desktop-path test)

```typescript
// Source: apps/web/src/screens/Analyzer.test.tsx:148-160 (pattern, one of 13 occurrences)
// D-16 desktop matchMedia stub (the Overview.test.tsx pattern) — jsdom has no matchMedia,
// so tests wanting the desktop tree stub it, then Reflect.deleteProperty(window, "matchMedia")
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({ matches: true, media: query, /* ... */ }),
});
// ... render + assertions ...
Reflect.deleteProperty(window, "matchMedia");
```

## State of the Art

Not applicable in the usual "framework version drift" sense — this is a same-repo,
same-version consolidation, not an upgrade. The one relevant "old → current" shift is
internal:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Two independently-styled, independently-tested `<table>` implementations (`CandidateTable`, `PositionsTable`) | One `DataTable` primitive, two thin column-def wrappers | This phase (42) | Any future table (Journal, if one ever appears — CONTEXT deferred) MUST use `DataTable`, per CONTEXT's own deferred-ideas note. |
| Two Button implementations (`ui/button.tsx` cva-based, `system/Button` lookup-map-based) | `system/Button` only | This phase (42) | `ui/button.tsx` deleted; any future shadcn-registry pull that scaffolds a NEW `ui/button.tsx` (e.g. `shadcn add button`) must be immediately re-deleted or redirected — flag this as a standing footgun for future phases, not resolved by this research. |

**Deprecated/outdated after this phase:**
- `components/ui/button.tsx` — deleted (step 4 of the Migration Manifest).
- Inline hex literals in `Login.tsx`/`RebuildButton.tsx` matching an existing token 1:1 —
  swept per Pitfall 2 (not deleted as files, but as literal values).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ui/dialog.tsx`'s base-ui `render` prop-merge does not require `system/Button` to forward a `ref` | Pitfall 3 | If wrong, dialog close-button focus-return silently breaks; UI-SPEC itself already flags this as unresolved and mandates a smoke test — this RESEARCH does not resolve it further, it is carried forward as a required executor verification step, not a locked fact. |
| A2 | PositionsTable's expandable detail row / Net total row should stay caller-composed (DataTable renders only header + one-row-per-item) rather than DataTable growing a `renderRowDetail` escape hatch | Pitfall 5 | Low risk either way per UI-SPEC ("either approach satisfies... one DataTable, converged chrome") — this is a recommendation, not a locked decision; the planner should still state its choice explicitly rather than silently deferring. |

**If this table is empty:** N/A — 2 items above need planner/executor confirmation before
becoming locked (A1 already has an explicit UI-SPEC-mandated smoke-test gate; A2 is a
recommendation the plan should state explicitly, not re-open).

## Open Questions

1. **Does `system/Button` need `React.forwardRef` for the base-ui dialog `render` prop-merge
   to preserve focus-trap/return-focus behavior?**
   - What we know: `system/Button` is a plain function component spreading `...props` onto a
     native `<button>`; `ui/button.tsx` (being deleted) wraps base-ui's OWN `<ButtonPrimitive>`
     component, which presumably already handles whatever ref-forwarding base-ui's dialog
     needs internally.
   - What's unclear: whether base-ui's `DialogPrimitive.Close render={<Button/>}` clone-merge
     specifically requires the cloned element to accept a forwarded ref, or whether it degrades
     gracefully (e.g. falls back to querying the DOM node via `data-slot` attributes instead).
   - Recommendation: UI-SPEC already mandates a manual smoke test after the swap (open dialog,
     click both close buttons, verify focus returns to trigger) — treat that as the
     resolution mechanism; do not attempt to resolve this by reading base-ui's source in this
     research pass (out of scope for a codebase-pattern research phase with zero new deps).

2. **Should `DataTable.tsx`'s test suite (Migration Manifest step 1) exercise the component
   with a concrete test-only row type, or should it import `PickerCandidate`/
   `BrokerPositionResponse` from `@morai/contracts` to test against a "real" shape?**
   - What we know: no existing generic component precedent exists to copy the answer from
     (Pitfall 7); TDD scope (`tdd.md`) requires "component logic" tests, which DataTable's
     sort-cycling/aria-sort/selection logic clearly is.
   - What's unclear: whether testing against a minimal synthetic row type (faster, fully
     decoupled from `@morai/contracts`) or a real domain type (proves the generic actually
     works end-to-end with production shapes) is preferred by this codebase's existing test
     philosophy.
   - Recommendation: use a minimal synthetic row type (`{ id: string; label: string; value:
     number }`-shaped) for `DataTable.test.tsx` itself — this is the standard for testing a
     truly generic/reusable primitive in isolation, and matches how `cycleSort`/`sortCandidates`
     were originally tested only indirectly through `Analyzer.test.tsx`'s domain-specific
     fixtures, not duplicated with a synthetic type at that layer. The CandidateTable/
     PositionsTable wrapper migrations (steps 2-3) then prove the real-shape integration via
     the EXISTING `Analyzer.test.tsx`/`AnalyzerMobile.test.tsx`/`Overview.test.tsx` suites
     staying green.

## Environment Availability

Skipped — this phase has no external dependencies (code-only changes inside `apps/web`, zero
new packages, no new services/tools/runtimes beyond what's already installed and verified
above in Standard Stack).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (workspace-level `bun run test` → `vitest run`) + `@testing-library/react` (existing convention in `Analyzer.test.tsx`/`Overview.test.tsx`/`AnalyzerMobile.test.tsx`) |
| Config file | `vitest.config.ts` (workspace root; `apps/web` participates via workspace config — no phase-specific config needed) |
| Quick run command | `bun run test -- apps/web/src/components/system/DataTable.test.tsx` (or the equivalent scoped Vitest invocation for the touched file) |
| Full suite command | `bun run test` (workspace-wide, 883 web tests green pre-phase per CONTEXT.md) |

### Phase Requirements → Test Map

No formal REQ-IDs exist for this phase (see `<phase_requirements>` above). Test coverage maps
to the Migration Manifest steps instead:

| Manifest Step | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| 1. DataTable primitive | Sort cycling, `aria-sort`, `rowTestId`, sticky header className | unit | `bun run test -- DataTable.test.tsx` | ❌ Wave 0 — new file |
| 2. CandidateTable → DataTable wrapper | Public API stable (candidates/pastedCandidates/sort/callbacks unchanged); Analyzer + AnalyzerMobile call sites untouched | regression (existing) | `bun run test -- Analyzer.test.tsx AnalyzerMobile.test.tsx` | ✅ existing, must stay green |
| 3. PositionsTable → DataTable columns | Live-greek overlay cells, VERDICT column, `formatExpiryCell`, unlinked-verdicts, detail/total rows preserved | regression (existing) | `bun run test -- Overview.test.tsx` | ✅ existing, must stay green |
| 4. Button unification | `ui/dialog.tsx` close-button behavior (both sites), Login submit, RebuildButton confirm/cancel | regression (existing) + manual smoke (Pitfall 3) | `bun run test -- Login.test.tsx RebuildButton.test.tsx dialog` (verify actual test file names exist before citing in a plan) | ⚠️ verify — no `Login.test.tsx`/`RebuildButton.test.tsx` was confirmed to exist in this research pass; planner should `ls apps/web/src/screens/Login.test.tsx apps/web/src/components/RebuildButton.test.tsx` before committing to this row |
| 5. Token sweep + docs | Mechanical hex→token replacement, no behavior change | visual + `tsc`/lint | `bun run typecheck && bun run lint` + chrome-devtools screenshot diff at 1512×860 / 2056×1329 (UI-SPEC-mandated) | N/A — styling-only, TDD-exempt per `tdd.md` scope |

### Sampling Rate

- **Per task commit:** the scoped Vitest file(s) for the file(s) touched in that task.
- **Per wave merge:** `bun run test` (full 883+ suite) + `bun run typecheck` + `bun run lint`.
- **Phase gate:** full suite green + the two chrome-devtools screenshot checks (Overview,
  Analyzer, both viewport sizes) before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `apps/web/src/components/system/DataTable.test.tsx` — covers Migration Manifest step 1
      (sort cycling, `aria-sort`, `rowTestId`, sticky header). TDD red-first per `tdd.md`.
- [ ] Confirm whether `Login.tsx` / `RebuildButton.tsx` have existing test files before
      planning the Button-migration task's verification step (not confirmed to exist in this
      research pass — planner must check with `ls`, not assume).
- [ ] No new shared fixtures needed — `Analyzer.test.tsx`'s existing `SORTED_CANDIDATES`
      fixture and `Overview.test.tsx`'s existing position fixtures already cover the
      real-shape regression surface for steps 2-3.

*(Framework already installed and configured — no `bun add`/config step needed.)*

## Security Domain

`security_enforcement` is enabled (`.planning/config.json` `workflow.security_enforcement:
true`, ASVS level 1). This phase introduces no new attack surface:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Unmodified — `Login.tsx`'s Supabase auth call (`supabase.auth.signInWithPassword`) is untouched; only its `<Button>` import changes. |
| V3 Session Management | No | Unmodified — no session/token logic in scope. |
| V4 Access Control | No | Unmodified — no route/permission logic touched. |
| V5 Input Validation | No | DataTable is purely presentational (renders already-validated `PickerCandidate`/`BrokerPositionResponse` domain objects); no new user input surface is introduced. |
| V6 Cryptography | No | Not applicable — no crypto in this phase. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via unescaped `render(row)` output | Tampering | Not a new risk — every existing cell already renders through JSX's automatic escaping (`{value}`), and DataTable's `render: (row: T) => React.ReactNode` return type keeps this invariant; no `dangerouslySetInnerHTML` exists in either current table and none should be introduced. |
| Ref-forwarding gap breaking a11y focus management (Pitfall 3) | — (not a STRIDE category; an accessibility regression, not a security threat) | Manual smoke test per UI-SPEC's own mandate, not a new control needed. |

No genuine new threat surface exists in this phase — it is a pure presentational refactor of
already-rendered, already-validated data.

## Sources

### Primary (HIGH confidence — direct codebase reads, `[VERIFIED: codebase read]`)

- `apps/web/src/components/picker/CandidateTable.tsx` (316 lines, read in full) — sort/select/testid patterns
- `apps/web/src/screens/Overview.tsx` (840 lines, read relevant sections) — PositionsTable anatomy, call site
- `apps/web/src/screens/overview-mobile/useOverviewModel.ts` — `formatExpiryCell`/`buildRows` source location
- `apps/web/src/components/system/Button.tsx` (100 lines, read in full) — KEEP-side Button API
- `apps/web/src/components/ui/button.tsx` (58 lines, read in full) — RETIRE-side Button API, variant/size enums
- `apps/web/src/components/ui/dialog.tsx` (158 lines, read in full) — base-ui `render` prop-merge integration risk
- `apps/web/src/screens/Login.tsx` (241 lines, read in full) — hand-rolled hex Button call site
- `apps/web/src/components/RebuildButton.tsx` (read in full) — hand-rolled hex Button + Dialog call site
- `apps/web/src/components/system/index.tsx` (168 lines, read in full) — Panel/molecules layer, "no hardcoded hex" rule comment
- `apps/web/src/index.css` (149 lines, read in full) — `@theme` token source of truth
- `docs/architecture/design-system.md` (38 lines, read in full) — **pre-existing doc, not a new file**
- `docs/TOPIC-MAP.md` (read Architecture section) — confirmed `design-system.md` is MISSING from the index
- `apps/web/src/screens/Analyzer.test.tsx`, `AnalyzerMobile.test.tsx`, `Overview.test.tsx` (grep-verified testid/matchMedia patterns)
- `apps/web/package.json`, `apps/web/components.json`, `eslint.config.js`, `.planning/config.json` — version/tooling verification

### Secondary (MEDIUM confidence)

- None — no external documentation was consulted (no ecosystem question exists in this phase).

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, every version pinned directly from `package.json`.
- Architecture: HIGH — both tables and both Buttons read in full; migration manifest sourced from checker-approved UI-SPEC.
- Pitfalls: HIGH for Pitfalls 1, 2, 4, 6, 7 (directly grep/read-verified); MEDIUM for Pitfall 3 (base-ui ref-forwarding behavior not verified against library internals — correctly flagged as an open question, not a resolved fact) and Pitfall 5 (UI-SPEC itself calls this unresolved).

**Research date:** 2026-07-15
**Valid until:** No expiry driver — this is a same-commit, same-dependency-set codebase
research artifact; it goes stale only if `CandidateTable.tsx`/`Overview.tsx`/`Button.tsx`/
`dialog.tsx` are modified by another phase before Phase 42 executes. Recommend re-verifying
file contents at plan time if more than a few days elapse.
