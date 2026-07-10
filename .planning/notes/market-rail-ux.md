# Market Regime rail — density & hierarchy UX rework

The left MARKET REGIME rail was rejected twice: every value shouted equally (large,
bold, teal), color meant nothing, "as of" repeated on every tile, and card-per-datum
made the column tall. Below are the researched rules and what each maps to. This is a
scannable data column, not a wall of cards.

## Researched rules (cited)

1. **Hierarchy needs ONE emphasis per element — equal size+color = no focus.**
   NN/g, *Visual Hierarchy in UX*: hierarchy is built from "variations in color and
   contrast, scale, and grouping"; when elements are "all relatively equal in size and
   color" the layout "lacks a clear visual hierarchy." → within a row, only the value
   carries weight; the label is dim/small. Across tiers, gate > regime > rates.
   https://www.nngroup.com/articles/visual-hierarchy-ux-definition/

2. **Homogeneous data wants rows you scan down, not cards.**
   NN/g, *Data Tables: Four Major User Tasks*: users "visually scan down the table";
   right-aligned numeric columns, borders/zebra/hover aid row scanning. → 4 regime
   indicators and 6 rates become label-left / value-right compact rows with tabular
   (mono, tabular-nums) values in a shared column, not padded cards or pills.
   https://www.nngroup.com/articles/data-tables/

3. **Color is preattentive — spend it, don't spray it.**
   NN/g, *Dashboards: Making Charts and Graphs Easier to Understand*: color is a
   preattentive attribute perceived "without fully engaging attention," used to mark
   categories at a glance. If everything is teal, color signals nothing. → value color
   is the band signal ONLY when abnormal (calm = default text, warning = amber, crisis =
   red). Calm is quiet. https://www.nngroup.com/articles/dashboards-preattentive/

4. **Indicators mark what is SPECIAL / warrants attention — color-on-change, not always.**
   NN/g, *Indicators, Validations, and Notifications*: an indicator attracts attention
   to "something special that warrants" it; canonical example = a red down-arrow only
   when the move is substantial. → the loudest thing in the rail is GATE BLIND / crisis;
   an OPEN gate and calm bands stay muted.
   https://www.nngroup.com/articles/indicators-validations-notifications/

5. **Terminal convention (Bloomberg / thinkorswim watchlists):** dense uniform rows,
   fixed-width numeric columns, restrained palette, metadata deduplicated to a footer —
   not a caption per row. Density = trust; every extra glyph competes with the signal.

## What maps to what

- **Entry gate (top, the signal):** stays a bordered compact tile, two lines — label +
  state word colored by state (OPEN quiet green, PENALTY amber, BLOCKED red, GATE BLIND
  loudest filled `bg-downd`). VIX·ratio·as-of on the dim second line. Rule 1/4.
- **4 regime indicators:** compact rows, label left, value right (mono tabular). Band =
  value color only-when-abnormal; calm = `text-txt` (quiet), warning `text-amber`,
  crisis `text-down`. ⓘ provenance tooltip kept, visually quiet. No per-row as-of. Rule 1/2/3.
- **6 rates:** 2-col label/value grid, dimmer + smaller than regime values (backdrop
  tier, `text-muted-foreground`, not bold). Pills removed — they were the rejected look. Rule 1/2.
- **Freshness:** one footer line dedupes the 4 repeated regime "as of" captions —
  `EOD · as of {newest}` with any differing indicator noted inline. Rule 5.
- **COT + system health:** already compact rows in the same scale — left as-is.

## Invariants held

Data / hooks / banding logic / GATE BLIND independence (WR-02) / tooltip provenance /
a11y labels+roles unchanged. This is a styling + metadata-dedup rework, not a data change.
</content>
</invoke>
