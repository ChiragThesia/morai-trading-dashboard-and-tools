/**
 * ChainTable — the calendar chain as a DATA SURFACE. One row per strike per wing, for
 * an already-picked front/back expiry pair (the selectors are the caller's job).
 *
 * There is deliberately NO score, verdict, rank or ranking sort here. The table
 * reports what the chain says; the reader does the judging. Sorting by any data
 * column is fine — that is navigation, not measurement.
 *
 * Structure copied from the Trade Ledger (screens/Journal.tsx): the shared
 * DataTable primitive owns the sticky header and one <tr> per row, this file owns
 * the sort + expansion state, and clicking a row expands both legs in place.
 *
 * One tree for all viewports — no useIsDesktop split. The table sits in a
 * horizontal-scroll wrapper with a min-width, so a phone scrolls sideways through
 * the same 13 columns a desktop sees. Columns are never dropped on small screens:
 * this is a dense professional tool, progressive disclosure beats fewer numbers.
 *
 * Every derived field is `number | null`. Null renders as an em dash in
 * text-fg-tertiary — never 0, never a fabricated number.
 */

import { useState } from "react";
import * as React from "react";
import { DataTable, SectionLabel, Stat, Tag } from "../system/index.tsx";
import type { DataTableColumn } from "../system/index.tsx";
import { signClass } from "../../lib/position-format.ts";

// ─── Row shape (mirrors what lib/chain-math.ts computes) ──────────────────────

export interface ChainTableLeg {
  readonly expiry: string;
  readonly dte: number;
  readonly iv: number | null;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly openInterest: number | null;
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
}

export interface ChainTableRow {
  /** Strike ×1000, the integer the rest of the system stores. Divided down to display. */
  readonly strike: number;
  /**
   * Which wing this calendar is. The chain read returns calls AND puts, so strike alone
   * is NOT an identity — keying on it collides the two wings into one row. Because the
   * wing lives on the row, a mixed-wing pair (put front against call back) is not
   * expressible here at all; the caller owns pairing each leg to its own wing.
   */
  readonly contractType: "C" | "P";
  readonly deltaFront: number | null;
  readonly ivFront: number | null;
  readonly ivBack: number | null;
  /** Horizontal (calendar) skew: back IV − front IV, decimal vol. */
  readonly hSkew: number | null;
  readonly fwdIv: number | null;
  readonly edge: number | null;
  /**
   * Vertical skew across strikes, decimal vol.
   *
   * Fill this with `vSkewVsAtm(bsmIv, atmIv(rows, spot, expiration, contractType))` —
   * do NOT hand-roll the ATM lookup. The reference IV must come from the same expiry
   * AND the same wing, because calls and puts trace different skew curves, and
   * `atmIv` takes both as arguments so a wrong-curve call is not expressible.
   *
   * Worth knowing why that helper exists rather than a doc comment: a cross-wing ATM
   * is the one bad input in chain-math that cannot null itself. Every other degraded
   * value nulls its own column and shows up here as a visible gap; this one returns a
   * clean, plausible, wrong number that nothing downstream can distinguish.
   *
   * When the ATM strike's own IV never solved, `atmIv` returns null rather than
   * falling back to the nearest strike that did — so this column dashes instead of
   * silently re-basing one row against a different reference than its neighbours.
   */
  readonly vSkew: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
  readonly netDelta: number | null;
  /** Net calendar gamma — you are short the front gamma, and that is the risk that
   *  bites when spot runs at the short strike. Earns its own column, not a footnote. */
  readonly netGamma: number | null;
  readonly debit: number | null;
  readonly front: ChainTableLeg;
  readonly back: ChainTableLeg;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const DASH = "—";
const INT = new Intl.NumberFormat("en-US");

/**
 * Take the sign from the ROUNDED value, not the raw one. Deriving it from the raw
 * value prints "−0.00" for -0.0001 — a minus sign on a displayed zero, which reads
 * as "slightly negative" while showing nothing, the same zero-vs-no-data ambiguity
 * the em-dash rule exists to kill. Rounding first also folds -0 into +0.
 */
function round(v: number, dp: number): number {
  return Number(v.toFixed(dp));
}

/** Minus sign is U+2212 throughout the app (see lib/position-format.ts). */
function dec(v: number, dp: number): string {
  const r = round(v, dp);
  return r < 0 ? `−${Math.abs(r).toFixed(dp)}` : r.toFixed(dp);
}

function signedDec(v: number, dp: number): string {
  const r = round(v, dp);
  return `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(dp)}`;
}

/** Decimal vol → percent: 0.1452 → "14.52%". Via dec() for the U+2212 minus. */
function pct(v: number): string {
  return `${dec(v * 100, 2)}%`;
}

/** Decimal vol difference → signed vol points: -0.0061 → "−0.61". */
function pts(v: number): string {
  return signedDec(v * 100, 2);
}

function int(v: number): string {
  return INT.format(v);
}

/** "2026-08-11" → "Aug 11". Expiries are calendar dates, so read them in UTC. */
function shortYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * One numeric cell. Null is the whole point of this component: it renders the em
 * dash in tertiary, never a zero. `sign` colours by sign — signed numbers only,
 * per the design system (an accent colour must never stand in for a sign).
 */
function Num({
  v,
  fmt,
  sign = false,
}: {
  v: number | null;
  fmt: (n: number) => string;
  sign?: boolean;
}): React.ReactElement {
  if (v === null) return <span className="text-fg-tertiary">{DASH}</span>;
  return <span className={sign ? signClass(v) : undefined}>{fmt(v)}</span>;
}

// ─── Columns ──────────────────────────────────────────────────────────────────

/**
 * A column plus the raw number it sorts on — keeping the accessor next to the
 * renderer means sorting can never drift from what the cell displays.
 */
type ChainColumn = DataTableColumn<ChainTableRow> & {
  readonly value: (row: ChainTableRow) => number | null;
};

const COLS: ReadonlyArray<ChainColumn> = [
  {
    key: "strike",
    header: "Strike",
    align: "left",
    sortable: true,
    value: (r) => r.strike,
    render: (r) => (
      <span className="text-fg-primary">
        {r.strike / 1000}
        <span className="ml-1 text-fg-tertiary">{r.contractType}</span>
      </span>
    ),
  },
  {
    key: "deltaFront",
    header: "Front Delta (Δ)",
    sortable: true,
    value: (r) => r.deltaFront,
    render: (r) => <Num v={r.deltaFront} fmt={(n) => dec(n, 3)} />,
  },
  {
    key: "ivFront",
    header: "Front IV",
    sortable: true,
    value: (r) => r.ivFront,
    render: (r) => <Num v={r.ivFront} fmt={pct} />,
  },
  {
    key: "ivBack",
    header: "Back IV",
    sortable: true,
    value: (r) => r.ivBack,
    render: (r) => <Num v={r.ivBack} fmt={pct} />,
  },
  {
    key: "hSkew",
    header: "H-Skew",
    sortable: true,
    value: (r) => r.hSkew,
    render: (r) => <Num v={r.hSkew} fmt={pts} sign />,
  },
  {
    key: "fwdIv",
    header: "Fwd IV",
    sortable: true,
    value: (r) => r.fwdIv,
    render: (r) => <Num v={r.fwdIv} fmt={pct} />,
  },
  {
    key: "edge",
    header: "Edge",
    sortable: true,
    value: (r) => r.edge,
    render: (r) => <Num v={r.edge} fmt={pts} sign />,
  },
  {
    key: "vSkew",
    header: "V-Skew",
    sortable: true,
    value: (r) => r.vSkew,
    render: (r) => <Num v={r.vSkew} fmt={pts} sign />,
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
    key: "netDelta",
    header: "Net Delta (Δ)",
    sortable: true,
    value: (r) => r.netDelta,
    render: (r) => <Num v={r.netDelta} fmt={(n) => signedDec(n, 3)} sign />,
  },
  {
    key: "netGamma",
    header: "Net Gamma (Γ)",
    sortable: true,
    value: (r) => r.netGamma,
    render: (r) => <Num v={r.netGamma} fmt={(n) => dec(n, 4)} sign />,
  },
  {
    key: "debit",
    header: "Debit",
    sortable: true,
    value: (r) => r.debit,
    render: (r) => <Num v={r.debit} fmt={(n) => dec(n, 2)} />,
  },
];

// ─── Expansion: the two legs, side by side ────────────────────────────────────

function LegPanel({
  label,
  strike,
  wing,
  leg,
}: {
  label: string;
  strike: number;
  wing: "C" | "P";
  leg: ChainTableLeg;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line-subtle/60 bg-surface-raised/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel tone="dim">{label}</SectionLabel>
        <Tag>{shortYmd(leg.expiry)}</Tag>
        <span className="font-mono text-[10px] text-fg-tertiary">{leg.dte} DTE</span>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 font-mono text-[11px]">
        <Stat label="Strike" value={`${strike / 1000} ${wing}`} />
        <Stat label="IV" value={<Num v={leg.iv} fmt={pct} />} />
        <Stat label="Open Int" value={<Num v={leg.openInterest} fmt={int} />} />
        <Stat label="Bid" value={<Num v={leg.bid} fmt={(n) => dec(n, 2)} />} />
        <Stat label="Ask" value={<Num v={leg.ask} fmt={(n) => dec(n, 2)} />} />
        <Stat label="Delta (Δ)" value={<Num v={leg.delta} fmt={(n) => dec(n, 3)} />} />
        <Stat label="Gamma (Γ)" value={<Num v={leg.gamma} fmt={(n) => dec(n, 4)} />} />
        <Stat label="Theta (Θ)" value={<Num v={leg.theta} fmt={(n) => dec(n, 2)} />} />
        <Stat label="Vega" value={<Num v={leg.vega} fmt={(n) => dec(n, 2)} />} />
      </div>
    </div>
  );
}

function ChainDetailPanel({ row }: { row: ChainTableRow }): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line-subtle/60 bg-surface-sunken/60 p-3">
      {/* Legs stack on a phone and sit side by side from sm up — same tree, no columns dropped. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <LegPanel
          label="Front Leg"
          strike={row.strike}
          wing={row.contractType}
          leg={row.front}
        />
        <LegPanel
          label="Back Leg"
          strike={row.strike}
          wing={row.contractType}
          leg={row.back}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md border border-line-subtle/60 bg-surface-raised/40 p-2 font-mono text-[11px] sm:grid-cols-5">
        <Stat
          label="Net Delta (Δ)"
          value={<Num v={row.netDelta} fmt={(n) => signedDec(n, 3)} sign />}
        />
        <Stat
          label="Net Gamma (Γ)"
          value={<Num v={row.netGamma} fmt={(n) => dec(n, 4)} sign />}
        />
        <Stat label="Net Theta (Θ)" value={<Num v={row.theta} fmt={(n) => dec(n, 2)} />} />
        <Stat label="Net Vega" value={<Num v={row.vega} fmt={(n) => dec(n, 2)} />} />
        <Stat label="Net Debit" value={<Num v={row.debit} fmt={(n) => dec(n, 2)} />} />
      </div>
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

// Shared mobile-friendly scroll recipe (Journal / AnalyzerMobile precedent).
const SCROLL_WRAPPER = "-mx-2 overflow-x-auto px-2";

type Sort = { readonly key: string; readonly dir: "asc" | "desc" };

/**
 * Row identity is wing + strike, never strike alone. The chain read returns calls AND
 * puts: keyed on strike, the two wings collide into one React key and one expansion
 * slot, so opening the put would open the call.
 */
function rowKey(r: ChainTableRow): string {
  return `${r.contractType}-${r.strike}`;
}

/** Nulls sort last in BOTH directions — "no data" is never the best or worst row. */
function compare(a: number | null, b: number | null, dir: "asc" | "desc"): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

export function ChainTable({
  rows,
}: {
  readonly rows: ReadonlyArray<ChainTableRow>;
}): React.ReactElement {
  const [sort, setSort] = useState<Sort>({ key: "strike", dir: "asc" });
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const activeCol = COLS.find((c) => c.key === sort.key);
  const sorted =
    activeCol === undefined
      ? [...rows]
      : [...rows].sort((a, b) => compare(activeCol.value(a), activeCol.value(b), sort.dir));

  return (
    <div className="flex flex-col gap-1.5">
      {/* ponytail: no sticky strike column — that needs a per-cell class on the shared
          DataTable primitive. Add it there if sideways scrolling loses people. */}
      <DataTable
        columns={COLS}
        rows={sorted}
        rowTestId={(r) => `chain-row-${rowKey(r)}`}
        onRowClick={(r) => {
          setExpandedKey((cur) => (cur === rowKey(r) ? null : rowKey(r)));
        }}
        renderRowDetail={(r) =>
          rowKey(r) === expandedKey ? (
            <tr data-testid={`chain-detail-${rowKey(r)}`}>
              <td className="px-2 pb-2" colSpan={COLS.length}>
                <ChainDetailPanel row={r} />
              </td>
            </tr>
          ) : null
        }
        sort={sort}
        onSortChange={(key) => {
          setSort((cur) =>
            cur.key === key
              ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
              : { key, dir: "asc" },
          );
        }}
        wrapperClassName={SCROLL_WRAPPER}
        wrapperTestId="chain-table-scroll"
        tableClassName="min-w-[1140px]"
      />
      <div className="px-1 font-mono text-[9.5px] leading-[1.3] text-fg-tertiary">
        H-Skew = back IV − front IV, in vol points · V-Skew = IV change across strikes,
        in vol points · Fwd IV = the vol implied between the two expiries · Edge = forward
        IV − front IV, in vol points · Θ theta = $ per day · Vega = $ per 1-pt vol move ·
        Γ gamma = how fast delta changes per point, negative = short gamma at the front
        strike · Debit = front credit netted against back cost. Click a strike for both legs.
      </div>
    </div>
  );
}
