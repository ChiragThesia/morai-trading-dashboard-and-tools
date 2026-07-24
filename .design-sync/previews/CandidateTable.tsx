import { CandidateTable } from "@morai/web";
import type { PickerCandidate } from "@morai/contracts";

const BREAKDOWN = [
  { criterion: "slope", weight: 40, rawValue: 0.253841, contribution: 42.31 },
  { criterion: "fwdEdge", weight: 25, rawValue: 0.1, contribution: 30 },
  { criterion: "gexFit", weight: 15, rawValue: 1, contribution: 100 },
  { criterion: "eventAdjustment", weight: 10, rawValue: 0, contribution: 0 },
  { criterion: "beVsEm", weight: 10, rawValue: 0.5329, contribution: 53.29 },
] as PickerCandidate["breakdown"];

function cand(id: string, name: string, score: number, debit: number, theta: number, over: Partial<PickerCandidate> = {}): PickerCandidate {
  return {
    id, name, score, breakdown: BREAKDOWN, debit, theta, vega: 305.3, delta: 1.2, gamma: null,
    fwdIv: 0.1402, fwdIvGuard: "ok", slope: 0.253841, fwdEdge: -0.028487, expectedMove: 224.657,
    frontEvents: ["NFP"], backEvents: ["FOMC"],
    frontLeg: { strike: 7500, putCall: "P", dte: 21, iv: 0.1249 },
    backLeg: { strike: 7500, putCall: "P", dte: 43, iv: 0.1402 },
    context: [], bucket: "standard",
    exitPlan: { profitTargetPct: 0.25, stopPct: 0.175, manageShortDte: 21, closeByExpiry: "2026-07-23", thetaCapturePct: null },
    ...over,
  };
}

const CANDIDATES = [
  cand("c1", "7500P 2026-07-23 / 2026-08-14", 61, 4627.55, 45.9),
  cand("c2", "7400P 2026-08-15 / 2026-09-19", 54, 3910.0, 38.2),
  cand("c3", "7600C 2026-07-31 / 2026-09-05", 48, 5204.75, 61.4),
  cand("c4", "7300P 2026-09-19 / 2026-10-17", 41, 2885.2, 22.7),
  cand("c5", "7200P 2026-08-29 / 2026-09-30", 22, 2110.0, 18.4, { fwdIv: null, fwdIvGuard: "inverted" }),
];

const base = {
  candidates: CANDIDATES,
  pastedCandidates: [],
  selectedId: "c1",
  combinedIds: new Set<string>(),
  sort: { key: "score", dir: "desc" } as const,
  onSortChange: () => {},
  onSelect: () => {},
  onToggleCombine: () => {},
  onRemovePasted: () => {},
  wrapperClassName: "overflow-x-auto",
};

/** The ranked rail: sorted by score, the selected row marked, ISO names shortened. */
export function Ranked() {
  return <div style={{ width: 720 }}><CandidateTable {...base} /></div>;
}

/** Sorted by θ instead — the header glyph follows `sort`, the caller does the sorting. */
export function SortedByTheta() {
  return <div style={{ width: 720 }}><CandidateTable {...base} sort={{ key: "theta", dir: "desc" }} /></div>;
}

/** Two candidates combined for the ⊕ overlay. */
export function Combined() {
  return <div style={{ width: 720 }}><CandidateTable {...base} combinedIds={new Set(["c2", "c3"])} /></div>;
}

/** A pasted calendar pinned above the engine rows, with its own × remove. */
export function WithPasted() {
  return (
    <div style={{ width: 720 }}>
      <CandidateTable {...base} pastedCandidates={[cand("pasted", "7450P 2026-08-08 / 2026-09-12", 0, 3300, 0)]} selectedId="pasted" />
    </div>
  );
}

/** Empty rail — before the first compute-picker cycle lands. */
export function Empty() {
  return <div style={{ width: 720 }}><CandidateTable {...base} candidates={[]} selectedId="" /></div>;
}
