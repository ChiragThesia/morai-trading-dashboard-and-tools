import { z } from "zod";

// Macro contracts (MCP-02: ONE schema source for GET /api/analytics/macro + get_macro MCP tool).
//
// macroSeriesPoint.time is a YYYY-MM-DD date string (D-10) — matches FRED's native
// granularity and COT's asOf precedent, not an intraday instant.
//
// macroResponse is a map keyed by series id (z.record two-arg form — Zod v4; one-arg is a
// TS2554 error; status.ts precedent). Values are time-ordered ascending per series (grouping/
// ordering happens in getMacro.ts, plan 14-04) — {} is the valid no-data case.

export const macroSeriesPoint = z.object({
  time: z.string().date(),
  value: z.number(),
});

export type MacroSeriesPoint = z.infer<typeof macroSeriesPoint>;

export const macroResponse = z.record(z.string(), z.array(macroSeriesPoint));

export type MacroResponse = z.infer<typeof macroResponse>;

/**
 * MACRO_SERIES_IDS — the ten series ingested by fetch-rates (9 FRED + VVIX via CBOE).
 * BAMLH0A0HYM2 (HY OAS) added Phase 24 — see docs/architecture/regime-board.md.
 */
export const MACRO_SERIES_IDS = [
  "DFF",
  "DGS1MO",
  "DGS3MO",
  "SOFR",
  "T10Y2Y",
  "T10Y3M",
  "VIXCLS",
  "VVIX",
  "VXVCLS",
  "BAMLH0A0HYM2",
] as const;

export const macroSeriesId = z.enum(MACRO_SERIES_IDS);

export type MacroSeriesId = z.infer<typeof macroSeriesId>;

/**
 * macroQuery — optional GET /api/analytics/macro + get_macro MCP tool request params (D-11).
 *
 * days: caps the window at 1825 (5y); the use-case layer defaults to a 90-day window when
 * omitted. series: CSV of known series ids parsed into a string array the route/use-case can
 * filter on — rejects any token not in MACRO_SERIES_IDS (T-14-01).
 */
export const macroQuery = z.object({
  days: z.coerce.number().int().positive().max(1825).optional(),
  series: z
    .string()
    .transform((value) => value.split(","))
    .pipe(z.array(macroSeriesId))
    .optional(),
});

export type MacroQuery = z.infer<typeof macroQuery>;
