/**
 * journal-rules.ts — RED phase tests (RULE-01, D-14/D-21).
 *
 * Must-haves verified here:
 *   - setRuleTagsRequest is list-shaped (tags[]) + bounded (Security T-20-11).
 *   - D-21 refine: OTHER-without-note rejected; listed-value-without-note accepted;
 *     OTHER-with-note accepted.
 *   - oversized tags array / oversized otherNote rejected (Security V5).
 *   - a tag outside the single-sourced @morai/core vocabulary is rejected.
 *   - setRuleTagsResponse + getEventsWithRulesResponse round-trip.
 */

import { describe, it, expect } from "vitest";
import {
  setRuleTagsRequest,
  setRuleTagsResponse,
  getEventsWithRulesResponse,
} from "./journal-rules.ts";

describe("setRuleTagsRequest", () => {
  it("accepts a listed value with no otherNote", () => {
    const result = setRuleTagsRequest.safeParse({ tags: ["iv-skew-favorable"] });
    expect(result.success).toBe(true);
  });

  it("rejects 'other' with no otherNote (D-21)", () => {
    const result = setRuleTagsRequest.safeParse({ tags: ["other"] });
    expect(result.success).toBe(false);
  });

  it("rejects 'other' with an empty/whitespace-only otherNote (D-21)", () => {
    const result = setRuleTagsRequest.safeParse({ tags: ["other"], otherNote: "   " });
    expect(result.success).toBe(false);
  });

  it("accepts 'other' with a non-empty otherNote (D-21)", () => {
    const result = setRuleTagsRequest.safeParse({
      tags: ["other"],
      otherNote: "custom reason for entry",
    });
    expect(result.success).toBe(true);
  });

  it("accepts multiple listed values plus 'other' with a note", () => {
    const result = setRuleTagsRequest.safeParse({
      tags: ["gex-fit", "other"],
      otherNote: "extra context",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an oversized otherNote (> 280 chars)", () => {
    const result = setRuleTagsRequest.safeParse({
      tags: ["other"],
      otherNote: "x".repeat(281),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an oversized tags array (Security T-20-11 bound)", () => {
    const result = setRuleTagsRequest.safeParse({
      tags: [
        "iv-skew-favorable",
        "term-structure-edge",
        "event-window-play",
        "gex-fit",
        "profit-target",
        "max-loss",
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a tag outside the single-sourced @morai/core vocabulary", () => {
    const result = setRuleTagsRequest.safeParse({ tags: ["not-a-real-tag"] });
    expect(result.success).toBe(false);
  });

  it("rejects a missing tags field", () => {
    const result = setRuleTagsRequest.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts an empty tags array (clearing all recorded tags)", () => {
    const result = setRuleTagsRequest.safeParse({ tags: [] });
    expect(result.success).toBe(true);
  });
});

describe("setRuleTagsResponse", () => {
  it("round-trips the saved annotation", () => {
    const payload = {
      fillIdsHash: "a".repeat(64),
      tags: ["profit-target"],
      otherNote: null,
      updatedAt: "2026-07-05T14:00:00.000Z",
    };
    const result = setRuleTagsResponse.parse(payload);
    expect(result).toEqual(payload);
  });

  it("rejects a +00:00 suffix updatedAt timestamp", () => {
    const result = setRuleTagsResponse.safeParse({
      fillIdsHash: "a".repeat(64),
      tags: [],
      otherNote: null,
      updatedAt: "2026-07-05T14:00:00.000+00:00",
    });
    expect(result.success).toBe(false);
  });
});

describe("getEventsWithRulesResponse", () => {
  it("round-trips a combined events + annotations list", () => {
    const payload = {
      events: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          eventType: "OPEN" as const,
          eventedAt: "2026-06-01T14:30:00.000Z",
          fillIdsHash: "b".repeat(64),
          legOccSymbol: "SPX   260620C05000000",
          tags: ["iv-skew-favorable"],
          otherNote: null,
        },
        {
          id: "660e8400-e29b-41d4-a716-446655440001",
          eventType: "CLOSE" as const,
          eventedAt: "2026-06-20T14:30:00.000Z",
          fillIdsHash: "c".repeat(64),
          legOccSymbol: "SPX   260620C05000000",
          tags: ["profit-target", "other"],
          otherNote: "closed early on a gap",
        },
      ],
    };
    const result = getEventsWithRulesResponse.parse(payload);
    expect(result).toEqual(payload);
  });

  it("accepts an event with no recorded tags yet", () => {
    const result = getEventsWithRulesResponse.safeParse({
      events: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          eventType: "OPEN",
          eventedAt: "2026-06-01T14:30:00.000Z",
          fillIdsHash: "b".repeat(64),
          legOccSymbol: "SPX   260620C05000000",
          tags: [],
          otherNote: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid eventType", () => {
    const result = getEventsWithRulesResponse.safeParse({
      events: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          eventType: "BOGUS",
          eventedAt: "2026-06-01T14:30:00.000Z",
          fillIdsHash: "b".repeat(64),
          legOccSymbol: "SPX   260620C05000000",
          tags: [],
          otherNote: null,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
