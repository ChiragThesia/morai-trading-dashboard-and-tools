import { LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { scaleLinear, scalePoint } from "@visx/scale";
import { Group } from "@visx/group";

/**
 * MiniLine — small visx line chart for term structure and skew mini charts.
 *
 * Used by:
 *   - Overview: Volatility card (term structure cyan, skew violet minis)
 *   - Positions: Greeks vs spot strips (reused by Plan 07)
 *
 * Visual spec from UI-SPEC: small chart panels, color specified per use case.
 * Default color: cyan (#22d3ee) for term structure, violet (#a78bfa) for skew.
 *
 * Chart library: visx (locked by UI-SPEC — term/skew minis use visx).
 */

interface MiniLineProps {
  /** Series of y-values (x is uniform interval) */
  data: ReadonlyArray<number>;
  /** Line color — default cyan for term structure */
  color?: string;
  /** Chart width in pixels */
  width?: number;
  /** Chart height in pixels */
  height?: number;
  /** ARIA label for accessibility */
  label?: string;
}

export function MiniLine({
  data,
  color = "#22d3ee",
  width = 80,
  height = 40,
  label = "Mini line chart",
}: MiniLineProps): React.ReactElement | null {
  if (data.length < 2) return null;

  const margin = { top: 3, right: 3, bottom: 3, left: 3 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const minVal = Math.min(...data);
  const maxVal = Math.max(...data);
  const yPad = Math.max(Math.abs(maxVal - minVal) * 0.1, 0.1);

  const xScale = scalePoint({
    domain: data.map((_, i) => i),
    range: [0, innerWidth],
    padding: 0,
  });

  const yScale = scaleLinear({
    domain: [minVal - yPad, maxVal + yPad],
    range: [innerHeight, 0],
    nice: true,
  });

  const getX = (_: number, i: number): number => xScale(i) ?? 0;
  const getY = (v: number): number => yScale(v);

  return (
    <svg
      width={width}
      height={height}
      aria-label={label}
      role="img"
      style={{ overflow: "visible" }}
    >
      <Group left={margin.left} top={margin.top}>
        <LinePath
          data={[...data]}
          x={getX}
          y={getY}
          curve={curveMonotoneX}
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Group>
    </svg>
  );
}
