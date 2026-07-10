import { z } from "zod";

// Regime contracts (Phase 24 — MCP-02: ONE schema source for the future
// GET /api/analytics/regime route + get_regime MCP tool, BOARD-01/02).
//
// regimeIndicator.asOf is a date-only string (D-10/macro precedent, z.string().date()) so the
// contract itself forbids an intraday timestamp (MACRO-03) — EOD data, never presented as "now".
//
// regimeIndicator.band/rationale/source carry provenance in the payload (BOARD-02) — the UI
// renders these fields, it does not hardcode band copy.

export const regimeBand = z.enum(["calm", "warning", "crisis"]);

export type RegimeBand = z.infer<typeof regimeBand>;

export const regimeIndicator = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number(),
  band: regimeBand,
  bandWarn: z.number(), // the warn threshold actually used to compute `band` (effective, Phase-29 overrides-aware)
  bandCrisis: z.number(), // the crisis threshold actually used to compute `band`
  asOf: z.string().date(),
  source: z.string(),
  rationale: z.string(),
  inputs: z.record(z.string(), z.number()).optional(),
});

export type RegimeIndicator = z.infer<typeof regimeIndicator>;

export const regimeResponse = z.array(regimeIndicator);

export type RegimeResponse = z.infer<typeof regimeResponse>;
