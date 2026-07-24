import { EventChipsRow } from "@morai/web";

const EVENTS = [
  { date: "2026-08-01", name: "NFP" },
  { date: "2026-08-12", name: "CPI" },
  { date: "2026-09-16", name: "FOMC" },
  { date: "2026-09-30", name: "PCE" },
];

/** Events straddling both legs — front-window and back-window chips are tinted apart. */
export function BothLegs() {
  return <div style={{ maxWidth: 460 }}><EventChipsRow events={EVENTS} asOf="2026-07-24" frontDte={21} backDte={43} /></div>;
}

/** Every event lands beyond the back leg — nothing inside the trade window. */
export function OutsideWindow() {
  return <div style={{ maxWidth: 460 }}><EventChipsRow events={EVENTS} asOf="2026-07-24" frontDte={3} backDte={6} /></div>;
}

/** No scheduled events at all — the row renders empty, never a placeholder chip. */
export function NoEvents() {
  return <div style={{ maxWidth: 460 }}><EventChipsRow events={[]} asOf="2026-07-24" frontDte={21} backDte={43} /></div>;
}
