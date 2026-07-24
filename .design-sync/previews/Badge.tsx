import { Badge } from "@morai/web";

const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } as const;

/** Every variant, with the labels the dashboard actually uses. */
export function Variants() {
  return (
    <div style={row}>
      <Badge>LIVE</Badge>
      <Badge variant="secondary">RTH</Badge>
      <Badge variant="destructive">STOP</Badge>
      <Badge variant="outline">schwab</Badge>
      <Badge variant="ghost">cboe</Badge>
      <Badge variant="link">open journal</Badge>
    </div>
  );
}

/** In use: status pills alongside a heading. */
export function StatusRow() {
  return (
    <div style={row}>
      <span className="font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">Market structure</span>
      <Badge variant="outline">as of 14:32</Badge>
      <Badge variant="destructive">stale</Badge>
    </div>
  );
}
