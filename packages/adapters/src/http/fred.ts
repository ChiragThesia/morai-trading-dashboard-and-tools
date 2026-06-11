import { z } from "zod";
import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingRate, RateObservation, FetchError } from "@morai/core";

// FRED DGS3MO endpoint — 3-month Treasury Bill secondary market rate (daily)
// https://api.stlouisfed.org/fred/series/observations?series_id=DGS3MO&api_key=...
//   &file_type=json&sort_order=desc&limit=5
// Response: { observations: [{ date: "YYYY-MM-DD", value: "5.25" | "." }] }
// '.' is FRED's missing-value sentinel (Pitfall 7 — filter before use).
const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

// ─── Zod schema ───────────────────────────────────────────────────────────────

const FredObservationSchema = z.object({
  date: z.string(),
  value: z.string(),
});

const FredResponseSchema = z.object({
  observations: z.array(FredObservationSchema),
});

// ─── Fallback date helper ─────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Adapter factory ─────────────────────────────────────────────────────────

/**
 * makeFredRateAdapter — FRED DGS3MO driven adapter implementing ForFetchingRate.
 *
 * Behavior:
 * - If apiKey is absent or empty: return ok(fallback) immediately without fetching
 *   (D-02/D-13). No API key value is ever logged (T-02-11).
 * - On network error or non-2xx: log a static warn message and return ok(fallback).
 * - On Zod parse failure or all-'.' rows: return ok(fallback).
 * - On success: filter '.' rows, pick most-recent non-'.' value, divide by 100.
 *
 * Rate is returned as a decimal (e.g. 5.25% → 0.0525).
 */
export function makeFredRateAdapter(deps: {
  readonly fetch: typeof globalThis.fetch;
  readonly apiKey: string | undefined;
  readonly fallbackRate: number;
}): ForFetchingRate {
  const fallback = (): Result<RateObservation, FetchError> =>
    ok({ date: todayIso(), rate: deps.fallbackRate });

  return async (): Promise<Result<RateObservation, FetchError>> => {
    // D-02/D-13: if no API key → skip fetch, return fallback immediately
    if (deps.apiKey === undefined || deps.apiKey === "") {
      return fallback();
    }

    // Build URL — api_key is passed as a query parameter, never logged
    const url = new URL(FRED_BASE_URL);
    url.searchParams.set("series_id", "DGS3MO");
    url.searchParams.set("api_key", deps.apiKey);
    url.searchParams.set("file_type", "json");
    url.searchParams.set("sort_order", "desc");
    url.searchParams.set("limit", "5");

    let rawBody: unknown;
    try {
      const response = await deps.fetch(url.toString());
      if (!response.ok) {
        // T-02-12: non-2xx → warn with static text, return fallback
        console.warn(
          `FRED: request failed (HTTP ${response.status}), using fallback rate`,
        );
        return fallback();
      }
      rawBody = await response.json();
    } catch {
      // T-02-12: network error → warn with static text, return fallback
      console.warn("FRED: network error, using fallback rate");
      return fallback();
    }

    // T-02-13: Zod-parse before use — malformed payload → fallback
    const parsed = FredResponseSchema.safeParse(rawBody);
    if (parsed.success !== true) {
      console.warn("FRED: unexpected payload shape, using fallback rate");
      return fallback();
    }

    // Filter out '.' missing-value sentinel rows (Pitfall 7)
    // Response is already sorted desc by date (sort_order=desc), so first non-'.' is most-recent
    const validObs = parsed.data.observations.filter(
      (obs) => obs.value !== ".",
    );

    if (validObs.length === 0) {
      // All rows were '.', use fallback
      return fallback();
    }

    const first = validObs[0];
    // TypeScript noUncheckedIndexedAccess: first is possibly undefined
    if (first === undefined) {
      return fallback();
    }

    const ratePercent = parseFloat(first.value);
    if (!Number.isFinite(ratePercent)) {
      return fallback();
    }

    // FRED DGS3MO is expressed as a percentage (e.g. 5.25 → 0.0525)
    return ok({ date: first.date, rate: ratePercent / 100 });
  };
}
