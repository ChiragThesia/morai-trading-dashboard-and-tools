import { GexByExpiry } from "@morai/web";

const BY_EXPIRY = [
  { date: "2026-07-25", gex: 18.4 },
  { date: "2026-07-31", gex: 42.1 },
  { date: "2026-08-07", gex: -11.6 },
  { date: "2026-08-15", gex: 63.8 },
  { date: "2026-08-29", gex: -27.3 },
  { date: "2026-09-19", gex: 96.2 },
  { date: "2026-10-17", gex: 31.5 },
  { date: "2026-12-19", gex: 74.9 },
];

/** Per-expiry aggregate gamma — positive bars dampen, negative bars amplify. */
export function ByExpiry() {
  return <div style={{ width: 640 }}><GexByExpiry byExpiry={BY_EXPIRY} /></div>;
}

/** Short book — only the front three expiries carry gamma. */
export function FrontWeeksOnly() {
  return <div style={{ width: 480 }}><GexByExpiry byExpiry={BY_EXPIRY.slice(0, 3)} height={160} /></div>;
}
