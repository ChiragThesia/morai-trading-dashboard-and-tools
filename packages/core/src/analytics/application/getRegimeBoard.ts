/**
 * getRegimeBoard.ts — makeGetRegimeBoardUseCase (BOARD-01/02/03, MACRO-03).
 *
 * Reads all macro_observations rows via the EXISTING ForReadingMacroObservations port
 * (journal bounded context, zero new repo — 24-RESEARCH.md), keeps the latest (max-date)
 * row per series, and computes the 4 regime indicators (vix-term-structure, vvix,
 * vix9d-vix, hy-oas) with band + provenance + as-of.
 *
 * An indicator whose required input series has no row is OMITTED — never fabricated
 * (T-24-09). A ratio indicator's asOf is the OLDER of its two input dates — never
 * overstates freshness (T-24-10, MACRO-03).
 *
 * RegimeIndicatorOut is a core-local type (core cannot import @morai/contracts,
 * architecture-boundaries §2) structurally matching contracts' regimeIndicator; the
 * route/MCP tool parse it through regimeResponse at the edge.
 *
 * Empty store → ok([]). StorageError from the repo propagates unchanged.
 *
 * Hexagon law (architecture-boundaries §2): imports only @morai/shared + local ports +
 * the journal context's public port surface (rule 7 — crossing through application ports,
 * not journal's domain/).
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReadingMacroObservations,
  MacroObservationRow,
  StorageError,
} from "../../journal/index.ts";
import { bandVixTermStructure, bandVvix, bandVix9dRatio, bandHyOas } from "../domain/regime.ts";
import type { RegimeBand } from "../domain/regime.ts";

// ─── Domain shapes ──────────────────────────────────────────────────────────

/** RegimeIndicatorOut — one board row (core-local mirror of contracts' regimeIndicator). */
export type RegimeIndicatorOut = {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly band: RegimeBand;
  readonly asOf: string; // YYYY-MM-DD, observation date — never now() (MACRO-03)
  readonly source: string;
  readonly rationale: string;
  readonly inputs: Record<string, number>;
};

// ─── Port type ───────────────────────────────────────────────────────────────

export type GetRegimeBoardDeps = {
  readonly readMacroObservations: ForReadingMacroObservations;
};

/** ForRunningGetRegimeBoard — driver port returned by makeGetRegimeBoardUseCase. */
export type ForRunningGetRegimeBoard = () => Promise<
  Result<ReadonlyArray<RegimeIndicatorOut>, StorageError>
>;

// ─── Indicator metadata (BOARD-02: source + rationale ship in the payload, not UI copy) ──
// Summarized from docs/architecture/regime-board.md's Admitted Indicators table.

const META = {
  "vix-term-structure": {
    label: "VIX/VIX3M Term Structure",
    source: "eco3min.fr (VIX backwardation/contango study), systemtrader.co (VIX/VIX3M tracker)",
    rationale:
      "User's 0.90 warn / 0.95 crisis prior confirmed by independent sources: contango dominates ~85% of trading days; backwardation (ratio >= 1.0) has historically preceded major drawdowns.",
  },
  vvix: {
    label: "VVIX",
    source: "SpotGamma, TOS Indicators, Volatility Box, CapTrader",
    rationale:
      "100 warn confirmed directly by 4 independent sources (normal/elevated boundary). 115 crisis is a cited interpolation inside the documented 110-120 elevated-to-extreme-fear zone, already TOS-tested by the user.",
  },
  "vix9d-vix": {
    label: "VIX9D/VIX",
    source: "topstep.com, macroption.com, cboe.com",
    rationale:
      "[ASSUMED] No source gives a backtested numeric cut; bands are a structural analogy to the VIX/VIX3M ratio (>1.0 = near-curve inversion = stress). Display-only — no hard gate without a dedicated backtest.",
  },
  "hy-oas": {
    label: "HY OAS (Credit Spread)",
    source: "eco3min.fr (HY OAS recession-signal study), macroradar.io, convextrade.com",
    rationale:
      "[ASSUMED, newly-calibrated] Synthesized from 3 practitioner sources: spreads above 800bp have historically coincided with or preceded recession; below ~300-350bp signals late-cycle complacency.",
  },
} as const;

// ─── Factory ──────────────────────────────────────────────────────────────────

export function makeGetRegimeBoardUseCase(deps: GetRegimeBoardDeps): ForRunningGetRegimeBoard {
  return async (): Promise<Result<ReadonlyArray<RegimeIndicatorOut>, StorageError>> => {
    const result = await deps.readMacroObservations();
    if (!result.ok) {
      return result;
    }

    const latest = latestRowPerSeries(result.value);
    const indicators: Array<RegimeIndicatorOut> = [];

    const vixCls = latest.get("VIXCLS");
    const vxvcls = latest.get("VXVCLS");
    if (vixCls !== undefined && vxvcls !== undefined) {
      const value = vixCls.value / vxvcls.value;
      indicators.push({
        id: "vix-term-structure",
        ...META["vix-term-structure"],
        value,
        band: bandVixTermStructure(value),
        asOf: olderDate(vixCls.date, vxvcls.date),
        inputs: { VIXCLS: vixCls.value, VXVCLS: vxvcls.value },
      });
    }

    const vvix = latest.get("VVIX");
    if (vvix !== undefined) {
      indicators.push({
        id: "vvix",
        ...META.vvix,
        value: vvix.value,
        band: bandVvix(vvix.value),
        asOf: vvix.date,
        inputs: { VVIX: vvix.value },
      });
    }

    const vix9d = latest.get("VIX9D");
    if (vix9d !== undefined && vixCls !== undefined) {
      const value = vix9d.value / vixCls.value;
      indicators.push({
        id: "vix9d-vix",
        ...META["vix9d-vix"],
        value,
        band: bandVix9dRatio(value),
        asOf: olderDate(vix9d.date, vixCls.date),
        inputs: { VIX9D: vix9d.value, VIXCLS: vixCls.value },
      });
    }

    const hyOas = latest.get("BAMLH0A0HYM2");
    if (hyOas !== undefined) {
      indicators.push({
        id: "hy-oas",
        ...META["hy-oas"],
        value: hyOas.value,
        band: bandHyOas(hyOas.value),
        asOf: hyOas.date,
        inputs: { BAMLH0A0HYM2: hyOas.value },
      });
    }

    return ok(indicators);
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** latestRowPerSeries — the MAX-date row per seriesId (YYYY-MM-DD, lexicographically comparable). */
function latestRowPerSeries(
  rows: ReadonlyArray<MacroObservationRow>,
): Map<string, MacroObservationRow> {
  const latest = new Map<string, MacroObservationRow>();
  for (const row of rows) {
    const current = latest.get(row.seriesId);
    if (current === undefined || row.date > current.date) {
      latest.set(row.seriesId, row);
    }
  }
  return latest;
}

/** olderDate — the OLDER (min) of two YYYY-MM-DD dates — never overstate freshness (MACRO-03). */
function olderDate(a: string, b: string): string {
  return a < b ? a : b;
}
