import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type {
  ForGettingCalendarById,
  ForRunningGetCalendarEventsWithRules,
  ForRunningSetRuleTags,
  Calendar,
  CalendarEvent,
  CalendarEventWithRules,
  CalendarEventAnnotation,
  StorageError,
  ValidationError,
  CalendarNotFound,
} from "@morai/core";
import { journalRulesRoutes } from "./journal-rules.routes.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CALENDAR_ID = "550e8400-e29b-41d4-a716-446655440001";
const HASH = "a".repeat(64);

const openCalendar: Calendar = {
  id: CALENDAR_ID,
  underlying: "SPX",
  strike: 7100000,
  optionType: "C",
  frontExpiry: "2026-02-21",
  backExpiry: "2026-03-21",
  qty: 1,
  openNetDebit: 5.5,
  status: "open",
  openedAt: new Date("2026-01-02T14:30:00.000Z"),
  closedAt: null,
  notes: null,
};

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    calendarId: CALENDAR_ID,
    eventType: "OPEN",
    eventedAt: new Date("2026-06-01T14:00:00Z"),
    fillIdsHash: HASH,
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
    fillIdsHash: HASH,
    ruleTags: ["gex-fit"],
    otherNote: null,
    updatedAt: new Date("2026-06-01T15:00:00Z"),
    ...overrides,
  };
}

// ─── Test app builder ──────────────────────────────────────────────────────────

function buildTestApp(
  getCalendarById: ForGettingCalendarById,
  getEventsWithRules: ForRunningGetCalendarEventsWithRules,
  setRuleTags: ForRunningSetRuleTags,
) {
  const app = new Hono();
  app.route("/api", journalRulesRoutes(getCalendarById, getEventsWithRules, setRuleTags));
  return app;
}

const okGetCalendarById: ForGettingCalendarById = async () => ok(openCalendar);
const notFoundGetCalendarById: ForGettingCalendarById = async () => ok(null);

describe("GET /api/journal/:calendarId/rules", () => {
  it("returns 200 with the combined events+rules payload for a known calendar", async () => {
    const eventsWithRules: ReadonlyArray<CalendarEventWithRules> = [
      { event: makeEvent(), tags: ["gex-fit"], otherNote: null },
    ];
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () => ok(eventsWithRules);
    const setRuleTags: ForRunningSetRuleTags = async () => ok(makeAnnotation());
    const app = buildTestApp(okGetCalendarById, getEventsWithRules, setRuleTags);

    const res = await app.request(`/api/journal/${CALENDAR_ID}/rules`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { events: ReadonlyArray<Record<string, unknown>> };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      fillIdsHash: HASH,
      eventType: "OPEN",
      tags: ["gex-fit"],
      otherNote: null,
    });
  });

  it("returns 200 with an empty events array for a known calendar with no events", async () => {
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () => ok([]);
    const setRuleTags: ForRunningSetRuleTags = async () => ok(makeAnnotation());
    const app = buildTestApp(okGetCalendarById, getEventsWithRules, setRuleTags);

    const res = await app.request(`/api/journal/${CALENDAR_ID}/rules`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: ReadonlyArray<unknown> };
    expect(body.events).toHaveLength(0);
  });

  it("returns 404 when the calendar is unknown", async () => {
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () => ok([]);
    const setRuleTags: ForRunningSetRuleTags = async () => ok(makeAnnotation());
    const app = buildTestApp(notFoundGetCalendarById, getEventsWithRules, setRuleTags);

    const res = await app.request(`/api/journal/${CALENDAR_ID}/rules`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body).toMatchObject({ error: "not found" });
  });

  it("returns 500 when the calendar-existence check errors", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "DB down" };
    const getCalendarById: ForGettingCalendarById = async () => err(storageError);
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () => ok([]);
    const setRuleTags: ForRunningSetRuleTags = async () => ok(makeAnnotation());
    const app = buildTestApp(getCalendarById, getEventsWithRules, setRuleTags);

    const res = await app.request(`/api/journal/${CALENDAR_ID}/rules`);
    expect(res.status).toBe(500);
  });

  it("returns 500 when the read use-case returns a storage error", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "DB down" };
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () => err(storageError);
    const setRuleTags: ForRunningSetRuleTags = async () => ok(makeAnnotation());
    const app = buildTestApp(okGetCalendarById, getEventsWithRules, setRuleTags);

    const res = await app.request(`/api/journal/${CALENDAR_ID}/rules`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body).toMatchObject({ error: "internal" });
  });
});

describe("PUT /api/journal/events/:hash/rules", () => {
  it("returns 200 with the saved annotation on a valid tag write", async () => {
    const saved = makeAnnotation({ ruleTags: ["gex-fit"] });
    const setRuleTags: ForRunningSetRuleTags = async () => ok(saved);
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () => ok([]);
    const app = buildTestApp(okGetCalendarById, getEventsWithRules, setRuleTags);

    const res = await app.request(`/api/journal/events/${HASH}/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["gex-fit"] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ fillIdsHash: HASH, tags: ["gex-fit"], otherNote: null });
  });

  it("passes the :hash param and body through to the use-case", async () => {
    let captured: unknown = null;
    const setRuleTags: ForRunningSetRuleTags = async (input) => {
      captured = input;
      return ok(makeAnnotation());
    };
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () => ok([]);
    const app = buildTestApp(okGetCalendarById, getEventsWithRules, setRuleTags);

    await app.request(`/api/journal/events/${HASH}/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["gex-fit"], otherNote: undefined }),
    });

    expect(captured).toEqual({ fillIdsHash: HASH, tags: ["gex-fit"], otherNote: null });
  });

  it("returns 400 when OTHER is tagged without a note (contract refine)", async () => {
    const setRuleTags: ForRunningSetRuleTags = async () => ok(makeAnnotation());
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () => ok([]);
    const app = buildTestApp(okGetCalendarById, getEventsWithRules, setRuleTags);

    const res = await app.request(`/api/journal/events/${HASH}/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["other"] }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when the use-case rejects a cross-type tag (validation-error)", async () => {
    const setRuleTags: ForRunningSetRuleTags = async () => {
      const e: ValidationError = { kind: "validation-error", message: "cross-type tag" };
      return err(e);
    };
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () => ok([]);
    const app = buildTestApp(okGetCalendarById, getEventsWithRules, setRuleTags);

    const res = await app.request(`/api/journal/events/${HASH}/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["gex-fit"] }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body).toMatchObject({ error: "cross-type tag" });
  });

  it("returns 404 when the use-case reports an unknown fillIdsHash (not-found)", async () => {
    const setRuleTags: ForRunningSetRuleTags = async () => {
      const e: CalendarNotFound = { kind: "not-found" };
      return err(e);
    };
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () => ok([]);
    const app = buildTestApp(okGetCalendarById, getEventsWithRules, setRuleTags);

    const res = await app.request(`/api/journal/events/${HASH}/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["gex-fit"] }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body).toMatchObject({ error: "not found" });
  });

  it("returns 500 when the use-case returns a storage error", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "DB down" };
    const setRuleTags: ForRunningSetRuleTags = async () => err(storageError);
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () => ok([]);
    const app = buildTestApp(okGetCalendarById, getEventsWithRules, setRuleTags);

    const res = await app.request(`/api/journal/events/${HASH}/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["gex-fit"] }),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body).toMatchObject({ error: "internal" });
    expect(JSON.stringify(body)).not.toContain("DB down");
  });
});
