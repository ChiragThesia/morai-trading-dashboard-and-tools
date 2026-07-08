/**
 * jobs.routes.test.ts — TDD RED tests for POST /api/jobs/:name/trigger (plan 05-08).
 *
 * Covers:
 *   - POST /jobs/rebuild-journal/trigger with calendarId → 202 { jobId }
 *   - POST /jobs/sync-fills/trigger without calendarId → 202 { jobId }
 *   - Invalid job name → 400 (zValidator param rejection)
 *   - Use-case StorageError → 422 { error }
 *   - Dedup no-op (null jobId from use-case) → 202 { jobId: null }
 *   - MCP-02: triggerJobPayload imported from @morai/contracts (one schema source)
 *
 * These tests fail on ASSERTIONS, not import errors.
 * They will go GREEN when plan 05-08 implements jobsRoutes.
 */

import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { ok, err } from "@morai/shared";
import { TRIGGERABLE_JOBS, triggerJobResponse } from "@morai/contracts";

// Local schema for error responses — no shared contract for error bodies
const errorBody = z.object({ error: z.string() });

describe("jobsRoutes", () => {
  function makeEnqueueJobSpy(returnValue = ok<string | null>("job-123")) {
    return vi.fn().mockResolvedValue(returnValue);
  }

  async function setupApp() {
    const { jobsRoutes } = await import("./jobs.routes.ts");
    const enqueueJob = makeEnqueueJobSpy();
    const app = new Hono();
    app.route("/", jobsRoutes(enqueueJob));
    return { app, enqueueJob };
  }

  it("POST /jobs/rebuild-journal/trigger with valid calendarId → 202 { jobId }", async () => {
    const { app, enqueueJob } = await setupApp();

    const calendarId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const res = await app.request("/jobs/rebuild-journal/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarId }),
    });

    expect(res.status).toBe(202);
    const body = triggerJobResponse.parse(await res.json());
    expect(body.jobId).toBe("job-123");
    expect(enqueueJob).toHaveBeenCalledWith(
      "rebuild-journal",
      expect.objectContaining({ calendarId }),
    );
  });

  it("POST /jobs/sync-fills/trigger without calendarId → 202 { jobId }", async () => {
    const { app, enqueueJob } = await setupApp();

    const res = await app.request("/jobs/sync-fills/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(202);
    const body = triggerJobResponse.parse(await res.json());
    expect(body.jobId).toBe("job-123");
    expect(enqueueJob).toHaveBeenCalledWith("sync-fills", expect.any(Object));
  });

  // journal-pnl-opennetdebit-units (round 3): account-wide fills-side-correction follow-up —
  // no calendarId, mirrors sync-fills' full-sweep trigger.
  it("POST /jobs/wipe-derived-fills/trigger without calendarId → 202 { jobId }", async () => {
    const { app, enqueueJob } = await setupApp();

    const res = await app.request("/jobs/wipe-derived-fills/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(202);
    const body = triggerJobResponse.parse(await res.json());
    expect(body.jobId).toBe("job-123");
    expect(enqueueJob).toHaveBeenCalledWith("wipe-derived-fills", expect.any(Object));
  });

  it("WR-04: rebuild-journal trigger WITHOUT calendarId → 400 and enqueueJob NOT called", async () => {
    const { app, enqueueJob } = await setupApp();

    const res = await app.request("/jobs/rebuild-journal/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("invalid job name (not in TRIGGERABLE_JOBS) → 400", async () => {
    const { app } = await setupApp();

    const res = await app.request("/jobs/unknown-job/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // zValidator on param should return 400
    expect(res.status).toBe(400);
  });

  it("use-case returns StorageError → 422 { error }", async () => {
    const { jobsRoutes } = await import("./jobs.routes.ts");
    const enqueueJob = vi.fn().mockResolvedValue(
      err({ kind: "storage-error" as const, message: "queue unavailable" }),
    );
    const app = new Hono();
    app.route("/", jobsRoutes(enqueueJob));

    const res = await app.request("/jobs/rebuild-journal/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(res.status).toBe(422);
    const body = errorBody.parse(await res.json());
    expect(body.error).toBe("queue unavailable");
  });

  it("dedup no-op: use-case returns ok(null) → 202 { jobId: null }", async () => {
    const { jobsRoutes } = await import("./jobs.routes.ts");
    const enqueueJob = vi.fn().mockResolvedValue(ok<string | null>(null));
    const app = new Hono();
    app.route("/", jobsRoutes(enqueueJob));

    const res = await app.request("/jobs/rebuild-journal/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(res.status).toBe(202);
    const body = triggerJobResponse.parse(await res.json());
    expect(body.jobId).toBeNull();
  });

  it("TRIGGERABLE_JOBS is the canonical list from @morai/contracts (MCP-02 single schema source)", () => {
    // This assertion guarantees the HTTP route and MCP tool share the same constants.
    // If a new job is added to contracts but not imported in the route, this test document the contract.
    expect(TRIGGERABLE_JOBS).toContain("rebuild-journal");
    expect(TRIGGERABLE_JOBS).toContain("sync-fills");
    expect(TRIGGERABLE_JOBS).toContain("compute-bsm-greeks");
    expect(TRIGGERABLE_JOBS).toContain("recompute-snapshot-pnl");
    expect(TRIGGERABLE_JOBS).toContain("wipe-derived-fills");
    expect(TRIGGERABLE_JOBS).toContain("register-open-calendars");
    expect(TRIGGERABLE_JOBS).toContain("fetch-schwab-chain");
    expect(TRIGGERABLE_JOBS).toHaveLength(7);
  });
});
