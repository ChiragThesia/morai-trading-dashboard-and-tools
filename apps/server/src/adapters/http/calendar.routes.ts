import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  registerCalendarRequest,
  calendarResponse,
  listCalendarsResponse,
  closeCalendarRequest,
} from "@morai/contracts";
import type {
  ForRunningRegisterCalendar,
  ForListingCalendars,
  ForClosingCalendar,
} from "@morai/core";

/**
 * calendarRoutes — factory returning a Hono router for calendar CRUD endpoints.
 *
 * Architecture law: zero business logic here. Pattern is:
 *   Zod-parse input → call use-case → map Result → parse through contract schema → respond.
 *
 * Threat mitigations:
 *   T-03-04: registerCalendarRequest Zod-validates optionType/strike/expiries
 *   T-03-05: malformed :id → Drizzle parameterized query returns not-found 404
 *   T-03-06: errors mapped to flat {error:"..."} strings — no stack traces returned
 *
 * MCP-02: calendarResponse + listCalendarsResponse reused by list_calendars MCP tool (plan 07).
 */
export function calendarRoutes(
  registerCalendar: ForRunningRegisterCalendar,
  listCalendars: ForListingCalendars,
  closeCalendar: ForClosingCalendar,
) {
  const router = new Hono();

  // POST /api/calendars — register a new calendar spread
  router.post(
    "/calendars",
    zValidator("json", registerCalendarRequest),
    async (c) => {
      const body = c.req.valid("json");
      // exactOptionalPropertyTypes: build input without openedAt key when absent
      const input: Parameters<ForRunningRegisterCalendar>[0] = {
        underlying: body.underlying,
        strike: body.strike,
        optionType: body.optionType,
        frontExpiry: body.frontExpiry,
        backExpiry: body.backExpiry,
        qty: body.qty,
        openNetDebit: body.openNetDebit,
        ...(body.openedAt !== undefined ? { openedAt: new Date(body.openedAt) } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      };
      const result = await registerCalendar(input);
      if (!result.ok) {
        if (result.error.kind === "validation-error") {
          return c.json({ error: result.error.message }, 400);
        }
        return c.json({ error: "internal" }, 500);
      }
      const cal = result.value;
      return c.json(
        calendarResponse.parse({
          ...cal,
          openedAt: cal.openedAt.toISOString(),
          closedAt: cal.closedAt !== null ? cal.closedAt.toISOString() : null,
        }),
        201,
      );
    },
  );

  // GET /api/calendars — list calendars (optional ?status filter)
  router.get("/calendars", async (c) => {
    const statusParam = c.req.query("status");
    const filter =
      statusParam === "open" || statusParam === "closed"
        ? statusParam
        : undefined;
    const result = await listCalendars(filter);
    if (!result.ok) {
      return c.json({ error: "internal" }, 500);
    }
    return c.json(
      listCalendarsResponse.parse({
        calendars: result.value.map((cal) => ({
          ...cal,
          openedAt: cal.openedAt.toISOString(),
          closedAt: cal.closedAt !== null ? cal.closedAt.toISOString() : null,
        })),
      }),
    );
  });

  // POST /api/calendars/:id/close — close an open calendar
  router.post(
    "/calendars/:id/close",
    zValidator("json", closeCalendarRequest),
    async (c) => {
      const id = c.req.param("id");
      const { closeNetCredit } = c.req.valid("json");
      const result = await closeCalendar(id, closeNetCredit);
      if (!result.ok) {
        if (result.error.kind === "not-found") {
          return c.json({ error: "not found" }, 404);
        }
        if (result.error.kind === "already-closed") {
          return c.json({ error: "already closed" }, 409);
        }
        return c.json({ error: "internal" }, 500);
      }
      const cal = result.value;
      return c.json(
        calendarResponse.parse({
          ...cal,
          openedAt: cal.openedAt.toISOString(),
          closedAt: cal.closedAt !== null ? cal.closedAt.toISOString() : null,
        }),
      );
    },
  );

  return router;
}
