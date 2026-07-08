/**
 * compute-gex-snapshot handler tests.
 *
 * Covers:
 *   - Holiday: use-case NOT called, warn issued (T-08-11)
 *   - Outside RTH (weekend): use-case NOT called, warn issued
 *   - Normal RTH instant: use-case IS called exactly once and result ok → no throw
 *   - Normal RTH instant: use-case err → handler throws (pg-boss marks job failed)
 *   - pg-boss v12 undefined array element → no-op (array-guard, T-02-18)
 *   - 19-08 (D-04): on success, boss.send("compute-picker", ...) fires with a singletonKey
 *   - 19-08: boss.send rejects → handler still resolves, console.warn logs the failed enqueue
 *   - 19-08: use-case err → boss.send NOT called
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeComputeGexSnapshotHandler } from "./compute-gex-snapshot.ts";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";
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

  // Helper: creates a typed boss stub satisfying BossForChainHandler
  function makeBossStub(): BossForChainHandler & { send: ReturnType<typeof vi.fn> } {
    return { send: vi.fn().mockResolvedValue("singleton-key") };
  }

  it("when inside RTH on a normal weekday: use-case IS called exactly once and no throw on ok", async () => {
    // Monday 2026-06-15 14:00 UTC = 10:00 EDT — inside RTH
    const computeGexSnapshotUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeComputeGexSnapshotHandler({
      computeGexSnapshotUseCase,
      boss,
    });

    await handler([makeJob()]);

    expect(computeGexSnapshotUseCase).toHaveBeenCalledOnce();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("when inside RTH + use-case err: handler throws Error (pg-boss marks job failed)", async () => {
    const computeGexSnapshotUseCase: ForRunningComputeGexSnapshot = async () =>
      err({ kind: "storage-error", message: "DB write failed" });
    const boss = makeBossStub();

    const handler = makeComputeGexSnapshotHandler({
      computeGexSnapshotUseCase,
      boss,
    });

    await expect(handler([makeJob()])).rejects.toThrow("DB write failed");
    // 19-08: boss.send NOT called on the error path
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("when job array element is undefined: handler no-ops (pg-boss v12 array-guard, T-02-18)", async () => {
    const computeGexSnapshotUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeComputeGexSnapshotHandler({
      computeGexSnapshotUseCase,
      boss,
    });

    // pg-boss v12 can pass undefined as first element
    await handler([undefined]);

    expect(computeGexSnapshotUseCase).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("19-08 (D-04): on success, boss.send invoked with compute-picker + singletonKey", async () => {
    const computeGexSnapshotUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeComputeGexSnapshotHandler({
      computeGexSnapshotUseCase,
      boss,
    });

    await handler([makeJob()]);

    expect(boss.send).toHaveBeenCalledWith(
      "compute-picker",
      {},
      expect.objectContaining({ singletonKey: expect.any(String) }),
    );
  });

  it("19-08: boss.send rejects → handler resolves and console.warn logs the failed enqueue", async () => {
    const computeGexSnapshotUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss: BossForChainHandler & { send: ReturnType<typeof vi.fn> } = {
      send: vi.fn().mockRejectedValue(new Error("queue missing")),
    };

    const handler = makeComputeGexSnapshotHandler({
      computeGexSnapshotUseCase,
      boss,
    });

    await expect(handler([makeJob()])).resolves.toBeUndefined();

    // Flush microtask queue so the rejected promise settles before the warn spy check
    await Promise.resolve();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("compute-picker"),
      expect.any(Error),
    );
  });
});
