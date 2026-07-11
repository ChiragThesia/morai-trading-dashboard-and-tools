/**
 * MobileLifecycle — the dedicated mobile lifecycle block (36 D-12/D-13/D-14). Renders for
 * the selected trade: the masthead (history only), a slim heading row whose ⋯ overflow
 * demotes the destructive Rebuild behind a dialog (D-13), the honest state branches (bare,
 * never Panel-wrapped), and — for a history trade with a real chart — the LifecycleChart
 * mounted at its designed 840px CSS width inside a full-bleed horizontal pan container
 * (D-12: kills the 60%-width bug; LifecycleChart itself is ZERO-diff). A closed "Chart
 * notes" disclosure carries the two honest-caveat footnotes (D-14).
 */
import { useLayoutEffect, useRef } from "react";
import { classifyTradeHistory } from "../../lib/journal-history.ts";
import { LifecycleChart } from "../../components/LifecycleChart.tsx";
import { LifecycleMasthead } from "../../components/LifecycleMasthead.tsx";
import { RebuildButton } from "../../components/RebuildButton.tsx";
import { Button, buttonClass } from "../../components/system/index.tsx";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog.tsx";
import { fmtDate, PreHistoryStub, BuildingLifecycleStub } from "./useJournalModel.tsx";
import type { TradeSummary } from "./useJournalModel.tsx";
import type { LifecycleResponse } from "@morai/contracts";

const DIALOG_TITLE_CLASS =
  "font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase";

export interface MobileLifecycleProps {
  readonly trade: TradeSummary;
  readonly snapshots: LifecycleResponse["snapshots"];
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
  readonly onCrosshairChange: (index: number | null) => void;
}

export function MobileLifecycle({
  trade,
  snapshots,
  isPending,
  isError,
  onRetry,
  onCrosshairChange,
}: MobileLifecycleProps): React.ReactElement {
  const kind = classifyTradeHistory({
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    hasSnapshots: snapshots.length > 0,
  });

  const eyebrow = `${trade.name} · ${fmtDate(trade.openedAt)}${
    trade.closedAt !== null ? ` → ${fmtDate(trade.closedAt)}` : " (open)"
  }`;

  const showChart = !isPending && !isError && kind === "history" && snapshots.length > 1;

  // D-12 / T-36-08: start the pan at the latest snapshots. scrollLeft is set on mount and
  // when the chart first appears (showChart false→true) or the trade changes — never per
  // snapshot poll (showChart stays true, trade.id stable across polls).
  const panRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = panRef.current;
    if (el !== null) el.scrollLeft = el.scrollWidth;
  }, [trade.id, showChart]);

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Masthead — history only, not pending/error (same gate as desktop). */}
      {!isPending && !isError && kind === "history" && (
        <div className="px-4">
          <LifecycleMasthead snapshots={snapshots} eyebrow={eyebrow} />
        </div>
      )}

      {/* 2. Heading row — kind caption + ⋯ overflow demoting Rebuild (D-13). */}
      <div className="flex items-center justify-between px-4">
        <div className="font-mono text-[10px] text-dim">
          {kind === "history" ? "30-min snapshots" : "entry/exit only"}
        </div>
        <Dialog>
          <DialogTrigger
            aria-label="More journal actions"
            className={buttonClass({ size: "touch", variant: "ghost" })}
          >
            ⋯
          </DialogTrigger>
          <DialogContent className="max-w-xs">
            <DialogTitle className={DIALOG_TITLE_CLASS}>Journal</DialogTitle>
            <RebuildButton calendarId={trade.calendarId} />
          </DialogContent>
        </Dialog>
      </div>

      {/* 3. Honest states — bare (no Panel wrapper). */}
      {isPending && (
        <div
          className="mx-4 min-h-[200px] rounded-md bg-line opacity-40"
          aria-busy="true"
          aria-label="Loading lifecycle"
        />
      )}

      {!isPending && isError && (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 px-4 text-center font-mono text-[11px] text-dim">
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

      {!isPending && !isError && kind === "entry-exit-only" && (
        <div className="px-4">
          <PreHistoryStub />
        </div>
      )}

      {!isPending && !isError && kind === "history" && snapshots.length <= 1 && (
        <div className="px-4">
          <BuildingLifecycleStub />
        </div>
      )}

      {/* 4. Chart — full-bleed 840px pan mount (D-12); internals ZERO-diff. */}
      {showChart && (
        <>
          <section className="px-0">
            <div ref={panRef} data-testid="lifecycle-pan" className="overflow-x-auto">
              <div className="w-[840px]">
                <LifecycleChart
                  snapshots={snapshots}
                  strike={trade.strike}
                  onCrosshairChange={onCrosshairChange}
                />
              </div>
            </div>
          </section>

          <div className="mt-1.5 px-4 font-mono text-[9px] text-dim">
            ‹ swipe for earlier days
          </div>

          {/* 5. Chart notes — closed disclosure, honest-caveat footnotes (D-14). */}
          <details data-testid="chart-notes" className="group px-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 py-3 font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase [&::-webkit-details-marker]:hidden">
              <span className="text-[8px] transition-transform group-open:rotate-90">▸</span>
              <span>Chart notes</span>
            </summary>
            <div className="flex flex-col gap-1 pb-2 font-mono text-[9.5px] leading-[1.3] text-dim">
              <span>
                Attribution is a 2nd-order approximation — the faint residual band is the
                unexplained part, never hidden.
              </span>
              <span>
                Line breaks are real feed gaps (spot=0 / NaN), drawn as gaps, never
                interpolated.
              </span>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
