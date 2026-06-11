import { z } from "zod";
import { ok, err, formatOccSymbol } from "@morai/shared";
import type { Result, OccSymbol } from "@morai/shared";
import type { ForFetchingChain, RawChain, RawQuote, FetchError } from "@morai/core";

// CBOE delayed-quotes endpoint. _SPXW.json returns HTTP 403 (S3 AccessDenied);
// both SPX and SPXW contracts are served by _SPX.json — filter by OSI root prefix.
const CBOE_SPX_URL =
  "https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json";

// ─── Zod schemas (Pattern 1 from RESEARCH.md) ─────────────────────────────────

const CboeOptionSchema = z
  .object({
    option: z.string(), // OSI symbol e.g. "SPXW260611C07275000"
    bid: z.number().optional(),
    ask: z.number().optional(),
    iv: z.number().optional(),
    open_interest: z.number().optional(),
    volume: z.number().optional(),
    delta: z.number().optional(),
    gamma: z.number().optional(),
    vega: z.number().optional(),
    theta: z.number().optional(),
  })
  .passthrough(); // keep extra fields, don't throw

const CboeDataSchema = z
  .object({
    options: z.array(CboeOptionSchema),
    current_price: z.number().nullable().optional(),
    close: z.number().nullable().optional(),
    prev_day_close: z.number().nullable().optional(),
  })
  .passthrough();

const CboeResponseSchema = z.object({
  timestamp: z.string(), // "YYYY-MM-DD HH:MM:SS" ET local — no timezone suffix
  data: CboeDataSchema,
});

type CboeOption = z.infer<typeof CboeOptionSchema>;

// ─── OSI → OCC conversion (Pattern 2 from RESEARCH.md) ───────────────────────
//
// CBOE OSI format: compact, no root padding.
//   e.g. "SPXW260611C07275000"
//   last 8 chars   = strike×1000 zero-padded
//   char -9        = C/P
//   chars -15..-10 = YYMMDD
//   remainder      = root (SPX = 3 chars, SPXW = 4 chars)
//
// OCC format: 21 chars, root left-padded to 6 with spaces.

function osiToOcc(osi: string): Result<OccSymbol, FetchError> {
  if (osi.length < 15) {
    return err({ kind: "fetch-error", message: `OSI too short: ${osi}` });
  }

  const strikeStr = osi.slice(-8);
  const sideChar = osi.slice(-9, -8);
  const dateStr = osi.slice(-15, -9);
  const root = osi.slice(0, osi.length - 15);

  if (sideChar !== "C" && sideChar !== "P") {
    return err({ kind: "fetch-error", message: `Bad type char in OSI: ${osi}` });
  }

  const yy = parseInt(dateStr.slice(0, 2), 10);
  const mm = parseInt(dateStr.slice(2, 4), 10);
  const dd = parseInt(dateStr.slice(4, 6), 10);

  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) {
    return err({ kind: "fetch-error", message: `Bad date in OSI: ${osi}` });
  }

  const strikeRaw = parseInt(strikeStr, 10);
  if (!Number.isFinite(strikeRaw) || strikeRaw <= 0) {
    return err({ kind: "fetch-error", message: `Bad strike in OSI: ${osi}` });
  }

  const expiry = new Date(2000 + yy, mm - 1, dd);
  const strike = strikeRaw / 1000;

  const occ = formatOccSymbol({ root, expiry, type: sideChar, strike });
  return ok(occ);
}

// ─── ET timestamp → UTC Date (Pitfall 1 from RESEARCH.md) ──────────────────────
//
// CBOE timestamp: "2026-06-11 15:13:25" — ET local time, no timezone suffix.
// During EDT (Mar–Nov): UTC = ET + 4h.
// During EST (Nov–Mar): UTC = ET + 5h.
//
// Strategy: replace the space with "T", append "-04:00" (EDT) or "-05:00" (EST)
// by checking whether the parsed local date falls within DST.

function etToUtc(timestamp: string): Date {
  // Parse the ET timestamp as a local Date to detect DST for that date.
  // We normalise to ISO 8601 first.
  const normalised = timestamp.replace(" ", "T");
  // Build a Date assuming UTC to get the year/month/day only, then
  // check whether that calendar date is in EDT (UTC-4) or EST (UTC-5).
  const tempDate = new Date(`${normalised}Z`); // treat as UTC temp

  // DST in the US: second Sunday in March → first Sunday in November.
  // Use the Intl API to reliably check whether the ET timezone is currently
  // in DST (EDT = UTC-4) or standard (EST = UTC-5).
  const year = tempDate.getUTCFullYear();
  const month = tempDate.getUTCMonth(); // 0-indexed

  // DST starts on the 2nd Sunday of March (month 2) and ends on the 1st Sunday
  // of November (month 10). Check if the timestamp date is within that range.
  const isDst = isDstInET(year, month, tempDate.getUTCDate());
  const offsetStr = isDst ? "-04:00" : "-05:00";

  return new Date(`${normalised}${offsetStr}`);
}

function isDstInET(year: number, month: number, day: number): boolean {
  // DST in US: starts 2nd Sunday of March, ends 1st Sunday of November.
  // month is 0-indexed (March = 2, November = 10).
  if (month < 2 || month > 10) return false; // Jan, Feb, Dec = EST
  if (month > 2 && month < 10) return true; // Apr–Oct = EDT

  if (month === 2) {
    // March: DST starts on the 2nd Sunday
    const dstStart = nthSunday(year, 2, 2);
    return day >= dstStart;
  }

  // month === 10: November — DST ends on the 1st Sunday
  const dstEnd = nthSunday(year, 10, 1);
  return day < dstEnd;
}

function nthSunday(year: number, month: number, n: number): number {
  // Returns the calendar day of the n-th Sunday in the given month (0-indexed month).
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const date = new Date(year, month, d);
    if (date.getMonth() !== month) break;
    if (date.getDay() === 0) {
      count++;
      if (count === n) return d;
    }
  }
  return 31; // fallback (should never reach)
}

// ─── Map a CBOE option to RawQuote ───────────────────────────────────────────

function mapCboeOption(opt: CboeOption): RawQuote | null {
  const occResult = osiToOcc(opt.option);
  if (!occResult.ok) return null;

  const bid = opt.bid ?? null;
  const ask = opt.ask ?? null;
  const mark = bid !== null && ask !== null ? (bid + ask) / 2 : null;

  // Parse date from OCC symbol to get expiry Date
  const occ = occResult.value;
  const dateStr = occ.slice(6, 12); // YYMMDD part
  const yy = parseInt(dateStr.slice(0, 2), 10);
  const mm = parseInt(dateStr.slice(2, 4), 10);
  const dd = parseInt(dateStr.slice(4, 6), 10);
  const expiry = new Date(2000 + yy, mm - 1, dd);

  // Strike from OCC symbol (last 8 chars = strike×1000)
  const strikePart = occ.slice(13); // chars 13-20 = 8 strike digits
  const strikeRaw = parseInt(strikePart, 10);
  const strike = strikeRaw / 1000;

  const typeChar = occ.slice(12, 13); // char 12 = C or P

  if (typeChar !== "C" && typeChar !== "P") return null;

  return {
    occSymbol: occResult.value,
    contractType: typeChar,
    strike,
    expiry,
    bid,
    ask,
    mark,
    iv: opt.iv ?? null,
    delta: opt.delta ?? null,
    gamma: opt.gamma ?? null,
    theta: opt.theta ?? null,
    vega: opt.vega ?? null,
    openInterest: opt.open_interest ?? 0,
    volume: opt.volume ?? 0,
  };
}

// ─── Adapter factory ─────────────────────────────────────────────────────────

export type CboeChainAdapter = {
  readonly fetchChain: ForFetchingChain;
};

/**
 * makeCboeChainAdapter — CBOE delayed-quotes HTTP adapter.
 *
 * Fetches only _SPX.json (per fixture README: _SPXW.json is 403).
 * Both SPX and SPXW root contracts are in _SPX.json; filtered by OSI root prefix.
 *
 * T-02-07: CboeResponseSchema.safeParse on receipt — err on failure, never throw.
 * T-02-09: No raw template interpolation — Drizzle parameterized at persistence layer.
 * T-02-10: Only {kind, message} returned — no payload dumps.
 */
export function makeCboeChainAdapter(deps: {
  fetch: typeof globalThis.fetch;
  userAgent: string;
}): CboeChainAdapter {
  const fetchChain: ForFetchingChain = async (
    root: "SPX" | "SPXW",
  ): Promise<Result<RawChain, FetchError>> => {
    // Only _SPX.json is available (SPXW is inside it — filter by root prefix)
    let rawBody: unknown;
    try {
      const response = await deps.fetch(CBOE_SPX_URL, {
        headers: { "User-Agent": deps.userAgent },
      });
      if (!response.ok) {
        return err({
          kind: "fetch-error",
          message: `CBOE returned HTTP ${response.status}`,
        });
      }
      rawBody = await response.json();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ kind: "fetch-error", message });
    }

    // Zod-parse before core sees any data (T-02-07)
    const parsed = CboeResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      return err({
        kind: "fetch-error",
        message: `CBOE payload parse error: ${parsed.error.message}`,
      });
    }

    const payload = parsed.data;

    // Spot price resolution: current_price ?? close ?? prev_day_close (Pitfall 3)
    const spot =
      payload.data.current_price ??
      payload.data.close ??
      payload.data.prev_day_close ??
      null;

    if (spot === null || spot === 0) {
      return err({
        kind: "fetch-error",
        message: "CBOE payload missing spot price",
      });
    }

    // ET timestamp → UTC (Pitfall 1)
    const observedAt = etToUtc(payload.timestamp);

    // Filter options by root prefix (SPX = 3 chars before date, SPXW = 4 chars)
    const filteredOptions = payload.data.options.filter((opt) => {
      if (root === "SPXW") {
        return opt.option.startsWith("SPXW");
      }
      // SPX: starts with "SPX" but NOT "SPXW"
      return opt.option.startsWith("SPX") && !opt.option.startsWith("SPXW");
    });

    // Map to RawQuote, silently skip unparseable entries
    const quotes: RawQuote[] = [];
    for (const opt of filteredOptions) {
      const quote = mapCboeOption(opt);
      if (quote !== null) {
        quotes.push(quote);
      }
    }

    const chain: RawChain = {
      root,
      observedAt,
      spot,
      quotes,
    };

    return ok(chain);
  };

  return { fetchChain };
}
