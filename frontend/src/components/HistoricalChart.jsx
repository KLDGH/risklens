import { useState } from "react";
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
} from "recharts";
import "./HistoricalChart.css";

// row: 0 = tallest (furthest from chart), 1 = mid, 2 = closest
const EVENTS = [
  { year: 1997, label: "Asian\ncrisis",          row: 0 },
  { year: 2000, label: "Dot com\nbubble bursts", row: 0 },
  { year: 2001, label: "9/11",                   row: 1 },
  { year: 2008, label: "Global\nfinancial crisis", row: 0 },
  { year: 2010, label: "Euro\ncrisis",           row: 1 },
  { year: 2020, label: "Covid-19",               row: 0 },
  { year: 2022, label: "Ukraine\nwar",           row: 1 },
];

const FONT_SIZE = 11;
const LINE_H = FONT_SIZE * 1.4;
// Bottom y of each row (SVG coords from top). Margin top must be >= ROW_BOTTOM[-1] + padding.
const ROW_BOTTOM = [38, 80];

const EventLabel = ({ viewBox, label, row = 0 }) => {
  if (!viewBox) return null;
  const { x, y } = viewBox;
  const lines = label.split("\n");
  const blockH = lines.length * LINE_H;
  const bottomY = ROW_BOTTOM[Math.min(row, ROW_BOTTOM.length - 1)];
  const textTop = bottomY - blockH;

  return (
    <g>
      <line
        x1={x} y1={bottomY + 4}
        x2={x} y2={y - 2}
        stroke="#2a4060" strokeWidth={1} strokeDasharray="3,3"
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={x}
          y={textTop + i * LINE_H + LINE_H - 3}
          textAnchor="middle"
          fill="#a8bcd4"
          fontSize={FONT_SIZE}
          fontWeight="500"
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
      <div className="tt-row">
        <span style={{ color: "#4ade80" }}>Min VaR</span>
        <span>${d?.min_var?.toFixed(2)}</span>
      </div>
      <div className="tt-row">
        <span style={{ color: "#60a5fa" }}>Max VaR</span>
        <span>${d?.max_var?.toFixed(2)}</span>
      </div>
      {d?.annual_return_pct != null && (
        <div className="tt-row">
          <span style={{ color: d.annual_return_pct < 0 ? "#e53e3e" : "#4ade80" }}>
            Annual ret
          </span>
          <span>{d.annual_return_pct > 0 ? "+" : ""}{d.annual_return_pct?.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
};

const tickFormatter = (v) => {
  if (v === 0) return "0";
  if (v < 0) return `${v}%`;
  return `$${v}`;
};

export default function HistoricalChart({ data }) {
  const [insightOpen, setInsightOpen] = useState(false);
  if (!data?.length) return null;

  const chartData = data
    .filter((d) => d.year >= 1990)
    .map((d) => ({
      ...d,
      loss: d.annual_return_pct != null && d.annual_return_pct < 0
        ? d.annual_return_pct
        : undefined,
    }));

  const visibleEvents = EVENTS.filter((e) =>
    chartData.some((d) => d.year === e.year)
  );

  return (
    <div className="historical-chart-wrapper">
      <div className="chart-header">
        <span className="chart-title">S&amp;P 500 Risk and Losses</span>
        <span className="chart-subtitle">
          Daily EWMA VaR (1% / $100 portfolio) · min &amp; max per year
        </span>
        <button
          className="insight-toggle"
          onClick={() => setInsightOpen((o) => !o)}
          aria-expanded={insightOpen}
        >
          {insightOpen ? "▾" : "▸"} Key insight
        </button>
      </div>
      {insightOpen && (
        <div className="insight-panel">
          <span className="insight-label">💡</span>
          <p>
            The <span className="ins-blue">blue bars</span> (peak daily risk each year) spike{" "}
            <em>during</em> crises — not after. In 2008, the blue bar hit{" "}
            <strong>$15</strong> on a $100 position before the year's total loss
            was confirmed. In 2020, risk spiked and collapsed within months.
            This is the core value of daily risk monitoring:{" "}
            <strong>the model sees stress building in real time</strong>, while
            annual returns only tell you what already happened.
            The <span className="ins-red">red bars</span> show the damage;
            the <span className="ins-blue">blue bars</span> show the warning.
          </p>
        </div>
      )}
      <div style={{ width: "100%", height: 380 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 110, right: 40, left: 4, bottom: 0 }}
            barCategoryGap="15%"
            barGap={1}
          >
            <CartesianGrid vertical={false} stroke="#162038" />

            <XAxis
              dataKey="year"
              tick={{ fill: "#8896aa", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={{ stroke: "#1e2530" }}
              interval={4}
            />

            <YAxis
              tick={{ fill: "#8896aa", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={tickFormatter}
              width={36}
            />

            <ReferenceLine y={0} stroke="#1e3048" strokeWidth={1} />

            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />

            <Legend
              verticalAlign="bottom"
              height={28}
              formatter={(value) => {
                const tips = {
                  "Min daily risk": "Lowest EWMA VaR recorded that year — the calmest day's risk estimate.",
                  "Max daily risk": "Highest EWMA VaR recorded that year — the most stressed day's risk estimate.",
                  "Loss for year": "Total annual return when negative. Only drawn for down years.",
                };
                return (
                  <span
                    title={tips[value] ?? ""}
                    style={{ color: "#8896aa", fontSize: 11, fontFamily: "JetBrains Mono, monospace", cursor: "help" }}
                  >
                    {value}
                  </span>
                );
              }}
            />

            {visibleEvents.map((e) => (
              <ReferenceLine
                key={e.year}
                x={e.year}
                stroke="transparent"
                label={<EventLabel label={e.label} row={e.row} />}
              />
            ))}

            <Bar dataKey="min_var" name="Min daily risk" fill="#4ade80" opacity={0.85} maxBarSize={10} isAnimationActive={false} />
            <Bar dataKey="max_var" name="Max daily risk" fill="#60a5fa" opacity={0.75} maxBarSize={10} isAnimationActive={false} />
            <Bar dataKey="loss"    name="Loss for year"  fill="#e53e3e" opacity={0.9}  maxBarSize={10} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
