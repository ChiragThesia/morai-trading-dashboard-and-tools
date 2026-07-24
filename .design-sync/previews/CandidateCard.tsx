import type { BreakdownEntry, PickerCandidate } from "@morai/contracts";
import { CandidateCard } from "@morai/web";

// Snapshot-level fields — identical across every card in one fetch. A fixed past
// instant keeps the freshness dot deterministic (always the stale branch).
const SNAPSHOT = {
  observedAt: "2026-07-02T14:32:00.000Z",
  source: "schwab" as const,
  gexContextStatus: "ok" as const,
  eventsContextStatus: "ok" as const,
};

const BREAKDOWN: BreakdownEntry[] = [
  { criterion: "slope", weight: 40, rawValue: 0.253841, contribution: 42.31 },
  { criterion: "fwdEdge", weight: 25, rawValue: 0.1, contribution: 30 },
  { criterion: "gexFit", weight: 15, rawValue: 1, contribution: 100 },
  { criterion: "eventAdjustment", weight: 10, rawValue: 0, contribution: 0 },
  { criterion: "beVsEm", weight: 10, rawValue: 0.5329, contribution: 53.29 },
];

function candidate(over: Partial<PickerCandidate> = {}): PickerCandidate {
  return {
    id: "cand-1",
    name: "7500P Jul 23 / Aug 14",
    score: 61,
    breakdown: BREAKDOWN,
    debit: 4627.55,
    theta: 45.9,
    vega: 305.3,
    delta: 1.2,
    gamma: null,
    fwdIv: 0.1402,
    fwdIvGuard: "ok",
    slope: 0.253841,
    fwdEdge: -0.028487,
    expectedMove: 224.657,
    frontEvents: ["NFP", "CPI"],
    backEvents: ["FOMC"],
    frontLeg: { strike: 7500, putCall: "P", dte: 21, iv: 0.1249 },
    backLeg: { strike: 7500, putCall: "P", dte: 43, iv: 0.1402 },
    context: [],
    bucket: "standard",
    exitPlan: {
      profitTargetPct: 0.25,
      stopPct: 0.175,
      manageShortDte: 21,
      closeByExpiry: "2026-07-23",
      thetaCapturePct: null,
    },
    ...over,
  };
}

const noop = () => {};

function Rail({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>{children}</div>;
}

/** The default rail card: header + score, sub-line, and the 4 breakdown bars. */
export function Default() {
  return (
    <Rail>
      <CandidateCard
        candidate={candidate()}
        selected={false}
        combined={false}
        copied={false}
        onSelect={noop}
        onToggleCombine={noop}
        onCopy={noop}
        {...SNAPSHOT}
      />
    </Rail>
  );
}

/** The three interaction states the rail drives: selected, combined (⊕), and just-copied. */
export function States() {
  return (
    <Rail>
      <CandidateCard
        candidate={candidate({ id: "sel", name: "7400P Aug 15 / Sep 19", score: 54 })}
        selected
        combined={false}
        copied={false}
        onSelect={noop}
        onToggleCombine={noop}
        onCopy={noop}
        {...SNAPSHOT}
      />
      <CandidateCard
        candidate={candidate({ id: "comb", name: "7600C Jul 31 / Sep 05", score: 48 })}
        selected={false}
        combined
        copied={false}
        onSelect={noop}
        onToggleCombine={noop}
        onCopy={noop}
        {...SNAPSHOT}
      />
      <CandidateCard
        candidate={candidate({ id: "cop", name: "7300P Sep 19 / Oct 17", score: 41 })}
        selected={false}
        combined={false}
        copied
        onSelect={noop}
        onToggleCombine={noop}
        onCopy={noop}
        {...SNAPSHOT}
      />
    </Rail>
  );
}

/**
 * Guard cases — the bars must go zero-width with an "n/a" caption, never NaN:
 * an inverted term structure (fwdIv null) and a degraded GEX/events context.
 */
export function GuardedBars() {
  return (
    <Rail>
      <CandidateCard
        candidate={candidate({
          id: "inv",
          name: "7200P Aug 29 / Sep 30",
          score: 22,
          fwdIv: null,
          fwdIvGuard: "inverted",
          breakdown: [
            { criterion: "slope", weight: 40, rawValue: -0.760417, contribution: 0 },
            { criterion: "fwdEdge", weight: 25, rawValue: 0, contribution: 0 },
            { criterion: "gexFit", weight: 15, rawValue: 0.6, contribution: 60 },
            { criterion: "eventAdjustment", weight: 10, rawValue: 0.5, contribution: 50 },
            { criterion: "beVsEm", weight: 10, rawValue: 0, contribution: 0 },
          ],
        })}
        selected={false}
        combined={false}
        copied={false}
        onSelect={noop}
        onToggleCombine={noop}
        onCopy={noop}
        {...SNAPSHOT}
        gexContextStatus="stale"
        eventsContextStatus="missing"
      />
    </Rail>
  );
}

/** `bucket="event-calendar"` labels the short-gap universe that deliberately owns an event. */
export function EventCalendar() {
  return (
    <Rail>
      <CandidateCard
        candidate={candidate({
          id: "evt",
          name: "7500P Jul 29 / Aug 02",
          score: 38,
          bucket: "event-calendar",
          frontEvents: ["FOMC"],
          backEvents: [],
        })}
        selected={false}
        combined={false}
        copied={false}
        onSelect={noop}
        onToggleCombine={noop}
        onCopy={noop}
        {...SNAPSHOT}
      />
    </Rail>
  );
}

/** A user-pasted calendar: "PASTED" pill instead of a score, no greeks, removable. */
export function Pasted() {
  return (
    <Rail>
      <CandidateCard
        candidate={candidate({ id: "pasted", name: "7450P Aug 08 / Sep 12", theta: 0, vega: 0 })}
        selected={false}
        combined={false}
        copied={false}
        pasted
        onSelect={noop}
        onToggleCombine={noop}
        onCopy={noop}
        onRemove={noop}
        {...SNAPSHOT}
      />
    </Rail>
  );
}
