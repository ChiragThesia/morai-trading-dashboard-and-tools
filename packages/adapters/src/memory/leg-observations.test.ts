/**
 * Memory leg-observations adapter — unit tests (no Docker required).
 * Covers getLatestLegObs hit/miss semantics.
 */
import { describe, it, expect } from "vitest";
import { formatOccSymbol } from "@morai/shared";
import type { ObservationRow } from "@morai/core";
import { makeMemoryLegObservationsRepo } from "./leg-observations.ts";

const OCC_FRONT = formatOccSymbol({
  root: "SPXW",
  expiry: new Date(2026, 5, 20),
  type: "C",
  strike: 7100,
});

const OCC_BACK = formatOccSymbol({
  root: "SPX",
  expiry: new Date(2026, 8, 18),
  type: "C",
  strike: 7100,
});

function makeObsRow(contract: typeof OCC_FRONT, time: Date, mark = 25.4): ObservationRow {
  return {
    time,
    contract,
    bid: 25.3,
    ask: 25.5,
    mark,
    underlyingPrice: 7274.14,
    iv: 0.3761,
    delta: 0.498,
    gamma: 0.0061,
    theta: -25.88,
    vega: 0.6955,
    openInterest: 100,
    volume: 200,
    source: "cboe" as const,
  };
}

describe("makeMemoryLegObservationsRepo", () => {
  describe("getLatestLegObs", () => {
    it("returns null for an unknown OCC symbol (miss)", async () => {
      const repo = makeMemoryLegObservationsRepo();
      const result = await repo.getLatestLegObs(OCC_FRONT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("returns the LegSnapshot for a known OCC symbol after persist (hit)", async () => {
      const repo = makeMemoryLegObservationsRepo();
      const t1 = new Date("2026-06-14T15:00:00.000Z");
      t1.setMilliseconds(0);
      const obs = makeObsRow(OCC_FRONT, t1, 42.5);
      await repo.persistObservations([obs]);

      const result = await repo.getLatestLegObs(OCC_FRONT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      if (result.value === null) return;
      expect(result.value.occSymbol).toBe(OCC_FRONT);
      expect(result.value.mark).toBeCloseTo(42.5, 5);
    });

    it("returns the LATEST observation when multiple exist for the same symbol (ORDER BY time DESC LIMIT 1)", async () => {
      const repo = makeMemoryLegObservationsRepo();
      const t1 = new Date("2026-06-14T15:00:00.000Z");
      t1.setMilliseconds(0);
      const t2 = new Date("2026-06-14T15:30:00.000Z");
      t2.setMilliseconds(0);

      await repo.persistObservations([makeObsRow(OCC_FRONT, t1, 10.0)]);
      await repo.persistObservations([makeObsRow(OCC_FRONT, t2, 99.99)]);

      const result = await repo.getLatestLegObs(OCC_FRONT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      if (result.value === null) return;
      expect(result.value.mark).toBeCloseTo(99.99, 2);
    });

    it("returns null for OCC_BACK when only OCC_FRONT has observations", async () => {
      const repo = makeMemoryLegObservationsRepo();
      const t1 = new Date("2026-06-14T15:00:00.000Z");
      t1.setMilliseconds(0);
      await repo.persistObservations([makeObsRow(OCC_FRONT, t1, 25.4)]);

      const result = await repo.getLatestLegObs(OCC_BACK);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("bsm fields are null when no bsm write has occurred", async () => {
      const repo = makeMemoryLegObservationsRepo();
      const t1 = new Date("2026-06-14T15:00:00.000Z");
      t1.setMilliseconds(0);
      await repo.persistObservations([makeObsRow(OCC_FRONT, t1)]);

      const result = await repo.getLatestLegObs(OCC_FRONT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      if (result.value === null) return;
      expect(result.value.bsmIv).toBeNull();
      expect(result.value.bsmDelta).toBeNull();
    });
  });
});
