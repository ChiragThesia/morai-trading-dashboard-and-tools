/**
 * MobileHero — the mobile Overview's first-screen focal block (35.1, D-03).
 *
 * BOOK P&L as a 32px sign-colored mono number (the SAME bookUnrealizedPnl the desktop
 * BOOK chip renders — no new P&L path) with an SPX · VIX · γ regime context line
 * beneath. Pure presentational; the model hook feeds every prop. Copy/classes verbatim
 * from 35.1-UI-SPEC.md §2 + §Copywriting Contract. No loading spinner — `—` covers
 * cold start per D-03's states.
 */
import { cn } from "@/lib/utils";
import type { GexRegime } from "../../lib/gex-regime.ts";
import type { LiveStreamStatus } from "../../hooks/useLiveStream.ts";
import { signedUsd, signClass } from "../../lib/position-format.ts";

export interface MobileHeroProps {
  readonly bookPnl: number;
  readonly hasPositions: boolean;
  readonly spot: number | null;
  readonly vix: number | null;
  readonly regime: GexRegime | null;
  /** Gates the SPX segment's live tint (LIVE-04) — never a silent stale-as-live claim
   *  (catch #26). Optional so existing callers/tests default to the EOD styling. */
  readonly liveStatus?: LiveStreamStatus;
}

export function MobileHero({
  bookPnl,
  hasPositions,
  spot,
  vix,
  regime,
  liveStatus,
}: MobileHeroProps): React.ReactElement {
  return (
    <section data-testid="mobile-hero" className="px-4 pt-4">
      <span className="font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
        Book P&L
      </span>
      <div
        data-testid="mobile-hero-value"
        className={cn(
          "mt-1 font-mono text-[32px] font-bold tabular-nums leading-none",
          hasPositions ? signClass(bookPnl) : "text-txt",
        )}
      >
        {hasPositions ? signedUsd(bookPnl) : "—"}
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
        <span>SPX </span>
        <span className={liveStatus === "live" ? "text-blue" : "text-dim"}>
          {spot !== null ? spot.toFixed(1) : "—"}
        </span>
        <span className="text-dim"> · </span>
        <span>VIX {vix !== null ? vix.toFixed(2) : "—"}</span>
        {regime !== null && (
          <>
            <span className="text-dim"> · </span>
            <span className={regime === "AMPLIFY" ? "text-down" : "text-up"}>γ {regime}</span>
          </>
        )}
      </div>
    </section>
  );
}
