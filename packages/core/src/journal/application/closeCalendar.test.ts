import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import type { Calendar, StorageError } from "./ports.ts";
import { makeCloseCalendarUseCase } from "./closeCalendar.ts";

const closedCalendar: Calendar = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  underlying: "SPX",
  strike: 7100000,
  optionType: "C",
  frontExpiry: "2026-02-21",
  backExpiry: "2026-03-21",
  qty: 1,
  openNetDebit: 5.5,
  status: "closed",
  openedAt: new Date("2026-01-02T14:30:00Z"),
  closedAt: new Date("2026-03-01T14:30:00Z"),
  notes: null,
};

describe("makeCloseCalendarUseCase", () => {
  it("returns not-found when id is unknown", async () => {
    const closeCalendar = vi
      .fn()
      .mockResolvedValue(err({ kind: "not-found" as const }));
    const use = makeCloseCalendarUseCase({ closeCalendar });
    const result = await use("unknown-id", 3.25);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not-found");
    }
  });

  it("returns already-closed when calendar is already closed", async () => {
    const closeCalendar = vi
      .fn()
      .mockResolvedValue(err({ kind: "already-closed" as const }));
    const use = makeCloseCalendarUseCase({ closeCalendar });
    const result = await use("aaaaaaaa-0000-0000-0000-000000000001", 3.25);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("already-closed");
    }
  });

  it("returns ok(calendar) with status closed on success", async () => {
    const closeCalendar = vi.fn().mockResolvedValue(ok(closedCalendar));
    const use = makeCloseCalendarUseCase({ closeCalendar });
    const result = await use("aaaaaaaa-0000-0000-0000-000000000001", 3.25);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("closed");
    }
  });

  it("forwards id and closeNetCredit to the port", async () => {
    const closeCalendar = vi.fn().mockResolvedValue(ok(closedCalendar));
    const use = makeCloseCalendarUseCase({ closeCalendar });
    await use("aaaaaaaa-0000-0000-0000-000000000001", 3.25);
    expect(closeCalendar).toHaveBeenCalledWith(
      "aaaaaaaa-0000-0000-0000-000000000001",
      3.25,
    );
  });

  it("returns storage-error on DB failure", async () => {
    const storageErr: StorageError = {
      kind: "storage-error",
      message: "DB error",
    };
    const closeCalendar = vi.fn().mockResolvedValue(err(storageErr));
    const use = makeCloseCalendarUseCase({ closeCalendar });
    const result = await use("some-id", 3.25);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("storage-error");
    }
  });
});
