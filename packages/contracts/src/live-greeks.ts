import { z } from "zod";

// MCP-02: ONE schema source for get_live_greeks MCP tool (plan 07) and HTTP adapter.
// Shape mirrors the LiveGreeks core type returned by makeGetLiveGreeksUseCase.

const legGreeks = z.object({
  occSymbol: z.string(),
  bsmIv: z.string(),
  bsmDelta: z.string(),
  bsmGamma: z.string(),
  bsmTheta: z.string(),
  bsmVega: z.string(),
});

export const liveGreeksResponse = z.object({
  calendarId: z.string().uuid(),
  legs: z.array(legGreeks),
});

export type LegGreeks = z.infer<typeof legGreeks>;
export type LiveGreeksResponse = z.infer<typeof liveGreeksResponse>;
