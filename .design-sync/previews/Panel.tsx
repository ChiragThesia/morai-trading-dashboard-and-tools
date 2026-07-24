import { Button, MetricChip, Panel, PanelHeading, SectionLabel, Stat } from "@morai/web";

/** Panel is the standard gradient card surface every dashboard box sits on. */
export function Plain() {
  return (
    <Panel style={{ maxWidth: 420 }}>
      <SectionLabel>Net greeks</SectionLabel>
      <div style={{ display: "flex", gap: 24, marginTop: 8 }}>
        <Stat label="Delta" value="+1.2" />
        <Stat label="Theta" value="+45.9" valueClassName="text-up" />
        <Stat label="Vega" value="+305.3" />
        <Stat label="Gamma" value="—" valueClassName="text-dim" />
      </div>
    </Panel>
  );
}

/** With a PanelHeading: title, an inline badge and a right-aligned action. */
export function WithHeading() {
  return (
    <Panel style={{ maxWidth: 420 }}>
      <PanelHeading
        title="Open positions"
        badge={<span className="text-[10px] text-up">live</span>}
        action={<Button variant="ghost" size="xs">Re-pull</Button>}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }} className="font-mono text-muted-foreground">
        <div>7500P Jul 23 / Aug 14 · +$412.00</div>
        <div>7400P Aug 15 / Sep 19 · −$169.00</div>
        <div>7600C Jul 31 / Sep 05 · +$1 041.00</div>
      </div>
    </Panel>
  );
}

/** Panels tile — the Overview grid is a wall of these. */
export function Grid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 560 }}>
      <Panel><SectionLabel>Book P&amp;L</SectionLabel><div className="font-mono text-2xl text-up">+$1 284.00</div></Panel>
      <Panel><SectionLabel>Net gamma</SectionLabel><div className="font-mono text-2xl text-down">−$57.4B</div></Panel>
      <Panel style={{ gridColumn: "span 2" }}>
        <PanelHeading title="Market" />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <MetricChip label="SPX" value="7 482.10" />
          <MetricChip label="flip" value="7 450" />
          <MetricChip label="net γ" value="−57.4B" alert valueClassName="text-down" />
        </div>
      </Panel>
    </div>
  );
}
