import { PositionCard } from "@morai/web";

const ROW = {
  key: "$SPX|7425|P",
  label: "7425P",
  expiry: { line1: "Aug 8 → Aug 30", line2: "12d/34d · 22d wide" },
  legs: [
    { occSymbol: "SPXW  260807P07425000", putCall: "P", longQty: 0, shortQty: 1, averagePrice: 50, marketValue: -5000, underlyingSymbol: "$SPX" },
    { occSymbol: "SPXW  260830P07425000", putCall: "P", longQty: 1, shortQty: 0, averagePrice: 60, marketValue: 6000, underlyingSymbol: "$SPX" },
  ],
};

const LIVE_GREEKS = new Map([
  ["SPXW  260807P07425000", { occSymbol: "SPXW  260807P07425000", mark: 48.2, bsmIv: 0.1249, bsmDelta: -0.31, bsmGamma: 0.0009, bsmTheta: -3.9, bsmVega: 5.2, ts: "2026-07-24T14:32:00.000Z", bid: 47.8, ask: 48.6 }],
  ["SPXW  260830P07425000", { occSymbol: "SPXW  260830P07425000", mark: 62.4, bsmIv: 0.1402, bsmDelta: -0.33, bsmGamma: 0.0006, bsmTheta: -2.1, bsmVega: 9.7, ts: "2026-07-24T14:32:00.000Z", bid: 62.0, ask: 62.8 }],
]);

const VERDICT_HOLD = {
  calendarId: "cal-hold", name: "SPX 30AUG/07AUG 7425P", strike: 7425, optionType: "P",
  verdict: "HOLD", rung: null, ruleId: "hold",
  metric: { name: "pnlPct", value: 0.02, threshold: 0 },
  indicative: false, changed: false, escalate: false, pnlPct: 0.02,
  basis: { openNetDebit: 480, netMark: 490 }, roll: null,
};

const VERDICT_TAKE = {
  ...VERDICT_HOLD, calendarId: "cal-take", verdict: "TAKE", ruleId: "profit-target",
  metric: { name: "pnlPct", value: 0.27, threshold: 0.25 }, pnlPct: 0.27,
  basis: { openNetDebit: 480, netMark: 610 }, changed: true,
};

const base = {
  row: ROW,
  spot: 7482,
  liveGreeks: LIVE_GREEKS,
  ivNa: false,
  verdict: null,
  marketSession: "rth" as const,
  expanded: false,
  onSelect: () => {},
  included: true,
  onToggleIncluded: () => {},
  verdictObservedAt: null,
};

function Rail({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 460 }}>{children}</div>;
}

/** Collapsed, live marks flowing — the default Overview row. */
export function Collapsed() {
  return <Rail><PositionCard {...base} /></Rail>;
}

/** Expanded: per-leg detail with the live BSM greeks. */
export function Expanded() {
  return <Rail><PositionCard {...base} expanded /></Rail>;
}

/** With an exit verdict attached — HOLD stays neutral, TAKE turns the card actionable. */
export function Verdicts() {
  return (
    <Rail>
      <PositionCard {...base} verdict={VERDICT_HOLD} verdictObservedAt="2026-07-24T14:30:00.000Z" />
      <PositionCard {...base} verdict={VERDICT_TAKE} verdictObservedAt="2026-07-24T14:30:00.000Z" />
    </Rail>
  );
}

/** After hours with no IV: the card must dim, never print a fabricated greek. */
export function AfterHoursNoIv() {
  return <Rail><PositionCard {...base} liveGreeks={new Map()} ivNa marketSession="after-hours" /></Rail>;
}

/** Excluded from the payoff selection — the include toggle is off. */
export function Excluded() {
  return <Rail><PositionCard {...base} included={false} /></Rail>;
}
