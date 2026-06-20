import { ok, err } from "@morai/shared";
import type { Result, OccSymbolParsed } from "@morai/shared";
import type { FetchError } from "@morai/core";

// ─── Schwab symbol format ─────────────────────────────────────────────────────
//
// Schwab option symbol: root left-padded to 6 chars, YYMMDD, C/P, 8-digit strike×1000
//   "SPX   250620P07100000"  (3 spaces to pad SPX to 6)
//   "SPXW  260611C07275000"  (2 spaces to pad SPXW to 6)
//
// This is structurally identical to OCC 21-char format, so we can parse it
// directly and pass the result to formatOccSymbol from @morai/shared.
//
// Steps:
//   1. Validate length is exactly 21
//   2. Extract root (chars 0-5, trimEnd), dateStr (chars 6-11), typeChar (char 12), strikeStr (chars 13-20)
//   3. Parse and validate each component
//   4. Return OccSymbolParsed (same shape formatOccSymbol accepts)

const SCHWAB_SYMBOL_LENGTH = 21;
const NUMERIC_RE = /^\d+$/;

/**
 * parseSchwabSymbol — parse a Schwab option symbol into OccSymbolParsed components.
 *
 * Pure function. Returns Result.err (never throws) for any invalid input.
 *
 * The Schwab symbol is structurally identical to OCC 21-char format:
 * root padded to 6, YYMMDD, C/P, 8-digit strike×1000.
 * After parsing, pass result.value to formatOccSymbol to produce the OCC string.
 */
export function parseSchwabSymbol(
  sym: string,
): Result<OccSymbolParsed, FetchError> {
  if (sym.length !== SCHWAB_SYMBOL_LENGTH) {
    return err({
      kind: "fetch-error",
      message: `Schwab symbol wrong length: ${sym.length} (expected ${SCHWAB_SYMBOL_LENGTH})`,
    });
  }

  const rootPadded = sym.slice(0, 6);
  const dateStr = sym.slice(6, 12);
  const typeChar = sym.slice(12, 13);
  const strikeStr = sym.slice(13, 21);

  if (typeChar !== "C" && typeChar !== "P") {
    return err({
      kind: "fetch-error",
      message: `Bad type char in Schwab symbol: '${typeChar}' (expected C or P)`,
    });
  }

  if (!NUMERIC_RE.test(dateStr)) {
    return err({
      kind: "fetch-error",
      message: `Non-numeric date in Schwab symbol: '${dateStr}'`,
    });
  }

  if (!NUMERIC_RE.test(strikeStr) || strikeStr.length !== 8) {
    return err({
      kind: "fetch-error",
      message: `Non-numeric or wrong-length strike in Schwab symbol: '${strikeStr}'`,
    });
  }

  const yy = parseInt(dateStr.slice(0, 2), 10);
  const mm = parseInt(dateStr.slice(2, 4), 10);
  const dd = parseInt(dateStr.slice(4, 6), 10);

  if (
    !Number.isFinite(yy) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(dd)
  ) {
    return err({
      kind: "fetch-error",
      message: `Invalid date components in Schwab symbol: '${dateStr}'`,
    });
  }

  // Schwab strike field is strike×1000 in points — divide by 1000 to get strike in points
  // (same as CBOE: strike field is the raw 8-digit value, parsed as strike×1000)
  const strikeRaw = parseInt(strikeStr, 10);
  if (!Number.isFinite(strikeRaw) || strikeRaw <= 0) {
    return err({
      kind: "fetch-error",
      message: `Invalid/zero strike in Schwab symbol: '${strikeStr}'`,
    });
  }

  const strike = strikeRaw / 1000;

  // Build expiry Date using local (no timezone) — same as CBOE osiToOcc
  const expiry = new Date(2000 + yy, mm - 1, dd);
  if (
    expiry.getFullYear() !== 2000 + yy ||
    expiry.getMonth() !== mm - 1 ||
    expiry.getDate() !== dd
  ) {
    return err({
      kind: "fetch-error",
      message: `Invalid calendar date in Schwab symbol: '${dateStr}'`,
    });
  }

  const root = rootPadded.trimEnd();

  return ok({ root, expiry, type: typeChar, strike });
}
