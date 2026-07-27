/**
 * format-as-of.ts — the shared "as of {HH:MM}" staleness formatter.
 *
 * Relocated verbatim out of CandidateCard.tsx when that orphaned component was deleted;
 * Analyzer.tsx's verdict-hero footer (AUI-07) was its only remaining consumer.
 */
import { GEX_FRESH_MS } from "../screens/Market.tsx";

/**
 * formatAsOf — "as of {HH:MM}" (24h) + freshness, guarded against an unparseable `observedAt`.
 * Never renders "Invalid Date" — an unparseable/NaN timestamp falls back to "as of —" and is
 * treated as stale (the safe direction per T-19-21: never claim freshness you can't prove).
 *
 * WR-03: takes the snapshot's full-ISO `observedAt` instant, NOT the date-only `asOf` reference
 * date — a date-only value made the dot always amber and the HH:MM label a constant
 * timezone-offset artifact of UTC midnight, never the real snapshot instant.
 */
export function formatAsOf(observedAt: string): { readonly label: string; readonly fresh: boolean } {
  const ts = new Date(observedAt).getTime();
  if (Number.isNaN(ts)) {
    return { label: "as of —", fresh: false };
  }
  const ageMs = Date.now() - ts;
  const hhmm = new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return { label: `as of ${hhmm}`, fresh: ageMs >= 0 && ageMs < GEX_FRESH_MS };
}
