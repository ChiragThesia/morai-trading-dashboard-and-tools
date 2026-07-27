/**
 * ChainTable — the Analyzer's chain data table.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTEGRATION STUB (Unit 11 ← Unit 08). Unit 08 owns this path. It does not
 * exist in this worktree, so the DataTable-based expandable table is built here
 * against the ChainCalendarRow shape chain-math produces. Take Unit 08's file
 * wholesale on merge; Analyzer.tsx uses `ChainTable`, `DEFAULT_CHAIN_SORT`,
 * `cycleSort` and `sortChainRows` and nothing else.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * One row per strike, front+back joined. Click a row and its two legs open in
 * place — the Journal trade-ledger idiom. Sort state is CALLER-owned, matching
 * the DataTable primitive.
 *
 * One tree for all viewports (Journal.tsx precedent): the table sits in a
 * horizontal-scroll wrapper with a min-width. No column is ever dropped on a
 * small screen — this is a dense professional tool, so mobile gets progressive
 * disclosure, never fewer numbers.
 *
 * Nothing here ranks, scores, or recommends. It reports.
 *
 * No any/as/!.
 */
import { DataTable } from "../system/index.tsx";
import type { DataTableColumn } from "../system/index.tsx";
import type { CalendarLeg, ChainCalendarRow, Greeks } from "../../lib/chain-math.ts";

const DASH = "—";

export type ChainSortKey = "strike" | "hSkew" | "edge" | "debit" | "netTheta" | "netVega";
export interface ChainSortState {
  readonly key: ChainSortKey;
  readonly dir: "asc" | "desc";
}

/** Strike order is how an option chain is read — that is the default. */
export const DEFAULT_CHAIN_SORT: ChainSortState = { key: "strike", dir: "asc" };

export function cycleSort(current: ChainSortState, clicked: ChainSortKey): ChainSortState {
  if (current.key !== clicked) return { key: clicked, dir: "desc" };
  return { key: clicked, dir: current.dir === "desc" ? "asc" : "desc" };
}

/** Narrows DataTable's generic string key — DataTable knows nothing of this domain. */
function isChainSortKey(key: string): key is ChainSortKey {
  return (
    key === "strike" ||
    key === "hSkew" ||
    key === "edge" ||
    key === "debit" ||
    key === "netTheta" ||
    key === "netVega"
  );
}

function sortValue(row: ChainCalendarRow, key: ChainSortKey): number | null {
  switch (key) {
    case "strike":
      return row.strike;
    case "hSkew":
      return row.hSkew;
    case "edge":
      return row.edge;
    case "debit":
      return row.debit;
    case "netTheta":
      return row.net?.theta ?? null;
    case "netVega":
      return row.net?.vega ?? null;
  }
}

/** Sorts a COPY. Unknown values sink to the bottom in BOTH directions. */
export function sortChainRows(
  rows: ReadonlyArray<ChainCalendarRow>,
  sort: ChainSortState,
): ReadonlyArray<ChainCalendarRow> {
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sort.dir === "asc" ? av - bv : bv - av;
  });
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** 0.1249 → "12.49%" */
function pct(v: number | null): string {
  return v === null ? DASH : `${(v * 100).toFixed(2)}%`;
}

/** 0.02 → "+2.00" (vol points, always signed). */
function volPts(v: number | null): string {
  return v === null ? DASH : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}`;
}

function num(v: number | null, dp: number): string {
  return v === null ? DASH : v.toFixed(dp);
}

function signed(v: number | null, dp: number): string {
  return v === null ? DASH : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;
}

/** Signed values get the semantic value colour; a missing one stays quiet. */
function signClassOf(v: number | null): string {
  if (v === null) return "text-fg-tertiary";
  return v >= 0 ? "text-value-positive" : "text-value-negative";
}

function Cell({
  testId,
  value,
  className,
}: {
  readonly testId: string;
  readonly value: string;
  readonly className?: string;
}): React.ReactElement {
  return (
    <span data-testid={testId} className={className ?? "text-fg-primary"}>
      {value}
    </span>
  );
}

function netOf(net: Greeks | null, pick: (g: Greeks) => number): number | null {
  return net === null ? null : pick(net);
}

// ─── Columns ──────────────────────────────────────────────────────────────────

const COLUMNS: ReadonlyArray<DataTableColumn<ChainCalendarRow>> = [
  {
    key: "strike",
    header: "Strike",
    align: "left",
    sortable: true,
    headerTestId: "chain-sort-strike",
    render: (r) => <Cell testId="chain-strike" value={r.strike.toFixed(0)} className="font-semibold text-fg-primary" />,
  },
  {
    key: "frontIv",
    header: "Front IV",
    render: (r) => <Cell testId="chain-front-iv" value={pct(r.front.iv)} className={r.front.iv === null ? "text-fg-tertiary" : "text-fg-primary"} />,
  },
  {
    key: "backIv",
    header: "Back IV",
    render: (r) => <Cell testId="chain-back-iv" value={pct(r.back.iv)} className={r.back.iv === null ? "text-fg-tertiary" : "text-fg-primary"} />,
  },
  {
    key: "hSkew",
    header: "H-Skew (back−front)",
    sortable: true,
    headerTestId: "chain-sort-hSkew",
    render: (r) => <Cell testId="chain-hskew" value={volPts(r.hSkew)} className={signClassOf(r.hSkew)} />,
  },
  {
    key: "edge",
    header: "Edge (front−fwd)",
    sortable: true,
    headerTestId: "chain-sort-edge",
    render: (r) => <Cell testId="chain-edge" value={volPts(r.edge)} className={signClassOf(r.edge)} />,
  },
  {
    key: "frontVSkew",
    header: "V-Skew front",
    render: (r) => <Cell testId="chain-front-vskew" value={volPts(r.frontVSkew)} className={signClassOf(r.frontVSkew)} />,
  },
  {
    key: "backVSkew",
    header: "V-Skew back",
    render: (r) => <Cell testId="chain-back-vskew" value={volPts(r.backVSkew)} className={signClassOf(r.backVSkew)} />,
  },
  {
    key: "debit",
    header: "Debit",
    sortable: true,
    headerTestId: "chain-sort-debit",
    render: (r) => <Cell testId="chain-debit" value={num(r.debit, 2)} />,
  },
  {
    key: "netDelta",
    header: "Net Δ",
    render: (r) => {
      const v = netOf(r.net, (g) => g.delta);
      return <Cell testId="chain-net-delta" value={signed(v, 3)} className={signClassOf(v)} />;
    },
  },
  {
    key: "netGamma",
    header: "Net Γ",
    render: (r) => {
      const v = netOf(r.net, (g) => g.gamma);
      return <Cell testId="chain-net-gamma" value={v === null ? DASH : v.toExponential(2)} className={signClassOf(v)} />;
    },
  },
  {
    key: "netTheta",
    header: "Net Θ /day",
    sortable: true,
    headerTestId: "chain-sort-netTheta",
    render: (r) => {
      const v = netOf(r.net, (g) => g.theta);
      return <Cell testId="chain-net-theta" value={signed(v, 3)} className={signClassOf(v)} />;
    },
  },
  {
    key: "netVega",
    header: "Net Vega",
    sortable: true,
    headerTestId: "chain-sort-netVega",
    render: (r) => {
      const v = netOf(r.net, (g) => g.vega);
      return <Cell testId="chain-net-vega" value={signed(v, 3)} className={signClassOf(v)} />;
    },
  },
  {
    key: "oiFront",
    header: "OI front",
    render: (r) => <Cell testId="chain-oi-front" value={r.front.openInterest.toString()} className="text-fg-secondary" />,
  },
  {
    key: "oiBack",
    header: "OI back",
    render: (r) => <Cell testId="chain-oi-back" value={r.back.openInterest.toString()} className="text-fg-secondary" />,
  },
];

// ─── Per-leg detail ───────────────────────────────────────────────────────────

function LegBlock({ label, leg, testId }: { readonly label: string; readonly leg: CalendarLeg; readonly testId: string }): React.ReactElement {
  const g = leg.greeks;
  const fields: ReadonlyArray<readonly [string, string, string]> = [
    ["Expiry", leg.expiration, "text-fg-primary"],
    ["DTE", leg.dte.toString(), "text-fg-primary"],
    ["Bid", leg.bid.toFixed(2), "text-fg-primary"],
    ["Ask", leg.ask.toFixed(2), "text-fg-primary"],
    ["Mid", leg.mid.toFixed(2), "text-fg-primary"],
    ["IV", pct(leg.iv), leg.iv === null ? "text-fg-tertiary" : "text-fg-primary"],
    ["V-Skew", volPts(leg.vSkew), signClassOf(leg.vSkew)],
    ["Δ", signed(g === null ? null : g.delta, 4), signClassOf(g === null ? null : g.delta)],
    ["Γ", g === null ? DASH : g.gamma.toExponential(2), signClassOf(g === null ? null : g.gamma)],
    ["Θ /day", signed(g === null ? null : g.theta, 4), signClassOf(g === null ? null : g.theta)],
    ["Vega", signed(g === null ? null : g.vega, 4), signClassOf(g === null ? null : g.vega)],
    ["OI", leg.openInterest.toString(), "text-fg-primary"],
    ["Source", leg.source, "text-fg-tertiary"],
    ["Observed", leg.observedAt, "text-fg-tertiary"],
  ];
  return (
    <div data-testid={testId} className="min-w-0 flex-1">
      <div className="mb-1 font-display text-[10px] font-semibold tracking-[0.09em] text-fg-tertiary uppercase">
        {label}
      </div>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-3 gap-y-1 font-mono text-[10.5px] tabular-nums">
        {fields.map(([name, value, cls]) => (
          <div key={name} className="flex items-baseline justify-between gap-1.5">
            <dt className="text-fg-tertiary">{name}</dt>
            <dd className={cls}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const LEGEND =
  "IV and skews are decimals shown in vol points (+2.00 = 2 vol pts). H-Skew = back IV − front IV. " +
  "Edge = front IV − the forward IV implied between the two expiries. V-Skew = this strike's IV − " +
  "that expiry's ATM IV. Net greeks are long back, short front, per 1 contract. Θ is per calendar " +
  "day, vega per vol point. An em dash means the value could not be computed — never 0.";

// ─── Component ────────────────────────────────────────────────────────────────

export interface ChainTableProps {
  readonly rows: ReadonlyArray<ChainCalendarRow>;
  /** Display strike (÷1000) of the expanded row, or null when none is open. */
  readonly expandedStrike: number | null;
  readonly onToggleExpand: (row: ChainCalendarRow) => void;
  readonly sort: ChainSortState;
  readonly onSortChange: (key: ChainSortKey) => void;
}

export function ChainTable({
  rows,
  expandedStrike,
  onToggleExpand,
  sort,
  onSortChange,
}: ChainTableProps): React.ReactElement {
  if (rows.length === 0) {
    return (
      <p data-testid="chain-empty" className="m-0 p-3 font-mono text-[11px] text-fg-tertiary">
        No strike is quoted in both of the selected expiries.
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowTestId={(r) => `chain-row-${r.strike}`}
        rowClassName={(r) => (r.strike === expandedStrike ? "bg-line-subtle/40" : "")}
        onRowClick={onToggleExpand}
        sort={sort}
        onSortChange={(key) => {
          if (isChainSortKey(key)) onSortChange(key);
        }}
        renderRowDetail={(r) =>
          r.strike === expandedStrike ? (
            <tr data-testid={`chain-detail-${r.strike}`}>
              <td className="px-2 pb-2" colSpan={COLUMNS.length}>
                <div className="flex flex-col gap-3 rounded-md border border-line-subtle/60 bg-surface-sunken/60 p-3 sm:flex-row">
                  <LegBlock label="Front leg (short)" leg={r.front} testId="chain-leg-front" />
                  <LegBlock label="Back leg (long)" leg={r.back} testId="chain-leg-back" />
                </div>
              </td>
            </tr>
          ) : null
        }
        wrapperClassName="-mx-2 overflow-x-auto px-2"
        wrapperTestId="chain-table-scroll"
        tableClassName="min-w-[1180px]"
      />
      <p className="m-0 px-1 font-mono text-[9.5px] leading-[1.35] text-fg-tertiary">{LEGEND}</p>
    </div>
  );
}
