import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import type { Calendar, StorageError } from "./ports.ts";
import { makeRegisterCalendarUseCase } from "./registerCalendar.ts";

const baseInput = {
  underlying: "SPX",
  strike: 7100000,
  optionType: "C" as const,
  frontExpiry: "2026-02-21",
  backExpiry: "2026-03-21",
  qty: 1,
  openNetDebit: 5.5,
};

const fakeCalendar: Calendar = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  underlying: "SPX",
  strike: 7100000,
  optionType: "C",
  frontExpiry: "2026-02-21",
  backExpiry: "2026-03-21",
  qty: 1,
  openNetDebit: 5.5,
  status: "open",
  openedAt: new Date("2026-01-02T14:30:00Z"),
  closedAt: null,
  notes: null,
};

describe("makeRegisterCalendarUseCase", () => {
  it("returns validation-error when backExpiry <= frontExpiry (equal)", async () => {
    const persistCalendar = vi.fn();
    const use = makeRegisterCalendarUseCase({
      persistCalendar,
      now: () => new Date("2026-01-02T14:30:00Z"),
    });
    const result = await use({
      ...baseInput,
      frontExpiry: "2026-03-21",
      backExpiry: "2026-03-21",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation-error");
    }
    expect(persistCalendar).not.toHaveBeenCalled();
  });

  it("returns validation-error when backExpiry < frontExpiry", async () => {
    const persistCalendar = vi.fn();
    const use = makeRegisterCalendarUseCase({
      persistCalendar,
      now: () => new Date("2026-01-02T14:30:00Z"),
    });
    const result = await use({
      ...baseInput,
      frontExpiry: "2026-04-21",
      backExpiry: "2026-03-21",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation-error");
      expect(result.error.message).toContain("backExpiry");
    }
  });

  it("uses deps.now() as openedAt when openedAt is omitted", async () => {
    const fixedNow = new Date("2026-01-02T14:30:00Z");
    const persistCalendar = vi.fn().mockResolvedValue(ok(fakeCalendar));
    const use = makeRegisterCalendarUseCase({
      persistCalendar,
      now: () => fixedNow,
    });
    await use(baseInput);
    expect(persistCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ openedAt: fixedNow }),
    );
  });

  it("passes explicit openedAt through when provided", async () => {
    const explicitDate = new Date("2026-01-05T10:00:00Z");
    const persistCalendar = vi.fn().mockResolvedValue(ok(fakeCalendar));
    const use = makeRegisterCalendarUseCase({
      persistCalendar,
      now: () => new Date("2026-01-02T14:30:00Z"),
    });
    await use({ ...baseInput, openedAt: explicitDate });
    expect(persistCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ openedAt: explicitDate }),
    );
  });

  it("returns ok(calendar) on success (pass-through)", async () => {
    const persistCalendar = vi.fn().mockResolvedValue(ok(fakeCalendar));
    const use = makeRegisterCalendarUseCase({
      persistCalendar,
      now: () => new Date("2026-01-02T14:30:00Z"),
    });
    const result = await use(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(fakeCalendar);
    }
  });

  it("returns storage-error when persistCalendar fails", async () => {
    const storageErr: StorageError = {
      kind: "storage-error",
      message: "DB error",
    };
    const persistCalendar = vi.fn().mockResolvedValue(err(storageErr));
    const use = makeRegisterCalendarUseCase({
      persistCalendar,
      now: () => new Date("2026-01-02T14:30:00Z"),
    });
    const result = await use(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("storage-error");
    }
  });
});
