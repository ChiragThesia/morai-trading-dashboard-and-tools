/**
 * PositionCard — mobile positions-list card (35-04). Fed the SAME `Row` (from `buildRows`)
 * the desktop `<table>` renders — no new data shape, no second source of truth. Collapsed
 * shows label/expiry/Net val/Unreal/verdict; tapping the card body expands the Δ/Γ/Θ/Vega
 * grid. `expanded`/`onSelect` reuse `expandedRowKey`/`onSelectRow` verbatim (D-05); the
 * checkbox reuses `excluded`/`onToggleExcluded` (as `included`/`onToggleIncluded`) — no
 * second expand or exclusion mechanism.
 *
 * Live-cell flash/staleness (`.live-cell`, `.live-cell-flash`) is deliberately NOT ported —
 * the desktop table's per-cell flash-on-tick animation doesn't translate to a card layout
 * with fewer, larger value blocks; the card simply re-renders with the latest
 * `resolveLivePositionRow` output each tick (same data freshness, no flash chrome).
 */
import { resolveLivePositionRow } from "../lib/live-position-greeks.ts";
import { usd, signed, signedUsd, signClass } from "../lib/position-format.ts";
import type { Row } from "../lib/position-format.ts";
import { VerdictChip } from "../screens/HeldPositionsPanel.tsx";
import { Stat } from "./system/index.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/lib/utils";
import type { StreamLiveGreekEvent, HeldPositionVerdict } from "@morai/contracts";
import type { LiveStreamStatus } from "../hooks/useLiveStream.ts";

export type PositionCardProps = {
  readonly row: Row;
  readonly spot: number;
  readonly liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>;
  readonly liveStatus: LiveStreamStatus;
  readonly ivNa: boolean;
  readonly verdict: HeldPositionVerdict | null;
  readonly marketSession: "rth" | "after-hours";
  readonly expanded: boolean;
  readonly onSelect: (key: string) => void;
  readonly included: boolean;
  readonly onToggleIncluded: (key: string) => void;
};

export function PositionCard({
  row,
  spot,
  liveGreeks,
  ivNa,
  verdict,
  marketSession,
  expanded,
  onSelect,
  included,
  onToggleIncluded,
}: PositionCardProps): React.ReactElement {
  const { netVal, unreal, greeks: g } = resolveLivePositionRow(row.legs, spot, liveGreeks);
  return (
    <div
      data-testid={`position-card-${row.key}`}
      className={cn(
        "rounded-lg border border-line bg-transparent p-3 transition-opacity",
        !included && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
          <input
            type="checkbox"
            checked={included}
            onChange={() => { onToggleIncluded(row.key); }}
            aria-label={`Include ${row.label} in risk profile & total`}
            className="accent-blue"
          />
        </label>
        <button
          type="button"
          onClick={() => { onSelect(row.key); }}
          aria-expanded={expanded}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span className="font-display text-sm font-bold text-txt">{row.label}</span>
              {ivNa && (
                <Badge variant="outline" className="border-amber/50 px-1 py-0 font-mono text-[9px] text-amber">
                  IV n/a
                </Badge>
              )}
            </span>
            {verdict !== null && <VerdictChip row={verdict} marketSession={marketSession} />}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-dim">
            {row.expiry.line1} · {row.expiry.line2}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <Stat label="Net val" value={usd(netVal)} />
            <Stat
              label="Unreal"
              value={unreal === null ? "—" : signedUsd(unreal)}
              valueClassName={unreal === null ? "text-dim" : signClass(unreal)}
            />
          </div>
          {expanded && (
            <div className="mt-2 grid grid-cols-4 gap-2 border-t border-line/40 pt-2">
              <Stat label="Δ" value={signed(g.delta)} valueClassName={signClass(g.delta)} />
              <Stat label="Γ" value={signed(g.gamma)} />
              <Stat label="Θ/d" value={signedUsd(g.theta)} valueClassName={signClass(g.theta)} />
              <Stat label="Vega" value={signedUsd(g.vega)} valueClassName={signClass(g.vega)} />
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
