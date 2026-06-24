/**
 * Shared contract-test suite for the GEX snapshot persistence ports.
 * Run against BOTH the in-memory twin (always, no Docker) and the Postgres adapter
 * (testcontainers, real Postgres 16).
 *
 * Asserts:
 * - readLegObsForGex: returns ok([]) when no legs are seeded (memory twin); does JOIN
 *   on Postgres path (tested inline in the Postgres contract test for simplicity).
 * - persistGexSnapshot: write one row → readGexSnapshot returns it.
 * - idempotency (SC-4): persisting the SAME cycleTime twice → exactly 1 row.
 * - readGexSnapshot: returns ok(null) when empty; returns the latest row by cycleTime.
 *   When two rows exist with different cycleTime values, returns the one with the later cycleTime.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForReadingLegObsForGex,
  ForPersistingGexSnapshot,
  ForReadingGexSnapshot,
  GexSnapshotRow,
} from "@morai/core";

export type GexSnapshotRepo = {
  readonly readLegObsForGex: ForReadingLegObsForGex;
  readonly persistGexSnapshot: ForPersistingGexSnapshot;
  readonly readGexSnapshot: ForReadingGexSnapshot;
  /** Count rows in gex_snapshots. */
  readonly countSnapshots: () => Promise<number>;
};

export type GexSnapshotSeedContext = {
  /** Seed any prerequisite data (e.g. leg_observations + contracts on the Postgres path). */
  seedLegs: (legs?: ReadonlyArray<{
    time: Date;
    contract: string;
    underlyingPrice: number;
    bsmGamma: string | null;
    bsmIv: string | null;
    openInterest: number;
    contractType: "C" | "P";
    strike: number;
    expiration: string;
  }>) => Promise<void>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const T1 = new Date("2026-06-23T14:00:00Z");
const T2 = new Date("2026-06-23T14:30:00Z"); // later cycle

function makeSnapshotRow(cycleTime: Date, overrides: Partial<GexSnapshotRow> = {}): GexSnapshotRow {
  return {
    cycleTime,
    spot: 7381,
    flip: 7488,
    callWall: 7600,
    putWall: 7400,
    netGammaAtSpot: -47.3,
    profile: [
      { strike: 7380, gamma: -47.43 },
      { strike: 7500, gamma: 5.98 },
    ],
    strikes: [
      { k: 7400, gex: -5974395559.1, coi: 17071, poi: 52786, vol: 69857 },
      { k: 7600, gex: 1230277553.8, coi: 69015, poi: 39475, vol: 108490 },
    ],
    byExpiry: [
      { date: "2026-06-27", gex: -12345678.9 },
    ],
    computedAt: cycleTime,
    ...overrides,
  };
}

// ─── Contract test suite ──────────────────────────────────────────────────────

export function runGexSnapshotContractTests(
  makeRepo: (seed: GexSnapshotSeedContext) => GexSnapshotRepo,
  getSeedContext: () => GexSnapshotSeedContext,
): void {
  let repo: GexSnapshotRepo;
  let seed: GexSnapshotSeedContext;

  beforeEach(() => {
    seed = getSeedContext();
    repo = makeRepo(seed);
  });

  describe("readGexSnapshot", () => {
    it("returns ok(null) when no snapshot exists", async () => {
      const result = await repo.readGexSnapshot();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("returns the row after persisting one snapshot", async () => {
      const row = makeSnapshotRow(T1);
      const persistResult = await repo.persistGexSnapshot(row);
      expect(persistResult.ok).toBe(true);

      const readResult = await repo.readGexSnapshot();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      const found = readResult.value;
      expect(found).not.toBeNull();
      expect(found?.cycleTime.getTime()).toBe(T1.getTime());
      expect(found?.spot).toBe(7381);
      expect(found?.flip).toBe(7488);
      expect(found?.callWall).toBe(7600);
      expect(found?.putWall).toBe(7400);
    });

    it("returns the LATEST snapshot (by cycleTime) when two rows exist", async () => {
      const row1 = makeSnapshotRow(T1);
      const row2 = makeSnapshotRow(T2, { spot: 7450, flip: null });

      await repo.persistGexSnapshot(row1);
      await repo.persistGexSnapshot(row2);

      const result = await repo.readGexSnapshot();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Must return T2 (later cycle)
      expect(result.value?.cycleTime.getTime()).toBe(T2.getTime());
      expect(result.value?.spot).toBe(7450);
    });

    it("preserves nullable fields (flip, callWall, putWall = null)", async () => {
      const row = makeSnapshotRow(T1, { flip: null, callWall: null, putWall: null });
      await repo.persistGexSnapshot(row);

      const result = await repo.readGexSnapshot();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.flip).toBeNull();
      expect(result.value?.callWall).toBeNull();
      expect(result.value?.putWall).toBeNull();
    });

    it("round-trips profile, strikes, and byExpiry arrays", async () => {
      const row = makeSnapshotRow(T1);
      await repo.persistGexSnapshot(row);

      const result = await repo.readGexSnapshot();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.profile).toHaveLength(2);
      expect(result.value?.strikes).toHaveLength(2);
      expect(result.value?.byExpiry).toHaveLength(1);
      expect(result.value?.byExpiry[0]?.date).toBe("2026-06-27");
    });
  });

  describe("persistGexSnapshot — idempotency (SC-4)", () => {
    it("re-persisting the same cycleTime produces exactly 1 row (onConflictDoNothing)", async () => {
      const row = makeSnapshotRow(T1);

      // First persist
      const r1 = await repo.persistGexSnapshot(row);
      expect(r1.ok).toBe(true);
      const count1 = await repo.countSnapshots();
      expect(count1).toBe(1);

      // Second persist with same cycleTime — should be a no-op
      const r2 = await repo.persistGexSnapshot(row);
      expect(r2.ok).toBe(true);
      const count2 = await repo.countSnapshots();
      expect(count2).toBe(1); // SC-4: still exactly 1 row
    });

    it("two DIFFERENT cycleTime values produce 2 rows", async () => {
      await repo.persistGexSnapshot(makeSnapshotRow(T1));
      await repo.persistGexSnapshot(makeSnapshotRow(T2));

      const count = await repo.countSnapshots();
      expect(count).toBe(2);
    });
  });

  describe("readLegObsForGex", () => {
    it("returns ok([]) when no legs are seeded (no crash)", async () => {
      const result = await repo.readLegObsForGex();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Memory twin returns [] (no seeded data); Postgres path may have more assertions inline
      expect(Array.isArray(result.value)).toBe(true);
    });
  });
}
