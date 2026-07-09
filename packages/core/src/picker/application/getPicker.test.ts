/**
 * getPicker tests (Phase 19, Plan 06) — thin latest-row forwarder, per tdd.md.
 *
 * Covers:
 *   - ok(row) when a snapshot exists.
 *   - ok(null) when none exists yet.
 *   - err(StorageError) propagated unchanged.
 *   - No recompute: a fake port is the sole source of truth, no domain call.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { makeGetPickerUseCase } from "./getPicker.ts";
import type { ForReadingPickerSnapshot, PickerSnapshotRow, StorageError } from "./ports.ts";

const ROW: PickerSnapshotRow = {
  observedAt: new Date("2026-07-01T14:30:00.000Z"),
  snapshot: {
    asOf: "2026-07-01",
    observedAt: "2026-07-01T14:30:00.000Z",
    spot: 7500,
    source: "schwab",
    gexContextStatus: "ok",
  marketSession: "rth",
    eventsContextStatus: "ok",
    termStructure: [],
    gex: { flip: null, callWall: null, putWall: null, netGammaAtSpot: 0, absGammaStrike: null, nearTerm: null },
    events: [],
    candidates: [],
    ruleSet: [],
    gateDrops: { liquidity: 0, netTheta: 0, termInverted: 0, eventBlackout: 0 },
    gate: {
      vix: null,
      vix3m: null,
      ratio: null,
      asOf: null,
      state: "open",
      penaltyMultiplier: 1,
      brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
      reasons: [],
    },
  },
};

describe("makeGetPickerUseCase", () => {
  it("returns ok(row) when a snapshot exists", async () => {
    const readPickerSnapshot: ForReadingPickerSnapshot = async (): Promise<
      Result<PickerSnapshotRow | null, StorageError>
    > => ok(ROW);
    const getPicker = makeGetPickerUseCase({ readPickerSnapshot });

    const result = await getPicker();
    expect(result).toEqual(ok(ROW));
  });

  it("returns ok(null) when no snapshot exists yet", async () => {
    const readPickerSnapshot: ForReadingPickerSnapshot = async (): Promise<
      Result<PickerSnapshotRow | null, StorageError>
    > => ok(null);
    const getPicker = makeGetPickerUseCase({ readPickerSnapshot });

    const result = await getPicker();
    expect(result).toEqual(ok(null));
  });

  it("propagates a StorageError unchanged", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "read failed" };
    const readPickerSnapshot: ForReadingPickerSnapshot = async (): Promise<
      Result<PickerSnapshotRow | null, StorageError>
    > => err(storageError);
    const getPicker = makeGetPickerUseCase({ readPickerSnapshot });

    const result = await getPicker();
    expect(result).toEqual(err(storageError));
  });
});
