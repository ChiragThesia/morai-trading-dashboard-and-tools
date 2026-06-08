import { describe, it, expect, beforeEach } from "vitest";
import type { ForGettingOpenCalendars, ForPingingDb } from "@morai/core";

/**
 * Shared contract-test suite for the calendars repository port.
 * Run this suite against BOTH the Postgres adapter (testcontainers)
 * and the in-memory adapter (no Docker needed).
 *
 * Factory receives a repo that also satisfies ForPingingDb in addition
 * to ForGettingOpenCalendars.
 */
export type CalendarsRepo = {
  readonly getOpenCalendars: ForGettingOpenCalendars;
  readonly pingDb: ForPingingDb;
  /** Optional seed method — called in beforeEach to insert test data */
  readonly seedOpenCalendar?: (calendar: {
    id: string;
    underlying: string;
    openedAt: Date;
  }) => Promise<void>;
};

export function runCalendarsContractTests(
  makeRepo: () => CalendarsRepo,
): void {
  describe("calendars contract", () => {
    let repo: CalendarsRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    describe("pingDb", () => {
      it("returns ok(undefined) against a reachable store", async () => {
        const result = await repo.pingDb();
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBeUndefined();
        }
      });
    });

    describe("getOpenCalendars", () => {
      it("returns ok([]) when the store is empty", async () => {
        const result = await repo.getOpenCalendars();
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toEqual([]);
        }
      });

      it("returns ok([calendar]) after seeding one open calendar", async () => {
        if (!repo.seedOpenCalendar) {
          // Postgres adapter seeds via SQL; memory adapter seeds via seedOpenCalendar
          return;
        }
        const calendar = {
          id: "aaaaaaaa-0000-0000-0000-000000000001",
          underlying: "SPX",
          openedAt: new Date("2026-01-02T14:30:00Z"),
        };
        await repo.seedOpenCalendar(calendar);

        const result = await repo.getOpenCalendars();
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toHaveLength(1);
          const cal = result.value[0];
          expect(cal).toBeDefined();
          if (cal !== undefined) {
            expect(cal.id).toBe(calendar.id);
            expect(cal.underlying).toBe(calendar.underlying);
            expect(cal.openedAt.toISOString()).toBe(
              calendar.openedAt.toISOString(),
            );
          }
        }
      });
    });
  });
}
