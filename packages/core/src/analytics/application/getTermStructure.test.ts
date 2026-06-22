/**
 * getTermStructure use-case (Phase 6, Plan 06-04 Task 2).
 *
 * Thin forwarder over ForReadingTermStructureSeries (getJournal precedent). Returns ok([]) when
 * no data; forwards the optional calendarId filter. No business logic.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeGetTermStructureUseCase } from "./getTermStructure.ts";
import type {
  ForReadingTermStructureSeries,
  TermStructureObservationRow,
} from "./ports.ts";

const CAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const row: TermStructureObservationRow = {
  snapshotTime: new Date("2026-07-01T19:00:00Z"),
  calendarId: CAL_A,
  value: 0.05,
  frontIv: 0.2,
  backIv: 0.25,
};

describe("makeGetTermStructureUseCase", () => {
  it("forwards to the read port and returns the series", async () => {
    const readSeries: ForReadingTermStructureSeries = async () => ok([row]);
    const useCase = makeGetTermStructureUseCase({ readTermStructureSeries: readSeries });

    const result = await useCase({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.value).toBe(0.05);
  });

  it("returns ok([]) when there is no data (not an error)", async () => {
    const readSeries: ForReadingTermStructureSeries = async () => ok([]);
    const useCase = makeGetTermStructureUseCase({ readTermStructureSeries: readSeries });

    const result = await useCase({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("passes the optional calendarId filter through to the read port", async () => {
    let received: { readonly calendarId?: string } | undefined;
    const readSeries: ForReadingTermStructureSeries = async (query) => {
      received = query;
      return ok([]);
    };
    const useCase = makeGetTermStructureUseCase({ readTermStructureSeries: readSeries });

    await useCase({ calendarId: CAL_A });
    expect(received?.calendarId).toBe(CAL_A);
  });

  it("propagates a storage error from the read port", async () => {
    const readSeries: ForReadingTermStructureSeries = async () =>
      err({ kind: "storage-error", message: "boom" });
    const useCase = makeGetTermStructureUseCase({ readTermStructureSeries: readSeries });

    const result = await useCase({});
    expect(result.ok).toBe(false);
  });
});
