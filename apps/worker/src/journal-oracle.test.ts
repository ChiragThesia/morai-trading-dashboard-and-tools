/**
 * journal-oracle.test.ts — real-transaction regression suite
 * (journal-pnl-opennetdebit-units, rounds 4 + 5).
 *
 * Round 4 built this suite from 5 real calendars and fixed the OPEN/CLOSE
 * classification-from-status bug. Round 5 extends it to ALL 13 real, ground-truth-confirmed
 * calendars (.planning/debug/journal-pnl-ground-truth.md) — the coverage gap that let two
 * further bugs slip to prod:
 *
 *   BUG 1 (shared-leg attribution): 8a63aa81 (7275P Jun18/Jun23) and 6303e6af (7275P
 *   Jun18/Jul17) share the SAME front-month contract (SPXW 260618P07275000). readCalendarLegs
 *   returns 2 candidates for every fill on that symbol, and the old matching logic
 *   orphan-parked all of them — each calendar kept only its unique back leg (a back-leg-only
 *   debit, e.g. 62.50 instead of the true net 62.50-52.30=10.20). Fixed by
 *   `resolveFillMatches` (order-anchored disambiguation, fill-pairing.ts) plus an expanded
 *   `readUnprocessedFillsForCalendar` that includes "order context" fills so the scoped
 *   rebuild-journal path (the ACTUAL mechanism that produced this prod bug via
 *   fix-pnl-reingest.ts) has the anchor leg available regardless of which calendar is
 *   rebuilt first.
 *
 *   BUG 2 (closed-status not set): 65aac62e is registered status "open" despite its real
 *   Jul-1 CLOSE order fully unwinding both legs. Fixed by `isCalendarFullyClosed` +
 *   `ForTransitioningCalendarClosed`, wired into syncFills.ts's event-processing path so a
 *   re-ingest/rebuild naturally transitions status.
 *
 * Test A below is the extended real-transaction openNetDebit/closeNetCredit regression (all
 * 13 calendars, full sweep) — guards the 11 previously-correct calendars against regression
 * AND proves the 2 shared-leg calendars now compute correctly.
 * Test B proves bug 2's status transition (idempotent, does not affect already-closed
 * calendars, does not close a genuinely-open one).
 * Test C proves bug 1's fix converges under the REAL production mechanism — the
 * calendar-SCOPED rebuild-journal path (fix-pnl-reingest.ts), run in the SAME per-calendar
 * order the orchestrator's correction script actually uses (listCalendars desc by openedAt),
 * so it is not just the full-sweep path that gets exercised here.
 *
 * Expected values here are computed fee-free (avgPrice × qty, the exact convention
 * syncFills.ts uses — it never reads the broker's raw netAmount, which bakes in a small
 * ~$1-2/leg fee). The ground-truth doc's fee-INCLUSIVE figures differ by that amount,
 * exactly as its own per-row asterisk documents. Tolerance below is cents-level, not the
 * oracle's fee-inclusive figure. This ~$2/leg fee-free-vs-fee-inclusive gap is a known,
 * separate, OUT-OF-SCOPE issue (flagged, not fixed, in this round).
 */

import { describe, it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { formatOccSymbol } from "@morai/shared";
import type { OccSymbol } from "@morai/shared";
import {
  makeSyncTransactionsUseCase,
  makeSyncFillsUseCase,
  makeSyncFillsForCalendarUseCase,
  makeRebuildJournalUseCase,
  hashFillIds,
} from "@morai/core";
import type { BrokerTransaction, ForFetchingTransactions, Calendar } from "@morai/core";
import {
  makeMemoryFillsRepo,
  makeMemoryCalendarEventsRepo,
  makeMemoryOrphanFillsRepo,
  makeMemoryCalendarsRepo,
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

// ─── All 13 real calendars (.planning/debug/journal-pnl-ground-truth.md) ───────────
const CAL_65AAC62E = "65aac62e-0000-4000-8000-000000000001"; // 7425P Aug7/Aug31
const CAL_9EEF2153 = "9eef2153-0000-4000-8000-000000000002"; // 7100P May15/Jun8
const CAL_E8BFBF41 = "e8bfbf41-0000-4000-8000-000000000003"; // 7175P May22/Jun15
const CAL_60C46A57 = "60c46a57-0000-4000-8000-000000000004"; // 7425P Jul8/Jul31
const CAL_24F1E72E = "24f1e72e-0000-4000-8000-000000000005"; // 7475P Jul9/Jul31
const CAL_8A63AA81 = "8a63aa81-0000-4000-8000-000000000006"; // 7275P Jun18/Jun23 (shared front leg)
const CAL_6303E6AF = "6303e6af-0000-4000-8000-000000000007"; // 7275P Jun18/Jul17 (shared front leg)
const CAL_45727D08 = "45727d08-0000-4000-8000-000000000008"; // 7300P Jun5/Jun29
const CAL_53533AA7 = "53533aa7-0000-4000-8000-000000000009"; // 7275P Jun5/Jun26
const CAL_B0D862BA = "b0d862ba-0000-4000-8000-000000000010"; // 7300P May29/Jun22
const CAL_95546839 = "95546839-0000-4000-8000-000000000011"; // 7050P May20/Jun18
const CAL_F3789DDD = "f3789ddd-0000-4000-8000-000000000012"; // 6900P May7/Jun1
const CAL_3CA74277 = "3ca74277-0000-4000-8000-000000000013"; // 7375P Jul8/Jul31

// A synthetic 14th calendar (NOT one of the 13 real ones) with only an OPEN order — no
// CLOSE. Used solely to prove bug 2's negative control: a genuinely open calendar (no close
// event exists) must STAY open when the closure check runs.
const CAL_STILL_OPEN = "00000000-0000-4000-8000-000000000099";

// Real Schwab orders (activityId/orderId/legs verbatim from scratchpad/txns.json), one leg
// per BrokerTransaction entry (entries sharing an orderId form one broker order).
function realTransactions(): ReadonlyArray<BrokerTransaction> {
  return [
    // ─── 65aac62e: OPEN (Jun 22, order 1006855414174) ──────────────────────────
    { activityId: 122750578406, tradeDate: "2026-06-22", netAmount: -15942.22, orderId: 1006855414174,
      legs: [{ occSymbol: leg("2026-08-31", 7425), qty: 1, price: 159.41, positionEffect: "OPENING", side: "buy" }] },
    { activityId: 122750578407, tradeDate: "2026-06-22", netAmount: 12704.78, orderId: 1006855414174,
      legs: [{ occSymbol: leg("2026-08-07", 7425), qty: 1, price: 127.06, positionEffect: "OPENING", side: "sell" }] },
    // ─── 65aac62e: CLOSE (Jul 1, order 1006990704540) — THE REGISTERED-OPEN BUG ─
    { activityId: 123817421801, tradeDate: "2026-07-01", netAmount: 12311.78, orderId: 1006990704540,
      legs: [{ occSymbol: leg("2026-08-31", 7425), qty: 1, price: 123.13, positionEffect: "CLOSING", side: "sell" }] },
    { activityId: 123817421802, tradeDate: "2026-07-01", netAmount: -8679.22, orderId: 1006990704540,
      legs: [{ occSymbol: leg("2026-08-07", 7425), qty: 1, price: 86.78, positionEffect: "CLOSING", side: "buy" }] },

    // ─── 9eef2153: OPEN (Apr 24, order 1006130670569) ──────────────────────────
    { activityId: 117481087023, tradeDate: "2026-04-24", netAmount: 8152.78, orderId: 1006130670569,
      legs: [{ occSymbol: leg("2026-05-15", 7100), qty: 1, price: 81.54, positionEffect: "OPENING", side: "sell" }] },
    { activityId: 117481087024, tradeDate: "2026-04-24", netAmount: -12440.22, orderId: 1006130670569,
      legs: [{ occSymbol: leg("2026-06-08", 7100), qty: 1, price: 124.39, positionEffect: "OPENING", side: "buy" }] },
    // ─── 9eef2153: CLOSE (Apr 30, order 1006198637052) ─────────────────────────
    { activityId: 117972611805, tradeDate: "2026-04-30", netAmount: 9173.78, orderId: 1006198637052,
      legs: [{ occSymbol: leg("2026-06-08", 7100), qty: 1, price: 91.75, positionEffect: "CLOSING", side: "sell" }] },
    { activityId: 117972611806, tradeDate: "2026-04-30", netAmount: -4516.22, orderId: 1006198637052,
      legs: [{ occSymbol: leg("2026-05-15", 7100), qty: 1, price: 45.15, positionEffect: "CLOSING", side: "buy" }] },

    // ─── e8bfbf41: OPEN (May 1, order 1006216919920) ───────────────────────────
    { activityId: 118109354846, tradeDate: "2026-05-01", netAmount: -11513.22, orderId: 1006216919920,
      legs: [{ occSymbol: leg("2026-06-15", 7175), qty: 1, price: 115.12, positionEffect: "OPENING", side: "buy" }] },
    { activityId: 118109354847, tradeDate: "2026-05-01", netAmount: 7050.78, orderId: 1006216919920,
      legs: [{ occSymbol: leg("2026-05-22", 7175), qty: 1, price: 70.52, positionEffect: "OPENING", side: "sell" }] },
    // ─── e8bfbf41: CLOSE (May 6, order 1006265261970) ──────────────────────────
    { activityId: 118465600052, tradeDate: "2026-05-06", netAmount: 7543.78, orderId: 1006265261970,
      legs: [{ occSymbol: leg("2026-06-15", 7175), qty: 1, price: 75.45, positionEffect: "CLOSING", side: "sell" }] },
    { activityId: 118465600053, tradeDate: "2026-05-06", netAmount: -3166.22, orderId: 1006265261970,
      legs: [{ occSymbol: leg("2026-05-22", 7175), qty: 1, price: 31.65, positionEffect: "CLOSING", side: "buy" }] },

    // ─── 60c46a57: OPEN (Jun 15, order 1006755504464) ──────────────────────────
    { activityId: 122032396593, tradeDate: "2026-06-15", netAmount: -9661.22, orderId: 1006755504464,
      legs: [{ occSymbol: leg("2026-07-31", 7425), qty: 1, price: 96.6, positionEffect: "OPENING", side: "buy" }] },
    { activityId: 122032396594, tradeDate: "2026-06-15", netAmount: 5238.78, orderId: 1006755504464,
      legs: [{ occSymbol: leg("2026-07-08", 7425), qty: 1, price: 52.4, positionEffect: "OPENING", side: "sell" }] },
    // ─── order 1006797510202 (Jun 17): closes 60c46a57 AND opens 24f1e72e ──────
    // Different strikes (7425 → 7475) ⇒ different calendars ⇒ NOT a domain ROLL (D-03
    // requires same calendarId). Two ordinary CLOSE fills + two ordinary OPEN fills.
    { activityId: 122337256198, tradeDate: "2026-06-17", netAmount: -5971.22, orderId: 1006797510202,
      legs: [{ occSymbol: leg("2026-07-08", 7425), qty: 1, price: 59.7, positionEffect: "CLOSING", side: "buy" }] },
    { activityId: 122337256196, tradeDate: "2026-06-17", netAmount: 10290.78, orderId: 1006797510202,
      legs: [{ occSymbol: leg("2026-07-31", 7425), qty: 1, price: 102.92, positionEffect: "CLOSING", side: "sell" }] },
    { activityId: 122337256195, tradeDate: "2026-06-17", netAmount: -11785.22, orderId: 1006797510202,
      legs: [{ occSymbol: leg("2026-07-31", 7475), qty: 1, price: 117.84, positionEffect: "OPENING", side: "buy" }] },
    { activityId: 122337256197, tradeDate: "2026-06-17", netAmount: 7630.78, orderId: 1006797510202,
      legs: [{ occSymbol: leg("2026-07-09", 7475), qty: 1, price: 76.32, positionEffect: "OPENING", side: "sell" }] },
    // ─── 24f1e72e: CLOSE (Jun 18, order 1006830552432) ─────────────────────────
    { activityId: 122571604017, tradeDate: "2026-06-18", netAmount: -7987.22, orderId: 1006830552432,
      legs: [{ occSymbol: leg("2026-07-09", 7475), qty: 1, price: 79.86, positionEffect: "CLOSING", side: "buy" }] },
    { activityId: 122571604018, tradeDate: "2026-06-18", netAmount: 12484.78, orderId: 1006830552432,
      legs: [{ occSymbol: leg("2026-07-31", 7475), qty: 1, price: 124.86, positionEffect: "CLOSING", side: "sell" }] },

    // ─── 8a63aa81: OPEN (Jun 9, order 1006681717677) — SHARES front leg 0618P7275 ─
    { activityId: 121497881596, tradeDate: "2026-06-09", netAmount: -6251.22, orderId: 1006681717677,
      legs: [{ occSymbol: leg("2026-06-23", 7275), qty: 1, price: 62.5, positionEffect: "OPENING", side: "buy" }] },
    { activityId: 121497881597, tradeDate: "2026-06-09", netAmount: 5228.78, orderId: 1006681717677,
      legs: [{ occSymbol: leg("2026-06-18", 7275), qty: 1, price: 52.3, positionEffect: "OPENING", side: "sell" }] },
    // ─── 8a63aa81: CLOSE (Jun 10, order 1006687566650) ─────────────────────────
    { activityId: 121553240539, tradeDate: "2026-06-10", netAmount: 6515.78, orderId: 1006687566650,
      legs: [{ occSymbol: leg("2026-06-23", 7275), qty: 1, price: 65.17, positionEffect: "CLOSING", side: "sell" }] },
    { activityId: 121553240540, tradeDate: "2026-06-10", netAmount: -5463.22, orderId: 1006687566650,
      legs: [{ occSymbol: leg("2026-06-18", 7275), qty: 1, price: 54.62, positionEffect: "CLOSING", side: "buy" }] },

    // ─── 6303e6af: OPEN (May 19, order 1006417446601) — SHARES front leg 0618P7275 ─
    { activityId: 119574995984, tradeDate: "2026-05-19", netAmount: -12891.22, orderId: 1006417446601,
      legs: [{ occSymbol: leg("2026-07-17", 7275), qty: 1, price: 128.9, positionEffect: "OPENING", side: "buy" }] },
    { activityId: 119574995985, tradeDate: "2026-05-19", netAmount: 8288.78, orderId: 1006417446601,
      legs: [{ occSymbol: leg("2026-06-18", 7275), qty: 1, price: 82.9, positionEffect: "OPENING", side: "sell" }] },
    // ─── 6303e6af: CLOSE (Jun 5, order 1006622444775) ──────────────────────────
    { activityId: 121087549299, tradeDate: "2026-06-05", netAmount: 6618.78, orderId: 1006622444775,
      legs: [{ occSymbol: leg("2026-07-17", 7275), qty: 1, price: 66.2, positionEffect: "CLOSING", side: "sell" }] },
    { activityId: 121087549300, tradeDate: "2026-06-05", netAmount: -1921.22, orderId: 1006622444775,
      legs: [{ occSymbol: leg("2026-06-18", 7275), qty: 1, price: 19.2, positionEffect: "CLOSING", side: "buy" }] },

    // ─── 45727d08: OPEN (May 15, order 1006379061928) ──────────────────────────
    { activityId: 119298578480, tradeDate: "2026-05-15", netAmount: -10095.22, orderId: 1006379061928,
      legs: [{ occSymbol: leg("2026-06-29", 7300), qty: 1, price: 100.94, positionEffect: "OPENING", side: "buy" }] },
    { activityId: 119298578481, tradeDate: "2026-05-15", netAmount: 5642.78, orderId: 1006379061928,
      legs: [{ occSymbol: leg("2026-06-05", 7300), qty: 1, price: 56.44, positionEffect: "OPENING", side: "sell" }] },
    // ─── 45727d08: CLOSE (May 18, order 1006405063827) ─────────────────────────
    { activityId: 119480915880, tradeDate: "2026-05-18", netAmount: 11252.78, orderId: 1006405063827,
      legs: [{ occSymbol: leg("2026-06-29", 7300), qty: 1, price: 112.54, positionEffect: "CLOSING", side: "sell" }] },
    { activityId: 119480915881, tradeDate: "2026-05-18", netAmount: -6755.22, orderId: 1006405063827,
      legs: [{ occSymbol: leg("2026-06-05", 7300), qty: 1, price: 67.54, positionEffect: "CLOSING", side: "buy" }] },

    // ─── 53533aa7: OPEN (May 12, order 1006328241982) ──────────────────────────
    { activityId: 118921683962, tradeDate: "2026-05-12", netAmount: -12228.22, orderId: 1006328241982,
      legs: [{ occSymbol: leg("2026-06-26", 7275), qty: 1, price: 122.27, positionEffect: "OPENING", side: "buy" }] },
    { activityId: 118921683963, tradeDate: "2026-05-12", netAmount: 8270.78, orderId: 1006328241982,
      legs: [{ occSymbol: leg("2026-06-05", 7275), qty: 1, price: 82.72, positionEffect: "OPENING", side: "sell" }] },
    // ─── 53533aa7: CLOSE (May 15, order 1006374383514) ─────────────────────────
    { activityId: 119264977296, tradeDate: "2026-05-15", netAmount: -5974.22, orderId: 1006374383514,
      legs: [{ occSymbol: leg("2026-06-05", 7275), qty: 1, price: 59.73, positionEffect: "CLOSING", side: "buy" }] },
    { activityId: 119264977297, tradeDate: "2026-05-15", netAmount: 10096.78, orderId: 1006374383514,
      legs: [{ occSymbol: leg("2026-06-26", 7275), qty: 1, price: 100.98, positionEffect: "CLOSING", side: "sell" }] },

    // ─── b0d862ba: OPEN (May 8, order 1006293766875) ───────────────────────────
    { activityId: 118672428980, tradeDate: "2026-05-08", netAmount: -10846.22, orderId: 1006293766875,
      legs: [{ occSymbol: leg("2026-06-22", 7300), qty: 1, price: 108.45, positionEffect: "OPENING", side: "buy" }] },
    { activityId: 118672428981, tradeDate: "2026-05-08", netAmount: 6308.78, orderId: 1006293766875,
      legs: [{ occSymbol: leg("2026-05-29", 7300), qty: 1, price: 63.1, positionEffect: "OPENING", side: "sell" }] },
    // ─── b0d862ba: CLOSE (May 12, order 1006325330463) ─────────────────────────
    { activityId: 118899358383, tradeDate: "2026-05-12", netAmount: 11753.78, orderId: 1006325330463,
      legs: [{ occSymbol: leg("2026-06-22", 7300), qty: 1, price: 117.55, positionEffect: "CLOSING", side: "sell" }] },
    { activityId: 118899358384, tradeDate: "2026-05-12", netAmount: -6871.22, orderId: 1006325330463,
      legs: [{ occSymbol: leg("2026-05-29", 7300), qty: 1, price: 68.7, positionEffect: "CLOSING", side: "buy" }] },

    // ─── 95546839: OPEN (Apr 20, order 1006070855412) ──────────────────────────
    { activityId: 117043180826, tradeDate: "2026-04-20", netAmount: 9628.78, orderId: 1006070855412,
      legs: [{ occSymbol: leg("2026-05-20", 7050), qty: 1, price: 96.3, positionEffect: "OPENING", side: "sell" }] },
    { activityId: 117043180827, tradeDate: "2026-04-20", netAmount: -14386.22, orderId: 1006070855412,
      legs: [{ occSymbol: leg("2026-06-18", 7050), qty: 1, price: 143.85, positionEffect: "OPENING", side: "buy" }] },
    // ─── 95546839: CLOSE (Apr 21, order 1006078556268) ─────────────────────────
    { activityId: 117101334250, tradeDate: "2026-04-21", netAmount: 13878.78, orderId: 1006078556268,
      legs: [{ occSymbol: leg("2026-06-18", 7050), qty: 1, price: 138.8, positionEffect: "CLOSING", side: "sell" }] },
    { activityId: 117101334251, tradeDate: "2026-04-21", netAmount: -9006.22, orderId: 1006078556268,
      legs: [{ occSymbol: leg("2026-05-20", 7050), qty: 1, price: 90.05, positionEffect: "CLOSING", side: "buy" }] },

    // ─── f3789ddd: OPEN (Apr 16, order 1006028000778) ──────────────────────────
    { activityId: 116738249399, tradeDate: "2026-04-16", netAmount: 6479.78, orderId: 1006028000778,
      legs: [{ occSymbol: leg("2026-05-07", 6900), qty: 1, price: 64.81, positionEffect: "OPENING", side: "sell" }] },
    { activityId: 116738249398, tradeDate: "2026-04-16", netAmount: -10542.22, orderId: 1006028000778,
      legs: [{ occSymbol: leg("2026-06-01", 6900), qty: 1, price: 105.41, positionEffect: "OPENING", side: "buy" }] },
    // ─── f3789ddd: CLOSE (Apr 16, SAME DAY, order 1006028001427) ───────────────
    { activityId: 116741093450, tradeDate: "2026-04-16", netAmount: -6298.22, orderId: 1006028001427,
      legs: [{ occSymbol: leg("2026-05-07", 6900), qty: 1, price: 62.97, positionEffect: "CLOSING", side: "buy" }] },
    { activityId: 116741093451, tradeDate: "2026-04-16", netAmount: 10395.78, orderId: 1006028001427,
      legs: [{ occSymbol: leg("2026-06-01", 6900), qty: 1, price: 103.97, positionEffect: "CLOSING", side: "sell" }] },

    // ─── 3ca74277: OPEN (Jun 12, order 1006740037547) ──────────────────────────
    { activityId: 121923469496, tradeDate: "2026-06-12", netAmount: 9437.78, orderId: 1006740037547,
      legs: [{ occSymbol: leg("2026-07-08", 7375), qty: 1, price: 94.39, positionEffect: "OPENING", side: "sell" }] },
    { activityId: 121923469497, tradeDate: "2026-06-12", netAmount: -13740.22, orderId: 1006740037547,
      legs: [{ occSymbol: leg("2026-07-31", 7375), qty: 1, price: 137.39, positionEffect: "OPENING", side: "buy" }] },
    // ─── 3ca74277: CLOSE (Jun 15, order 1006753323002) ─────────────────────────
    { activityId: 122021643929, tradeDate: "2026-06-15", netAmount: 8648.78, orderId: 1006753323002,
      legs: [{ occSymbol: leg("2026-07-31", 7375), qty: 1, price: 86.5, positionEffect: "CLOSING", side: "sell" }] },
    { activityId: 122021643930, tradeDate: "2026-06-15", netAmount: -4416.22, orderId: 1006753323002,
      legs: [{ occSymbol: leg("2026-07-08", 7375), qty: 1, price: 44.15, positionEffect: "CLOSING", side: "buy" }] },
  ];
}

// A synthetic OPEN-only order for the "genuinely open, stays open" negative control (Test B).
function stillOpenTransaction(): BrokerTransaction {
  return {
    activityId: 999000001,
    tradeDate: "2026-07-04",
    netAmount: -1000,
    orderId: 9990000001,
    legs: [
      { occSymbol: leg("2026-10-02", 7500), qty: 1, price: 100, positionEffect: "OPENING", side: "buy" },
      { occSymbol: leg("2026-09-04", 7500), qty: 1, price: 60, positionEffect: "OPENING", side: "sell" },
    ],
  };
}

// ─── Per-calendar registration fixtures (seedCalendar shape shared by every test) ─────
type CalSeed = {
  readonly id: string;
  readonly underlying: string;
  readonly strike: number;
  readonly optionType: "C" | "P";
  readonly frontExpiry: string;
  readonly backExpiry: string;
  readonly qty: number;
  readonly status: "open" | "closed";
  readonly openNetDebit: number | null;
};

function allCalendarSeeds(): ReadonlyArray<CalSeed> {
  return [
    { id: CAL_65AAC62E, underlying: "SPXW", strike: 7425000, optionType: "P", frontExpiry: "2026-08-07", backExpiry: "2026-08-31", qty: 1, status: "open", openNetDebit: null },
    { id: CAL_9EEF2153, underlying: "SPXW", strike: 7100000, optionType: "P", frontExpiry: "2026-05-15", backExpiry: "2026-06-08", qty: 1, status: "closed", openNetDebit: null },
    { id: CAL_E8BFBF41, underlying: "SPXW", strike: 7175000, optionType: "P", frontExpiry: "2026-05-22", backExpiry: "2026-06-15", qty: 1, status: "closed", openNetDebit: null },
    { id: CAL_60C46A57, underlying: "SPXW", strike: 7425000, optionType: "P", frontExpiry: "2026-07-08", backExpiry: "2026-07-31", qty: 1, status: "closed", openNetDebit: null },
    { id: CAL_24F1E72E, underlying: "SPXW", strike: 7475000, optionType: "P", frontExpiry: "2026-07-09", backExpiry: "2026-07-31", qty: 1, status: "closed", openNetDebit: null },
    { id: CAL_8A63AA81, underlying: "SPXW", strike: 7275000, optionType: "P", frontExpiry: "2026-06-18", backExpiry: "2026-06-23", qty: 1, status: "closed", openNetDebit: null },
    { id: CAL_6303E6AF, underlying: "SPXW", strike: 7275000, optionType: "P", frontExpiry: "2026-06-18", backExpiry: "2026-07-17", qty: 1, status: "closed", openNetDebit: null },
    { id: CAL_45727D08, underlying: "SPXW", strike: 7300000, optionType: "P", frontExpiry: "2026-06-05", backExpiry: "2026-06-29", qty: 1, status: "closed", openNetDebit: null },
    { id: CAL_53533AA7, underlying: "SPXW", strike: 7275000, optionType: "P", frontExpiry: "2026-06-05", backExpiry: "2026-06-26", qty: 1, status: "closed", openNetDebit: null },
    { id: CAL_B0D862BA, underlying: "SPXW", strike: 7300000, optionType: "P", frontExpiry: "2026-05-29", backExpiry: "2026-06-22", qty: 1, status: "closed", openNetDebit: null },
    { id: CAL_95546839, underlying: "SPXW", strike: 7050000, optionType: "P", frontExpiry: "2026-05-20", backExpiry: "2026-06-18", qty: 1, status: "closed", openNetDebit: null },
    { id: CAL_F3789DDD, underlying: "SPXW", strike: 6900000, optionType: "P", frontExpiry: "2026-05-07", backExpiry: "2026-06-01", qty: 1, status: "closed", openNetDebit: null },
    { id: CAL_3CA74277, underlying: "SPXW", strike: 7375000, optionType: "P", frontExpiry: "2026-07-08", backExpiry: "2026-07-31", qty: 1, status: "closed", openNetDebit: null },
  ];
}

// Expected fee-free openNetDebit/closeNetCredit per calendar (avgPrice × qty arithmetic,
// matching the exact convention syncFills.ts computes — no commission/fees, which are always
// NULL in this pipeline, a separate pre-existing gap, not touched this round). openNetDebit
// values match the task's own authoritative fee-free figures exactly.
const EXPECTED: ReadonlyArray<{ id: string; openNetDebit: number; closeNetCredit: number }> = [
  { id: CAL_65AAC62E, openNetDebit: 32.35, closeNetCredit: 36.35 },
  { id: CAL_9EEF2153, openNetDebit: 42.85, closeNetCredit: 46.6 },
  { id: CAL_E8BFBF41, openNetDebit: 44.6, closeNetCredit: 43.8 },
  { id: CAL_60C46A57, openNetDebit: 44.2, closeNetCredit: 43.22 },
  { id: CAL_24F1E72E, openNetDebit: 41.52, closeNetCredit: 45.0 },
  { id: CAL_8A63AA81, openNetDebit: 10.2, closeNetCredit: 10.55 },
  { id: CAL_6303E6AF, openNetDebit: 46.0, closeNetCredit: 47.0 },
  { id: CAL_45727D08, openNetDebit: 44.5, closeNetCredit: 45.0 },
  { id: CAL_53533AA7, openNetDebit: 39.55, closeNetCredit: 41.25 },
  { id: CAL_B0D862BA, openNetDebit: 45.35, closeNetCredit: 48.85 },
  { id: CAL_95546839, openNetDebit: 47.55, closeNetCredit: 48.75 },
  { id: CAL_F3789DDD, openNetDebit: 40.6, closeNetCredit: 41.0 },
  { id: CAL_3CA74277, openNetDebit: 43.0, closeNetCredit: 42.35 },
];

async function recomputeFromRealEvents(
  eventsRepo: ReturnType<typeof makeMemoryCalendarEventsRepo>,
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

// ─── Test A: full-sweep, all 13 real calendars ─────────────────────────────────────

describe("journal oracle — real-transaction openNetDebit/closeNetCredit regression (round 5, all 13)", () => {
  it("recomputes openNetDebit/closeNetCredit correctly for ALL 13 real calendars, including the 2 shared-front-leg calendars", async () => {
    const fillsRepo = makeMemoryFillsRepo();
    const eventsRepo = makeMemoryCalendarEventsRepo();
    const orphansRepo = makeMemoryOrphanFillsRepo();
    const calendarsRepo = makeMemoryCalendarsRepo();

    for (const seed of allCalendarSeeds()) {
      fillsRepo.seedCalendar(seed);
    }

    const fetchTransactions: ForFetchingTransactions = async () => ({
      ok: true as const,
      value: realTransactions(),
    });

    // Step 1: broker → fills (A4). Real orders, every leg's own positionEffect/side preserved.
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
    // 13 calendars × 4 fills (2 OPEN legs + 2 CLOSE legs) each = 52. The 60c46a57/24f1e72e
    // pair shares one 4-leg order (not a domain ROLL, different strikes) — no fewer FILLS,
    // only one fewer distinct orderId.
    expect(fillsRepo.countFills()).toBe(52);

    // Step 2: full-sweep pairing — the REAL production readCalendarLegs (status-independent,
    // round 4) + resolveFillMatches (order-anchored disambiguation, round 5 bug 1).
    const syncFills = makeSyncFillsUseCase({
      readUnprocessedFills: fillsRepo.readUnprocessedFills,
      readCalendarLegs: fillsRepo.readCalendarLegs,
      storeCalendarEvent: eventsRepo.storeCalendarEvent,
      storeOrphanFill: orphansRepo.storeOrphanFill,
      resetCalendarAmounts: fillsRepo.resetCalendarAmounts,
      readCalendarEvents: eventsRepo.readCalendarEvents,
      markFillsProcessed: fillsRepo.markFillsProcessed,
      transitionCalendarClosed: calendarsRepo.transitionCalendarClosed,
      newId,
      hashFillIds: hashIds,
      now: () => new Date("2026-07-05T14:00:00Z"),
    });
    const syncResult = await syncFills();
    expect(syncResult.ok).toBe(true);

    // No fill is orphaned — every leg (including the shared front leg) resolves to its
    // correct calendar via the order-anchored disambiguation.
    const orphans = await orphansRepo.getAllOrphans();
    expect(orphans).toHaveLength(0);

    // Step 3: recompute amounts per calendar directly from the REAL calendar_events store
    // (see journal-e2e.test.ts's SC5 comment for why this bypasses the in-memory twin's
    // decoupled recompute quirk — unrelated to this round's fix).
    for (const { id, openNetDebit, closeNetCredit } of EXPECTED) {
      const amounts = await recomputeFromRealEvents(eventsRepo, id);
      expect(amounts.openNetDebit, `${id} openNetDebit`).toBeCloseTo(openNetDebit, 2);
      expect(amounts.closeNetCredit, `${id} closeNetCredit`).toBeCloseTo(closeNetCredit, 2);
    }

    // No spurious ROLL event anywhere — every event is a plain OPEN or CLOSE, and each of
    // the 13 calendars has exactly 4 events (2 legs × OPEN+CLOSE).
    for (const { id } of EXPECTED) {
      const evs = await eventsRepo.readCalendarEvents(id);
      expect(evs.ok).toBe(true);
      if (!evs.ok) continue;
      expect(evs.value.every((ev) => ev.eventType === "OPEN" || ev.eventType === "CLOSE")).toBe(true);
      expect(evs.value).toHaveLength(4);
    }
  });
});

// ─── Test B: bug 2 — closed-status transition (event-processing path) ──────────────

describe("journal oracle — closed-status auto-transition (round 5, bug 2)", () => {
  it("65aac62e (registered open) transitions to closed with closedAt = the real close date; already-closed calendars are untouched (idempotent); a genuinely-open calendar stays open", async () => {
    const fillsRepo = makeMemoryFillsRepo();
    const eventsRepo = makeMemoryCalendarEventsRepo();
    const orphansRepo = makeMemoryOrphanFillsRepo();
    const calendarsRepo = makeMemoryCalendarsRepo();

    // Seed both the fills-repo's leg-matching twin AND the real calendars repo (the twin the
    // status transition actually writes to) — mirrors the real Postgres `calendars` table
    // being the single source both readCalendarLegs and transitionCalendarClosed operate on.
    const SENTINEL_CLOSED_AT = new Date("2020-01-01T00:00:00Z"); // clearly not a real close date
    for (const seed of allCalendarSeeds()) {
      fillsRepo.seedCalendar(seed);
      const calendar: Calendar = {
        id: seed.id,
        underlying: seed.underlying,
        strike: seed.strike,
        optionType: seed.optionType,
        frontExpiry: seed.frontExpiry,
        backExpiry: seed.backExpiry,
        qty: seed.qty,
        openNetDebit: 0,
        status: seed.status,
        openedAt: new Date("2026-01-01T00:00:00Z"),
        // The 12 correctly-registered-closed calendars get a sentinel closedAt so we can
        // prove the no-op transition does NOT overwrite it (idempotency, not just "still
        // closed"). 65aac62e (the bug) has none yet — status is "open".
        closedAt: seed.status === "closed" ? SENTINEL_CLOSED_AT : null,
        notes: null,
      };
      await calendarsRepo.seedOpenCalendar(calendar);
    }
    // Negative control: a genuinely open calendar with only an OPEN order (no close event).
    fillsRepo.seedCalendar({
      id: CAL_STILL_OPEN,
      underlying: "SPXW",
      strike: 7500000,
      optionType: "P",
      frontExpiry: "2026-09-04",
      backExpiry: "2026-10-02",
      qty: 1,
      status: "open",
      openNetDebit: null,
    });
    await calendarsRepo.seedOpenCalendar({
      id: CAL_STILL_OPEN,
      underlying: "SPXW",
      strike: 7500000,
      optionType: "P",
      frontExpiry: "2026-09-04",
      backExpiry: "2026-10-02",
      qty: 1,
      openNetDebit: 0,
      status: "open",
      openedAt: new Date("2026-07-04T00:00:00Z"),
      closedAt: null,
      notes: null,
    });

    const fetchTransactions: ForFetchingTransactions = async () => ({
      ok: true as const,
      value: [...realTransactions(), stillOpenTransaction()],
    });

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

    const syncFills = makeSyncFillsUseCase({
      readUnprocessedFills: fillsRepo.readUnprocessedFills,
      readCalendarLegs: fillsRepo.readCalendarLegs,
      storeCalendarEvent: eventsRepo.storeCalendarEvent,
      storeOrphanFill: orphansRepo.storeOrphanFill,
      resetCalendarAmounts: fillsRepo.resetCalendarAmounts,
      readCalendarEvents: eventsRepo.readCalendarEvents,
      markFillsProcessed: fillsRepo.markFillsProcessed,
      transitionCalendarClosed: calendarsRepo.transitionCalendarClosed,
      newId,
      hashFillIds: hashIds,
      now: () => new Date("2026-07-05T14:00:00Z"),
    });
    const syncResult = await syncFills();
    expect(syncResult.ok).toBe(true);

    // 65aac62e: registered "open" → transitions to "closed", closedAt = the REAL close date
    // (Jul 1, 2026 — the close order's own filledAt), never `now()` (today, whenever this
    // re-ingest runs).
    const after65 = await calendarsRepo.getCalendarById(CAL_65AAC62E);
    expect(after65.ok).toBe(true);
    if (after65.ok && after65.value !== null) {
      expect(after65.value.status).toBe("closed");
      expect(after65.value.closedAt).not.toBeNull();
      expect(after65.value.closedAt?.toISOString().slice(0, 10)).toBe("2026-07-01");
    }

    // The other 12 (already registered "closed"): idempotent no-op — status stays "closed"
    // AND the sentinel closedAt is NOT overwritten (proves the transition is a true no-op,
    // not a "re-close with today's date").
    const alreadyClosedIds = allCalendarSeeds()
      .map((s) => s.id)
      .filter((id) => id !== CAL_65AAC62E);
    for (const id of alreadyClosedIds) {
      const after = await calendarsRepo.getCalendarById(id);
      expect(after.ok).toBe(true);
      if (after.ok && after.value !== null) {
        expect(after.value.status, `${id} status`).toBe("closed");
        expect(after.value.closedAt?.toISOString(), `${id} closedAt unchanged`).toBe(
          SENTINEL_CLOSED_AT.toISOString(),
        );
      }
    }

    // Negative control: a genuinely open calendar (no CLOSE event at all) stays open.
    const afterStillOpen = await calendarsRepo.getCalendarById(CAL_STILL_OPEN);
    expect(afterStillOpen.ok).toBe(true);
    if (afterStillOpen.ok && afterStillOpen.value !== null) {
      expect(afterStillOpen.value.status).toBe("open");
    }

    // Re-running the exact same sync again (simulating a second re-ingest) is still
    // idempotent — no error, no further change.
    const syncResult2 = await syncFills();
    expect(syncResult2.ok).toBe(true);
    const after65Again = await calendarsRepo.getCalendarById(CAL_65AAC62E);
    expect(after65Again.ok).toBe(true);
    if (after65Again.ok && after65Again.value !== null) {
      expect(after65Again.value.status).toBe("closed");
      expect(after65Again.value.closedAt?.toISOString().slice(0, 10)).toBe("2026-07-01");
    }
  });
});

// ─── Test C: bug 1 — the REAL production mechanism (scoped rebuild-journal) ────────
//
// fix-pnl-reingest.ts (the orchestrator's actual prod-correction script) does NOT use the
// full sweep — it calls rebuild-journal PER CALENDAR (makeRebuildJournalUseCase →
// makeSyncFillsForCalendarUseCase → readUnprocessedFillsForCalendar, SCOPED). This is the
// exact mechanism that produced the round-5 prod bug: a calendar-scoped read that only pulls
// fills matching ITS OWN legs would never see the sibling calendar's unique leg from a SHARED
// order, so resolveFillMatches would have no anchor to disambiguate the shared front leg —
// UNLESS readUnprocessedFillsForCalendar also includes "order context" fills (the round-5
// fix to that function). This test proves convergence under the REAL per-calendar mechanism,
// run in the SAME order fix-pnl-reingest's calendar loop actually uses
// (`calendarsRepo.listCalendars(undefined)`, ordered desc by openedAt — 8a63aa81 opened
// Jun 9 sorts BEFORE 6303e6af, which opened May 19).

describe("journal oracle — scoped rebuild-journal convergence for the shared-leg pair (round 5, bug 1, real mechanism)", () => {
  it("8a63aa81 and 6303e6af both converge to their correct openNetDebit/closeNetCredit when rebuilt one-at-a-time, in fix-pnl-reingest's actual processing order", async () => {
    const fillsRepo = makeMemoryFillsRepo();
    const eventsRepo = makeMemoryCalendarEventsRepo();
    const orphansRepo = makeMemoryOrphanFillsRepo();
    const calendarsRepo = makeMemoryCalendarsRepo();

    const sharedLegSeeds = allCalendarSeeds().filter(
      (s) => s.id === CAL_8A63AA81 || s.id === CAL_6303E6AF,
    );
    for (const seed of sharedLegSeeds) {
      fillsRepo.seedCalendar(seed);
    }

    const sharedLegTransactions = realTransactions().filter((tx) =>
      tx.legs.every((l) => l.occSymbol === leg("2026-06-18", 7275) || l.occSymbol === leg("2026-06-23", 7275) || l.occSymbol === leg("2026-07-17", 7275)),
    );
    expect(sharedLegTransactions).toHaveLength(8); // 2 calendars × 4 fills each

    const fetchTransactions: ForFetchingTransactions = async () => ({
      ok: true as const,
      value: sharedLegTransactions,
    });
    const syncTransactions = makeSyncTransactionsUseCase({
      fetchTransactions,
      writeFills: fillsRepo.writeFills,
      hashFillIds: hashIds,
      accountHash: "acct-hash",
      from: "2026-05-01",
      to: "2026-06-30",
      now: () => new Date("2026-07-05T14:00:00Z"),
    });
    const txResult = await syncTransactions();
    expect(txResult.ok).toBe(true);
    expect(fillsRepo.countFills()).toBe(8);

    // Custom recomputeCalendarAmounts reading from the REAL calendar_events store (the
    // in-memory fills-repo's OWN recompute reads a decoupled test-seeded shadow store — same
    // documented quirk as journal-e2e.test.ts's SC5 test).
    const amountsStore = new Map<string, { openNetDebit: number; closeNetCredit: number }>();
    async function recomputeCalendarAmounts(calendarId: string) {
      const result = await recomputeFromRealEvents(eventsRepo, calendarId);
      amountsStore.set(calendarId, result);
      return { ok: true as const, value: undefined };
    }

    const syncFillsForCalendar = makeSyncFillsForCalendarUseCase({
      readUnprocessedFillsForCalendar: fillsRepo.readUnprocessedFillsForCalendar,
      readCalendarLegs: fillsRepo.readCalendarLegs,
      storeCalendarEvent: eventsRepo.storeCalendarEvent,
      storeOrphanFill: orphansRepo.storeOrphanFill,
      resetCalendarAmounts: fillsRepo.resetCalendarAmounts,
      readCalendarEvents: eventsRepo.readCalendarEvents,
      markFillsProcessed: fillsRepo.markFillsProcessed,
      transitionCalendarClosed: calendarsRepo.transitionCalendarClosed,
      newId,
      hashFillIds: hashIds,
      now: () => new Date("2026-07-05T14:00:00Z"),
    });

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents: eventsRepo.deleteCalendarEvents,
      resetCalendarAmounts: fillsRepo.resetCalendarAmounts,
      resetFillsProcessedForCalendar: fillsRepo.resetFillsProcessedForCalendar,
      syncFillsForCalendar,
      recomputeCalendarAmounts,
      now: () => new Date("2026-07-05T14:00:00Z"),
    });

    // Process in fix-pnl-reingest's REAL order: desc(openedAt). 8a63aa81 opened 2026-06-09,
    // 6303e6af opened 2026-05-19 — 8a63aa81 sorts FIRST. This is the exact order that
    // reproduced the prod bug (whichever calendar rebuilds first has no a-priori reason to
    // see the sibling's anchor leg unless the read is order-context-expanded).
    const r1 = await rebuildJournal(CAL_8A63AA81);
    expect(r1.ok).toBe(true);
    const r2 = await rebuildJournal(CAL_6303E6AF);
    expect(r2.ok).toBe(true);

    // No fill was ever orphan-parked as "ambiguous calendar" — the shared front leg resolved
    // correctly on both passes via the order anchor (back leg → its own calendar).
    const orphans = await orphansRepo.getAllOrphans();
    expect(orphans).toHaveLength(0);

    const amounts8a = amountsStore.get(CAL_8A63AA81);
    expect(amounts8a).toBeDefined();
    if (amounts8a !== undefined) {
      expect(amounts8a.openNetDebit).toBeCloseTo(10.2, 2);
      expect(amounts8a.closeNetCredit).toBeCloseTo(10.55, 2);
    }

    const amounts63 = amountsStore.get(CAL_6303E6AF);
    expect(amounts63).toBeDefined();
    if (amounts63 !== undefined) {
      expect(amounts63.openNetDebit).toBeCloseTo(46.0, 2);
      expect(amounts63.closeNetCredit).toBeCloseTo(47.0, 2);
    }

    // Each calendar ends with exactly its own 4 events (2 legs × OPEN+CLOSE) — no
    // cross-contamination between the two calendars sharing the front leg.
    const evs8a = await eventsRepo.readCalendarEvents(CAL_8A63AA81);
    expect(evs8a.ok).toBe(true);
    if (evs8a.ok) expect(evs8a.value).toHaveLength(4);
    const evs63 = await eventsRepo.readCalendarEvents(CAL_6303E6AF);
    expect(evs63.ok).toBe(true);
    if (evs63.ok) expect(evs63.value).toHaveLength(4);

    // Idempotency: rebuilding 8a63aa81 a SECOND time (e.g. a retried orchestrator run)
    // reconverges to the same numbers.
    const r3 = await rebuildJournal(CAL_8A63AA81);
    expect(r3.ok).toBe(true);
    const amounts8aAgain = amountsStore.get(CAL_8A63AA81);
    expect(amounts8aAgain).toBeDefined();
    if (amounts8aAgain !== undefined) {
      expect(amounts8aAgain.openNetDebit).toBeCloseTo(10.2, 2);
      expect(amounts8aAgain.closeNetCredit).toBeCloseTo(10.55, 2);
    }
  });
});
