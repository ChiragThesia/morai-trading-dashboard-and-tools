/**
 * journal-oracle.test.ts — real-transaction regression suite
 * (journal-pnl-opennetdebit-units, round 4).
 *
 * TDD RED (this test, run against the pre-fix code): FAILS, reproducing the exact prod
 * regression documented in .planning/debug/journal-pnl-ground-truth.md —
 *   - 65aac62e (registered "open"): openNetDebit comes out ≈ -4 (32.35 open − 36.35 close
 *     folded together), because ALL its fills (both the real open order and the real close
 *     order) get classified OPEN — the calendar's current `status` column is "open".
 *   - 9eef2153 / e8bfbf41 (registered "closed"): openNetDebit comes out ≈ 0, because ALL
 *     their fills get classified CLOSE — the calendar's `status` column is "closed".
 *
 * Root cause: `readCalendarLegs` derived each matched fill's OPEN/CLOSE classification from
 * the CALENDAR's current (mutable, often-stale) `status` column, not from the fill's OWN
 * broker-reported positionEffect (BrokerTransaction.legs[].positionEffect — real, per-fill,
 * and already correctly parsed by the Schwab adapter, but previously DROPPED by
 * syncTransactions.ts's flattenTransaction instead of carried onto RawFill).
 *
 * Fixtures are built from REAL Schwab orders (scratchpad/txns.json, the authoritative signed
 * netAmount cash flows) for 5 real calendars, cross-checked against
 * .planning/debug/journal-pnl-ground-truth.md (the user-confirmed oracle). Expected values
 * here are computed fee-free (avgPrice × qty, the exact convention syncFills.ts uses — it
 * never reads the broker's raw netAmount, which bakes in a small ~$1.22/leg fee) — the oracle
 * itself documents this: "65aac62e openNetDebit ≈ 32.37 not the fee-free 32.35" (ground-truth
 * doc, per-row asterisk note). Tolerance below is cents-level, not the oracle's fee-inclusive
 * figure.
 *
 * The 65aac62e↔9eef2153/e8bfbf41 split deliberately covers BOTH directions of the bug
 * (calendar registered "open" vs "closed") so the fix is proven independent of `status`
 * entirely — the exact invariant that regressed.
 *
 * The 60c46a57 ↔ 24f1e72e pair share one broker order (1006797510202) that closes one
 * calendar (60c46a57, 7425P Jul8/Jul31) and opens an ENTIRELY DIFFERENT calendar (24f1e72e,
 * 7475P Jul9/Jul31 — a different strike). Since `detectRoll` requires the SAME calendarId
 * (D-03), this is NOT a domain ROLL event — it is two independent calendars' ordinary
 * CLOSE/OPEN events sharing one multi-leg broker order. This test proves no spurious ROLL
 * event is fabricated across the two calendars, and both calendars' openNetDebit/
 * closeNetCredit are correct in isolation.
 */

import { describe, it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { formatOccSymbol } from "@morai/shared";
import type { OccSymbol } from "@morai/shared";
import {
  makeSyncTransactionsUseCase,
  makeSyncFillsUseCase,
  hashFillIds,
} from "@morai/core";
import type { BrokerTransaction, ForFetchingTransactions } from "@morai/core";
import {
  makeMemoryFillsRepo,
  makeMemoryCalendarEventsRepo,
  makeMemoryOrphanFillsRepo,
} from "@morai/adapters";

// ─── Deterministic injected id/hash adapters (mirrors journal-e2e.test.ts) ────────
const sha256Hex = (input: string): string =>
  createHash("sha256").update(input).digest("hex");
const newId = (): string => randomUUID();
const hashIds = (ids: ReadonlyArray<string>): string => hashFillIds(ids, sha256Hex);

// ─── Real calendar leg symbols (SPXW, real strikes/expiries from txns.json) ────────
function leg(expiry: string, strike: number): OccSymbol {
  return formatOccSymbol({
    root: "SPXW",
    expiry: new Date(expiry + "T12:00:00Z"),
    type: "P",
    strike,
  });
}

const CAL_65AAC62E = "65aac62e-0000-4000-8000-000000000001"; // 7425P Aug7/Aug31
const CAL_9EEF2153 = "9eef2153-0000-4000-8000-000000000002"; // 7100P May15/Jun8
const CAL_E8BFBF41 = "e8bfbf41-0000-4000-8000-000000000003"; // 7175P May22/Jun15
const CAL_60C46A57 = "60c46a57-0000-4000-8000-000000000004"; // 7425P Jul8/Jul31
const CAL_24F1E72E = "24f1e72e-0000-4000-8000-000000000005"; // 7475P Jul9/Jul31

// Real Schwab orders (activityId/orderId/legs verbatim from scratchpad/txns.json).
function realTransactions(): ReadonlyArray<BrokerTransaction> {
  return [
    // ─── 65aac62e: OPEN (Jun 22, order 1006855414174) ──────────────────────────
    {
      activityId: 122750578406,
      tradeDate: "2026-06-22",
      netAmount: -15942.22,
      orderId: 1006855414174,
      legs: [
        { occSymbol: leg("2026-08-31", 7425), qty: 1, price: 159.41, positionEffect: "OPENING", side: "buy" },
      ],
    },
    {
      activityId: 122750578407,
      tradeDate: "2026-06-22",
      netAmount: 12704.78,
      orderId: 1006855414174,
      legs: [
        { occSymbol: leg("2026-08-07", 7425), qty: 1, price: 127.06, positionEffect: "OPENING", side: "sell" },
      ],
    },
    // ─── 65aac62e: CLOSE (Jul 1, order 1006990704540) ──────────────────────────
    {
      activityId: 123817421801,
      tradeDate: "2026-07-01",
      netAmount: 12311.78,
      orderId: 1006990704540,
      legs: [
        { occSymbol: leg("2026-08-31", 7425), qty: 1, price: 123.13, positionEffect: "CLOSING", side: "sell" },
      ],
    },
    {
      activityId: 123817421802,
      tradeDate: "2026-07-01",
      netAmount: -8679.22,
      orderId: 1006990704540,
      legs: [
        { occSymbol: leg("2026-08-07", 7425), qty: 1, price: 86.78, positionEffect: "CLOSING", side: "buy" },
      ],
    },
    // ─── 9eef2153: OPEN (Apr 24, order 1006130670569) ──────────────────────────
    {
      activityId: 117481087023,
      tradeDate: "2026-04-24",
      netAmount: 8152.78,
      orderId: 1006130670569,
      legs: [
        { occSymbol: leg("2026-05-15", 7100), qty: 1, price: 81.54, positionEffect: "OPENING", side: "sell" },
      ],
    },
    {
      activityId: 117481087024,
      tradeDate: "2026-04-24",
      netAmount: -12440.22,
      orderId: 1006130670569,
      legs: [
        { occSymbol: leg("2026-06-08", 7100), qty: 1, price: 124.39, positionEffect: "OPENING", side: "buy" },
      ],
    },
    // ─── 9eef2153: CLOSE (Apr 30, order 1006198637052) ─────────────────────────
    {
      activityId: 117972611805,
      tradeDate: "2026-04-30",
      netAmount: 9173.78,
      orderId: 1006198637052,
      legs: [
        { occSymbol: leg("2026-06-08", 7100), qty: 1, price: 91.75, positionEffect: "CLOSING", side: "sell" },
      ],
    },
    {
      activityId: 117972611806,
      tradeDate: "2026-04-30",
      netAmount: -4516.22,
      orderId: 1006198637052,
      legs: [
        { occSymbol: leg("2026-05-15", 7100), qty: 1, price: 45.15, positionEffect: "CLOSING", side: "buy" },
      ],
    },
    // ─── e8bfbf41: OPEN (May 1, order 1006216919920) ───────────────────────────
    {
      activityId: 118109354846,
      tradeDate: "2026-05-01",
      netAmount: -11513.22,
      orderId: 1006216919920,
      legs: [
        { occSymbol: leg("2026-06-15", 7175), qty: 1, price: 115.12, positionEffect: "OPENING", side: "buy" },
      ],
    },
    {
      activityId: 118109354847,
      tradeDate: "2026-05-01",
      netAmount: 7050.78,
      orderId: 1006216919920,
      legs: [
        { occSymbol: leg("2026-05-22", 7175), qty: 1, price: 70.52, positionEffect: "OPENING", side: "sell" },
      ],
    },
    // ─── e8bfbf41: CLOSE (May 6, order 1006265261970) ──────────────────────────
    {
      activityId: 118465600052,
      tradeDate: "2026-05-06",
      netAmount: 7543.78,
      orderId: 1006265261970,
      legs: [
        { occSymbol: leg("2026-06-15", 7175), qty: 1, price: 75.45, positionEffect: "CLOSING", side: "sell" },
      ],
    },
    {
      activityId: 118465600053,
      tradeDate: "2026-05-06",
      netAmount: -3166.22,
      orderId: 1006265261970,
      legs: [
        { occSymbol: leg("2026-05-22", 7175), qty: 1, price: 31.65, positionEffect: "CLOSING", side: "buy" },
      ],
    },
    // ─── 60c46a57: OPEN (Jun 15, order 1006755504464) ──────────────────────────
    {
      activityId: 122032396593,
      tradeDate: "2026-06-15",
      netAmount: -9661.22,
      orderId: 1006755504464,
      legs: [
        { occSymbol: leg("2026-07-31", 7425), qty: 1, price: 96.6, positionEffect: "OPENING", side: "buy" },
      ],
    },
    {
      activityId: 122032396594,
      tradeDate: "2026-06-15",
      netAmount: 5238.78,
      orderId: 1006755504464,
      legs: [
        { occSymbol: leg("2026-07-08", 7425), qty: 1, price: 52.4, positionEffect: "OPENING", side: "sell" },
      ],
    },
    // ─── order 1006797510202 (Jun 17): closes 60c46a57 AND opens 24f1e72e ──────
    // Different strikes (7425 → 7475) ⇒ different calendars ⇒ NOT a domain ROLL (D-03
    // requires same calendarId). Two ordinary CLOSE fills + two ordinary OPEN fills.
    {
      activityId: 122337256198,
      tradeDate: "2026-06-17",
      netAmount: -5971.22,
      orderId: 1006797510202,
      legs: [
        { occSymbol: leg("2026-07-08", 7425), qty: 1, price: 59.7, positionEffect: "CLOSING", side: "buy" },
      ],
    },
    {
      activityId: 122337256196,
      tradeDate: "2026-06-17",
      netAmount: 10290.78,
      orderId: 1006797510202,
      legs: [
        { occSymbol: leg("2026-07-31", 7425), qty: 1, price: 102.92, positionEffect: "CLOSING", side: "sell" },
      ],
    },
    {
      activityId: 122337256195,
      tradeDate: "2026-06-17",
      netAmount: -11785.22,
      orderId: 1006797510202,
      legs: [
        { occSymbol: leg("2026-07-31", 7475), qty: 1, price: 117.84, positionEffect: "OPENING", side: "buy" },
      ],
    },
    {
      activityId: 122337256197,
      tradeDate: "2026-06-17",
      netAmount: 7630.78,
      orderId: 1006797510202,
      legs: [
        { occSymbol: leg("2026-07-09", 7475), qty: 1, price: 76.32, positionEffect: "OPENING", side: "sell" },
      ],
    },
    // ─── 24f1e72e: CLOSE (Jun 18, order 1006830552432) ─────────────────────────
    {
      activityId: 122571604017,
      tradeDate: "2026-06-18",
      netAmount: -7987.22,
      orderId: 1006830552432,
      legs: [
        { occSymbol: leg("2026-07-09", 7475), qty: 1, price: 79.86, positionEffect: "CLOSING", side: "buy" },
      ],
    },
    {
      activityId: 122571604018,
      tradeDate: "2026-06-18",
      netAmount: 12484.78,
      orderId: 1006830552432,
      legs: [
        { occSymbol: leg("2026-07-31", 7475), qty: 1, price: 124.86, positionEffect: "CLOSING", side: "sell" },
      ],
    },
  ];
}

const fetchTransactions: ForFetchingTransactions = async () => ({
  ok: true as const,
  value: realTransactions(),
});

describe("journal oracle — real-transaction openNetDebit/closeNetCredit regression (round 4)", () => {
  it("recomputes openNetDebit/closeNetCredit correctly for all 5 real calendars, independent of registered status", async () => {
    const fillsRepo = makeMemoryFillsRepo();
    const eventsRepo = makeMemoryCalendarEventsRepo();
    const orphansRepo = makeMemoryOrphanFillsRepo();

    // 65aac62e registered "open" (the real prod bug: truly closed, but never transitioned) —
    // proves the fix does not depend on status to correctly classify its CLOSE fills.
    fillsRepo.seedCalendar({
      id: CAL_65AAC62E,
      underlying: "SPXW",
      strike: 7425000,
      optionType: "P",
      frontExpiry: "2026-08-07",
      backExpiry: "2026-08-31",
      qty: 1,
      status: "open",
      openNetDebit: null,
    });
    // The other four registered "closed" (their real status) — proves the fix does not
    // depend on status to correctly classify their OPEN fills either.
    fillsRepo.seedCalendar({
      id: CAL_9EEF2153,
      underlying: "SPXW",
      strike: 7100000,
      optionType: "P",
      frontExpiry: "2026-05-15",
      backExpiry: "2026-06-08",
      qty: 1,
      status: "closed",
      openNetDebit: null,
    });
    fillsRepo.seedCalendar({
      id: CAL_E8BFBF41,
      underlying: "SPXW",
      strike: 7175000,
      optionType: "P",
      frontExpiry: "2026-05-22",
      backExpiry: "2026-06-15",
      qty: 1,
      status: "closed",
      openNetDebit: null,
    });
    fillsRepo.seedCalendar({
      id: CAL_60C46A57,
      underlying: "SPXW",
      strike: 7425000,
      optionType: "P",
      frontExpiry: "2026-07-08",
      backExpiry: "2026-07-31",
      qty: 1,
      status: "closed",
      openNetDebit: null,
    });
    fillsRepo.seedCalendar({
      id: CAL_24F1E72E,
      underlying: "SPXW",
      strike: 7475000,
      optionType: "P",
      frontExpiry: "2026-07-09",
      backExpiry: "2026-07-31",
      qty: 1,
      status: "closed",
      openNetDebit: null,
    });

    // Step 1: broker → fills (A4). Real orders, every leg's own positionEffect preserved.
    const syncTransactions = makeSyncTransactionsUseCase({
      fetchTransactions,
      writeFills: fillsRepo.writeFills,
      hashFillIds: hashIds,
      accountHash: "acct-hash",
      from: "2026-04-01",
      to: "2026-07-31",
      now: () => new Date("2026-07-05T14:00:00Z"),
    });
    const txResult = await syncTransactions();
    expect(txResult.ok).toBe(true);
    expect(fillsRepo.countFills()).toBe(20); // 8 orders x 2 legs + 1 order (the shared roll-order) x 4 legs

    // Step 2: full-sweep pairing — the REAL production readCalendarLegs (status-derived
    // calendarId/legOccSymbol matching only, per the round-4 fix — no positionEffect).
    const syncFills = makeSyncFillsUseCase({
      readUnprocessedFills: fillsRepo.readUnprocessedFills,
      readCalendarLegs: fillsRepo.readCalendarLegs,
      storeCalendarEvent: eventsRepo.storeCalendarEvent,
      storeOrphanFill: orphansRepo.storeOrphanFill,
      resetCalendarAmounts: fillsRepo.resetCalendarAmounts,
      readCalendarEvents: eventsRepo.readCalendarEvents,
      markFillsProcessed: fillsRepo.markFillsProcessed,
      newId,
      hashFillIds: hashIds,
      now: () => new Date("2026-07-05T14:00:00Z"),
    });
    const syncResult = await syncFills();
    expect(syncResult.ok).toBe(true);

    // No fill is orphaned — every leg matches its seeded calendar.
    const orphans = await orphansRepo.getAllOrphans();
    expect(orphans).toHaveLength(0);

    // Step 3: recompute amounts per calendar directly from the REAL calendar_events store
    // (eventsRepo) — the exact WR-A1 sum-by-eventType rule makePostgresFillsRepo.
    // recomputeCalendarAmounts implements (proven identical by the shared fills.contract.ts
    // suite run against both Postgres and the in-memory twin). This mirrors the established
    // pattern in journal-e2e.test.ts's SC5 test: the in-memory fills-repo's OWN
    // recomputeCalendarAmounts reads a test-seeded shadow store (populated only via
    // seedEvent()), decoupled from the real calendarEventsRepo that syncFills writes to in
    // this full-pipeline harness — a pre-existing in-memory-twin composition quirk, unrelated
    // to this round's fix, so the recompute is done here against the real event store instead.
    async function recomputeFromRealEvents(
      calendarId: string,
    ): Promise<{ openNetDebit: number; closeNetCredit: number }> {
      const evs = await eventsRepo.readCalendarEvents(calendarId);
      expect(evs.ok).toBe(true);
      let openNetDebit = 0;
      let closeNetCredit = 0;
      if (evs.ok) {
        for (const e of evs.value) {
          switch (e.eventType) {
            case "OPEN":
              openNetDebit += e.netAmount;
              break;
            case "CLOSE":
              closeNetCredit += -e.netAmount;
              break;
            case "ROLL":
              if (e.rollOpenDebit !== null) openNetDebit += e.rollOpenDebit;
              if (e.rollCloseCredit !== null) closeNetCredit += e.rollCloseCredit;
              break;
          }
        }
      }
      return { openNetDebit, closeNetCredit };
    }

    // ─── 65aac62e: registered OPEN, real openDebit=32.35 / closeCredit=36.35 ─────────
    // Pre-fix: openNetDebit came out -4.00 (32.35 open − 36.35 close folded together, all
    // 4 fills classified OPEN because calendar.status === "open").
    const a = await recomputeFromRealEvents(CAL_65AAC62E);
    expect(a.openNetDebit).toBeCloseTo(32.35, 2);
    expect(a.closeNetCredit).toBeCloseTo(36.35, 2);

    // ─── 9eef2153: registered CLOSED, real openDebit=42.85 / closeCredit=46.60 ───────
    // Pre-fix: openNetDebit came out 0 (no OPEN events at all — every fill classified CLOSE
    // because calendar.status === "closed").
    const b = await recomputeFromRealEvents(CAL_9EEF2153);
    expect(b.openNetDebit).toBeCloseTo(42.85, 2);
    expect(b.closeNetCredit).toBeCloseTo(46.60, 2);

    // ─── e8bfbf41: registered CLOSED, real openDebit=44.60 / closeCredit=43.80 ───────
    const c = await recomputeFromRealEvents(CAL_E8BFBF41);
    expect(c.openNetDebit).toBeCloseTo(44.60, 2);
    expect(c.closeNetCredit).toBeCloseTo(43.80, 2);

    // ─── 60c46a57 / 24f1e72e: share one broker order, but DIFFERENT calendars (strikes
    // 7425 vs 7475) — not a domain ROLL (D-03 requires same calendarId). Each must show
    // its own correct, independent open/close split; no spurious ROLL event fabricated.
    const d = await recomputeFromRealEvents(CAL_60C46A57);
    expect(d.openNetDebit).toBeCloseTo(44.20, 2);
    expect(d.closeNetCredit).toBeCloseTo(43.22, 2);

    const e = await recomputeFromRealEvents(CAL_24F1E72E);
    expect(e.openNetDebit).toBeCloseTo(41.52, 2);
    expect(e.closeNetCredit).toBeCloseTo(45.00, 2);

    // No ROLL event exists anywhere — every event is a plain OPEN or CLOSE (proves the
    // shared-order-different-calendar case is never mistaken for a same-calendar roll).
    for (const calId of [CAL_65AAC62E, CAL_9EEF2153, CAL_E8BFBF41, CAL_60C46A57, CAL_24F1E72E]) {
      const evs = await eventsRepo.readCalendarEvents(calId);
      expect(evs.ok).toBe(true);
      if (!evs.ok) continue;
      expect(evs.value.every((ev) => ev.eventType === "OPEN" || ev.eventType === "CLOSE")).toBe(true);
      // Two legs x two events (OPEN + CLOSE) each = 4 per calendar; never a ROLL.
      expect(evs.value).toHaveLength(4);
    }
  });
});
