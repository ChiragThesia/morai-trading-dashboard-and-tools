/**
 * sparklinePath — build an SVG polyline `d` string from a series of values, scaled to fill
 * a width×height box.
 *
 * Screen y is inverted (higher value → higher on screen). A flat series (all equal, or a
 * single point) draws a horizontal line through the vertical middle. Every emitted point
 * lands within [0,width]×[0,height] — no overflow, no clipping surprises.
 */
export function sparklinePath(
  values: ReadonlyArray<number>,
  width: number,
  height: number,
): string {
  if (values.length === 0) return "";
  const mid = (height / 2).toFixed(1);
  if (values.length === 1) return `M0.0 ${mid}`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const stepX = width / (values.length - 1);

  return values
    .map((v, i) => {
      const x = (i * stepX).toFixed(1);
      const y = range === 0 ? mid : (height - ((v - min) / range) * height).toFixed(1);
      return `${i === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
}
