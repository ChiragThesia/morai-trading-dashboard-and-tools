# Design System

The web UI uses one design system. Screens compose it. They do not hand-roll styles.

## Layers

| Layer | Where | What |
|---|---|---|
| Tokens | `apps/web/src/design/tokens.dtcg.json` | LOCKED palette, fonts, radii. Source of truth (W3C DTCG). |
| Atoms | `apps/web/src/components/ui/*` | shadcn primitives (Badge, Card, Input, Tabs, Tooltip…). |
| Molecules | `apps/web/src/components/system/` | Morai composites: Panel, PanelHeading, SectionLabel, Stat, MetricChip, DataTable, Button. |
| Organisms | `apps/web/src/screens/*` | Screen cards built from the layers above. |

## Tokens

Authored once in `design/tokens.dtcg.json`, compiled by `bun run tokens` into two
committed outputs: `tokens.generated.css` (the `@theme` layers Tailwind reads) and
`tokens.generated.ts` (resolved values for code that needs a colour or font as a *value* —
Recharts/visx props, canvas, inline SVG).

Three tiers. Components consume tier 2.

| Tier | What | Example |
|---|---|---|
| 1 primitive | Raw ramps. Never referenced from a component. | `ink.700`, `teal.500` |
| 2 semantic | Intent. Renaming a value here re-themes the product. | `surface-raised`, `value-positive` |
| 3 component | Only where a component needs a JS prop value or legitimately diverges. | `chart.*`, `banner.*` |

The semantic vocabulary, by group:

- **Surfaces** (elevation ladder — higher elevation, lighter surface) — `bg-surface-base`
  (the page), `bg-surface-sunken` (recessed area in a card), `bg-surface-raised` (standard
  card), `bg-surface-overlay` (control on a card; popover/menu), `bg-surface-glow`.
  The gradient card is `from-surface-raised to-surface-sunken`.
- **Borders** — `border-line-subtle` / `ring-line-subtle` (default hairline),
  `border-line-strong` (input outline, chart zero line).
- **Text** — `text-fg-primary` (values and body), `text-fg-secondary` (labels and column
  headers), `text-fg-tertiary` (de-emphasised, stale, axis).
- **Values** — signed P&L and greeks only: `text-value-positive`, `text-value-negative`,
  and their tint surfaces `bg-value-positive-surface` / `bg-value-negative-surface`.
  Never use an accent colour for a signed number.
- **Accents** — `accent-primary` (primary action, focus ring, selection),
  `accent-primary-surface` (selected-row tint, change flash), `accent-warning` (events,
  guards, roll overlay), `accent-info` (spot marker), `accent-highlight`.
- **Type** — `font-display` (Space Grotesk), `font-mono` (JetBrains Mono). As a value:
  `token.font.display` / `token.font.mono`.

The shadcn bridge maps `text-muted-foreground` onto `fg-secondary` and `bg-muted` onto the
sunken surface. Those names stay for the shadcn atoms in `components/ui/`; new Morai code
uses the semantic names above. `bg-muted` and `bg-surface-raised` are different on purpose.
Do not collapse them.

The pre-token utility names (`bg-panel`, `text-txt`, `text-dim`, `text-up`, `text-down`,
`ring-line`, `text-violet`, …) were a staged-migration shim. **They are deleted.**
`bun run tokens:lint` fails the build if one reappears — Tailwind emits nothing for an
unknown class, so a regression is otherwise invisible until someone sees black-on-black.

## DataTable

`components/system/DataTable.tsx` is the one column-def table primitive every screen
table renders through (Overview's positions, the Analyzer's candidates). Columns are
`{ key, header, align?, mono?, sortable?, width?, render(row) }`; DataTable owns the
sticky header and one `<tr>` per row and nothing else — sort state, selection, and row
highlighting stay caller-owned via props. `renderRowDetail`/`footer` slots let a screen
add an expandable detail row or a totals row without DataTable knowing its shape.

## Rules for screens

1. No hardcoded hex. No inline `color`/`background`/`fontFamily`. Use tokens.
2. No re-implementing a card header or KPI inline — use `Panel`, `PanelHeading`, `Stat`.
3. Layout-only inline styles are fine: grid spans, fixed chart pixel sizes.
4. Reach for a shadcn atom before building one. Add a molecule only when two screens repeat it.

## Reference

`apps/web/src/components/Shell.tsx` is the canonical example — header, nav tabs, and the
market strip (`MetricChip`) all built on tokens, zero inline color.
