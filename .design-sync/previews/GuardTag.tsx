// GuardTag reads recharts' useXAxisScale/useYAxisScale/usePlotArea and returns null
// outside a chart — so its only true render is inside TermStructureChart. The amber
// "guard" tag appears on the Backwardation cell, where the term structure is inverted.
import { TermStructureChart } from "@morai/web";
import type { PickerCandidate } from "@morai/contracts";

const TERM = [
  { dte: 4, iv: 0.1712 }, { dte: 11, iv: 0.1305 }, { dte: 21, iv: 0.1249 },
  { dte: 32, iv: 0.1338 }, { dte: 43, iv: 0.1402 }, { dte: 60, iv: 0.1471 },
  { dte: 88, iv: 0.1520 }, { dte: 120, iv: 0.1566 },
];

const INVERTED = TERM.map((p, i) => ({ dte: p.dte, iv: 0.1880 - i * 0.0062 }));

const EVENTS = [
  { date: "2026-08-01", name: "NFP" },
  { date: "2026-08-12", name: "CPI" },
  { date: "2026-09-16", name: "FOMC" },
];

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

/** The IV curve with the candidate's two legs pinned and event chips beneath. */
export function Contango() {
  return <div style={{ width: 620 }}><TermStructureChart termStructure={TERM} events={EVENTS} asOf="2026-07-24" candidate={CANDIDATE} /></div>;
}

/** Backwardation — the guard case a calendar must not be sold into. */
export function Backwardation() {
  return (
    <div style={{ width: 620 }}>
      <TermStructureChart termStructure={INVERTED} events={EVENTS} asOf="2026-07-24" candidate={{ ...CANDIDATE, fwdIv: null, fwdIvGuard: "inverted" }} />
    </div>
  );
}

/** No scheduled events in the window. */
export function NoEvents() {
  return <div style={{ width: 620 }}><TermStructureChart termStructure={TERM} events={[]} asOf="2026-07-24" candidate={CANDIDATE} /></div>;
}
