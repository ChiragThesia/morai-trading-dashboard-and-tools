# Design System

The web UI uses one design system. Screens compose it. They do not hand-roll styles.

## Layers

| Layer | Where | What |
|---|---|---|
| Tokens | `apps/web/src/index.css` (`@theme`) | LOCKED palette, fonts, radii. Source of truth. |
| Atoms | `apps/web/src/components/ui/*` | shadcn primitives (Button, Badge, Card, Input, Tabs, Tooltip…). |
| Molecules | `apps/web/src/components/system/` | Morai composites: Panel, PanelHeading, SectionLabel, Stat, MetricChip. |
| Organisms | `apps/web/src/screens/*` | Screen cards built from the layers above. |

## Tokens

Defined once in `index.css`. Use the Tailwind utility, never the hex.

- Surfaces — `bg-panel`, `from-panel to-panel2` (the gradient card), `bg-raise`.
- Borders — `ring-line`, `ring-line2`.
- Text — `text-txt` (primary), `text-muted-foreground` (#7b8696 label gray), `text-dim` (#566273 faint).
- Accents — `text-up` (green), `text-down` (red), `text-violet`, `text-amber`, `text-blue`.
- Type — `font-display` (Space Grotesk), `font-mono` (JetBrains Mono).

The shadcn bridge maps `text-muted-foreground` to the label gray and `bg-muted` to the
panel surface. They are different on purpose. Do not collapse them.

## Rules for screens

1. No hardcoded hex. No inline `color`/`background`/`fontFamily`. Use tokens.
2. No re-implementing a card header or KPI inline — use `Panel`, `PanelHeading`, `Stat`.
3. Layout-only inline styles are fine: grid spans, fixed chart pixel sizes.
4. Reach for a shadcn atom before building one. Add a molecule only when two screens repeat it.

## Reference

`apps/web/src/components/Shell.tsx` is the canonical example — header, nav tabs, and the
market strip (`MetricChip`) all built on tokens, zero inline color.
