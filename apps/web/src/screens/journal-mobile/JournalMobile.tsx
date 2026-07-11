/**
 * JournalMobile — the dedicated mobile Journal tree (36 D-03, <1024px arm of the Journal
 * switch). Consumes the shared useJournalModel(trades). This plan (36-04) builds the
 * trades section (TradeCard list + History fold); the lifecycle block (MobileLifecycle)
 * and the reused rail stack (D-15) land in Task 3 of this same plan.
 */
import { useJournalModel, HeadingPill } from "./useJournalModel.tsx";
import type { TradeSummary } from "./useJournalModel.tsx";
import { TradeCard } from "./TradeCard.tsx";
import { SectionLabel } from "../../components/system/index.tsx";

interface JournalMobileProps {
  /** All trades to show — same contract the desktop tree receives (D-03). */
  readonly trades: ReadonlyArray<TradeSummary>;
}

export function JournalMobile({ trades }: JournalMobileProps): React.ReactElement {
  // D-03/D-04: the shared model owns all state/derivation; the mobile arm is the surface's
  // single useLifecycle + useRuleTags consumer when it mounts (only one tree mounts).
  const {
    openTrades,
    closedTrades,
    selectedTrade,
    setSelectedId,
    historyOpen,
    toggleHistory,
    selectedTradeTagLabels,
  } = useJournalModel(trades);

  // Empty state — the two locked lines, centered (desktop empty-state classes reused).
  if (trades.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 font-mono text-xs text-dim">
        <span>No journal history yet.</span>
        <span className="text-[10px]">Trades before Jun 12 have entry/exit only.</span>
      </div>
    );
  }

  const tagLabelsFor = (id: string): ReadonlyArray<string> =>
    id === selectedTrade?.id ? selectedTradeTagLabels : [];

  return (
    <div data-testid="journal-mobile-root" className="flex flex-col gap-6 pb-10 pt-4">
      {/* ── Trades section — open cards first, closed folded into History (D-11) ── */}
      <section className="px-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <SectionLabel>Trades</SectionLabel>
          <HeadingPill>SPXW put calendars</HeadingPill>
        </div>

        <div className="flex flex-col gap-2">
          {openTrades.map((trade) => (
            <TradeCard
              key={trade.id}
              trade={trade}
              isSelected={trade.id === selectedTrade?.id}
              tagLabels={tagLabelsFor(trade.id)}
              onSelect={setSelectedId}
            />
          ))}

          {closedTrades.length > 0 && (
            <div className={openTrades.length > 0 ? "mt-1 flex flex-col gap-2" : "flex flex-col gap-2"}>
              <button
                type="button"
                data-testid="history-toggle"
                aria-expanded={historyOpen}
                onClick={() => {
                  toggleHistory();
                }}
                className="flex w-full items-center gap-1.5 rounded-md px-[9px] py-[6px] font-mono text-[10px] tracking-wide text-dim transition-colors hover:text-txt"
              >
                <span className="text-[8px]">{historyOpen ? "▾" : "▸"}</span>
                <span>History ({closedTrades.length})</span>
              </button>

              {historyOpen &&
                closedTrades.map((trade) => (
                  <TradeCard
                    key={trade.id}
                    trade={trade}
                    isSelected={trade.id === selectedTrade?.id}
                    tagLabels={tagLabelsFor(trade.id)}
                    onSelect={setSelectedId}
                  />
                ))}
            </div>
          )}
        </div>
      </section>

      {/* MobileLifecycle block + reused rail stack (D-12..D-15) land in Task 3. */}
    </div>
  );
}
