import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeFetchSchwabChainHandler } from "./fetch-schwab-chain.ts";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";

// ─── Test doubles ─────────────────────────────────────────────────────────────

// Helper: creates a pg-boss Job<object> satisfying all required fields (v12)
function makeJob(): Job<object> {
  return {
    id: "test-job-id",
    name: "fetch-schwab-chain",
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

describe("makeFetchSchwabChainHandler", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // ─── Market fresh → uses Schwab chain ───────────────────────────────────────

  it("when market fresh: calls selectChainSource to pick Schwab, calls use-case, enqueues compute", async () => {
    // Monday 2026-06-15 14:00 UTC = 10:00 EDT — inside RTH
    const insideRth = new Date("2026-06-15T14:00:00Z");

    // selectChainSource returns schwabFetchChain (fresh market) — handler calls use-case once
    const fetchChainUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeFetchSchwabChainHandler({
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
    // No warning about AUTH_EXPIRED fallback on happy path
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("AUTH_EXPIRED"),
    );
  });

  // ─── Market AUTH_EXPIRED → falls back to CBOE (logged) ──────────────────────

  it("when market AUTH_EXPIRED: handler logs fallback warning and still calls use-case (CBOE path)", async () => {
    const insideRth = new Date("2026-06-15T14:00:00Z");

    // Simulate AUTH_EXPIRED: use-case is still called (CBOE fallback path via selectChainSource)
    const fetchChainUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    // readTokenFreshness returns market AUTH_EXPIRED
    const readTokenFreshnessFn = vi.fn().mockResolvedValue(
      ok({
        trader: { status: "fresh", expiresAt: new Date(), refreshIssuedAt: new Date(), refreshExpiresIn: null },
        market: { status: "AUTH_EXPIRED", expiresAt: null, refreshIssuedAt: null, refreshExpiresIn: null },
      }),
    );

    const handler = makeFetchSchwabChainHandler({
      fetchChainUseCase,
      boss,
      now: () => insideRth,
      readTokenFreshness: readTokenFreshnessFn,
      logAuthExpiredFallback: true,
    });

    await handler([makeJob()]);

    // Use-case still called (CBOE fallback; journal keeps running — D-09)
    expect(fetchChainUseCase).toHaveBeenCalledOnce();
    // Warning logged naming market + reason (T-04-26)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("AUTH_EXPIRED"),
    );
    // compute-bsm-greeks still enqueued on success
    expect(boss.send).toHaveBeenCalledWith(
      "compute-bsm-greeks",
      {},
      expect.objectContaining({ singletonKey: expect.any(String) }),
    );
  });

  // ─── Outside RTH → no-op ─────────────────────────────────────────────────────

  it("when outside RTH: use-case NOT called and console.warn logged", async () => {
    // Saturday 2026-06-13 14:00 UTC — outside RTH (weekend)
    const outsideRth = new Date("2026-06-13T14:00:00Z");

    const fetchChainUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeFetchSchwabChainHandler({
      fetchChainUseCase,
      boss,
      now: () => outsideRth,
    });

    await handler([makeJob()]);

    expect(fetchChainUseCase).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("outside RTH"),
    );
  });

  // ─── NYSE holiday → no-op ────────────────────────────────────────────────────

  it("when NYSE holiday: use-case NOT called and console.warn logged (CAL-05)", async () => {
    // 2026-01-01T14:00:00Z = 09:00 EST — New Year's Day
    const holidayInstant = new Date("2026-01-01T14:00:00Z");

    const fetchChainUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss = makeBossStub();

    const handler = makeFetchSchwabChainHandler({
      fetchChainUseCase,
      boss,
      now: () => holidayInstant,
    });

    await handler([makeJob()]);

    expect(fetchChainUseCase).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("outside RTH or NYSE holiday"),
    );
  });

  // ─── Use-case error → handler throws ─────────────────────────────────────────

  it("when use-case err: handler throws (pg-boss marks job failed)", async () => {
    const insideRth = new Date("2026-06-15T14:00:00Z");

    const fetchChainUseCase = vi.fn().mockResolvedValue(
      err({ kind: "fetch-error" as const, message: "Schwab or CBOE timeout" }),
    );
    const boss = makeBossStub();

    const handler = makeFetchSchwabChainHandler({
      fetchChainUseCase,
      boss,
      now: () => insideRth,
    });

    await expect(handler([makeJob()])).rejects.toThrow("Schwab or CBOE timeout");
    expect(boss.send).not.toHaveBeenCalled();
  });

  // ─── Array guard (Pitfall 2) ─────────────────────────────────────────────────

  it("array guard: undefined job returns immediately without calling use-case", async () => {
    const insideRth = new Date("2026-06-15T14:00:00Z");
    const fetchChainUseCase = vi.fn();
    const boss = makeBossStub();

    const handler = makeFetchSchwabChainHandler({
      fetchChainUseCase,
      boss,
      now: () => insideRth,
    });

    await handler([undefined]);

    expect(fetchChainUseCase).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
  });

  // ─── boss.send failure → handler resolves + console.warn (WR-02) ─────────────

  it("when use-case ok + boss.send rejects: handler resolves and console.warn called (WR-02)", async () => {
    const insideRth = new Date("2026-06-15T14:00:00Z");

    const fetchChainUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const boss: BossForChainHandler & { send: ReturnType<typeof vi.fn> } = {
      send: vi.fn().mockRejectedValue(new Error("queue missing")),
    };

    const handler = makeFetchSchwabChainHandler({
      fetchChainUseCase,
      boss,
      now: () => insideRth,
    });

    await expect(handler([makeJob()])).resolves.toBeUndefined();

    // Flush microtasks so the rejected promise settles
    await Promise.resolve();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("compute-bsm-greeks"),
      expect.any(Error),
    );
  });
});
