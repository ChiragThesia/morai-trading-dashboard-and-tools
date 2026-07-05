import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import type { CalendarEvent } from "../domain/calendar-event.ts";
import type { CalendarEventAnnotation, StorageError } from "./ports.ts";
import { makeGetCalendarEventsWithRulesUseCase } from "./getCalendarEventsWithRules.ts";

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

function makeAnnotation(overrides: Partial<CalendarEventAnnotation> = {}): CalendarEventAnnotation {
  return {
    fillIdsHash: "hash-1",
    ruleTags: ["iv-skew-favorable"],
    otherNote: null,
    updatedAt: new Date("2026-06-01T15:00:00Z"),
    ...overrides,
  };
}

describe("makeGetCalendarEventsWithRulesUseCase", () => {
  it("returns an event's tags/otherNote when an annotation matches its fillIdsHash", async () => {
    const event = makeEvent({ fillIdsHash: "hash-1" });
    const annotation = makeAnnotation({ fillIdsHash: "hash-1", ruleTags: ["gex-fit"], otherNote: "solid setup" });
    const readCalendarEvents = vi.fn().mockResolvedValue(ok([event]));
    const readAnnotationsByHashes = vi.fn().mockResolvedValue(ok([annotation]));
    const readAnnotation = vi.fn();

    const use = makeGetCalendarEventsWithRulesUseCase({
      readCalendarEvents,
      readAnnotations: { readAnnotation, readAnnotationsByHashes },
    });

    const result = await use("cal-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { event, tags: ["gex-fit"], otherNote: "solid setup" },
      ]);
    }
    expect(readAnnotationsByHashes).toHaveBeenCalledWith(["hash-1"]);
  });

  it("returns empty tags and null otherNote for an unannotated event", async () => {
    const event = makeEvent({ fillIdsHash: "hash-2" });
    const readCalendarEvents = vi.fn().mockResolvedValue(ok([event]));
    const readAnnotationsByHashes = vi.fn().mockResolvedValue(ok([]));

    const use = makeGetCalendarEventsWithRulesUseCase({
      readCalendarEvents,
      readAnnotations: { readAnnotation: vi.fn(), readAnnotationsByHashes },
    });

    const result = await use("cal-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ event, tags: [], otherNote: null }]);
    }
  });

  it("logs and omits an annotation whose fillIdsHash matches no current event (D-09 orphan policy)", async () => {
    const event = makeEvent({ fillIdsHash: "hash-1" });
    const liveAnnotation = makeAnnotation({ fillIdsHash: "hash-1", ruleTags: ["gex-fit"] });
    // The orphan's hash ("hash-stale") is NOT among the events' hashes — a defensive-double
    // scenario (the port contract doesn't guarantee the adapter filters strictly, D-09).
    const orphanAnnotation = makeAnnotation({ fillIdsHash: "hash-stale", ruleTags: ["profit-target"] });
    const readCalendarEvents = vi.fn().mockResolvedValue(ok([event]));
    const readAnnotationsByHashes = vi.fn().mockResolvedValue(ok([liveAnnotation, orphanAnnotation]));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const use = makeGetCalendarEventsWithRulesUseCase({
      readCalendarEvents,
      readAnnotations: { readAnnotation: vi.fn(), readAnnotationsByHashes },
    });

    const result = await use("cal-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ event, tags: ["gex-fit"], otherNote: null }]);
    }
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("hash-stale");
    warnSpy.mockRestore();
  });

  it("propagates StorageError from readCalendarEvents", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "boom" };
    const readCalendarEvents = vi.fn().mockResolvedValue(err(storageError));
    const readAnnotationsByHashes = vi.fn();

    const use = makeGetCalendarEventsWithRulesUseCase({
      readCalendarEvents,
      readAnnotations: { readAnnotation: vi.fn(), readAnnotationsByHashes },
    });

    const result = await use("cal-1");
    expect(result).toEqual(err(storageError));
    expect(readAnnotationsByHashes).not.toHaveBeenCalled();
  });

  it("propagates StorageError from readAnnotationsByHashes", async () => {
    const event = makeEvent({ fillIdsHash: "hash-1" });
    const storageError: StorageError = { kind: "storage-error", message: "boom" };
    const readCalendarEvents = vi.fn().mockResolvedValue(ok([event]));
    const readAnnotationsByHashes = vi.fn().mockResolvedValue(err(storageError));

    const use = makeGetCalendarEventsWithRulesUseCase({
      readCalendarEvents,
      readAnnotations: { readAnnotation: vi.fn(), readAnnotationsByHashes },
    });

    const result = await use("cal-1");
    expect(result).toEqual(err(storageError));
  });

  it("returns an empty array and skips the annotations read when the calendar has zero events", async () => {
    const readCalendarEvents = vi.fn().mockResolvedValue(ok([]));
    const readAnnotationsByHashes = vi.fn().mockResolvedValue(ok([]));

    const use = makeGetCalendarEventsWithRulesUseCase({
      readCalendarEvents,
      readAnnotations: { readAnnotation: vi.fn(), readAnnotationsByHashes },
    });

    const result = await use("cal-1");
    expect(result).toEqual(ok([]));
    expect(readAnnotationsByHashes).toHaveBeenCalledWith([]);
  });
});
