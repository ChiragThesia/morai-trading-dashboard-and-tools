import { MiniLine } from "@morai/web";

const TERM = [12.49, 12.88, 13.21, 13.60, 13.94, 14.02, 14.31, 14.55];
const INVERTED = [16.80, 15.92, 15.10, 14.44, 14.02, 13.71, 13.55, 13.48];

const label = { font: "600 10px 'Space Grotesk', system-ui", letterSpacing: "0.09em", textTransform: "uppercase", color: "#566273", marginBottom: 4 } as const;

/** The term-structure sparkline that sits next to a calendar's IV numbers. */
export function TermStructure() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div><div style={label}>Contango — front cheap to back</div><MiniLine data={TERM} label="SPX term structure" /></div>
      <div><div style={label}>Backwardation — the guard case</div><MiniLine data={INVERTED} color="#ef5350" label="Inverted term structure" /></div>
    </div>
  );
}

/** Colour and size are caller-owned — the same sparkline at three scales. */
export function Sizes() {
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-end" }}>
      <MiniLine data={TERM} width={80} height={24} color="#22d3ee" label="small" />
      <MiniLine data={TERM} width={160} height={40} color="#a78bfa" label="medium" />
      <MiniLine data={TERM} width={280} height={64} color="#26a69a" label="large" />
    </div>
  );
}
