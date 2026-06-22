/**
 * getSkew use-case — the headline skew read (ANLY-03 / SPEC R5).
 *
 * makeGetSkewUseCase is a thin forwarder over ForReadingSkewSeries (the risk-reversal series;
 * value = risk_reversal + rr_rank). ok([]) on no data; optional underlying/expiration filter.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeGetSkewUseCase } from "./getSkew.ts";
import type { ForReadingSkewSeries, RiskReversalObservationRow } from "./ports.ts";

const ROW: RiskReversalObservationRow = {
  snapshotTime: new Date("2026-07-01T19:00:00Z"),
  underlying: "SPX",
  expiration: "2026-07-17",
  riskReversal: 0.06,
  rrRank: 50,
};

describe("makeGetSkewUseCase", () => {
  it("forwards the query and returns the risk-reversal series", async () => {
    let received: { underlying?: string; expiration?: string } | undefined;
    const readSkewSeries: ForReadingSkewSeries = async (query) => {
      received = query;
      return ok([ROW]);
    };
    const getSkew = makeGetSkewUseCase({ readSkewSeries });
    const result = await getSkew({ underlying: "SPX", expiration: "2026-07-17" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.riskReversal).toBe(0.06);
    expect(received?.underlying).toBe("SPX");
    expect(received?.expiration).toBe("2026-07-17");
  });

  it("returns ok([]) when there is no data", async () => {
    const readSkewSeries: ForReadingSkewSeries = async () => ok([]);
    const getSkew = makeGetSkewUseCase({ readSkewSeries });
    const result = await getSkew({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("propagates a storage error", async () => {
    const readSkewSeries: ForReadingSkewSeries = async () =>
      err({ kind: "storage-error", message: "boom" });
    const getSkew = makeGetSkewUseCase({ readSkewSeries });
    const result = await getSkew({});
    expect(result.ok).toBe(false);
  });
});
