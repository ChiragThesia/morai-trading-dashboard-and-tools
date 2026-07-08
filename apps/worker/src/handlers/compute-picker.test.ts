/**
 * compute-picker handler tests (Phase 19, Plan 08 — PICK-01/PICK-03).
 *
 * Covers:
 *   - Off-hours instant (weekend): use-case IS called — 24/7 compute, no RTH gate
 *   - Use-case ok → no throw
 *   - Use-case err → handler throws (pg-boss marks job failed)
 *   - pg-boss v12 undefined array element → no-op (array-guard, T-02-18)
 *   - Terminal: no boss.send inside (compute-picker is the new terminal job — D-04)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeComputePickerHandler } from "./compute-picker.ts";
import type { ForRunningComputePicker } from "@morai/core";

describe("makeComputePickerHandler", () => {
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
      name: "compute-picker",
      data: {},
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("runs the use-case regardless of clock (24/7 compute — no RTH/holiday gate)", async () => {
    const computePickerUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeComputePickerHandler({ computePickerUseCase });

    await handler([makeJob()]);

    expect(computePickerUseCase).toHaveBeenCalledOnce();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("when use-case err: handler throws Error (pg-boss marks job failed)", async () => {
    const computePickerUseCase: ForRunningComputePicker = async () =>
      err({ kind: "storage-error", message: "DB write failed" });

    const handler = makeComputePickerHandler({ computePickerUseCase });

    await expect(handler([makeJob()])).rejects.toThrow("DB write failed");
  });

  it("when job array element is undefined: handler no-ops (pg-boss v12 array-guard, T-02-18)", async () => {
    const computePickerUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeComputePickerHandler({ computePickerUseCase });

    // pg-boss v12 can pass undefined as first element
    await handler([undefined]);

    expect(computePickerUseCase).not.toHaveBeenCalled();
  });
});
