import { PayoffTooltipContent } from "@morai/web";

const payload = [
  { name: "today" as const, value: 412.55, dataKey: "today", color: "#a78bfa", payload: { spot: 7482, today: 412.55, expiration: 980.2 } },
];

const base = {
  active: true,
  label: 7482,
  payload,
  coordinate: { x: 320, y: 120 },
  accessibilityLayer: false,
  activeIndex: "0",
};

/** The crosshair readout with full GEX context at the hovered spot. */
export function WithGexContext() {
  return <PayoffTooltipContent {...base} gex={{ callWall: 7600, putWall: 7400, flip: 7450 }} />;
}

/** Degraded GEX context — the wall lines are omitted rather than guessed. */
export function WithoutGex() {
  return <PayoffTooltipContent {...base} gex={{ callWall: null, putWall: null, flip: null }} />;
}

/** A losing point: the P&L reads in the down tone. */
export function NegativePl() {
  return (
    <PayoffTooltipContent
      {...base}
      label={7180}
      payload={[{ ...payload[0], value: -268.4, payload: { spot: 7180, today: -268.4, expiration: -480 } }]}
      gex={{ callWall: 7600, putWall: 7400, flip: 7450 }}
    />
  );
}
