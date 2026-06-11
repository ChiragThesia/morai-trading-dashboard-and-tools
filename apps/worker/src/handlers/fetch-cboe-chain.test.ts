import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeFetchCboeChainHandler } from "./fetch-cboe-chain.ts";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";

describe("makeFetchCboeChainHandler", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // Helper: creates a pg-boss Job<object> satisfying all required fields (v12)
  function makeJob(): Job<object> {
    return {
      id: "test-job-id",
      name: "fetch-cboe-chain",
      data: {},
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  // Helper: creates a typed boss stub satisfying BossForChainHandler
  function makeBossStub(): BossForChainHandler & {
    send: ReturnType<typeof vi.fn>;
  } {
    return { send: vi.fn().mockResolvedValue("singleton-key") };
  }

  it("when outside RTH: use-case NOT called and console.warn was called", async () => {
    // Saturday 2026-06-13 14:00 UTC = 10:00 EDT — outside RTH (weekend)
    const outsideRth = new Date("2026-06-13T14:00:00Z");

    const fetchChainUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeFetchCboeChainHandler({
      fetchChainUseCase,
      boss,
      now: () => outsideRth,
    });

    await handler([makeJob()]);

    expect(fetchChainUseCase).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledOnce();
  });

  it("when inside RTH + use-case ok: use-case called once and boss.send invoked with singletonKey", async () => {
    // Monday 2026-06-15 14:00 UTC = 10:00 EDT — inside RTH
    const insideRth = new Date("2026-06-15T14:00:00Z");

    const fetchChainUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeFetchCboeChainHandler({
      fetchChainUseCase,
      boss,
      now: () => insideRth,
    });

    await handler([makeJob()]);

    expect(fetchChainUseCase).toHaveBeenCalledOnce();
    expect(boss.send).toHaveBeenCalledWith(
      "compute-bsm-greeks",
      {},
      expect.objectContaining({ singletonKey: expect.any(String) }),
    );
  });

  it("when inside RTH + use-case err: handler throws (pg-boss marks job failed)", async () => {
    const insideRth = new Date("2026-06-15T14:00:00Z");

    const fetchChainUseCase = vi.fn().mockResolvedValue(
      err({ kind: "fetch-error" as const, message: "CBOE timeout" }),
    );
    const boss = makeBossStub();

    const handler = makeFetchCboeChainHandler({
      fetchChainUseCase,
      boss,
      now: () => insideRth,
    });

    await expect(handler([makeJob()])).rejects.toThrow("CBOE timeout");
    // boss.send NOT called on error path
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("when inside RTH + use-case ok + boss.send rejects: handler resolves and console.warn is called for failed enqueue (WR-02)", async () => {
    // Monday 2026-06-15 14:00 UTC = 10:00 EDT — inside RTH
    const insideRth = new Date("2026-06-15T14:00:00Z");

    const fetchChainUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss: BossForChainHandler & { send: ReturnType<typeof vi.fn> } = {
      send: vi.fn().mockRejectedValue(new Error("queue missing")),
    };

    const handler = makeFetchCboeChainHandler({
      fetchChainUseCase,
      boss,
      now: () => insideRth,
    });

    // Handler must resolve — a failed enqueue must not propagate
    await expect(handler([makeJob()])).resolves.toBeUndefined();

    // Flush microtask queue so the rejected promise settles before the warn spy check
    await Promise.resolve();

    // The failed enqueue must be logged via console.warn
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("compute-bsm-greeks"),
      expect.any(Error),
    );
  });

  it("array guard: undefined job returns immediately without calling use-case", async () => {
    const insideRth = new Date("2026-06-15T14:00:00Z");
    const fetchChainUseCase = vi.fn();
    const boss = makeBossStub();

    const handler = makeFetchCboeChainHandler({
      fetchChainUseCase,
      boss,
      now: () => insideRth,
    });

    // Pitfall 2: pg-boss v12 can pass undefined as array element
    await handler([undefined]);

    expect(fetchChainUseCase).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
  });
});
