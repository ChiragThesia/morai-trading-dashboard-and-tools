/**
 * TradeCard — the dedicated mobile trade card (36 D-11, J11). Fed the same TradeSummary
 * the desktop TradeRow gets, but kills the triple affordance: instead of an OPEN badge +
 * "open"/P&L status text + a history/entry-exit chip, it shows ONE focal signal —
 * the OPEN badge for open trades, or the sign-colored realized P&L for closed ones —
 * over a single muted meta line (PositionCard idiom).
 *
 * Selection is NEVER gated (catch #23): the whole card is a role="button" that fires
 * onSelect on click / Enter / Space regardless of hasSnapshots. The pre-Jun-12 fact that
 * lived in the dead "entry/exit" chip survives as a "· entry/exit only" text suffix.
 */
import { cn } from "@/lib/utils";
import { classifyTradeHistory } from "../../lib/journal-history.ts";
import { fmtDate, fmtPnl } from "./useJournalModel.tsx";
import type { TradeSummary } from "./useJournalModel.tsx";

interface TradeCardProps {
  readonly trade: TradeSummary;
  readonly isSelected: boolean;
  /** Recorded rule-tag labels — only passed (non-empty) for the selected trade (D-22). */
  readonly tagLabels: ReadonlyArray<string>;
  readonly onSelect: (id: string) => void;
}

export function TradeCard({
  trade,
  isSelected,
  tagLabels,
  onSelect,
}: TradeCardProps): React.ReactElement {
  const isOpen = trade.closedAt === null;
  const kind = classifyTradeHistory({
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    hasSnapshots: trade.hasSnapshots,
  });

  // Focal closed-trade P&L: sign-colored, or dim em-dash when the endpoint gave "".
  const pnlNum = parseFloat(trade.realizedPnl);
  const pnlClass = !Number.isFinite(pnlNum)
    ? "text-dim"
    : pnlNum >= 0
      ? "text-up"
      : "text-down";

  // Row-2 meta: date range (closed) or "· open", plus "· entry/exit only" when the trade
  // predates chain history (the badge dies, the fact survives as text — D-11).
  const meta =
    trade.closedAt !== null
      ? `${fmtDate(trade.openedAt)} → ${fmtDate(trade.closedAt)}`
      : `${fmtDate(trade.openedAt)} · open`;
  const metaSuffix = kind !== "history" ? " · entry/exit only" : "";

  return (
    <div
      data-testid={`trade-card-${trade.id}`}
      onClick={() => {
        onSelect(trade.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(trade.id);
      }}
      className={cn(
        "min-h-11 cursor-pointer rounded-lg p-3 ring-1 transition-colors",
        isSelected ? "ring-violet bg-violetd" : "ring-line bg-raise/30",
      )}
    >
      {/* Row 1: name + single focal affordance (OPEN badge OR closed P&L). */}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-display text-sm font-bold text-txt">
          {trade.name}
        </span>
        {isOpen ? (
          <span className="rounded-[3px] border border-cyan/30 px-[5px] text-[8px] text-cyan">
            OPEN
          </span>
        ) : (
          <span className={cn("font-mono text-base font-bold tabular-nums", pnlClass)}>
            {fmtPnl(trade.realizedPnl)}
          </span>
        )}
      </div>

      {/* Row 2: one muted meta line. */}
      <div className="mt-1 truncate font-mono text-[10px] text-dim">
        {meta}
        {metaSuffix}
      </div>

      {/* Rule-tag read-view pill (D-22) — selected trade only; neutral, not violet. */}
      {isSelected && tagLabels.length > 0 && (
        <div
          data-testid="rule-tags-pill"
          title={tagLabels.join(", ")}
          className="mt-[3px] block max-w-[110px] truncate rounded-[3px] border border-line2 px-[5px] text-[8px] text-dim"
        >
          {tagLabels.join(", ")}
        </div>
      )}
    </div>
  );
}
