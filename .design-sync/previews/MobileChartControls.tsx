import { MobileChartControls } from "@morai/web";

const dateControl = {
  dateInputValue: "2026-07-29",
  daysForward: 5,
  engineDaysForward: 4.6,
  setDate: () => {},
  stepDate: () => {},
  resetDate: () => {},
};

const bounds = { minIso: "2026-07-24", maxIso: "2026-08-07" };

/** The mobile control set: date pill with quick-jumps, slider, and the series rail. */
export function Projected() {
  return (
    <div style={{ maxWidth: 380 }}>
      <MobileChartControls
        dateControl={dateControl}
        bounds={bounds}
        toggles={{ showFan: true, showExpiration: true, showWalls: true, showProfitZone: true }}
        onToggle={() => {}}
      />
    </div>
  );
}

/** Reset to today (offset 0) with only the expiration curve enabled. */
export function TodayMinimal() {
  return (
    <div style={{ maxWidth: 380 }}>
      <MobileChartControls
        dateControl={{ ...dateControl, dateInputValue: "2026-07-24", daysForward: 0, engineDaysForward: 0 }}
        bounds={bounds}
        toggles={{ showFan: false, showExpiration: true, showWalls: false, showProfitZone: false }}
        onToggle={() => {}}
      />
    </div>
  );
}
