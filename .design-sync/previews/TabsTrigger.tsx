import { Tabs, TabsContent, TabsList, TabsTrigger } from "@morai/web";

/**
 * How the app actually uses Tabs: a segmented control with NO panels — the selected
 * value drives a chart elsewhere on the screen (Market.tsx strike window, GexBars mode).
 */
export function SegmentedControl() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Tabs defaultValue="20">
        <TabsList aria-label="Strike window around spot">
          <TabsTrigger value="5">±5</TabsTrigger>
          <TabsTrigger value="10">±10</TabsTrigger>
          <TabsTrigger value="20">±20</TabsTrigger>
          <TabsTrigger value="40">±40</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs defaultValue="gex">
        <TabsList aria-label="GEX chart mode">
          <TabsTrigger value="gex">GEX</TabsTrigger>
          <TabsTrigger value="oi">OI wall</TabsTrigger>
          <TabsTrigger value="volume">Volume</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

/**
 * With panels. NOTE: `tabs.tsx` styles its stacking with Tailwind `data-horizontal:`
 * variants, but base-ui emits `data-orientation="horizontal"` — so the root never gets
 * `flex-col` on its own. Compose the column explicitly, as here.
 */
export function WithPanels() {
  const panel = { padding: "10px 2px", color: "#7b8696" } as const;
  return (
    <Tabs defaultValue="trades" style={{ maxWidth: 460, display: "flex", flexDirection: "column" }}>
      <TabsList>
        <TabsTrigger value="trades">Trades</TabsTrigger>
        <TabsTrigger value="history">Trade history</TabsTrigger>
        <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
      </TabsList>
      <TabsContent value="trades"><div style={panel}>13 calendars · 5 open</div></TabsContent>
      <TabsContent value="history"><div style={panel}>80 broker transactions since 4/16</div></TabsContent>
      <TabsContent value="lifecycle"><div style={panel}>P&amp;L attribution by day</div></TabsContent>
    </Tabs>
  );
}

/** variant="line" swaps the filled pill for an underline. */
export function LineVariant() {
  return (
    <Tabs defaultValue="skew">
      <TabsList variant="line" aria-label="Surface">
        <TabsTrigger value="gex">GEX</TabsTrigger>
        <TabsTrigger value="skew">Skew</TabsTrigger>
        <TabsTrigger value="term">Term structure</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

/** A disabled trigger is dimmed and unclickable. */
export function DisabledTab() {
  return (
    <Tabs defaultValue="live">
      <TabsList aria-label="Mode">
        <TabsTrigger value="live">Live</TabsTrigger>
        <TabsTrigger value="backtest" disabled>Backtest</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
