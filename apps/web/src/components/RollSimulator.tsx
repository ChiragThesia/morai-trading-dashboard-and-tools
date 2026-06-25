/**
 * RollSimulator — Amber roll overlay controls
 *
 * UI-SPEC "Analyzer screen" Roll simulator:
 *   - Segment buttons for front roll: none / +7 / +14 / +21 days
 *   - Segment buttons for strike offset: −100 / same / +100
 *   - Badge: "on {selected position name}"
 *   - Status copy:
 *     - Inactive: "Amber overlay = book with the selected position rolled."
 *     - Active:   "Rolling {name}: front +{n}d, K {±n}. Amber = book after roll."
 *
 * Drives rollScenario via rollConfig onChange.
 * No any/as/!.
 */

import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.tsx";
import type { RollConfig } from "../lib/scenario-engine.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RollSimulatorProps {
  /** Name of the selected position (for the badge and status text) */
  selectedPositionName: string;
  /** Current roll config state */
  rollConfig: RollConfig;
  /** Called when roll days or strike offset changes */
  onChange: (config: RollConfig) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLL_DAY_OPTIONS = [
  { value: 0, label: "none" },
  { value: 7, label: "+7" },
  { value: 14, label: "+14" },
  { value: 21, label: "+21" },
] as const;

const STRIKE_OFFSET_OPTIONS = [
  { value: -100, label: "−100" },
  { value: 0, label: "same" },
  { value: 100, label: "+100" },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * RollSimulator — amber segment controls driving rollScenario.
 */
export function RollSimulator({
  selectedPositionName,
  rollConfig,
  onChange,
}: RollSimulatorProps): React.ReactElement {
  const { rollDays, strikeOffset } = rollConfig;

  const isActive = rollDays > 0 || strikeOffset !== 0;

  // Status copy (locked UI-SPEC)
  const statusText = isActive
    ? `Rolling ${selectedPositionName}: front +${rollDays}d, K ${strikeOffset >= 0 ? "+" : ""}${strikeOffset}. Amber = book after roll.`
    : "Amber overlay = book with the selected position rolled.";

  const handleRollDaysChange = (groupValue: string[]): void => {
    const picked = groupValue[0];
    const n = Number(picked);
    if (n === 0 || n === 7 || n === 14 || n === 21) {
      onChange({ rollDays: n, strikeOffset });
    }
  };

  const handleStrikeOffsetChange = (groupValue: string[]): void => {
    const picked = groupValue[0];
    const n = Number(picked);
    if (n === -100 || n === 0 || n === 100) {
      onChange({ rollDays, strikeOffset: n });
    }
  };

  return (
    <div data-testid="roll-simulator">
      {/* Heading + badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <h3
          style={{
            margin: 0,
            fontFamily: "Space Grotesk, sans-serif",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.9px",
            textTransform: "uppercase",
            color: "#7b8696",
          }}
        >
          Roll simulator
        </h3>
        <span
          data-testid="roll-badge"
          style={{
            fontSize: 9,
            color: "#f0b429",
            border: "1px solid #27313f",
            borderRadius: 999,
            padding: "1px 7px",
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          {`on ${selectedPositionName}`}
        </span>
      </div>

      {/* Front out control */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
          <span
            style={{
              color: "#7b8696",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            Front out
          </span>
          <span
            style={{
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 700,
              fontSize: 13,
              color: "#f0b429",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {rollDays > 0 ? `+${rollDays}d` : "off"}
          </span>
        </div>
        <ToggleGroup
          value={[rollDays.toString()]}
          onValueChange={handleRollDaysChange}
          aria-label="Roll days"
          style={{ width: "100%" }}
        >
          {ROLL_DAY_OPTIONS.map(({ value, label }) => (
            <ToggleGroupItem
              key={value}
              value={value.toString()}
              aria-label={`Roll front ${label}`}
              style={{ flex: 1 }}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Roll strike control */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
          <span
            style={{
              color: "#7b8696",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            Roll strike
          </span>
          <span
            style={{
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 700,
              fontSize: 13,
              color: "#f0b429",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {strikeOffset === 0 ? "same" : (strikeOffset > 0 ? `+${strikeOffset}` : `${strikeOffset}`)}
          </span>
        </div>
        <ToggleGroup
          value={[strikeOffset.toString()]}
          onValueChange={handleStrikeOffsetChange}
          aria-label="Roll strike offset"
          style={{ width: "100%" }}
        >
          {STRIKE_OFFSET_OPTIONS.map(({ value, label }) => (
            <ToggleGroupItem
              key={value}
              value={value.toString()}
              aria-label={`Strike offset ${label}`}
              style={{ flex: 1 }}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Status copy (locked UI-SPEC) */}
      <p
        data-testid="roll-status"
        style={{
          fontSize: 9,
          color: "#566273",
          fontFamily: "JetBrains Mono, monospace",
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        {statusText}
      </p>
    </div>
  );
}
