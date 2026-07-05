import { Panel, PanelHeading, Stat } from "./system/index.tsx";
import type { LifecycleResponse } from "@morai/contracts";

/**
 * GreeksNowCard — signed greeks at the latest snapshot (D-03, JRNL-01). Surfaces the
 * long-vega / short-gamma / +theta calendar signature. Reuses the Stat kv-row idiom —
 * no new visual pattern.
 */

type LifecycleSnapshot = LifecycleResponse["snapshots"][number];

function lastNonGap(
  snapshots: LifecycleResponse["snapshots"],
): LifecycleSnapshot | undefined {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const s = snapshots[i];
    if (s !== undefined && !s.isGap) return s;
  }
  return snapshots[snapshots.length - 1];
}

function fmtSigned(n: number, decimals: number): string {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toFixed(decimals)}`;
}

export interface GreeksNowCardProps {
  readonly snapshots: LifecycleResponse["snapshots"];
}

export function GreeksNowCard({ snapshots }: GreeksNowCardProps): React.ReactElement {
  const latest = lastNonGap(snapshots);

  if (latest === undefined) {
    return (
      <Panel>
        <PanelHeading title="Greeks &middot; now" />
        <div className="font-mono text-[11px] text-dim">Not enough snapshots yet.</div>
      </Panel>
    );
  }

  const delta = parseFloat(latest.netDelta);
  const gamma = parseFloat(latest.netGamma);
  const theta = parseFloat(latest.netTheta);
  const vega = parseFloat(latest.netVega);

  return (
    <Panel>
      <PanelHeading title="Greeks &middot; now" />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Delta" value={fmtSigned(delta, 2)} valueClassName="text-violet" />
        <Stat label="Gamma" value={fmtSigned(gamma, 3)} valueClassName="text-down" />
        <Stat label="Theta / day" value={fmtSigned(theta, 0)} valueClassName="text-up" />
        <Stat label="Vega" value={fmtSigned(vega, 0)} valueClassName="text-blue" />
      </div>
      <div className="mt-2 font-display text-[12px] leading-[1.5] text-muted-foreground">
        Long vega, short gamma, collecting theta &mdash; the calendar signature. Theta pays
        you to hold; short gamma is the bill when the tape moves.
      </div>
    </Panel>
  );
}
