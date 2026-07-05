/**
 * tools.test.ts (Phase 19, Plan 07) — get_picker_candidates MCP tool (PICK-02 / MCP-02).
 *
 * Drives the tool through a real McpServer + InMemoryTransport-linked Client so the
 * registered handler is genuinely invoked (not just the underlying use-case called
 * directly) — avoids the green-suite-without-coverage pattern flagged in prior phases.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type { ForRunningGetPicker, PickerSnapshotRow } from "@morai/core";
import { pickerSnapshotResponse } from "@morai/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerGetPickerCandidatesTool } from "./tools.ts";

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
