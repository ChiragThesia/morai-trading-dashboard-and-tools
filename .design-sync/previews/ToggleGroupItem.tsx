import { ToggleGroup, ToggleGroupItem } from "@morai/web";

const stack = { display: "flex", flexDirection: "column", gap: 16 } as const;
const cap = { font: "600 9px 'Space Grotesk', system-ui", letterSpacing: "0.09em", textTransform: "uppercase", color: "#566273", marginBottom: 6 } as const;

/** The default spaced group — the payoff chart's series switcher. */
export function Default() {
  return (
    <ToggleGroup defaultValue={["t0"]}>
      <ToggleGroupItem value="t0">T+0</ToggleGroupItem>
      <ToggleGroupItem value="exp">@exp</ToggleGroupItem>
      <ToggleGroupItem value="delta">Δ</ToggleGroupItem>
      <ToggleGroupItem value="theta">θ</ToggleGroupItem>
    </ToggleGroup>
  );
}

/** spacing={0} welds the items into one segmented control. */
export function Segmented() {
  return (
    <div style={stack}>
      <div>
        <div style={cap}>spacing 0 · outline</div>
        <ToggleGroup spacing={0} variant="outline" defaultValue={["1d"]}>
          <ToggleGroupItem value="1d">1D</ToggleGroupItem>
          <ToggleGroupItem value="1w">1W</ToggleGroupItem>
          <ToggleGroupItem value="1m">1M</ToggleGroupItem>
          <ToggleGroupItem value="all">ALL</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div>
        <div style={cap}>sm</div>
        <ToggleGroup spacing={0} variant="outline" size="sm" defaultValue={["mid"]}>
          <ToggleGroupItem value="bid">Bid</ToggleGroupItem>
          <ToggleGroupItem value="mid">Mid</ToggleGroupItem>
          <ToggleGroupItem value="ask">Ask</ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}

/** Vertical orientation stacks the items. */
export function Vertical() {
  return (
    <ToggleGroup orientation="vertical" variant="outline" defaultValue={["gex"]}>
      <ToggleGroupItem value="gex">GEX</ToggleGroupItem>
      <ToggleGroupItem value="oi">Open interest</ToggleGroupItem>
      <ToggleGroupItem value="vol">Volume</ToggleGroupItem>
    </ToggleGroup>
  );
}
