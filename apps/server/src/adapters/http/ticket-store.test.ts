/**
 * ticket-store.test.ts — Unit tests for opaque single-use ticket store (D-01, STRM-03)
 *
 * Covers:
 *   - mintTicket: returns UUID, distinct tickets per userId, multiple tickets per user
 *   - redeemTicket: valid redemption → userId; second redemption → null (single-use)
 *   - redeemTicket: unknown ticket → null
 *   - redeemTicket: expired ticket (past 30s TTL) → null
 *   - redeemTicket: cross-user isolation (consuming one user's ticket doesn't affect another's)
 *
 * Clock injection (now: NowFn) makes TTL expiry deterministic without real timers.
 */

import { describe, it, expect } from "vitest";
import { mintTicket, redeemTicket } from "./ticket-store.ts";

describe("ticket-store", () => {
  describe("mintTicket", () => {
    it("returns a v4 UUID string", () => {
      const ticket = mintTicket("user-a");
      expect(typeof ticket).toBe("string");
      // UUID v4 pattern: 8-4-4-4-12 hex with version nibble '4' and variant '8/9/a/b'
      expect(ticket).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("same userId can mint multiple distinct tickets", () => {
      const t1 = mintTicket("user-multi");
      const t2 = mintTicket("user-multi");
      expect(t1).not.toBe(t2);
    });
  });

  describe("redeemTicket", () => {
    it("returns userId on first valid redemption", () => {
      const ticket = mintTicket("user-redeem-1");
      const result = redeemTicket(ticket);
      expect(result).toBe("user-redeem-1");
    });

    it("returns null on second redemption of same ticket (single-use invariant)", () => {
      const ticket = mintTicket("user-redeem-2");
      redeemTicket(ticket); // first — valid
      const second = redeemTicket(ticket); // replay
      expect(second).toBeNull();
    });

    it("returns null for unknown ticket", () => {
      const result = redeemTicket("00000000-0000-4000-8000-000000000000");
      expect(result).toBeNull();
    });

    it("returns null for random non-ticket string", () => {
      const result = redeemTicket("not-a-ticket");
      expect(result).toBeNull();
    });

    it("returns null for expired ticket (past 30s TTL)", () => {
      // mint at t=0, redeem at t=30_001 (1ms past the 30_000ms TTL)
      const ticket = mintTicket("user-expired", () => 0);
      const result = redeemTicket(ticket, () => 30_001);
      expect(result).toBeNull();
    });

    it("returns userId for ticket at exactly the TTL boundary (not yet expired)", () => {
      // exp = 0 + 30_000 = 30_000; now() = 30_000; 30_000 > 30_000 is false → valid
      const ticket = mintTicket("user-boundary", () => 0);
      const result = redeemTicket(ticket, () => 30_000);
      expect(result).toBe("user-boundary");
    });

    it("returns null for ticket 1ms past the TTL boundary", () => {
      const ticket = mintTicket("user-past-boundary", () => 0);
      const result = redeemTicket(ticket, () => 30_001);
      expect(result).toBeNull();
    });

    it("does not affect another user's ticket (cross-user isolation)", () => {
      const ticketA = mintTicket("user-iso-a");
      const ticketB = mintTicket("user-iso-b");
      // Consume A
      redeemTicket(ticketA);
      // B must still work
      const resultB = redeemTicket(ticketB);
      expect(resultB).toBe("user-iso-b");
    });

    it("second redemption of an expired ticket also returns null", () => {
      // Expired ticket, two redemption attempts
      const ticket = mintTicket("user-exp-replay", () => 0);
      const first = redeemTicket(ticket, () => 40_000); // expired
      const second = redeemTicket(ticket, () => 41_000); // still gone
      expect(first).toBeNull();
      expect(second).toBeNull();
    });
  });
});
