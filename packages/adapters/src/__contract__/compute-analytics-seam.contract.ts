import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";

/**
 * Shared seam contract suite for the compute-analytics cycle-resolution fix (06-06 / CR-01+CR-02).
 *
 * This suite drives the REAL makeComputeAnalyticsUseCase wired over the given repos (Postgres under
 * testcontainers) and proves the seam end-to-end:
 *
 * - CR-01 (bounded read): seed leg_observations at a broker time T_obs and calendar_snapshots at a
 *   snapshot time T_snap, BOTH strictly EARLIER than the injected now() N. Running with now()=N must
 *   still write the smile (the bounded "latest leg cycle ≤ anchor" read finds the cohort despite
 *   N != T_obs). The OLD exact-now() read wrote 0 rows here.
 * - CR-02 (idempotency): run TWICE with two DIFFERENT now() values; row counts are unchanged after
 *   the second run (PKs collide on the resolved cycle instant, not now()). A fast-check property
 *   covers a set of distinct (T_obs, T_snap, N1, N2) tuples.
 * - SC1 (single-anchor): skew_observations.snapshot_time == term_structure_observations.snapshot_time
 *   for the cycle.
 * - Snapshots-absent fallback: chain-only (no calendar_snapshots) → skew/RR written stamped with
 *   the resolved leg cycle; 0 term rows; re-run adds 0.
 *
 * SQL is never mocked (tdd.md). The factory wires the real repos and exposes seed + count helpers.
 */

/** One BSM-solved leg seed at the smile grain. */
export type SeamLegSeed = {
  readonly time: Date; // broker observedAt
  readonly underlying: string;
  readonly expiration: string; // YYYY-MM-DD
  readonly strike: number; // ×1000 int
  readonly bsmIv: string; // numeric string (solved)
  readonly bsmDelta: string; // numeric string
};

/** One calendar_snapshots seed (term-slope passthrough source). */
export type SeamSnapshotSeed = {
  readonly time: Date; // snapshot cycle time
  readonly calendarId: string; // uuid
  readonly termSlope: string; // numeric string
  readonly frontIv: string;
  readonly backIv: string;
};

export type ComputeAnalyticsSeamHarness = {
  /** Run the real wired use-case with the given injected now(). Returns true on ok. */
  readonly run: (now: Date) => Promise<boolean>;
  /** Seed a calendar row (FK parent for calendar_snapshots). */
  readonly seedCalendar: (calendarId: string) => Promise<void>;
  /** Seed a contracts row + a BSM-solved leg_observations row. */
  readonly seedLeg: (leg: SeamLegSeed) => Promise<void>;
  /** Seed a calendar_snapshots row. */
  readonly seedSnapshot: (snap: SeamSnapshotSeed) => Promise<void>;
  /** Reset all involved tables. */
  readonly reset: () => Promise<void>;
  readonly countSkew: () => Promise<number>;
  readonly countRr: () => Promise<number>;
  readonly countTerm: () => Promise<number>;
  /** The DISTINCT set of skew snapshot_time values (ISO strings) currently stored. */
  readonly skewSnapshotTimes: () => Promise<string[]>;
  /** The DISTINCT set of term snapshot_time values (ISO strings) currently stored. */
  readonly termSnapshotTimes: () => Promise<string[]>;
};

const CAL_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UNDERLYING = "SPX";
const EXPIRY = "2026-07-17";

/**
 * A worked-example smile that brackets ±25Δ so a non-null risk-reversal is produced (4 strikes).
 * stamped at the given broker time.
 */
function workedSmile(time: Date): SeamLegSeed[] {
  return [
    { time, underlying: UNDERLYING, expiration: EXPIRY, strike: 5400000, bsmIv: "0.18", bsmDelta: "-0.2" },
    { time, underlying: UNDERLYING, expiration: EXPIRY, strike: 5300000, bsmIv: "0.22", bsmDelta: "-0.3" },
    { time, underlying: UNDERLYING, expiration: EXPIRY, strike: 5600000, bsmIv: "0.15", bsmDelta: "0.3" },
    { time, underlying: UNDERLYING, expiration: EXPIRY, strike: 5550000, bsmIv: "0.13", bsmDelta: "0.2" },
  ];
}

export function runComputeAnalyticsSeamContractTests(
  makeHarness: () => ComputeAnalyticsSeamHarness,
): void {
  describe("compute-analytics cycle-resolution seam contract (CR-01/CR-02)", () => {
    let h: ComputeAnalyticsSeamHarness;

    beforeEach(async () => {
      h = makeHarness();
      await h.reset();
    });

    it("CR-01: writes the smile when broker observedAt != now() (bounded read finds the cohort)", async () => {
      const tObs = new Date("2026-07-01T18:30:00Z"); // broker observedAt
      const tSnap = new Date("2026-07-01T19:00:00Z"); // snapshot cycle
      const now = new Date("2026-07-01T19:07:42Z"); // distinct now() — strictly later

      await h.seedCalendar(CAL_ID);
      for (const leg of workedSmile(tObs)) await h.seedLeg(leg);
      await h.seedSnapshot({
        time: tSnap, calendarId: CAL_ID, termSlope: "0.05", frontIv: "0.20", backIv: "0.25",
      });

      const ok = await h.run(now);
      expect(ok).toBe(true);

      // 4 smile strikes written despite now() != broker observedAt (old exact-now() read → 0).
      expect(await h.countSkew()).toBe(4);
      expect(await h.countRr()).toBe(1);
      expect(await h.countTerm()).toBe(1);

      // SC1 single-anchor: skew snapshot_time == term snapshot_time for the cycle.
      const skewTimes = await h.skewSnapshotTimes();
      const termTimes = await h.termSnapshotTimes();
      expect(skewTimes).toHaveLength(1);
      expect(termTimes).toHaveLength(1);
      expect(skewTimes[0]).toBe(termTimes[0]);
    });

    it("CR-02: a now()-advanced re-run adds 0 rows in all three tables (PKs collide on the cycle)", async () => {
      const tObs = new Date("2026-07-01T18:30:00Z");
      const tSnap = new Date("2026-07-01T19:00:00Z");
      const n1 = new Date("2026-07-01T19:07:42Z");
      const n2 = new Date("2026-07-01T19:42:11Z"); // a DIFFERENT now()

      await h.seedCalendar(CAL_ID);
      for (const leg of workedSmile(tObs)) await h.seedLeg(leg);
      await h.seedSnapshot({
        time: tSnap, calendarId: CAL_ID, termSlope: "0.05", frontIv: "0.20", backIv: "0.25",
      });

      expect(await h.run(n1)).toBe(true);
      const skew1 = await h.countSkew();
      const rr1 = await h.countRr();
      const term1 = await h.countTerm();
      expect(skew1).toBe(4);

      expect(await h.run(n2)).toBe(true);
      expect(await h.countSkew()).toBe(skew1);
      expect(await h.countRr()).toBe(rr1);
      expect(await h.countTerm()).toBe(term1);
    });

    it("snapshots-absent fallback: chain-only writes skew/RR + 0 term; re-run adds 0", async () => {
      const tObs = new Date("2026-07-01T18:30:00Z");
      const now = new Date("2026-07-01T19:07:42Z");

      // No calendar / no calendar_snapshots — only the chain.
      for (const leg of workedSmile(tObs)) await h.seedLeg(leg);

      expect(await h.run(now)).toBe(true);
      expect(await h.countSkew()).toBe(4);
      expect(await h.countRr()).toBe(1);
      expect(await h.countTerm()).toBe(0);

      // skew stamped with the smile's own resolved cycle (tObs), not now().
      const skewTimes = await h.skewSnapshotTimes();
      expect(skewTimes).toHaveLength(1);
      expect(new Date(skewTimes[0] ?? "").getTime()).toBe(tObs.getTime());

      // Re-run at a different now() adds 0.
      expect(await h.run(new Date("2026-07-01T20:00:00Z"))).toBe(true);
      expect(await h.countSkew()).toBe(4);
      expect(await h.countRr()).toBe(1);
      expect(await h.countTerm()).toBe(0);
    });

    it("idempotency property: distinct (T_obs, T_snap, N1, N2) → second run adds 0 rows", async () => {
      // Minute offsets (all distinct, T_obs/T_snap strictly < N1,N2) over a fixed base instant.
      const base = Date.UTC(2026, 6, 1, 12, 0, 0); // 2026-07-01T12:00:00Z
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            obsMin: fc.integer({ min: 0, max: 9 }),
            snapMin: fc.integer({ min: 10, max: 19 }),
            n1Min: fc.integer({ min: 20, max: 29 }),
            n2Min: fc.integer({ min: 30, max: 39 }),
          }),
          async ({ obsMin, snapMin, n1Min, n2Min }) => {
            await h.reset();
            const tObs = new Date(base + obsMin * 60_000);
            const tSnap = new Date(base + snapMin * 60_000);
            const n1 = new Date(base + n1Min * 60_000);
            const n2 = new Date(base + n2Min * 60_000);

            await h.seedCalendar(CAL_ID);
            for (const leg of workedSmile(tObs)) await h.seedLeg(leg);
            await h.seedSnapshot({
              time: tSnap, calendarId: CAL_ID, termSlope: "0.05", frontIv: "0.20", backIv: "0.25",
            });

            expect(await h.run(n1)).toBe(true);
            const skew1 = await h.countSkew();
            const rr1 = await h.countRr();
            const term1 = await h.countTerm();

            expect(await h.run(n2)).toBe(true);
            expect(await h.countSkew()).toBe(skew1);
            expect(await h.countRr()).toBe(rr1);
            expect(await h.countTerm()).toBe(term1);
          },
        ),
        { numRuns: 8 },
      );
    });
  });
}
