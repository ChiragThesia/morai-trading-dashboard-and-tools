/**
 * compute-bsm-greeks handler tests — RED phase.
 *
 * Covers:
 *   - Holiday: use-case NOT called, boss.send NOT called (Blocker 3 / CAL-05)
 *   - Outside RTH: use-case NOT called, boss.send NOT called
 *   - Normal RTH + success: use-case IS called AND boss.send fired for snapshot-calendars
 *   - Normal RTH + use-case err: handler throws, boss.send NOT called
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeComputeBsmGreeksHandler } from "./compute-bsm-greeks.ts";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";

describe("makeComputeBsmGreeksHandler", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function makeJob(): Job<object> {
    return {
      id: "test-job-id",
      name: "compute-bsm-greeks",
      data: {},
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  function makeBossStub(): BossForChainHandler & {
    send: ReturnType<typeof vi.fn>;
  } {
    return { send: vi.fn().mockResolvedValue("singleton-key") };
  }

  it("when inside RTH on a normal weekday + success: use-case called AND boss.send fired for snapshot-calendars", async () => {
    // Monday 2026-06-15 14:00 UTC = 10:00 EDT — inside RTH
    const computeBsmGreeksUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeComputeBsmGreeksHandler({
      computeBsmGreeksUseCase,
      boss,
    });

    await handler([makeJob()]);

    expect(computeBsmGreeksUseCase).toHaveBeenCalledOnce();
    // D-03: enqueue snapshot-calendars with singletonKey on success
    // Note: boss.send is fire-and-forget (void), so we wait a tick for the promise
    await Promise.resolve();
    expect(boss.send).toHaveBeenCalledWith(
      "snapshot-calendars",
      {},
      expect.objectContaining({ singletonKey: "triggered-by-compute" }),
    );
  });

  it("when use-case err: handler throws and boss.send NOT called", async () => {
    const computeBsmGreeksUseCase = vi.fn().mockResolvedValue(
      err({ kind: "storage-error", message: "BSM compute failed" }),
    );
    const boss = makeBossStub();

    const handler = makeComputeBsmGreeksHandler({
      computeBsmGreeksUseCase,
      boss,
    });

    await expect(handler([makeJob()])).rejects.toThrow("BSM compute failed");
    // boss.send must NOT be called when compute fails
    await Promise.resolve();
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("when job is undefined: handler no-ops (pg-boss v12 guard)", async () => {
    const computeBsmGreeksUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeComputeBsmGreeksHandler({
      computeBsmGreeksUseCase,
      boss,
    });

    await handler([undefined]);
    expect(computeBsmGreeksUseCase).not.toHaveBeenCalled();
  });
});
