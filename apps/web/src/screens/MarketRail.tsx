/**
 * MarketRail — the persistent left context rail of the Overview (Option A, overview-layout-
 * redesign.md). "Where is the market" lands in the F-pattern's high-attention left stripe,
 * present (not summarised) and always beside the work.
 *
 * Composes existing pieces top-to-bottom: the entry-gate chip + 4 regime pills (2×2) + rates
 * row (all from `RegimeBoard`, `dense`), a compact COT card (the five net figures), a divider,
 * then the system-health list. It replaces the former below-fold "Positioning & macro detail"
 * and "Book & system" full-width sections. BOOK SUMMARY is intentionally dropped — net greeks
 * already live in the GEX rail's "Net book greeks" tile and book P&L in the pill ticker.
 *
 * On narrow viewports the rail is a collapsible `<details>` (open by default); the toggle
 * summary is hidden at `lg` where the rail is always shown as a fixed column.
 */
import { useStatus } from "../hooks/useStatus.ts";
import { RegimeBoard } from "../components/RegimeBoard.tsx";
import { CotCard } from "../components/CotCard.tsx";
import { Panel, SectionLabel } from "../components/system/index.tsx";
import { cn } from "@/lib/utils";

function SystemHealth(): React.ReactElement {
  const { data: status } = useStatus();
  if (status === undefined || status.lastJobRuns === "none yet") {
    return <p className="font-mono text-[11px] text-dim">System status loading…</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {Object.entries(status.lastJobRuns).map(([job, rec]) => {
        const healthy =
          rec.lastErrorAt === null ||
          (rec.lastSuccessAt !== null && rec.lastSuccessAt > rec.lastErrorAt);
        return (
          <div key={job} className="flex items-center gap-2 font-mono text-[11px]">
            <span className={cn("size-2 shrink-0 rounded-full", healthy ? "bg-up" : "bg-down")} />
            <span className="text-muted-foreground">{job}</span>
            <span className="ml-auto text-dim">{healthy ? "ok" : "error"}</span>
          </div>
        );
      })}
    </div>
  );
}

export function MarketRail(): React.ReactElement {
  return (
    <details open className="group flex flex-col gap-3" data-testid="market-rail">
      <summary className="cursor-pointer list-none font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase lg:hidden">
        Market
      </summary>
      <div className="mt-3 flex flex-col gap-3 lg:mt-0">
        <RegimeBoard dense />
        <CotCard />
        <Panel className="p-4">
          <SectionLabel className="mb-3">System health</SectionLabel>
          <SystemHealth />
        </Panel>
      </div>
    </details>
  );
}
