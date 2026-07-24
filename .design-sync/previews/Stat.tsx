import { Panel, SectionLabel, Stat } from "@morai/web";

/** A label-over-value KPI cell. `valueClassName` carries the sign colour. */
export function Row() {
  return (
    <div style={{ display: "flex", gap: 28 }}>
      <Stat label="Mark" value="$4 627.55" />
      <Stat label="Debit" value="$4 215.00" />
      <Stat label="Unreal" value="+$412.55" valueClassName="text-up" />
      <Stat label="DTE" value="21" />
    </div>
  );
}

/** Negative values take the down tone; a missing value stays dim, never zero. */
export function SignsAndGaps() {
  return (
    <div style={{ display: "flex", gap: 28 }}>
      <Stat label="Unreal" value="−$169.00" valueClassName="text-down" />
      <Stat label="Realized" value="+$375.00" valueClassName="text-up" />
      <Stat label="Gamma" value="—" valueClassName="text-dim" />
    </div>
  );
}

/** The net-greeks block: a Stat grid inside a Panel. */
export function GreeksGrid() {
  return (
    <Panel style={{ maxWidth: 420 }}>
      <SectionLabel>Net greeks</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 8 }}>
        <Stat label="Delta" value="+1.2" />
        <Stat label="Theta" value="+45.9" valueClassName="text-up" />
        <Stat label="Vega" value="+305.3" />
        <Stat label="Rho" value="−12.4" valueClassName="text-down" />
      </div>
    </Panel>
  );
}
