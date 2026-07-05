/**
 * tools.test.ts (Phase 19, Plan 07) — get_picker_candidates MCP tool (PICK-02 / MCP-02).
 *
 * Drives the tool through a real McpServer + InMemoryTransport-linked Client so the
 * registered handler is genuinely invoked (not just the underlying use-case called
 * directly) — avoids the green-suite-without-coverage pattern flagged in prior phases.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type {
  ForRunningGetPicker,
  PickerSnapshotRow,
  ForRunningGetCalendarEventsWithRules,
  ForRunningSetRuleTags,
  CalendarEvent,
  CalendarEventAnnotation,
  ValidationError,
  CalendarNotFound,
} from "@morai/core";
import { pickerSnapshotResponse, getEventsWithRulesResponse, setRuleTagsResponse } from "@morai/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  registerGetPickerCandidatesTool,
  registerGetRuleTagsTool,
  registerSetRuleTagsTool,
} from "./tools.ts";

// ── Test doubles ──────────────────────────────────────────────────────────────

const STORED_ROW: PickerSnapshotRow = {
  observedAt: new Date("2026-07-01T14:30:00.000Z"),
  snapshot: {
    asOf: "2026-07-01",
    observedAt: "2026-07-01T14:30:00.000Z",
    spot: 7500,
    source: "schwab",
    gexContextStatus: "ok",
    eventsContextStatus: "ok",
    termStructure: [{ dte: 7, iv: 0.15 }],
    gex: { flip: 7450.5, callWall: 7600, putWall: 7400, netGammaAtSpot: -1.2, absGammaStrike: 7500 },
    events: [{ date: "2026-07-04", name: "FOMC" }],
    candidates: [],
  },
};

/** Returns the stored picker snapshot row */
const getPickerOk: ForRunningGetPicker = async () => ok(STORED_ROW);

/** Returns null — no snapshot computed yet */
const getPickerNull: ForRunningGetPicker = async () => ok(null);

/** Returns a storage error */
const getPickerErr: ForRunningGetPicker = async () =>
  err({ kind: "storage-error" as const, message: "db connection failed" });

// ── Test harness: drive the real registered tool through an in-memory transport ─

async function callGetPickerCandidates(getPicker: ForRunningGetPicker): Promise<string> {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerGetPickerCandidatesTool(server, getPicker);

  const client = new Client({ name: "test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const result = await client.callTool({ name: "get_picker_candidates", arguments: {} });
  const first = result.content[0];
  if (first === undefined || first.type !== "text") {
    throw new Error("expected text content from get_picker_candidates");
  }
  return first.text;
}

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("get_picker_candidates MCP tool", () => {
  it("returns pickerSnapshotResponse-valid content for a stored row", async () => {
    const text = await callGetPickerCandidates(getPickerOk);
    const parsed = pickerSnapshotResponse.parse(JSON.parse(text));
    expect(parsed.asOf).toBe("2026-07-01");
    expect(parsed.spot).toBe(7500);
    expect(parsed.source).toBe("schwab");
  });

  it("returns {error:'no-snapshot'} content when getPicker returns null", async () => {
    const text = await callGetPickerCandidates(getPickerNull);
    expect(JSON.parse(text)).toStrictEqual({ error: "no-snapshot" });
  });

  it("returns 'internal error' text on a storage error (never throws)", async () => {
    const text = await callGetPickerCandidates(getPickerErr);
    expect(text).toBe("internal error");
    expect(text).not.toContain("db connection failed");
  });
});

// ── get_rule_tags / set_rule_tags MCP tools (RULE-01, plan 20-10) ──────────────

const CALENDAR_ID = "550e8400-e29b-41d4-a716-446655440001";
const HASH = "a".repeat(64);

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

/** Generic real-transport tool caller — server registers ONE tool via `register`. */
async function callTool(
  register: (server: McpServer) => void,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  register(server);

  const client = new Client({ name: "test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const result = await client.callTool({ name: toolName, arguments: args });
  const first = result.content[0];
  if (first === undefined || first.type !== "text") {
    throw new Error(`expected text content from ${toolName}`);
  }
  return first.text;
}

/**
 * callToolHandlerDirect — invokes a registered tool's handler directly via Reflect,
 * bypassing the McpServer SDK's own inputSchema-shape validation (which would otherwise
 * reject a malformed arg like a non-UUID string BEFORE the handler's internal safeParse
 * ever runs). Mirrors the existing mcp.test.ts CR-02 pattern for exercising the handler's
 * OWN safeParse-at-boundary fallback. No 'as' casts — every lookup is Reflect.get/apply
 * on `unknown`, narrowed via typeof/Array.isArray guards.
 */
async function callToolHandlerDirect(
  register: (server: McpServer) => void,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  register(server);

  const toolsMap: unknown = Reflect.get(server, "_registeredTools");
  if (typeof toolsMap !== "object" || toolsMap === null) {
    throw new Error("_registeredTools not found on McpServer instance");
  }
  const toolEntry: unknown = Reflect.get(toolsMap, toolName);
  if (typeof toolEntry !== "object" || toolEntry === null) {
    throw new Error(`${toolName} tool not registered`);
  }
  const handler: unknown = Reflect.get(toolEntry, "handler");
  if (typeof handler !== "function") {
    throw new Error(`${toolName} handler is not a function`);
  }

  const result: unknown = await Reflect.apply(handler, undefined, [args]);
  if (typeof result !== "object" || result === null) {
    throw new Error(`${toolName} handler did not return an object`);
  }
  const content: unknown = Reflect.get(result, "content");
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error(`${toolName} handler returned no content`);
  }
  const first: unknown = content[0];
  if (typeof first !== "object" || first === null) {
    throw new Error(`${toolName} first content item is not an object`);
  }
  const text: unknown = Reflect.get(first, "text");
  if (typeof text !== "string") {
    throw new Error(`${toolName} first content item has no text`);
  }
  return text;
}

describe("get_rule_tags MCP tool", () => {
  it("returns getEventsWithRulesResponse-valid content for a known calendar", async () => {
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () =>
      ok([{ event: makeEvent(), tags: ["gex-fit"], otherNote: null }]);

    const text = await callTool(
      (server) => registerGetRuleTagsTool(server, getEventsWithRules),
      "get_rule_tags",
      { calendarId: CALENDAR_ID },
    );

    const parsed = getEventsWithRulesResponse.parse(JSON.parse(text));
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({ fillIdsHash: HASH, tags: ["gex-fit"] });
  });

  it("returns an error content payload for an invalid calendarId, never throws", async () => {
    // Reflect-direct call: the MCP SDK's own inputSchema (z.string().uuid()) would
    // reject "not-a-uuid" at the transport layer before the handler ever runs — this
    // exercises the handler's OWN internal safeParse fallback (existing tool precedent).
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () => ok([]);

    const text = await callToolHandlerDirect(
      (server) => registerGetRuleTagsTool(server, getEventsWithRules),
      "get_rule_tags",
      { calendarId: "not-a-uuid" },
    );

    expect(JSON.parse(text)).toMatchObject({ error: "invalid calendarId" });
  });

  it("returns 'internal error' text on a storage error (never throws)", async () => {
    const getEventsWithRules: ForRunningGetCalendarEventsWithRules = async () =>
      err({ kind: "storage-error" as const, message: "db down" });

    const text = await callTool(
      (server) => registerGetRuleTagsTool(server, getEventsWithRules),
      "get_rule_tags",
      { calendarId: CALENDAR_ID },
    );

    expect(text).toBe("internal error");
    expect(text).not.toContain("db down");
  });
});

describe("set_rule_tags MCP tool", () => {
  it("returns setRuleTagsResponse-valid content on a valid write", async () => {
    const saved = makeAnnotation({ ruleTags: ["gex-fit"] });
    const setRuleTags: ForRunningSetRuleTags = async () => ok(saved);

    const text = await callTool(
      (server) => registerSetRuleTagsTool(server, setRuleTags),
      "set_rule_tags",
      { fillIdsHash: HASH, tags: ["gex-fit"] },
    );

    const parsed = setRuleTagsResponse.parse(JSON.parse(text));
    expect(parsed).toMatchObject({ fillIdsHash: HASH, tags: ["gex-fit"], otherNote: null });
  });

  it("rejects OTHER without a note as an error content payload, never throws (D-21)", async () => {
    const setRuleTags: ForRunningSetRuleTags = async () => ok(makeAnnotation());

    const text = await callTool(
      (server) => registerSetRuleTagsTool(server, setRuleTags),
      "set_rule_tags",
      { fillIdsHash: HASH, tags: ["other"] },
    );

    expect(JSON.parse(text)).toMatchObject({ error: expect.any(String) });
  });

  it("returns an error content payload for an invalid fillIdsHash, never throws", async () => {
    // Reflect-direct call: the MCP SDK's own inputSchema (z.string().length(64)) would
    // reject "too-short" at the transport layer before the handler ever runs.
    const setRuleTags: ForRunningSetRuleTags = async () => ok(makeAnnotation());

    const text = await callToolHandlerDirect(
      (server) => registerSetRuleTagsTool(server, setRuleTags),
      "set_rule_tags",
      { fillIdsHash: "too-short", tags: ["gex-fit"] },
    );

    expect(JSON.parse(text)).toMatchObject({ error: expect.any(String) });
  });

  it("returns a 'not found' error content payload for an unknown fillIdsHash", async () => {
    const setRuleTags: ForRunningSetRuleTags = async () => {
      const e: CalendarNotFound = { kind: "not-found" };
      return err(e);
    };

    const text = await callTool(
      (server) => registerSetRuleTagsTool(server, setRuleTags),
      "set_rule_tags",
      { fillIdsHash: HASH, tags: ["gex-fit"] },
    );

    expect(JSON.parse(text)).toMatchObject({ error: "not found" });
  });

  it("surfaces a validation-error message content payload for a cross-type tag", async () => {
    const setRuleTags: ForRunningSetRuleTags = async () => {
      const e: ValidationError = { kind: "validation-error", message: "cross-type tag" };
      return err(e);
    };

    const text = await callTool(
      (server) => registerSetRuleTagsTool(server, setRuleTags),
      "set_rule_tags",
      { fillIdsHash: HASH, tags: ["gex-fit"] },
    );

    expect(JSON.parse(text)).toMatchObject({ error: "cross-type tag" });
  });

  it("returns 'internal error' text on a storage error (never throws)", async () => {
    const setRuleTags: ForRunningSetRuleTags = async () =>
      err({ kind: "storage-error" as const, message: "db down" });

    const text = await callTool(
      (server) => registerSetRuleTagsTool(server, setRuleTags),
      "set_rule_tags",
      { fillIdsHash: HASH, tags: ["gex-fit"] },
    );

    expect(text).toBe("internal error");
    expect(text).not.toContain("db down");
  });
});
