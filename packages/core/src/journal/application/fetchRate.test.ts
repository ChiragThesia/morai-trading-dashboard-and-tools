import { describe, it, expect, vi } from "vitest";
import type { ForFetchingRate, ForPersistingRate, RateObservation } from "./ports.ts";
import { ok, err } from "@morai/shared";
import { makeFetchRateUseCase } from "./fetchRate.ts";

/**
 * fetchRate use-case tests — fully in-memory (no Docker, no msw).
 *
 * Verifies the orchestration: fetch → persist → return ok.
 * The FRED adapter and Postgres repo are replaced with vitest spies.
 */

describe("makeFetchRateUseCase", () => {
  it("calls fetchRate then persistRate with the returned observation", async () => {
    const observation: RateObservation = { date: "2026-06-10", rate: 0.0525 };

    const fetchRateSpy: ForFetchingRate = vi.fn().mockResolvedValue(ok(observation));
    const persistRateSpy: ForPersistingRate = vi.fn().mockResolvedValue(ok(undefined));

    const useCase = makeFetchRateUseCase({
      fetchRate: fetchRateSpy,
      persistRate: persistRateSpy,
    });

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(fetchRateSpy).toHaveBeenCalledOnce();
    expect(persistRateSpy).toHaveBeenCalledOnce();
    expect(persistRateSpy).toHaveBeenCalledWith(observation);
  });

  it("returns ok when both fetch and persist succeed", async () => {
    const fetchRate: ForFetchingRate = vi.fn().mockResolvedValue(
      ok({ date: "2026-06-10", rate: 0.045 }),
    );
    const persistRate: ForPersistingRate = vi.fn().mockResolvedValue(ok(undefined));

    const result = await makeFetchRateUseCase({ fetchRate, persistRate })();
    expect(result.ok).toBe(true);
  });

  it("propagates storage error when persistRate fails", async () => {
    const fetchRate: ForFetchingRate = vi.fn().mockResolvedValue(
      ok({ date: "2026-06-10", rate: 0.045 }),
    );
    const persistRate: ForPersistingRate = vi.fn().mockResolvedValue(
      err({ kind: "storage-error" as const, message: "disk full" }),
    );

    const result = await makeFetchRateUseCase({ fetchRate, persistRate })();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
  });

  it("persists the exact fallback observation returned by fetchRate (4.5%)", async () => {
    // fetchRate always returns ok (FRED adapter's fallback is already applied)
    const fallbackObs: RateObservation = { date: "2026-06-10", rate: 0.045 };
    const fetchRate: ForFetchingRate = vi.fn().mockResolvedValue(ok(fallbackObs));
    const persistRate: ForPersistingRate = vi.fn().mockResolvedValue(ok(undefined));

    await makeFetchRateUseCase({ fetchRate, persistRate })();

    expect(persistRate).toHaveBeenCalledWith(fallbackObs);
  });
});
