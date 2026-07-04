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
import { cn } from "@/lib/utils";
import type { PayoffChartToggles } from "./PayoffChart.tsx";

/** Chip order + labels. Keyed by the exact PayoffChartToggles field so clicks emit the key,
 * never a positional index. T+0 is always drawn (no toggle) — it has no PayoffChartToggles key. */
const TOGGLE_META: ReadonlyArray<{ readonly key: keyof PayoffChartToggles; readonly label: string }> = [
  { key: "showFan", label: "Fan" },
  { key: "showExpiration", label: "@ exp" },
  { key: "showWalls", label: "Walls" },
  { key: "showProfitZone", label: "Profit zone" },
];

const STEP_BTN =
  "cursor-pointer rounded-[3px] border border-line2 bg-transparent px-[7px] py-0.5 font-mono text-[9px] text-dim";

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
      <button
        type="button"
        onClick={() => { onStepDate(-1); }}
        aria-label="Previous day"
        className={STEP_BTN}
      >
        ‹
      </button>
      <input
        type="date"
        data-testid="date-picker-input"
        min={minIso}
        max={maxIso}
        value={dateInputValue}
        onChange={(e) => { onDateChange(e.target.value); }}
        style={{ colorScheme: "dark" }}
        className="rounded-[3px] border border-line2 bg-transparent px-[7px] py-0.5 font-mono text-[11px] text-txt"
      />
      <button
        type="button"
        onClick={() => { onStepDate(1); }}
        aria-label="Next day"
        className={STEP_BTN}
      >
        ›
      </button>
      <button type="button" onClick={onResetDate} className={STEP_BTN}>
        Today
      </button>

      <span className="mx-0.5 h-3 w-px bg-line2" aria-hidden="true" />

      {TOGGLE_META.map(({ key, label }) => {
        const on = toggles[key];
        return (
          <button
            key={key}
            type="button"
            data-testid={`toggle-${key}`}
            aria-pressed={on}
            onClick={() => { onToggle(key); }}
            className={cn(
              "cursor-pointer rounded-[3px] border px-[7px] py-0.5 font-mono text-[9px]",
              on
                ? "border-violet/60 bg-violet/10 text-txt"
                : "border-line2 bg-transparent text-dim line-through",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
