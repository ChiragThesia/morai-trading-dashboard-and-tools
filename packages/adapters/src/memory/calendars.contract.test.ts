import { describe } from "vitest";
import { runCalendarsContractTests } from "../__contract__/calendars.contract.ts";
import { makeMemoryCalendarsRepo } from "./calendars.ts";

/**
 * Contract test for the in-memory calendars adapter.
 * No Docker required — runs always.
 */
describe("in-memory adapter", () => {
  runCalendarsContractTests(() => makeMemoryCalendarsRepo());
});
