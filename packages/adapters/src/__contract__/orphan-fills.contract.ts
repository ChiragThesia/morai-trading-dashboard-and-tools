/**
 * Shared contract-test suite for the orphan-fills persistence ports.
 *
 * Run this suite against both:
 *   - The Postgres adapter (testcontainers) — packages/adapters/src/postgres/repos/orphan-fills.contract.test.ts
 *   - The in-memory twin — packages/adapters/src/memory/orphan-fills.contract.test.ts
 *
 * Asserts:
 * - storeOrphanFill: insert → one row
 * - storeOrphanFill idempotency: same fillId twice → one row (upsert on PK)
 * - storeOrphanFill: different fillId → two rows
 * - readOrphanFills: returns all orphan rows (no calendar scoping — global review surface)
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ForStoringOrphanFill, StorageError } from "@morai/core";

// ─── Domain type for orphan fills ────────────────────────────────────────────

export type OrphanFillRow = {
  readonly fillId: string;
  readonly occSymbol: string;
  readonly side: "buy" | "sell";
  readonly qty: number;
  readonly price: number;
  readonly filledAt: Date;
  readonly reason: string;
};

// ─── Repo type ────────────────────────────────────────────────────────────────

export type OrphanFillsRepo = {
  readonly storeOrphanFill: ForStoringOrphanFill;
  /** Count all orphan_fills rows */
  readonly countOrphans: () => Promise<number>;
  /** Get all orphan rows */
  readonly getAllOrphans: () => Promise<ReadonlyArray<OrphanFillRow>>;
};

// ─── Seed helpers ─────────────────────────────────────────────────────────────

export type OrphanFillsSeedContext = {
  /** No FK for orphan_fills (fill_id is the PK, no FK to fills table); no seed needed. */
  readonly __dummy: undefined;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FILL_ID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FILL_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeOrphanFill(fillId: string, overrides: Partial<OrphanFillRow> = {}): OrphanFillRow {
  return {
    fillId,
    occSymbol: "O:SPX260620P07100000",
    side: "buy",
    qty: 1,
    price: 15.5,
    filledAt: new Date("2026-06-15T14:00:00Z"),
    reason: "no matching calendar",
    ...overrides,
  };
}

// ─── Contract test suite ──────────────────────────────────────────────────────

export function runOrphanFillsContractTests(
  makeRepo: (seed: OrphanFillsSeedContext) => OrphanFillsRepo,
  getSeedContext: () => OrphanFillsSeedContext,
): void {
  describe("orphan-fills persistence contract", () => {
    let repo: OrphanFillsRepo;
    let seed: OrphanFillsSeedContext;

    beforeEach(() => {
      seed = getSeedContext();
      repo = makeRepo(seed);
    });

    describe("storeOrphanFill — idempotency", () => {
      it("inserts one row on first store", async () => {
        const orphan = makeOrphanFill(FILL_ID_1);

        const result = await repo.storeOrphanFill(orphan);
        expect(result.ok).toBe(true);

        const count = await repo.countOrphans();
        expect(count).toBe(1);
      });

      it("same fillId twice → exactly one row (upsert on fillId PK)", async () => {
        const orphan = makeOrphanFill(FILL_ID_1);

        await repo.storeOrphanFill(orphan);
        await repo.storeOrphanFill(orphan); // duplicate — must be no-op

        const count = await repo.countOrphans();
        expect(count).toBe(1);
      });

      it("different fillId → two rows", async () => {
        await repo.storeOrphanFill(makeOrphanFill(FILL_ID_1));
        await repo.storeOrphanFill(makeOrphanFill(FILL_ID_2));

        const count = await repo.countOrphans();
        expect(count).toBe(2);
      });
    });

    describe("getAllOrphans — read surface", () => {
      it("returns all stored orphan rows", async () => {
        await repo.storeOrphanFill(makeOrphanFill(FILL_ID_1, { reason: "no matching calendar" }));
        await repo.storeOrphanFill(makeOrphanFill(FILL_ID_2, { reason: "ambiguous calendar" }));

        const orphans = await repo.getAllOrphans();
        expect(orphans).toHaveLength(2);
        const reasons = orphans.map((o) => o.reason).sort();
        expect(reasons).toEqual(["ambiguous calendar", "no matching calendar"]);
      });

      it("returns empty array when no orphans", async () => {
        const orphans = await repo.getAllOrphans();
        expect(orphans).toHaveLength(0);
      });
    });

    // Silence unused import
    void seed;
  });
}

// Silence unused import — StorageError used in ForStoringOrphanFill
export type { StorageError };
