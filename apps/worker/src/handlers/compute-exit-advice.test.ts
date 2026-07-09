/**
 * compute-exit-advice handler tests (Phase 26, Plan 04 — EXIT-01/EXIT-09/EXIT-10).
 *
 * Covers:
 *   - Use-case ok -> no throw
 *   - Use-case err -> handler throws (pg-boss marks job failed)
 *   - pg-boss v12 undefined array element -> no-op (array-guard, T-02-18)
 *   - Terminal: this handler never enqueues anything further
 */

import { describe, it, expect, vi } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeComputeExitAdviceHandler } from "./compute-exit-advice.ts";
import type { ForRunningComputeExitAdvice } from "@morai/core";

describe("makeComputeExitAdviceHandler", () => {
  function makeJob(): Job<object> {
    return {
      id: "test-job-id",
      name: "compute-exit-advice",
      data: {},
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("runs the use-case and does not throw on ok", async () => {
    const computeExitAdviceUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeComputeExitAdviceHandler({ computeExitAdviceUseCase });

    await handler([makeJob()]);

    expect(computeExitAdviceUseCase).toHaveBeenCalledOnce();
  });

  it("when use-case err: handler throws Error (pg-boss marks job failed)", async () => {
    const computeExitAdviceUseCase: ForRunningComputeExitAdvice = async () =>
      err({ kind: "storage-error", message: "DB write failed" });

    const handler = makeComputeExitAdviceHandler({ computeExitAdviceUseCase });

    await expect(handler([makeJob()])).rejects.toThrow("DB write failed");
  });

  it("when job array element is undefined: handler no-ops (pg-boss v12 array-guard, T-02-18)", async () => {
    const computeExitAdviceUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeComputeExitAdviceHandler({ computeExitAdviceUseCase });

    await handler([undefined]);

    expect(computeExitAdviceUseCase).not.toHaveBeenCalled();
  });
});
