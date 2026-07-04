/**
 * WhyPanel — the picker's "Why this calendar" panel (ANLZ-03, D-01b).
 *
 * A Fwd IV/Slope/Net θ/θ:vega stat grid (guard-safe: Fwd IV shows `—` when `fwdIv` is null,
 * never a fabricated number) plus three candidate-conditional prose sentences: the forward-edge
 * narrative (3-way branch — front-rich / forward-tailwind / locked guard sentence), the
 * event-premium narrative (2-way branch on `frontEvents.length`), and a closing GEX-fit sentence
 * against the fixture's static GEX snapshot (flip/walls/netGamma — not re-fetched live, T-18-10).
 *
 * Net θ is always rendered as a positive/up value — the engine's `theta > 0` constraint means
 * this candidate never carries a negative net theta (T-18-10 mitigation: no fabricated sign flip
 * needed, the underlying value is always positive).
 *
 * Custom stat-cell markup (label/value/sub-caption, 3 lines) mirrors the mockup's `.stat` block —
 * the shared `Stat` molecule (`system/index.tsx`) only supports a 2-line label/value cell, so this
 * panel builds its own cell here rather than stretching that molecule's contract (same discretion
 * CandidateCard.tsx already exercised for its hand-rolled breakdown bars).
 */
import { cn } from "@/lib/utils";
import type { PickerCandidate, PickerGexContext } from "@morai/contracts";

export interface WhyPanelProps {
  readonly candidate: PickerCandidate;
  readonly gex: PickerGexContext;
}

function pct1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function signedVolPtsPerYear(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}v/yr`;
}

function forwardEdgeSentence(candidate: PickerCandidate): string {
  if (candidate.fwdIv === null) {
    return (
      "Forward IV is undefined here — the term structure between these two legs is inverted " +
      "(back-leg variance implies a negative forward radicand). This candidate is ranked on " +
      "slope, GEX fit, and event adjustment only; the forward-edge criterion contributes 0."
    );
  }
  if (candidate.fwdEdge > 0) {
    return `Front IV ${pct1(candidate.frontLeg.iv)} is RICH vs the ${pct1(candidate.fwdIv)} forward path — genuine term-structure edge for the short leg.`;
  }
  return `Front IV ${pct1(candidate.frontLeg.iv)} is below the ${pct1(candidate.fwdIv)} forward vol — no front-richness edge today; the case rests on the upward slope (long-vol tailwind, Vasquez) and theta carry.`;
}

function eventPremiumSentence(candidate: PickerCandidate): string {
  if (candidate.frontEvents.length > 0) {
    return `Front leg spans ${candidate.frontEvents.join(" + ")} — part of its IV is event premium and a realized-vol spike near ${candidate.frontLeg.strike} is the max-loss scenario. Scored with a penalty.`;
  }
  return "Front leg expires before FOMC — edge is structural, not event premium.";
}

function gexFitSentence(candidate: PickerCandidate, gex: PickerGexContext): string {
  const strike = candidate.frontLeg.strike;
  const netSign = gex.netGammaAtSpot >= 0 ? "+" : "−";
  const regime = gex.netGammaAtSpot >= 0 ? "dampen" : "amplify";

  let strikeNote: string;
  if (gex.absGammaStrike !== null && strike === gex.absGammaStrike) {
    strikeNote = "= absolute-gamma strike (pin magnet) ✓";
  } else if (gex.putWall !== null && strike === gex.putWall) {
    strikeNote = "= put wall (support) ✓";
  } else if (gex.absGammaStrike !== null) {
    strikeNote = `${Math.abs(strike - gex.absGammaStrike)}pts from abs-γ strike`;
  } else {
    strikeNote = "no abs-γ strike reference available";
  }

  return `GEX: net γ ${netSign}$${Math.abs(gex.netGammaAtSpot).toFixed(1)}B (${regime}) ✓ · strike ${strikeNote}.`;
}

function WhyStat({
  testIdBase,
  label,
  value,
  valueClassName,
  subCaption,
}: {
  testIdBase: string;
  label: string;
  value: string;
  valueClassName?: string;
  subCaption: string;
}): React.ReactElement {
  return (
    <div className="rounded-md bg-raise px-2 py-1.5">
      <div className="font-display text-[9px] font-semibold tracking-[0.08em] text-dim uppercase">
        {label}
      </div>
      <div
        data-testid={`${testIdBase}-value`}
        className={cn("font-display text-sm font-bold tabular-nums", valueClassName ?? "text-txt")}
      >
        {value}
      </div>
      <div data-testid={`${testIdBase}-subcaption`} className="font-mono text-[9px] text-dim">
        {subCaption}
      </div>
    </div>
  );
}

export function WhyPanel({ candidate, gex }: WhyPanelProps): React.ReactElement {
  const fwdIvValue = candidate.fwdIv === null ? "—" : pct1(candidate.fwdIv);
  const slopePositive = candidate.slope > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1.5">
        <WhyStat
          testIdBase="whypanel-stat-fwdiv"
          label="Fwd IV (legs)"
          value={fwdIvValue}
          subCaption={`vs front ${pct1(candidate.frontLeg.iv)}`}
        />
        <WhyStat
          testIdBase="whypanel-stat-slope"
          label="Slope"
          value={signedVolPtsPerYear(candidate.slope)}
          valueClassName={slopePositive ? "text-violet" : "text-down"}
          subCaption="between legs"
        />
        <WhyStat
          testIdBase="whypanel-stat-nettheta"
          label="Net θ"
          value={`+${candidate.theta.toFixed(1)}/d`}
          valueClassName="text-up"
          subCaption="constraint: >0 ✓"
        />
        <WhyStat
          testIdBase="whypanel-stat-thetavega"
          label="θ/vega"
          value={(candidate.theta / candidate.vega).toFixed(3)}
          subCaption="carry per vol-$"
        />
      </div>

      <p data-testid="whypanel-forward-edge-sentence" className="m-0 font-mono text-xs leading-[1.45] text-txt">
        {forwardEdgeSentence(candidate)}
      </p>
      <p data-testid="whypanel-event-sentence" className="m-0 font-mono text-xs leading-[1.45] text-txt">
        {eventPremiumSentence(candidate)}
      </p>
      <p data-testid="whypanel-gex-sentence" className="m-0 font-mono text-xs leading-[1.45] text-txt">
        {gexFitSentence(candidate, gex)}
      </p>
    </div>
  );
}
