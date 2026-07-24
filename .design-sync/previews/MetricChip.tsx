import { MetricChip } from "@morai/web";

/** The global header strip — bordered pills carrying the always-on numbers. */
export function HeaderStrip() {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <MetricChip label="SPX" value="7 482.10" />
      <MetricChip label="net γ" value="−57.4B" alert valueClassName="text-down" />
      <MetricChip label="flip" value="7 450" />
      <MetricChip label="book P&L" value="+$1 284" valueClassName="text-up" />
    </div>
  );
}

/** `alert` swaps to the blood-dark danger surface for negative-gamma / loss emphasis. */
export function AlertState() {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <MetricChip label="book P&L" value="+$1 284" valueClassName="text-up" />
      <MetricChip label="book P&L" value="−$2 106" alert valueClassName="text-down" />
    </div>
  );
}
