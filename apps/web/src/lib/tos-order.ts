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

/** "18 SEP 26" or "18 SEP 26 [AM]" for a monthly expiry. */
function formatTosDate(d: Date): string {
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
  return isThirdFriday(d) ? `${base} [AM]` : base;
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
