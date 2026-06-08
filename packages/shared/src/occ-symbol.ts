import { type Result, ok, err } from "./result.ts";

// OCC/OSI option symbol format (21 chars):
//   RRRRRRYYMMDDCNNNNNNN
//   R×6  — underlying root, left-aligned, space-padded to 6
//   YY    — 2-digit year (20xx assumed)
//   MM    — 2-digit month (01-12)
//   DD    — 2-digit day (01-31)
//   C/P   — call or put
//   N×8   — strike × 1000, zero-padded to 8 digits
//
// Example: "SPX   260515C07100000"
//   root="SPX", expiry=2026-05-15, type="C", strike=7100

export type OccSymbol = string & { readonly __brand: "OccSymbol" };

export type OccSymbolParsed = {
  readonly root: string;
  readonly expiry: Date;
  readonly type: "C" | "P";
  readonly strike: number; // positive integer, strike in points (not ×1000)
};

export type OccError =
  | { readonly kind: "WRONG_LENGTH"; readonly got: number }
  | { readonly kind: "BAD_TYPE_CHAR"; readonly got: string }
  | { readonly kind: "NON_NUMERIC_DATE"; readonly got: string }
  | { readonly kind: "NON_NUMERIC_STRIKE"; readonly got: string }
  | { readonly kind: "INVALID_DATE" }
  | { readonly kind: "INVALID_STRIKE" };

const OCC_LENGTH = 21;
const ROOT_LEN = 6;
const DATE_LEN = 6;
const TYPE_LEN = 1;
const STRIKE_LEN = 8;

const NUMERIC_RE = /^\d+$/;

export function parseOccSymbol(raw: string): Result<OccSymbolParsed, OccError> {
  if (raw.length !== OCC_LENGTH) {
    return err({ kind: "WRONG_LENGTH", got: raw.length });
  }

  const rootPadded = raw.slice(0, ROOT_LEN);
  const dateStr = raw.slice(ROOT_LEN, ROOT_LEN + DATE_LEN);
  const typeChar = raw.slice(ROOT_LEN + DATE_LEN, ROOT_LEN + DATE_LEN + TYPE_LEN);
  const strikeStr = raw.slice(ROOT_LEN + DATE_LEN + TYPE_LEN);

  if (typeChar !== "C" && typeChar !== "P") {
    return err({ kind: "BAD_TYPE_CHAR", got: typeChar });
  }

  if (!NUMERIC_RE.test(dateStr)) {
    return err({ kind: "NON_NUMERIC_DATE", got: dateStr });
  }

  if (!NUMERIC_RE.test(strikeStr) || strikeStr.length !== STRIKE_LEN) {
    return err({ kind: "NON_NUMERIC_STRIKE", got: strikeStr });
  }

  const yy = parseInt(dateStr.slice(0, 2), 10);
  const mm = parseInt(dateStr.slice(2, 4), 10);
  const dd = parseInt(dateStr.slice(4, 6), 10);
  const year = 2000 + yy;

  // month is 0-indexed in Date constructor
  const expiry = new Date(year, mm - 1, dd);
  if (
    expiry.getFullYear() !== year ||
    expiry.getMonth() !== mm - 1 ||
    expiry.getDate() !== dd
  ) {
    return err({ kind: "INVALID_DATE" });
  }

  const strikeRaw = parseInt(strikeStr, 10);
  if (!Number.isFinite(strikeRaw) || strikeRaw <= 0) {
    return err({ kind: "INVALID_STRIKE" });
  }
  const strike = strikeRaw / 1000;

  const root = rootPadded.trimEnd();

  return ok({ root, expiry, type: typeChar, strike });
}

export function formatOccSymbol(parts: OccSymbolParsed): OccSymbol {
  const { root, expiry, type, strike } = parts;

  const rootPadded = root.padEnd(ROOT_LEN, " ");

  const yy = String(expiry.getFullYear() - 2000).padStart(2, "0");
  const mm = String(expiry.getMonth() + 1).padStart(2, "0");
  const dd = String(expiry.getDate()).padStart(2, "0");

  const strikeInt = Math.round(strike * 1000);
  const strikePadded = String(strikeInt).padStart(STRIKE_LEN, "0");

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- branded type constructor: formatOccSymbol always produces a structurally valid OccSymbol string; the brand cannot be assigned without an assertion
  return `${rootPadded}${yy}${mm}${dd}${type}${strikePadded}` as OccSymbol;
}
