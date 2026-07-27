/**
 * ChainBrowse — surface 1 of the chain: the TOS Trade tab shape.
 *
 * Row = one (root, expiration) cohort. Expand it and you get that cohort's ENTIRE strike ladder,
 * each strike a single leg with its own IV, vertical skew, greeks, market and open interest.
 *
 * This replaced a table whose rows were pre-paired calendars across two chosen expiries. That
 * shape was an inner join: a strike quoted in one expiry but not the other had no row at all —
 * no dash, no marker, just absent. Grouping instead of joining means every strike the chain
 * lists is reachable, which is the entire point of a data surface.
 *
 * There is deliberately NO score, verdict, rank or ranking sort. The table reports what the chain
 * says; the reader does the judging. Sorting by a data column is navigation, not measurement.
 *
 * Calendar math does NOT live here. Picking a front and a back leg is all this surface does about
 * pairing; the arithmetic is ChainPair's job.
 *
 * One tree for all viewports — no useIsDesktop split. Both tables sit in a horizontal-scroll
 * wrapper with a min-width, so a phone scrolls sideways through the same columns a desktop sees.
 * Columns are never dropped on small screens: this is a dense professional tool, and progressive
 * disclosure beats fewer numbers.
 */
import { useState } from "react";
import * as React from "react";
import { Button, DataTable, Tag } from "../system/index.tsx";
import type { DataTableColumn } from "../system/index.tsx";
import { legKey } from "../../hooks/useChainModel.ts";
import type { ChainCohort, ChainLegRow } from "../../hooks/useChainModel.ts";
import { Num, dec, int, pct, pts, shortYmd, strikeLabel } from "./chain-format.tsx";

// Shared mobile-friendly scroll recipe (Journal precedent).
const SCROLL_WRAPPER = "-mx-2 overflow-x-auto px-2";

type Sort = { readonly key: string; readonly dir: "asc" | "desc" };

/**
 * A column plus the raw number it sorts on — keeping the accessor next to the renderer means
 * sorting can never drift from what the cell displays.
 */
type SortableColumn<T> = DataTableColumn<T> & {
  readonly value: (row: T) => number | null;
};

/**
 * Columns that are an AXIS rather than a measurement. A chain ladder reads low strike to high,
 * and an expiry list reads soonest to furthest — so these open ASCENDING.
 *
 * `expiration` and `dte` are the same axis wearing two labels (the Expiry column sorts on dte),
 * and both belong here. Leaving them out is subtle: the table's initial state is ascending, so
 * they look right until you sort by something else and come back, at which point Expiry opens
 * with October on top.
 */
const AXIS_COLUMNS: ReadonlySet<string> = new Set(["strike", "expiration", "dte"]);

/**
 * Which direction a column opens on its FIRST click.
 *
 * Every non-axis column is a metric, and on a metric you want the biggest number on top: opening
 * ascending puts the thinnest theta and the smallest skew at the top, which reads as "the sort is
 * broken" even though it sorted exactly as asked. Clicking again toggles, so nothing is
 * unreachable.
 */
function firstDir(key: string): "asc" | "desc" {
  return AXIS_COLUMNS.has(key) ? "asc" : "desc";
}

/** Nulls sort last in BOTH directions — "no data" is never the best or worst row. */
function compare(a: number | null, b: number | null, dir: "asc" | "desc"): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

function sortRows<T>(
  rows: ReadonlyArray<T>,
  columns: ReadonlyArray<SortableColumn<T>>,
  sort: Sort,
): ReadonlyArray<T> {
  const active = columns.find((c) => c.key === sort.key);
  if (active === undefined) return rows;
  return [...rows].sort((a, b) => compare(active.value(a), active.value(b), sort.dir));
}

function nextSort(cur: Sort, key: string): Sort {
  return cur.key === key
    ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
    : { key, dir: firstDir(key) };
}

// ─── The strike ladder (one cohort, expanded) ─────────────────────────────────

/**
 * The pick cell. Two toggles per leg, and they must not bubble: the strike row sits inside a
 * table whose rows are clickable elsewhere in this app, and a pick that also collapsed the
 * cohort would be unusable.
 */
function PickCell({
  leg,
  isFront,
  isBack,
  onPickFront,
  onPickBack,
}: {
  readonly leg: ChainLegRow;
  readonly isFront: boolean;
  readonly isBack: boolean;
  readonly onPickFront: (leg: ChainLegRow) => void;
  readonly onPickBack: (leg: ChainLegRow) => void;
}): React.ReactElement {
  const key = legKey(leg);
  return (
    <span className="flex items-center justify-end gap-1">
      <Button
        variant="toggle"
        active={isFront}
        aria-pressed={isFront}
        data-testid={`pick-front-${key}`}
        title="Sell this leg as the calendar's front"
        onClick={(e) => {
          e.stopPropagation();
          onPickFront(leg);
        }}
      >
        Front
      </Button>
      <Button
        variant="toggle"
        active={isBack}
        aria-pressed={isBack}
        data-testid={`pick-back-${key}`}
        title="Buy this leg as the calendar's back"
        onClick={(e) => {
          e.stopPropagation();
          onPickBack(leg);
        }}
      >
        Back
      </Button>
    </span>
  );
}

function ladderColumns(
  frontKey: string | null,
  backKey: string | null,
  onPickFront: (leg: ChainLegRow) => void,
  onPickBack: (leg: ChainLegRow) => void,
): ReadonlyArray<SortableColumn<ChainLegRow>> {
  return [
    {
      key: "strike",
      header: "Strike",
      align: "left",
      sortable: true,
      value: (r) => r.strike,
      render: (r) => (
        <span className="text-fg-primary">
          {strikeLabel(r.strike)}
          <span className="ml-1 text-fg-tertiary">{r.contractType}</span>
        </span>
      ),
    },
    { key: "iv", header: "IV", sortable: true, value: (r) => r.iv, render: (r) => <Num v={r.iv} fmt={pct} /> },
    {
      key: "vSkew",
      header: "V-Skew",
      sortable: true,
      value: (r) => r.vSkew,
      render: (r) => <Num v={r.vSkew} fmt={pts} sign />,
    },
    {
      key: "delta",
      header: "Delta (Δ)",
      sortable: true,
      value: (r) => r.delta,
      render: (r) => <Num v={r.delta} fmt={(n) => dec(n, 3)} />,
    },
    {
      key: "gamma",
      header: "Gamma (Γ)",
      sortable: true,
      value: (r) => r.gamma,
      render: (r) => <Num v={r.gamma} fmt={(n) => dec(n, 4)} />,
    },
    {
      key: "theta",
      header: "Theta (Θ)",
      sortable: true,
      value: (r) => r.theta,
      render: (r) => <Num v={r.theta} fmt={(n) => dec(n, 2)} />,
    },
    {
      key: "vega",
      header: "Vega",
      sortable: true,
      value: (r) => r.vega,
      render: (r) => <Num v={r.vega} fmt={(n) => dec(n, 2)} />,
    },
    {
      key: "bid",
      header: "Bid",
      sortable: true,
      value: (r) => r.bid,
      render: (r) => <Num v={r.bid} fmt={(n) => dec(n, 2)} />,
    },
    {
      key: "ask",
      header: "Ask",
      sortable: true,
      value: (r) => r.ask,
      render: (r) => <Num v={r.ask} fmt={(n) => dec(n, 2)} />,
    },
    {
      key: "openInterest",
      header: "Open Int",
      sortable: true,
      value: (r) => r.openInterest,
      render: (r) => <Num v={r.openInterest} fmt={int} />,
    },
    {
      key: "pick",
      header: "Legs",
      value: () => null,
      render: (r) => {
        const key = legKey(r);
        return (
          <PickCell
            leg={r}
            isFront={key === frontKey}
            isBack={key === backKey}
            onPickFront={onPickFront}
            onPickBack={onPickBack}
          />
        );
      },
    },
  ];
}

function StrikeLadder({
  cohort,
  frontLeg,
  backLeg,
  onPickFront,
  onPickBack,
}: {
  readonly cohort: ChainCohort;
  readonly frontLeg: ChainLegRow | null;
  readonly backLeg: ChainLegRow | null;
  readonly onPickFront: (leg: ChainLegRow) => void;
  readonly onPickBack: (leg: ChainLegRow) => void;
}): React.ReactElement {
  const [sort, setSort] = useState<Sort>({ key: "strike", dir: "asc" });
  const columns = ladderColumns(
    frontLeg === null ? null : legKey(frontLeg),
    backLeg === null ? null : legKey(backLeg),
    onPickFront,
    onPickBack,
  );

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line-subtle/60 bg-surface-sunken/60 p-2">
      <DataTable
        columns={columns}
        rows={sortRows(cohort.strikes, columns, sort)}
        rowTestId={(r) => `chain-leg-${legKey(r)}`}
        // No onRowClick here — everything a strike has is already in its columns, and the two
        // pick buttons are the row's only verb. DataTable styles every row `cursor-pointer`, so
        // override it: a row that looks clickable and does nothing is worse than a plain one.
        rowClassName={() => "cursor-default"}
        sort={sort}
        onSortChange={(key) => {
          setSort((cur) => nextSort(cur, key));
        }}
        wrapperClassName={SCROLL_WRAPPER}
        wrapperTestId="chain-ladder-scroll"
        tableClassName="min-w-[980px]"
      />
      <div className="px-1 font-mono text-[9.5px] leading-[1.3] text-fg-tertiary">
        Every strike this expiry quotes, unfiltered · IV = this leg&apos;s own implied vol ·
        V-Skew = this strike&apos;s IV minus the ATM strike&apos;s IV, same expiry and same wing,
        in vol points — positive means you are paid extra vol to sell here, so{" "}
        <span className="text-fg-secondary">V-Skew is how you pick the STRIKE</span> · Δ Γ Θ vega
        are this ONE leg&apos;s greeks, not a spread&apos;s · Pick a Front and a Back leg to see
        the calendar math, where EDGE picks the expiry pair.
      </div>
    </div>
  );
}

// ─── The cohort list ──────────────────────────────────────────────────────────

const COHORT_COLS: ReadonlyArray<SortableColumn<ChainCohort>> = [
  {
    key: "expiration",
    header: "Expiry",
    align: "left",
    sortable: true,
    value: (c) => c.dte,
    render: (c) => (
      <span className="flex items-center gap-1.5">
        <span className="text-fg-primary">{shortYmd(c.expiration)}</span>
        {/* Root is data, not decoration: SPX is AM-settled, SPXW PM-settled, and both quote the
            same strikes on the same date. Two cohorts with the same expiry are not a duplicate. */}
        <Tag>{c.root}</Tag>
      </span>
    ),
  },
  { key: "dte", header: "DTE", sortable: true, value: (c) => c.dte, render: (c) => <Num v={c.dte} fmt={int} /> },
  {
    key: "strikeCount",
    header: "Strikes",
    sortable: true,
    value: (c) => c.strikes.length,
    render: (c) => <Num v={c.strikes.length} fmt={int} />,
  },
  {
    key: "atmIv",
    header: "ATM IV",
    sortable: true,
    value: (c) => c.atmIv,
    render: (c) => <Num v={c.atmIv} fmt={pct} />,
  },
  {
    key: "riskReversal",
    header: "25Δ RR",
    sortable: true,
    value: (c) => c.riskReversal,
    render: (c) => <Num v={c.riskReversal} fmt={pts} sign />,
  },
];

/** Cohort identity is root + expiration, never expiration alone. See legKey for why. */
function cohortKey(c: ChainCohort): string {
  return `${c.root}-${c.expiration}`;
}

export function ChainBrowse({
  cohorts,
  frontLeg,
  backLeg,
  onPickFront,
  onPickBack,
}: {
  readonly cohorts: ReadonlyArray<ChainCohort>;
  readonly frontLeg: ChainLegRow | null;
  readonly backLeg: ChainLegRow | null;
  readonly onPickFront: (leg: ChainLegRow) => void;
  readonly onPickBack: (leg: ChainLegRow) => void;
}): React.ReactElement {
  const [sort, setSort] = useState<Sort>({ key: "expiration", dir: "asc" });
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <DataTable
      columns={COHORT_COLS}
      rows={sortRows(cohorts, COHORT_COLS, sort)}
      rowTestId={(c) => `chain-cohort-${cohortKey(c)}`}
      onRowClick={(c) => {
        setExpanded((cur) => (cur === cohortKey(c) ? null : cohortKey(c)));
      }}
      renderRowDetail={(c) =>
        cohortKey(c) === expanded ? (
          <tr data-testid={`chain-strikes-${cohortKey(c)}`}>
            <td className="px-2 pb-2" colSpan={COHORT_COLS.length}>
              {/* `w-0 min-w-full` is load-bearing, not decoration. A table cell's content
                  contributes to the table's intrinsic width, so the ~1000px-wide strike ladder
                  nested in here dragged the whole cohort table out to 1030px the moment a row
                  expanded — the cohort rows visibly stretched, and on a phone the ladder had no
                  scroll of its own, forcing everything through one very wide outer scrollbar.
                  Zero width means "do not contribute an intrinsic width", min-w-full still fills
                  the row, and the ladder's own overflow-x wrapper then does the scrolling. */}
              <div className="w-0 min-w-full">
                <StrikeLadder
                  cohort={c}
                  frontLeg={frontLeg}
                  backLeg={backLeg}
                  onPickFront={onPickFront}
                  onPickBack={onPickBack}
                />
              </div>
            </td>
          </tr>
        ) : null
      }
      sort={sort}
      onSortChange={(key) => {
        setSort((cur) => nextSort(cur, key));
      }}
      wrapperClassName={SCROLL_WRAPPER}
      wrapperTestId="chain-cohorts-scroll"
      tableClassName="min-w-[560px]"
    />
  );
}
