import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { scaleLinear, scalePoint } from "@visx/scale";
import { LinearGradient } from "@visx/gradient";
import { Group } from "@visx/group";

/**
 * EquityCurve — P&L equity curve chart for the Overview P&L card.
 *
 * Renders a visx `AreaClosed` + `LinePath` equity curve:
 *   - Coral line (#ef5350) when cumulative P&L is negative
 *   - Teal line (#26a69a) when cumulative P&L is positive
 *   - Area fill with matching gradient (10% opacity)
 *
 * Data: array of daily P&L values (cumulative running P&L preferred, or
 * daily deltas that this component accumulates).
 *
 * UI-SPEC "P&L card": equity curve SVG below the realized P&L figure.
 * Chart library: visx (locked by UI-SPEC — Equity curve uses visx).
 */

interface EquityCurveProps {
  /** Series of P&L data points (cumulative or daily delta) */
  data: ReadonlyArray<number>;
  /** Chart width in pixels */
  width?: number;
  /** Chart height in pixels */
  height?: number;
}

export function EquityCurve({
  data,
  width = 200,
  height = 60,
}: EquityCurveProps): React.ReactElement | null {
  if (data.length < 2) return null;

  const margin = { top: 4, right: 4, bottom: 4, left: 4 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Compute cumulative running P&L
  let running = 0;
  const cumulative = data.map((v) => {
    running += v;
    return running;
  });

  const finalValue = cumulative[cumulative.length - 1] ?? 0;
  const isNegative = finalValue < 0;

  const lineColor = isNegative ? "#ef5350" : "#26a69a";
  const gradientId = `equity-grad-${isNegative ? "neg" : "pos"}`;

  const minVal = Math.min(...cumulative);
  const maxVal = Math.max(...cumulative);
  // Ensure y scale has some room even if all values are equal
  const yPad = Math.max(Math.abs(maxVal - minVal) * 0.1, 1);

  const xScale = scalePoint({
    domain: cumulative.map((_, i) => i),
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
      aria-label="Equity curve"
      role="img"
      style={{ overflow: "visible" }}
    >
      <LinearGradient
        id={gradientId}
        from={lineColor}
        to={lineColor}
        fromOpacity={0.15}
        toOpacity={0}
        vertical
      />
      <Group left={margin.left} top={margin.top}>
        {/* Area fill */}
        <AreaClosed
          data={cumulative}
          x={getX}
          y={getY}
          yScale={yScale}
          curve={curveMonotoneX}
          fill={`url(#${gradientId})`}
        />
        {/* Line */}
        <LinePath
          data={cumulative}
          x={getX}
          y={getY}
          curve={curveMonotoneX}
          stroke={lineColor}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Group>
    </svg>
  );
}
