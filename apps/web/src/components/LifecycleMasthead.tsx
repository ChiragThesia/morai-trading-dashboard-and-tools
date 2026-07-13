import { Panel } from "./system/index.tsx";
import { signedUsd } from "../lib/position-format.ts";
import type { LifecycleResponse } from "@morai/contracts";

/**
 * LifecycleMasthead — verdict-first editorial header for the Journal lifecycle rail
 * (JRNL-01, D-08). Replaces the current trade-header Panel block in LifecycleSection.
 *
 * Presentational only — no forward-vol/attribution math (that's server-side, plans
 * 22-01/02/03). Reads the already-enriched series and derives only trivial values
 * (latest cumulative theta, latest forward vol, latest net P&L).
 *
 * Copywriting Contract (22-UI-SPEC.md): one favorable-state clause + one what-happened
 * clause joined by an em dash; exactly one state-word bolded in --color-violet.
 */

type LifecycleSnapshot = LifecycleResponse["snapshots"][number];

/** Last non-gap snapshot, falling back to the last snapshot overall (D-05: never fabricate). */
function lastNonGap(
  snapshots: LifecycleResponse["snapshots"],
): LifecycleSnapshot | undefined {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const s = snapshots[i];
    if (s !== undefined && !s.isGap) return s;
  }
  return snapshots[snapshots.length - 1];
}

export interface LifecycleMastheadProps {
  readonly snapshots: LifecycleResponse["snapshots"];
  /** Optional trade descriptor line (e.g. "SPXW 7425 Put Calendar · Aug 7 / Aug 31"). */
  readonly eyebrow?: React.ReactNode;
}

export function LifecycleMasthead({
  snapshots,
  eyebrow,
}: LifecycleMastheadProps): React.ReactElement {
  const latest = lastNonGap(snapshots);
  const netPnl = latest !== undefined ? parseFloat(latest.pnlOpen) : 0;
  const isFavorable = netPnl >= 0;
  const stateWord = isFavorable ? "carrying it" : "under pressure";
  const pnlClass = isFavorable ? "text-up" : "text-down";

  const cumTheta = latest?.cumTheta ?? null;
  const forwardVol = latest?.forwardVol ?? null;
  const bitten =
    latest?.cumDeltaGamma !== null &&
    latest?.cumDeltaGamma !== undefined &&
    latest.cumDeltaGamma < 0;
  const whatHappened = bitten
    ? "a late move has taken a bite out of it"
    : "no adverse move has hit yet";

  const readSentence =
    cumTheta !== null && forwardVol !== null
      ? `Forward vol is holding at ${forwardVol.toFixed(1)}%; theta has banked ${signedUsd(cumTheta)} so far.`
      : "Building the lifecycle — check back after the next snapshot.";

  return (
    <Panel>
      {eyebrow !== undefined && (
        <div className="mb-1 font-mono text-[10px] text-dim">{eyebrow}</div>
      )}
      <div className="font-display text-[20px] leading-[1.2] font-bold text-txt">
        Theta&apos;s <span className="text-violet">{stateWord}</span> &mdash; {whatHappened}.
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="max-w-[52ch] font-display text-[12px] leading-[1.5] font-normal text-muted-foreground">
          {readSentence}
        </div>
        <div className="flex flex-none flex-col items-end gap-0.5">
          <span className="font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
            Net P&amp;L
          </span>
          <span className={`font-display text-[15px] font-bold tabular-nums ${pnlClass}`}>
            {signedUsd(netPnl)}
          </span>
        </div>
      </div>
    </Panel>
  );
}
