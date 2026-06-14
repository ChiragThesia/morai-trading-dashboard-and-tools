import { ok, err, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForGettingCalendarById,
  ForReadingLatestLegObs,
  StorageError,
} from "./ports.ts";

// ─── Core output types ────────────────────────────────────────────────────────
// Matches liveGreeksResponse in @morai/contracts; defined here in core
// so the use-case can return a strongly-typed value without importing contracts
// (hexagon must not import @morai/contracts — adapters parse at the boundary).

export type LegGreeks = {
  readonly occSymbol: string;
  readonly bsmIv: string;
  readonly bsmDelta: string;
  readonly bsmGamma: string;
  readonly bsmTheta: string;
  readonly bsmVega: string;
};

export type LiveGreeks = {
  readonly calendarId: string;
  readonly legs: ReadonlyArray<LegGreeks>;
};

// ─── Driver port + deps ───────────────────────────────────────────────────────

export type GetLiveGreeksDeps = {
  readonly getCalendar: ForGettingCalendarById;
  readonly getLatestLegObs: ForReadingLatestLegObs;
};

export type ForRunningGetLiveGreeks = (
  calendarId: string,
) => Promise<Result<LiveGreeks, StorageError>>;

const NAN_STAMP = "NaN";

/**
 * makeGetLiveGreeksUseCase — factory returning the ForRunningGetLiveGreeks driver port.
 *
 * Algorithm (SPEC §7 / plan 03-06 Task 1):
 * 1. getCalendar(calendarId) → null → ok({ calendarId, legs: [] }) (never an error)
 * 2. Build front + back OCC symbols via formatOccSymbol({ root, expiry, type, strike: cal.strike/1000 })
 *    — same ×1000→points conversion as calendars.ts getOpenCalendarLegs.
 * 3. getLatestLegObs(occSymbol) for each leg.
 * 4. Missing observation → leg entry with NaN bsm fields (never throws).
 * 5. Return ok({ calendarId, legs }).
 *
 * No direct DB access — only injected ports (hexagon law).
 */
export function makeGetLiveGreeksUseCase(deps: GetLiveGreeksDeps): ForRunningGetLiveGreeks {
  return async (calendarId) => {
    // Step 1: resolve the calendar
    const calResult = await deps.getCalendar(calendarId);
    if (!calResult.ok) return err(calResult.error);
    if (calResult.value === null) {
      // Unknown calendar — return empty legs, never an error (SPEC §7)
      return ok({ calendarId, legs: [] });
    }

    const cal = calResult.value;
    // Step 2: construct OCC symbols for both legs
    // Root: underlying === "SPXW" → "SPXW"; otherwise "SPX" (mirrors calendars.ts)
    const root: "SPX" | "SPXW" = cal.underlying === "SPXW" ? "SPXW" : "SPX";
    const strikePoints = cal.strike / 1000; // ×1000 int → points

    const frontOcc = formatOccSymbol({
      root,
      expiry: new Date(cal.frontExpiry + "T12:00:00Z"),
      type: cal.optionType,
      strike: strikePoints,
    });
    const backOcc = formatOccSymbol({
      root,
      expiry: new Date(cal.backExpiry + "T12:00:00Z"),
      type: cal.optionType,
      strike: strikePoints,
    });

    // Step 3+4: resolve each leg observation; missing → NaN fields
    const legs: LegGreeks[] = [];
    for (const occ of [frontOcc, backOcc]) {
      const obsResult = await deps.getLatestLegObs(occ);
      if (!obsResult.ok) return err(obsResult.error);

      const obs = obsResult.value;
      if (obs === null) {
        // No observation for this leg — NaN stamp all bsm fields
        legs.push({
          occSymbol: occ,
          bsmIv: NAN_STAMP,
          bsmDelta: NAN_STAMP,
          bsmGamma: NAN_STAMP,
          bsmTheta: NAN_STAMP,
          bsmVega: NAN_STAMP,
        });
      } else {
        legs.push({
          occSymbol: occ,
          bsmIv: obs.bsmIv ?? NAN_STAMP,
          bsmDelta: obs.bsmDelta ?? NAN_STAMP,
          bsmGamma: obs.bsmGamma ?? NAN_STAMP,
          bsmTheta: obs.bsmTheta ?? NAN_STAMP,
          bsmVega: obs.bsmVega ?? NAN_STAMP,
        });
      }
    }

    return ok({ calendarId, legs });
  };
}
