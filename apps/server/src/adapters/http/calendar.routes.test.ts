import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type {
  ForRunningRegisterCalendar,
  ForListingCalendars,
  ForClosingCalendar,
  Calendar,
  StorageError,
  ValidationError,
} from "@morai/core";
import { calendarRoutes } from "./calendar.routes.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

const openCalendar: Calendar = {
  id: VALID_UUID,
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

const closedCalendar: Calendar = {
  ...openCalendar,
  status: "closed",
  closedAt: new Date("2026-03-01T14:30:00.000Z"),
};

const validBody = {
  underlying: "SPX",
  strike: 7100000,
  optionType: "C",
  frontExpiry: "2026-02-21",
  backExpiry: "2026-03-21",
  qty: 1,
  openNetDebit: 5.5,
};

// ─── Fake use-cases ──────────────────────────────────────────────────────────

const okRegister: ForRunningRegisterCalendar = async () => ok(openCalendar);

const validationErrRegister: ForRunningRegisterCalendar = async () => {
  const e: ValidationError = {
    kind: "validation-error",
    message: "backExpiry must be after frontExpiry",
  };
  return err(e);
};

const storageErrRegister: ForRunningRegisterCalendar = async () => {
  const e: StorageError = { kind: "storage-error", message: "DB error" };
  return err(e);
};

const okList: ForListingCalendars = async () => ok([openCalendar]);
const emptyList: ForListingCalendars = async () => ok([]);

const okClose: ForClosingCalendar = async () => ok(closedCalendar);
const notFoundClose: ForClosingCalendar = async () =>
  err({ kind: "not-found" as const });
const alreadyClosedClose: ForClosingCalendar = async () =>
  err({ kind: "already-closed" as const });

// ─── Test harness ─────────────────────────────────────────────────────────────

function buildApp(
  register: ForRunningRegisterCalendar,
  list: ForListingCalendars,
  close: ForClosingCalendar,
) {
  const app = new Hono();
  app.route("/api", calendarRoutes(register, list, close));
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/calendars", () => {
  it("returns 201 + calendarResponse JSON on valid body", async () => {
    const app = buildApp(okRegister, emptyList, okClose);
    const res = await app.request("/api/calendars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const body: unknown = await res.json();
    expect(
      typeof (body as { id: unknown }).id,
    ).toBe("string");
  });

  it("returns 400 on validation-error from use-case (back<=front)", async () => {
    const app = buildApp(validationErrRegister, emptyList, okClose);
    const res = await app.request("/api/calendars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 on malformed body (zValidator)", async () => {
    const app = buildApp(okRegister, emptyList, okClose);
    const res = await app.request("/api/calendars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ underlying: "SPX" }), // missing required fields
    });
    expect(res.status).toBe(400);
  });

  it("returns 500 on storage-error from use-case", async () => {
    const app = buildApp(storageErrRegister, emptyList, okClose);
    const res = await app.request("/api/calendars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(500);
  });
});

describe("GET /api/calendars", () => {
  it("returns 200 + {calendars:[...]} for a list", async () => {
    const app = buildApp(okRegister, okList, okClose);
    const res = await app.request("/api/calendars");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(Array.isArray((body as { calendars: unknown }).calendars)).toBe(true);
  });

  it("returns 200 + empty array when no calendars", async () => {
    const app = buildApp(okRegister, emptyList, okClose);
    const res = await app.request("/api/calendars");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect((body as { calendars: unknown[] }).calendars).toHaveLength(0);
  });

  it("passes ?status=open filter to use-case", async () => {
    let capturedFilter: "open" | "closed" | undefined;
    const trackingList: ForListingCalendars = async (filter) => {
      capturedFilter = filter;
      return ok([]);
    };
    const app = buildApp(okRegister, trackingList, okClose);
    await app.request("/api/calendars?status=open");
    expect(capturedFilter).toBe("open");
  });

  it("ignores invalid ?status value (treats as no filter)", async () => {
    let capturedFilter: "open" | "closed" | undefined;
    const trackingList: ForListingCalendars = async (filter) => {
      capturedFilter = filter;
      return ok([]);
    };
    const app = buildApp(okRegister, trackingList, okClose);
    await app.request("/api/calendars?status=invalid");
    expect(capturedFilter).toBeUndefined();
  });
});

describe("POST /api/calendars/:id/close", () => {
  it("returns 200 + calendarResponse on successful close", async () => {
    const app = buildApp(okRegister, emptyList, okClose);
    const res = await app.request(`/api/calendars/${VALID_UUID}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closeNetCredit: 3.25 }),
    });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect((body as { status: string }).status).toBe("closed");
  });

  it("returns 404 when calendar not found", async () => {
    const app = buildApp(okRegister, emptyList, notFoundClose);
    const res = await app.request(`/api/calendars/${VALID_UUID}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closeNetCredit: 3.25 }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when calendar already closed", async () => {
    const app = buildApp(okRegister, emptyList, alreadyClosedClose);
    const res = await app.request(`/api/calendars/${VALID_UUID}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closeNetCredit: 3.25 }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 on malformed body for close (missing closeNetCredit)", async () => {
    const app = buildApp(okRegister, emptyList, okClose);
    const res = await app.request(`/api/calendars/${VALID_UUID}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
