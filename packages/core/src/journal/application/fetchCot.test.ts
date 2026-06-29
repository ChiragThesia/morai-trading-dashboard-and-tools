/**
 * fetchCot.test.ts — makeFetchCot orchestration use-case (COT-01).
 *
 * Tests verify:
 *   1. fetch err → propagated, persist not called (short-circuit)
 *   2. fetch ok → persist called with CotObservationRow
 *   3. publishedAt = injected clock (D-07); as_of = report date (D-08); they differ
 *   4. idempotency: double-invoke same as_of → memory store holds 1 row (D-09)
 *   5. default contractCode = "13874A"; custom contractCode is honoured
 *   6. persist err → propagated
 *
 * Test doubles are inline function implementations (core cannot import adapters —
 * architecture-boundaries §2). The idempotency test uses an inline store that mirrors
 * makeMemoryCotObservationsRepo's ON CONFLICT (contract_code, as_of) DO NOTHING semantics.
 *
 * No any/as/! (typescript.md). All promises awaited.
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import type {
  CotReport,
  CotObservationRow,
  ForFetchingCotReport,
  ForPersistingCotObservation,
} from "./ports.ts";
import { makeFetchCot } from "./fetchCot.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_REPORT: CotReport = {
  contractCode: "13874A",
  asOf: "2026-01-13", // Tuesday report date (D-08)
  openInterest: 500_000,
  dealerLong: 100_000,
  dealerShort: 80_000,
  assetMgrLong: 200_000,
  assetMgrShort: 150_000,
  levMoneyLong: 300_000,
  levMoneyShort: 280_000,
  otherReptLong: 50_000,
  otherReptShort: 40_000,
  nonreptLong: 80_000,
  nonreptShort: 70_000,
};

// Fixed Friday fetch time — must differ from asOf (D-07 vs D-08)
const FIXED_NOW = new Date("2026-01-17T21:00:00Z");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeFetchCot", () => {
  it("returns ok(void) and persists one row when fetch succeeds", async () => {
    const fetchCotReport: ForFetchingCotReport = vi
      .fn()
      .mockResolvedValue(ok(BASE_REPORT));
    const persistCotObservation: ForPersistingCotObservation = vi
      .fn()
      .mockResolvedValue(ok(undefined));

    const useCase = makeFetchCot({
      fetchCotReport,
      persistCotObservation,
      now: () => FIXED_NOW,
    });

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(persistCotObservation).toHaveBeenCalledOnce();
  });

  it("propagates fetch error and does NOT call persist", async () => {
    const fetchErr = { kind: "fetch-error" as const, message: "CFTC unavailable" };
    const fetchCotReport: ForFetchingCotReport = vi
      .fn()
      .mockResolvedValue(err(fetchErr));
    const persistCotObservation: ForPersistingCotObservation = vi
      .fn()
      .mockResolvedValue(ok(undefined));

    const useCase = makeFetchCot({
      fetchCotReport,
      persistCotObservation,
      now: () => FIXED_NOW,
    });

    const result = await useCase();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
    expect(persistCotObservation).not.toHaveBeenCalled();
  });

  it("propagates persist/storage error", async () => {
    const fetchCotReport: ForFetchingCotReport = vi
      .fn()
      .mockResolvedValue(ok(BASE_REPORT));
    const storageErr = { kind: "storage-error" as const, message: "disk full" };
    const persistCotObservation: ForPersistingCotObservation = vi
      .fn()
      .mockResolvedValue(err(storageErr));

    const useCase = makeFetchCot({
      fetchCotReport,
      persistCotObservation,
      now: () => FIXED_NOW,
    });

    const result = await useCase();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
  });

  it("stamps publishedAt from the injected clock (D-07), not from the adapter", async () => {
    let persisted: CotObservationRow | undefined;
    const fetchCotReport: ForFetchingCotReport = vi
      .fn()
      .mockResolvedValue(ok(BASE_REPORT));
    const persistCotObservation: ForPersistingCotObservation = vi
      .fn()
      .mockImplementation(async (row: CotObservationRow) => {
        persisted = row;
        return ok(undefined);
      });

    await makeFetchCot({
      fetchCotReport,
      persistCotObservation,
      now: () => FIXED_NOW,
    })();

    // publishedAt = injected clock (Friday, D-07)
    expect(persisted?.publishedAt).toEqual(FIXED_NOW);
    // as_of = report's own date field (Tuesday, D-08)
    expect(persisted?.asOf).toBe("2026-01-13");
    // They must differ — fetch day ≠ report day
    expect(persisted?.publishedAt.toISOString().slice(0, 10)).not.toBe(
      persisted?.asOf,
    );
  });

  it("idempotency: double-invoke same as_of → repo holds 1 row (D-09)", async () => {
    // Inline memory store — mirrors makeMemoryCotObservationsRepo
    // ON CONFLICT (contract_code, as_of) DO NOTHING semantics
    const store = new Map<string, CotObservationRow>();
    const insertCotObservation: ForPersistingCotObservation = async (row) => {
      const key = `${row.contractCode}|${row.asOf}`;
      if (!store.has(key)) {
        store.set(key, row);
      }
      return ok(undefined);
    };

    const fetchCotReport: ForFetchingCotReport = vi
      .fn()
      .mockResolvedValue(ok(BASE_REPORT));

    const useCase = makeFetchCot({
      fetchCotReport,
      persistCotObservation: insertCotObservation,
      now: () => FIXED_NOW,
    });

    // First invocation — row stored
    await useCase();
    // Second invocation — same as_of, repo absorbs the duplicate (no-op)
    await useCase();

    const rowsForWeek = [...store.values()].filter(
      (r) => r.asOf === BASE_REPORT.asOf,
    );
    expect(rowsForWeek).toHaveLength(1);
  });

  it("uses default contractCode '13874A' when not specified", async () => {
    let capturedCode: string | undefined;
    const fetchCotReport: ForFetchingCotReport = vi
      .fn()
      .mockImplementation(async (code: string) => {
        capturedCode = code;
        return ok(BASE_REPORT);
      });
    const persistCotObservation: ForPersistingCotObservation = vi
      .fn()
      .mockResolvedValue(ok(undefined));

    await makeFetchCot({
      fetchCotReport,
      persistCotObservation,
      now: () => FIXED_NOW,
    })();

    expect(capturedCode).toBe("13874A");
  });

  it("uses custom contractCode when specified", async () => {
    let capturedCode: string | undefined;
    const customReport: CotReport = { ...BASE_REPORT, contractCode: "CUSTOM" };
    const fetchCotReport: ForFetchingCotReport = vi
      .fn()
      .mockImplementation(async (code: string) => {
        capturedCode = code;
        return ok(customReport);
      });
    const persistCotObservation: ForPersistingCotObservation = vi
      .fn()
      .mockResolvedValue(ok(undefined));

    await makeFetchCot({
      fetchCotReport,
      persistCotObservation,
      now: () => FIXED_NOW,
      contractCode: "CUSTOM",
    })();

    expect(capturedCode).toBe("CUSTOM");
  });
});
