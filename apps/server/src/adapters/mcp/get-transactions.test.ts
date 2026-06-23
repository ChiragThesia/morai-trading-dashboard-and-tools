/**
 * get-transactions.test.ts — behavioral coverage for the get_transactions MCP tool (BRK-03).
 *
 * The production tool already exists (registerGetTransactionsTool in tools.ts, Phase 4 / BRK-02).
 * These tests VERIFY it against the SPEC acceptance — they do not rebuild it.
 *
 * Seam: a faked ForGettingTransactions stands in for the msw'd Schwab adapter (offline). The
 * function-type port makes the double a plain async function, exactly as syncTransactions.test.ts
 * fakes ForFetchingTransactions. No live network, no DB.
 *
 * Reach the registered handler via the same Reflect pattern the get_journal CR-02 and
 * trigger_job CR-A1 tests use — no any/as/! (typescript.md): unknown + narrowing only.
 */
import { describe, it, expect } from "vitest";
import { ok, err, formatOccSymbol } from "@morai/shared";
import type {
  ForGettingTransactions,
} from "@morai/core";
import {
  transactionsResponse,
  brokerageAuthExpiredPayload,
} from "@morai/contracts";

// ─── Fixture: one contract-shaped BrokerTransaction ───────────────────────────
// Reuse the FRONT-style occSymbol fixture from syncTransactions.test.ts so the
// occSymbol passes the contract's length(21) check.
const FRONT = formatOccSymbol({
  root: "SPX",
  expiry: new Date("2026-06-20T12:00:00Z"),
  type: "P",
  strike: 7100,
});

const ONE_TX = {
  activityId: 1001,
  tradeDate: "2026-06-15",
  netAmount: -1550,
  orderId: 9001,
  legs: [{ occSymbol: FRONT, qty: 1, price: 15.5, positionEffect: "OPENING" as const }],
};

// ─── Reflect helper: reach the registered get_transactions handler ────────────
// Mirrors getTriggerJobHandler in mcp.test.ts. Returns the handler narrowed to a
// function taking unknown args. All property lookups go through Reflect.get (unknown).
async function getTransactionsHandler(
  getTransactions: ForGettingTransactions,
): Promise<(args: unknown) => Promise<unknown>> {
  const { registerGetTransactionsTool } = await import("./tools.ts");
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");

  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerGetTransactionsTool(server, getTransactions);

  const toolsMap: unknown = Reflect.get(server, "_registeredTools");
  if (typeof toolsMap !== "object" || toolsMap === null) {
    throw new Error("_registeredTools not found on McpServer instance");
  }
  const toolEntry: unknown = Reflect.get(toolsMap, "get_transactions");
  if (typeof toolEntry !== "object" || toolEntry === null) {
    throw new Error("get_transactions tool not registered");
  }
  const handler: unknown = Reflect.get(toolEntry, "handler");
  if (typeof handler !== "function") {
    throw new Error("get_transactions handler is not a function");
  }
  return async (args: unknown): Promise<unknown> =>
    Reflect.apply(handler, undefined, [args]);
}

// Extract content[0].text (string) from a tool result without casts.
function firstContentText(result: unknown): string {
  if (typeof result !== "object" || result === null) {
    throw new Error("handler did not return an object");
  }
  const content: unknown = Reflect.get(result, "content");
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error("handler result has no content");
  }
  const first: unknown = content[0];
  if (typeof first !== "object" || first === null) {
    throw new Error("first content item is not an object");
  }
  const text: unknown = Reflect.get(first, "text");
  if (typeof text !== "string") {
    throw new Error("content text is not a string");
  }
  return text;
}

// Days between two YYYY-MM-DD strings (UTC midnight).
function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

describe("get_transactions MCP tool (BRK-03)", () => {
  // ─── Test A: valid-range payload ────────────────────────────────────────────
  it("A: explicit from/to → transactionsResponse-valid payload with the one transaction", async () => {
    const fakeGetTransactions: ForGettingTransactions = async () => ok([ONE_TX]);

    const handler = await getTransactionsHandler(fakeGetTransactions);
    const result = await handler({ from: "2026-06-01", to: "2026-06-20" });

    const text = firstContentText(result);
    const payload: unknown = JSON.parse(text);
    // MCP-02 runtime backstop: must parse clean through the shared contract.
    expect(() => transactionsResponse.parse(payload)).not.toThrow();
    const parsed = transactionsResponse.parse(payload);
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0]?.activityId).toBe(1001);
  });

  // ─── Test B: default last-90d window when params omitted ─────────────────────
  it("B: no from/to → handler defaults to a last-90d window ending today", async () => {
    let seenFrom: string | null = null;
    let seenTo: string | null = null;
    const fakeGetTransactions: ForGettingTransactions = async (from, to) => {
      seenFrom = from;
      seenTo = to;
      return ok([]);
    };

    const handler = await getTransactionsHandler(fakeGetTransactions);
    await handler({});

    expect(seenFrom).not.toBeNull();
    expect(seenTo).not.toBeNull();
    if (seenFrom === null || seenTo === null) return;

    const today = new Date().toISOString().slice(0, 10);
    expect(seenTo).toBe(today);
    // from is 90 days earlier (mirrors brokerage.routes.ts).
    expect(daysBetween(seenFrom, seenTo)).toBe(90);
  });

  // ─── Test C: AUTH_EXPIRED → typed paused payload, no throw ───────────────────
  it("C: AUTH_EXPIRED → brokerageAuthExpiredPayload, does not throw", async () => {
    const fakeGetTransactions: ForGettingTransactions = async () =>
      err({ kind: "auth-expired", appId: "trader" });

    const handler = await getTransactionsHandler(fakeGetTransactions);
    let result: unknown;
    await expect(
      (async () => {
        result = await handler({ from: "2026-06-01", to: "2026-06-20" });
      })(),
    ).resolves.toBeUndefined();

    const text = firstContentText(result);
    const payload: unknown = JSON.parse(text);
    expect(() => brokerageAuthExpiredPayload.parse(payload)).not.toThrow();
    const parsed = brokerageAuthExpiredPayload.parse(payload);
    expect(parsed.paused).toBe(true);
    expect(parsed.reason).toBe("AUTH_EXPIRED");
  });

  // ─── Test D: MCP-02 contract parity (runtime backstop) ───────────────────────
  it("D: success payload validates against the SAME @morai/contracts transactionsResponse", async () => {
    const fakeGetTransactions: ForGettingTransactions = async () => ok([ONE_TX]);

    const handler = await getTransactionsHandler(fakeGetTransactions);
    const result = await handler({ from: "2026-06-01", to: "2026-06-20" });

    const text = firstContentText(result);
    const payload: unknown = JSON.parse(text);
    // The HTTP route parses through this exact import — same schema, same module.
    expect(() => transactionsResponse.parse(payload)).not.toThrow();
  });
});
