// economic-events.ts — FRED CPI/NFP `release/dates` client + FOMC seed union (PICK-03, D-12/D-13).
//
// Wave-0 shape spike (Task 1, RESEARCH.md Pitfall 4): before finalizing the Zod schema below,
// this session checked the execution environment for FRED_API_KEY (.env, .env.local,
// .env.example, process.env) — ABSENT in all of them. A live confirmation call to
// `https://api.stlouisfed.org/fred/release/dates` could therefore NOT be issued this session.
// Proceeding on RESEARCH.md's A3 assumed shape (cross-checked via secondary sources, not a live
// response) as the documented fallback:
//
//   GET https://api.stlouisfed.org/fred/release/dates
//     ?release_id=10   (CPI,  RESEARCH.md A1)
//     ?release_id=50   (NFP,  RESEARCH.md A1)
//     &file_type=json&include_release_dates_with_no_data=true&api_key=...
//   Response shape (A3): { release_dates: [{ release_id: number, release_name?: string, date: string }] }
//   — DIFFERENT from series/observations's { observations: [{ date, value }] } shape (fred.ts);
//     a NEW schema is required (Pitfall 4), never a reuse of fred.ts's FredResponseSchema.
//
// If this assumed shape is wrong, the Zod safeParse below fails LOUDLY (→ err, D-17) on the
// first live call rather than silently corrupting data — see 19-04-SUMMARY.md's human-check
// note: the first live cron run must be watched for a parse failure.

import { z } from "zod";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { EconomicEvent, ForFetchingEconomicEvents, FetchError } from "@morai/core";

const FRED_RELEASE_DATES_URL = "https://api.stlouisfed.org/fred/release/dates";

// RESEARCH.md A1: release_id=10 → Consumer Price Index (CPI); release_id=50 → Employment
// Situation (NFP). RESEARCH.md A3: release/dates shape, distinct from fred.ts's
// FredResponseSchema (series/observations shape) — Pitfall 4, do NOT reuse that schema.
const CPI_RELEASE_ID = 10;
const NFP_RELEASE_ID = 50;

const FredReleaseDatesSchema = z.object({
  release_dates: z.array(
    z.object({
      release_id: z.number(),
      release_name: z.string().optional(),
      date: z.string(),
    }),
  ),
});

/**
 * FOMC_SEED — maintained FOMC meeting statement-day table (D-12's sanctioned fallback for
 * FOMC only — CONTEXT.md: "a static hand-maintained FOMC seed is the FALLBACK only if no
 * programmatic source exists"; no such source exists for FOMC, RESEARCH.md A5).
 * `date` is the second (statement) day of each two-day meeting, per the official Fed calendar.
 * Refresh against https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm as new
 * schedules are published (typically ~1-2 years ahead).
 */
export const FOMC_SEED: ReadonlyArray<EconomicEvent> = [
  { date: "2025-01-29", name: "FOMC", source: "seed" },
  { date: "2025-03-19", name: "FOMC", source: "seed" },
  { date: "2025-05-07", name: "FOMC", source: "seed" },
  { date: "2025-06-18", name: "FOMC", source: "seed" },
  { date: "2025-07-30", name: "FOMC", source: "seed" },
  { date: "2025-09-17", name: "FOMC", source: "seed" },
  { date: "2025-10-29", name: "FOMC", source: "seed" },
  { date: "2025-12-10", name: "FOMC", source: "seed" },
  { date: "2026-01-28", name: "FOMC", source: "seed" },
  { date: "2026-03-18", name: "FOMC", source: "seed" },
  { date: "2026-04-29", name: "FOMC", source: "seed" },
  { date: "2026-06-17", name: "FOMC", source: "seed" },
  { date: "2026-07-29", name: "FOMC", source: "seed" },
  { date: "2026-09-16", name: "FOMC", source: "seed" },
  { date: "2026-10-28", name: "FOMC", source: "seed" },
  { date: "2026-12-09", name: "FOMC", source: "seed" },
];

async function fetchReleaseDates(
  deps: { readonly fetch: typeof globalThis.fetch; readonly apiKey: string },
  releaseId: number,
  name: "CPI" | "NFP",
): Promise<Result<ReadonlyArray<EconomicEvent>, string>> {
  const url = new URL(FRED_RELEASE_DATES_URL);
  url.searchParams.set("release_id", String(releaseId));
  url.searchParams.set("api_key", deps.apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("include_release_dates_with_no_data", "true");

  let rawBody: unknown;
  try {
    const response = await deps.fetch(url.toString());
    if (!response.ok) {
      return err(`HTTP ${response.status}`);
    }
    rawBody = await response.json();
  } catch {
    return err("network error");
  }

  const parsed = FredReleaseDatesSchema.safeParse(rawBody);
  if (parsed.success !== true) {
    return err("unexpected payload shape");
  }

  const events = parsed.data.release_dates
    .filter((row) => row.release_id === releaseId)
    .map((row): EconomicEvent => ({ date: row.date, name, source: "fred" }));

  return ok(events);
}

/**
 * makeEconomicEventsAdapter — implements ForFetchingEconomicEvents (PICK-03).
 *
 * Fetches CPI (release_id=10) and NFP (release_id=50) release dates from FRED's
 * `release/dates` endpoint, unions the results with the maintained FOMC seed, and returns
 * ONE sorted EconomicEvent[] — callers never see the two origins (RESEARCH.md Anti-Pattern:
 * never expose FRED-vs-seed as two read paths).
 *
 * No fabricated fallback (D-17): a missing/empty apiKey, non-2xx response, network error, or
 * a malformed payload (Zod safeParse failure) all return err({kind:"fetch-error"}) — the FOMC
 * seed is NOT returned alone on a FRED failure, since a partial/silently-degraded event set
 * would let the compute layer score against an incomplete calendar without knowing it.
 * apiKey is never logged (fred.ts discipline) — static warn text only.
 */
export function makeEconomicEventsAdapter(deps: {
  readonly fetch: typeof globalThis.fetch;
  readonly apiKey: string | undefined;
  readonly fomcSeed: ReadonlyArray<EconomicEvent>;
}): ForFetchingEconomicEvents {
  return async (): Promise<Result<ReadonlyArray<EconomicEvent>, FetchError>> => {
    if (deps.apiKey === undefined || deps.apiKey === "") {
      console.warn("economic-events: missing FRED API key, cannot fetch CPI/NFP release dates");
      return err({ kind: "fetch-error", message: "FRED API key missing" });
    }

    const [cpiResult, nfpResult] = await Promise.all([
      fetchReleaseDates({ fetch: deps.fetch, apiKey: deps.apiKey }, CPI_RELEASE_ID, "CPI"),
      fetchReleaseDates({ fetch: deps.fetch, apiKey: deps.apiKey }, NFP_RELEASE_ID, "NFP"),
    ]);

    if (!cpiResult.ok) {
      console.warn(`economic-events: ${cpiResult.error}, no fallback for CPI release dates`);
      return err({ kind: "fetch-error", message: cpiResult.error });
    }
    if (!nfpResult.ok) {
      console.warn(`economic-events: ${nfpResult.error}, no fallback for NFP release dates`);
      return err({ kind: "fetch-error", message: nfpResult.error });
    }

    const union = [...cpiResult.value, ...nfpResult.value, ...deps.fomcSeed].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );

    return ok(union);
  };
}
