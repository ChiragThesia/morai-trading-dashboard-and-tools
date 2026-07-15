# Phase 42: Design-system consolidation - Pattern Map

**Mapped:** 2026-07-15
**Files analyzed:** 10 (1 new, 7 modified, 1 deleted, 1 doc-index)
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/src/components/system/DataTable.tsx` (NEW) | component (system/molecule) | request-response (pure render, caller-owned state) | `apps/web/src/components/picker/CandidateTable.tsx` | exact (generalize verbatim) |
| `apps/web/src/components/system/DataTable.test.tsx` (NEW) | test | — | `apps/web/src/components/system/Button.tsx` conventions + `Analyzer.test.tsx` sort-cycle assertions | role-match |
| `apps/web/src/components/picker/CandidateTable.tsx` (MODIFIED → thin wrapper) | component | request-response | itself, pre-refactor (source of the generalized logic) | exact |
| `apps/web/src/screens/Overview.tsx` (`PositionsTable`, MODIFIED) | component | request-response + live-stream overlay | `CandidateTable.tsx` (post-migration DataTable usage) | role-match (extra: detail-row + total-row caller-composed) |
| `apps/web/src/screens/Login.tsx` (MODIFIED) | component (screen) | request-response | `apps/web/src/components/RebuildButton.tsx` (sibling Button+hex offender) | role-match |
| `apps/web/src/components/RebuildButton.tsx` (MODIFIED) | component | request-response | `Login.tsx` (sibling Button+hex offender) | role-match |
| `apps/web/src/components/ui/dialog.tsx` (MODIFIED) | component (ui atom) | request-response | itself, `Button` import swap only | exact |
| `apps/web/src/components/system/index.tsx` (MODIFIED, add export) | barrel/config | — | itself (existing `export { Button, buttonClass } from "./Button.tsx"` line) | exact |
| `docs/architecture/design-system.md` (MODIFIED, update not create) | config/doc | — | itself (38-line existing doc) | exact |
| `docs/TOPIC-MAP.md` (MODIFIED, add row) | config/doc | — | itself, Architecture table | exact |
| `apps/web/src/components/ui/button.tsx` (DELETED) | component (ui atom) | — | n/a | n/a |

## Pattern Assignments

### `apps/web/src/components/system/DataTable.tsx` (NEW — component, request-response)

**Analog:** `apps/web/src/components/picker/CandidateTable.tsx` (full file read, 316 lines)

**Sort-cycle state machine — generalize verbatim** (`CandidateTable.tsx:61-64`):
```typescript
export function cycleSort(current: CandidateSortState, clicked: CandidateSortKey): CandidateSortState {
  if (current.key !== clicked) return { key: clicked, dir: "desc" };
  return { key: clicked, dir: current.dir === "desc" ? "asc" : "desc" };
}
```
Generalize to `cycleSort<K extends string>(current: { key: K; dir: "asc"|"desc" }, clicked: K)`.
Sort state itself stays CALLER-owned (`useState` in `Analyzer.tsx`/`AnalyzerMobile.tsx`) — DataTable
only renders `aria-sort` + emits `onSortChange(key)`, never owns a `useState` internally (UI-SPEC
"What DataTable does NOT own": row selection state; same principle extends to sort state).

**Sortable header / aria-sort** (`CandidateTable.tsx:66-88`):
```tsx
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
DataTable's header cell for `sortable: true` columns must reproduce this class string and
`aria-sort` logic exactly (UI-SPEC pins these as the chrome-reference classes, not to be altered).
Non-sortable header `<th>` uses the same font classes minus `cursor-pointer`/`aria-sort`
(`CandidateTable.tsx:263-282` — plain `<th>` elements, e.g. "Calendar", "Δ", "Γ").

**Row + sticky-header + selected-state chrome** (`CandidateTable.tsx:116-124, 258-260`):
```tsx
<div className={wrapperClassName} data-testid={wrapperTestId}>
  <table className={cn("w-full border-collapse font-mono text-[11px] tabular-nums", tableClassName)}>
    <thead className="sticky top-0 z-10 bg-panel">
      ...
<tr
  data-testid={`candidate-row-${candidate.id}`}
  onClick={() => { onSelect(candidate); }}
  className={cn(
    "cursor-pointer border-b border-line/60 text-txt hover:bg-line/40",
    selected && "border-l-2 border-l-violet bg-violet/[0.06]",
  )}
>
```
DataTable owns: `wrapperClassName` passthrough div, `tableClassName` passthrough `<table>`, the
`sticky top-0 z-10 bg-panel` thead, per-row `hover:bg-line/40`, and takes a caller-supplied
`rowClassName(row)` fn instead of a hardcoded `selected` boolean (UI-SPEC: PositionsTable's
`bg-raise/20` highlight is a DIFFERENT treatment — do not collapse the two into one boolean prop).

**Trailing action cell, click-stop pattern** (`CandidateTable.tsx:192-217`):
```tsx
<td className="px-1 py-1.5" onClick={(e) => { e.stopPropagation(); }}>
  <span className="flex items-center justify-center gap-1">
    <Button variant="toggle" tone="amber" size="xs" active={combinedIds.has(candidate.id)} .../>
  </span>
</td>
```
This is just the LAST `render()` column — DataTable does not need a dedicated `actions` prop
(UI-SPEC anti-pattern callout, RESEARCH "Don't Hand-Roll" table).

**Required `rowTestId` fn prop, no default** — preserve both existing conventions verbatim:
```tsx
// CandidateTable.tsx:118
<tr data-testid={`candidate-row-${candidate.id}`} ...>
// Overview.tsx:190
<tr data-testid={`position-row-${r.key}`} ...>
```

**Column widths / props shape carried into DataTable's `DataTableColumn<T>`** — see
`42-UI-SPEC.md` "Component Contract — DataTable Primitive" (already-locked interface, copy
verbatim, do not redesign):
```ts
interface DataTableColumn<T> {
  readonly key: string;
  readonly header: React.ReactNode;
  readonly align?: "left" | "right";
  readonly mono?: boolean;
  readonly sortable?: boolean;
  readonly width?: string;
  readonly render: (row: T) => React.ReactNode;
}
```
`exactOptionalPropertyTypes` pitfall: build optional-key objects via spread, never
`align: cond ? "left" : undefined` (UI-SPEC Pitfall 4 / RESEARCH Pattern 1).

**Generic-component syntax note (no local precedent exists — RESEARCH Pitfall 7):** use the
`<T,>` trailing-comma disambiguator (this is the FIRST generic component in the codebase; no
file to copy the idiom from).

---

### `apps/web/src/components/system/DataTable.test.tsx` (NEW — test)

**Analog for test-file conventions:** no direct DataTable precedent exists; follow this
codebase's existing `*.test.tsx` co-location (component + `.test.tsx` sibling, e.g.
`Button.tsx` has no test file itself but `Analyzer.test.tsx` demonstrates the harness/RTL
convention) and the matchMedia-stub pattern below IF any test needs the desktop tree (DataTable
itself does not — it's not gated by `useIsDesktop`).

**matchMedia stub (only needed if extending `Analyzer.test.tsx`, not `DataTable.test.tsx`
itself)** — copy verbatim (`Analyzer.test.tsx:148-160` pattern, 13 occurrences):
```typescript
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({ matches: true, media: query, /* ... */ }),
});
// ... render + assertions ...
Reflect.deleteProperty(window, "matchMedia");
```

Use a minimal synthetic row type (`{ id: string; label: string; value: number }`-shaped) per
RESEARCH's Open Question 2 recommendation — do not import `@morai/contracts` domain types into
this unit-level test file.

---

### `apps/web/src/components/picker/CandidateTable.tsx` (MODIFIED → thin wrapper)

**Analog:** itself (pre-refactor) — public API must stay byte-stable:
```ts
export interface CandidateTableProps {
  readonly candidates: ReadonlyArray<PickerCandidate>;
  readonly pastedCandidates: ReadonlyArray<PickerCandidate>;
  readonly selectedId: string;
  readonly combinedIds: ReadonlySet<string>;
  readonly sort: CandidateSortState;
  readonly onSortChange: (key: CandidateSortKey) => void;
  readonly onSelect: (candidate: PickerCandidate) => void;
  readonly onToggleCombine: (candidate: PickerCandidate) => void;
  readonly onRemovePasted: (candidate: PickerCandidate) => void;
  readonly wrapperClassName: string;
  readonly tableClassName?: string;
  readonly wrapperTestId?: string;
}
```
(`CandidateTable.tsx:222-241`). Keep this signature; internals become column-defs + rows built
from `candidates`/`pastedCandidates`, passed to `<DataTable>`. `Analyzer.tsx`/`AnalyzerMobile.tsx`
call sites need zero changes if the wrapper is faithful (UI-SPEC Migration Manifest step 2).

---

### `apps/web/src/screens/Overview.tsx` `PositionsTable` (MODIFIED)

**Analog:** `CandidateTable.tsx`'s post-migration DataTable usage (same primitive, different
column-defs). Full current implementation read at `Overview.tsx:88-330+`.

**Live-greek overlay cell pattern to preserve as `render()` fns** (`Overview.tsx:252-293`):
```tsx
<td key={`${r.key}-netval-${liveTs ?? ""}`} className={cn("px-2 py-1 text-right text-txt", flashCn)}>
  {usd(val)}
</td>
```
Each `<td>`'s `key={...-${liveTs ?? ""}}` (forces remount for flash animation) and `flashCn`
computation must survive as a per-column `render(row)` closure — DataTable's generic
`render: (row: T) => React.ReactNode` signature supports this unchanged.

**Detail row + Net total row — caller-composed, NOT a DataTable feature** (`Overview.tsx:306-330`):
```tsx
{expanded && verdict !== null && (
  <tr data-testid={`position-verdict-detail-${r.key}`}>
    <td className="px-2 pb-2" />
    <td className="px-2 pb-2" colSpan={COLS.length}>
      <VerdictDetailBody row={verdict} observedAt={verdictObservedAt ?? ""} />
    </td>
  </tr>
)}
...
<tr className="border-t border-line font-semibold">
  <td className="px-2 py-1" />
  <td className="px-2 py-1 text-left text-txt">Net ...</td>
```
Per UI-SPEC's explicit unresolved-but-recommended choice (Pitfall 5 / A2): DataTable renders
only `<thead>` + one `<tr>` per row; `PositionsTable` keeps composing its own `<tbody>` wrapper
with these two extra row kinds interleaved around/after `<DataTable>`'s mapped rows (or reuses
only DataTable's header/row sub-pieces without its outer `<table>` wrapper). State this choice
explicitly in the plan, don't defer to the executor.

**Row highlight (DIFFERENT from CandidateTable's selected-row treatment)** (`Overview.tsx:194-198`):
```tsx
className={cn(
  "cursor-pointer border-b border-line/50 transition-opacity hover:bg-raise/30",
  !included && "opacity-40",
  highlightedRowKey === r.key && "bg-raise/20",
)}
```
Pass via DataTable's `rowClassName(row)` fn — flat highlight, no left-border, unlike
CandidateTable's `border-l-2 border-l-violet bg-violet/[0.06]`.

**Checkbox include cell, click-stop** (`Overview.tsx:200-211`) — same pattern as
CandidateTable's action cell, becomes DataTable's leading column's `render()`.

**Empty-state early return — DataTable does NOT own this** (`Overview.tsx:149-155`):
```tsx
if (rows.length === 0) {
  return (
    <p className="font-mono text-[11px] text-dim">
      No open positions. Register a calendar via the API or paste a TOS order in the Analyzer.
    </p>
  );
}
```
Keep verbatim, unchanged, before mounting `<DataTable>`.

---

### `apps/web/src/screens/Login.tsx` (MODIFIED)

**Analog:** sibling offender `RebuildButton.tsx` (same two literals, same fix shape).

**Current hand-rolled Panel-equivalent to replace** (`Login.tsx:94-102`):
```tsx
<div
  style={{
    width: "100%",
    maxWidth: "360px",
    background: "linear-gradient(180deg, #0f1521, #0c111a)",
    border: "1px solid #1b2433",
    borderRadius: "12px",
    padding: "24px",
  }}
>
```
Target: `Panel`'s existing utility classes (`bg-gradient-to-b from-panel to-panel2 ring-1
ring-line`, `apps/web/src/components/system/index.tsx:34-47`) — swap the inline `style` for
`<Panel className="max-w-[360px] w-full !p-6 !rounded-xl">` or equivalent token classes (keep
`24px`/`12px` sizing, only the color/border literals are sweep targets per UI-SPEC "Sweep
scope": don't touch values that don't match a token 1:1).

**Button import to change** (`Login.tsx:4`):
```tsx
import { Button } from "../components/ui/button.tsx";
```
→ `import { Button } from "../components/system/index.tsx";` (or direct `./Button.tsx` path,
match whichever import style `CandidateTable.tsx:15` uses: `import { Button } from
"../system/index.tsx";`). Variant mapping: this file's primary submit button → `variant="primary"`
per UI-SPEC's Button Consolidation table.

---

### `apps/web/src/components/RebuildButton.tsx` (MODIFIED)

**Analog:** `Login.tsx` (same literal offenders).

**Button import** (`RebuildButton.tsx:11`):
```tsx
import { Button } from "@/components/ui/button";
```
→ `import { Button } from "@/components/system/index.tsx";` — map `size="icon-sm"` → nearest
`system/Button` `size="xs"` (UI-SPEC: no icon-only tier exists on `system/Button`, drift
accepted).

**Inline hex to sweep** (`RebuildButton.tsx:69-73`):
```tsx
style={{
  background: "linear-gradient(180deg, #0f1521, #0c111a)",
  border: "1px solid #1b2433",
  maxWidth: 400,
}}
```
Target per UI-SPEC: `<DialogContent className="max-w-[400px]">` composed with `Panel`'s
gradient utility classes, or at minimum swap the two hex/gradient literals for
`bg-gradient-to-b from-panel to-panel2 border-line` token classes — `maxWidth: 400` (a layout
value, not a color) can stay inline per the design-system doc's own "layout-only inline styles
are fine" rule.

---

### `apps/web/src/components/ui/dialog.tsx` (MODIFIED)

**Analog:** itself — only the Button import line changes, JSX usage (`render={<Button .../>}`)
stays structurally identical.

**Import to change** (`dialog.tsx:5`):
```tsx
import { Button } from "@/components/ui/button"
```
→ `import { Button } from "@/components/system/index.tsx"` (or `./Button.tsx` sibling path —
match whichever the other migrated call sites use for consistency).

**Two `render` prop-merge call sites, unchanged JSX, mapped variants** (`dialog.tsx:60-69, 110-112`):
```tsx
<DialogPrimitive.Close
  data-slot="dialog-close"
  render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}
>
...
<DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
```
Map: `variant="ghost"` → `system/Button` `variant="ghost"` (unchanged name, verify prop exists —
it does, `ButtonVariant` includes `"ghost"`). `variant="outline"` → `system/Button`
`variant="secondary"` (no `"outline"` value on `system/Button`'s `ButtonVariant` union — this is
a REQUIRED rename, not a passthrough). `size="icon-sm"` → `size="xs"` (no icon-only tier).
**Known integration risk (UI-SPEC-flagged, unresolved):** `system/Button` is a plain function
component with no `React.forwardRef` (`Button.tsx:88-100`) — smoke-test both close buttons after
the swap (open dialog, click both, verify focus returns to trigger), not just visual eyeball.

---

### `apps/web/src/components/system/index.tsx` (MODIFIED — add barrel export)

**Analog:** itself, existing Button export line (`index.tsx:22-23`):
```typescript
export { Button, buttonClass } from "./Button.tsx";
export type { ButtonProps, ButtonVariant, ButtonTone, ButtonSize } from "./Button.tsx";
```
Add directly below/near this block:
```typescript
export { DataTable } from "./DataTable.tsx";
export type { DataTableColumn, DataTableProps } from "./DataTable.tsx";
```
Also update the file's own top-of-file doc comment (`index.tsx:1-18`) — it currently lists
`Panel, PanelHeading, SectionLabel, Stat, MetricChip` as "THIS FILE" molecules and separately
notes `Button`/`ChipRail`/`BulletGauge` are barrel-re-exported from sibling files; add
`DataTable` to that same re-export list, one line, matching the existing comment style — do not
rewrite the whole header comment.

---

### `docs/architecture/design-system.md` (MODIFIED — UPDATE, not create)

**Analog:** itself — the file already exists (38 lines, read in full above). This is an
additive edit, not a new-file write.

**Current Atoms row to correct** (design-system.md, "Layers" table):
```
| Atoms | `apps/web/src/components/ui/*` | shadcn primitives (Button, Badge, Card, Input, Tabs, Tooltip…). |
```
After this phase `ui/button.tsx` is deleted — reword to drop "Button" from the Atoms row's
example list (one-line correction, per RESEARCH Pitfall 1), and add a `DataTable` entry to the
Molecules row:
```
| Molecules | `apps/web/src/components/system/` | Morai composites: Panel, PanelHeading, SectionLabel, Stat, MetricChip, DataTable, Button. |
```
Do not replace the whole file — add these two row edits + a short DataTable description
paragraph (column-def shape, one sentence), matching the doc's existing terse style (its
current "Rules for screens" numbered list is the tone/length reference).

---

### `docs/TOPIC-MAP.md` (MODIFIED — add missing row)

**Analog:** itself — the Architecture table (`TOPIC-MAP.md` line 6 section header confirmed;
`design-system.md` currently has NO row despite the file existing on disk, per RESEARCH's
direct grep confirmation). Add one row to the existing Architecture table in the same format as
its sibling rows (file path + one-line description) — do not restructure the table.

---

## Shared Patterns

### Design tokens (source of truth — never restate hex)
**Source:** `apps/web/src/index.css` `@theme` block; consumed via `components/system/index.tsx`'s
`Panel` (`bg-gradient-to-b from-panel to-panel2 p-3 ring-1 ring-line`, `index.tsx:34-47`).
**Apply to:** `DataTable.tsx` (sticky header `bg-panel`), `Login.tsx`/`RebuildButton.tsx` token
sweep, `design-system.md` doc update.

### Button variant/tone lookup maps (KEEP side — do not reintroduce cva)
**Source:** `apps/web/src/components/system/Button.tsx:39-60`
```typescript
const VARIANT_CLASS: Record<Exclude<ButtonVariant, "toggle">, string> = {
  primary: "bg-violet text-bg border border-violet hover:bg-violet/85",
  secondary: "bg-raise text-txt border border-line2 hover:border-violet/60 hover:bg-violet/10",
  ghost: "bg-transparent text-dim border border-transparent hover:text-txt hover:bg-line/60",
  destructive: "bg-transparent text-dim border border-transparent hover:text-down hover:bg-down/15",
};
```
**Apply to:** every Button call-site migration (`Login.tsx`, `RebuildButton.tsx`, `dialog.tsx`) —
map the retiring `ui/button.tsx` variant names onto this table, never add a new variant.

### `cn()` className merge helper
**Source:** `apps/web/src/lib/utils.ts` (`cn`), used throughout `CandidateTable.tsx`,
`Button.tsx`, `system/index.tsx`. **Apply to:** `DataTable.tsx`'s `rowClassName`/
`tableClassName`/`wrapperClassName` merges — same helper, no new one.

### Per-row `data-testid` fn convention (not a static prefix)
**Source:** `CandidateTable.tsx:118` / `Overview.tsx:190` (see File Classification above).
**Apply to:** `DataTable.tsx`'s `rowTestId(row): string` required prop.

### matchMedia jsdom stub (per-test, not global)
**Source:** `apps/web/src/screens/Analyzer.test.tsx:148-160` (13 occurrences).
**Apply to:** any modified assertion in `Analyzer.test.tsx`/`AnalyzerMobile.test.tsx`/
`Overview.test.tsx` that exercises the migrated desktop table tree.

## No Analog Found

None — every file in scope has a direct or sibling analog already read above.

## Metadata

**Analog search scope:** `apps/web/src/components/picker/`, `apps/web/src/components/system/`,
`apps/web/src/components/ui/`, `apps/web/src/screens/`, `apps/web/src/components/RebuildButton.tsx`,
`docs/architecture/`, `docs/TOPIC-MAP.md`.
**Files scanned (full or targeted read):** `CandidateTable.tsx` (full, 316 lines), `Button.tsx`
(full, 100 lines), `dialog.tsx` (full, 158 lines), `system/index.tsx` (full, 168 lines),
`Overview.tsx` (targeted, lines 88-330), `Login.tsx` (targeted, lines 85-125), `RebuildButton.tsx`
(targeted, lines 55-95), `design-system.md` (full, 38 lines), `TOPIC-MAP.md` (targeted grep).
**Pattern extraction date:** 2026-07-15
</content>
