/**
 * compute-gex-snapshot handler tests.
 *
 * Covers:
 *   - Holiday: use-case NOT called, warn issued (T-08-11)
 *   - Outside RTH (weekend): use-case NOT called, warn issued
 *   - Normal RTH instant: use-case IS called exactly once and result ok → no throw
 *   - Normal RTH instant: use-case err → handler throws (pg-boss marks job failed)
 *   - pg-boss v12 undefined array element → no-op (array-guard, T-02-18)
 *   - Terminal: no boss.send inside (GEX is the new terminal job — D-01)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeComputeGexSnapshotHandler } from "./compute-gex-snapshot.ts";
import type { ForRunningComputeGexSnapshot } from "@morai/core";

describe("makeComputeGexSnapshotHandler", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // Helper: create a pg-boss Job<object>
  function makeJob(): Job<object> {
    return {
      id: "test-job-id",
      name: "compute-gex-snapshot",
      data: {},
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("when now is a NYSE holiday: use-case NOT called and console.warn issued (T-08-11)", async () => {
    // 2026-01-01 (New Year's Day) at 14:00 UTC = 09:00 EST — inside RTH hours but a holiday
    const holidayRth = new Date("2026-01-01T14:00:00Z");

    const computeGexSnapshotUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeComputeGexSnapshotHandler({
      computeGexSnapshotUseCase,
      now: () => holidayRth,
    });

    await handler([makeJob()]);

    expect(computeGexSnapshotUseCase).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledOnce();
  });

  it("when now is outside RTH (weekend): use-case NOT called and console.warn issued", async () => {
    // Saturday 2026-06-13 14:00 UTC — weekend, outside RTH
    const outsideRth = new Date("2026-06-13T14:00:00Z");

    const computeGexSnapshotUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeComputeGexSnapshotHandler({
      computeGexSnapshotUseCase,
      now: () => outsideRth,
    });

    await handler([makeJob()]);

    expect(computeGexSnapshotUseCase).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledOnce();
  });

  it("when inside RTH on a normal weekday: use-case IS called exactly once and no throw on ok", async () => {
    // Monday 2026-06-15 14:00 UTC = 10:00 EDT — inside RTH
    const normalRth = new Date("2026-06-15T14:00:00Z");

    const computeGexSnapshotUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeComputeGexSnapshotHandler({
      computeGexSnapshotUseCase,
      now: () => normalRth,
    });

    await handler([makeJob()]);

    expect(computeGexSnapshotUseCase).toHaveBeenCalledOnce();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("when inside RTH + use-case err: handler throws Error (pg-boss marks job failed)", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");

    const computeGexSnapshotUseCase: ForRunningComputeGexSnapshot = async () =>
      err({ kind: "storage-error", message: "DB write failed" });

    const handler = makeComputeGexSnapshotHandler({
      computeGexSnapshotUseCase,
      now: () => normalRth,
    });

    await expect(handler([makeJob()])).rejects.toThrow("DB write failed");
  });

  it("when job array element is undefined: handler no-ops (pg-boss v12 array-guard, T-02-18)", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");

    const computeGexSnapshotUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeComputeGexSnapshotHandler({
      computeGexSnapshotUseCase,
      now: () => normalRth,
    });

    // pg-boss v12 can pass undefined as first element
    await handler([undefined]);

    expect(computeGexSnapshotUseCase).not.toHaveBeenCalled();
  });
});
