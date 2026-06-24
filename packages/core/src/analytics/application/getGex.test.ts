/**
 * getGex use-case — RED scaffold (Phase 8, Plan 08-02).
 *
 * Wave-0 locked RED test for 08-05 to turn GREEN. Imports the not-yet-existing
 * packages/core/src/analytics/application/getGex.ts and will fail on unresolved
 * SUT import.
 *
 * Invariants this test locks (the GREEN targets):
 * 1. makeGetGexUseCase is a factory returning a callable (ForRunningGetGex-shaped) use-case.
 * 2. It returns ok(GexSnapshotRow) when ForReadingGexSnapshot returns a row.
 * 3. It returns ok(null) when no snapshot exists (ForReadingGexSnapshot returns null).
 * 4. It propagates a StorageError from ForReadingGexSnapshot.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeGetGexUseCase } from "./getGex.ts";
import type { ForReadingGexSnapshot, GexSnapshotRow } from "./ports.ts";

// ─── Fixture ───────────────────────────────────────────────────────────────────

const FIXTURE_ROW: GexSnapshotRow = {
  cycleTime: new Date("2026-06-23T14:00:00Z"),
  spot: 7381.1201,
  flip: 7488,
  callWall: 7600,
  putWall: 7400,
  netGammaAtSpot: -47,
  // WR-01: profile axis is `spot` (simulated spot-price grid level), not `strike`
  profile: [
    { spot: 7380, gamma: -47.43 },
    { spot: 7500, gamma: 5.98 },
  ],
  strikes: [
    { k: 7400, gex: -5974395559.112409, coi: 17071, poi: 52786, vol: 8406 },
    { k: 7600, gex: 1230277553.8345654, coi: 69015, poi: 39475, vol: 2228 },
  ],
  byExpiry: [
    { date: "2026-06-27", gex: -12345678.9 },
    { date: "2026-07-17", gex: 9876543.2 },
  ],
  computedAt: new Date("2026-06-23T14:00:24Z"),
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("makeGetGexUseCase", () => {
  it("is a factory returning a callable use-case", () => {
    const readGexSnapshot: ForReadingGexSnapshot = async () => ok(null);
    const getGex = makeGetGexUseCase({ readGexSnapshot });
    expect(typeof getGex).toBe("function");
  });

  it("returns ok(GexSnapshotRow) when a snapshot exists", async () => {
    const readGexSnapshot: ForReadingGexSnapshot = async () => ok(FIXTURE_ROW);
    const getGex = makeGetGexUseCase({ readGexSnapshot });

    const result = await getGex();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    expect(result.value?.spot).toBe(7381.1201);
    expect(result.value?.flip).toBe(7488);
    expect(result.value?.callWall).toBe(7600);
    expect(result.value?.putWall).toBe(7400);
    expect(result.value?.netGammaAtSpot).toBe(-47);
  });

  it("returns ok(null) when no snapshot exists yet", async () => {
    const readGexSnapshot: ForReadingGexSnapshot = async () => ok(null);
    const getGex = makeGetGexUseCase({ readGexSnapshot });

    const result = await getGex();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it("propagates a StorageError from ForReadingGexSnapshot", async () => {
    const readGexSnapshot: ForReadingGexSnapshot = async () =>
      err({ kind: "storage-error", message: "connection refused" });
    const getGex = makeGetGexUseCase({ readGexSnapshot });

    const result = await getGex();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
    expect(result.error.message).toBe("connection refused");
  });

  it("returns the exact snapshot row supplied by ForReadingGexSnapshot (thin forwarder)", async () => {
    let callCount = 0;
    const readGexSnapshot: ForReadingGexSnapshot = async () => {
      callCount++;
      return ok(FIXTURE_ROW);
    };
    const getGex = makeGetGexUseCase({ readGexSnapshot });

    const result = await getGex();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Thin forwarder: exactly one read call, exact value pass-through.
    expect(callCount).toBe(1);
    expect(result.value).toBe(FIXTURE_ROW); // reference equality — not a copy
  });

  it("returns ok(null) with callWall/putWall null (no-wall snapshot)", async () => {
    const noWallRow: GexSnapshotRow = { ...FIXTURE_ROW, callWall: null, putWall: null, flip: null };
    const readGexSnapshot: ForReadingGexSnapshot = async () => ok(noWallRow);
    const getGex = makeGetGexUseCase({ readGexSnapshot });

    const result = await getGex();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.callWall).toBeNull();
    expect(result.value?.putWall).toBeNull();
    expect(result.value?.flip).toBeNull();
  });
});
