## How to build with Morai

Morai is a **dark-only** trading dashboard system. There is no light theme — do not
add one, and do not add a theme toggle. Every surface sits on `--color-bg` (`#0a0e14`).

### Setup

There is **no provider to wrap your app in** for styling — the tokens come from
`styles.css`, which is already loaded. Two runtime requirements:

- **Components that fetch their own data** — `NewsCard`, `CotCard`, `RegimeBoard`,
  `AuthExpiredBanner`, and `Shell` — take **no props**. They read TanStack Query hooks
  internally, so they must have a `QueryClientProvider` above them (`QueryClient` and
  `QueryClientProvider` are exported from this library). Without one they throw
  "No QueryClient set". Every other component is pure and takes its data as props.
- **`ChartContainer`** must be given a **definite `aspect-ratio`**, never a percentage
  height — a `%` height collapses to 0 in a real browser. `ChartTooltipContent` and
  `ChartLegendContent` read its context and throw outside it.

### The styling idiom

Tailwind v4 utilities over a locked token palette. **Never hardcode a hex value and
never set colour or font in an inline style** — inline styles are for layout only
(grid spans, fixed chart widths). Use these families:

| Purpose | Utilities |
|---|---|
| Surfaces | `bg-bg` `bg-panel` `bg-panel2` `bg-raise` `bg-card` `bg-muted` |
| Borders / rules | `ring-line` `ring-line2` `border-line2` |
| Text | `text-txt` (primary) `text-muted-foreground` (labels) `text-dim` (faint) `text-foreground` |
| Signed values | `text-up` (teal, gains) `text-down` (coral, losses) |
| Accents | `text-violet` `text-amber` `text-blue` `text-cyan`, and `bg-violet` `bg-amber` `bg-blue` `bg-up` `bg-down` `bg-downd` |
| Type | `font-display` (Space Grotesk — headings/labels) `font-mono` (JetBrains Mono — **all numbers**) `tabular-nums` |

Every number in this product is monospace and tabular. The body default is already
`font-mono` at 12px.

The same values exist as CSS variables when you need them raw: `--color-bg`,
`--color-panel`, `--color-panel2`, `--color-raise`, `--color-line`, `--color-line2`,
`--color-txt`, `--color-muted`, `--color-dim`, `--color-up`, `--color-down`,
`--color-downd`, `--color-violet`, `--color-violetd`, `--color-amber`, `--color-blue`,
`--color-cyan`, `--font-display`, `--font-mono`, `--radius`.

> The shipped stylesheet is the **app's compiled Tailwind build**, so arbitrary
> utilities outside these families may not exist in it. Stay inside the table above,
> or use the CSS variables directly.

### Compose, don't rebuild

Reach for the primitives before writing a `div`:

- `Panel` is the standard card surface; `PanelHeading` gives it a title + badge +
  right-aligned action; `SectionLabel` is the 10px uppercase heading.
- `Stat` is the label-over-value KPI cell. `MetricChip` is the bordered pill for
  header strips (`alert` swaps it to the danger surface).
- `Button` is the **only** control affordance — `variant` is
  `primary | secondary | ghost | destructive | toggle`, and `variant="toggle"` with
  `active` is the on/off state (`tone`: `violet | amber | up | down`).
- `DataTable` is the **only** table. Sort and selection state are caller-owned;
  it renders `sort` and emits `onSortChange`.
- `ChipRail` is the horizontal scroll-snap rail used below `lg:`.

### Where the truth is

Read `_ds/<folder>/styles.css` and its `@import`s for the real token values, and each
component's `<Name>.prompt.md` and `<Name>.d.ts` for its API before composing.

### An idiomatic snippet

```tsx
<Panel>
  <PanelHeading
    title="Open positions"
    badge={<span className="text-[10px] text-up">live</span>}
    action={<Button variant="ghost" size="xs">Re-pull</Button>}
  />
  <div className="grid grid-cols-4 gap-3">
    <Stat label="Mark" value="$4,627.55" />
    <Stat label="Unreal" value="+$412.55" valueClassName="text-up" />
    <Stat label="Theta" value="+45.9" valueClassName="text-up" />
    <Stat label="Gamma" value="—" valueClassName="text-dim" />
  </div>
</Panel>
```

A missing value renders as `—` in `text-dim` — never `0`, and never a fabricated
number. That rule holds across the whole system.
