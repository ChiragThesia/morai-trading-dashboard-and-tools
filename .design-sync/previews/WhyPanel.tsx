import { WhyPanel } from "@morai/web";
import type { PickerCandidate } from "@morai/contracts";

const CANDIDATE: PickerCandidate = {
  id: "c1", name: "7500P Jul 23 / Aug 14", score: 61,
  breakdown: [
    { criterion: "slope", weight: 40, rawValue: 0.253841, contribution: 42.31 },
    { criterion: "fwdEdge", weight: 25, rawValue: 0.1, contribution: 30 },
    { criterion: "gexFit", weight: 15, rawValue: 1, contribution: 100 },
    { criterion: "eventAdjustment", weight: 10, rawValue: 0, contribution: 0 },
    { criterion: "beVsEm", weight: 10, rawValue: 0.5329, contribution: 53.29 },
  ] as PickerCandidate["breakdown"],
  debit: 4627.55, theta: 45.9, vega: 305.3, delta: 1.2, gamma: null,
  fwdIv: 0.1402, fwdIvGuard: "ok", slope: 0.253841, fwdEdge: -0.028487, expectedMove: 224.657,
  frontEvents: ["NFP"], backEvents: ["FOMC"],
  frontLeg: { strike: 7500, putCall: "P", dte: 21, iv: 0.1249 },
  backLeg: { strike: 7500, putCall: "P", dte: 43, iv: 0.1402 },
  context: [], bucket: "standard",
  exitPlan: { profitTargetPct: 0.25, stopPct: 0.175, manageShortDte: 21, closeByExpiry: "2026-07-23", thetaCapturePct: null },
};

const GEX = {
  netGammaAtSpot: -57.4,
  nearTerm: { callWall: 7600, putWall: 7450, flip: 7470 },
  flip: 7450, callWall: 7600, putWall: 7400, absGammaStrike: 7500,
};

/** Why this candidate scored what it did — every criterion with its contribution. */
export function FullBreakdown() {
  return <div style={{ maxWidth: 460 }}><WhyPanel candidate={CANDIDATE} gex={GEX} /></div>;
}

/** A weak candidate: inverted term structure and a penalised event window. */
export function WeakCandidate() {
  return (
    <div style={{ maxWidth: 460 }}>
      <WhyPanel
        candidate={{
          ...CANDIDATE, id: "c5", name: "7200P Aug 29 / Sep 30", score: 22, fwdIv: null, fwdIvGuard: "inverted",
          breakdown: [
            { criterion: "slope", weight: 40, rawValue: -0.760417, contribution: 0 },
            { criterion: "fwdEdge", weight: 25, rawValue: 0, contribution: 0 },
            { criterion: "gexFit", weight: 15, rawValue: 0.6, contribution: 60 },
            { criterion: "eventAdjustment", weight: 10, rawValue: 0.5, contribution: 50 },
            { criterion: "beVsEm", weight: 10, rawValue: 0, contribution: 0 },
          ] as PickerCandidate["breakdown"],
        }}
        gex={GEX}
      />
    </div>
  );
}

/** Walls missing from the GEX snapshot — the panel omits them rather than guessing. */
export function DegradedGex() {
  return (
    <div style={{ maxWidth: 460 }}>
      <WhyPanel candidate={CANDIDATE} gex={{ netGammaAtSpot: -12.1, nearTerm: {} }} />
    </div>
  );
}
