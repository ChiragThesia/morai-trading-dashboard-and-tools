/**
 * Shared contract-test suite for the exit_verdicts persistence port (Phase 26, Plan 03).
 * Run this suite against BOTH the Postgres adapter (testcontainers) and the in-memory twin.
 *
 * Asserts:
 * - round-trip: insert → readLatestVerdictsPerCalendar returns it
 * - WR-01: a second insert for the SAME (observedAt, calendarId) with a DIFFERENT verdict
 *   blob does not overwrite the first, and does not error (onConflictDoNothing, T-26-07)
 * - readLatestVerdictsPerCalendar returns the single most-recent verdict per calendar
 * - a calendar with no prior verdict is absent from the result (not an error)
 * - a corrupted stored row (bypassing the repo's own write-path validation) surfaces a
 *   StorageError on read, never a silently-invalid domain shape (T-26-08)
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForPersistingExitVerdict,
  ForReadingLatestVerdictsPerCalendar,
  ExitVerdictRow,
  ExitVerdict,
} from "@morai/core";

// ─── Repo type ────────────────────────────────────────────────────────────────

export type ExitVerdictsRepo = {
  readonly insertExitVerdict: ForPersistingExitVerdict;
  readonly readLatestVerdictsPerCalendar: ForReadingLatestVerdictsPerCalendar;
  /**
   * seedRawVerdict — test-only: write a raw, UNVALIDATED blob directly into storage,
   * bypassing the repo's own Zod validation. Simulates a legacy/corrupted stored row
   * (mirrors picker-snapshot.contract.test.ts's raw-SQL-INSERT bypass, but works
   * identically across both the Postgres and memory adapters via one shared assertion).
   */
  readonly seedRawVerdict: (
    observedAt: Date,
    calendarId: string,
    rawBlob: unknown,
  ) => Promise<void>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAL_NO_VERDICT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const T1 = new Date("2026-07-01T14:00:00Z");
const T2 = new Date("2026-07-01T14:30:00Z"); // distinct timestamp — later cohort

function makeVerdict(overrides: Partial<ExitVerdict> = {}): ExitVerdict {
  return {
    verdict: "HOLD",
    rung: null,
    ruleId: "HOLD-default",
    metric: { name: "pnlPct", value: 0.02, threshold: 0.05 },
    indicative: false,
    escalate: false,
    roll: null,
    ...overrides,
  };
}

function makeRow(
  observedAt: Date,
  calendarId: string,
  overrides: Partial<ExitVerdict> = {},
): ExitVerdictRow {
  return { observedAt, calendarId, verdict: makeVerdict(overrides) };
}

// ─── Contract test suite ──────────────────────────────────────────────────────

export function runExitVerdictsContractTests(makeRepo: () => ExitVerdictsRepo): void {
  describe("exit-verdicts persistence contract", () => {
    let repo: ExitVerdictsRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("returns ok([]) when no verdicts exist", async () => {
      const result = await repo.readLatestVerdictsPerCalendar();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it("round-trip: insert then read returns the row for that calendar", async () => {
      const row = makeRow(T1, CAL_A, { verdict: "TAKE", rung: "+5%", ruleId: "TAKE-5" });

      const insertResult = await repo.insertExitVerdict(row);
      expect(insertResult.ok).toBe(true);

      const readResult = await repo.readLatestVerdictsPerCalendar();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      const found = readResult.value.find((r) => r.calendarId === CAL_A);
      expect(found).toBeDefined();
      expect(found?.verdict.verdict).toBe("TAKE");
      expect(found?.verdict.rung).toBe("+5%");
      expect(found?.observedAt.getTime()).toBe(T1.getTime());
    });

    it("WR-01: a second insert for the SAME (observedAt, calendarId) with a DIFFERENT blob does not overwrite the first, and does not error", async () => {
      const first = makeRow(T1, CAL_A, { verdict: "HOLD", ruleId: "HOLD-default" });
      const retrigger = makeRow(T1, CAL_A, {
        verdict: "STOP",
        rung: "-25%",
        ruleId: "STOP-25",
      });

      const insert1 = await repo.insertExitVerdict(first);
      expect(insert1.ok).toBe(true);
      const insert2 = await repo.insertExitVerdict(retrigger);
      expect(insert2.ok).toBe(true); // must NOT surface a PK-violation StorageError

      const readResult = await repo.readLatestVerdictsPerCalendar();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      const found = readResult.value.find((r) => r.calendarId === CAL_A);
      expect(found?.verdict.verdict).toBe("HOLD"); // first-write-wins, never overwritten
      expect(found?.verdict.ruleId).toBe("HOLD-default");
    });

    it("readLatestVerdictsPerCalendar returns the single most-recent verdict per calendar", async () => {
      await repo.insertExitVerdict(makeRow(T1, CAL_A, { verdict: "HOLD" }));
      await repo.insertExitVerdict(
        makeRow(T2, CAL_A, { verdict: "TAKE", rung: "+10%", ruleId: "TAKE-10" }),
      );

      const readResult = await repo.readLatestVerdictsPerCalendar();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      const rowsForCal = readResult.value.filter((r) => r.calendarId === CAL_A);
      expect(rowsForCal).toHaveLength(1);
      expect(rowsForCal[0]?.verdict.verdict).toBe("TAKE");
      expect(rowsForCal[0]?.observedAt.getTime()).toBe(T2.getTime());
    });

    it("distinguishes verdicts across multiple calendars in the same read", async () => {
      await repo.insertExitVerdict(makeRow(T1, CAL_A, { verdict: "HOLD" }));
      await repo.insertExitVerdict(makeRow(T1, CAL_B, { verdict: "STOP", rung: "-50%" }));

      const readResult = await repo.readLatestVerdictsPerCalendar();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      const bySource = new Map(readResult.value.map((r) => [r.calendarId, r]));
      expect(bySource.get(CAL_A)?.verdict.verdict).toBe("HOLD");
      expect(bySource.get(CAL_B)?.verdict.verdict).toBe("STOP");
    });

    it("a calendar with no prior verdict is absent from the result (not an error)", async () => {
      await repo.insertExitVerdict(makeRow(T1, CAL_A));

      const readResult = await repo.readLatestVerdictsPerCalendar();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      expect(readResult.value.some((r) => r.calendarId === CAL_NO_VERDICT)).toBe(false);
    });

    it("T-26-08: a corrupted stored row surfaces a StorageError on read, never a silently-invalid shape", async () => {
      await repo.seedRawVerdict(T1, CAL_A, { not: "a valid verdict blob" });

      const result = await repo.readLatestVerdictsPerCalendar();
      expect(result.ok).toBe(false);
    });

    it("rejects an insert whose verdict blob violates the exitVerdict contract (empty ruleId, EXIT-04) — zero rows land", async () => {
      const badRow = makeRow(T1, CAL_A, { ruleId: "" });

      const insertResult = await repo.insertExitVerdict(badRow);
      expect(insertResult.ok).toBe(false);

      const readResult = await repo.readLatestVerdictsPerCalendar();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      expect(readResult.value.some((r) => r.calendarId === CAL_A)).toBe(false);
    });
  });
}
