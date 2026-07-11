/**
 * JournalMobile — the dedicated mobile Journal tree (36 D-03, <1024px arm of the Journal
 * switch). Consumes the shared useJournalModel(trades): the trades section (TradeCard list
 * + History fold), the MobileLifecycle block (masthead / states / 840px pan mount / ⋯
 * Rebuild demotion / chart notes), then the reused rail stack + Notes (D-15) — the rail
 * cards and RuleTagChips are the exact same components the desktop tree renders.
 */
import { useJournalModel, HeadingPill, RuleTagChips, fmtDate } from "./useJournalModel.tsx";
import { ENTER_OPTIONS, EXIT_OPTIONS, ROLL_OPTIONS } from "./useJournalModel.tsx";
import type { TradeSummary } from "./useJournalModel.tsx";
import { TradeCard } from "./TradeCard.tsx";
import { MobileLifecycle } from "./MobileLifecycle.tsx";
import { Panel, PanelHeading, SectionLabel } from "../../components/system/index.tsx";
import { PnlBridgeCard } from "../../components/PnlBridgeCard.tsx";
import { EdgeCard } from "../../components/EdgeCard.tsx";
import { GreeksNowCard } from "../../components/GreeksNowCard.tsx";
import { BeatsCard } from "../../components/BeatsCard.tsx";

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
    hoveredIndex,
    setHoveredIndex,
    snapshots,
    isPending,
    isError,
    refetch,
    rulesPending,
    ruleErrors,
    saveRuleTags,
    retryRuleTags,
    openEvent,
    closeEvent,
    rollEvents,
    selectedTradeTagLabels,
    beats,
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

      {/* ── Lifecycle block + reused rail stack — only for a selected trade (D-12..D-15) ── */}
      {selectedTrade !== null && (
        <>
          <MobileLifecycle
            trade={selectedTrade}
            snapshots={snapshots}
            isPending={isPending}
            isError={isError}
            onRetry={() => {
              void refetch();
            }}
            onCrosshairChange={setHoveredIndex}
          />

          {/* Rail stack (D-15) — verbatim components, mobile order + spacing. */}
          <div className="flex flex-col gap-3 px-4">
            <PnlBridgeCard snapshots={snapshots} hoveredIndex={hoveredIndex} />
            <EdgeCard snapshots={snapshots} />
            <GreeksNowCard snapshots={snapshots} />
            <BeatsCard beats={beats} />

            {/* Notes card (RULE-01) — duplicated verbatim from the desktop rail. */}
            <Panel>
              <PanelHeading title="Notes" action={<HeadingPill>thesis · review</HeadingPill>} />

              {!rulesPending && (
                <div className="mb-2 flex flex-col gap-2">
                  {openEvent !== undefined && (
                    <div className="flex flex-col gap-1">
                      <SectionLabel tone="dim">ENTER</SectionLabel>
                      <RuleTagChips
                        fillIdsHash={openEvent.fillIdsHash}
                        options={ENTER_OPTIONS}
                        activeTags={openEvent.tags}
                        otherNote={openEvent.otherNote}
                        error={ruleErrors[openEvent.fillIdsHash]}
                        onSave={(tags, otherNote) => {
                          void saveRuleTags(openEvent.fillIdsHash, tags, otherNote);
                        }}
                        onRetry={() => {
                          retryRuleTags(openEvent.fillIdsHash);
                        }}
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-1">
                    <SectionLabel tone="dim">EXIT</SectionLabel>
                    {closeEvent === undefined ? (
                      <span className="font-mono text-[10px] text-dim">Available at close.</span>
                    ) : (
                      <RuleTagChips
                        fillIdsHash={closeEvent.fillIdsHash}
                        options={EXIT_OPTIONS}
                        activeTags={closeEvent.tags}
                        otherNote={closeEvent.otherNote}
                        error={ruleErrors[closeEvent.fillIdsHash]}
                        onSave={(tags, otherNote) => {
                          void saveRuleTags(closeEvent.fillIdsHash, tags, otherNote);
                        }}
                        onRetry={() => {
                          retryRuleTags(closeEvent.fillIdsHash);
                        }}
                      />
                    )}
                  </div>

                  {rollEvents.map((rollEvent) => (
                    <div key={rollEvent.fillIdsHash} className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <SectionLabel tone="dim">ROLL</SectionLabel>
                        <span className="font-mono text-[9px] text-dim">
                          {fmtDate(rollEvent.eventedAt)}
                        </span>
                      </div>
                      <RuleTagChips
                        fillIdsHash={rollEvent.fillIdsHash}
                        options={ROLL_OPTIONS}
                        activeTags={rollEvent.tags}
                        otherNote={rollEvent.otherNote}
                        error={ruleErrors[rollEvent.fillIdsHash]}
                        onSave={(tags, otherNote) => {
                          void saveRuleTags(rollEvent.fillIdsHash, tags, otherNote);
                        }}
                        onRetry={() => {
                          retryRuleTags(rollEvent.fillIdsHash);
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <textarea
                placeholder="Entry thesis, management, post-mortem…"
                className="box-border min-h-[60px] w-full resize-y rounded-md border border-line2 bg-panel2 p-2 font-mono text-[11px] text-txt"
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
