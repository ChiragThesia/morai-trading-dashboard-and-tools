import { Button, ChipRail, MetricChip } from "@morai/web";

/**
 * A narrow (420px) container: below the 32rem threshold, so the rail scroll-snaps
 * horizontally and the next chip peeks past the right edge. Call sites add
 * `snap-start shrink-0` to their own children.
 */
export function ScrollsInANarrowContainer() {
  return (
    <div style={{ maxWidth: 420 }}>
      <ChipRail ariaLabel="Market metrics">
        <MetricChip className="snap-start shrink-0" label="SPX" value="7 482.10" />
        <MetricChip className="snap-start shrink-0" label="net γ" value="−57.4B" alert valueClassName="text-down" />
        <MetricChip className="snap-start shrink-0" label="flip" value="7 450" />
        <MetricChip className="snap-start shrink-0" label="put wall" value="7 400" />
        <MetricChip className="snap-start shrink-0" label="call wall" value="7 600" />
      </ChipRail>
    </div>
  );
}

/**
 * The same rail in a wide container. ChipRail is a CONTAINER query at 32rem, so what
 * decides scroll-vs-wrap is the room the rail has — not the size of the screen.
 */
export function WrapsInAWideContainer() {
  return (
    <div style={{ maxWidth: 720 }}>
      <ChipRail ariaLabel="Market metrics">
        <MetricChip className="snap-start shrink-0" label="SPX" value="7 482.10" />
        <MetricChip className="snap-start shrink-0" label="net γ" value="−57.4B" alert valueClassName="text-down" />
        <MetricChip className="snap-start shrink-0" label="flip" value="7 450" />
        <MetricChip className="snap-start shrink-0" label="put wall" value="7 400" />
        <MetricChip className="snap-start shrink-0" label="call wall" value="7 600" />
      </ChipRail>
    </div>
  );
}

/** A rail of toggle Buttons — the payoff chart's series switcher on mobile. */
export function ToggleRail() {
  return (
    <div style={{ maxWidth: 320 }}>
      <ChipRail ariaLabel="Payoff series">
        <Button className="snap-start shrink-0" variant="toggle" tone="violet" size="touch" active>T+0</Button>
        <Button className="snap-start shrink-0" variant="toggle" tone="amber" size="touch">@exp</Button>
        <Button className="snap-start shrink-0" variant="toggle" tone="up" size="touch">Δ</Button>
        <Button className="snap-start shrink-0" variant="toggle" tone="down" size="touch">θ</Button>
        <Button className="snap-start shrink-0" variant="toggle" tone="violet" size="touch">Vega</Button>
      </ChipRail>
    </div>
  );
}
