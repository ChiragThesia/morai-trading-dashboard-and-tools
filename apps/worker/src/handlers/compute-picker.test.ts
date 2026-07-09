/**
 * compute-picker handler tests (Phase 19, Plan 08 — PICK-01/PICK-03; Phase 26, Plan 04 —
 * EXIT-01 chain extension).
 *
 * Covers:
 *   - Off-hours instant (weekend): use-case IS called — 24/7 compute, no RTH gate
 *   - Use-case ok → no throw
 *   - Use-case err → handler throws (pg-boss marks job failed); boss.send NOT called
 *   - pg-boss v12 undefined array element → no-op (array-guard, T-02-18)
 *   - 26-04 (EXIT-01): on success, boss.send("compute-exit-advice", ...) fires with a singletonKey
 *   - 26-04: boss.send rejects → handler still resolves, console.warn logs the failed enqueue
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeComputePickerHandler } from "./compute-picker.ts";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";
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

  // Helper: creates a typed boss stub satisfying BossForChainHandler
  function makeBossStub(): BossForChainHandler & { send: ReturnType<typeof vi.fn> } {
    return { send: vi.fn().mockResolvedValue("singleton-key") };
  }

  it("runs the use-case regardless of clock (24/7 compute — no RTH/holiday gate)", async () => {
    const computePickerUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeComputePickerHandler({ computePickerUseCase, boss });

    await handler([makeJob()]);

    expect(computePickerUseCase).toHaveBeenCalledOnce();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("when use-case err: handler throws Error (pg-boss marks job failed); boss.send NOT called", async () => {
    const computePickerUseCase: ForRunningComputePicker = async () =>
      err({ kind: "storage-error", message: "DB write failed" });
    const boss = makeBossStub();

    const handler = makeComputePickerHandler({ computePickerUseCase, boss });

    await expect(handler([makeJob()])).rejects.toThrow("DB write failed");
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("when job array element is undefined: handler no-ops (pg-boss v12 array-guard, T-02-18)", async () => {
    const computePickerUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeComputePickerHandler({ computePickerUseCase, boss });

    // pg-boss v12 can pass undefined as first element
    await handler([undefined]);

    expect(computePickerUseCase).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("26-04 (EXIT-01): on success, boss.send invoked with compute-exit-advice + singletonKey", async () => {
    const computePickerUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeComputePickerHandler({ computePickerUseCase, boss });

    await handler([makeJob()]);

    expect(boss.send).toHaveBeenCalledWith(
      "compute-exit-advice",
      {},
      expect.objectContaining({ singletonKey: expect.any(String) }),
    );
  });

  it("26-04: boss.send rejects → handler resolves and console.warn logs the failed enqueue", async () => {
    const computePickerUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss: BossForChainHandler & { send: ReturnType<typeof vi.fn> } = {
      send: vi.fn().mockRejectedValue(new Error("queue missing")),
    };

    const handler = makeComputePickerHandler({ computePickerUseCase, boss });

    await expect(handler([makeJob()])).resolves.toBeUndefined();

    // Flush microtask queue so the rejected promise settles before the warn spy check
    await Promise.resolve();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("compute-exit-advice"),
      expect.any(Error),
    );
  });
});
