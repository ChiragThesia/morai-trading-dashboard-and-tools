import { z } from "zod";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForFetchingRate,
  ForFetchingFredSeries,
  RateObservation,
  MacroObservationRow,
  FetchError,
} from "@morai/core";

// FRED series-observations endpoint — shared by the DGS3MO rate adapter and the
// parameterized macro-series adapter (MAC-01).
// https://api.stlouisfed.org/fred/series/observations?series_id=...&api_key=...
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

// ─── Shared low-level fetch helper ────────────────────────────────────────────
// Mechanics shared by makeFredRateAdapter (DGS3MO, has a fallback) and
// makeFredSeriesAdapter (any series, no fallback): build URL, fetch, response.ok
// guard, Zod parse, filter '.' rows, take the most-recent non-'.' observation.

type FredFetchResult =
  | { readonly ok: true; readonly date: string; readonly value: number }
  | { readonly ok: false; readonly reason: string };

async function fetchFredSeries(
  deps: { readonly fetch: typeof globalThis.fetch; readonly apiKey: string },
  seriesId: string,
): Promise<FredFetchResult> {
  const url = new URL(FRED_BASE_URL);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", deps.apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "5");

  let rawBody: unknown;
  try {
    const response = await deps.fetch(url.toString());
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    rawBody = await response.json();
  } catch {
    return { ok: false, reason: "network error" };
  }

  const parsed = FredResponseSchema.safeParse(rawBody);
  if (parsed.success !== true) {
    return { ok: false, reason: "unexpected payload shape" };
  }

  // Filter out '.' missing-value sentinel rows (Pitfall 7)
  // Response is already sorted desc by date (sort_order=desc), so first non-'.' is most-recent
  const validObs = parsed.data.observations.filter((obs) => obs.value !== ".");

  const first = validObs[0];
  if (first === undefined) {
    return { ok: false, reason: "all observations were '.'" };
  }

  const value = parseFloat(first.value);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: "non-numeric value" };
  }

  return { ok: true, date: first.date, value };
}

// ─── Adapter factory: makeFredRateAdapter (DGS3MO, unchanged, D-02) ──────────

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

    const result = await fetchFredSeries(
      { fetch: deps.fetch, apiKey: deps.apiKey },
      "DGS3MO",
    );

    if (!result.ok) {
      // T-02-11/T-02-12: static warn text, apiKey value never logged
      console.warn(`FRED: ${result.reason}, using fallback rate`);
      return fallback();
    }

    // FRED DGS3MO is expressed as a percentage (e.g. 5.25 → 0.0525)
    return ok({ date: result.date, rate: result.value / 100 });
  };
}

// ─── Adapter factory: makeFredSeriesAdapter (parameterized, no fallback, MAC-01) ─

/**
 * makeFredSeriesAdapter — parameterized FRED series driven adapter implementing
 * ForFetchingFredSeries (MAC-01).
 *
 * Distinct from makeFredRateAdapter: NO fallback (D-09) — any failure (missing/empty
 * key, network error, non-2xx, Zod parse failure, all-'.' rows) returns
 * err({ kind: "fetch-error", ... }). Returns the RAW value with NO /100 division
 * (D-14) — VIXCLS/other index-level series must not be treated as a percentage.
 * apiKey is never logged (T-02-11/T-02-12 discipline, static warn text only).
 */
export function makeFredSeriesAdapter(deps: {
  readonly fetch: typeof globalThis.fetch;
  readonly apiKey: string | undefined;
}): ForFetchingFredSeries {
  return async (
    seriesId: string,
  ): Promise<Result<MacroObservationRow, FetchError>> => {
    // D-09: hard-require the key — no fabricated fallback on missing/empty key
    if (deps.apiKey === undefined || deps.apiKey === "") {
      console.warn("FRED: missing API key, cannot fetch series");
      return err({ kind: "fetch-error", message: "FRED API key missing" });
    }

    const result = await fetchFredSeries(
      { fetch: deps.fetch, apiKey: deps.apiKey },
      seriesId,
    );

    if (!result.ok) {
      // T-02-11/T-02-12: static warn text, apiKey value never logged
      console.warn(`FRED: ${result.reason}, no fallback for series fetch`);
      return err({ kind: "fetch-error", message: result.reason });
    }

    // D-14: RAW value, no /100 — VIXCLS etc. are index levels, not percentages
    return ok({
      seriesId,
      date: result.date,
      value: result.value,
      source: "fred",
    });
  };
}
