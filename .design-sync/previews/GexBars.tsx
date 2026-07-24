import { GexBars } from "@morai/web";

const STRIKES = Array.from({ length: 33 }, (_, i) => {
  const k = 7200 + i * 25;
  const d = k - 7482;
  const gex = Math.round((Math.exp(-((d / 180) ** 2)) * (d > 0 ? 46 : -38) + (k === 7600 ? 34 : 0) + (k === 7400 ? -29 : 0)) * 10) / 10;
  return {
    k,
    gex,
    coi: Math.round(6200 * Math.exp(-((d / 220) ** 2)) + (k === 7600 ? 5400 : 0)),
    poi: Math.round(5800 * Math.exp(-((d / 210) ** 2)) + (k === 7400 ? 6100 : 0)),
    vol: Math.round(2400 * Math.exp(-((d / 150) ** 2))),
  };
});

/** The default chart with its GEX / OI wall / Volume tab picker. */
export function WithModePicker() {
  return <div style={{ width: 680 }}><GexBars strikes={STRIKES} spot={7482} callWall={7600} putWall={7400} /></div>;
}

/** `mode` locks one metric and removes the picker — how the Market grid tiles it. */
export function LockedModes() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, width: 680 }}>
      <GexBars strikes={STRIKES} spot={7482} callWall={7600} putWall={7400} mode="gex" height={200} />
      <GexBars strikes={STRIKES} spot={7482} callWall={7600} putWall={7400} mode="oi" height={200} />
      <GexBars strikes={STRIKES} spot={7482} callWall={7600} putWall={7400} mode="volume" height={200} />
    </div>
  );
}

/** `range` narrows the strike window to ATM ± N strikes. */
export function StrikeWindow() {
  return <div style={{ width: 680 }}><GexBars strikes={STRIKES} spot={7482} callWall={7600} putWall={7400} mode="gex" range={10} /></div>;
}

/** No dominant walls in the book — the reference lines are omitted, never guessed. */
export function NoWalls() {
  return <div style={{ width: 680 }}><GexBars strikes={STRIKES} spot={7482} callWall={null} putWall={null} mode="gex" /></div>;
}
