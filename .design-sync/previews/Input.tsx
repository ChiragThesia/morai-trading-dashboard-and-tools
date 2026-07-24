import { Input } from "@morai/web";

const stack = { display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 } as const;
const label = { font: "600 10px 'Space Grotesk', system-ui", letterSpacing: "0.09em", textTransform: "uppercase", color: "#566273" } as const;

/** Default, filled, disabled and invalid — the four states a form field shows. */
export function States() {
  return (
    <div style={stack}>
      <div><div style={label}>Strike</div><Input placeholder="7500" /></div>
      <div><div style={label}>Debit</div><Input defaultValue="4627.55" /></div>
      <div><div style={label}>Account</div><Input defaultValue="****4417" disabled /></div>
      <div><div style={label}>Expiry</div><Input defaultValue="not-a-date" aria-invalid /></div>
    </div>
  );
}

/** Typed inputs — number and date use the browser's native affordances. */
export function Types() {
  return (
    <div style={stack}>
      <div><div style={label}>Contracts</div><Input type="number" defaultValue={2} /></div>
      <div><div style={label}>Front expiry</div><Input type="date" defaultValue="2026-08-15" /></div>
    </div>
  );
}
