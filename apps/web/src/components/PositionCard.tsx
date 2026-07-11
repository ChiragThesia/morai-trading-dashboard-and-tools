/**
 * PositionCard — mobile positions-list card (35-04, re-hierarchied 35.1-03 D-07). Fed the
 * SAME `Row` (from `buildRows`) the desktop `<table>` renders — no new data shape, no
 * second source of truth. Row 1: label + IV-n/a badge + VerdictChip left, focal unreal
 * P&L right (16px mono bold, sign-colored). Row 2: one muted meta line (expiry · DTE ·
 * net val). Tapping the card body expands the Δ/Γ/Θ/Vega grid — ALWAYS, never gated on a
 * verdict (catch #23: this grid is mobile's only greeks surface) — plus VerdictDetailBody
 * when a verdict exists. `expanded`/`onSelect` reuse `expandedRowKey`/`onSelectRow`
 * verbatim (D-05); the checkbox reuses `excluded`/`onToggleExcluded` (as `included`/
 * `onToggleIncluded`) — no second expand or exclusion mechanism.
 *
 * Live-cell flash/staleness (`.live-cell`, `.live-cell-flash`) is deliberately NOT ported —
 * the desktop table's per-cell flash-on-tick animation doesn't translate to a card layout
 * with fewer, larger value blocks; the card simply re-renders with the latest
 * `resolveLivePositionRow` output each tick (same data freshness, no flash chrome).
 */
import { resolveLivePositionRow } from "../lib/live-position-greeks.ts";
import { usd, signed, signedUsd, signClass } from "../lib/position-format.ts";
import type { Row } from "../lib/position-format.ts";
import { VerdictChip, VerdictDetailBody } from "../screens/HeldPositionsPanel.tsx";
import { Stat } from "./system/index.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/lib/utils";
import type { StreamLiveGreekEvent, HeldPositionVerdict } from "@morai/contracts";

export type PositionCardProps = {
  readonly row: Row;
  readonly spot: number;
  readonly liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>;
  readonly ivNa: boolean;
  readonly verdict: HeldPositionVerdict | null;
  readonly marketSession: "rth" | "after-hours";
  readonly expanded: boolean;
  readonly onSelect: (key: string) => void;
  readonly included: boolean;
  readonly onToggleIncluded: (key: string) => void;
  /** Cohort instant for VerdictDetailBody's as-of dot — null when no exits snapshot. */
  readonly verdictObservedAt: string | null;
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
  verdictObservedAt,
}: PositionCardProps): React.ReactElement {
  const { netVal, unreal, greeks: g } = resolveLivePositionRow(row.legs, spot, liveGreeks);
  return (
    <div
      data-testid={`position-card-${row.key}`}
      className={cn(
        "rounded-lg bg-raise/30 p-3 ring-1 ring-line transition-opacity",
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
          {/* Row 1 (D-07): label + IV n/a + verdict left, focal unreal right. */}
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="font-display text-sm font-bold text-txt">{row.label}</span>
              {ivNa && (
                <Badge variant="outline" className="border-amber/50 px-1 py-0 font-mono text-[9px] text-amber">
                  IV n/a
                </Badge>
              )}
              {verdict !== null && <VerdictChip row={verdict} marketSession={marketSession} />}
            </span>
            <span
              className={cn(
                "font-mono text-base font-bold tabular-nums",
                unreal === null ? "text-dim" : signClass(unreal),
              )}
            >
              {unreal === null ? "—" : signedUsd(unreal)}
            </span>
          </div>
          {/* Row 2 (D-07): one muted meta line — expiry · DTE · net val. */}
          <div className="mt-1 font-mono text-[10px] text-dim truncate">
            {row.expiry.line1} · {row.expiry.line2} · {usd(netVal)}
          </div>
          {expanded && (
            <div className="mt-2 border-t border-line/40 pt-2">
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Δ" value={signed(g.delta)} valueClassName={signClass(g.delta)} />
                <Stat label="Γ" value={signed(g.gamma)} />
                <Stat label="Θ/d" value={signedUsd(g.theta)} valueClassName={signClass(g.theta)} />
                <Stat label="Vega" value={signedUsd(g.vega)} valueClassName={signClass(g.vega)} />
              </div>
              {verdict !== null && (
                <div className="mt-2">
                  <VerdictDetailBody row={verdict} observedAt={verdictObservedAt ?? ""} />
                </div>
              )}
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
