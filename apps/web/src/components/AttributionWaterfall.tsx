/**
 * AttributionWaterfall — Greek-attribution waterfall component
 *
 * UI-SPEC "Attribution waterfall":
 *   Each row: label 54px | center-anchored track bar | signed value 56px
 *   Track: #0c111a bg, 12px height (Analyzer) or 16px (Positions), center midpoint #3a4453
 *   Fill: extends left or right from center (50%) proportional to magnitude
 *   Per-row colors:
 *     spot    = blue   (#5b9cf6)
 *     theta   = amber  (#f0b429)
 *     vega-front = coral (#ef5350)
 *     vega-back  = teal  (#26a69a)
 *     residual   = dim   (#566273)
 *
 * Supports two variants:
 *   - "positions": 5-item set (spot/theta/vega-front/vega-back/residual) — single-position deep-dive
 *   - "analyzer":  4-item set (spot/theta/vega/residual) — combined book
 *
 * Reused by Plan 10 Analyzer.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type WaterfallRow = {
  readonly label: string;
  /** P&L attribution value (can be positive or negative) */
  readonly value: number;
  /** Row color (hex) */
  readonly color: string;
};

/** Pre-built Positions 5-item set row keys */
export type PositionsWaterfallData = {
  readonly spotDelta: number;
  readonly theta: number;
  readonly vegaFront: number;
  readonly vegaBack: number;
  readonly residual: number;
};

/** Pre-built Analyzer 4-item set row keys */
export type AnalyzerWaterfallData = {
  readonly spotDelta: number;
  readonly theta: number;
  readonly vega: number;
  readonly residual: number;
};

interface AttributionWaterfallBaseProps {
  /** Track height: 16px for Positions, 12px for Analyzer (UI-SPEC) */
  trackHeight?: number;
  /** Optional note text below the waterfall */
  note?: string;
}

export type AttributionWaterfallProps =
  | (AttributionWaterfallBaseProps & {
      variant: "positions";
      data: PositionsWaterfallData;
    })
  | (AttributionWaterfallBaseProps & {
      variant: "analyzer";
      data: AnalyzerWaterfallData;
    });

// ─── Row color constants (locked by UI-SPEC) ──────────────────────────────────

const ROW_COLORS = {
  spot: "#5b9cf6",
  theta: "#f0b429",
  vegaFront: "#ef5350",
  vegaBack: "#26a69a",
  vega: "#ef5350", // coral for combined vega (Analyzer)
  residual: "#566273",
} as const;

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildRows(props: AttributionWaterfallProps): ReadonlyArray<WaterfallRow> {
  if (props.variant === "positions") {
    const d = props.data;
    return [
      { label: "spot Δ", value: d.spotDelta, color: ROW_COLORS.spot },
      { label: "theta", value: d.theta, color: ROW_COLORS.theta },
      { label: "vega front", value: d.vegaFront, color: ROW_COLORS.vegaFront },
      { label: "vega back", value: d.vegaBack, color: ROW_COLORS.vegaBack },
      { label: "residual", value: d.residual, color: ROW_COLORS.residual },
    ];
  }
  const d = props.data;
  return [
    { label: "spot Δ", value: d.spotDelta, color: ROW_COLORS.spot },
    { label: "theta", value: d.theta, color: ROW_COLORS.theta },
    { label: "vega", value: d.vega, color: ROW_COLORS.vega },
    { label: "residual", value: d.residual, color: ROW_COLORS.residual },
  ];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WaterfallRowItem({
  row,
  maxAbs,
  trackHeight,
}: {
  row: WaterfallRow;
  maxAbs: number;
  trackHeight: number;
}): React.ReactElement {
  // Fill width as proportion of the half-track (capped at 50%)
  const fillPct = maxAbs > 0 ? Math.min(Math.abs(row.value) / maxAbs, 1) * 50 : 0;
  const isPositive = row.value >= 0;

  const sign = row.value > 0 ? "+" : row.value < 0 ? "−" : "";
  const absDisplay = Math.abs(row.value).toFixed(2);

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}
      data-testid={`waterfall-row-${row.label.replace(/\s+/g, "-").toLowerCase()}`}
    >
      {/* Label */}
      <div
        style={{
          width: 54,
          fontSize: 10,
          color: "#7b8696",
          fontFamily: "JetBrains Mono, monospace",
          flexShrink: 0,
          textAlign: "right",
          paddingRight: 4,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {row.label}
      </div>

      {/* Track bar */}
      <div
        style={{
          flex: 1,
          position: "relative",
          height: trackHeight,
          background: "#0c111a",
          borderRadius: 2,
        }}
      >
        {/* Center midpoint line */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 1,
            background: "#3a4453",
            transform: "translateX(-50%)",
          }}
        />
        {/* Fill bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: `${fillPct}%`,
            background: row.color,
            ...(isPositive
              ? { left: "50%" }
              : { right: "50%" }),
            borderRadius: 2,
          }}
        />
      </div>

      {/* Value */}
      <div
        style={{
          width: 56,
          fontSize: 10,
          fontFamily: "Space Grotesk, sans-serif",
          fontWeight: 600,
          color: row.color,
          textAlign: "right",
          flexShrink: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {sign}{absDisplay}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * AttributionWaterfall — renders the center-anchored bar waterfall.
 *
 * Used on:
 *   - Positions screen (variant="positions"): spot/theta/vega-front/vega-back/residual
 *   - Analyzer screen (variant="analyzer"): spot/theta/vega/residual
 */
export function AttributionWaterfall(props: AttributionWaterfallProps): React.ReactElement {
  const { trackHeight = props.variant === "positions" ? 16 : 12, note } = props;
  const rows = buildRows(props);

  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)));

  const totalSign = total > 0 ? "+" : total < 0 ? "−" : "";
  const totalDisplay = Math.abs(total).toFixed(2);

  return (
    <div data-testid="attribution-waterfall">
      {rows.map((row) => (
        <WaterfallRowItem
          key={row.label}
          row={row}
          maxAbs={maxAbs}
          trackHeight={trackHeight}
        />
      ))}

      {/* Total row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginTop: 4,
          paddingTop: 4,
          borderTop: "1px solid #27313f",
        }}
        data-testid="waterfall-total-row"
      >
        <div
          style={{
            width: 54,
            fontSize: 10,
            color: "#d6dbe4",
            fontFamily: "JetBrains Mono, monospace",
            fontWeight: 600,
            textAlign: "right",
            paddingRight: 4,
          }}
        >
          total
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            width: 56,
            fontSize: 10,
            fontFamily: "Space Grotesk, sans-serif",
            fontWeight: 600,
            color: total >= 0 ? "#26a69a" : "#ef5350",
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {totalSign}{totalDisplay}
        </div>
      </div>

      {/* Note text */}
      {note !== undefined && (
        <p
          style={{
            fontSize: 10,
            color: "#566273",
            fontFamily: "JetBrains Mono, monospace",
            marginTop: 8,
            lineHeight: 1.4,
          }}
          data-testid="waterfall-note"
        >
          {note}
        </p>
      )}
    </div>
  );
}
