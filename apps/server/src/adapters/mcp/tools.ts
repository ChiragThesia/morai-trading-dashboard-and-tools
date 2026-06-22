import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  statusResponse,
  listCalendarsResponse,
  journalResponse,
  liveGreeksResponse,
  positionsResponse,
  transactionsResponse,
  ordersResponse,
  termStructureResponse,
  brokerageAuthExpiredPayload,
} from "@morai/contracts";
import type {
  ForGettingStatus,
  ForListingCalendars,
  ForReadingJournal,
  ForRunningGetLiveGreeks,
  ForRunningGetTermStructure,
  ForGettingPositions,
  ForGettingTransactions,
  ForGettingOrders,
} from "@morai/core";
export { registerTriggerJobTool } from "./tools/trigger-job.ts";

/**
 * registerStatusTool — registers the get_status MCP tool on the given McpServer.
 *
 * Architecture law (mcp-and-plugins.md): adapter contains zero business logic.
 * Pattern: call use-case → parse result through statusResponse schema → return content.
 *
 * MCP-02: the SAME statusResponse schema used by the HTTP route is used here.
 * A one-sided field rename will fail bun run typecheck because both adapters
 * import the same StatusResponse inferred type.
 */
export function registerStatusTool(
  server: McpServer,
  getStatus: ForGettingStatus,
): void {
  server.registerTool(
    "get_status",
    {
      title: "Get Morai Status",
      description:
        "Returns DB health, token freshness, and last job run times for the Morai server.",
      // Empty raw shape — get_status takes no parameters.
      // ZodRawShapeCompat is Record<string, AnySchema>; {} satisfies this.
      inputSchema: {},
    },
    async () => {
      const result = await getStatus();
      // ForGettingStatus: StatusError = never — always returns ok(payload).
      // Guard with result.ok for the type narrower (exactOptionalPropertyTypes).
      if (!result.ok) {
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      const payload = statusResponse.parse(result.value);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(payload),
          },
        ],
      };
    },
  );
}

/**
 * registerListCalendarsTool — registers the list_calendars MCP tool.
 *
 * MCP-02: shares listCalendarsResponse schema with GET /api/calendars.
 * No parameters — returns {calendars:[...]} matching the HTTP route output.
 */
export function registerListCalendarsTool(
  server: McpServer,
  listCalendars: ForListingCalendars,
): void {
  server.registerTool(
    "list_calendars",
    {
      title: "List Calendars",
      description:
        "Returns all registered calendars (open and closed). Same payload as GET /api/calendars.",
      inputSchema: {},
    },
    async () => {
      const result = await listCalendars(undefined);
      if (!result.ok) {
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      // Serialise Date fields to ISO strings before parsing through the contract
      // (mirrors calendarRoutes: cal.openedAt.toISOString() — MCP-02 same contract).
      const payload = listCalendarsResponse.parse({
        calendars: result.value.map((cal) => ({
          ...cal,
          openedAt: cal.openedAt.toISOString(),
          closedAt: cal.closedAt !== null ? cal.closedAt.toISOString() : null,
        })),
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    },
  );
}

/**
 * registerGetJournalTool — registers the get_journal MCP tool.
 *
 * MCP-02: shares journalResponse schema with GET /api/journal/:calendarId.
 * Re-parses args at boundary (RESEARCH.md §Focus Area 2, Pitfall 6 — exactOptionalPropertyTypes).
 * Unknown calendarId → returns not-found text, never throws (SPEC §7).
 */
export function registerGetJournalTool(
  server: McpServer,
  getJournal: ForReadingJournal,
): void {
  server.registerTool(
    "get_journal",
    {
      title: "Get Journal",
      description:
        "Returns the ordered snapshot series for a calendar. Same payload as GET /api/journal/:calendarId.",
      inputSchema: { calendarId: z.string().uuid() },
    },
    async (args) => {
      // safeParse at boundary — never throw on invalid input (SPEC §7, CR-02).
      // On failure, return descriptive error content; the MCP SDK inputSchema
      // validation catches most malformed args first, but safeParse here guards
      // the handler itself and collapses the prior double-parse (WR-01).
      const parsed = z.object({ calendarId: z.string().uuid() }).safeParse(args);
      if (!parsed.success) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "invalid calendarId" }) },
          ],
        };
      }
      const { calendarId } = parsed.data;
      const result = await getJournal(calendarId);
      if (!result.ok) {
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      if (result.value === null) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "not found" }),
            },
          ],
        };
      }
      // Serialise Date fields to ISO strings before parsing through the contract
      // (mirrors journalRoutes: row.time.toISOString() — MCP-02 same contract).
      const payload = journalResponse.parse({
        snapshots: result.value.map((row) => ({
          ...row,
          time: row.time instanceof Date ? row.time.toISOString() : row.time,
        })),
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    },
  );
}

/**
 * registerGetLiveGreeksTool — registers the get_live_greeks MCP tool.
 *
 * MCP-02: shares liveGreeksResponse schema with the live-greeks HTTP adapter.
 * Re-parses calendarId at boundary (same Pitfall 6 guard as get_journal).
 */
export function registerGetLiveGreeksTool(
  server: McpServer,
  getLiveGreeks: ForRunningGetLiveGreeks,
): void {
  server.registerTool(
    "get_live_greeks",
    {
      title: "Get Live Greeks",
      description:
        "Returns the latest BSM greeks for both legs of a calendar spread.",
      inputSchema: { calendarId: z.string().uuid() },
    },
    async (args) => {
      // safeParse at boundary — never throw on invalid input (SPEC §7, CR-02).
      const parsed = z.object({ calendarId: z.string().uuid() }).safeParse(args);
      if (!parsed.success) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "invalid calendarId" }) },
          ],
        };
      }
      const { calendarId } = parsed.data;
      const result = await getLiveGreeks(calendarId);
      if (!result.ok) {
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      const payload = liveGreeksResponse.parse(result.value);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    },
  );
}

/**
 * registerGetTermStructureTool — registers the get_term_structure MCP tool (ANLY-03 / MCP-02).
 *
 * Wired to the real getTermStructure use-case (06-04). Parses the response through the SAME
 * termStructureResponse schema as GET /api/analytics/term-structure — a one-sided field change
 * fails `bun run typecheck` (MCP-02 invariant).
 *
 * SPEC R5: returns a contract-valid EMPTY array (never an error) when there is no data.
 * T-06-09: optional calendarId is safeParsed at the boundary — never throws on bad input.
 */
export function registerGetTermStructureTool(
  server: McpServer,
  getTermStructure: ForRunningGetTermStructure,
): void {
  server.registerTool(
    "get_term_structure",
    {
      title: "Get Term Structure",
      description:
        "Returns the term-structure series (value = back_iv − front_iv per calendar). Same payload as GET /api/analytics/term-structure. Optional calendarId filter.",
      inputSchema: { calendarId: z.string().optional() },
    },
    async (args) => {
      // T-06-09: safeParse at boundary — never throw on invalid input.
      const parsed = z.object({ calendarId: z.string().optional() }).safeParse(args);
      if (!parsed.success) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "invalid params" }) },
          ],
        };
      }
      const query =
        parsed.data.calendarId === undefined ? {} : { calendarId: parsed.data.calendarId };

      const result = await getTermStructure(query);
      if (!result.ok) {
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      // Serialise Date → ISO before parsing through the SHARED contract (MCP-02).
      // Empty array on no data — never an error (SPEC R5).
      const payload = termStructureResponse.parse(
        result.value.map((row) => ({
          time:
            row.snapshotTime instanceof Date
              ? row.snapshotTime.toISOString()
              : row.snapshotTime,
          calendarId: row.calendarId,
          value: row.value,
        })),
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    },
  );
}

/**
 * registerGetSkewTool — registers the get_skew MCP tool.
 *
 * Typed-empty stub (SPEC §7): analytics compute lands in Phase 6.
 * Always returns {observations:[]} — NO use-case call, NO result.ok branch.
 * Never an error.
 */
export function registerGetSkewTool(server: McpServer): void {
  server.registerTool(
    "get_skew",
    {
      title: "Get Skew",
      description:
        "Returns skew observations. Returns empty {observations:[]} until Phase 6 analytics land.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ observations: [] }),
        },
      ],
    }),
  );
}

/**
 * registerGetPositionsTool — registers the get_positions MCP tool (BRK-02).
 *
 * MCP-02: shares positionsResponse schema with GET /api/positions HTTP route.
 * D-09: AUTH_EXPIRED → paused payload (same shape as HTTP route).
 */
export function registerGetPositionsTool(
  server: McpServer,
  getPositions: ForGettingPositions,
): void {
  server.registerTool(
    "get_positions",
    {
      title: "Get Positions",
      description:
        "Returns current Schwab trader positions. Returns a paused payload when the trader app token is AUTH_EXPIRED.",
      inputSchema: {},
    },
    async () => {
      const result = await getPositions();
      if (!result.ok) {
        if (result.error.kind === "auth-expired") {
          const payload = brokerageAuthExpiredPayload.parse({ paused: true, reason: "AUTH_EXPIRED" });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload) }],
          };
        }
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      const payload = positionsResponse.parse({ positions: result.value });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    },
  );
}

/**
 * registerGetTransactionsTool — registers the get_transactions MCP tool (BRK-02).
 *
 * MCP-02: shares transactionsResponse schema with GET /api/transactions HTTP route.
 * D-09: AUTH_EXPIRED → paused payload.
 */
export function registerGetTransactionsTool(
  server: McpServer,
  getTransactions: ForGettingTransactions,
): void {
  server.registerTool(
    "get_transactions",
    {
      title: "Get Transactions",
      description:
        "Returns Schwab trader transactions. Accepts optional from/to date parameters (YYYY-MM-DD). Defaults to last 90 days.",
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
      },
    },
    async (args) => {
      // safeParse at boundary — never throw on invalid input
      const parsed = z.object({ from: z.string().optional(), to: z.string().optional() }).safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "invalid params" }) }],
        };
      }

      const today = new Date();
      const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
      const from = parsed.data.from ?? ninetyDaysAgo.toISOString().slice(0, 10);
      const to = parsed.data.to ?? today.toISOString().slice(0, 10);

      const result = await getTransactions(from, to);
      if (!result.ok) {
        if (result.error.kind === "auth-expired") {
          const payload = brokerageAuthExpiredPayload.parse({ paused: true, reason: "AUTH_EXPIRED" });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload) }],
          };
        }
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      const payload = transactionsResponse.parse({ transactions: result.value });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    },
  );
}

/**
 * registerGetOrdersTool — registers the get_orders MCP tool (BRK-02, read-only).
 *
 * MCP-02: shares ordersResponse schema with GET /api/orders HTTP route.
 * D-09: AUTH_EXPIRED → paused payload.
 * T-04-22: read-only — no order placement.
 */
export function registerGetOrdersTool(
  server: McpServer,
  getOrders: ForGettingOrders,
): void {
  server.registerTool(
    "get_orders",
    {
      title: "Get Orders",
      description:
        "Returns current Schwab trader orders (read-only). Returns a paused payload when the trader app token is AUTH_EXPIRED.",
      inputSchema: {},
    },
    async () => {
      const result = await getOrders();
      if (!result.ok) {
        if (result.error.kind === "auth-expired") {
          const payload = brokerageAuthExpiredPayload.parse({ paused: true, reason: "AUTH_EXPIRED" });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload) }],
          };
        }
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      const payload = ordersResponse.parse({ orders: result.value });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    },
  );
}
