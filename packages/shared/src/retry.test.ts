/**
 * retryWithBackoff tests.
 *
 * Regression cover for the 2026-07-23 outage: Supabase was unreachable for 81 minutes
 * and both services died on unguarded boot I/O (`await runMigrations(...)`,
 * `await boss.start()`). Boot steps that merely cannot succeed *yet* must be retried,
 * not treated as fatal on the first throw.
 *
 * `sleep` is injected so these run instantly and assert the exact delay schedule —
 * no fake timers, no wall-clock flake.
 */

import { describe, it, expect, vi } from "vitest";
import { retryWithBackoff } from "./retry.ts";

/** Records the delays asked for instead of waiting them out. */
function makeSleepSpy(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

describe("retryWithBackoff", () => {
  it("returns the value and never sleeps when the first attempt succeeds", async () => {
    const { sleep, delays } = makeSleepSpy();
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, { attempts: 5, baseDelayMs: 1000, sleep });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
    expect(delays).toEqual([]);
  });

  it("retries a throwing thunk and returns once it recovers", async () => {
    const { sleep } = makeSleepSpy();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue("connected");

    const result = await retryWithBackoff(fn, { attempts: 5, baseDelayMs: 1000, sleep });

    expect(result).toBe("connected");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("backs off exponentially and clamps at maxDelayMs", async () => {
    const { sleep, delays } = makeSleepSpy();
    const fn = vi.fn().mockRejectedValue(new Error("down"));

    await expect(
      retryWithBackoff(fn, {
        attempts: 6,
        baseDelayMs: 1000,
        maxDelayMs: 4000,
        sleep,
      }),
    ).rejects.toThrow("down");

    // 5 sleeps for 6 attempts — no sleep after the final failure.
    expect(delays).toEqual([1000, 2000, 4000, 4000, 4000]);
  });

  it("rethrows the LAST error, not the first (the final cause is what an operator needs)", async () => {
    const { sleep } = makeSleepSpy();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValue(new Error("final failure"));

    await expect(
      retryWithBackoff(fn, { attempts: 3, baseDelayMs: 10, sleep }),
    ).rejects.toThrow("final failure");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calls onRetry once per failed attempt with the attempt number and the error", async () => {
    const { sleep } = makeSleepSpy();
    const seen: Array<{ attempt: number; message: string }> = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom-1"))
      .mockRejectedValueOnce(new Error("boom-2"))
      .mockResolvedValue("ok");

    await retryWithBackoff(fn, {
      attempts: 5,
      baseDelayMs: 10,
      sleep,
      onRetry: (attempt, error) => {
        seen.push({ attempt, message: error instanceof Error ? error.message : String(error) });
      },
    });

    // Only the failures notify — the successful third attempt does not.
    expect(seen).toEqual([
      { attempt: 1, message: "boom-1" },
      { attempt: 2, message: "boom-2" },
    ]);
  });

  it("does not swallow a non-Error throw", async () => {
    const { sleep } = makeSleepSpy();
    const fn = vi.fn().mockRejectedValue("plain string failure");

    await expect(
      retryWithBackoff(fn, { attempts: 2, baseDelayMs: 10, sleep }),
    ).rejects.toBe("plain string failure");
  });

  it("attempts exactly once when attempts is 1 (retry disabled)", async () => {
    const { sleep, delays } = makeSleepSpy();
    const fn = vi.fn().mockRejectedValue(new Error("down"));

    await expect(
      retryWithBackoff(fn, { attempts: 1, baseDelayMs: 10, sleep }),
    ).rejects.toThrow("down");

    expect(fn).toHaveBeenCalledOnce();
    expect(delays).toEqual([]);
  });
});
