import { EquityCurve } from "@morai/web";

const WINNING = [0, 120, 95, 240, 310, 285, 430, 520, 495, 610, 780, 742, 910, 1050, 1284];
const DRAWDOWN = [0, -80, -140, -95, -260, -340, -290, -410, -520, -470, -610, -735, -680, -820, -905];
const CHOPPY = [0, 210, -60, 180, -140, 90, -220, 40, 160, -80, 120, 260, 70, 190, 310];

const label = { font: "600 10px 'Space Grotesk', system-ui", letterSpacing: "0.09em", textTransform: "uppercase", color: "#566273", marginBottom: 6 } as const;

/** Cumulative book P&L, the shape the Journal header shows. */
export function Cumulative() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div><div style={label}>Up 15 sessions · +$1 284</div><EquityCurve data={WINNING} /></div>
      <div><div style={label}>Drawdown · −$905</div><EquityCurve data={DRAWDOWN} /></div>
      <div><div style={label}>Chop · +$310</div><EquityCurve data={CHOPPY} /></div>
    </div>
  );
}

/** Explicit width/height for the compact rail slot. */
export function Compact() {
  return <EquityCurve data={WINNING} width={220} height={60} />;
}
