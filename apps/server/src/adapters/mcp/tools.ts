import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  statusResponse,
  listCalendarsResponse,
  journalResponse,
  liveGreeksResponse,
} from "@morai/contracts";
import type {
  ForGettingStatus,
  ForListingCalendars,
  ForReadingJournal,
  ForRunningGetLiveGreeks,
} from "@morai/core";

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
      // Re-parse at boundary (thin-adapter rule + typescript.md parse-don't-cast):
      // exactOptionalPropertyTypes requires args are re-parsed to narrow the type safely.
      const { calendarId } = z
        .object({ calendarId: z.string().uuid() })
        .parse(args);
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
      // Re-parse at boundary (RESEARCH.md §Focus Area 2, Pitfall 6):
      const { calendarId } = z
        .object({ calendarId: z.string().uuid() })
        .parse(args);
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
 * registerGetTermStructureTool — registers the get_term_structure MCP tool.
 *
 * Typed-empty stub (SPEC §7): analytics compute lands in Phase 6.
 * Always returns {observations:[]} — NO use-case call, NO result.ok branch.
 * Never an error.
 */
export function registerGetTermStructureTool(server: McpServer): void {
  server.registerTool(
    "get_term_structure",
    {
      title: "Get Term Structure",
      description:
        "Returns term structure observations. Returns empty {observations:[]} until Phase 6 analytics land.",
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
