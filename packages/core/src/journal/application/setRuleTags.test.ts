import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import type { CalendarEvent } from "../domain/calendar-event.ts";
import type { CalendarEventAnnotation, StorageError } from "./ports.ts";
import { makeSetRuleTagsUseCase } from "./setRuleTags.ts";

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    calendarId: "cal-1",
    eventType: "OPEN",
    eventedAt: new Date("2026-06-01T14:00:00Z"),
    fillIdsHash: "hash-1",
    legOccSymbol: "SPXW260321C07100000",
    rolledFromOccSymbol: null,
    qty: 1,
    avgPrice: 15.0,
    netAmount: 300,
    realizedPnl: null,
    legBreakdown: null,
    entryThesis: null,
    rollOpenDebit: null,
    rollCloseCredit: null,
    ...overrides,
  };
}

function makeSavedAnnotation(overrides: Partial<CalendarEventAnnotation> = {}): CalendarEventAnnotation {
  return {
    fillIdsHash: "hash-1",
    ruleTags: ["iv-skew-favorable"],
    otherNote: null,
    updatedAt: new Date("2026-06-01T15:00:00Z"),
    ...overrides,
  };
}

describe("makeSetRuleTagsUseCase", () => {
  it("upserts when the supplied tags are valid for the event's type (OPEN → enter tags)", async () => {
    const event = makeEvent({ eventType: "OPEN", fillIdsHash: "hash-1" });
    const saved = makeSavedAnnotation({ ruleTags: ["gex-fit"] });
    const readCalendarEvents = vi.fn().mockResolvedValue(ok([event]));
    const writeAnnotations = vi.fn().mockResolvedValue(ok(saved));

    const use = makeSetRuleTagsUseCase({ readCalendarEvents, writeAnnotations });
    const result = await use({
      calendarId: "cal-1",
      fillIdsHash: "hash-1",
      tags: ["gex-fit"],
      otherNote: null,
    });

    expect(result).toEqual(ok(saved));
    expect(writeAnnotations).toHaveBeenCalledWith({
      fillIdsHash: "hash-1",
      ruleTags: ["gex-fit"],
      otherNote: null,
    });
  });

  it("rejects a cross-type tag (CLOSE tag on an OPEN event) without writing", async () => {
    const event = makeEvent({ eventType: "OPEN", fillIdsHash: "hash-1" });
    const readCalendarEvents = vi.fn().mockResolvedValue(ok([event]));
    const writeAnnotations = vi.fn();

    const use = makeSetRuleTagsUseCase({ readCalendarEvents, writeAnnotations });
    const result = await use({
      calendarId: "cal-1",
      fillIdsHash: "hash-1",
      tags: ["profit-target"], // exit-only tag, event is OPEN
      otherNote: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation-error");
    expect(writeAnnotations).not.toHaveBeenCalled();
  });

  it("rejects OTHER without a note, without writing (D-21)", async () => {
    const event = makeEvent({ eventType: "OPEN", fillIdsHash: "hash-1" });
    const readCalendarEvents = vi.fn().mockResolvedValue(ok([event]));
    const writeAnnotations = vi.fn();

    const use = makeSetRuleTagsUseCase({ readCalendarEvents, writeAnnotations });
    const result = await use({
      calendarId: "cal-1",
      fillIdsHash: "hash-1",
      tags: ["other"],
      otherNote: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation-error");
    expect(writeAnnotations).not.toHaveBeenCalled();
  });

  it("rejects OTHER with a whitespace-only note, without writing (D-21)", async () => {
    const event = makeEvent({ eventType: "OPEN", fillIdsHash: "hash-1" });
    const readCalendarEvents = vi.fn().mockResolvedValue(ok([event]));
    const writeAnnotations = vi.fn();

    const use = makeSetRuleTagsUseCase({ readCalendarEvents, writeAnnotations });
    const result = await use({
      calendarId: "cal-1",
      fillIdsHash: "hash-1",
      tags: ["other"],
      otherNote: "   ",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation-error");
    expect(writeAnnotations).not.toHaveBeenCalled();
  });

  it("accepts OTHER with a non-empty note", async () => {
    const event = makeEvent({ eventType: "CLOSE", fillIdsHash: "hash-1" });
    const saved = makeSavedAnnotation({ ruleTags: ["other"], otherNote: "unusual exit" });
    const readCalendarEvents = vi.fn().mockResolvedValue(ok([event]));
    const writeAnnotations = vi.fn().mockResolvedValue(ok(saved));

    const use = makeSetRuleTagsUseCase({ readCalendarEvents, writeAnnotations });
    const result = await use({
      calendarId: "cal-1",
      fillIdsHash: "hash-1",
      tags: ["other"],
      otherNote: "unusual exit",
    });

    expect(result).toEqual(ok(saved));
    expect(writeAnnotations).toHaveBeenCalledWith({
      fillIdsHash: "hash-1",
      ruleTags: ["other"],
      otherNote: "unusual exit",
    });
  });

  it("rejects an unknown fillIdsHash (no matching event) without a blind write", async () => {
    const event = makeEvent({ eventType: "OPEN", fillIdsHash: "hash-1" });
    const readCalendarEvents = vi.fn().mockResolvedValue(ok([event]));
    const writeAnnotations = vi.fn();

    const use = makeSetRuleTagsUseCase({ readCalendarEvents, writeAnnotations });
    const result = await use({
      calendarId: "cal-1",
      fillIdsHash: "hash-unknown",
      tags: ["gex-fit"],
      otherNote: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation-error");
    expect(writeAnnotations).not.toHaveBeenCalled();
  });

  it("propagates StorageError from readCalendarEvents", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "boom" };
    const readCalendarEvents = vi.fn().mockResolvedValue(err(storageError));
    const writeAnnotations = vi.fn();

    const use = makeSetRuleTagsUseCase({ readCalendarEvents, writeAnnotations });
    const result = await use({
      calendarId: "cal-1",
      fillIdsHash: "hash-1",
      tags: ["gex-fit"],
      otherNote: null,
    });

    expect(result).toEqual(err(storageError));
    expect(writeAnnotations).not.toHaveBeenCalled();
  });

  it("propagates StorageError from writeAnnotations", async () => {
    const event = makeEvent({ eventType: "OPEN", fillIdsHash: "hash-1" });
    const storageError: StorageError = { kind: "storage-error", message: "boom" };
    const readCalendarEvents = vi.fn().mockResolvedValue(ok([event]));
    const writeAnnotations = vi.fn().mockResolvedValue(err(storageError));

    const use = makeSetRuleTagsUseCase({ readCalendarEvents, writeAnnotations });
    const result = await use({
      calendarId: "cal-1",
      fillIdsHash: "hash-1",
      tags: ["gex-fit"],
      otherNote: null,
    });

    expect(result).toEqual(err(storageError));
  });
});
