import { ok, err, formatOccSymbol, assertDefined } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForGettingCalendarById,
  ForReadingLatestLegObs,
  StorageError,
} from "./ports.ts";
import { resolveRootCandidates } from "../domain/occ-root.ts";

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
    // Step 2: construct candidate OCC symbols for both legs. HIST-01: front/back can
    // carry DIFFERENT real roots (e.g. SPX monthly front + SPXW EOM back) even though
    // calendars.underlying stores only one — try the stored root first, then its sibling.
    const roots = resolveRootCandidates(cal.underlying);
    const strikePoints = cal.strike / 1000; // ×1000 int → points

    // Step 3+4: resolve each leg observation by trying each candidate root in order;
    // first non-null hit wins. No candidate resolves → honest gap (D-04): NaN-stamp
    // under the primary (calendar's stored) root, same occSymbol the old code reported.
    const legs: LegGreeks[] = [];
    for (const expiry of [cal.frontExpiry, cal.backExpiry]) {
      const candidates = roots.map((root) =>
        formatOccSymbol({
          root,
          expiry: new Date(expiry + "T12:00:00Z"),
          type: cal.optionType,
          strike: strikePoints,
        }),
      );
      const primaryOcc = candidates[0];
      // resolveRootCandidates never returns an empty array, so candidates (built 1:1
      // from roots) always has a first element — this satisfies noUncheckedIndexedAccess.
      assertDefined(primaryOcc, "getLiveGreeks: resolveRootCandidates returned no roots");

      let leg: LegGreeks | null = null;
      for (const occ of candidates) {
        const obsResult = await deps.getLatestLegObs(occ);
        if (!obsResult.ok) return err(obsResult.error);
        const obs = obsResult.value;
        if (obs === null) continue;
        leg = {
          occSymbol: occ,
          bsmIv: obs.bsmIv ?? NAN_STAMP,
          bsmDelta: obs.bsmDelta ?? NAN_STAMP,
          bsmGamma: obs.bsmGamma ?? NAN_STAMP,
          bsmTheta: obs.bsmTheta ?? NAN_STAMP,
          bsmVega: obs.bsmVega ?? NAN_STAMP,
        };
        break;
      }
      legs.push(
        leg ?? {
          occSymbol: primaryOcc,
          bsmIv: NAN_STAMP,
          bsmDelta: NAN_STAMP,
          bsmGamma: NAN_STAMP,
          bsmTheta: NAN_STAMP,
          bsmVega: NAN_STAMP,
        },
      );
    }

    return ok({ calendarId, legs });
  };
}
