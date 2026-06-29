import { Positions } from "./Positions.tsx";
import { Market } from "./Market.tsx";

/**
 * Overview — the home screen. Composes the full Positions deep-dive (calendar-paired
 * book + per-leg greeks + ad-hoc picker + attribution) on top, then Market structure
 * (dealer-gamma regime + key levels) below. The live "moves" strip (SPX · γ · flip ·
 * book P&L) lives in the Shell header, so the home tab carries everything we watch:
 * our positions and the market moves around them.
 *
 * Positions + Market are each self-contained screens (own data hooks + container), so
 * Overview is pure composition — no duplicated data logic. Both retain their own tests.
 */
export function Overview(): React.ReactElement {
  return (
    <>
      <Positions />
      <Market />
    </>
  );
}
