/**
 * PayoffControls.tsx — the shared control strip above the payoff graph.
 *
 * ONE component, two mounts (Overview combined-book hero + Analyzer candidate picker).
 * Presentational and fully controlled: it holds no state. It renders
 *   1. the forward date-projection picker (‹ / native date input / › / Today), and
 *   2. one series-toggle chip per PayoffChartToggles key,
 * and calls the handlers its parent passes. The parent owns the date/toggle state (via
 * usePayoffDateControl + a useState<PayoffChartToggles>) and feeds daysForward into its own
 * scenario engine — this component never touches the engine or the date-projection lib.
 */
import { Button } from "../system/index.tsx";
import type { PayoffChartToggles } from "./PayoffChart.tsx";

/** Chip order + labels. Keyed by the exact PayoffChartToggles field so clicks emit the key,
 * never a positional index. T+0 is always drawn (no toggle) — it has no PayoffChartToggles key. */
const TOGGLE_META: ReadonlyArray<{ readonly key: keyof PayoffChartToggles; readonly label: string }> = [
  { key: "showFan", label: "Fan" },
  { key: "showExpiration", label: "@ exp" },
  { key: "showWalls", label: "Walls" },
  { key: "showProfitZone", label: "Profit zone" },
];

export interface PayoffControlsProps {
  /** Local YYYY-MM-DD value for the native date input (from usePayoffDateControl). */
  readonly dateInputValue: string;
  /** Native input min attr (today). */
  readonly minIso: string;
  /** Native input max attr (front expiry — cannot project past it). */
  readonly maxIso: string;
  /** Raw input value on edit. */
  readonly onDateChange: (value: string) => void;
  /** ∓1 whole-day step from the ‹ / › buttons. */
  readonly onStepDate: (delta: number) => void;
  /** Reset the projection back to today. */
  readonly onResetDate: () => void;
  /** Current series visibility flags. */
  readonly toggles: PayoffChartToggles;
  /** Flip one series on/off. */
  readonly onToggle: (key: keyof PayoffChartToggles) => void;
}

export function PayoffControls({
  dateInputValue,
  minIso,
  maxIso,
  onDateChange,
  onStepDate,
  onResetDate,
  toggles,
  onToggle,
}: PayoffControlsProps): React.ReactElement {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[9px] text-dim">
      <span>Date:</span>
      <Button onClick={() => { onStepDate(-1); }} aria-label="Previous day">
        ‹
      </Button>
      <input
        type="date"
        data-testid="date-picker-input"
        min={minIso}
        max={maxIso}
        value={dateInputValue}
        onChange={(e) => { onDateChange(e.target.value); }}
        style={{ colorScheme: "dark" }}
        className="rounded-[3px] border border-line2 bg-raise px-[7px] py-0.5 font-mono text-[11px] text-txt focus-visible:border-violet focus-visible:ring-2 focus-visible:ring-violet/40 focus-visible:outline-none"
      />
      <Button onClick={() => { onStepDate(1); }} aria-label="Next day">
        ›
      </Button>
      <Button onClick={onResetDate}>Today</Button>

      <span className="mx-0.5 h-3 w-px bg-line2" aria-hidden="true" />

      {TOGGLE_META.map(({ key, label }) => {
        const on = toggles[key];
        return (
          <Button
            key={key}
            variant="toggle"
            active={on}
            data-testid={`toggle-${key}`}
            aria-pressed={on}
            onClick={() => { onToggle(key); }}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
