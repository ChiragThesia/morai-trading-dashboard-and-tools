import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type { ForReadingJournal, StorageError, SnapshotRow } from "@morai/core";
import { journalResponse } from "@morai/contracts";
import { journalRoutes } from "./journal.routes.ts";

// Helper: build a test Hono app with an injected getJournal double
function buildTestApp(getJournal: ForReadingJournal) {
  const app = new Hono();
  app.route("/api", journalRoutes(getJournal));
  return app;
}

const CALENDAR_ID = "550e8400-e29b-41d4-a716-446655440001";

function makeSnapshotRow(overrides?: Partial<SnapshotRow>): SnapshotRow {
  return {
    time: new Date("2026-06-14T15:00:00.000Z"),
    calendarId: CALENDAR_ID,
    spot: "7274.14",
    netMark: "12.5",
    frontMark: "25.4",
    backMark: "37.9",
    frontIv: "0.25",
    backIv: "0.2341",
    frontIvRaw: "0.26",
    backIvRaw: "0.1818",
    netDelta: "-0.05",
    netGamma: "0.001",
    netTheta: "-12.3",
    netVega: "4.5",
    termSlope: "-0.016",
    dteFront: 7,
    dteBack: 97,
    pnlOpen: "-450",
    source: "cboe",
    ...overrides,
  };
}

describe("GET /api/journal/:calendarId", () => {
  it("returns 200 with ordered snapshots array for a known calendar", async () => {
    const rows = [
      makeSnapshotRow({ time: new Date("2026-06-14T15:00:00.000Z") }),
      makeSnapshotRow({ time: new Date("2026-06-14T15:30:00.000Z") }),
    ];
    const getJournal: ForReadingJournal = async (_id) => ok(rows);
    const app = buildTestApp(getJournal);

    const res = await app.request(`/api/journal/${CALENDAR_ID}`);
    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    const parsed = journalResponse.parse(body);
    expect(parsed.snapshots).toHaveLength(2);
    // First snapshot time should come before second
    const times = parsed.snapshots.map((s) => s.time);
    expect(times[0]).toBe("2026-06-14T15:00:00.000Z");
    expect(times[1]).toBe("2026-06-14T15:30:00.000Z");
  });

  it("returns 404 when calendarId is unknown (use-case returns ok(null))", async () => {
    const getJournal: ForReadingJournal = async (_id) => ok(null);
    const app = buildTestApp(getJournal);

    const res = await app.request(`/api/journal/${CALENDAR_ID}`);
    expect(res.status).toBe(404);

    const body: unknown = await res.json();
    expect(body).toMatchObject({ error: "not found" });
  });

  it("returns 200 with empty snapshots array for a known calendar with no snapshots", async () => {
    const getJournal: ForReadingJournal = async (_id) => ok([]);
    const app = buildTestApp(getJournal);

    const res = await app.request(`/api/journal/${CALENDAR_ID}`);
    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    const parsed = journalResponse.parse(body);
    expect(parsed.snapshots).toHaveLength(0);
  });

  it("returns 500 when use-case returns a storage error", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "DB down" };
    const getJournal: ForReadingJournal = async (_id) => err(storageError);
    const app = buildTestApp(getJournal);

    const res = await app.request(`/api/journal/${CALENDAR_ID}`);
    expect(res.status).toBe(500);

    const body: unknown = await res.json();
    expect(body).toMatchObject({ error: "internal" });
  });

  it("body passes journalResponse.parse (MCP-02 schema contract)", async () => {
    const getJournal: ForReadingJournal = async (_id) => ok([makeSnapshotRow()]);
    const app = buildTestApp(getJournal);

    const res = await app.request(`/api/journal/${CALENDAR_ID}`);
    const body: unknown = await res.json();
    // Must not throw — validates MCP-02 single source of truth
    expect(() => journalResponse.parse(body)).not.toThrow();
  });

  it("passes the calendarId param to the use-case", async () => {
    let capturedId = "";
    const getJournal: ForReadingJournal = async (id) => {
      capturedId = id;
      return ok(null);
    };
    const app = buildTestApp(getJournal);

    await app.request(`/api/journal/${CALENDAR_ID}`);
    expect(capturedId).toBe(CALENDAR_ID);
  });

  it("error body does not leak internal details (T-03-16)", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "SELECT failed: pg error 123" };
    const getJournal: ForReadingJournal = async (_id) => err(storageError);
    const app = buildTestApp(getJournal);

    const res = await app.request(`/api/journal/${CALENDAR_ID}`);
    expect(res.status).toBe(500);

    const body: unknown = await res.json();
    expect(body).toMatchObject({ error: "internal" });
    // Must not include the DB error message
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("pg error 123");
    expect(bodyStr).not.toContain("SELECT failed");
  });
});
