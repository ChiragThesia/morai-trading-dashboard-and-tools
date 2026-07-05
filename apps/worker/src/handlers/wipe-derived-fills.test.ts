/**
 * wipe-derived-fills handler tests (journal-pnl-opennetdebit-units round 3: account-wide
 * fills-side-correction follow-up).
 *
 * Mirrors recompute-snapshot-pnl.test.ts / rebuild-journal.test.ts — on-demand job, no RTH
 * gate, use-case error → handler throws. Unlike those two, this job is account-wide: no
 * calendarId payload field (occSymbols are shared across calendars — there is no clean
 * per-calendar fill scope, mirrors sync-fills' full-sweep `{}` payload).
 */

import { describe, it, expect, vi } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeWipeDerivedFillsHandler } from "./wipe-derived-fills.ts";

describe("makeWipeDerivedFillsHandler", () => {
  function makeJob(data: object = {}): Job<object> {
    return {
      id: "test-wipe-derived-fills-job",
      name: "wipe-derived-fills",
      data,
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("empty payload → use-case called with no arguments (account-wide)", async () => {
    const wipeDerivedFillsUseCase = vi
      .fn()
      .mockResolvedValue(ok({ fillsDeleted: 3, eventsDeleted: 2, orphansDeleted: 1 }));

    const handler = makeWipeDerivedFillsHandler({
      wipeDerivedFillsUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await handler([makeJob({})]);
    expect(wipeDerivedFillsUseCase).toHaveBeenCalledWith();
  });

  it("payload with extraneous fields still passes (account-wide job requires no fields)", async () => {
    const wipeDerivedFillsUseCase = vi
      .fn()
      .mockResolvedValue(ok({ fillsDeleted: 0, eventsDeleted: 0, orphansDeleted: 0 }));

    const handler = makeWipeDerivedFillsHandler({
      wipeDerivedFillsUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await handler([makeJob({ unexpected: "field" })]);
    expect(wipeDerivedFillsUseCase).toHaveBeenCalledOnce();
  });

  it("use-case returns err (storage) → handler throws (signals failure to pg-boss)", async () => {
    const wipeDerivedFillsUseCase = vi
      .fn()
      .mockResolvedValue(err({ kind: "storage-error" as const, message: "delete failed" }));

    const handler = makeWipeDerivedFillsHandler({
      wipeDerivedFillsUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await expect(handler([makeJob({})])).rejects.toThrow("delete failed");
  });

  it("when job is undefined: handler no-ops (pg-boss v12 guard)", async () => {
    const wipeDerivedFillsUseCase = vi
      .fn()
      .mockResolvedValue(ok({ fillsDeleted: 0, eventsDeleted: 0, orphansDeleted: 0 }));

    const handler = makeWipeDerivedFillsHandler({
      wipeDerivedFillsUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await handler([undefined]);
    expect(wipeDerivedFillsUseCase).not.toHaveBeenCalled();
  });

  it("runs even outside RTH (on-demand — no RTH gate)", async () => {
    const weekend = new Date("2026-06-13T14:00:00Z");
    const wipeDerivedFillsUseCase = vi
      .fn()
      .mockResolvedValue(ok({ fillsDeleted: 0, eventsDeleted: 0, orphansDeleted: 0 }));

    const handler = makeWipeDerivedFillsHandler({
      wipeDerivedFillsUseCase,
      now: () => weekend,
    });

    await handler([makeJob({})]);
    expect(wipeDerivedFillsUseCase).toHaveBeenCalledOnce();
  });
});
