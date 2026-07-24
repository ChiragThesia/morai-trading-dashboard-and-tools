/**
 * Journal — the Trade Ledger: two plain tables + in-place per-trade expansion.
 *
 *   1. Trades — one row per calendar: TRADE, STATUS, OPENED, CLOSED, DAYS held,
 *      ENTRY (open debit), EXIT (close credit), P&L. Clicking a row expands it in
 *      place (data only): the trade's own fills + a DAILY history table (SPX, net
 *      greeks, per-leg greeks, IVs, slope, open P&L) with named greek headers and a
 *      one-line legend — user feedback 2026-07-24: bare Δ/Θ symbols were unreadable.
 *   2. Trade History — TOS Account-Statement-style raw fills from broker_transactions.
 *
 * One tree for all viewports: tables sit in horizontal-scroll wrappers with min-width
 * (the AnalyzerMobile recipe) — no useIsDesktop split.
 */

import { useState } from "react";
import { Panel, PanelHeading, DataTable, Button } from "../components/system/index.tsx";
import type { DataTableColumn } from "../components/system/index.tsx";
import { useTradeHistory } from "../hooks/useTradeHistory.ts";
import { useTradeDetail } from "../hooks/useTradeDetail.ts";
import { signedUsd, signClass } from "../lib/position-format.ts";
import type {
  TradeHistoryRoundTripResponse,
  TradeHistoryExecutionResponse,
  TradeDetailDayResponse,
} from "@morai/contracts";

// ─── Formatting helpers ───────────────────────────────────────────────────────

const DASH = "—";
const DAY_MS = 86_400_000;

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

function num(v: number | null, dp = 2): string {
  return v === null ? DASH : v.toFixed(dp);
}

function tradeName(r: TradeHistoryRoundTripResponse): string {
  return `${r.underlying} ${r.strike / 1000}${r.optionType}`;
}

function daysHeld(r: TradeHistoryRoundTripResponse): number {
  const end = r.closedAt !== null ? new Date(r.closedAt).getTime() : Date.now();
  return Math.max(1, Math.round((end - new Date(r.openedAt).getTime()) / DAY_MS));
}

const NUM = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Round-trips table (simple 8 columns) ─────────────────────────────────────

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
  { key: "days", header: "Days", render: (r) => daysHeld(r) },
  { key: "entry", header: "Entry", render: (r) => r.openNetDebit.toFixed(2) },
  {
    key: "exit",
    header: "Exit",
    render: (r) => (r.closeNetCredit !== null ? r.closeNetCredit.toFixed(2) : DASH),
  },
  {
    key: "pnl",
    header: "P&L",
    render: (r) => (
      <span className={`font-semibold ${moneyClass(r.realizedPnl)}`}>
        {money(r.realizedPnl)}
      </span>
    ),
  },
];

// ─── Expansion: daily history table ───────────────────────────────────────────

const DAY_COLS: ReadonlyArray<DataTableColumn<TradeDetailDayResponse>> = [
  { key: "date", header: "Date", align: "left", render: (d) => shortYmd(d.date) },
  { key: "spot", header: "SPX", render: (d) => num(d.spot, 1) },
  {
    key: "pnl",
    header: "P&L ($)",
    render: (d) => (
      <span className={moneyClass(d.pnlOpen !== null ? d.pnlOpen * 100 : null)}>
        {money(d.pnlOpen !== null ? d.pnlOpen * 100 : null)}
      </span>
    ),
  },
  { key: "nd", header: "Net Delta (Δ)", render: (d) => num(d.netDelta, 1) },
  { key: "nt", header: "Net Theta (Θ)/day", render: (d) => money(d.netTheta) },
  { key: "nv", header: "Net Vega", render: (d) => money(d.netVega) },
  { key: "ng", header: "Net Gamma (Γ)", render: (d) => num(d.netGamma, 3) },
  { key: "fiv", header: "Front IV", render: (d) => pct(d.frontIv) },
  { key: "biv", header: "Back IV", render: (d) => pct(d.backIv) },
  {
    key: "slope",
    header: "IV Slope (back−front)",
    render: (d) => (d.termSlope !== null ? (d.termSlope * 100).toFixed(2) : DASH),
  },
  { key: "fm", header: "Front Mark", render: (d) => num(d.front.mark) },
  { key: "fd", header: "Front Delta (Δ)", render: (d) => num(d.front.delta, 1) },
  { key: "ft", header: "Front Theta (Θ)", render: (d) => money(d.front.theta) },
  { key: "fv", header: "Front Vega", render: (d) => money(d.front.vega) },
  { key: "bm", header: "Back Mark", render: (d) => num(d.back.mark) },
  { key: "bd", header: "Back Delta (Δ)", render: (d) => num(d.back.delta, 1) },
  { key: "bt", header: "Back Theta (Θ)", render: (d) => money(d.back.theta) },
  { key: "bv", header: "Back Vega", render: (d) => money(d.back.vega) },
];

// ─── Expansion: legs (fills) mini-table ──────────────────────────────────────

type ExecRow = TradeHistoryExecutionResponse & { readonly rowKey: string };

/**
 * The trade's own fills: strike + type match, expiry is one of the calendar's two legs,
 * trade date inside the hold window (±1 day).
 * ponytail: two time-overlapping calendars sharing strike+type+one expiry would both
 * show a shared fill — honest (the fill did touch that contract).
 */
function fillsForTrade(
  executions: ReadonlyArray<TradeHistoryExecutionResponse>,
  r: TradeHistoryRoundTripResponse,
): ReadonlyArray<TradeHistoryExecutionResponse> {
  const from = new Date(new Date(r.openedAt).getTime() - DAY_MS).toISOString().slice(0, 10);
  const to = new Date(
    (r.closedAt !== null ? new Date(r.closedAt).getTime() : Date.now()) + DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
  return executions.filter(
    (e) =>
      e.strike === r.strike / 1000 &&
      e.type === r.optionType &&
      (e.expiry === r.frontExpiry || e.expiry === r.backExpiry) &&
      e.tradeDate >= from &&
      e.tradeDate <= to,
  );
}

const LEG_COLS: ReadonlyArray<DataTableColumn<ExecRow>> = [
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
  { key: "action", header: "Action", align: "left", render: (e) => e.positionEffect },
  { key: "exp", header: "Exp", render: (e) => shortYmd(e.expiry) },
  { key: "price", header: "Price", render: (e) => e.price.toFixed(2) },
  {
    key: "net",
    header: "Net Amt",
    render: (e) => (
      <span className={signClass(e.netAmount)}>{NUM.format(e.netAmount)}</span>
    ),
  },
];

// ─── Expansion panel ──────────────────────────────────────────────────────────

function TradeDetailPanel({
  trade,
  executions,
  detail,
}: {
  trade: TradeHistoryRoundTripResponse;
  executions: ReadonlyArray<TradeHistoryExecutionResponse>;
  detail: ReturnType<typeof useTradeDetail>;
}): React.ReactElement {
  const fills = fillsForTrade(executions, trade);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line/60 bg-panel2/60 p-3">
      <div>
        <div className="mb-1 font-display text-[10px] font-semibold uppercase tracking-[0.09em] text-dim">
          Fills — {tradeName(trade)}
        </div>
        <DataTable
          columns={LEG_COLS}
          rows={fills.map((e, i) => ({ ...e, rowKey: `${e.activityId}-${i}` }))}
          rowTestId={(e) => `trade-fill-row-${e.rowKey}`}
          wrapperClassName="overflow-x-auto"
          tableClassName="min-w-[560px]"
        />
      </div>

      <div>
        <div className="mb-1 font-display text-[10px] font-semibold uppercase tracking-[0.09em] text-dim">
          Daily history while held
        </div>
        {detail.isPending && (
          <div className="p-2 font-mono text-[10px] text-dim">Loading history…</div>
        )}
        {detail.isError && (
          <div className="p-2 font-mono text-[10px] text-dim">
            Couldn&apos;t load this trade&apos;s history.
          </div>
        )}
        {!detail.isPending && !detail.isError && detail.data !== undefined && (
          <DataTable
            columns={DAY_COLS}
            rows={[...detail.data.days]}
            rowTestId={(d) => `trade-day-row-${d.date}`}
            wrapperClassName="overflow-x-auto"
            tableClassName="min-w-[1500px]"
          />
        )}
        <div className="mt-1 px-1 font-mono text-[9.5px] leading-[1.3] text-dim">
          Δ delta = $ per 1-pt SPX move · Γ gamma = how fast delta changes per pt · Θ theta
          = $ earned/lost per day from time decay · Vega = $ per 1-pt vol move · IV slope =
          back-month IV − front-month IV. Per-leg values are position-signed (front short,
          back long); daily row = last snapshot of that trading day.
        </div>
      </div>
    </div>
  );
}

// ─── Executions table (TOS Account-Statement style) ──────────────────────────

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

// Shared mobile-friendly scroll recipe (AnalyzerMobile precedent).
const SCROLL_WRAPPER = "-mx-2 overflow-x-auto px-2";

export function Journal(): React.ReactElement {
  const { data, isPending, isError, refetch } = useTradeHistory();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const detail = useTradeDetail(expandedId);

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
  const executions = data.executions;

  return (
    <div data-testid="journal-ledger" className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {/* ── Round-trips ──────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeading
          title="Trades"
          action={
            <span className="font-mono text-[10px] text-dim">
              click a trade to expand its history
            </span>
          }
        />
        <DataTable
          columns={ROUNDTRIP_COLS}
          rows={[...data.roundTrips]}
          rowTestId={(r) => `roundtrip-row-${r.calendarId}`}
          onRowClick={(r) => {
            setExpandedId((cur) => (cur === r.calendarId ? null : r.calendarId));
          }}
          renderRowDetail={(r) =>
            r.calendarId === expandedId ? (
              <tr data-testid={`roundtrip-detail-${r.calendarId}`}>
                <td className="px-2 pb-2" colSpan={ROUNDTRIP_COLS.length}>
                  <TradeDetailPanel trade={r} executions={executions} detail={detail} />
                </td>
              </tr>
            ) : null
          }
          wrapperClassName={SCROLL_WRAPPER}
          wrapperTestId="roundtrip-table-scroll"
          tableClassName="min-w-[720px]"
          footer={
            <tr data-testid="roundtrip-total" className="border-t border-line font-semibold">
              <td className="px-2 py-1.5 text-left text-txt">Total realized</td>
              <td className="px-2 py-1.5" colSpan={6} />
              <td className={`px-2 py-1.5 text-right ${moneyClass(total)}`}>
                {money(total)}
              </td>
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
