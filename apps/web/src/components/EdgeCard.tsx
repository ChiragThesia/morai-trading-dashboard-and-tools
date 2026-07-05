import { Panel, PanelHeading } from "./system/index.tsx";
import type { LifecycleResponse } from "@morai/contracts";

/**
 * EdgeCard — "the edge" rail card (D-02, JRNL-01). Forward vol is the prominent
 * amber hero value; front/back IV are smaller context rows. NEVER renders a
 * blended/averaged vol figure — front, back, and forward are always distinct.
 *
 * Presentational only — forwardVol/forwardVolGuard already computed server-side
 * (plan 22-01); this card only formats and branches on the guard.
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

/** Discriminated forward-vol read — narrows without `as`/`!` at the render site. */
type ForwardVolDisplay =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false };

function forwardVolDisplay(latest: LifecycleSnapshot): ForwardVolDisplay {
  if (latest.forwardVolGuard === "inverted" || latest.forwardVol === null) {
    return { ok: false };
  }
  return { ok: true, value: latest.forwardVol };
}

export interface EdgeCardProps {
  readonly snapshots: LifecycleResponse["snapshots"];
}

export function EdgeCard({ snapshots }: EdgeCardProps): React.ReactElement {
  const latest = lastNonGap(snapshots);

  if (latest === undefined) {
    return (
      <Panel>
        <PanelHeading title="The edge" />
        <div className="font-mono text-[11px] text-dim">Not enough snapshots yet.</div>
      </Panel>
    );
  }

  const frontIv = parseFloat(latest.frontIv);
  const backIv = parseFloat(latest.backIv);
  const termRatio = backIv !== 0 ? frontIv / backIv : null;
  const fwd = forwardVolDisplay(latest);

  return (
    <Panel>
      <PanelHeading title="The edge" />

      {fwd.ok ? (
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
            Forward vol
          </span>
          <span className="font-display text-[15px] font-bold tabular-nums text-amber">
            {fwd.value.toFixed(1)}%
          </span>
        </div>
      ) : (
        <div className="font-mono text-[11px] text-dim">
          Inverted term structure &mdash; no forward-vol read.
        </div>
      )}

      <div className="mt-1.5 flex items-center justify-between font-mono text-[11px]">
        <span className="text-muted-foreground">Front IV &middot; Back IV</span>
        <span className="tabular-nums text-txt">
          {frontIv.toFixed(1)} &middot; {backIv.toFixed(1)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between font-mono text-[11px]">
        <span className="text-muted-foreground">Term ratio (F/B)</span>
        <span className="tabular-nums text-txt">
          {termRatio !== null ? termRatio.toFixed(2) : "—"}
        </span>
      </div>

      <div className="mt-2 font-display text-[12px] leading-[1.5] text-muted-foreground">
        Forward vol &mdash; the vol priced between the two expiries &mdash; is the real
        relative-value read, not the raw front/back gap.
      </div>
    </Panel>
  );
}
