import { PayoffChartMarks } from "@morai/web";

// PayoffChartMarks emits SVG children — it only renders inside an <svg>. The chart
// normally supplies the scale; here it is the same plain closure buildXScale returns.
const DOMAIN = { min: 7100, max: 7700 };
const WIDTH = 700;
const xScale = (v: number) => ((v - DOMAIN.min) / (DOMAIN.max - DOMAIN.min)) * WIDTH;

const base = {
  xScale,
  innerWidth: WIDTH,
  zeroY: 120,
  domain: DOMAIN,
  expectedMoveBand: { spot: 7482, em: 224.66 },
  beTodayStrikes: [7318, 7549],
  beExpStrikes: [7247, 7638],
  gex: { callWall: 7600, putWall: 7400, flip: 7450 },
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg width={WIDTH} height={240} style={{ overflow: "visible" }}>
      <line x1={0} y1={120} x2={WIDTH} y2={120} stroke="#27313f" />
      {children}
    </svg>
  );
}

/** Break-even bars, the ±1σ expected-move band, and the GEX wall pins. */
export function AllMarks() {
  return <Frame><PayoffChartMarks {...base} /></Frame>;
}

/** No GEX context — the wall pins drop out, the BE bars stay. */
export function WithoutWalls() {
  return <Frame><PayoffChartMarks {...base} gex={{ callWall: null, putWall: null, flip: null }} /></Frame>;
}

/** A single break-even pair (one-sided book). */
export function SingleBreakEven() {
  return <Frame><PayoffChartMarks {...base} beTodayStrikes={[7405]} beExpStrikes={[7362]} /></Frame>;
}
