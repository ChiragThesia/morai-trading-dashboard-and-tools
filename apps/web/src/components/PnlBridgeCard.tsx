import { Panel, PanelHeading } from "./system/index.tsx";
import { signedUsd } from "../lib/position-format.ts";
import type { LifecycleResponse } from "@morai/contracts";

/**
 * PnlBridgeCard — crosshair-reactive P&L waterfall bridge (Attribution Idiom Decision,
 * 22-UI-SPEC.md). Default (hoveredIndex === null): shows the latest/"now" cumulative
 * values. While hovering the hero chart: shows the hovered index's cumulative values,
 * with an "as of {day}" label. The residual row is ALWAYS rendered (D-05) — never hidden,
 * regardless of magnitude.
 *
 * Gap honesty: if the resolved index is a feed gap, falls back to the last non-gap
 * point's totals rather than fabricating values for the gap.
 */

type LifecycleSnapshot = LifecycleResponse["snapshots"][number];

function lastNonGapIndex(snapshots: LifecycleResponse["snapshots"]): number | null {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const s = snapshots[i];
    if (s !== undefined && !s.isGap) return i;
  }
  return null;
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
}

interface BridgeRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly colorClass: string;
}

export interface PnlBridgeCardProps {
  readonly snapshots: LifecycleResponse["snapshots"];
  readonly hoveredIndex: number | null;
}

export function PnlBridgeCard({
  snapshots,
  hoveredIndex,
}: PnlBridgeCardProps): React.ReactElement {
  const fallbackIndex = lastNonGapIndex(snapshots);
  const requestedIndex = hoveredIndex ?? fallbackIndex;
  const requested = requestedIndex !== null ? snapshots[requestedIndex] : undefined;

  // Never fabricate values for a gap — fall back to the last non-gap point's totals.
  const resolvedIndex =
    requested !== undefined && requested.isGap ? fallbackIndex : requestedIndex;
  const resolved: LifecycleSnapshot | undefined =
    resolvedIndex !== null ? snapshots[resolvedIndex] : undefined;

  if (resolved === undefined) {
    return (
      <Panel>
        <PanelHeading title="P&amp;L bridge &middot; entry &rarr; now" />
        <div className="font-mono text-[11px] text-dim">Not enough snapshots yet.</div>
      </Panel>
    );
  }

  const theta = resolved.cumTheta ?? 0;
  const vega = resolved.cumVega ?? 0;
  const deltaGamma = resolved.cumDeltaGamma ?? 0;
  const residual = resolved.cumResidual ?? 0;
  const net = parseFloat(resolved.pnlOpen);

  const rows: ReadonlyArray<BridgeRow> = [
    { key: "entry", label: "Entry", value: 0, colorClass: "text-dim" },
    { key: "theta", label: "Theta", value: theta, colorClass: "text-up" },
    { key: "vega", label: "Vega", value: vega, colorClass: "text-blue" },
    { key: "deltaGamma", label: "Δ·Γ", value: deltaGamma, colorClass: "text-violet" },
    { key: "residual", label: "Residual", value: residual, colorClass: "text-faint" },
  ];

  return (
    <Panel>
      <PanelHeading title="P&amp;L bridge &middot; entry &rarr; now" />
      <div className="mb-1.5 font-mono text-[10px] text-dim">as of {fmtDay(resolved.time)}</div>
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between font-mono text-[11px]">
            <span className="text-muted-foreground">{row.label}</span>
            <span
              className={`tabular-nums font-semibold ${row.value < 0 ? "text-down" : row.colorClass}`}
            >
              {row.key === "entry" ? "$0" : signedUsd(row.value)}
            </span>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between border-t border-line pt-1.5 font-mono text-[11px] font-bold">
          <span className="text-txt">Net</span>
          <span className={`tabular-nums ${net < 0 ? "text-down" : "text-txt"}`}>
            {signedUsd(net)}
          </span>
        </div>
      </div>
    </Panel>
  );
}
