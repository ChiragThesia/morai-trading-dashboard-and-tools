/**
 * rebuild-journal handler tests — Wave 0 RED stubs.
 *
 * Covers:
 *   - No RTH gate: on-demand job runs anytime
 *   - Valid payload with calendarId → use-case called with calendarId
 *   - Missing calendarId → throws Zod parse error
 *   - Invalid calendarId (not UUID) → throws Zod parse error
 *   - Use-case error → handler throws (signals failure to pg-boss)
 *   - pg-boss v12 guard: undefined job → no-op
 *
 * These tests fail on ASSERTIONS, not import errors.
 * They will go GREEN when plan 05-08 implements makeRebuildJournalHandler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeRebuildJournalHandler } from "./rebuild-journal.ts";

describe("makeRebuildJournalHandler", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function makeJob(data: object = {}): Job<object> {
    return {
      id: "test-rebuild-job",
      name: "rebuild-journal",
      data,
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("valid calendarId payload → use-case called with the calendarId", async () => {
    const calendarId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const rebuildJournalUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeRebuildJournalHandler({
      rebuildJournalUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await handler([makeJob({ calendarId })]);
    expect(rebuildJournalUseCase).toHaveBeenCalledWith(calendarId);
  });

  it("missing calendarId → throws Zod validation error", async () => {
    const rebuildJournalUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeRebuildJournalHandler({
      rebuildJournalUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await expect(handler([makeJob({})])).rejects.toThrow();
    expect(rebuildJournalUseCase).not.toHaveBeenCalled();
  });

  it("invalid calendarId (not UUID) → throws Zod validation error", async () => {
    const rebuildJournalUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeRebuildJournalHandler({
      rebuildJournalUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await expect(handler([makeJob({ calendarId: "not-a-uuid" })])).rejects.toThrow();
    expect(rebuildJournalUseCase).not.toHaveBeenCalled();
  });

  it("use-case returns err → handler throws (signals failure to pg-boss)", async () => {
    const calendarId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const rebuildJournalUseCase = vi.fn().mockResolvedValue(
      err({ kind: "storage-error" as const, message: "delete failed" }),
    );

    const handler = makeRebuildJournalHandler({
      rebuildJournalUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await expect(handler([makeJob({ calendarId })])).rejects.toThrow("delete failed");
  });

  it("when job is undefined: handler no-ops (pg-boss v12 guard)", async () => {
    const rebuildJournalUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeRebuildJournalHandler({
      rebuildJournalUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await handler([undefined]);
    expect(rebuildJournalUseCase).not.toHaveBeenCalled();
  });

  it("runs even outside RTH (on-demand — no RTH gate)", async () => {
    // Saturday, well outside market hours
    const weekend = new Date("2026-06-13T14:00:00Z");
    const calendarId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const rebuildJournalUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeRebuildJournalHandler({
      rebuildJournalUseCase,
      now: () => weekend,
    });

    await handler([makeJob({ calendarId })]);
    // Must have called the use-case even on a weekend — no RTH gate
    expect(rebuildJournalUseCase).toHaveBeenCalledOnce();
  });

  void consoleSpy; // suppress unused warning
});
