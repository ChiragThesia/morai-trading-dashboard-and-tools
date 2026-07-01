import { z } from "zod";
import { err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingCotReport, CotReport, FetchError } from "@morai/core";

// CFTC Socrata — Traders in Financial Futures (TFF), Futures-Only dataset
// https://publicreporting.cftc.gov/resource/gpe5-46if.json
// E-mini S&P 500 contract code: 13874A (TFF futures-only; '13874+' is a different combined code)
// Anonymous access — no app token needed (~1000 req/hour; far under weekly job rate).
// Do NOT send X-App-Token (landmine 7 — keep tokens out of code/logs).
const CFTC_BASE_URL =
  "https://publicreporting.cftc.gov/resource/gpe5-46if.json";

// ─── Zod schema ───────────────────────────────────────────────────────────────

// LANDMINE 1: Socrata returns ALL numeric fields as JSON strings (e.g. "2987456").
// z.coerce.number() handles string→number coercion before any use.
const CftcRowSchema = z.object({
  // Date field: ISO floating timestamp e.g. "2026-06-23T00:00:00.000"
  // Validate the YYYY-MM-DD prefix before slicing (WR-02: parse-don't-cast at trust boundary).
  // A non-ISO value like "06/23/2026" or "garbage" fails here rather than producing a
  // garbage asOf that only blows up at the route's cotResponse.parse() later.
  report_date_as_yyyy_mm_dd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, "expected ISO date prefix YYYY-MM-DD"),
  cftc_contract_market_code: z.string(),
  open_interest_all: z.coerce.number(),
  // LANDMINE 8 (2026-07-01): the TFF dataset uses the '_all' suffix ONLY on dealer,
  // nonrept, and open_interest. asset_mgr / lev_money / other_rept position fields have
  // NO '_all' suffix. Mismatched names silently fail schema validation → the whole
  // fetch-cot job errors. Verified against live gpe5-46if.json.
  dealer_positions_long_all: z.coerce.number(),
  dealer_positions_short_all: z.coerce.number(),
  asset_mgr_positions_long: z.coerce.number(),
  asset_mgr_positions_short: z.coerce.number(),
  lev_money_positions_long: z.coerce.number(),
  lev_money_positions_short: z.coerce.number(),
  other_rept_positions_long: z.coerce.number(),
  other_rept_positions_short: z.coerce.number(),
  nonrept_positions_long_all: z.coerce.number(),
  nonrept_positions_short_all: z.coerce.number(),
});

type CftcRow = z.infer<typeof CftcRowSchema>;

const CftcResponseSchema = z.array(CftcRowSchema);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapRowToReport(row: CftcRow): CotReport {
  return {
    contractCode: row.cftc_contract_market_code,
    // asOf is the date part of the Socrata timestamp field (landmine 3: never date-math)
    asOf: row.report_date_as_yyyy_mm_dd.slice(0, 10),
    openInterest: row.open_interest_all,
    dealerLong: row.dealer_positions_long_all,
    dealerShort: row.dealer_positions_short_all,
    assetMgrLong: row.asset_mgr_positions_long,
    assetMgrShort: row.asset_mgr_positions_short,
    levMoneyLong: row.lev_money_positions_long,
    levMoneyShort: row.lev_money_positions_short,
    otherReptLong: row.other_rept_positions_long,
    otherReptShort: row.other_rept_positions_short,
    nonreptLong: row.nonrept_positions_long_all,
    nonreptShort: row.nonrept_positions_short_all,
  };
}

function fetchError(message: string): Result<CotReport, FetchError> {
  return err({ kind: "fetch-error", message });
}

// ─── Adapter factory ─────────────────────────────────────────────────────────

/**
 * makeCftcCotAdapter — CFTC Socrata TFF HTTP adapter implementing ForFetchingCotReport.
 *
 * Behavior:
 * - Fetches the latest TFF row for `contractCode` from gpe5-46if.json.
 * - Uses `$where=cftc_contract_market_code='<contractCode>'` (exact code, landmine 2).
 * - Coerces Socrata string-numbers to JS numbers with z.coerce.number() (landmine 1).
 * - Sets asOf from report_date_as_yyyy_mm_dd (date part only; landmine 3).
 * - No app token sent — anonymous access is sufficient for weekly job (landmine 7).
 * - NO fabricated fallback (landmine 4): any error returns err(FetchError), never a fake row.
 *   The adapter never throws — every branch returns a Result.
 */
export function makeCftcCotAdapter(deps: {
  readonly fetch: typeof globalThis.fetch;
}): ForFetchingCotReport {
  return async (
    contractCode: string,
  ): Promise<Result<CotReport, FetchError>> => {
    // WR-01: guard contractCode against SoQL injection before building the $where clause.
    // CFTC codes are alphanumeric plus optional '+' (e.g. "13874A", "13874+").
    // Any other character (quotes, semicolons, spaces, SoQL operators) is rejected here —
    // no URL is built and fetch is never called.
    if (!/^[0-9A-Z+]+$/i.test(contractCode)) {
      console.warn(
        `CFTC: invalid contractCode format (rejected before fetch): ${contractCode}`,
      );
      return fetchError(`invalid contractCode format: ${contractCode}`);
    }

    // Build query URL — no X-App-Token header (anonymous access, landmine 7)
    const url = new URL(CFTC_BASE_URL);
    url.searchParams.set(
      "$where",
      `cftc_contract_market_code='${contractCode}'`,
    );
    url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
    url.searchParams.set("$limit", "1");

    let rawBody: unknown;
    try {
      const response = await deps.fetch(url.toString());
      if (!response.ok) {
        // T-13-02: non-2xx → warn with static text, return err (no throw, no fallback)
        console.warn(
          `CFTC: request failed (HTTP ${response.status}) for contract ${contractCode}`,
        );
        return fetchError(
          `CFTC Socrata returned HTTP ${response.status}`,
        );
      }
      rawBody = await response.json();
    } catch {
      // T-13-02: network error → warn with static text, return err (no throw)
      console.warn(
        `CFTC: network error fetching TFF row for contract ${contractCode}`,
      );
      return fetchError("CFTC Socrata network error");
    }

    // Zod-parse before use (T-13-02: untrusted external JSON at trust boundary)
    const parsed = CftcResponseSchema.safeParse(rawBody);
    if (parsed.success !== true) {
      console.warn(
        `CFTC: unexpected payload shape for contract ${contractCode}`,
      );
      return fetchError("CFTC Socrata payload failed schema validation");
    }

    // Landmine 4: empty array → no fabricated fallback → err
    if (parsed.data.length === 0) {
      console.warn(
        `CFTC: empty result set for contract ${contractCode} (no rows returned)`,
      );
      return fetchError(`No CFTC TFF row found for contract ${contractCode}`);
    }

    // noUncheckedIndexedAccess guard — TypeScript requires the undefined check
    const first = parsed.data[0];
    if (first === undefined) {
      console.warn(`CFTC: unexpected undefined first row for ${contractCode}`);
      return fetchError("CFTC: unexpected undefined first row");
    }

    return { ok: true, value: mapRowToReport(first) };
  };
}
