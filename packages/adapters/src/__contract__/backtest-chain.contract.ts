/**
 * Shared contract-test suite for the backtest as-of-T chain read (Phase 27, Plan 03).
 * Run against BOTH the Postgres adapter (testcontainers) and the in-memory twin.
 *
 * Asserts (BT-01 — the phase's required no-lookahead check):
 * - readChainAsOf returns ok([]) when no rows exist at or before asOfT.
 * - readChainAsOf resolves the newest at-or-before-T cohort, with the FULL column set
 *   (bid/ask/mark/bsmIv/bsmDelta/bsmGamma/bsmTheta/bsmVega/openInterest/underlyingPrice/
 *   source/time) — one read serves both candidate-generation and exit-context assembly.
 * - A future-dated leg (time > asOfT) NEVER changes a past-T read's result — seeding it
 *   AFTER the first read and re-reading with the SAME asOfT returns a byte-identical result.
 * - A boundary-straddling dual-source cycle unions across the lookback window and dedupes
 *   per contract (newest wins) — the schwab_chain-inclusion regression class.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ChainLegQuoteAsOf, ForReadingChainAsOf } from "@morai/core";

// ─── Repo type ────────────────────────────────────────────────────────────────

export type BacktestChainRepo = {
  readonly readChainAsOf: ForReadingChainAsOf;
};

// ─── Seed helper (provided by each contract test file) ─────────────────────────

export type SeedContext = {
  /** Seed one leg quote (mirrors a legObservations+contracts join row). */
  readonly seedLeg: (leg: ChainLegQuoteAsOf) => Promise<void>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeLeg(
  occSymbol: string,
  time: Date,
  overrides: Partial<ChainLegQuoteAsOf> = {},
): ChainLegQuoteAsOf {
  return {
    occSymbol,
    strike: 7500000,
    expiration: "2026-08-01",
    contractType: "P",
    bid: 2.0,
    ask: 2.5,
    mark: 2.25,
    bsmIv: 0.16,
    bsmDelta: -0.3,
    bsmGamma: 0.002,
    bsmTheta: -1.2,
    bsmVega: 5.5,
    openInterest: 700,
    underlyingPrice: 7390,
    source: "schwab_chain",
    time,
    ...overrides,
  };
}

// ─── Contract test suite ──────────────────────────────────────────────────────

export function runBacktestChainContractTests(
  makeRepo: () => BacktestChainRepo,
  getSeedContext: () => SeedContext,
): void {
  describe("backtest-chain as-of-T read contract", () => {
    let repo: BacktestChainRepo;
    let seed: SeedContext;

    beforeEach(() => {
      repo = makeRepo();
      seed = getSeedContext();
    });

    it("returns ok([]) when no rows exist at or before asOfT", async () => {
      const result = await repo.readChainAsOf(new Date("2026-07-01T14:00:00Z"));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it("resolves the newest at-or-before-T cohort with the full column set", async () => {
      const t1 = new Date("2026-07-01T14:00:00Z");
      const t2 = new Date("2026-07-01T14:30:00Z"); // newest ≤ asOfT
      const asOfT = new Date("2026-07-01T15:00:00Z");
      const occOld = "O:SPX260801P07400";
      const occNew = "O:SPX260801P07500";

      await seed.seedLeg(makeLeg(occOld, t1, { strike: 7400000 }));
      await seed.seedLeg(makeLeg(occNew, t2, { strike: 7500000 }));

      const result = await repo.readChainAsOf(asOfT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      const leg = result.value[0];
      expect(leg).toBeDefined();
      if (leg === undefined) return;

      expect(leg.time.getTime()).toBe(t2.getTime());
      expect(leg.strike).toBe(7500000);
      expect(leg.expiration).toBe("2026-08-01");
      expect(leg.contractType).toBe("P");
      // Full column set — both candidate-universe fields and exit-context fields.
      expect(leg.bid).toBeCloseTo(2.0, 5);
      expect(leg.ask).toBeCloseTo(2.5, 5);
      expect(leg.mark).toBeCloseTo(2.25, 5);
      expect(leg.bsmIv).toBeCloseTo(0.16, 5);
      expect(leg.bsmDelta).toBeCloseTo(-0.3, 5);
      expect(leg.bsmGamma).toBeCloseTo(0.002, 5);
      expect(leg.bsmTheta).toBeCloseTo(-1.2, 5);
      expect(leg.bsmVega).toBeCloseTo(5.5, 5);
      expect(leg.openInterest).toBe(700);
      expect(leg.underlyingPrice).toBeCloseTo(7390, 5);
      expect(leg.source).toBe("schwab_chain");
    });

    it("BT-01 no-lookahead: a future-dated row never changes a past-T read's result (the required check)", async () => {
      const t1 = new Date("2026-07-01T14:00:00Z");
      const t2 = new Date("2026-07-01T14:30:00Z");
      const asOfT = new Date("2026-07-01T15:00:00Z");
      const future = new Date("2026-07-02T14:00:00Z"); // strictly after asOfT
      const occ1 = "O:SPX260801P07400";
      const occ2 = "O:SPX260801P07500";
      const occFuture = "O:SPX260801P07600";

      await seed.seedLeg(makeLeg(occ1, t1, { strike: 7400000 }));
      await seed.seedLeg(makeLeg(occ2, t2, { strike: 7500000 }));

      const before = await repo.readChainAsOf(asOfT);
      expect(before.ok).toBe(true);
      if (!before.ok) return;

      // Seed a NEW row dated AFTER asOfT, then re-run the SAME asOfT read.
      await seed.seedLeg(makeLeg(occFuture, future, { strike: 7600000 }));
      const after = await repo.readChainAsOf(asOfT);
      expect(after.ok).toBe(true);
      if (!after.ok) return;

      // Byte-identical: the future row is invisible to a past-T read.
      expect(after.value).toHaveLength(before.value.length);
      expect(JSON.stringify(after.value)).toBe(JSON.stringify(before.value));
      expect(after.value.map((l) => l.strike)).not.toContain(7600000);
    });

    it("unions a boundary-straddling dual-source cycle and dedupes per contract (newest wins) — schwab_chain-inclusion regression", async () => {
      const cboeTime = new Date("2026-07-08T16:59:31Z");
      const schwabTime = new Date("2026-07-08T17:00:31Z");
      const asOfT = new Date("2026-07-08T17:05:00Z");
      const cboeOnlyOcc = "O:SPX260801P07000";
      const overlapOcc = "O:SPX260801P07500";

      await seed.seedLeg(
        makeLeg(cboeOnlyOcc, cboeTime, { strike: 7000000, source: "cboe", bsmIv: 0.19 }),
      );
      await seed.seedLeg(
        makeLeg(overlapOcc, cboeTime, { strike: 7500000, source: "cboe", bsmIv: 0.16 }),
      );
      await seed.seedLeg(
        makeLeg(overlapOcc, schwabTime, { strike: 7500000, source: "schwab_chain", bsmIv: 0.165 }),
      );

      const result = await repo.readChainAsOf(asOfT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Union: the cboe-only far strike survives despite being on the far side of the window.
      const strikes = result.value.map((l) => l.strike);
      expect(strikes).toContain(7000000);

      // Dedup: the overlap contract appears exactly once, newest (schwab_chain) row winning —
      // never silently dropped (the schwab_chain-inclusion regression class).
      const overlapRows = result.value.filter((l) => l.strike === 7500000);
      expect(overlapRows).toHaveLength(1);
      expect(overlapRows[0]?.source).toBe("schwab_chain");
      expect(overlapRows[0]?.bsmIv).toBeCloseTo(0.165, 5);
    });
  });
}
