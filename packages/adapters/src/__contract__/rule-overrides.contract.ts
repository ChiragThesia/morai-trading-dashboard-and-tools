import { describe, it, expect, beforeEach } from "vitest";
import type { ForReadingRuleOverrides, ForWritingRuleOverrides } from "@morai/core";

/**
 * Shared contract-test suite for the rule-overrides persistence ports (Phase 29, 29-08).
 * Run this suite against BOTH the Postgres adapter (testcontainers) and the in-memory twin.
 *
 * Asserts:
 * - readRuleOverrides returns ok({}) when no row exists yet (fresh deployment, not an error)
 * - writeRuleOverrides then readRuleOverrides round-trips a partial overrides blob
 * - a second write is an upsert (onConflictDoUpdate) on the fixed singleton row, not an
 *   append — writing a smaller blob (a group removed) replaces the whole stored row, and
 *   the removed group is gone on the next read
 * - writeRuleOverrides rejects a blob that violates the ruleOverrides contract (unknown
 *   key) — zero rows land / the prior stored row is untouched
 * - a corrupted stored row (bypassing the repo's own write-path validation) surfaces a
 *   StorageError on read — never silently applied as valid config (T-29-12)
 */

export type RuleOverridesRepo = {
  readonly readRuleOverrides: ForReadingRuleOverrides;
  readonly writeRuleOverrides: ForWritingRuleOverrides;
  /**
   * seedRawOverrides — test-only: write a raw, UNVALIDATED blob directly into storage,
   * bypassing the repo's own Zod validation. Simulates a legacy/corrupted stored row
   * (mirrors exit-verdicts.contract.ts's seedRawVerdict bypass).
   */
  readonly seedRawOverrides: (rawBlob: unknown) => Promise<void>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PARTIAL_BLOB = {
  picker: { deltaBandMin: -0.45, maxOpenCalendars: 4 },
  exits: { take: { plus15Arm: 0.16, plus15Disarm: 0.1 } },
};

const SMALLER_BLOB = {
  exits: { take: { plus15Arm: 0.16, plus15Disarm: 0.1 } },
};

const INVALID_BLOB = { picker: { notARealField: 5 } };

export function runRuleOverridesContractTests(makeRepo: () => RuleOverridesRepo): void {
  describe("rule-overrides persistence contract", () => {
    let repo: RuleOverridesRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("returns ok({}) when no row exists yet", async () => {
      const result = await repo.readRuleOverrides();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({});
    });

    it("round-trip: write a partial blob then read it back", async () => {
      const writeResult = await repo.writeRuleOverrides(PARTIAL_BLOB);
      expect(writeResult.ok).toBe(true);

      const readResult = await repo.readRuleOverrides();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      expect(readResult.value).toEqual(PARTIAL_BLOB);
    });

    it("upsert: a second write with a group removed replaces the whole stored row (not an append)", async () => {
      await repo.writeRuleOverrides(PARTIAL_BLOB);
      const secondWrite = await repo.writeRuleOverrides(SMALLER_BLOB);
      expect(secondWrite.ok).toBe(true);

      const readResult = await repo.readRuleOverrides();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      expect(readResult.value).toEqual(SMALLER_BLOB);
      expect(readResult.value["picker"]).toBeUndefined(); // removed group is gone, not just emptied
    });

    it("rejects a write whose blob violates the ruleOverrides contract (unknown key) — prior row untouched", async () => {
      await repo.writeRuleOverrides(PARTIAL_BLOB);

      const badWrite = await repo.writeRuleOverrides(INVALID_BLOB);
      expect(badWrite.ok).toBe(false);

      const readResult = await repo.readRuleOverrides();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      expect(readResult.value).toEqual(PARTIAL_BLOB); // unchanged
    });

    it("T-29-12: a corrupted stored row surfaces a StorageError on read, never a silently-applied bad config", async () => {
      await repo.seedRawOverrides(INVALID_BLOB);

      const readResult = await repo.readRuleOverrides();
      expect(readResult.ok).toBe(false);
      if (readResult.ok) return;
      expect(readResult.error.kind).toBe("storage-error");
    });
  });
}
