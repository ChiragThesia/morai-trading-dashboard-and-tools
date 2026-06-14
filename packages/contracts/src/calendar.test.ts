import { describe, it, expect } from "vitest";
import {
  registerCalendarRequest,
  calendarResponse,
  listCalendarsResponse,
  closeCalendarRequest,
} from "./calendar.ts";

const validBody = {
  underlying: "SPX",
  strike: 7100000,
  optionType: "C" as const,
  frontExpiry: "2026-02-21",
  backExpiry: "2026-03-21",
  qty: 1,
  openNetDebit: 5.5,
};

describe("registerCalendarRequest", () => {
  it("accepts a well-formed body", () => {
    const result = registerCalendarRequest.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it("accepts optional openedAt and notes", () => {
    const result = registerCalendarRequest.safeParse({
      ...validBody,
      openedAt: "2026-01-02T14:30:00Z",
      notes: "test note",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing optionType", () => {
    const { optionType: _, ...withoutType } = validBody;
    const result = registerCalendarRequest.safeParse(withoutType);
    expect(result.success).toBe(false);
  });

  it("rejects optionType not in {C,P}", () => {
    const result = registerCalendarRequest.safeParse({
      ...validBody,
      optionType: "X",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive strike", () => {
    const result = registerCalendarRequest.safeParse({
      ...validBody,
      strike: -1000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero strike", () => {
    const result = registerCalendarRequest.safeParse({
      ...validBody,
      strike: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive qty", () => {
    const result = registerCalendarRequest.safeParse({
      ...validBody,
      qty: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed frontExpiry (not YYYY-MM-DD)", () => {
    const result = registerCalendarRequest.safeParse({
      ...validBody,
      frontExpiry: "2026/02/21",
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed backExpiry (not YYYY-MM-DD)", () => {
    const result = registerCalendarRequest.safeParse({
      ...validBody,
      backExpiry: "21-03-2026",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer strike", () => {
    const result = registerCalendarRequest.safeParse({
      ...validBody,
      strike: 7100000.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer qty", () => {
    const result = registerCalendarRequest.safeParse({
      ...validBody,
      qty: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

// Zod v4 requires a valid UUID version in position 13 (1–8)
const VALID_UUID = "11111111-1111-1111-8111-111111111111";

describe("calendarResponse", () => {
  it("parses a valid calendar response", () => {
    const result = calendarResponse.safeParse({
      id: VALID_UUID,
      underlying: "SPX",
      strike: 7100000,
      optionType: "C",
      frontExpiry: "2026-02-21",
      backExpiry: "2026-03-21",
      qty: 1,
      openNetDebit: 5.5,
      status: "open",
      openedAt: "2026-01-02T14:30:00.000Z",
      closedAt: "2026-03-21T14:30:00.000Z",
      notes: null,
    });
    expect(result.success).toBe(true);
  });

  it("parses calendarResponse with null closedAt", () => {
    const result = calendarResponse.safeParse({
      id: VALID_UUID,
      underlying: "SPX",
      strike: 7100000,
      optionType: "C",
      frontExpiry: "2026-02-21",
      backExpiry: "2026-03-21",
      qty: 1,
      openNetDebit: 5.5,
      status: "open",
      openedAt: "2026-01-02T14:30:00.000Z",
      closedAt: null,
      notes: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("listCalendarsResponse", () => {
  it("parses an empty array", () => {
    const result = listCalendarsResponse.safeParse({ calendars: [] });
    expect(result.success).toBe(true);
  });
});

describe("closeCalendarRequest", () => {
  it("accepts a valid closeNetCredit", () => {
    const result = closeCalendarRequest.safeParse({ closeNetCredit: 3.25 });
    expect(result.success).toBe(true);
  });

  it("rejects missing closeNetCredit", () => {
    const result = closeCalendarRequest.safeParse({});
    expect(result.success).toBe(false);
  });
});
