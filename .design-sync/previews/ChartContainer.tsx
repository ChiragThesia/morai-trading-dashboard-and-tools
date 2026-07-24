import { ChartContainer, ChartLegendContent, ChartTooltipContent } from "@morai/web";
import { Area, AreaChart, CartesianGrid, Legend, XAxis, YAxis } from "@morai/web"; // same recharts instance the bundle uses

const DATA = Array.from({ length: 25 }, (_, i) => {
  const spot = 7200 + i * 25;
  return { spot, gamma: Math.round(((spot - 7450) * 0.42 + Math.sin(i / 2) * 8) * 10) / 10 };
});

const config = { gamma: { label: "Net γ", color: "#26a69a" } };

/**
 * ChartContainer supplies the recharts responsive wrapper AND the chart context that
 * ChartTooltipContent / ChartLegendContent read — those two throw outside it.
 */
export function AreaChartInContainer() {
  return (
    <ChartContainer config={config} style={{ width: 620, aspectRatio: 2.6 }}>
      <AreaChart data={DATA} margin={{ top: 12, right: 16, bottom: 20, left: 8 }}>
        <CartesianGrid stroke="#1b2433" vertical={false} />
        <XAxis dataKey="spot" tick={{ fill: "#566273", fontSize: 10 }} axisLine={{ stroke: "#27313f" }} />
        <YAxis tick={{ fill: "#566273", fontSize: 10 }} axisLine={{ stroke: "#27313f" }} />
        <Area type="monotone" dataKey="gamma" stroke="#26a69a" fill="#26a69a" fillOpacity={0.18} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}

/** The same container with the DS legend rendered from `config`. */
export function WithLegend() {
  return (
    <ChartContainer config={config} style={{ width: 620, aspectRatio: 2.6 }}>
      <AreaChart data={DATA} margin={{ top: 12, right: 16, bottom: 20, left: 8 }}>
        <CartesianGrid stroke="#1b2433" vertical={false} />
        <XAxis dataKey="spot" tick={{ fill: "#566273", fontSize: 10 }} axisLine={{ stroke: "#27313f" }} />
        <YAxis tick={{ fill: "#566273", fontSize: 10 }} axisLine={{ stroke: "#27313f" }} />
        <Legend content={<ChartLegendContent />} />
        <Area type="monotone" dataKey="gamma" stroke="#26a69a" fill="#26a69a" fillOpacity={0.18} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}

/** The tooltip body, rendered inside the container's chart context with a real payload. */
export function TooltipBody() {
  return (
    <ChartContainer config={config} style={{ width: 300, aspectRatio: 2 }}>
      <AreaChart data={DATA}>
        <Area dataKey="gamma" stroke="#26a69a" fill="none" isAnimationActive={false} />
        <Legend
          content={
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <ChartTooltipContent
                active
                label={7450}
                payload={[{ name: "gamma", dataKey: "gamma", value: 0.4, color: "#26a69a", payload: { spot: 7450, gamma: 0.4 } }]}
              />
              <ChartLegendContent payload={[{ value: "gamma", dataKey: "gamma", color: "#26a69a", type: "line" }]} />
            </div>
          }
        />
      </AreaChart>
    </ChartContainer>
  );
}
