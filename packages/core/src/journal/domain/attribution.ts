/**
 * Per-interval P&L attribution (JRNL-01, D-01/D-05/D-06) — the phase's hero decomposition.
 *
 * Convention (locked by 22-RESEARCH.md "Code Examples" + Pitfalls 1-4 and 22-CONTEXT.md D-06;
 * do NOT relitigate):
 *   1. Interval-START greeks drive each interval's bucket (forward-Euler / sequential convention,
 *      Assumption A2) — netTheta[i]/netVega[i]/netDelta[i]/netGamma[i] describe the position AS
 *      OF the start of interval [i, i+1].
 *   2. Δt is derived from the raw `time` timestamps in FRACTIONAL DAYS, never from the
 *      integer-floored dteFront/dteBack columns (Pitfall 3 — those are flat within a trading day).
 *   3. The vega bucket blends front/back IV symmetrically: netVega[i] × Δ(mean(frontIv, backIv))
 *      × 100 (the ×100 converts a decimal-IV delta into "vol points", Pitfall 2's locked default —
 *      there is no historical per-leg vega to split against).
 *   4. pnlOpen is DOLLARS, never divided by 100 (Pitfall 1 — the ×100 in its write-path formula is
 *      the option contract multiplier, not a cents conversion).
 *   5. residual[i] is the EXACT plug: ΔpnlOpen[i] − theta[i] − vega[i] − deltaGamma[i]. This makes
 *      the accumulation identity exact by construction (see attribution.test.ts's fast-check
 *      property) — the approximation error this decomposition inherently carries is disclosed,
 *      never hidden (D-05).
 *   6. A row is a gap when spot === "0" OR any of frontIv/backIv/netDelta/netGamma/netTheta/netVega
 *      parses non-finite (Pitfall 4). An interval touching a gap row on either side is SKIPPED —
 *      no bucket is added and the cumulative does not advance across it; the gap row's own
 *      cumulatives are `null` (never zero-filled, never bridged). The first non-gap row in the
 *      series is always the accumulation baseline (all four cumulatives = 0).
 *
 * Pure domain: no I/O, no Date.now() — the caller supplies the full row array (mirrors
 * apps/web/src/lib/deriveStreamStatus.ts's "caller passes all inputs" style). This is a total
 * function: it never throws; degenerate/gap input becomes `null`/`isGap`, never NaN.
 *
 * `AttributionRow` is defined locally (a structural subset) rather than imported from
 * ../application/ports.ts's SnapshotRow — architecture-boundaries.md keeps the domain layer
 * decoupled from the application layer's port types.
 */

const MS_PER_DAY = 86_400_000;
const VEGA_TO_VOL_POINTS = 100;

/** Per-snapshot accumulated attribution output — the hero chart's per-point series shape. */
export type AttributionPoint = {
  readonly isGap: boolean;
  readonly cumTheta: number | null;
  readonly cumVega: number | null;
  readonly cumDeltaGamma: number | null;
  readonly cumResidual: number | null;
};

/** Structural input row — a subset of SnapshotRow's fields, defined locally (see header). */
export type AttributionRow = {
  readonly time: Date | string;
  readonly spot: string;
  readonly frontIv: string;
  readonly backIv: string;
  readonly netDelta: string;
  readonly netGamma: string;
  readonly netTheta: string;
  readonly netVega: string;
  readonly pnlOpen: string;
};

type CumulativeState = {
  readonly cumTheta: number;
  readonly cumVega: number;
  readonly cumDeltaGamma: number;
  readonly cumResidual: number;
};

const ZERO_CUMULATIVE: CumulativeState = {
  cumTheta: 0,
  cumVega: 0,
  cumDeltaGamma: 0,
  cumResidual: 0,
};

/**
 * A snapshot is a gap for attribution purposes when spot is the literal zero-string marker, or
 * any of its greek/IV fields parses to a non-finite number (Pitfall 4).
 */
export function isGapRow(row: AttributionRow): boolean {
  if (row.spot === "0") return true;
  return [row.frontIv, row.backIv, row.netDelta, row.netGamma, row.netTheta, row.netVega].some(
    (value) => !Number.isFinite(parseFloat(value)),
  );
}

function toEpochMs(time: Date | string): number {
  return time instanceof Date ? time.getTime() : new Date(time).getTime();
}

/** Per-interval buckets for one [prev, cur] non-gap pair (interval-start greeks convention). */
function computeInterval(
  prev: AttributionRow,
  cur: AttributionRow,
): { readonly theta: number; readonly vega: number; readonly deltaGamma: number; readonly residual: number } {
  const dt = (toEpochMs(cur.time) - toEpochMs(prev.time)) / MS_PER_DAY;
  const theta = parseFloat(prev.netTheta) * dt;

  const dSpot = parseFloat(cur.spot) - parseFloat(prev.spot);
  const deltaGamma =
    parseFloat(prev.netDelta) * dSpot + 0.5 * parseFloat(prev.netGamma) * dSpot * dSpot;

  const prevIvMean = (parseFloat(prev.frontIv) + parseFloat(prev.backIv)) / 2;
  const curIvMean = (parseFloat(cur.frontIv) + parseFloat(cur.backIv)) / 2;
  const dIv = curIvMean - prevIvMean;
  const vega = parseFloat(prev.netVega) * dIv * VEGA_TO_VOL_POINTS;

  const dPnl = parseFloat(cur.pnlOpen) - parseFloat(prev.pnlOpen);
  const residual = dPnl - theta - vega - deltaGamma;

  return { theta, vega, deltaGamma, residual };
}

/**
 * Walk the snapshot series, accumulating the per-interval theta/vega/deltaGamma/residual buckets
 * (see header for the locked convention). Gap boundaries are skipped, never bridged (D-05); the
 * first non-gap row is always the baseline (cumulatives = 0).
 */
export function computeAttributionSeries(
  rows: ReadonlyArray<AttributionRow>,
): ReadonlyArray<AttributionPoint> {
  const points: AttributionPoint[] = [];
  let carry: CumulativeState | null = null;
  let prevRow: AttributionRow | null = null;

  for (const row of rows) {
    if (isGapRow(row)) {
      points.push({ isGap: true, cumTheta: null, cumVega: null, cumDeltaGamma: null, cumResidual: null });
      prevRow = row;
      continue;
    }

    if (carry === null) {
      carry = ZERO_CUMULATIVE;
    } else if (prevRow !== null && !isGapRow(prevRow)) {
      const interval = computeInterval(prevRow, row);
      carry = {
        cumTheta: carry.cumTheta + interval.theta,
        cumVega: carry.cumVega + interval.vega,
        cumDeltaGamma: carry.cumDeltaGamma + interval.deltaGamma,
        cumResidual: carry.cumResidual + interval.residual,
      };
    }

    points.push({ isGap: false, ...carry });
    prevRow = row;
  }

  return points;
}
