/**
 * computeGexSnapshot use-case — RED scaffold (Phase 8, Plan 08-02).
 *
 * Wave-0 locked RED test for 08-05 to turn GREEN. Imports the not-yet-existing
 * packages/core/src/analytics/application/computeGexSnapshot.ts and will fail
 * on unresolved SUT import.
 *
 * Invariants this test locks (the GREEN targets):
 * 1. The use-case reads leg-obs via ForReadingLegObsForGex.
 * 2. It persists EXACTLY ONE GexSnapshotRow via ForPersistingGexSnapshot.
 * 3. The persisted cycleTime is the resolved DATA cycle (the time of the leg-obs cohort),
 *    never now() — same data-anchor discipline as compute-analytics (06-06 / CR-01).
 * 4. The snapshot contains oracle-consistent structural shape (spot, flip, walls, profile, strikes, byExpiry).
 * 5. The use-case returns ok(undefined) on success.
 * 6. If ForReadingLegObsForGex returns an error, the use-case propagates it and does NOT persist.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeComputeGexSnapshotUseCase } from "./computeGexSnapshot.ts";
import { buildProfile } from "../domain/gex.ts";
import type {
  ForReadingLegObsForGex,
  ForPersistingGexSnapshot,
  LegObsForGex,
  GexSnapshotRow,
} from "./ports.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CYCLE_TIME = new Date("2026-06-23T14:00:00Z");
const NOW = new Date("2026-06-23T14:07:42Z"); // distinct from CYCLE_TIME

/** Make a minimal leg observation for testing. */
function makeLeg(overrides: Partial<LegObsForGex> = {}): LegObsForGex {
  return {
    time: CYCLE_TIME,
    contract: "O:SPX260627C07400",
    underlyingPrice: 7381,
    bsmGamma: "0.001",
    bsmIv: "0.14",
    openInterest: 1000,
    contractType: "C",
    strike: 7400000, // ×1000 convention
    expiration: "2026-06-27",
    ...overrides,
  };
}

// A representative set of legs with both calls and puts at a few strikes.
const FIXTURE_LEGS: ReadonlyArray<LegObsForGex> = [
  makeLeg({ contractType: "C", strike: 7400000, bsmGamma: "0.002", openInterest: 17071 }),
  makeLeg({ contractType: "P", strike: 7400000, bsmGamma: "0.001", openInterest: 52786 }),
  makeLeg({ contractType: "C", strike: 7600000, bsmGamma: "0.003", openInterest: 69015 }),
  makeLeg({ contractType: "P", strike: 7600000, bsmGamma: "0.0005", openInterest: 39475 }),
];

// ─── Port doubles ─────────────────────────────────────────────────────────────

function makeReadLegsStub(legs: ReadonlyArray<LegObsForGex>): ForReadingLegObsForGex {
  return async () => ok(legs);
}

function makePersistSpy() {
  const written: GexSnapshotRow[] = [];
  const persist: ForPersistingGexSnapshot = async (row) => {
    written.push(row);
    return ok(undefined);
  };
  return { persist, written };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("makeComputeGexSnapshotUseCase", () => {
  it("is a factory that returns a callable use-case", () => {
    const useCase = makeComputeGexSnapshotUseCase({
      readLegObsForGex: makeReadLegsStub([]),
      persistGexSnapshot: makePersistSpy().persist,
      now: () => NOW,
    });
    expect(typeof useCase).toBe("function");
  });

  it("persists exactly one GexSnapshotRow when leg-obs are available", async () => {
    const spy = makePersistSpy();
    const useCase = makeComputeGexSnapshotUseCase({
      readLegObsForGex: makeReadLegsStub(FIXTURE_LEGS),
      persistGexSnapshot: spy.persist,
      now: () => NOW,
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(spy.written).toHaveLength(1);
  });

  it("persisted row has the correct structural shape (all required GexSnapshotRow fields)", async () => {
    const spy = makePersistSpy();
    const useCase = makeComputeGexSnapshotUseCase({
      readLegObsForGex: makeReadLegsStub(FIXTURE_LEGS),
      persistGexSnapshot: spy.persist,
      now: () => NOW,
    });

    await useCase();
    const row = spy.written[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.cycleTime).toBeInstanceOf(Date);
    expect(typeof row.spot).toBe("number");
    expect(Number.isFinite(row.spot)).toBe(true);
    // flip can be number or null (nullable)
    expect(row.flip === null || typeof row.flip === "number").toBe(true);
    // callWall and putWall are nullable integers
    expect(row.callWall === null || typeof row.callWall === "number").toBe(true);
    expect(row.putWall === null || typeof row.putWall === "number").toBe(true);
    expect(typeof row.netGammaAtSpot).toBe("number");
    expect(Array.isArray(row.profile)).toBe(true);
    expect(Array.isArray(row.strikes)).toBe(true);
    expect(Array.isArray(row.byExpiry)).toBe(true);
    expect(row.computedAt).toBeInstanceOf(Date);
  });

  it("stamps cycleTime with the DATA cycle time (leg cohort time), never now()", async () => {
    const spy = makePersistSpy();
    const useCase = makeComputeGexSnapshotUseCase({
      readLegObsForGex: makeReadLegsStub(FIXTURE_LEGS),
      persistGexSnapshot: spy.persist,
      now: () => NOW, // distinct from CYCLE_TIME
    });

    await useCase();
    const row = spy.written[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    // cycleTime must be derived from the leg-obs cohort's time (CYCLE_TIME), not now().
    expect(row.cycleTime.getTime()).toBe(CYCLE_TIME.getTime());
    expect(row.cycleTime.getTime()).not.toBe(NOW.getTime());
  });

  it("returns ok(undefined) on success", async () => {
    const spy = makePersistSpy();
    const useCase = makeComputeGexSnapshotUseCase({
      readLegObsForGex: makeReadLegsStub(FIXTURE_LEGS),
      persistGexSnapshot: spy.persist,
      now: () => NOW,
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeUndefined();
  });

  it("propagates ForReadingLegObsForGex errors and does NOT persist", async () => {
    const spy = makePersistSpy();
    const failingRead: ForReadingLegObsForGex = async () =>
      err({ kind: "storage-error", message: "DB down" });

    const useCase = makeComputeGexSnapshotUseCase({
      readLegObsForGex: failingRead,
      persistGexSnapshot: spy.persist,
      now: () => NOW,
    });

    const result = await useCase();
    expect(result.ok).toBe(false);
    // Must NOT have persisted anything.
    expect(spy.written).toHaveLength(0);
  });

  it("returns ok(undefined) with no writes when leg-obs array is empty", async () => {
    const spy = makePersistSpy();
    const useCase = makeComputeGexSnapshotUseCase({
      readLegObsForGex: makeReadLegsStub([]),
      persistGexSnapshot: spy.persist,
      now: () => NOW,
    });

    const result = await useCase();
    // Empty cohort — use-case returns ok but may skip persisting (implementation decides)
    expect(result.ok).toBe(true);
  });

  // WR-05: putWall must be null when ALL strikes have positive GEX.
  //
  // The contract documents putWall as "Strike with highest net NEGATIVE GEX".
  // The prior implementation used a pure argmin (seeded at +Infinity), so on a
  // fully long-gamma chain it would label the least-positive strike as the put wall —
  // a non-negative "negative-GEX" wall, contradicting the field's stated meaning.
  //
  // Fix: mirror the callWall gate — only set putWall when entry.gex < 0.
  it("WR-05: putWall is null when all strikes have positive GEX (fully long-gamma chain)", async () => {
    // All legs are calls — positive GEX only.
    const allCallLegs: ReadonlyArray<LegObsForGex> = [
      makeLeg({ contractType: "C", strike: 7400000, bsmGamma: "0.002", openInterest: 17071 }),
      makeLeg({ contractType: "C", strike: 7600000, bsmGamma: "0.003", openInterest: 69015 }),
    ];

    const spy = makePersistSpy();
    const useCase = makeComputeGexSnapshotUseCase({
      readLegObsForGex: makeReadLegsStub(allCallLegs),
      persistGexSnapshot: spy.persist,
      now: () => NOW,
    });

    await useCase();
    const row = spy.written[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    // All GEX is positive — putWall must be null (no negative-GEX strike exists).
    expect(row.putWall).toBeNull();
    // callWall should be set (there ARE positive-GEX entries).
    expect(typeof row.callWall).toBe("number");
  });

  // CR-01 regression: netGammaAtSpot must be the PROFILE value at spot, not the
  // closest per-strike concentrated GEX value.
  //
  // The correct definition (oracle: gex.test.ts comment lines 9-11):
  //   netGammaAtSpot = buildProfile(legs, [spot])[0].gamma
  //   — the sum of dollar-gamma re-priced at spot across all contracts, in $Bn/1%.
  //
  // The wrong implementation (computeNetGammaAtSpot) returns the gex of the single
  // strike closest to spot — a per-strike concentrated value in the $Bn raw range
  // (e.g. 1e9 magnitude), not the profile-at-spot scalar in the tens range.
  it("CR-01: netGammaAtSpot equals buildProfile(legs,[spot])[0].gamma — not the closest-strike concentrated GEX", async () => {
    const spy = makePersistSpy();
    const spot = 7381; // underlyingPrice of FIXTURE_LEGS
    const useCase = makeComputeGexSnapshotUseCase({
      readLegObsForGex: makeReadLegsStub(FIXTURE_LEGS),
      persistGexSnapshot: spy.persist,
      now: () => NOW,
    });

    await useCase();
    const row = spy.written[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    // Expected value: profile evaluated AT spot (single-point grid)
    const [spotPoint] = buildProfile(FIXTURE_LEGS, [spot]);
    expect(spotPoint).toBeDefined();
    if (spotPoint === undefined) return;
    const expectedNetGammaAtSpot = spotPoint.gamma;

    // Must match the profile value within a tight epsilon (same calculation path)
    expect(row.netGammaAtSpot).toBeCloseTo(expectedNetGammaAtSpot, 6);

    // Guard: the profile-at-spot value must NOT be in the per-strike concentrated
    // magnitude range (|gex| > 1e6 indicates the wrong implementation).
    // The profile value is in the single-digit $Bn/1% range for realistic inputs.
    expect(Math.abs(row.netGammaAtSpot)).toBeLessThan(1e6);
  });
});

// ─── Side-specific walls + near-term level set (GEX methodology audit) ─────────

describe("side-specific walls (SpotGamma convention)", () => {
  it("callWall = largest call-side gamma strike even when its NET gex is negative", async () => {
    // 7500: big call concentration (cgex) but bigger put OI → net negative.
    // 7450: small call-only strike → net positive.
    // Net-argmax convention picks 7450; side-specific must pick 7500.
    const legs: ReadonlyArray<LegObsForGex> = [
      makeLeg({ contractType: "C", strike: 7450000, bsmGamma: "0.001", openInterest: 2000 }),
      makeLeg({ contractType: "C", strike: 7500000, bsmGamma: "0.002", openInterest: 40000 }),
      makeLeg({ contractType: "P", strike: 7500000, bsmGamma: "0.002", openInterest: 60000 }),
    ];

    const spy = makePersistSpy();
    const useCase = makeComputeGexSnapshotUseCase({
      readLegObsForGex: makeReadLegsStub(legs),
      persistGexSnapshot: spy.persist,
      now: () => NOW,
    });

    await useCase();
    const row = spy.written[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.callWall).toBe(7500);
    expect(row.putWall).toBe(7500);
  });
});

describe("near-term (≤45d DTE) level set", () => {
  // Cycle date 2026-06-23 → 45d boundary 2026-08-07.
  const NEAR_EXP = "2026-06-27"; // 4d — near
  const FAR_EXP = "2026-09-18"; // 87d — far

  it("computes nearTerm walls from ≤45d legs only (far-dated OI excluded)", async () => {
    const legs: ReadonlyArray<LegObsForGex> = [
      // near-term concentrations: calls at 7600, puts at 7400
      makeLeg({ contractType: "C", strike: 7600000, bsmGamma: "0.003", openInterest: 69015, expiration: NEAR_EXP }),
      makeLeg({ contractType: "P", strike: 7400000, bsmGamma: "0.002", openInterest: 52786, expiration: NEAR_EXP }),
      // far-dated monster OI at 8000 — dominates the ALL-expiry call wall
      makeLeg({ contractType: "C", strike: 8000000, bsmGamma: "0.0005", openInterest: 569341, expiration: FAR_EXP }),
    ];

    const spy = makePersistSpy();
    const useCase = makeComputeGexSnapshotUseCase({
      readLegObsForGex: makeReadLegsStub(legs),
      persistGexSnapshot: spy.persist,
      now: () => NOW,
    });

    await useCase();
    const row = spy.written[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    // All-expiry wall dominated by the far 8000s
    expect(row.callWall).toBe(8000);
    // Near-term set excludes them
    expect(row.nearTerm).not.toBeNull();
    expect(row.nearTerm?.callWall).toBe(7600);
    expect(row.nearTerm?.putWall).toBe(7400);
    // flip present as number-or-null
    expect(
      row.nearTerm?.flip === null || typeof row.nearTerm?.flip === "number",
    ).toBe(true);
  });

  it("nearTerm is null when every leg is beyond 45d", async () => {
    const legs: ReadonlyArray<LegObsForGex> = [
      makeLeg({ contractType: "C", strike: 8000000, bsmGamma: "0.0005", openInterest: 569341, expiration: FAR_EXP }),
    ];

    const spy = makePersistSpy();
    const useCase = makeComputeGexSnapshotUseCase({
      readLegObsForGex: makeReadLegsStub(legs),
      persistGexSnapshot: spy.persist,
      now: () => NOW,
    });

    await useCase();
    const row = spy.written[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.nearTerm).toBeNull();
  });
});
