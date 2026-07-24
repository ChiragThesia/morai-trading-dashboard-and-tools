import { EntryExitPlan } from "@morai/web";
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

/** The plan with a normal-VIX sizing recommendation. */
export function NormalVix() {
  return (
    <div style={{ maxWidth: 460 }}>
      <EntryExitPlan candidate={CANDIDATE} sizing={{ tier: "normal", contracts: 2, vix: 17.17 }} />
    </div>
  );
}

/** Crisis tier cuts size hard; elevated sits between. */
export function SizingTiers() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 460 }}>
      <EntryExitPlan candidate={CANDIDATE} sizing={{ tier: "low", contracts: 3, vix: 12.4 }} />
      <EntryExitPlan candidate={CANDIDATE} sizing={{ tier: "elevated", contracts: 1, vix: 24.8 }} />
      <EntryExitPlan candidate={CANDIDATE} sizing={{ tier: "crisis", contracts: 1, vix: 38.2 }} />
    </div>
  );
}

/** No sizing in the snapshot — "No recommendation", never a fabricated contract count. */
export function NoRecommendation() {
  return <div style={{ maxWidth: 460 }}><EntryExitPlan candidate={CANDIDATE} /></div>;
}

/** A theta-capture exit plan instead of a fixed profit target. */
export function ThetaCaptureExit() {
  return (
    <div style={{ maxWidth: 460 }}>
      <EntryExitPlan
        candidate={{ ...CANDIDATE, exitPlan: { ...CANDIDATE.exitPlan, profitTargetPct: null, thetaCapturePct: 0.6 } }}
        sizing={{ tier: "normal", contracts: 2, vix: 17.17 }}
      />
    </div>
  );
}
