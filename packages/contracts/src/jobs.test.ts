/**
 * jobs.test.ts — WR-04 contract test (TDD RED).
 *
 * A rebuild-journal trigger REQUIRES calendarId at the boundary; an empty body
 * must fail parse so the route returns 400 and never enqueues a null-keyed
 * rebuild (which would defeat dedup and flood the queue). Other jobs stay
 * calendarId-optional.
 */

import { describe, it, expect } from "vitest";
import { triggerJobPayload, triggerJobBodyFor } from "./jobs.ts";

describe("triggerJobBodyFor — WR-04 rebuild-journal requires calendarId", () => {
  const calendarId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("rebuild-journal WITHOUT calendarId fails parse", () => {
    const result = triggerJobBodyFor("rebuild-journal").safeParse({});
    expect(result.success).toBe(false);
  });

  it("rebuild-journal WITH calendarId passes", () => {
    const result = triggerJobBodyFor("rebuild-journal").safeParse({ calendarId });
    expect(result.success).toBe(true);
  });

  it("sync-fills WITHOUT calendarId passes (optional)", () => {
    const result = triggerJobBodyFor("sync-fills").safeParse({});
    expect(result.success).toBe(true);
  });

  it("compute-bsm-greeks WITHOUT calendarId passes (optional)", () => {
    const result = triggerJobBodyFor("compute-bsm-greeks").safeParse({});
    expect(result.success).toBe(true);
  });

  it("triggerJobPayload still exposes calendarId on its shape (MCP-02 stability)", () => {
    // The MCP tool reads triggerJobPayload.shape.calendarId — keep it intact.
    expect(triggerJobPayload.shape.calendarId).toBeDefined();
  });

  // JRNL-01 pnl-unit-mismatch fix: recompute-snapshot-pnl mirrors rebuild-journal — it is
  // meaningless without a calendarId, so it MUST require it at the same boundary (WR-04).
  it("recompute-snapshot-pnl WITHOUT calendarId fails parse", () => {
    const result = triggerJobBodyFor("recompute-snapshot-pnl").safeParse({});
    expect(result.success).toBe(false);
  });

  it("recompute-snapshot-pnl WITH calendarId passes", () => {
    const result = triggerJobBodyFor("recompute-snapshot-pnl").safeParse({ calendarId });
    expect(result.success).toBe(true);
  });
});
