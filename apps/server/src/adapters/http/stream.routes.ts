/**
 * stream.routes.ts — SSE streaming routes factory
 *
 * Three routes (route placement enforced in main.ts — Pitfall 7):
 *
 *   POST /api/stream/ticket   — INSIDE authReadGroup (Supabase JWT required)
 *     Reads jwtPayload.sub (userId), mints a short-lived single-use opaque ticket,
 *     returns streamTicketResponse ({ ticket: uuid }). D-01.
 *
 *   POST /api/stream/subscribe — INSIDE authReadGroup (Supabase JWT required)
 *     Validates { symbol } body via parseOccSymbol → 400 on bad format (no sidecar call).
 *     Proxies to POST {sidecarUrl}/sidecar/subscribe with { symbol }.
 *     Maps: sidecar 200 → 200 { subscribed, evicted }; 503 → 503 AUTH_EXPIRED;
 *     other/transport → 502 SidecarUnavailable. D-05, SC6.
 *
 *   GET /api/stream           — OUTSIDE authReadGroup (EventSource cannot send JWT headers)
 *     Validates ?ticket= via redeemTicket → 401 on missing/invalid/expired/reused.
 *     On success: opens SSE, registers client in fan-out, sends STRM-05 reconcile event
 *     FIRST (before any live ticks), then a 30-second ping loop until abort.
 *
 * Architecture: thin driving adapter — no business logic. Pattern: validate → call port →
 * map result → respond. No Postgres access anywhere (STRM-04).
 *
 * D-01: JWT never appears in query params — only the opaque ticket (no logs/history leak).
 * T-12-05-01: redeemTicket enforces single-use + 30s TTL.
 * T-12-05-03: POST /api/stream/ticket is inside JWT group → only authed users can mint.
 * T-12-05-06: POST /api/stream/subscribe is inside JWT group → unauthenticated callers
 *             are rejected by the group before reaching the sidecar subscribe proxy.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { JWTPayload } from "jose";
import { parseOccSymbol } from "@morai/shared";
import {
  streamTicketResponse,
  streamReconcileEvent,
  streamPingEvent,
} from "@morai/contracts";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForReconcilingPositions } from "@morai/core";
import { mintTicket, redeemTicket } from "./ticket-store.ts";
import { registerClient, unregisterClient } from "./stream-fan-out.ts";
import type { SSEClient } from "./stream-fan-out.ts";

// ─── Hono env type ────────────────────────────────────────────────────────────

/**
 * JwtEnv — typed Hono Variables for context variables set by makeSupabaseJwtAuth.
 * Exported so stream.routes.test.ts can create a typed app with the same Variables.
 */
export type JwtEnv = {
  Variables: {
    jwtPayload: JWTPayload;
  };
};

// ─── Dependency types ─────────────────────────────────────────────────────────

/**
 * Body schema for POST /api/stream/subscribe.
 * Validated BEFORE the OCC symbol parse (Zod-first boundary).
 */
const subscribeBodySchema = z.object({ symbol: z.string() });

/**
 * StreamRouteDeps — injected dependencies for all three routes.
 *
 * @param reconcilePositions - ForReconcilingPositions for STRM-05 cold-start reconcile.
 *   The in-memory twin is used in tests; the sidecar adapter is used in production.
 * @param sidecarUrl         - Base URL of the sidecar service (e.g. http://sidecar.internal:8000).
 *   Used by the GET /api/stream SSE consumer (via connectToSidecarStream in main.ts)
 *   and by the POST /api/stream/subscribe proxy.
 * @param fetch              - Injectable fetch for the subscribe proxy. Defaults to
 *   globalThis.fetch in production; tests inject a fake. NEVER use globalThis.fetch
 *   inside the adapter — always use deps.fetch to keep the test double effective.
 */
export type StreamRouteDeps = {
  readonly reconcilePositions: ForReconcilingPositions;
  readonly sidecarUrl: string;
  readonly fetch?: typeof globalThis.fetch;
};

// ─── Route factory ────────────────────────────────────────────────────────────

/**
 * streamRoutes — Hono factory returning ALL THREE streaming routes.
 *
 * Route placement (Pitfall 7 — CRITICAL — enforced in main.ts):
 *   - POST /api/stream/ticket   → mount INSIDE authReadGroup
 *   - POST /api/stream/subscribe → mount INSIDE authReadGroup
 *   - GET /api/stream           → mount OUTSIDE authReadGroup
 *
 * In main.ts, use this factory INSIDE authReadGroup (for the two JWT-gated POSTs),
 * and use makeStreamSseRouter() OUTSIDE authReadGroup (for the ticket-gated GET).
 * This split is required because Hono's routing is first-match-wins: if streamRoutes
 * were mounted outside authReadGroup, POST requests would also match there first and
 * find no jwtPayload, returning 401 even for authenticated users.
 *
 * Tests: see stream.routes.test.ts — uses a fake auth middleware to simulate the
 * JWT group for the ticket and subscribe routes.
 */
export function streamRoutes(deps: StreamRouteDeps) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const router = new Hono<JwtEnv>();

  // ─── POST /api/stream/ticket ───────────────────────────────────────────────
  // Must be mounted INSIDE authReadGroup (main.ts). jwtPayload is set by the
  // Supabase JWT middleware before this handler runs.
  //
  // T-12-05-03: only authenticated users (JWT verified) can mint tickets.
  // D-01: the issued ticket is opaque — no claim, no secret, just a UUID.

  router.post("/stream/ticket", async (c) => {
    const payload = c.var.jwtPayload;
    const userId = payload.sub;
    if (userId === undefined || userId === "") {
      // Should never happen when mounted correctly (authReadGroup ensures JWT is valid),
      // but guard defensively in case of misconfiguration.
      return c.json({ error: "Unauthorized" }, 401);
    }

    const ticket = mintTicket(userId);
    return c.json(streamTicketResponse.parse({ ticket }));
  });

  // ─── POST /api/stream/subscribe ────────────────────────────────────────────
  // Must be mounted INSIDE authReadGroup (main.ts). D-05, SC6 server hop.
  //
  // T-12-05-06: mounted inside JWT group — unauthenticated callers are rejected
  // before reaching this handler.
  //
  // Flow: Zod-parse body → OCC-validate symbol → fetch sidecar → map response.
  // No SSE is opened here; the route is a fire-and-relay mutation.

  router.post("/stream/subscribe", async (c) => {
    // 1. Parse body { symbol: string }
    let body: { symbol: string };
    try {
      const rawBody: unknown = await c.req.json();
      const parsed = subscribeBodySchema.safeParse(rawBody);
      if (!parsed.success) {
        return c.json({ error: "InvalidSymbol" }, 400);
      }
      body = parsed.data;
    } catch {
      return c.json({ error: "InvalidSymbol" }, 400);
    }

    // 2. Validate OCC symbol format (defence-in-depth before broker boundary)
    const occResult = parseOccSymbol(body.symbol);
    if (!occResult.ok) {
      return c.json({ error: "InvalidSymbol" }, 400);
    }

    // 3. Proxy to sidecar — no any/as/!; map sidecar status codes
    let sidecarResp: Response;
    try {
      sidecarResp = await fetchFn(
        `${deps.sidecarUrl}/sidecar/subscribe`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: body.symbol }),
        },
      );
    } catch (e) {
      // Transport error (connection refused, DNS failure, etc.)
      // Log type only — never log error message or token values (T-12-05-06)
      const errName = e instanceof Error ? e.constructor.name : "UnknownError";
      console.error(
        `stream/subscribe: sidecar fetch failed — ${errName} (message redacted)`,
      );
      return c.json({ error: "SidecarUnavailable" }, 502);
    }

    if (sidecarResp.status === 200) {
      // Pass through the sidecar's { subscribed, evicted } response
      const sidecarBody: unknown = await sidecarResp.json();
      return c.json(sidecarBody);
    }

    if (sidecarResp.status === 503) {
      return c.json({ error: "AUTH_EXPIRED" }, 503);
    }

    // Any other non-200/non-503 response → 502 SidecarUnavailable
    // Log type only — never leak sidecar response body to the browser
    console.error(
      `stream/subscribe: sidecar returned ${sidecarResp.status} (body redacted)`,
    );
    return c.json({ error: "SidecarUnavailable" }, 502);
  });

  // ─── GET /api/stream ───────────────────────────────────────────────────────
  // Must be mounted OUTSIDE authReadGroup (main.ts). Pitfall 7.
  //
  // EventSource cannot send Authorization headers, so auth is via a short-lived
  // single-use opaque ticket (D-01). The ticket was minted by POST /api/stream/ticket
  // with a valid Supabase JWT. The ticket carries no claim — just a UUID bound to a userId.
  //
  // T-12-05-01: redeemTicket enforces: UUID exists + not used + not expired.
  // T-12-05-02: the JWT never appears in query params (no logs/history leak).
  // STRM-05: reconcile event is sent FIRST — browser always has a cold-start baseline.

  router.get("/stream", async (c) => {
    const rawTicket = c.req.query("ticket") ?? "";
    const userId = redeemTicket(rawTicket);
    if (userId === null) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return streamSSE(
      c,
      async (stream) => {
        // Register with the fan-out hub. The structural SSEClient type in stream-fan-out.ts
        // matches SSEStreamingApi (writeSSE + aborted + onAbort) — no cast needed.
        const sseClient: SSEClient = stream;
        registerClient(sseClient);

        // Clean-disconnect path: onAbort fires when the EventSource closes cleanly.
        stream.onAbort(() => {
          unregisterClient(sseClient);
        });

        // STRM-05: reconcile-first — send current positions BEFORE any live ticks.
        // Graceful degradation: if the sidecar reconcile fails, send empty positions
        // so the stream still opens (the browser shows "stale" badge per D-04).
        const posResult = await deps.reconcilePositions();
        const positions = posResult.ok ? Array.from(posResult.value) : [];
        const asOf = new Date().toISOString();
        await stream.writeSSE({
          event: "reconcile",
          data: JSON.stringify(streamReconcileEvent.parse({ positions, asOf })),
        });

        // WR-01: emit one isRth ping IMMEDIATELY after reconcile. The reconcile event
        // carries no isRth, so without this the client's isRth stays null for the full
        // first 30s and the badge wrongly renders "QUIET / Market closed" during RTH at
        // connect. The 30s loop below then keeps it fresh.
        if (!stream.aborted) {
          const nowAtConnect = new Date();
          await stream.writeSSE({
            event: "ping",
            data: JSON.stringify(
              streamPingEvent.parse({
                isRth: isWithinRth(nowAtConnect) && !isNyseHoliday(nowAtConnect),
              }),
            ),
          });
        }

        // Keep-alive ping loop — sends a no-op "ping" every 30 seconds until abort.
        // The browser EventSource does NOT need to handle pings; they prevent
        // Railway / nginx from closing idle connections.
        while (!stream.aborted) {
          await stream.sleep(30_000);
          if (!stream.aborted) {
            const now = new Date();
            await stream.writeSSE({
              event: "ping",
              data: JSON.stringify(
                streamPingEvent.parse({
                  isRth: isWithinRth(now) && !isNyseHoliday(now),
                }),
              ),
            });
          }
        }

        // Dead-connection path: also unregister after the loop exits (covers cases
        // where onAbort did not fire, e.g. a broken TCP without RST — Pitfall 6).
        unregisterClient(sseClient);
      },
      async (err, stream) => {
        // onError: log type only, unregister, do NOT re-throw (prevents 500 leaking).
        const errName = err instanceof Error ? err.constructor.name : "UnknownError";
        console.error(
          `GET /api/stream SSE error: ${errName} (message redacted — user: ${userId})`,
        );
        const sseClient: SSEClient = stream;
        unregisterClient(sseClient);
      },
    );
  });

  return router;
}

/**
 * makeStreamSseRouter — GET /stream only, for mounting OUTSIDE authReadGroup.
 *
 * Pitfall 7 (CRITICAL): Hono routing is first-match-wins per method. If the full
 * streamRoutes() factory were mounted on app (outside JWT group), POST requests to
 * /stream/ticket and /stream/subscribe would also match there first — before the
 * JWT middleware inside authReadGroup could set jwtPayload. Those handlers would
 * always return 401 (missing sub), even for authenticated users.
 *
 * Solution: split at the mount level in main.ts:
 *   app.route("/api", makeStreamSseRouter(deps));        // GET only, outside JWT
 *   authReadGroup.route("/", streamRoutes(deps));         // all three, inside JWT
 *
 * GET /api/stream matches the outer router (no JWT needed — ticket auth only).
 * POST /api/stream/ticket and POST /api/stream/subscribe do NOT match here (different
 * method/path), so they fall through to the authReadGroup mount where JWT runs first.
 */
export function makeStreamSseRouter(deps: StreamRouteDeps) {
  const router = new Hono<JwtEnv>();

  // GET /stream — identical handler to the one registered in streamRoutes().
  // Kept in sync manually; no shared closure to avoid coupling the two factories.
  router.get("/stream", async (c) => {
    const rawTicket = c.req.query("ticket") ?? "";
    const userId = redeemTicket(rawTicket);
    if (userId === null) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return streamSSE(
      c,
      async (stream) => {
        const sseClient: SSEClient = stream;
        registerClient(sseClient);
        stream.onAbort(() => {
          unregisterClient(sseClient);
        });

        // STRM-05: reconcile-first.
        const posResult = await deps.reconcilePositions();
        const positions = posResult.ok ? Array.from(posResult.value) : [];
        const asOf = new Date().toISOString();
        await stream.writeSSE({
          event: "reconcile",
          data: JSON.stringify(streamReconcileEvent.parse({ positions, asOf })),
        });

        // WR-01: emit one isRth ping IMMEDIATELY after reconcile so the badge reflects
        // true market state at connect instead of QUIET for up to 30s (kept in sync with
        // streamRoutes above).
        if (!stream.aborted) {
          const nowAtConnect = new Date();
          await stream.writeSSE({
            event: "ping",
            data: JSON.stringify(
              streamPingEvent.parse({
                isRth: isWithinRth(nowAtConnect) && !isNyseHoliday(nowAtConnect),
              }),
            ),
          });
        }

        while (!stream.aborted) {
          await stream.sleep(30_000);
          if (!stream.aborted) {
            const now = new Date();
            await stream.writeSSE({
              event: "ping",
              data: JSON.stringify(
                streamPingEvent.parse({
                  isRth: isWithinRth(now) && !isNyseHoliday(now),
                }),
              ),
            });
          }
        }

        unregisterClient(sseClient);
      },
      async (err, stream) => {
        const errName = err instanceof Error ? err.constructor.name : "UnknownError";
        console.error(
          `GET /api/stream SSE error: ${errName} (message redacted — user: ${userId})`,
        );
        const sseClient: SSEClient = stream;
        unregisterClient(sseClient);
      },
    );
  });

  return router;
}
