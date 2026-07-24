import { Slider } from "@morai/web";

const stack = { display: "flex", flexDirection: "column", gap: 22, maxWidth: 360 } as const;
const label = { font: "600 10px 'Space Grotesk', system-ui", letterSpacing: "0.09em", textTransform: "uppercase", color: "#566273", marginBottom: 8 } as const;

/** Single-thumb: the projection-date slider on the mobile payoff dialog. */
export function Single() {
  return (
    <div style={stack}>
      <div><div style={label}>Days forward · 12</div><Slider defaultValue={[12]} min={0} max={45} /></div>
      <div><div style={label}>IV shift · +0%</div><Slider defaultValue={[50]} /></div>
    </div>
  );
}

/** Range: two thumbs bound a strike window. */
export function Range() {
  return (
    <div style={stack}>
      <div><div style={label}>Strike band · 7300 – 7700</div><Slider defaultValue={[30, 70]} /></div>
    </div>
  );
}

/** Disabled drops the whole control to 50%. */
export function Disabled() {
  return (
    <div style={stack}>
      <div><div style={label}>Days forward (locked)</div><Slider defaultValue={[20]} disabled /></div>
    </div>
  );
}
