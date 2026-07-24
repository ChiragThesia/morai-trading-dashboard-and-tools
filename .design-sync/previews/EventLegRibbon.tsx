import { EventLegRibbon } from "@morai/web";

const EVENTS = [
  { date: "2026-08-01", name: "NFP" },
  { date: "2026-08-12", name: "CPI" },
  { date: "2026-09-16", name: "FOMC" },
];

/** The ribbon lays events on the front/back leg timeline. */
export function Standard() {
  return <div style={{ maxWidth: 520 }}><EventLegRibbon events={EVENTS} asOf="2026-07-24" frontDte={21} backDte={43} /></div>;
}

/** A short-gap event calendar: the event sits between the two legs on purpose. */
export function EventCalendar() {
  return <div style={{ maxWidth: 520 }}><EventLegRibbon events={[{ date: "2026-07-30", name: "FOMC" }]} asOf="2026-07-24" frontDte={5} backDte={9} /></div>;
}

/** Nothing scheduled inside the window. */
export function NoEvents() {
  return <div style={{ maxWidth: 520 }}><EventLegRibbon events={[]} asOf="2026-07-24" frontDte={21} backDte={43} /></div>;
}
