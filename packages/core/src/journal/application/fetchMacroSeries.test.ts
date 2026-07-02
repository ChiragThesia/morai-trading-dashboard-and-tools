/**
 * fetchMacroSeries.test.ts — makeFetchMacroSeries orchestration use-case (MAC-01).
 *
 * Tests verify:
 *   1. all 8 fetches succeed → every row persisted, driver returns ok(void)
 *   2. 2 series fail (fetch err) → 6 successes STILL persisted, driver returns err
 *      naming both failed series (best-effort + fail-loud finish, D-07)
 *   3. a persist failure on one series does not block attempting the others; the
 *      finish still returns err naming the persist-failed series
 *   4. a rejected fetch promise is absorbed (not a hard crash) and counted as failed
 *
 * Test doubles are inline function implementations (core cannot import adapters —
 * architecture-boundaries §2). No any/as/! (typescript.md). All promises awaited.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type {
  ForFetchingFredSeries,
  ForFetchingVvixQuote,
  ForPersistingMacroObservation,
  MacroObservationRow,
} from "./ports.ts";
import { makeFetchMacroSeries, DEFAULT_FRED_SERIES_IDS } from "./fetchMacroSeries.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRow(seriesId: string): MacroObservationRow {
  return {
    seriesId,
    date: "2026-07-01",
    value: 1.23,
    source: seriesId === "VVIX" ? "cboe" : "fred",
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeFetchMacroSeries", () => {
  it("persists every row and returns ok(void) when all 8 series succeed", async () => {
    const persisted: Array<MacroObservationRow> = [];
    const fetchFredSeries: ForFetchingFredSeries = async (seriesId) => ok(makeRow(seriesId));
    const fetchVvixQuote: ForFetchingVvixQuote = async () => ok(makeRow("VVIX"));
    const persistMacroObservation: ForPersistingMacroObservation = async (row) => {
      persisted.push(row);
      return ok(undefined);
    };

    const fetchMacroSeries = makeFetchMacroSeries({
      fetchFredSeries,
      fetchVvixQuote,
      persistMacroObservation,
    });

    const result = await fetchMacroSeries();

    expect(result.ok).toBe(true);
    expect(persisted).toHaveLength(8);
    expect(persisted.map((r) => r.seriesId).sort()).toEqual(
      [...DEFAULT_FRED_SERIES_IDS, "VVIX"].sort(),
    );
  });

  it("persists the 6 successes and returns err naming both failed series when 2 fetches fail", async () => {
    const persisted: Array<MacroObservationRow> = [];
    const fetchFredSeries: ForFetchingFredSeries = async (seriesId) => {
      if (seriesId === "DFF" || seriesId === "SOFR") {
        return err({ kind: "fetch-error" as const, message: `${seriesId} unavailable` });
      }
      return ok(makeRow(seriesId));
    };
    const fetchVvixQuote: ForFetchingVvixQuote = async () => ok(makeRow("VVIX"));
    const persistMacroObservation: ForPersistingMacroObservation = async (row) => {
      persisted.push(row);
      return ok(undefined);
    };

    const fetchMacroSeries = makeFetchMacroSeries({
      fetchFredSeries,
      fetchVvixQuote,
      persistMacroObservation,
    });

    const result = await fetchMacroSeries();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("DFF");
      expect(result.error.message).toContain("SOFR");
    }
    // successes STILL persisted even though the overall Result is err (D-07)
    expect(persisted).toHaveLength(6);
    const persistedIds = persisted.map((r) => r.seriesId);
    expect(persistedIds).not.toContain("DFF");
    expect(persistedIds).not.toContain("SOFR");
  });

  it("counts a persist failure in the finish without blocking attempts on other series", async () => {
    const persisted: Array<string> = [];
    const fetchFredSeries: ForFetchingFredSeries = async (seriesId) => ok(makeRow(seriesId));
    const fetchVvixQuote: ForFetchingVvixQuote = async () => ok(makeRow("VVIX"));
    const persistMacroObservation: ForPersistingMacroObservation = async (row) => {
      if (row.seriesId === "SOFR") {
        return err({ kind: "storage-error" as const, message: "db down" });
      }
      persisted.push(row.seriesId);
      return ok(undefined);
    };

    const fetchMacroSeries = makeFetchMacroSeries({
      fetchFredSeries,
      fetchVvixQuote,
      persistMacroObservation,
    });

    const result = await fetchMacroSeries();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("SOFR");
    }
    // 7 of 8 series persisted successfully — SOFR's persist failed but the others still attempted
    expect(persisted).toHaveLength(7);
    expect(persisted).not.toContain("SOFR");
  });

  it("absorbs a rejected fetch promise as a failed series instead of crashing the batch", async () => {
    const persisted: Array<string> = [];
    const fetchFredSeries: ForFetchingFredSeries = async (seriesId) => {
      if (seriesId === "T10Y2Y") {
        throw new Error("network exploded");
      }
      return ok(makeRow(seriesId));
    };
    const fetchVvixQuote: ForFetchingVvixQuote = async () => ok(makeRow("VVIX"));
    const persistMacroObservation: ForPersistingMacroObservation = async (row) => {
      persisted.push(row.seriesId);
      return ok(undefined);
    };

    const fetchMacroSeries = makeFetchMacroSeries({
      fetchFredSeries,
      fetchVvixQuote,
      persistMacroObservation,
    });

    const result = await fetchMacroSeries();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("T10Y2Y");
    }
    expect(persisted).toHaveLength(7);
    expect(persisted).not.toContain("T10Y2Y");
  });
});
