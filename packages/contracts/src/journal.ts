import { z } from "zod";

// MCP-02: ONE schema source for both GET /api/journal/:calendarId and MCP get_journal tool (plan 07).
// Both adapters import from here; a one-sided change fails typecheck.

export const snapshotResponse = z.object({
  time: z.string().datetime(),
  calendarId: z.string().uuid(),
  spot: z.string(),
  netMark: z.string(),
  frontMark: z.string(),
  backMark: z.string(),
  frontIv: z.string(),
  backIv: z.string(),
  frontIvRaw: z.string(),
  backIvRaw: z.string(),
  netDelta: z.string(),
  netGamma: z.string(),
  netTheta: z.string(),
  netVega: z.string(),
  termSlope: z.string(),
  dteFront: z.number().int(),
  dteBack: z.number().int(),
  pnlOpen: z.string(),
  source: z.enum(["cboe", "schwab_chain", "computed_only"]),
});

export type SnapshotResponse = z.infer<typeof snapshotResponse>;

export const journalResponse = z.object({
  snapshots: z.array(snapshotResponse),
});

export type JournalResponse = z.infer<typeof journalResponse>;
