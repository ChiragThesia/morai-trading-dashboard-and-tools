/**
 * JournalMobile — the dedicated mobile Journal tree (36 D-03, <1024px arm of the Journal
 * switch). Skeleton in this plan: the empty state + the root container. The sections that
 * consume the shared model — the trades list (TradeCard + History), the lifecycle block
 * (MobileLifecycle), and the reused rail stack (D-15) — land in plan 36-04.
 */
import { useJournalModel } from "./useJournalModel.tsx";
import type { TradeSummary } from "./useJournalModel.tsx";

interface JournalMobileProps {
  /** All trades to show — same contract the desktop tree receives (D-03). */
  readonly trades: ReadonlyArray<TradeSummary>;
}

export function JournalMobile({ trades }: JournalMobileProps): React.ReactElement {
  // D-03/D-04: call the shared model here so the mobile arm is the surface's single
  // useLifecycle + useRuleTags consumer when it mounts (only one tree mounts per the
  // switch). Plan 36-04 wires its slices (selectedTrade / snapshots / beats / rule tags)
  // into the sections; the skeleton claims the model + the root container from day one.
  useJournalModel(trades);

  // Empty state — the two locked lines, centered (desktop empty-state classes reused).
  if (trades.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 font-mono text-xs text-dim">
        <span>No journal history yet.</span>
        <span className="text-[10px]">Trades before Jun 12 have entry/exit only.</span>
      </div>
    );
  }

  return (
    <div data-testid="journal-mobile-root" className="flex flex-col gap-6 pb-10 pt-4">
      {/* Sections (Trades + TradeCard, MobileLifecycle, rail stack) land in plan 36-04. */}
    </div>
  );
}
