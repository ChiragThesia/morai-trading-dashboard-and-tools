/**
 * PayoffChartMarks — the three genuinely-custom PayoffChart SVG marks that no
 * native Recharts primitive covers (RESEARCH D-08 / Pattern 4): the EM-band
 * ticks + connector + label, the short BE-marker bars, and the off-domain
 * KISS edge-arrow glyphs (31-01 DEFECT-1).
 *
 * Scale-driven (RESEARCH Assumption A2 fallback): closes over a plain xScale
 * function instead of reading Recharts' internal xAxisMap/yAxisMap, so it
 * renders identically whether called directly (as here, in tests) or from
 * inside a Recharts `<Customized>` layer (plan 33-06).
 *
 * Manual Math.max/min clamping is intentionally retained here — Customized
 * layers are not covered by Recharts' axis-level clipPath (RESEARCH
 * anti-pattern note) — unlike curves/axes in PayoffChart, which use
 * allowDataOverflow instead. Wall reference *lines* stay a native
 * `ReferenceLine` in PayoffChart; this component renders only the
 * off-domain glyph.
 *
 * No any/as/!.
 */

const CORAL = "#ef5350";
const BLUE = "#5b9cf6";
const TEAL = "#26a69a";
const AMBER = "#f0b429";

/**
 * KISS collision fix (31-01, DEFECT-1): fixed vertical lane per wall series
 * for the off-domain single-glyph edge arrow. Three distinct y values means
 * two arrows clamped to the same edge can never share a bounding box —
 * provable by construction, not by measurement (jsdom can't measure SVG text).
 */
export const EDGE_ARROW_LANE_Y: Record<"flip" | "call" | "put", number> = {
  flip: 8,
  call: 16,
  put: 24,
};

export type PayoffChartMarksGex = {
  readonly callWall: number | null;
  readonly putWall: number | null;
  readonly flip: number | null;
};

export interface PayoffChartMarksProps {
  /** Plain x-scale closure (e.g. buildXScale's return) — not a recharts internal (A2). */
  xScale: (value: number) => number;
  innerWidth: number;
  /** Pixel y of the zero-P&L line; the em-band connector and BE bars center on this. */
  zeroY: number;
  domain: { readonly min: number; readonly max: number };
  expectedMoveBand: { readonly spot: number; readonly em: number } | null;
  beTodayStrikes: ReadonlyArray<number>;
  beExpStrikes: ReadonlyArray<number>;
  gex: PayoffChartMarksGex | null;
}

type PinnedMarker = {
  readonly x: number;
  readonly clampedTo: "min" | "max" | null;
};

/** Edge-pin a GEX wall/flip level into the x-domain (ported from PayoffChart's pinMarker). */
function pinMarker(
  value: number,
  xScale: (v: number) => number,
  domain: { readonly min: number; readonly max: number },
): PinnedMarker {
  if (value > domain.max) {
    return { x: xScale(domain.max), clampedTo: "max" };
  }
  if (value < domain.min) {
    return { x: xScale(domain.min), clampedTo: "min" };
  }
  return { x: xScale(value), clampedTo: null };
}

function clamp(x: number, innerWidth: number): number {
  return Math.max(0, Math.min(innerWidth, x));
}

export function PayoffChartMarks({
  xScale,
  innerWidth,
  zeroY,
  domain,
  expectedMoveBand,
  beTodayStrikes,
  beExpStrikes,
  gex,
}: PayoffChartMarksProps): React.ReactElement {
  // Computed above the return (no IIFEs in JSX) — null when the band is absent.
  const emBand =
    expectedMoveBand === null
      ? null
      : {
          lowerX: clamp(xScale(expectedMoveBand.spot - expectedMoveBand.em), innerWidth),
          upperX: clamp(xScale(expectedMoveBand.spot + expectedMoveBand.em), innerWidth),
          spotX: clamp(xScale(expectedMoveBand.spot), innerWidth),
        };

  return (
    <g>
      {emBand !== null && (
        <g data-testid="em-band">
          <line
            data-testid="em-band-tick-lower"
            x1={emBand.lowerX}
            y1={zeroY - 6}
            x2={emBand.lowerX}
            y2={zeroY + 6}
            stroke={BLUE}
            strokeWidth={1.2}
          />
          <line
            data-testid="em-band-tick-upper"
            x1={emBand.upperX}
            y1={zeroY - 6}
            x2={emBand.upperX}
            y2={zeroY + 6}
            stroke={BLUE}
            strokeWidth={1.2}
          />
          <line
            data-testid="em-band-connector"
            x1={emBand.lowerX}
            y1={zeroY}
            x2={emBand.upperX}
            y2={zeroY}
            stroke={BLUE}
            strokeWidth={1}
          />
          <text
            data-testid="em-band-label"
            x={emBand.spotX}
            y={zeroY - 9}
            fill={BLUE}
            fontSize={9}
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
          >
            {"±1σ EM"}
          </text>
        </g>
      )}

      {beExpStrikes.map((x) => (
        <line
          key={`be-exp-${x}`}
          data-testid="be-marker-exp"
          x1={xScale(x)}
          y1={zeroY - 9}
          x2={xScale(x)}
          y2={zeroY + 9}
          stroke={CORAL}
          strokeWidth={2}
        />
      ))}
      {beTodayStrikes.map((x) => (
        <line
          key={`be-t0-${x}`}
          data-testid="be-marker-t0"
          x1={xScale(x)}
          y1={zeroY - 9}
          x2={xScale(x)}
          y2={zeroY + 9}
          stroke={CORAL}
          strokeWidth={2}
          opacity={0.75}
        />
      ))}

      {gex !== null &&
        (
          [
            { key: "put", value: gex.putWall, color: CORAL },
            { key: "call", value: gex.callWall, color: TEAL },
            { key: "flip", value: gex.flip, color: AMBER },
          ] as const
        ).map(({ key, value, color }) => {
          if (value === null) return null;
          const marker = pinMarker(value, xScale, domain);
          if (marker.clampedTo === null) return null;
          return (
            <text
              key={`edge-arrow-${key}`}
              x={marker.clampedTo === "max" ? marker.x - 3 : marker.x + 3}
              y={EDGE_ARROW_LANE_Y[key]}
              fill={color}
              fontSize={9}
              fontFamily="JetBrains Mono, monospace"
              textAnchor={marker.clampedTo === "max" ? "end" : "start"}
            >
              {marker.clampedTo === "max" ? "›" : "‹"}
            </text>
          );
        })}
    </g>
  );
}
