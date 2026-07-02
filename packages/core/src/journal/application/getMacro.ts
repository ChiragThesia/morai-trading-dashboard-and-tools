/**
 * getMacro.ts — makeGetMacroUseCase read use-case (MAC-02).
 *
 * Reads all stored MacroObservationRow[] from the repo and groups them into
 * { [seriesId]: [{ time, value }] }, each series array sorted ASCENDING by time (D-10 —
 * opposite of COT's DESC read). Applies the default 90-day window plus optional `days`/
 * `series` filters (D-11).
 *
 * MacroSeriesQuery / MacroSeriesPointOut are defined here (not imported from contracts)
 * so the hexagon stays pure (architecture-boundaries §2: core → @morai/shared only).
 *
 * Empty store → ok({}). StorageError from the repo is propagated unchanged.
 *
 * ForRunningGetMacro is the driver port type consumed by 14-06's route + MCP tool.
 *
 * Core must not import pg-boss, Hono, process.env, or node I/O (architecture-boundaries §2).
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForReadingMacroObservations, StorageError } from "./ports.ts";

const DEFAULT_WINDOW_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Domain shapes ──────────────────────────────────────────────────────────

/**
 * MacroSeriesQuery — optional read-side filters for getMacro (D-11).
 * `days` and `series` are already Zod-validated at the route (14-06); the use-case
 * trusts the parsed numbers/list.
 */
export type MacroSeriesQuery = {
  readonly days?: number;
  readonly series?: ReadonlyArray<string>;
};

/** MacroSeriesPointOut — one time/value point in the response map (D-10). */
export type MacroSeriesPointOut = {
  readonly time: string; // YYYY-MM-DD
  readonly value: number;
};

// ─── Port type ───────────────────────────────────────────────────────────────

/** ForRunningGetMacro — driver port returned by makeGetMacroUseCase. */
export type ForRunningGetMacro = (
  query?: MacroSeriesQuery,
) => Promise<Result<Record<string, ReadonlyArray<MacroSeriesPointOut>>, StorageError>>;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * makeGetMacroUseCase — inject deps, return ForRunningGetMacro.
 *
 * The returned driver:
 *   1. Reads MacroObservationRow[] from the repo (unfiltered, unordered).
 *   2. Computes the window cutoff = (deps.now?.() ?? new Date()) minus query?.days ?? 90 days.
 *   3. Keeps rows with date >= cutoff, and (if `series` given) whose seriesId is requested.
 *   4. Groups surviving rows by seriesId, sorting each array ASCENDING by time.
 *   5. Returns ok(map); empty input → ok({}). Propagates StorageError unchanged.
 */
export function makeGetMacroUseCase(deps: {
  readonly readMacroObservations: ForReadingMacroObservations;
  readonly now?: () => Date;
}): ForRunningGetMacro {
  return async (
    query?: MacroSeriesQuery,
  ): Promise<Result<Record<string, ReadonlyArray<MacroSeriesPointOut>>, StorageError>> => {
    const result = await deps.readMacroObservations();
    if (!result.ok) {
      return result;
    }

    const now = deps.now?.() ?? new Date();
    const windowDays = query?.days ?? DEFAULT_WINDOW_DAYS;
    const cutoff = cutoffDateString(now, windowDays);
    const seriesFilter = query?.series !== undefined ? new Set(query.series) : null;

    const grouped: Record<string, Array<MacroSeriesPointOut>> = {};
    for (const row of result.value) {
      if (row.date < cutoff) {
        continue;
      }
      if (seriesFilter !== null && !seriesFilter.has(row.seriesId)) {
        continue;
      }
      const points = grouped[row.seriesId] ?? [];
      points.push({ time: row.date, value: row.value });
      grouped[row.seriesId] = points;
    }

    for (const points of Object.values(grouped)) {
      points.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    }

    return ok(grouped);
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** cutoffDateString — YYYY-MM-DD cutoff = now minus `days` days (UTC, lexicographic-comparable). */
function cutoffDateString(now: Date, days: number): string {
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY);
  return cutoff.toISOString().slice(0, 10);
}
