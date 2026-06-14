import { describe } from "vitest";
import { runCalendarSnapshotsContractTests } from "../__contract__/calendar-snapshots.contract.ts";
import { makeMemoryCalendarSnapshotsRepo } from "./calendar-snapshots.ts";
import type { MemoryCalendarSnapshotsRepo } from "./calendar-snapshots.ts";
import type { LegSnapshot } from "@morai/core";
import type { OccSymbol } from "@morai/shared";

/**
 * Contract test for the in-memory calendar-snapshots adapter.
 * No Docker required — runs always.
 *
 * Verifies twin parity with the Postgres adapter per architecture-boundaries §8.
 * In particular: readJournal MUST return null for an unknown calendarId,
 * matching the Postgres adapter (WR-07 fix).
 */
describe("in-memory calendar-snapshots adapter", () => {
  // Holder so getSeedContext (created first) can reference the repo created by makeRepo.
  // makeRepo runs second in beforeEach, populates holder.current before any test body runs.
  const holder: { current: MemoryCalendarSnapshotsRepo | null } = { current: null };

  runCalendarSnapshotsContractTests(
    (_seed) => {
      const repo = makeMemoryCalendarSnapshotsRepo();
      holder.current = repo;
      return {
        persistSnapshot: repo.persistSnapshot,
        readJournal: repo.readJournal,
        resolveLegSnapshot: repo.resolveLegSnapshot,
        countSnapshots: async (calendarId: string): Promise<number> => {
          // Read through the public port — safe because countSnapshots is only called
          // for known calendarIds in the contract suite (after seedCalendar).
          const result = await repo.readJournal(calendarId);
          if (!result.ok || result.value === null) return 0;
          return result.value.length;
        },
      };
    },
    () => ({
      seedCalendar: async (id: string): Promise<void> => {
        if (holder.current === null) {
          throw new Error("seedCalendar called before makeRepo — holder not populated");
        }
        holder.current.seedCalendar(id);
      },
      seedContract: async (
        _occ: OccSymbol,
        _strike: number,
        _expiration: string,
        _optionType: "C" | "P",
      ): Promise<void> => {
        // Memory adapter resolves legs via seedLegSnapshot — no separate contracts table.
        // The resolveLegSnapshot contract tests seed via seedObservation below.
      },
      seedObservation: async (
        occ: OccSymbol,
        _time: Date,
        mark: number,
        underlyingPrice: number,
        bsmIv: string | null,
        bsmDelta: string | null,
        bsmGamma: string | null,
        bsmTheta: string | null,
        bsmVega: string | null,
        ivRaw: number | null,
      ): Promise<void> => {
        if (holder.current === null) {
          throw new Error("seedObservation called before makeRepo — holder not populated");
        }
        // Parse the OCC symbol to recover the seedLegSnapshot key fields.
        // OCC format (Morai): ROOT  YYMMDD T STRIKE8 e.g. "SPX   260718C05000000"
        const raw = String(occ).trim();
        const m = /^([A-Z0-9]+)\s+(\d{6})([CP])(\d{8})$/.exec(raw);
        if (!m) return; // malformed — skip
        const [, root, dateStr, typeChar, strikeStr] = m;
        if (!root || !dateStr || !typeChar || !strikeStr) return;
        const yy = dateStr.slice(0, 2);
        const mm = dateStr.slice(2, 4);
        const dd = dateStr.slice(4, 6);
        const expiry = `20${yy}-${mm}-${dd}`;
        const strike = Number(strikeStr); // already ×1000 int
        const optionType: "C" | "P" = typeChar === "C" ? "C" : "P";

        const leg: LegSnapshot = {
          occSymbol: occ,
          mark,
          underlyingPrice,
          ivRaw,
          bsmIv,
          bsmDelta,
          bsmGamma,
          bsmTheta,
          bsmVega,
        };
        holder.current.seedLegSnapshot(root, strike, optionType, expiry, leg);
      },
    }),
  );
});
