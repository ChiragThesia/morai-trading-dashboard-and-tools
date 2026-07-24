import type { CSSProperties, ReactNode } from "react";
import { Button } from "@morai/web";

// Layout glue is inline-styled on purpose: the shipped stylesheet is Tailwind's
// PURGED app build, so a utility class the app never uses does not exist in it.
const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const stack: CSSProperties = { display: "flex", flexDirection: "column", gap: 14 };
const caption: CSSProperties = {
  font: "600 9px 'Space Grotesk', system-ui",
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "#566273",
};

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={caption}>{label}</span>
      <div style={row}>{children}</div>
    </div>
  );
}

/** The four non-toggle variants — the default control affordance across the app. */
export function Variants() {
  return (
    <div style={row}>
      <Button variant="primary" size="sm">Analyze</Button>
      <Button variant="secondary" size="sm">Re-pull</Button>
      <Button variant="ghost" size="sm">Reset</Button>
      <Button variant="destructive" size="sm">Close position</Button>
    </div>
  );
}

/** variant="toggle" is the on/off affordance: active fills with the tone, inactive is an outline. */
export function ToggleTones() {
  return (
    <div style={stack}>
      <Group label="active — the clear ON">
        <Button variant="toggle" tone="violet" active>T+0</Button>
        <Button variant="toggle" tone="amber" active>@exp</Button>
        <Button variant="toggle" tone="up" active>Δ</Button>
        <Button variant="toggle" tone="down" active>θ</Button>
      </Group>
      <Group label="inactive — outline, fills on hover">
        <Button variant="toggle" tone="violet">T+0</Button>
        <Button variant="toggle" tone="amber">@exp</Button>
        <Button variant="toggle" tone="up">Δ</Button>
        <Button variant="toggle" tone="down">θ</Button>
      </Group>
    </div>
  );
}

/** Three sizes. `touch` is the mobile target — it collapses to xs metrics at lg:. */
export function Sizes() {
  return (
    <div style={row}>
      <Button variant="secondary" size="xs">xs · rail chip</Button>
      <Button variant="secondary" size="sm">sm · panel action</Button>
      <Button variant="secondary" size="touch">touch · mobile</Button>
    </div>
  );
}

/** Disabled drops to 40% and kills pointer events on every variant. */
export function Disabled() {
  return (
    <div style={row}>
      <Button variant="primary" size="sm" disabled>Analyze</Button>
      <Button variant="secondary" size="sm" disabled>Re-pull</Button>
      <Button variant="toggle" tone="violet" size="sm" active disabled>T+0</Button>
    </div>
  );
}
