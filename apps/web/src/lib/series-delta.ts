/**
 * series-delta — trend deltas for the Market-regime rail and COT card (2026-07-16).
 *
 * Pure derivation from the macro history the client already fetches (useMacro): each
 * metric's change vs its PRIOR observation, so the rail shows direction, not just level.
 * Honesty rules (catch #26 lineage): fewer than 2 observations, no shared dates, or a
 * zero denominator/prev → null — a missing chip, never a fabricated one.
 *
 * Formatting is unit-appropriate, not one-size % (a "% change" of a ratio or a rate
 * misleads): ratios show raw Δ, vol levels show %, rates/spreads show basis points.
 */

export interface SeriesPoint {
  readonly time: string;
  readonly value: number;
}

export interface Delta {
  readonly prev: number;
  readonly latest: number;
  readonly delta: number;
  /** Date of the prev observation — "vs {vsDate}" in tooltips. */
  readonly vsDate: string;
}

/** Delta from the last two observations of one series. Null under 2 points. */
export function seriesDelta(points: ReadonlyArray<SeriesPoint> | undefined): Delta | null {
  if (points === undefined || points.length < 2) return null;
  const latest = points[points.length - 1];
  const prev = points[points.length - 2];
  if (latest === undefined || prev === undefined) return null;
  return { prev: prev.value, latest: latest.value, delta: latest.value - prev.value, vsDate: prev.time };
}

/**
 * Delta of a ratio series (e.g. VIX/VIX3M) computed at the last two dates BOTH series
 * observed — never a ratio across mismatched dates. Null on <2 shared dates or a zero
 * denominator at either date.
 */
export function ratioDelta(
  numerator: ReadonlyArray<SeriesPoint> | undefined,
  denominator: ReadonlyArray<SeriesPoint> | undefined,
): Delta | null {
  if (numerator === undefined || denominator === undefined) return null;
  const denByDate = new Map(denominator.map((p) => [p.time, p.value]));
  const shared: SeriesPoint[] = [];
  for (const p of numerator) {
    const den = denByDate.get(p.time);
    if (den === undefined || den === 0) continue;
    shared.push({ time: p.time, value: p.value / den });
  }
  return seriesDelta(shared);
}

export type DeltaKind = "level-pct" | "bp" | "ratio";

/** Arrow + unit-appropriate magnitude; flat renders "· 0{unit}" so unchanged is explicit. */
export function formatDelta(kind: DeltaKind, d: Delta): string {
  const arrow = d.delta > 0 ? "▲" : d.delta < 0 ? "▼" : "·";
  switch (kind) {
    case "level-pct": {
      if (d.prev === 0) return "";
      const pct = (Math.abs(d.delta) / Math.abs(d.prev)) * 100;
      return `${arrow}${pct.toFixed(1)}%`;
    }
    case "bp": {
      const bp = Math.abs(d.delta) * 100;
      return `${arrow}${d.delta === 0 ? " 0bp" : `${Math.round(bp)}bp`}`;
    }
    case "ratio":
      return `${arrow}${d.delta === 0 ? " 0.00" : Math.abs(d.delta).toFixed(2)}`;
  }
}

/** COT week-over-week change as a percent of |prev net|, one decimal. Null when prev is 0. */
export function pctOfPrev(change: number, prev: number): string | null {
  if (prev === 0) return null;
  return `${((Math.abs(change) / Math.abs(prev)) * 100).toFixed(1)}%`;
}

/** Compact magnitude: 1.98M / 756K / 421. Unsigned. (Shared with CotCard's rows.) */
export function fmtMag(abs: number): string {
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${Math.round(abs / 1_000)}K`;
  return String(abs);
}
