import { PayoffChart } from "@morai/web";

// A long-calendar P&L profile: peak near the short strike, decaying either side.
// sigma is in PRICE POINTS — a long calendar peaks at the short strike and decays either side.
const curve = (peak: number, sigma: number, floor: number) =>
  Array.from({ length: 61 }, (_, i) => {
    const spot = 7100 + i * 10;
    const d = (spot - 7425) / sigma;
    return { spot, pl: Math.round((peak * Math.exp(-(d * d)) + floor) * 100) / 100 };
  });

const TODAY = curve(980, 155, -260);
const EXPIRY = curve(1680, 95, -480);
const FAN = [
  { days: 7, curve: curve(1180, 140, -300) },
  { days: 14, curve: curve(1380, 125, -360) },
  { days: 21, curve: curve(1540, 110, -420) },
];
const DOMAIN = { min: 7100, max: 7700 };
const GEX = { callWall: 7600, putWall: 7400, flip: 7450 };
const TOGGLES = { showFan: true, showExpiration: true, showWalls: true, showProfitZone: true };

const base = {
  todayCurve: TODAY,
  fanCurves: FAN,
  expirationCurve: EXPIRY,
  rollCurve: null,
  gex: GEX,
  domain: DOMAIN,
  spot: 7482,
  toggles: TOGGLES,
  fitY: false,
  onFitYConsumed: () => {},
  positionSetSignature: "7425P-aug08-aug30",
  baseExpirationCurve: EXPIRY,
};

/** The full Analyzer chart: T+0, the fan, the expiration tent, GEX walls, profit zone. */
export function FullBook() {
  return <div style={{ width: 760 }}><PayoffChart {...base} /></div>;
}

/** Curves only — every overlay toggled off. */
export function CurvesOnly() {
  return (
    <div style={{ width: 760 }}>
      <PayoffChart {...base} toggles={{ showFan: false, showExpiration: false, showWalls: false, showProfitZone: false }} />
    </div>
  );
}

/** A roll overlay: the amber curve is the post-roll book beside the current one. */
export function WithRollOverlay() {
  return <div style={{ width: 760 }}><PayoffChart {...base} rollCurve={curve(1120, 170, -190)} /></div>;
}

/** ±1σ expected-move band plus a ⊕-compare candidate in dashed amber. */
export function ExpectedMoveAndCompare() {
  return (
    <div style={{ width: 760 }}>
      <PayoffChart {...base} expectedMoveBand={{ spot: 7482, em: 224.66 }} compareCurve={curve(860, 200, -210)} />
    </div>
  );
}

/** Mobile: BE pills hidden and a squarer aspect ratio. */
export function MobileAspect() {
  return <div style={{ width: 380 }}><PayoffChart {...base} showBePills={false} aspectRatio={1.25} /></div>;
}
