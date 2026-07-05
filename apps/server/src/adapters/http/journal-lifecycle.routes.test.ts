import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type { StorageError, SnapshotRow, ForRunningGetCalendarLifecycle, LifecycleSnapshot } from "@morai/core";
import { lifecycleResponse } from "@morai/contracts";
import { journalLifecycleRoutes } from "./journal-lifecycle.routes.ts";

// Helper: build a test Hono app with an injected getCalendarLifecycle double
function buildTestApp(getCalendarLifecycle: ForRunningGetCalendarLifecycle) {
  const app = new Hono();
  app.route("/api", journalLifecycleRoutes(getCalendarLifecycle));
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

function makeLifecycleSnapshot(overrides?: Partial<LifecycleSnapshot>): LifecycleSnapshot {
  return {
    ...makeSnapshotRow(),
    forwardVol: 0.21,
    forwardVolGuard: "ok",
    isGap: false,
    cumTheta: -12.3,
    cumVega: 4.5,
    cumDeltaGamma: 0.1,
    cumResidual: 0.05,
    ...overrides,
  };
}

describe("GET /api/journal/:calendarId/lifecycle", () => {
  it("returns 200 with enriched snapshots parsed through lifecycleResponse", async () => {
    const rows = [makeLifecycleSnapshot()];
    const getCalendarLifecycle: ForRunningGetCalendarLifecycle = async (_id) => ok(rows);
    const app = buildTestApp(getCalendarLifecycle);

    const res = await app.request(`/api/journal/${CALENDAR_ID}/lifecycle`);
    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    const parsed = lifecycleResponse.parse(body);
    expect(parsed.snapshots).toHaveLength(1);
    expect(parsed.snapshots[0]?.time).toBe("2026-06-14T15:00:00.000Z");
    expect(parsed.snapshots[0]?.forwardVol).toBe(0.21);
    expect(parsed.snapshots[0]?.forwardVolGuard).toBe("ok");
    expect(parsed.snapshots[0]?.isGap).toBe(false);
    expect(parsed.snapshots[0]?.cumTheta).toBe(-12.3);
  });

  it("returns 404 when calendarId is unknown (use-case returns ok(null))", async () => {
    const getCalendarLifecycle: ForRunningGetCalendarLifecycle = async (_id) => ok(null);
    const app = buildTestApp(getCalendarLifecycle);

    const res = await app.request(`/api/journal/${CALENDAR_ID}/lifecycle`);
    expect(res.status).toBe(404);

    const body: unknown = await res.json();
    expect(body).toMatchObject({ error: "not found" });
  });

  it("returns 200 with empty snapshots for a known calendar with no snapshots", async () => {
    const getCalendarLifecycle: ForRunningGetCalendarLifecycle = async (_id) => ok([]);
    const app = buildTestApp(getCalendarLifecycle);

    const res = await app.request(`/api/journal/${CALENDAR_ID}/lifecycle`);
    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    const parsed = lifecycleResponse.parse(body);
    expect(parsed.snapshots).toHaveLength(0);
  });

  it("returns 500 with a flat error body when the use-case returns a storage error (T-03-16)", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "SELECT failed: pg error 123" };
    const getCalendarLifecycle: ForRunningGetCalendarLifecycle = async (_id) => err(storageError);
    const app = buildTestApp(getCalendarLifecycle);

    const res = await app.request(`/api/journal/${CALENDAR_ID}/lifecycle`);
    expect(res.status).toBe(500);

    const body: unknown = await res.json();
    expect(body).toMatchObject({ error: "internal" });
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("pg error 123");
    expect(bodyStr).not.toContain("SELECT failed");
  });

  it("passes the calendarId param to the use-case", async () => {
    let capturedId = "";
    const getCalendarLifecycle: ForRunningGetCalendarLifecycle = async (id) => {
      capturedId = id;
      return ok(null);
    };
    const app = buildTestApp(getCalendarLifecycle);

    await app.request(`/api/journal/${CALENDAR_ID}/lifecycle`);
    expect(capturedId).toBe(CALENDAR_ID);
  });
});
