import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForPersistingPickerSnapshot,
  ForReadingPickerSnapshot,
  PickerSnapshot,
  PickerSnapshotRow,
} from "@morai/core";

/**
 * Shared contract-test suite for the picker_snapshot persistence port.
 * Run against BOTH the Postgres adapter (testcontainers) and the in-memory twin.
 *
 * Asserts (D-06 append-history — distinct from GEX's upsert-by-cycleTime convention):
 * - readPickerSnapshot returns ok(null) when no snapshot exists yet.
 * - Inserting one row → readPickerSnapshot returns it.
 * - Inserting a SECOND row with a later observedAt → readPickerSnapshot returns the
 *   second row, AND countSnapshots() reports 2 — both rows retained (append, no
 *   onConflictDoUpdate/replace).
 */

export type PickerSnapshotRepo = {
  readonly insertPickerSnapshot: ForPersistingPickerSnapshot;
  readonly readPickerSnapshot: ForReadingPickerSnapshot;
  /** Count rows in picker_snapshot (proves append-history retains prior rows). */
  readonly countSnapshots: () => Promise<number>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const T1 = new Date("2026-07-01T14:00:00Z");
const T2 = new Date("2026-07-01T14:30:00Z"); // later observation

function makeSnapshot(overrides: Partial<PickerSnapshot> = {}): PickerSnapshot {
  return {
    asOf: "2026-07-01",
    observedAt: "2026-07-01T14:00:00.000Z",
    spot: 7381,
    source: "schwab",
    gexContextStatus: "ok",
    eventsContextStatus: "ok",
    termStructure: [{ dte: 30, iv: 0.14 }],
    gex: {
      flip: 7488,
      callWall: 7600,
      putWall: 7400,
      netGammaAtSpot: -47.3,
      absGammaStrike: 7500,
    },
    events: [{ date: "2026-07-29", name: "FOMC" }],
    candidates: [],
    ...overrides,
  };
}

function makeRow(
  observedAt: Date,
  overrides: Partial<PickerSnapshot> = {},
): PickerSnapshotRow {
  return {
    observedAt,
    snapshot: makeSnapshot({ observedAt: observedAt.toISOString(), ...overrides }),
  };
}

export function runPickerSnapshotContractTests(
  makeRepo: () => PickerSnapshotRepo,
): void {
  describe("picker-snapshot persistence contract", () => {
    let repo: PickerSnapshotRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("returns ok(null) when no snapshot exists", async () => {
      const result = await repo.readPickerSnapshot();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("returns the row after inserting one snapshot", async () => {
      const row = makeRow(T1);
      const insertResult = await repo.insertPickerSnapshot(row);
      expect(insertResult.ok).toBe(true);

      const readResult = await repo.readPickerSnapshot();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      const found = readResult.value;
      expect(found).not.toBeNull();
      expect(found?.observedAt.getTime()).toBe(T1.getTime());
      expect(found?.snapshot.asOf).toBe("2026-07-01");
      expect(found?.snapshot.spot).toBe(7381);
      expect(found?.snapshot.source).toBe("schwab");
    });

    it("append-history: a second row with a later observedAt is returned as latest, and BOTH rows are retained", async () => {
      const row1 = makeRow(T1);
      const row2 = makeRow(T2, { spot: 7420 });

      await repo.insertPickerSnapshot(row1);
      await repo.insertPickerSnapshot(row2);

      const readResult = await repo.readPickerSnapshot();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      expect(readResult.value?.observedAt.getTime()).toBe(T2.getTime());
      expect(readResult.value?.snapshot.spot).toBe(7420);

      // Append-history (D-06): the earlier row must NOT be replaced/deleted.
      const count = await repo.countSnapshots();
      expect(count).toBe(2);
    });

    it("idempotent on duplicate observedAt (WR-01): re-insert does not error, and readLatest keeps the first-written snapshot", async () => {
      const first = makeRow(T1, { spot: 7381 });
      const retrigger = makeRow(T1, { spot: 9999 }); // same observedAt — a same-cohort re-trigger

      const insert1 = await repo.insertPickerSnapshot(first);
      expect(insert1.ok).toBe(true);

      const insert2 = await repo.insertPickerSnapshot(retrigger);
      expect(insert2.ok).toBe(true); // must NOT surface a PK-violation StorageError

      const readResult = await repo.readPickerSnapshot();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      expect(readResult.value?.observedAt.getTime()).toBe(T1.getTime());
      expect(readResult.value?.snapshot.spot).toBe(7381); // first-write-wins, not overwritten

      // No duplicate row was appended for the same observedAt.
      const count = await repo.countSnapshots();
      expect(count).toBe(1);
    });
  });
}
