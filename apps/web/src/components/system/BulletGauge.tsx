import { cn } from "@/lib/utils";

/**
 * BulletGauge — the shared bullet-gauge track (39-01, GAUGE-01). Extracted from
 * RegimeBoard's `Row` so the rates block (39-02) and COT block (39-03) can render the
 * identical track without duplicating the meter markup or the clamp math. Presentational
 * only — the caller supplies the axis, value, band edges (banded variant only), and the
 * marker color; this component owns the DOM + clamp math and nothing else.
 */

/** Percent position of `value` on `[min, max]` — NOT clamped. Only `clampedAxisPct` (below)
 *  is safe for on-track positioning (marker, band segments); raw output can fall outside
 *  [0, 100] when `value` is outside `[min, max]`. */
function axisPct(value: number, min: number, max: number): number {
  return ((value - min) / (max - min)) * 100;
}

/** Clamped percent position — used for the marker and band segments, so a value outside
 *  the visual axis still pins to an axis end instead of overflowing the track. */
function clampedAxisPct(value: number, min: number, max: number): number {
  return Math.min(100, Math.max(0, axisPct(value, min, max)));
}

export type BulletGaugeVariant = "banded" | "neutral";

export type BulletGaugeProps = {
  min: number;
  max: number;
  /** True, unclamped value — only used for positioning math; the printed numeric value on
   *  the caller's own value line is never clamped. */
  value: number;
  variant: BulletGaugeVariant;
  /** Required when `variant === "banded"` — narrowed via an explicit runtime branch below,
   *  never `!` (typescript.md). */
  bandWarn?: number;
  bandCrisis?: number;
  /** Caller-computed Tailwind `bg-*` class for the marker. */
  markerColorClass: string;
  ariaLabel: string;
  /** True, unclamped value/state text for AT users — rendered verbatim. */
  ariaValueText: string;
  testId: string;
  markerTestId: string;
};

export function BulletGauge({
  min,
  max,
  value,
  variant,
  bandWarn,
  bandCrisis,
  markerColorClass,
  ariaLabel,
  ariaValueText,
  testId,
  markerTestId,
}: BulletGaugeProps): React.ReactElement {
  // WR-01: aria-valuenow must stay within [aria-valuemin, aria-valuemax] per the meter role
  // contract. aria-valuetext (passed in) still carries the true, unclamped value for AT users.
  const clampedValue = Math.min(max, Math.max(min, value));
  const valuePct = clampedAxisPct(value, min, max);

  let bands: React.ReactElement | null = null;
  switch (variant) {
    case "banded": {
      if (bandWarn === undefined || bandCrisis === undefined) {
        throw new Error('BulletGauge: bandWarn/bandCrisis are required when variant is "banded"');
      }
      // Clamped like the marker (CR-01): an out-of-axis bandWarn/bandCrisis must never
      // produce a negative CSS width — it saturates at the axis edge instead.
      const warnPct = clampedAxisPct(bandWarn, min, max);
      const crisisPct = clampedAxisPct(bandCrisis, min, max);
      bands = (
        <>
          <div
            className="absolute inset-y-0 bg-amber/30"
            style={{ left: `${warnPct}%`, width: `${crisisPct - warnPct}%` }}
          />
          <div
            className="absolute inset-y-0 bg-down/30"
            style={{ left: `${crisisPct}%`, width: `${100 - crisisPct}%` }}
          />
        </>
      );
      break;
    }
    case "neutral":
      bands = null;
      break;
  }

  return (
    <div
      role="meter"
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-line2"
      aria-valuenow={clampedValue}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={ariaValueText}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {bands}
      <div
        className={cn(
          "absolute top-1/2 h-2.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full",
          markerColorClass,
        )}
        style={{ left: `${valuePct}%` }}
        data-testid={markerTestId}
      />
    </div>
  );
}
