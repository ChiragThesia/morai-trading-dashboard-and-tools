/**
 * tos-order.ts — build a Thinkorswim calendar order string from a picker candidate (copy-out).
 *
 * The inverse of tos-parser.ts: turns a candidate into a paste-ready TOS order line, e.g.
 *   BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/14 AUG 26 7425 PUT @48.75 LMT GTC
 *
 * Conventions:
 *   - A long calendar buys the back (longer-dated) leg and sells the front, so TOS lists the
 *     BACK expiry first, then "/", then the FRONT.
 *   - Expiries are derived from the snapshot `asOf` date + each leg's whole-day DTE (local
 *     midnight — never `new Date(string)`, the UTC-drift class this project has hit twice).
 *   - The [AM] tag marks a standard AM-settled monthly (3rd Friday of the month); weeklies
 *     (any other date) are PM-settled and carry no tag.
 *   - Price is the debit in index points (debit dollars / 100), 2 decimals.
 */
import type { PickerCandidate } from "@morai/contracts";
import { parseLocalDateInput } from "./date-projection.ts";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/** Standard AM-settled monthly = the 3rd Friday (a Friday falling on the 15th–21st). */
function isThirdFriday(d: Date): boolean {
  return d.getDay() === 5 && d.getDate() >= 15 && d.getDate() <= 21;
}

/** `asOf` (local midnight) + `dte` whole days. */
function expiryDate(asOf: Date, dte: number): Date {
  return new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() + dte);
}

/** "18 SEP 26", no settlement tag. */
function plainTosDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
}

/**
 * "18 SEP 26" or "18 SEP 26 [AM]" for a monthly expiry.
 *
 * Third-Friday is a PROXY for "the AM-settled monthly", used because `PickerCandidate` carries no
 * OCC root. It is only correct for SPX: SPXW lists third Fridays too and is PM-settled on every
 * one of them. Where the root IS known, tag on the root instead — see `buildTosPairOrder`.
 */
function formatTosDate(d: Date): string {
  return isThirdFriday(d) ? `${plainTosDate(d)} [AM]` : plainTosDate(d);
}

/**
 * Build the TOS calendar order string for a candidate. `asOf` is the snapshot reference date
 * (ISO `YYYY-MM-DD`, from pickerSnapshotResponse.asOf) that the legs' DTEs are relative to.
 * Falls back to a plain string with no dates if `asOf` is unparseable (never throws).
 */
export function buildTosCalendarOrder(candidate: PickerCandidate, asOf: string): string {
  const ref = parseLocalDateInput(asOf);
  const strike = candidate.frontLeg.strike;
  const type = candidate.frontLeg.putCall === "C" ? "CALL" : "PUT";
  const price = (candidate.debit / 100).toFixed(2);

  const dates =
    ref === null
      ? ""
      : `${formatTosDate(expiryDate(ref, candidate.backLeg.dte))}/${formatTosDate(
          expiryDate(ref, candidate.frontLeg.dte),
        )} `;

  return `BUY +1 CALENDAR SPX 100 ${dates}${strike} ${type} @${price} LMT GTC`;
}

/** Two legs the user picked off the chain table, in the units the chain serves them in. */
export interface TosPairOrder {
  /** Strike ×1000, straight off the chain row. */
  readonly strike: number;
  readonly contractType: "C" | "P";
  /**
   * The OCC root BOTH legs share. Drives the `[AM]` settlement tag, which is the whole reason it
   * is here — the caller only emits an order for a same-root pair, so one value covers both legs.
   */
  readonly root: "SPX" | "SPXW";
  /** ISO `YYYY-MM-DD`, straight off the chain row — never asOf + dte. */
  readonly frontExpiry: string;
  readonly backExpiry: string;
  /**
   * Entry debit in INDEX POINTS, as `chain-math.calendarDebit` returns it. Not dollars —
   * unlike `PickerCandidate.debit`, which is why this does not divide by 100. Null when
   * neither leg had a fillable quote; the line then carries no price.
   */
  readonly debit: number | null;
}

/**
 * Build the TOS order line for a front/back pair picked off the Analyzer chain.
 *
 * Sibling of `buildTosCalendarOrder`, and it exists for one reason: the chain hands over two
 * literal expiry DATES, so there is no `asOf` + `dte` arithmetic to get wrong. Same output
 * grammar — back leg first, `[AM]` on monthlies, debit in points — because the string's job is
 * to survive `parseTosOrder`, which is what the paste box behind the payoff panel feeds.
 *
 * Deliberately LITERAL about which leg is which: it prints `backExpiry` first even if that date
 * is earlier than `frontExpiry`. It does not sort them. `parseTosOrder` DOES sort, and would
 * quietly re-label an inverted pair as a valid calendar — a plausible-but-wrong read of what the
 * user picked. The caller gates the button on "back is strictly later" instead, where the pair's
 * own flags already live.
 */
export function buildTosPairOrder(pair: TosPairOrder): string {
  const back = parseLocalDateInput(pair.backExpiry);
  const front = parseLocalDateInput(pair.frontExpiry);
  // Settlement tag comes off the ROOT, not the date. Only SPX third-Friday monthlies settle AM;
  // SPXW is PM-settled on every date it lists, third Fridays included. Caught in live UAT — a
  // real SPXW Aug-21/Sep-18 7400P calendar was tagged [AM] on both legs, which selects the wrong
  // contract in Thinkorswim. The sibling above still uses the date proxy because a
  // PickerCandidate carries no root; here we have one, so use it.
  const fmt = pair.root === "SPX" ? formatTosDate : plainTosDate;
  // Mirrors the sibling's fallback: an unparseable date drops the date segment, never throws.
  const dates = back === null || front === null ? "" : `${fmt(back)}/${fmt(front)} `;
  // ponytail: /1000 inline rather than importing STRIKE_SCALE from chain-math, which would drag
  // @morai/core + @morai/quant into this module for one constant.
  const strike = pair.strike / 1000;
  const type = pair.contractType === "C" ? "CALL" : "PUT";
  const price = pair.debit === null ? "" : `@${pair.debit.toFixed(2)} `;
  return `BUY +1 CALENDAR SPX 100 ${dates}${strike} ${type} ${price}LMT GTC`;
}
