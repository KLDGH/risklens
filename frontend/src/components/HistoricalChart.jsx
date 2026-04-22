import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import "./HistoricalChart.css";

const EVENTS = [
  { year: 1929, label: "Great\nDepression" },
  { year: 1939, label: "WWII\nstarts" },
  { year: 1941, label: "US in\nWWII" },
  { year: 1945, label: "WWII ends" },
  { year: 1950, label: "Korean\nwar" },
  { year: 1957, label: "Sputnik\nlaunched" },
  { year: 1962, label: "Cuban\nmissile\ncrisis" },
  { year: 1971, label: "Bretton\nWoods ends" },
  { year: 1973, label: "First oil\nshock" },
  { year: 1979, label: "Second\noil shock" },
  { year: 1981, label: "Interest\nrate shock" },
  { year: 1987, label: "1987\ncrash" },
  { year: 1997, label: "Asian\ncrisis" },
  { year: 2000, label: "Dot com\nbubble bursts" },
  { year: 2001, label: "9/11" },
  { year: 2008, label: "Global\ncrisis" },
  { year: 2010, label: "Euro\ncrisis" },
  { year: 2017, label: "Trump\npresident" },
  { year: 2020, label: "Covid-19" },
  { year: 2022, label: "Ukraine" },
];

const EventLabel = ({ viewBox, label }) => {
  if (!viewBox) return null;
  const { x, y } = viewBox;
  const lines = label.split("\n");
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - 8} stroke="#5a6678" strokeWidth={1} strokeDasharray="2,2" />
      {lines.map((line, i) => (
        <text
          key={i}
          x={x}
          y={y - 12 - (lines.length - 1 - i) * 10}
          textAnchor="middle"
          fill="#7a8899"
          fontSize={8}
          fontFamily="JetBrains Mono, monospace"
        >
          {line}
        </text>
      ))}
    </g>
  );
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const event = EVENTS.find((e) => e.year === d?.year);
  return (
    <div className="chart-tooltip">
      <div className="tt-year">{label}</div>
      {event && <div className="tt-event">{event.label.replace(/\n/g, " ")}</div>}
      <div className="tt-row"><span style={{ color: "var(--green)" }}>Min VaR</span> ${d?.min_var?.toFixed(2)}</div>
      <div className="tt-row"><span style={{ color: "#60a5fa" }}>Max VaR</span> ${d?.max_var?.toFixed(2)}</div>
      {d?.annual_return_pct != null && (
        <div className="tt-row">
          <span style={{ color: d.annual_return_pct < 0 ? "var(--red)" : "var(--green)" }}>
            Annual ret
          </span>{" "}
          {d.annual_return_pct > 0 ? "+" : ""}{d.annual_return_pct?.toFixed(1)}%
        </div>
      )}
    </div>
  );
};

export default function HistoricalChart({ data }) {
  if (!data?.length) return null;

  // Only show negative returns as bars; positive years get null so no bar renders
  const chartData = data.map((d) => ({
    ...d,
    loss: d.annual_return_pct != null && d.annual_return_pct < 0 ? d.annual_return_pct : null,
  }));

  const eventYears = new Set(EVENTS.map((e) => e.year));
  const visibleEvents = EVENTS.filter((e) =>
    chartData.some((d) => d.year === e.year)
  );

  return (
    <div className="historical-chart-wrapper">
      <div className="chart-header">
        <span className="chart-title">S&amp;P 500 Risk and Losses</span>
        <span className="chart-subtitle">Daily EWMA VaR (1% / $100 portfolio) · min &amp; max per year</span>
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={chartData} margin={{ top: 60, right: 20, left: 0, bottom: 0 }} barCategoryGap="10%">
          <CartesianGrid vertical={false} stroke="#1e2530" />

          <XAxis
            dataKey="year"
            tick={{ fill: "#5a6678", fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
            tickLine={false}
            axisLine={{ stroke: "#1e2530" }}
            interval={4}
          />

          {/* Left axis: risk in $ */}
          <YAxis
            yAxisId="risk"
            orientation="left"
            domain={[0, "auto"]}
            tick={{ fill: "#5a6678", fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v}`}
            label={{
              value: "Risk ($)",
              angle: -90,
              position: "insideLeft",
              offset: 12,
              style: { fill: "#5a6678", fontSize: 9, fontFamily: "JetBrains Mono, monospace" },
            }}
          />

          {/* Right axis: annual return % */}
          <YAxis
            yAxisId="return"
            orientation="right"
            domain={["auto", 0]}
            tick={{ fill: "#5a6678", fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
            label={{
              value: "Annual return if negative",
              angle: 90,
              position: "insideRight",
              offset: 16,
              style: { fill: "#5a6678", fontSize: 9, fontFamily: "JetBrains Mono, monospace" },
            }}
          />

          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />

          <Legend
            verticalAlign="bottom"
            height={28}
            formatter={(value) => (
              <span style={{ color: "#8a9ab0", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}>
                {value}
              </span>
            )}
          />

          {/* Event reference lines */}
          {visibleEvents.map((e) => (
            <ReferenceLine
              key={e.year}
              x={e.year}
              yAxisId="risk"
              stroke="transparent"
              label={<EventLabel label={e.label} />}
            />
          ))}

          <Bar yAxisId="risk" dataKey="min_var" name="Min daily risk" fill="#4ade80" opacity={0.85} maxBarSize={12} />
          <Bar yAxisId="risk" dataKey="max_var" name="Max daily risk" fill="#60a5fa" opacity={0.75} maxBarSize={12} />
          <Bar yAxisId="return" dataKey="loss" name="Loss for year" fill="#e53e3e" opacity={0.9} maxBarSize={12} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
