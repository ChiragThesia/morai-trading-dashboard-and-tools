import { LiveStatusBadge } from "@morai/web";

const row = { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" } as const;
const base = { lastTickAt: new Date("2026-07-24T14:32:07.000Z"), isRth: true, hasReceivedFirstTick: true, isReconnecting: false, onReconnect: () => {} };

/** The three stream states: live (pulsing dot), quiet (no ticks but healthy), stalled. */
export function Statuses() {
  return (
    <div style={row}>
      <LiveStatusBadge {...base} status="live" />
      <LiveStatusBadge {...base} status="quiet" />
      <LiveStatusBadge {...base} status="stalled" />
    </div>
  );
}

/** Outside RTH the badge must not claim liveness. */
export function OutsideRth() {
  return (
    <div style={row}>
      <LiveStatusBadge {...base} status="quiet" isRth={false} />
      <LiveStatusBadge {...base} status="stalled" isRth={false} />
    </div>
  );
}

/** Before the first tick, and while a reconnect is in flight. */
export function ConnectingAndReconnecting() {
  return (
    <div style={row}>
      <LiveStatusBadge {...base} status="quiet" hasReceivedFirstTick={false} />
      <LiveStatusBadge {...base} status="stalled" isReconnecting />
    </div>
  );
}
