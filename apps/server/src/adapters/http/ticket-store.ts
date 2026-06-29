/**
 * ticket-store.ts — Opaque single-use ticket store (D-01, STRM-03)
 *
 * Mints a short-lived, single-use UUID ticket bound to a userId.
 * The TicketRecord holds ONLY {userId, exp, used} — NO JWT, secret, or extractable
 * claim (T-12-04-02). The ticket string itself is an opaque random UUID.
 *
 * D-01: Enables header-less EventSource auth. Client POSTs with Supabase JWT to
 *       POST /api/stream/ticket → receives ticket; EventSource connects with
 *       GET /api/stream?ticket=... (no Authorization header possible on EventSource).
 *
 * Security:
 *   T-12-04-01: crypto.randomUUID (unguessable) + single-use + 30s TTL; replay → null.
 *   T-12-04-02: opaque record — no JWT/secret/claim stored; only userId + exp + used.
 *
 * STRM-04: No Postgres/Drizzle import — in-memory only (single Railway instance per D11).
 *
 * Clock injection (now: NowFn) makes TTL expiry deterministic in tests without real timers.
 */

export type TicketRecord = {
  readonly userId: string;
  exp: number;
  used: boolean;
};

const ticketStore = new Map<string, TicketRecord>();

type NowFn = () => number;

/**
 * mintTicket — issues a new opaque UUID ticket bound to userId with a 30-second TTL.
 *
 * Multiple tickets per userId are allowed; each has a distinct UUID.
 * The ticket carries no secret — it is opaque, short-lived, and single-use.
 */
export function mintTicket(userId: string, now: NowFn = Date.now): string {
  const ticket = crypto.randomUUID();
  ticketStore.set(ticket, { userId, exp: now() + 30_000, used: false });
  return ticket;
}

/**
 * redeemTicket — validates and consumes the ticket, returning the bound userId exactly once.
 *
 * Returns null for:
 *   - Unknown ticket (never issued, or already cleaned up after use/expiry)
 *   - Already-used ticket (replay defence — T-12-04-01 single-use invariant)
 *   - Expired ticket (past the 30s TTL — T-12-04-01)
 *
 * Lazy cleanup: the record is deleted from the Map on any null return (used or expired)
 * and on the successful redemption (prevents any reuse of the same ticket).
 *
 * Single-use proof: mark-used then delete. Even if somehow called concurrently
 * (impossible in single-threaded JS), the used=true check on the same object would
 * block a second redemption before the delete completes.
 */
export function redeemTicket(ticket: string, now: NowFn = Date.now): string | null {
  const record = ticketStore.get(ticket);
  if (record === undefined) return null;

  if (record.used || now() > record.exp) {
    ticketStore.delete(ticket);
    return null;
  }

  record.used = true;
  ticketStore.delete(ticket);
  return record.userId;
}
