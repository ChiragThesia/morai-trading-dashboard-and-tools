import { Toggle } from "@morai/web";

const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } as const;
const stack = { display: "flex", flexDirection: "column", gap: 14 } as const;
const cap = { font: "600 9px 'Space Grotesk', system-ui", letterSpacing: "0.09em", textTransform: "uppercase", color: "#566273" } as const;

/** Pressed vs unpressed — pressed fills with the muted surface. */
export function PressedState() {
  return (
    <div style={row}>
      <Toggle defaultPressed>T+0</Toggle>
      <Toggle>@exp</Toggle>
      <Toggle defaultPressed>Marks</Toggle>
      <Toggle>Fills</Toggle>
    </div>
  );
}

/** Both variants at all three sizes. */
export function VariantsAndSizes() {
  return (
    <div style={stack}>
      <div>
        <div style={cap}>default</div>
        <div style={row}>
          <Toggle size="sm">sm</Toggle>
          <Toggle>default</Toggle>
          <Toggle size="lg">lg</Toggle>
        </div>
      </div>
      <div>
        <div style={cap}>outline</div>
        <div style={row}>
          <Toggle variant="outline" size="sm">sm</Toggle>
          <Toggle variant="outline">default</Toggle>
          <Toggle variant="outline" size="lg">lg</Toggle>
        </div>
      </div>
    </div>
  );
}

/** Disabled, pressed and unpressed. */
export function Disabled() {
  return (
    <div style={row}>
      <Toggle disabled>Locked</Toggle>
      <Toggle variant="outline" defaultPressed disabled>Locked on</Toggle>
    </div>
  );
}
