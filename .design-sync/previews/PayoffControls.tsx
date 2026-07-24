import { PayoffControls } from "@morai/web";

const base = {
  dateInputValue: "2026-07-29",
  minIso: "2026-07-24",
  maxIso: "2026-08-07",
  onDateChange: () => {},
  onStepDate: () => {},
  onResetDate: () => {},
  onToggle: () => {},
};

/** All four series on — the default Analyzer control row. */
export function AllSeriesOn() {
  return (
    <div style={{ maxWidth: 620 }}>
      <PayoffControls {...base} toggles={{ showFan: true, showExpiration: true, showWalls: true, showProfitZone: true }} />
    </div>
  );
}

/** Everything off — the toggles fall back to their outline state. */
export function AllSeriesOff() {
  return (
    <div style={{ maxWidth: 620 }}>
      <PayoffControls {...base} toggles={{ showFan: false, showExpiration: false, showWalls: false, showProfitZone: false }} />
    </div>
  );
}

/** Projected to today (the reset state) versus a date pushed out to front expiry. */
export function DateRange() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 620 }}>
      <PayoffControls {...base} dateInputValue="2026-07-24" toggles={{ showFan: true, showExpiration: true, showWalls: false, showProfitZone: true }} />
      <PayoffControls {...base} dateInputValue="2026-08-07" toggles={{ showFan: true, showExpiration: true, showWalls: false, showProfitZone: true }} />
    </div>
  );
}
