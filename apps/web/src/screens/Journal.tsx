/**
 * Journal — the Trade Ledger: two plain tables, nothing else.
 *
 * Replaces the lifecycle-chart Journal (user decision 2026-07-23: "simple table").
 * The lifecycle/attribution backend (calendar_snapshots, /lifecycle route, MCP tools)
 * is untouched — only the web chrome died.
 *
 *   1. Round-trips — one row per calendar (open first via newest-openedAt server order):
 *      trade, status, opened/closed, entry debit, realized P&L (from calendar_events,
 *      the fill ledger — the number TOS never shows per strategy), and for open
 *      calendars the latest stored greeks/IV (30-min RTH snapshots). Footer = total P&L.
 *   2. Executions — TOS Account-Statement-style raw fills from broker_transactions:
 *      exec time (ET), side, qty, effect, symbol, exp, strike, type, price, net amount,
 *      order id.
 *
 * One tree for all viewports: both tables sit in horizontal-scroll wrappers with a
 * min-width table (the AnalyzerMobile recipe) — no useIsDesktop split needed.
 */

import { Panel, PanelHeading, DataTable, Button } from "../components/system/index.tsx";
import type { DataTableColumn } from "../components/system/index.tsx";
import { useTradeHistory } from "../hooks/useTradeHistory.ts";
import { signedUsd, signClass } from "../lib/position-format.ts";
import type {
  TradeHistoryRoundTripResponse,
  TradeHistoryExecutionResponse,
} from "@morai/contracts";

// ─── Formatting helpers ───────────────────────────────────────────────────────

const DASH = "—";

/** "2026-07-23T19:50:00.000Z" → "Jul 23" (UTC date part — trade dates, not instants). */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "2026-08-11" → "Aug 11" */
function shortYmd(ymd: string): string {
  return shortDate(`${ymd}T00:00:00Z`);
}

// Exec instants render in ET explicitly (TOS shows ET) — never sliced ISO strings.
const ET_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

function etTime(iso: string | null): string {
  if (iso === null) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return ET_TIME.format(d);
}

/** 0.145 → "14.5%" */
function pct(v: number | null): string {
  return v === null ? DASH : `${(v * 100).toFixed(1)}%`;
}

function money(v: number | null): string {
  return v === null ? DASH : signedUsd(v);
}

function moneyClass(v: number | null): string {
  return v === null ? "text-dim" : signClass(v);
}

function tradeName(r: TradeHistoryRoundTripResponse): string {
  return `${r.underlying} ${r.strike / 1000}${r.optionType}`;
}

const NUM = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Round-trips table ────────────────────────────────────────────────────────

const ROUNDTRIP_COLS: ReadonlyArray<DataTableColumn<TradeHistoryRoundTripResponse>> = [
  {
    key: "trade",
    header: "Trade",
    align: "left",
    render: (r) => (
      <span className="text-txt">
        {tradeName(r)}{" "}
        <span className="text-dim">
          {shortYmd(r.frontExpiry)}/{shortYmd(r.backExpiry)}
        </span>
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    align: "left",
    render: (r) => (
      <span className={r.status === "open" ? "text-cyan" : "text-dim"}>{r.status}</span>
    ),
  },
  { key: "opened", header: "Opened", render: (r) => shortDate(r.openedAt) },
  {
    key: "closed",
    header: "Closed",
    render: (r) => (r.closedAt !== null ? shortDate(r.closedAt) : DASH),
  },
  { key: "debit", header: "Debit", render: (r) => r.openNetDebit.toFixed(2) },
  {
    key: "pnl",
    header: "P&L",
    render: (r) => (
      <span className={`font-semibold ${moneyClass(r.realizedPnl)}`}>
        {money(r.realizedPnl)}
      </span>
    ),
  },
  {
    key: "delta",
    header: "Δ",
    render: (r) =>
      r.greeks !== null && r.greeks.netDelta !== null
        ? r.greeks.netDelta.toFixed(1)
        : DASH,
  },
  {
    key: "theta",
    header: "Θ/d",
    render: (r) => money(r.greeks?.netTheta ?? null),
  },
  {
    key: "vega",
    header: "Vega",
    render: (r) => money(r.greeks?.netVega ?? null),
  },
  {
    key: "iv",
    header: "IV f/b",
    render: (r) =>
      r.greeks !== null ? `${pct(r.greeks.frontIv)}/${pct(r.greeks.backIv)}` : DASH,
  },
  {
    key: "slope",
    header: "Slope",
    render: (r) =>
      r.greeks !== null && r.greeks.termSlope !== null
        ? (r.greeks.termSlope * 100).toFixed(2)
        : DASH,
  },
];

// ─── Executions table ─────────────────────────────────────────────────────────

// Row key = activityId + position index: two legs of one activity stay distinct.
type ExecRow = TradeHistoryExecutionResponse & { readonly rowKey: string };

const EXECUTION_COLS: ReadonlyArray<DataTableColumn<ExecRow>> = [
  { key: "time", header: "Exec Time (ET)", align: "left", render: (e) => etTime(e.execTime) },
  {
    key: "side",
    header: "Side",
    align: "left",
    render: (e) => (
      <span className={e.side === "buy" ? "text-up" : "text-down"}>
        {e.side === "buy" ? "BUY" : "SELL"}
      </span>
    ),
  },
  { key: "qty", header: "Qty", render: (e) => e.qty },
  { key: "effect", header: "Effect", align: "left", render: (e) => e.positionEffect },
  { key: "symbol", header: "Symbol", align: "left", render: (e) => e.occSymbol.split(" ")[0] },
  { key: "exp", header: "Exp", render: (e) => shortYmd(e.expiry) },
  { key: "strike", header: "Strike", render: (e) => e.strike },
  { key: "type", header: "Type", render: (e) => e.type },
  { key: "price", header: "Price", render: (e) => e.price.toFixed(2) },
  {
    key: "net",
    header: "Net Amt",
    render: (e) => (
      <span className={signClass(e.netAmount)}>{NUM.format(e.netAmount)}</span>
    ),
  },
  { key: "order", header: "Order #", render: (e) => e.orderId ?? DASH },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

// Shared mobile-friendly scroll recipe (AnalyzerMobile precedent): the wrapper h-scrolls,
// the table keeps a min-width so columns never crush on a phone.
const SCROLL_WRAPPER = "-mx-2 overflow-x-auto px-2";

export function Journal(): React.ReactElement {
  const { data, isPending, isError, refetch } = useTradeHistory();

  if (isPending) {
    return (
      <div className="p-3">
        <div
          data-testid="ledger-loading"
          className="min-h-[240px] rounded-md bg-line opacity-40"
          aria-busy="true"
          aria-label="Loading trade ledger"
        />
      </div>
    );
  }

  if (isError || data === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 font-mono text-xs text-dim">
        <span>Couldn&apos;t load the trade ledger.</span>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => {
            void refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (data.roundTrips.length === 0 && data.executions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-xs text-dim">
        No trade history yet.
      </div>
    );
  }

  const total = data.totals.realizedPnl;

  return (
    <div data-testid="journal-ledger" className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {/* ── Round-trips ──────────────────────────────────────────────────── */}
      {/* No VIX chip here — the top market strip already shows LIVE VIX; the macro
          series is EOD and read as "stale data" (user feedback 2026-07-24). */}
      <Panel>
        <PanelHeading title="Trades" />
        <DataTable
          columns={ROUNDTRIP_COLS}
          rows={[...data.roundTrips]}
          rowTestId={(r) => `roundtrip-row-${r.calendarId}`}
          wrapperClassName={SCROLL_WRAPPER}
          wrapperTestId="roundtrip-table-scroll"
          tableClassName="min-w-[820px]"
          footer={
            <tr data-testid="roundtrip-total" className="border-t border-line font-semibold">
              <td className="px-2 py-1.5 text-left text-txt">Total realized</td>
              <td className="px-2 py-1.5" colSpan={4} />
              <td className={`px-2 py-1.5 text-right ${moneyClass(total)}`}>
                {money(total)}
              </td>
              <td className="px-2 py-1.5" colSpan={5} />
            </tr>
          }
        />
      </Panel>

      {/* ── Executions (TOS Account-Statement style) ─────────────────────── */}
      <Panel>
        <PanelHeading
          title="Trade History"
          action={
            <span className="font-mono text-[10px] text-dim">
              {data.executions.length} fills · raw broker record
            </span>
          }
        />
        <DataTable
          columns={EXECUTION_COLS}
          rows={data.executions.map((e, i) => ({ ...e, rowKey: `${e.activityId}-${i}` }))}
          rowTestId={(e) => `execution-row-${e.rowKey}`}
          wrapperClassName={SCROLL_WRAPPER}
          wrapperTestId="execution-table-scroll"
          tableClassName="min-w-[860px]"
        />
      </Panel>
    </div>
  );
}
