/**
 * Journal screen — trade lifecycle + per-calendar rebuild (JOURNAL-01 + REBUILD-01 + JRNL-01)
 *
 * UI-SPEC "Journal screen" 3-column layout:
 *   Left  (250px) — trade list: open trades first (the "what's going on now" view),
 *                   closed trades folded into a collapsed "History (N)" section.
 *                   history/entry-exit/OPEN badges; selected row = violet border.
 *   Center (1fr)  — lifecycle: LifecycleMasthead (verdict headline + read + net P&L) +
 *                   the D-08 stacked-panel LifecycleChart (for history trades) OR dashed
 *                   pre-history stub + "no day-by-day (pre Jun-12)" (for entry/exit-only)
 *                   OR "Building the lifecycle." (too-new) OR an error state + Retry.
 *                   RebuildButton and the always-visible honest-caveats footer are present.
 *   Right (290px) — reactive rail: P&L bridge (crosshair-synced) → the edge → greeks · now
 *                   → the beats → relocated Notes (RULE-01, unchanged).
 *
 * Data: useLifecycle(calendarId) per selected trade (60s poll, parse via lifecycleResponse).
 * Empty state: locked "No journal history yet…" copy (JOURNAL-01).
 * Pre-Jun-12 trades: graceful stub — NEVER error, NEVER blank (JOURNAL-01 invariant).
 * Rebuild: RebuildButton triggers POST /api/jobs/rebuild-journal/trigger (REBUILD-01).
 *
 * 36 D-04: ALL state/derivation + the shared helpers/stubs/RuleTagChips live in
 * useJournalModel.tsx — this file keeps the desktop view components (TradeRow /
 * LifecycleSection) and the screen JSX. No seed data. No `any`/`as`/`!`.
 */

import { classifyTradeHistory } from "../lib/journal-history.ts";
import { LifecycleChart } from "../components/LifecycleChart.tsx";
import { LifecycleMasthead } from "../components/LifecycleMasthead.tsx";
import { PnlBridgeCard } from "../components/PnlBridgeCard.tsx";
import { EdgeCard } from "../components/EdgeCard.tsx";
import { GreeksNowCard } from "../components/GreeksNowCard.tsx";
import { BeatsCard } from "../components/BeatsCard.tsx";
import { RebuildButton } from "../components/RebuildButton.tsx";
import { Panel, PanelHeading, SectionLabel, Button } from "../components/system/index.tsx";
import type { LifecycleResponse } from "@morai/contracts";
import {
  useJournalModel,
  fmtDate,
  fmtPnl,
  HeadingPill,
  RuleTagChips,
  PreHistoryStub,
  BuildingLifecycleStub,
  ENTER_OPTIONS,
  EXIT_OPTIONS,
  ROLL_OPTIONS,
} from "./journal-mobile/useJournalModel.tsx";
import type { TradeSummary } from "./journal-mobile/useJournalModel.tsx";

// 36 D-04: TradeSummary is single-sourced in useJournalModel — re-exported so
// JournalContainer's import keeps resolving (the TradeSummary contract is untouched, D-03).
export type { TradeSummary };

interface JournalProps {
  /** All trades to show in the left-column list */
  trades: ReadonlyArray<TradeSummary>;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Center column lifecycle section for a selected trade */
function LifecycleSection({
  trade,
  snapshots,
  isPending,
  isError,
  onRetry,
  onCrosshairChange,
}: {
  trade: TradeSummary;
  snapshots: LifecycleResponse["snapshots"];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onCrosshairChange: (index: number | null) => void;
}): React.ReactElement {
  const kind = classifyTradeHistory({
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    hasSnapshots: snapshots.length > 0,
  });

  const eyebrow = `${trade.name} · ${fmtDate(trade.openedAt)}${
    trade.closedAt !== null ? ` → ${fmtDate(trade.closedAt)}` : " (open)"
  }`;

  return (
    <div className="flex flex-col gap-3">
      {!isPending && !isError && kind === "history" && (
        <LifecycleMasthead snapshots={snapshots} eyebrow={eyebrow} />
      )}

      {/* Lifecycle chart card */}
      <Panel className="flex min-h-[300px] flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[10px] text-dim">
            {kind === "history" ? "30-min snapshots" : "entry/exit only"}
          </div>
          <RebuildButton calendarId={trade.calendarId} />
        </div>

        {isPending && (
          <div
            className="min-h-[200px] flex-1 rounded-md bg-line opacity-40"
            aria-busy="true"
            aria-label="Loading lifecycle"
          />
        )}

        {!isPending && isError && (
          <div className="flex min-h-[200px] flex-1 flex-col items-center justify-center gap-2 p-4 text-center font-mono text-[11px] text-dim">
            <span>Couldn&apos;t load this calendar&apos;s lifecycle.</span>
            <Button
              variant="secondary"
              size="xs"
              onClick={() => {
                onRetry();
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {!isPending && !isError && kind === "entry-exit-only" && <PreHistoryStub />}

        {!isPending && !isError && kind === "history" && snapshots.length > 1 && (
          <LifecycleChart
            snapshots={snapshots}
            strike={trade.strike}
            onCrosshairChange={onCrosshairChange}
          />
        )}

        {!isPending && !isError && kind === "history" && snapshots.length <= 1 && (
          <BuildingLifecycleStub />
        )}
      </Panel>

      {/* Honest-caveats footer (always visible, not dismissible — D-05) */}
      <div className="flex flex-col gap-1 px-1 font-mono text-[9.5px] leading-[1.3] text-dim">
        <span>
          Attribution is a 2nd-order approximation — the faint residual band is the
          unexplained part, never hidden.
        </span>
        <span>
          Line breaks are real feed gaps (spot=0 / NaN), drawn as gaps, never interpolated.
        </span>
      </div>
    </div>
  );
}

// ─── Trade list row ────────────────────────────────────────────────────────────

/** One selectable trade row in the left-column list (open or closed). */
function TradeRow({
  trade,
  isSelected,
  tagLabels,
  onSelect,
}: {
  trade: TradeSummary;
  isSelected: boolean;
  /** Recorded rule-tag labels — only passed (non-empty) for the selected trade (D-22). */
  tagLabels: ReadonlyArray<string>;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const isOpen = trade.closedAt === null;
  const kind = classifyTradeHistory({
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    hasSnapshots: trade.hasSnapshots,
  });
  const pnlNum = parseFloat(trade.realizedPnl);
  const pnlClass = isOpen ? "text-blue" : pnlNum >= 0 ? "text-up" : "text-down";

  return (
    <div
      onClick={() => {
        onSelect(trade.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(trade.id);
      }}
      className={`mb-[5px] grid cursor-pointer grid-cols-[1fr_auto] gap-1.5 rounded-lg border px-[9px] py-[7px] ${
        isSelected ? "border-violet bg-violetd" : "border-line bg-panel2"
      }`}
    >
      <div>
        <div className="flex items-center gap-1 font-display text-xs text-txt">
          {trade.name}
          {isOpen && (
            <span className="rounded-[3px] border border-cyan/30 px-[5px] text-[8px] text-cyan">
              OPEN
            </span>
          )}
        </div>
        <div className="text-[9px] text-dim">
          {fmtDate(trade.openedAt)}
          {trade.closedAt !== null ? ` → ${fmtDate(trade.closedAt)}` : ""}
        </div>
      </div>

      <div className="text-right">
        <div className={`font-display text-xs font-bold tabular-nums ${pnlClass}`}>
          {isOpen ? "open" : fmtPnl(trade.realizedPnl)}
        </div>
        {/* History badge */}
        <div
          className={`mt-[3px] inline-block rounded-[3px] border px-[5px] text-[8px] ${
            kind === "history" ? "border-cyan/30 text-cyan" : "border-line2 text-dim"
          }`}
        >
          {kind === "history" ? "history" : "entry/exit"}
        </div>
        {/* Rule-tag read-view pill (D-22) — only known for the selected trade
            (useRuleTags fetches one calendar's tags at a time); neutral, not violet. */}
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
    </div>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export function Journal({ trades }: JournalProps): React.ReactElement {
  // 36 D-04: the shared model hook owns ALL state/derivation. Locals are destructured to
  // the pre-extraction names so the JSX below stays byte-identical to the pre-refactor
  // render — same elements, classes, testids, order (the OverviewDesktop precedent).
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

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (trades.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 font-mono text-xs text-dim">
        <span>No journal history yet.</span>
        <span className="text-[10px]">Trades before Jun 12 have entry/exit only.</span>
      </div>
    );
  }

  return (
    <div
      data-testid="journal-positions"
      className="flex flex-col gap-3 p-3 lg:grid lg:h-full lg:grid-cols-[250px_minmax(0,1fr)_290px] lg:overflow-hidden"
    >
      {/* ── Left column — trade list ─────────────────────────────────────── */}
      <div data-testid="journal-trades-column" className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
        <Panel>
          {/* Heading */}
          <PanelHeading
            title="Trades"
            action={<HeadingPill>SPXW put calendars</HeadingPill>}
          />

          {/* Trade rows — open first, then the collapsed History (closed) section. */}
          <div>
            {openTrades.map((trade) => (
              <TradeRow
                key={trade.id}
                trade={trade}
                isSelected={trade.id === selectedTrade?.id}
                tagLabels={trade.id === selectedTrade?.id ? selectedTradeTagLabels : []}
                onSelect={setSelectedId}
              />
            ))}

            {closedTrades.length > 0 && (
              <div className={openTrades.length > 0 ? "mt-1" : ""}>
                <button
                  type="button"
                  data-testid="history-toggle"
                  aria-expanded={historyOpen}
                  onClick={() => {
                    toggleHistory();
                  }}
                  className="mb-[5px] flex w-full items-center gap-1.5 rounded-md px-[9px] py-[6px] font-mono text-[10px] tracking-wide text-dim transition-colors hover:text-txt"
                >
                  <span className="text-[8px]">{historyOpen ? "▾" : "▸"}</span>
                  <span>History ({closedTrades.length})</span>
                </button>

                {historyOpen &&
                  closedTrades.map((trade) => (
                    <TradeRow
                      key={trade.id}
                      trade={trade}
                      isSelected={trade.id === selectedTrade?.id}
                      tagLabels={trade.id === selectedTrade?.id ? selectedTradeTagLabels : []}
                      onSelect={setSelectedId}
                    />
                  ))}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Center column — lifecycle ─────────────────────────────────────── */}
      <div data-testid="journal-lifecycle-column" className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
        {selectedTrade !== null && (
          <LifecycleSection
            trade={selectedTrade}
            snapshots={snapshots}
            isPending={isPending}
            isError={isError}
            onRetry={() => {
              void refetch();
            }}
            onCrosshairChange={setHoveredIndex}
          />
        )}
      </div>

      {/* ── Right column — reactive rail + notes ──────────────────────────── */}
      <div data-testid="journal-rail-column" className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
        <PnlBridgeCard snapshots={snapshots} hoveredIndex={hoveredIndex} />
        <EdgeCard snapshots={snapshots} />
        <GreeksNowCard snapshots={snapshots} />
        <BeatsCard beats={beats} />

        {/* Notes card (RULE-01) — relocated to the bottom of the rail, unchanged */}
        <Panel>
          <PanelHeading
            title="Notes"
            action={<HeadingPill>thesis · review</HeadingPill>}
          />

          {/* RULE-01: enter/exit/roll rule-tag control (D-07/D-10) — ABOVE the free-text
              textarea, which stays untouched. Editable anytime; no read-only lock. */}
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
    </div>
  );
}
