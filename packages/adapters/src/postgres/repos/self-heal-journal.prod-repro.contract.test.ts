import { describe, beforeAll, beforeEach, it, expect, inject } from "vitest";
import { sql } from "drizzle-orm";
import {
  makeRebuildCalendarHistoryUseCase,
  makeSelfHealJournalUseCase,
} from "@morai/core";
import { makeDb } from "../db.ts";
import { makePostgresCalendarSnapshotsRepo } from "./calendar-snapshots.ts";
import { makePostgresLegObservationsRepo } from "./leg-observations.ts";
import { makePostgresCalendarsRepo } from "./calendars.ts";

/**
 * Prod-repro (40-08): self-heal-journal no-op on top-of-hour gap rows.
 *
 * Mirrors prod calendar c225281e (SPX 7600P, open) on 2026-07-14 EXACTLY:
 *   - mixed-root leg pair: SPX-rooted front (2026-11-20) + SPXW-rooted back (2026-11-30)
 *   - one leg_observation per leg at 14:00:50Z, marks + FILLED bsm_* (the post-BSM state)
 *   - a calendar_snapshots GAP row at exactly 14:00:00.000Z: finite spot/marks/raw-IVs but
 *     'NaN' calibrated IVs/greeks (snapshot ran on a just-fetched, not-yet-BSM'd cohort)
 *
 * Wires the REAL adapters (resolveLegObservationForSlot + healSnapshot + getOpenCalendars)
 * through the REAL use-cases (rebuild + self-heal), runs at now = 16:00:30Z (the cron
 * instant), and asserts the 14:00 gap row becomes a healthy non-gap row.
 *
 * Requires Docker (testcontainers postgres:16); skips when the container URL is absent.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

const CAL_ID = "c225281e-0000-4000-8000-000000000000";
const FRONT_OCC = "SPX   261120P07600000"; // root "SPX" padded to 6 + 261120 + P + 07600000
const BACK_OCC = "SPXW  261130P07600000"; // root "SPXW" padded to 6 + 261130 + P + 07600000
const OBS_TIME = "2026-07-14T14:00:50.000Z"; // freshest obs the live 14:00 snapshot used
const GAP_TIME = "2026-07-14T14:00:00.000Z"; // floored slot anchor of the gap row
const NOW = new Date("2026-07-14T16:00:30.000Z"); // the hourly cron instant

describe.skipIf(shouldSkip)("prod-repro: self-heal-journal heals a top-of-hour gap row", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(() => {
    if (dbUrl) db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.execute(
      sql`TRUNCATE TABLE calendar_snapshots, leg_observations, contracts, calendars CASCADE`,
    );

    // ── calendar c225281e — open SPX 7600P, front 2026-11-20 / back 2026-11-30 ──
    await db.execute(sql`
      INSERT INTO calendars (id, underlying, strike, option_type, front_expiry, back_expiry, qty, status, opened_at, open_net_debit)
      VALUES (${CAL_ID}::uuid, 'SPX', 7600000, 'P', '2026-11-20', '2026-11-30', 1, 'open', '2026-06-24T14:00:00Z'::timestamptz, '10.00')
    `);

    // ── contracts — mixed-root pair (front SPX, back SPXW) ──
    await db.execute(sql`
      INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
      VALUES
        (${FRONT_OCC}, 'SPX', 'SPX',  'P', 'european', 7600000, '2026-11-20', 100),
        (${BACK_OCC},  'SPX', 'SPXW', 'P', 'european', 7600000, '2026-11-30', 100)
    `);

    // ── leg_observations — one per leg at 14:00:50Z, marks + FILLED bsm_* (post-BSM) ──
    await db.execute(sql`
      INSERT INTO leg_observations (time, contract, bid, ask, mark, underlying_price, iv, bsm_iv, bsm_delta, bsm_gamma, bsm_theta, bsm_vega, open_interest, volume, source)
      VALUES
        (${OBS_TIME}::timestamptz, ${FRONT_OCC}, '0', '0', '1290.00', '6300.50', '0.2100', '0.2050', '-0.6200', '0.00030', '-1.8500', '9.4000', 0, 0, 'schwab_chain'),
        (${OBS_TIME}::timestamptz, ${BACK_OCC},  '0', '0', '1305.00', '6300.50', '0.2200', '0.2150', '-0.6100', '0.00029', '-1.7500', '9.9000', 0, 0, 'schwab_chain')
    `);

    // ── calendar_snapshots — GAP row at exactly 14:00:00Z: finite marks, NaN calibrated ──
    await db.execute(sql`
      INSERT INTO calendar_snapshots (time, calendar_id, spot, net_mark, front_mark, back_mark, front_iv, back_iv, front_iv_raw, back_iv_raw, net_delta, net_gamma, net_theta, net_vega, term_slope, dte_front, dte_back, pnl_open, source, trigger)
      VALUES (${GAP_TIME}::timestamptz, ${CAL_ID}::uuid, '6300.50', '15.00', '1290.00', '1305.00', 'NaN', 'NaN', '0.2100', '0.2200', 'NaN', 'NaN', 'NaN', 'NaN', 'NaN', 129, 139, '500', 'schwab_chain', 'scheduled')
    `);
  });

  it("resolves BOTH mixed-root legs for the 14:00 slot from the post-BSM cohort", async () => {
    if (!db) return;
    const legObs = makePostgresLegObservationsRepo(db);
    const anchor = new Date(GAP_TIME);

    const front = await legObs.resolveLegObservationForSlot({
      underlying: "SPX",
      strike: 7600000,
      optionType: "P",
      expiry: "2026-11-20",
      slotAnchor: anchor,
    });
    const back = await legObs.resolveLegObservationForSlot({
      underlying: "SPX",
      strike: 7600000,
      optionType: "P",
      expiry: "2026-11-30",
      slotAnchor: anchor,
    });

    expect(front.ok && front.value).not.toBeNull();
    expect(back.ok && back.value).not.toBeNull();
    if (!front.ok || !back.ok || front.value === null || back.value === null) return;
    // both legs carry finite BSM values by 16:00Z
    expect(front.value.bsmIv).toBe("0.2050");
    expect(back.value.bsmIv).toBe("0.2150");
  });

  it("self-heal converts the 14:00 gap row into a healthy non-gap row (rowsHealed>=1, errors=0)", async () => {
    if (!db) return;
    const snapshots = makePostgresCalendarSnapshotsRepo(db);
    const legObs = makePostgresLegObservationsRepo(db);
    const calendars = makePostgresCalendarsRepo(db);

    const rebuild = makeRebuildCalendarHistoryUseCase({
      resolveLegObservationForSlot: legObs.resolveLegObservationForSlot,
      healSnapshot: snapshots.healSnapshot,
      now: () => NOW,
    });
    const selfHeal = makeSelfHealJournalUseCase({
      getOpenCalendars: calendars.getOpenCalendars,
      rebuildCalendarHistory: rebuild,
      now: () => NOW,
    });

    const result = await selfHeal();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The heal must land on the 14:00 gap slot.
    expect(result.value.errorCount).toBe(0);
    expect(result.value.rowsHealed).toBeGreaterThanOrEqual(1);

    // The stored 14:00 row must now be a healthy non-gap row.
    const journal = await snapshots.readJournal(CAL_ID);
    expect(journal.ok).toBe(true);
    if (!journal.ok || journal.value === null) return;
    const healed = journal.value.find((r) => r.time.getTime() === new Date(GAP_TIME).getTime());
    expect(healed).toBeDefined();
    if (healed === undefined) return;
    expect(Number.isFinite(parseFloat(healed.frontIv))).toBe(true);
    expect(Number.isFinite(parseFloat(healed.backIv))).toBe(true);
    expect(Number.isFinite(parseFloat(healed.netDelta))).toBe(true);
    expect(Number.isFinite(parseFloat(healed.netTheta))).toBe(true);
  });

  // ROOT-CAUSE CHARACTERIZATION: the observation the gap row was built from is timestamped just
  // BEFORE the floored slot anchor. The live snapshot-calendars writer floors its trigger instant
  // to the slot boundary but pairs it with the globally-latest leg_observation; when the hourly
  // compute-bsm-greeks cron ("0 * * * *") triggers the snapshot at the top of the hour, that
  // latest obs can be the PREVIOUS fetch (here 13:59:30Z). resolveLegObservationForSlot's
  // [anchor, anchor+30min) window (455b84c) is BLIND to a pre-anchor observation, so the 14:00
  // gap row is never re-resolved — it stays NaN, silently, with errorCount 0.
  //
  // This test asserts the CURRENT (buggy) behavior — it flips to a heal-assert the day the
  // resolve window is widened to also cover the writer's pre-anchor observation.
  it("ROOT CAUSE: obs at 13:59:30Z (pre-anchor) leaves the 14:00 gap row UNHEALED (window blind spot)", async () => {
    if (!db) return;
    // Move both observations to 13:59:30Z (one slot early — pre-anchor), all else identical.
    await db.execute(sql`DELETE FROM leg_observations`);
    await db.execute(sql`
      INSERT INTO leg_observations (time, contract, bid, ask, mark, underlying_price, iv, bsm_iv, bsm_delta, bsm_gamma, bsm_theta, bsm_vega, open_interest, volume, source)
      VALUES
        ('2026-07-14T13:59:30.000Z'::timestamptz, ${FRONT_OCC}, '0', '0', '1290.00', '6300.50', '0.2100', '0.2050', '-0.6200', '0.00030', '-1.8500', '9.4000', 0, 0, 'schwab_chain'),
        ('2026-07-14T13:59:30.000Z'::timestamptz, ${BACK_OCC},  '0', '0', '1305.00', '6300.50', '0.2200', '0.2150', '-0.6100', '0.00029', '-1.7500', '9.9000', 0, 0, 'schwab_chain')
    `);

    const snapshots = makePostgresCalendarSnapshotsRepo(db);
    const legObs = makePostgresLegObservationsRepo(db);
    const calendars = makePostgresCalendarsRepo(db);
    const rebuild = makeRebuildCalendarHistoryUseCase({
      resolveLegObservationForSlot: legObs.resolveLegObservationForSlot,
      healSnapshot: snapshots.healSnapshot,
      now: () => NOW,
    });
    const selfHeal = makeSelfHealJournalUseCase({
      getOpenCalendars: calendars.getOpenCalendars,
      rebuildCalendarHistory: rebuild,
      now: () => NOW,
    });

    const result = await selfHeal();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No error surfaced — the miss is an honest-gap, not an error (why prod stayed silent).
    expect(result.value.errorCount).toBe(0);

    const journal = await snapshots.readJournal(CAL_ID);
    expect(journal.ok).toBe(true);
    if (!journal.ok || journal.value === null) return;
    const row = journal.value.find((r) => r.time.getTime() === new Date(GAP_TIME).getTime());
    expect(row).toBeDefined();
    if (row === undefined) return;
    // The 14:00 gap row is STILL a gap — the pre-anchor obs is invisible to the slot window.
    expect(Number.isFinite(parseFloat(row.frontIv))).toBe(false);
  });
});
