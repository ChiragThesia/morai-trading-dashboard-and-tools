/**
 * register-open-calendars handler tests (JRNL-02).
 *
 * Mirrors wipe-derived-fills.test.ts — on-demand job, no RTH gate, use-case error → handler
 * throws. Account-wide payload (no calendarId): operates over the whole open position book.
 */

import { describe, it, expect, vi } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeRegisterOpenCalendarsHandler } from "./register-open-calendars.ts";

describe("makeRegisterOpenCalendarsHandler", () => {
  function makeJob(data: object = {}): Job<object> {
    return {
      id: "test-register-open-calendars-job",
      name: "register-open-calendars",
      data,
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("empty payload → use-case called with no arguments (account-wide)", async () => {
    const registerOpenCalendarsUseCase = vi
      .fn()
      .mockResolvedValue(ok({ registered: [], skippedExisting: [] }));

    const handler = makeRegisterOpenCalendarsHandler({
      registerOpenCalendarsUseCase,
      now: () => new Date("2026-08-15T14:00:00Z"),
    });

    await handler([makeJob({})]);
    expect(registerOpenCalendarsUseCase).toHaveBeenCalledWith();
  });

  it("payload with extraneous fields still passes (account-wide job requires no fields)", async () => {
    const registerOpenCalendarsUseCase = vi
      .fn()
      .mockResolvedValue(ok({ registered: [], skippedExisting: [] }));

    const handler = makeRegisterOpenCalendarsHandler({
      registerOpenCalendarsUseCase,
      now: () => new Date("2026-08-15T14:00:00Z"),
    });

    await handler([makeJob({ unexpected: "field" })]);
    expect(registerOpenCalendarsUseCase).toHaveBeenCalledOnce();
  });

  it("use-case returns err (storage) → handler throws (signals failure to pg-boss)", async () => {
    const registerOpenCalendarsUseCase = vi
      .fn()
      .mockResolvedValue(err({ kind: "storage-error" as const, message: "list failed" }));

    const handler = makeRegisterOpenCalendarsHandler({
      registerOpenCalendarsUseCase,
      now: () => new Date("2026-08-15T14:00:00Z"),
    });

    await expect(handler([makeJob({})])).rejects.toThrow("list failed");
  });

  it("use-case returns err (fetch-error) → handler throws", async () => {
    const registerOpenCalendarsUseCase = vi
      .fn()
      .mockResolvedValue(err({ kind: "fetch-error" as const, message: "auth expired" }));

    const handler = makeRegisterOpenCalendarsHandler({
      registerOpenCalendarsUseCase,
      now: () => new Date("2026-08-15T14:00:00Z"),
    });

    await expect(handler([makeJob({})])).rejects.toThrow("auth expired");
  });

  it("when job is undefined: handler no-ops (pg-boss v12 guard)", async () => {
    const registerOpenCalendarsUseCase = vi
      .fn()
      .mockResolvedValue(ok({ registered: [], skippedExisting: [] }));

    const handler = makeRegisterOpenCalendarsHandler({
      registerOpenCalendarsUseCase,
      now: () => new Date("2026-08-15T14:00:00Z"),
    });

    await handler([undefined]);
    expect(registerOpenCalendarsUseCase).not.toHaveBeenCalled();
  });

  it("runs even outside RTH (on-demand — no RTH gate)", async () => {
    const weekend = new Date("2026-08-16T14:00:00Z");
    const registerOpenCalendarsUseCase = vi
      .fn()
      .mockResolvedValue(ok({ registered: [], skippedExisting: [] }));

    const handler = makeRegisterOpenCalendarsHandler({
      registerOpenCalendarsUseCase,
      now: () => weekend,
    });

    await handler([makeJob({})]);
    expect(registerOpenCalendarsUseCase).toHaveBeenCalledOnce();
  });
});
