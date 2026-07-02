/**
 * status-dto.ts — serialize the core StatusPayload to the wire contract.
 *
 * The core domain carries `Date` objects on token freshness (expiresAt,
 * refreshIssuedAt); the `statusResponse` contract expects ISO datetime STRINGS
 * (status.ts: "ISO datetime strings (Date serialized from core domain type)").
 * Both the HTTP /status route and the MCP get_status tool must serialize through
 * this single mapper — passing the raw payload to `statusResponse.parse` throws
 * (Date != string) and 500s the healthcheck. `lastJobRuns` is already ISO strings
 * (JobRunRecord.lastSuccessAt/lastErrorAt are `string | null`), so only the
 * token-freshness Dates need conversion.
 */
import { statusResponse } from "@morai/contracts";
import type { StatusResponse } from "@morai/contracts";
import type { StatusPayload, AppTokenStatus } from "@morai/core";

function serializeApp(app: AppTokenStatus) {
  return {
    status: app.status,
    expiresAt: app.expiresAt === null ? null : app.expiresAt.toISOString(),
    refreshIssuedAt:
      app.refreshIssuedAt === null ? null : app.refreshIssuedAt.toISOString(),
    lastRefreshError: app.lastRefreshError,
    refreshExpiresIn: app.refreshExpiresIn,
  };
}

/** Map the core StatusPayload to the validated wire response (Dates → ISO strings). */
export function toStatusResponse(payload: StatusPayload): StatusResponse {
  const tf = payload.tokenFreshness;
  const tokenFreshness =
    tf === "none yet"
      ? tf
      : { trader: serializeApp(tf.trader), market: serializeApp(tf.market) };

  return statusResponse.parse({
    db: payload.db,
    tokenFreshness,
    lastJobRuns: payload.lastJobRuns,
    version: payload.version,
    uptime: payload.uptime,
  });
}
