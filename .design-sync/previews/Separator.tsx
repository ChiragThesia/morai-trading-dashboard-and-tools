import { Separator } from "@morai/web";

/** Horizontal rule between stacked sections. */
export function Horizontal() {
  return (
    <div style={{ maxWidth: 360 }}>
      <div className="text-muted-foreground">Front leg · 7500P · 21d</div>
      <Separator className="my-3" />
      <div className="text-muted-foreground">Back leg · 7500P · 43d</div>
    </div>
  );
}

/** Vertical rule between inline stats — needs a flex row with a height. */
export function Vertical() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, height: 28 }}>
      <span className="font-mono">SPX 7 482.10</span>
      <Separator orientation="vertical" />
      <span className="font-mono">γ −$57.4B</span>
      <Separator orientation="vertical" />
      <span className="font-mono">flip 7 450</span>
    </div>
  );
}
