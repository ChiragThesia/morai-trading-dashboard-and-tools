import { BulletGauge, SectionLabel } from "@morai/web";

const wrap = { display: "flex", flexDirection: "column", gap: 18, maxWidth: 380 } as const;

function Gauge(props: { label: string; value: string } & Record<string, unknown>) {
  const { label, value, ...rest } = props;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <SectionLabel tone="dim">{label}</SectionLabel>
        <span className="font-mono tabular-nums text-txt">{value}</span>
      </div>
      {/* eslint-disable-next-line */}
      <BulletGauge {...(rest as never)} />
    </div>
  );
}

/** variant="banded": warn/crisis bands shade the track behind the marker. */
export function Banded() {
  return (
    <div style={wrap}>
      <Gauge
        label="VIX" value="17.17"
        min={10} max={40} value={17.17} variant="banded" bandWarn={20} bandCrisis={30}
        markerColorClass="bg-up" ariaLabel="VIX" ariaValueText="17.17 — calm"
        testId="g-vix" markerTestId="g-vix-marker"
      />
      <Gauge
        label="VIX / VIX3M" value="0.94"
        min={0.7} max={1.3} value={0.94} variant="banded" bandWarn={1.0} bandCrisis={1.1}
        markerColorClass="bg-amber" ariaLabel="VIX to VIX3M ratio" ariaValueText="0.94 — contango"
        testId="g-ratio" markerTestId="g-ratio-marker"
      />
      <Gauge
        label="Put/call ratio" value="1.42"
        min={0.5} max={1.8} value={1.42} variant="banded" bandWarn={1.1} bandCrisis={1.35}
        markerColorClass="bg-down" ariaLabel="Put call ratio" ariaValueText="1.42 — crisis band"
        testId="g-pc" markerTestId="g-pc-marker"
      />
    </div>
  );
}

/** variant="neutral": no bands — a plain position-in-range track. */
export function Neutral() {
  return (
    <div style={wrap}>
      <Gauge
        label="Spot in strike band" value="7 482"
        min={7300} max={7700} value={7482} variant="neutral"
        markerColorClass="bg-blue" ariaLabel="Spot within the strike band" ariaValueText="7482 of 7300 to 7700"
        testId="g-spot" markerTestId="g-spot-marker"
      />
      <Gauge
        label="Days held" value="12 / 45"
        min={0} max={45} value={12} variant="neutral"
        markerColorClass="bg-violet" ariaLabel="Days held" ariaValueText="12 of 45 days"
        testId="g-held" markerTestId="g-held-marker"
      />
    </div>
  );
}

/** Out-of-range values clamp the marker to the track without distorting the printed value. */
export function Clamped() {
  return (
    <div style={wrap}>
      <Gauge
        label="VIX (spike)" value="58.20"
        min={10} max={40} value={58.2} variant="banded" bandWarn={20} bandCrisis={30}
        markerColorClass="bg-down" ariaLabel="VIX" ariaValueText="58.20 — above range"
        testId="g-spike" markerTestId="g-spike-marker"
      />
    </div>
  );
}
