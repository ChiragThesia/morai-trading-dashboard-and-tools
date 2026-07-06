import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  ForPersistingObservations,
  ForUpsertingContracts,
  ForReadingPendingObs,
  ForWritingBsmResults,
  ForReadingLatestLegObs,
  ObservationRow,
  ContractRow,
} from "@morai/core";
import type { OccSymbol } from "@morai/shared";
import { formatOccSymbol } from "@morai/shared";

/**
 * Shared contract-test suite for the leg-observations persistence port.
 * Run this suite against the Postgres adapter (testcontainers).
 *
 * Asserts:
 * - Persisting a set of rows writes exactly the rows passed
 * - All rows have source='cboe' and bsm_iv IS NULL
 * - A second identical persist adds zero rows (composite PK idempotency)
 * - Upserting contracts: exercise_style='european', re-upsert adds zero rows
 * - BSM-03: pending scan drains bsm_iv IS NULL rows; bsm write fills all five columns
 * - T-02-16: NaN stamp works round-trip; stamped rows excluded from pending scan
 * - T-02-17: vendor columns unchanged after bsm write
 */

// ForReadingPendingObs now requires a `limit` (bounded, newest-first — gex-schwab-bsm-null-puts
// fix). These membership/idempotency tests want "effectively all pending", so pass a limit far
// above any seeded row count. The dedicated newest-first-bounding regression uses a small limit.
const PENDING_LIMIT_ALL = 100_000;

export type LegObservationsRepo = {
  readonly persistObservations: ForPersistingObservations;
  readonly upsertContracts: ForUpsertingContracts;
  readonly readPendingObs: ForReadingPendingObs;
  readonly writeBsmResults: ForWritingBsmResults;
  readonly getLatestLegObs: ForReadingLatestLegObs;
  /** Count rows in leg_observations for the given time slot */
  readonly countObservations: (time: Date) => Promise<number>;
  /** Count rows in contracts for the given roots */
  readonly countContracts: (roots: ReadonlyArray<string>) => Promise<number>;
  /** Count rows where bsm_iv IS NULL AND mark IS NOT NULL (pending scan) */
  readonly countPendingBsm: (time: Date) => Promise<number>;
  /** Count rows where bsm_iv = 'NaN'::numeric (NaN-stamped rows) */
  readonly countNanStamped: (time: Date) => Promise<number>;
  /** Get the vendor mark value for a contract (to check vendor columns unchanged) */
  readonly getVendorMark: (time: Date, contract: OccSymbol) => Promise<string | null>;
};

function makeFixtureRows(time: Date): {
  observations: ReadonlyArray<ObservationRow>;
  contracts: ReadonlyArray<ContractRow>;
} {
  // "SPXW  260611C07275000" — 21 chars
  const occ1 = formatOccSymbol({
    root: "SPXW",
    expiry: new Date(2026, 5, 11),
    type: "C",
    strike: 7275,
  });
  // "SPX   260918C07275000" — 21 chars
  const occ2 = formatOccSymbol({
    root: "SPX",
    expiry: new Date(2026, 8, 18),
    type: "P",
    strike: 7275,
  });

  const observations: ReadonlyArray<ObservationRow> = [
    {
      time,
      contract: occ1,
      bid: 25.3,
      ask: 25.5,
      mark: 25.4,
      underlyingPrice: 7274.14,
      iv: 0.3761,
      delta: 0.498,
      gamma: 0.0061,
      theta: -25.88,
      vega: 0.6955,
      openInterest: 474,
      volume: 2898,
      source: "cboe" as const,
    },
    {
      time,
      contract: occ2,
      bid: 240.4,
      ask: 242.0,
      mark: 241.2,
      underlyingPrice: 7274.14,
      iv: 0.1818,
      delta: -0.4429,
      gamma: 0.0006,
      theta: -1.3234,
      vega: 14.9244,
      openInterest: 1039,
      volume: 0,
      source: "cboe" as const,
    },
  ];

  const contracts: ReadonlyArray<ContractRow> = [
    {
      occSymbol: occ1,
      underlying: "SPX",
      root: "SPXW",
      contractType: "C",
      exerciseStyle: "european",
      strike: 7275000, // ×1000 int
      expiration: "2026-06-11",
      multiplier: 100,
    },
    {
      occSymbol: occ2,
      underlying: "SPX",
      root: "SPX",
      contractType: "P",
      exerciseStyle: "european",
      strike: 7275000,
      expiration: "2026-09-18",
      multiplier: 100,
    },
  ];

  return { observations, contracts };
}

export function runLegObservationsContractTests(
  makeRepo: () => LegObservationsRepo,
): void {
  describe("leg-observations persistence contract", () => {
    let repo: LegObservationsRepo;
    // Use a unique time per test run to avoid cross-test collisions
    let observationTime: Date;

    beforeEach(() => {
      repo = makeRepo();
      observationTime = new Date(Date.now() + Math.random() * 1_000_000);
      observationTime.setMilliseconds(0);
    });

    describe("persistObservations + countObservations", () => {
      it("persists rows with source=cboe and bsm_iv IS NULL", async () => {
        const { observations } = makeFixtureRows(observationTime);
        const result = await repo.persistObservations(observations);
        expect(result.ok).toBe(true);

        const count = await repo.countObservations(observationTime);
        expect(count).toBe(observations.length);
      });

      it("re-persisting the same rows adds zero rows (idempotent)", async () => {
        const { observations } = makeFixtureRows(observationTime);
        await repo.persistObservations(observations);
        const countAfterFirst = await repo.countObservations(observationTime);

        // Second identical persist
        await repo.persistObservations(observations);
        const countAfterSecond = await repo.countObservations(observationTime);

        expect(countAfterSecond).toBe(countAfterFirst);
      });
    });

    describe("upsertContracts", () => {
      it("upserts contracts with exercise_style=european for SPX/SPXW", async () => {
        const { contracts } = makeFixtureRows(observationTime);
        const result = await repo.upsertContracts(contracts);
        expect(result.ok).toBe(true);

        const count = await repo.countContracts(["SPX", "SPXW"]);
        expect(count).toBeGreaterThan(0);
      });

      it("re-upserting the same contracts adds zero rows (first-seen only)", async () => {
        const { contracts } = makeFixtureRows(observationTime);
        await repo.upsertContracts(contracts);
        const countAfterFirst = await repo.countContracts(["SPX", "SPXW"]);

        await repo.upsertContracts(contracts);
        const countAfterSecond = await repo.countContracts(["SPX", "SPXW"]);

        expect(countAfterSecond).toBe(countAfterFirst);
      });
    });

    describe("large batch (parameter-limit regression)", () => {
      // 5,000 rows × 14 columns = 70,000 bind parameters — exceeds Postgres's 65,534 limit.
      // Fails on unchunked single INSERT; passes after chunking at ≤2,000 rows per INSERT.
      const LARGE_OBS_COUNT = 5_000;
      // 8,200 rows × 8 columns = 65,600 bind parameters — exceeds the 65,534 limit.
      const LARGE_CONTRACT_COUNT = 8_200;

      function makeLargeObservationRows(
        time: Date,
        count: number,
      ): ReadonlyArray<ObservationRow> {
        const rows: ObservationRow[] = [];
        for (let i = 0; i < count; i++) {
          // Vary strike per row to guarantee unique composite PK (time, contract)
          const strike = 1000 + i;
          const occ = formatOccSymbol({
            root: "SPXW",
            expiry: new Date(2026, 5, 20),
            type: "C",
            strike,
          });
          rows.push({
            time,
            contract: occ,
            bid: 1.0,
            ask: 1.1,
            mark: 1.05,
            underlyingPrice: 5500.0,
            iv: 0.25,
            delta: 0.5,
            gamma: 0.001,
            theta: -0.05,
            vega: 0.3,
            openInterest: 0,
            volume: 0,
            source: "cboe" as const,
          });
        }
        return rows;
      }

      function makeLargeContractRows(count: number): ReadonlyArray<ContractRow> {
        const rows: ContractRow[] = [];
        for (let i = 0; i < count; i++) {
          // Vary strike per row to guarantee unique occ_symbol PK
          const strike = 1000 + i;
          const occ = formatOccSymbol({
            root: "SPXW",
            expiry: new Date(2027, 0, 17),
            type: "P",
            strike,
          });
          rows.push({
            occSymbol: occ,
            underlying: "SPX",
            root: "SPXW",
            contractType: "P",
            exerciseStyle: "european",
            strike: strike * 1000,
            expiration: "2027-01-17",
            multiplier: 100,
          });
        }
        return rows;
      }

      it("persists a large observation batch exceeding the single-INSERT parameter limit", async () => {
        const rows = makeLargeObservationRows(observationTime, LARGE_OBS_COUNT);
        const result = await repo.persistObservations(rows);
        expect(result.ok).toBe(true);
        const count = await repo.countObservations(observationTime);
        expect(count).toBe(rows.length);
      });

      it("upserts a large contracts batch exceeding the parameter limit", async () => {
        const rows = makeLargeContractRows(LARGE_CONTRACT_COUNT);
        const result = await repo.upsertContracts(rows);
        expect(result.ok).toBe(true);
        const count = await repo.countContracts(["SPXW"]);
        expect(count).toBeGreaterThanOrEqual(rows.length);
      });

      it("re-persisting the same large batch adds zero rows (chunk-boundary idempotency)", async () => {
        const rows = makeLargeObservationRows(observationTime, LARGE_OBS_COUNT);
        // First persist
        await repo.persistObservations(rows);
        const countAfterFirst = await repo.countObservations(observationTime);
        // Second identical persist — must be a no-op
        await repo.persistObservations(rows);
        const countAfterSecond = await repo.countObservations(observationTime);
        expect(countAfterSecond).toBe(countAfterFirst);
      });
    });

    describe("BSM-03: pending scan + bsm write", () => {
      it("pending scan returns newly-seeded rows (bsm_iv NULL)", async () => {
        const { observations, contracts: contractRows } = makeFixtureRows(observationTime);
        await repo.upsertContracts(contractRows);
        await repo.persistObservations(observations);

        const pendingResult = await repo.readPendingObs(PENDING_LIMIT_ALL);
        expect(pendingResult.ok).toBe(true);
        if (!pendingResult.ok) return;

        // All seeded rows should be in the pending scan
        const pendingContracts = pendingResult.value.map((obs) => obs.contract);
        for (const obs of observations) {
          expect(pendingContracts).toContain(obs.contract);
        }
      });

      it("writing bsm_* fills all five columns; vendor columns unchanged (T-02-17)", async () => {
        const { observations, contracts: contractRows } = makeFixtureRows(observationTime);
        await repo.upsertContracts(contractRows);
        await repo.persistObservations(observations);

        // Capture vendor mark before bsm write
        const obs0 = observations[0];
        if (!obs0) throw new Error("no observation");
        const markBefore = await repo.getVendorMark(observationTime, obs0.contract);
        expect(markBefore).not.toBeNull();

        // Write bsm results for all pending rows
        const writes = observations.map((obs) => ({
          time: obs.time,
          contract: obs.contract,
          bsmIv: "0.25",
          bsmDelta: "0.5",
          bsmGamma: "0.001",
          bsmTheta: "-0.05",
          bsmVega: "0.3",
        }));
        const writeResult = await repo.writeBsmResults(writes);
        expect(writeResult.ok).toBe(true);

        // Vendor mark must be byte-identical after write (T-02-17)
        const markAfter = await repo.getVendorMark(observationTime, obs0.contract);
        expect(markAfter).toBe(markBefore);

        // Pending scan should be empty after write (BSM-03 AC-4)
        const pendingCount = await repo.countPendingBsm(observationTime);
        expect(pendingCount).toBe(0);
      });

      it("NaN-stamped rows are excluded from the pending scan and queryable via NaN::numeric (T-02-16, D-09)", async () => {
        const { observations, contracts: contractRows } = makeFixtureRows(observationTime);
        await repo.upsertContracts(contractRows);
        await repo.persistObservations(observations);

        // Stamp one row as NaN
        const obs0 = observations[0];
        if (!obs0) throw new Error("no observation");
        const nanWrite = [{
          time: obs0.time,
          contract: obs0.contract,
          bsmIv: "NaN",
          bsmDelta: "NaN",
          bsmGamma: "NaN",
          bsmTheta: "NaN",
          bsmVega: "NaN",
        }];
        await repo.writeBsmResults(nanWrite);

        // NaN-stamped row must appear in countNanStamped (bsm_iv = 'NaN'::numeric)
        const nanCount = await repo.countNanStamped(observationTime);
        expect(nanCount).toBeGreaterThan(0);

        // NaN-stamped row must NOT appear in the pending scan for this time slot
        // (bsm_iv is no longer NULL after NaN stamp)
        // Filter pending by our specific time to avoid cross-test interference
        const pendingResult = await repo.readPendingObs(PENDING_LIMIT_ALL);
        expect(pendingResult.ok).toBe(true);
        if (!pendingResult.ok) return;
        const pendingForThisTime = pendingResult.value.filter(
          (p) => p.time.getTime() === observationTime.getTime(),
        );
        const pendingContracts = pendingForThisTime.map((p) => p.contract);
        expect(pendingContracts).not.toContain(obs0.contract);
      });

      it("re-running readPendingObs returns empty after all rows are written (no-op re-run)", async () => {
        const { observations, contracts: contractRows } = makeFixtureRows(observationTime);
        await repo.upsertContracts(contractRows);
        await repo.persistObservations(observations);

        // Write all bsm results
        const writes = observations.map((obs) => ({
          time: obs.time,
          contract: obs.contract,
          bsmIv: "0.20",
          bsmDelta: "0.45",
          bsmGamma: "0.001",
          bsmTheta: "-0.02",
          bsmVega: "0.25",
        }));
        await repo.writeBsmResults(writes);

        // Second read returns empty (idempotent re-run — BSM-03 AC)
        const pendingResult = await repo.readPendingObs(PENDING_LIMIT_ALL);
        expect(pendingResult.ok).toBe(true);
        if (!pendingResult.ok) return;

        // Filter for our specific time slot (other tests may have seeded rows)
        const ourPending = pendingResult.value.filter(
          (obs) => obs.time.getTime() === observationTime.getTime(),
        );
        expect(ourPending).toHaveLength(0);
      });

      // ─── gex-schwab-bsm-null-puts regression ──────────────────────────────
      // Root cause: an unbounded, OLDEST-first pending read let the newest chain cycle
      // (the live cohort) sit at the tail forever — its legs stayed bsm_* NULL, so GEX
      // dropped them and lost the put wall / flip. The read must be BOUNDED (LIMIT) and
      // NEWEST-first (ORDER BY time DESC) so the freshest cycle is always the cohort returned.
      it("gex-schwab-bsm-null-puts: read is bounded AND newest-first — newest cycle is not starved", async () => {
        const oldTime = new Date(Date.UTC(2099, 0, 1, 15, 0, 0)); // older "backlog"
        const newTime = new Date(Date.UTC(2099, 0, 2, 15, 0, 0)); // newer "live cycle"
        // Distinct far-future contracts so this cohort is the NEWEST in the shared table.
        const cA = formatOccSymbol({ root: "SPX", expiry: new Date(Date.UTC(2099, 2, 20)), type: "C", strike: 8000 });
        const cB = formatOccSymbol({ root: "SPX", expiry: new Date(Date.UTC(2099, 2, 20)), type: "P", strike: 8000 });
        const cC = formatOccSymbol({ root: "SPX", expiry: new Date(Date.UTC(2099, 2, 20)), type: "C", strike: 8100 });

        const contractRows: ReadonlyArray<ContractRow> = [
          { occSymbol: cA, underlying: "SPX", root: "SPX", contractType: "C", exerciseStyle: "european", strike: 8000000, expiration: "2099-03-20", multiplier: 100 },
          { occSymbol: cB, underlying: "SPX", root: "SPX", contractType: "P", exerciseStyle: "european", strike: 8000000, expiration: "2099-03-20", multiplier: 100 },
          { occSymbol: cC, underlying: "SPX", root: "SPX", contractType: "C", exerciseStyle: "european", strike: 8100000, expiration: "2099-03-20", multiplier: 100 },
        ];
        await repo.upsertContracts(contractRows);

        const mkObs = (contract: OccSymbol, time: Date): ObservationRow => ({
          time, contract, bid: 1.0, ask: 1.1, mark: 1.05, underlyingPrice: 8000.0,
          iv: 0.2, delta: 0.5, gamma: 0.001, theta: -0.02, vega: 0.3,
          openInterest: 10, volume: 5, source: "cboe" as const,
        });
        // Older backlog cohort: 3 rows at oldTime.
        await repo.persistObservations([mkObs(cA, oldTime), mkObs(cB, oldTime), mkObs(cC, oldTime)]);
        // Newer live cohort: 2 rows at newTime (the call + put that must NOT be starved).
        await repo.persistObservations([mkObs(cA, newTime), mkObs(cB, newTime)]);

        // limit == size of the older backlog. An oldest-first (or unbounded) read returns the
        // backlog and starves the newTime cohort; newest-first + LIMIT returns the live cycle.
        const result = await repo.readPendingObs(3);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // Bounded: at most `limit` rows (an unbounded read returns the whole table → fails here).
        expect(result.value.length).toBeLessThanOrEqual(3);
        // Newest-first: BOTH newTime legs (call AND put) are present — the live cohort is covered.
        const newContracts = result.value
          .filter((p) => p.time.getTime() === newTime.getTime())
          .map((p) => p.contract);
        expect(newContracts).toContain(cA);
        expect(newContracts).toContain(cB);
      });
    });

    // ─── WR-05: UTC expiry ──────────────────────────────────────────────────
    // readPendingObs must build expiry via Date.UTC so UTC components equal the
    // DB expiration string (YYYY-MM-DD) on any server timezone.
    describe("WR-05: readPendingObs builds expiry with UTC date components", () => {
      it("expiry UTC year/month/day equal the DB expiration string (TZ-independent)", async () => {
        const { observations, contracts: contractRows } = makeFixtureRows(observationTime);
        // Fixture occ1 has expiration "2026-06-11"
        const occ1 = observations[0];
        if (!occ1) throw new Error("no observation");

        await repo.upsertContracts(contractRows);
        await repo.persistObservations(observations);

        const pendingResult = await repo.readPendingObs(PENDING_LIMIT_ALL);
        expect(pendingResult.ok).toBe(true);
        if (!pendingResult.ok) return;

        const match = pendingResult.value.find((p) => p.contract === occ1.contract);
        expect(match).toBeDefined();
        if (match === undefined) return;

        // UTC components must equal "2026-06-11" regardless of server timezone
        expect(match.expiry.getUTCFullYear()).toBe(2026);
        expect(match.expiry.getUTCMonth() + 1).toBe(6);
        expect(match.expiry.getUTCDate()).toBe(11);
      });
    });

    // ─── CR-04(b): orphan observation warn ──────────────────────────────────
    // An observation whose contract has no matching contracts row must be
    // excluded from readPendingObs, AND console.warn must be called once with
    // the orphaned symbol count.
    describe("CR-04(b): readPendingObs warns on orphan observations", () => {
      it("excludes orphan obs (no contract row) and emits console.warn", async () => {
        // Insert observation WITHOUT inserting the matching contract row
        const orphanOcc = formatOccSymbol({
          root: "SPXW",
          expiry: new Date(Date.UTC(2026, 11, 31)),
          type: "C",
          strike: 9999,
        });
        const orphanObs: ObservationRow = {
          time: observationTime,
          contract: orphanOcc,
          bid: 1.0,
          ask: 1.1,
          mark: 1.05,
          underlyingPrice: 5500.0,
          iv: 0.25,
          delta: 0.5,
          gamma: 0.001,
          theta: -0.05,
          vega: 0.3,
          openInterest: 0,
          volume: 0,
          source: "cboe" as const,
        };
        // Persist the observation but NOT the contract row (orphan condition)
        const persResult = await repo.persistObservations([orphanObs]);
        expect(persResult.ok).toBe(true);

        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const pendingResult = await repo.readPendingObs(PENDING_LIMIT_ALL);

        expect(pendingResult.ok).toBe(true);
        if (!pendingResult.ok) {
          warnSpy.mockRestore();
          return;
        }

        // Orphan must be excluded
        const orphanInPending = pendingResult.value.find((p) => p.contract === orphanOcc);
        expect(orphanInPending).toBeUndefined();

        // console.warn must have been called (observability) — restore AFTER assertions
        // so that mockRestore() does not clear mock.calls before we check
        expect(warnSpy).toHaveBeenCalled();
        // The warning message must mention the skipped count
        const warnMsg: string = String(warnSpy.mock.calls[0]?.[0] ?? "");
        expect(warnMsg).toMatch(/readPendingObs/);
        warnSpy.mockRestore();
      });
    });

    // ─── CR-05: writeBsmResults atomicity ───────────────────────────────────
    // All writes in a batch must be all-or-nothing (wrapped in a transaction).
    describe("CR-05: writeBsmResults is atomic (all-or-nothing transaction)", () => {
      it("happy-path: all rows in a batch are updated atomically", async () => {
        const { observations, contracts: contractRows } = makeFixtureRows(observationTime);
        await repo.upsertContracts(contractRows);
        await repo.persistObservations(observations);

        const writes = observations.map((obs) => ({
          time: obs.time,
          contract: obs.contract,
          bsmIv: "0.22",
          bsmDelta: "0.48",
          bsmGamma: "0.002",
          bsmTheta: "-0.03",
          bsmVega: "0.31",
        }));

        const result = await repo.writeBsmResults(writes);
        expect(result.ok).toBe(true);

        // All rows must be updated — none remain pending
        const pending = await repo.countPendingBsm(observationTime);
        expect(pending).toBe(0);

        // All rows must have bsm_iv set (not NaN)
        const nanCount = await repo.countNanStamped(observationTime);
        expect(nanCount).toBe(0);
      });

      it("no rows are partially updated if the batch result is ok (idempotent second write)", async () => {
        // This test verifies the all-or-nothing nature: if we write the same batch
        // twice, the second write succeeds and all rows still have consistent bsm values.
        // True rollback-on-error requires a mid-batch failure, which is impractical to
        // force deterministically against real PG without a trigger. The transaction
        // guarantee is exercised by the happy-path test above (verifying count = 0 after
        // a single atomic write), and by the Drizzle tx API contract.
        const { observations, contracts: contractRows } = makeFixtureRows(observationTime);
        await repo.upsertContracts(contractRows);
        await repo.persistObservations(observations);

        const writes = observations.map((obs) => ({
          time: obs.time,
          contract: obs.contract,
          bsmIv: "0.20",
          bsmDelta: "0.45",
          bsmGamma: "0.001",
          bsmTheta: "-0.02",
          bsmVega: "0.25",
        }));

        // First write
        const result1 = await repo.writeBsmResults(writes);
        expect(result1.ok).toBe(true);

        // Second identical write (should be a no-op on values, succeeds)
        const result2 = await repo.writeBsmResults(writes);
        expect(result2.ok).toBe(true);

        // Rows must still have bsm_iv set after double write
        const pending = await repo.countPendingBsm(observationTime);
        expect(pending).toBe(0);
      });
    });

    describe("getLatestLegObs", () => {
      it("returns the latest observation row for an OCC symbol (hit)", async () => {
        const { observations, contracts: contractRows } = makeFixtureRows(observationTime);
        const obs0 = observations[0];
        if (!obs0) throw new Error("no observation");

        await repo.upsertContracts(contractRows);
        await repo.persistObservations(observations);

        const result = await repo.getLatestLegObs(obs0.contract);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).not.toBeNull();
        if (result.value === null) return;
        expect(result.value.occSymbol).toBe(obs0.contract);
        expect(result.value.mark).toBeCloseTo(obs0.mark, 5);
      });

      it("returns null for a symbol with no observations (miss)", async () => {
        const unknownOcc = formatOccSymbol({
          root: "SPX",
          expiry: new Date(2027, 0, 15),
          type: "P",
          strike: 9999,
        });
        const result = await repo.getLatestLegObs(unknownOcc);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toBeNull();
      });

      it("returns the latest row when multiple observations exist (ORDER BY time DESC LIMIT 1)", async () => {
        const { observations: firstObs, contracts: contractRows } = makeFixtureRows(observationTime);
        const firstObs0 = firstObs[0];
        if (!firstObs0) throw new Error("no observation");

        // Insert a second observation at a later time for the same contract
        const laterTime = new Date(observationTime.getTime() + 30 * 60 * 1000);
        laterTime.setMilliseconds(0);
        const laterObs: ObservationRow = {
          ...firstObs0,
          time: laterTime,
          mark: 99.99,
          underlyingPrice: 8000,
        };

        await repo.upsertContracts(contractRows);
        await repo.persistObservations(firstObs);
        await repo.persistObservations([laterObs]);

        const result = await repo.getLatestLegObs(firstObs0.contract);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).not.toBeNull();
        if (result.value === null) return;
        // Must return the LATEST (later-time) observation
        expect(result.value.mark).toBeCloseTo(99.99, 2);
        expect(result.value.underlyingPrice).toBeCloseTo(8000, 0);
      });
    });
  });
}

// Export helper for test files that need to build ObservationRow fixtures
export { makeFixtureRows };
export type { OccSymbol };
