import { DataTable, Panel, PanelHeading, type DataTableColumn } from "@morai/web";

/** A ranked calendar row — the shape the picker rail and the journal ledger both feed in. */
interface CalendarRow {
  readonly id: string;
  readonly name: string;
  readonly dte: number;
  readonly debit: number;
  readonly theta: number;
  readonly score: number;
  readonly verdict: "HOLD" | "TAKE" | "ROLL" | "STOP";
}

// Deliberately NOT in score order — so the SortedByScore cell visibly reorders.
const ROWS: ReadonlyArray<CalendarRow> = [
  { id: "c3", name: "7600C Jul 31 / Sep 05", dte: 12, debit: 5204.75, theta: 61.4, score: 48, verdict: "ROLL" },
  { id: "c5", name: "7700C Aug 08 / Aug 29", dte: 9, debit: 6140.0, theta: 74.1, score: 33, verdict: "STOP" },
  { id: "c1", name: "7500P Jul 23 / Aug 14", dte: 21, debit: 4627.55, theta: 45.9, score: 61, verdict: "HOLD" },
  { id: "c4", name: "7300P Sep 19 / Oct 17", dte: 57, debit: 2885.2, theta: 22.7, score: 41, verdict: "HOLD" },
  { id: "c2", name: "7400P Aug 15 / Sep 19", dte: 34, debit: 3910.0, theta: 38.2, score: 54, verdict: "TAKE" },
];

const VERDICT_CLASS: Record<CalendarRow["verdict"], string> = {
  HOLD: "text-muted-foreground",
  TAKE: "text-up",
  ROLL: "text-amber",
  STOP: "text-down",
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLUMNS: ReadonlyArray<DataTableColumn<CalendarRow>> = [
  { key: "name", header: "Calendar", align: "left", render: (r) => r.name },
  { key: "dte", header: "DTE", sortable: true, render: (r) => r.dte },
  { key: "debit", header: "Debit", mono: true, sortable: true, render: (r) => usd(r.debit) },
  { key: "theta", header: "θ / day", mono: true, sortable: true, render: (r) => `+${r.theta.toFixed(1)}` },
  { key: "score", header: "Score", mono: true, sortable: true, render: (r) => r.score },
  {
    key: "verdict",
    header: "Verdict",
    render: (r) => <span className={VERDICT_CLASS[r.verdict]}>{r.verdict}</span>,
  },
];

const WRAPPER = "overflow-x-auto";

/** The canonical use: columns + rows, caller-owned sort state, one testid per row. */
export function Default() {
  return (
    <DataTable
      columns={COLUMNS}
      rows={ROWS}
      rowTestId={(r) => `row-${r.id}`}
      wrapperClassName={WRAPPER}
    />
  );
}

/** `sort` is rendered as aria-sort + the header glyph — DataTable never sorts the rows itself. */
export function SortedByScore() {
  const sorted = [...ROWS].sort((a, b) => b.score - a.score);
  return (
    <DataTable
      columns={COLUMNS}
      rows={sorted}
      rowTestId={(r) => `row-${r.id}`}
      sort={{ key: "score", dir: "desc" }}
      onSortChange={() => {}}
      wrapperClassName={WRAPPER}
    />
  );
}

/** `rowClassName` marks the selected row; `footer` carries the roll-up totals. */
export function SelectedRowAndFooter() {
  const totalDebit = ROWS.reduce((s, r) => s + r.debit, 0);
  const totalTheta = ROWS.reduce((s, r) => s + r.theta, 0);
  return (
    <DataTable
      columns={COLUMNS}
      rows={ROWS}
      rowTestId={(r) => `row-${r.id}`}
      rowClassName={(r) => (r.id === "c2" ? "border-l-2 border-l-violet bg-violet/[0.06]" : "")}
      wrapperClassName={WRAPPER}
      footer={
        <tr className="border-t border-line2">
          <td className="px-2 py-1.5 text-left text-dim">5 calendars</td>
          <td className="px-2 py-1.5" />
          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-txt">{usd(totalDebit)}</td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-up">+{totalTheta.toFixed(1)}</td>
          <td className="px-2 py-1.5" />
          <td className="px-2 py-1.5" />
        </tr>
      }
    />
  );
}

/** `renderRowDetail` expands a second <tr> under its row — the journal's daily-greeks drawer. */
export function ExpandedRowDetail() {
  return (
    <DataTable
      columns={COLUMNS}
      rows={ROWS.slice(0, 3)}
      rowTestId={(r) => `row-${r.id}`}
      wrapperClassName={WRAPPER}
      renderRowDetail={(r) =>
        r.id === "c1" ? (
          <div className="flex gap-6 px-2 py-2 font-mono text-[10px] text-muted-foreground">
            <span>front 7500P · 21d · IV 12.49%</span>
            <span>back 7500P · 43d · IV 14.02%</span>
            <span className="text-violet">fwd edge −2.85v</span>
          </div>
        ) : null
      }
    />
  );
}

/** In situ: the table is always mounted inside a Panel with a PanelHeading above it. */
export function InsidePanel() {
  return (
    <Panel style={{ maxWidth: 760 }}>
      <PanelHeading title="Suggested calendars" badge={<span className="text-[10px] text-dim">as of 14:32</span>} />
      <DataTable
        columns={COLUMNS}
        rows={ROWS.slice(0, 4)}
        rowTestId={(r) => `row-${r.id}`}
        sort={{ key: "score", dir: "desc" }}
        onSortChange={() => {}}
        wrapperClassName={WRAPPER}
      />
    </Panel>
  );
}
