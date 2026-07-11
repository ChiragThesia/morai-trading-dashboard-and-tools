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
    /** Raw option mark — 34-03, parity-solver input. */
    mark: string;
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
    // WR-01: profile axis field is `spot` (simulated spot-price grid level), not `strike`
    profile: [
      { spot: 7380, gamma: -47.43 },
      { spot: 7500, gamma: 5.98 },
    ],
    strikes: [
      { k: 7400, gex: -5974395559.1, coi: 17071, poi: 52786, vol: 69857 },
      { k: 7600, gex: 1230277553.8, coi: 69015, poi: 39475, vol: 108490 },
    ],
    byExpiry: [
      { date: "2026-06-27", gex: -12345678.9 },
    ],
    nearTerm: { callWall: 7600, putWall: 7400, flip: 7490.5 },
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

    it("round-trips the nearTerm level set, including null (pre-0019 rows / no near legs)", async () => {
      await repo.persistGexSnapshot(makeSnapshotRow(T1));
      const withSet = await repo.readGexSnapshot();
      expect(withSet.ok).toBe(true);
      if (!withSet.ok) return;
      expect(withSet.value?.nearTerm).toEqual({ callWall: 7600, putWall: 7400, flip: 7490.5 });

      await repo.persistGexSnapshot(makeSnapshotRow(T2, { nearTerm: null }));
      const withNull = await repo.readGexSnapshot();
      expect(withNull.ok).toBe(true);
      if (!withNull.ok) return;
      expect(withNull.value?.nearTerm).toBeNull();
    });
  });

  describe("persistGexSnapshot — idempotency (SC-4, upsert semantics)", () => {
    it("re-persisting the same cycleTime produces exactly 1 row (upsert, no duplicates)", async () => {
      const row = makeSnapshotRow(T1);

      // First persist
      const r1 = await repo.persistGexSnapshot(row);
      expect(r1.ok).toBe(true);
      const count1 = await repo.countSnapshots();
      expect(count1).toBe(1);

      // Second persist with same cycleTime — still exactly one row
      const r2 = await repo.persistGexSnapshot(row);
      expect(r2.ok).toBe(true);
      const count2 = await repo.countSnapshots();
      expect(count2).toBe(1); // SC-4: still exactly 1 row
    });

    // Live regression 2026-07-08: BSM drains newest-first, so an early chain run
    // computed GEX from a partially-solved cohort (Schwab-only) and wrote a premature
    // row; when the full cohort solved minutes later, the correct recompute hit
    // onConflictDoNothing and was DISCARDED — the bad row blocked its own correction.
    // Persist must be an UPSERT: last write for a cycleTime wins (later = fuller cohort).
    it("re-persisting the same cycleTime UPDATES the row — last write wins", async () => {
      await repo.persistGexSnapshot(
        makeSnapshotRow(T1, { callWall: 7500, putWall: 7500, netGammaAtSpot: -18.5 }),
      );
      await repo.persistGexSnapshot(
        makeSnapshotRow(T1, { callWall: 8000, putWall: 7400, netGammaAtSpot: 0.6 }),
      );

      const count = await repo.countSnapshots();
      expect(count).toBe(1);

      const result = await repo.readGexSnapshot();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.callWall).toBe(8000);
      expect(result.value?.putWall).toBe(7400);
      expect(result.value?.netGammaAtSpot).toBe(0.6);
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

    // 34-03 (TOSP-02): the parity solver needs the raw mark — widen the read to carry it
    // through unchanged, same cohort, zero new queries.
    it("returns the raw mark for each leg in the cohort", async () => {
      const cycleTime = new Date("2026-06-23T14:00:00Z");
      await seed.seedLegs([
        {
          time: cycleTime,
          contract: "SPXW  260627C07400000",
          underlyingPrice: 7381,
          bsmGamma: "0.001",
          bsmIv: "0.14",
          openInterest: 1000,
          contractType: "C",
          strike: 7400000,
          expiration: "2026-06-27",
          mark: "12.35",
        },
      ]);

      const result = await repo.readLegObsForGex();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const leg = result.value.find((l) => l.contract === "SPXW  260627C07400000");
      expect(leg).toBeDefined();
      expect(leg?.mark).toBe("12.35");
    });
  });

  // chain-window-narrow-regression: one logical fetch cycle now lands as TWO nearby
  // timestamps (Schwab + CBOE each stamp their own observedAt). The cohort read must
  // union all BSM-solved rows within a lookback WINDOW of the latest solved observation
  // — strict max(time) equality would silently drop one source, and a calendar-slot
  // union breaks when the cycle straddles the 30-min boundary (live 2026-07-08: CBOE
  // stamped 16:59:31, Schwab 17:00:31 — pg-boss cron jitter + Schwab's ~60s latency
  // straddle the boundary CONSTANTLY, collapsing GEX to a single source). Overlapping
  // near-ATM contracts appear in both sources; they must be deduped per contract
  // (newest wins) or strikeGex double-counts their OI.
  describe("readLegObsForGex — dual-source cohort (lookback union + per-contract dedup)", () => {
    // One cycle: schwab lands at 14:00:05, cboe at 14:01:40 — within the lookback window
    const SCHWAB_T = new Date("2026-06-23T14:00:05Z");
    const CBOE_T = new Date("2026-06-23T14:01:40Z");
    // Previous cycle, 30 min earlier — outside the lookback window
    const PREV_SLOT_T = new Date("2026-06-23T13:31:40Z");

    const OVERLAP = "SPXW  260627P07400000"; // near-ATM, in BOTH sources
    const SCHWAB_ONLY = "SPXW  260627C07450000"; // near-ATM, schwab window
    const CBOE_ONLY = "SPXW  260627P07000000"; // far-OTM put tail, cboe breadth
    const PREV_SLOT = "SPXW  260627P07300000"; // solved, but an older cycle
    const UNSOLVED = "SPXW  260627C07500000"; // in-slot but bsm not yet computed

    const baseLeg = {
      underlyingPrice: 7381,
      bsmIv: "0.14",
      openInterest: 1000,
      expiration: "2026-06-27",
      mark: "1.75",
    };

    async function seedDualSourceCycle(): Promise<void> {
      await seed.seedLegs([
        // overlap contract: both sources, different times + gammas
        { ...baseLeg, time: SCHWAB_T, contract: OVERLAP, bsmGamma: "0.001", contractType: "P", strike: 7400000 },
        { ...baseLeg, time: CBOE_T, contract: OVERLAP, bsmGamma: "0.002", contractType: "P", strike: 7400000 },
        // single-source contracts
        { ...baseLeg, time: SCHWAB_T, contract: SCHWAB_ONLY, bsmGamma: "0.003", contractType: "C", strike: 7450000 },
        { ...baseLeg, time: CBOE_T, contract: CBOE_ONLY, bsmGamma: "0.004", contractType: "P", strike: 7000000 },
        // previous slot — must be excluded
        { ...baseLeg, time: PREV_SLOT_T, contract: PREV_SLOT, bsmGamma: "0.005", contractType: "P", strike: 7300000 },
        // in-slot but unsolved — must be excluded
        { ...baseLeg, time: CBOE_T, contract: UNSOLVED, bsmGamma: null, bsmIv: null, contractType: "C", strike: 7500000 },
      ]);
    }

    it("unions BSM-solved rows from both sources within the latest 30-min slot", async () => {
      await seedDualSourceCycle();

      const result = await repo.readLegObsForGex();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const contractsSeen = result.value.map((l) => l.contract);
      expect(contractsSeen).toContain(SCHWAB_ONLY);
      expect(contractsSeen).toContain(CBOE_ONLY);
    });

    it("dedupes overlapping contracts per contract — newest row wins", async () => {
      await seedDualSourceCycle();

      const result = await repo.readLegObsForGex();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const overlapRows = result.value.filter((l) => l.contract === OVERLAP);
      expect(overlapRows).toHaveLength(1);
      const row = overlapRows[0];
      expect(row?.time.getTime()).toBe(CBOE_T.getTime());
      expect(row?.bsmGamma).toBe("0.002");
    });

    it("excludes rows from the previous cycle and unsolved rows within the window", async () => {
      await seedDualSourceCycle();

      const result = await repo.readLegObsForGex();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const contractsSeen = result.value.map((l) => l.contract);
      expect(contractsSeen).not.toContain(PREV_SLOT);
      expect(contractsSeen).not.toContain(UNSOLVED);
    });

    // Live regression 2026-07-08: the fetch job fired at ~:59:30, CBOE stamped
    // 16:59:31 and Schwab 17:00:31 — the cycle STRADDLED the 30-min boundary and a
    // calendar-slot union read Schwab-only (walls collapsed to ATM, netΓ −18B
    // artifact). The lookback window must keep both sides of the boundary together.
    it("unions a cycle that straddles the 30-min boundary (cboe :59:31 + schwab :00:31)", async () => {
      const CBOE_STRADDLE = new Date("2026-06-23T16:59:31Z");
      const SCHWAB_STRADDLE = new Date("2026-06-23T17:00:31Z");
      const CBOE_LEG = "SPXW  260627P07000000";
      const SCHWAB_LEG = "SPXW  260627C07450000";

      await seed.seedLegs([
        { ...baseLeg, time: CBOE_STRADDLE, contract: CBOE_LEG, bsmGamma: "0.004", contractType: "P", strike: 7000000 },
        { ...baseLeg, time: SCHWAB_STRADDLE, contract: SCHWAB_LEG, bsmGamma: "0.003", contractType: "C", strike: 7450000 },
      ]);

      const result = await repo.readLegObsForGex();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const contractsSeen = result.value.map((l) => l.contract);
      expect(contractsSeen).toContain(CBOE_LEG);
      expect(contractsSeen).toContain(SCHWAB_LEG);
    });
  });

  // CR-02 regression: computedAt must round-trip faithfully and MUST NOT be
  // silently substituted with cycleTime on read.
  //
  // The two fields represent distinct concepts:
  //   cycleTime  = when the snapped DATA was captured (30-min RTH slot boundary)
  //   computedAt = when the GEX snapshot was COMPUTED (clock wall-time from deps.now())
  //
  // Test: persist a row where computedAt is several minutes after cycleTime (a realistic
  // scenario where the job runs after the data cycle closes). Read it back; assert that
  // the returned computedAt equals the persisted computedAt — NOT cycleTime.
  describe("computedAt — round-trip (CR-02)", () => {
    it("reads back the persisted computedAt distinct from cycleTime", async () => {
      // cycleTime = the data cycle (30-min slot boundary)
      const cycleTime = new Date("2026-06-23T14:00:00Z");
      // computedAt = job ran 7 minutes 42 seconds later — an off-slot instant
      const computedAt = new Date("2026-06-23T14:07:42Z");

      // Confirm they are genuinely distinct (guard against fixture mistake)
      expect(computedAt.getTime()).not.toBe(cycleTime.getTime());

      const row = makeSnapshotRow(cycleTime, { computedAt });

      const persistResult = await repo.persistGexSnapshot(row);
      expect(persistResult.ok).toBe(true);

      const readResult = await repo.readGexSnapshot();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const found = readResult.value;
      expect(found).not.toBeNull();
      if (found === null) return;

      // The round-tripped computedAt must equal the PERSISTED computedAt,
      // not cycleTime (which would indicate the repo is fabricating the value).
      expect(found.computedAt.getTime()).toBe(computedAt.getTime());
      expect(found.computedAt.getTime()).not.toBe(cycleTime.getTime());
    });
  });

  // BLOCKER regression: callWall/putWall must survive a fractional strike (e.g. 7412.5).
  //
  // Producer feeds strike / 1000 (×1000 convention). For half-point SPX strikes
  // (e.g. stored as 7412500 → / 1000 = 7412.5), the prior integer column silently
  // truncated to 7412 on write, and z.number().int() threw on read.
  //
  // Fix: relax contract to z.number() + change DB column to numeric.
  // Test: persist a row with callWall = 7412.5, read back, assert exact equality.
  // Also assert the row parses through gexSnapshotResponse.parse() without throwing.
  describe("fractional wall round-trip (BLOCKER — numeric column)", () => {
    it("persists and reads back a fractional callWall (7412.5) without truncation", async () => {
      const cycleTime = new Date("2026-06-23T16:00:00Z");
      const row = makeSnapshotRow(cycleTime, {
        callWall: 7412.5,
        putWall: 7387.5,
      });

      const persistResult = await repo.persistGexSnapshot(row);
      expect(persistResult.ok).toBe(true);

      const readResult = await repo.readGexSnapshot();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      const found = readResult.value;
      expect(found).not.toBeNull();
      if (found === null) return;

      // Must survive as 7412.5 — NOT truncated to 7412
      expect(found.callWall).toBe(7412.5);
      expect(found.putWall).toBe(7387.5);
    });

    it("gexSnapshotResponse.parse() accepts fractional k/callWall/putWall without throwing", async () => {
      const { gexSnapshotResponse } = await import("@morai/contracts");
      const payload = {
        spot: 7380,
        flip: 7488.25,
        callWall: 7412.5,
        putWall: 7387.5,
        netGammaAtSpot: -47.3,
        profile: [{ spot: 7380, gamma: -47.43 }],
        strikes: [{ k: 7412.5, gex: 1230277553.8, coi: 69015, poi: 39475, vol: 108490 }],
        byExpiry: [{ date: "2026-06-27", gex: -12345678.9 }],
        nearTerm: null,
        computedAt: new Date("2026-06-23T14:07:42Z").toISOString(),
      };
      // Must not throw (previously threw: Expected number to be an integer)
      expect(() => gexSnapshotResponse.parse(payload)).not.toThrow();
    });
  });
}
