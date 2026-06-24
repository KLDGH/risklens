import { useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import "./HistoricalChart.css";
import { useThemeColors } from "./useThemeColors";

// row: 0 = tallest (furthest from chart), 1 = mid, 2 = closest
const EVENTS = [
  { year: 1997, label: "Asian\ncrisis",          row: 0 },
  { year: 2000, label: "Dot com\nbubble bursts", row: 0 },
  { year: 2001, label: "9/11",                   row: 1 },
  { year: 2008, label: "Global\nfinancial crisis", row: 0 },
  { year: 2010, label: "Euro\ncrisis",           row: 1 },
  { year: 2020, label: "Covid-19",               row: 0 },
  { year: 2022, label: "Inflation\n& Fed hikes",  row: 1 },
];

const FONT_SIZE = 11;
const LINE_H = FONT_SIZE * 1.4;
// Bottom y of each row (SVG coords from top). Margin top must be >= ROW_BOTTOM[-1] + padding.
const ROW_BOTTOM = [38, 80];

const EventLabel = ({ viewBox, label, row = 0, color = "#3a2f24", lineColor = "#9a8a6a" }) => {
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
        stroke={lineColor} strokeWidth={1} strokeDasharray="3,3"
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={x}
          y={textTop + i * LINE_H + LINE_H - 3}
          textAnchor="middle"
          fill={color}
          fontSize={FONT_SIZE}
          fontWeight="600"
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
        <span>{d?.min_var?.toFixed(2)}%</span>
      </div>
      <div className="tt-row">
        <span style={{ color: "#f59e0b" }}>Max VaR</span>
        <span>{d?.max_var?.toFixed(2)}%</span>
      </div>
      {d?.annual_return_pct != null && (
        <div className="tt-row">
          <span style={{ color: d.annual_return_pct < 0 ? "#e53e3e" : "#4ade80" }}>
            Annual ret
          </span>
          <span>{d.annual_return_pct > 0 ? "+" : ""}{d.annual_return_pct?.toFixed(1)}%</span>
        </div>
      )}
      {d?.vix_avg != null && (
        <div className="tt-row">
          <span style={{ color: "#a78bfa" }}>Avg VIX</span>
          <span>{d.vix_avg?.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
};

const tickFormatter = (v) => {
  if (v === 0) return "0";
  return `${v}%`;
};

export default function HistoricalChart({ data }) {
  const [insightOpen, setInsightOpen] = useState(false);
  const c = useThemeColors();
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
        <span className="chart-subtitle">
          Daily EWMA VaR (1%, % of portfolio) · min &amp; max per year
        </span>
        <button
          className={`insight-toggle${insightOpen ? " open" : ""}`}
          onClick={() => setInsightOpen((o) => !o)}
          aria-expanded={insightOpen}
        >
          {insightOpen ? "▾ Hide insight" : "▸ Key insight"}
        </button>
      </div>
      {insightOpen && (
        <div className="insight-panel">
          <span className="insight-label">💡</span>
          <p>
            The <span className="ins-blue">amber bars</span> show peak daily VaR each
            year — the worst single-day loss the model expected, at the 1% confidence
            level. The <span className="ins-red">red bars</span> show full-year returns
            for years that ended negative. (Both are shown as a percent of the position, so
            the VaR bars and the return bars share one scale — a 15% VaR sits at the
            same height as a 15% loss.) In <strong>2008</strong>, peak daily VaR reached roughly{" "}
            <strong>15%</strong> by mid-year, well before the year's full{" "}
            <strong>38%</strong> loss had been booked. In March <strong>2020</strong>,
            it spiked above <strong>10%</strong> within weeks and fell back under{" "}
            <strong>3%</strong> by September. The model moves with regime shifts as they
            happen; annual returns only confirm them after the fact. The VIX
            line (implied volatility from options) tends to lead
            realized risk.
          </p>
        </div>
      )}
      <div style={{ width: "100%", height: 420 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 110, right: 40, left: 4, bottom: 0 }}
            barCategoryGap="15%"
            barGap={1}
          >
            <CartesianGrid vertical={false} stroke={c.grid} />

            <XAxis
              dataKey="year"
              tick={{ fill: c.axisTick, fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={{ stroke: c.axisLine }}
              interval={4}
            />

            <YAxis
              yAxisId="left"
              tick={{ fill: c.axisTick, fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={tickFormatter}
              width={36}
            />
            <YAxis
              yAxisId="vix"
              orientation="right"
              domain={[0, 90]}
              tick={{ fill: "#a78bfa", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => v === 0 ? "" : `${v}`}
              width={28}
              label={{ value: "VIX", angle: 90, position: "insideRight", fill: "#a78bfa", fontSize: 10, fontFamily: "JetBrains Mono, monospace", dx: 12 }}
            />

            <ReferenceLine y={0} yAxisId="left" stroke={c.axisLine} strokeWidth={1} />

            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />

            <Legend
              verticalAlign="bottom"
              height={28}
              formatter={(value) => {
                const tips = {
                  "Min daily risk": "Lowest EWMA VaR recorded that year — the calmest day's risk estimate.",
                  "Max daily risk": "Highest EWMA VaR recorded that year — the most stressed day's risk estimate.",
                  "Loss for year": "Total annual return when negative. Only drawn for down years.",
                  "Avg VIX": "Annual average VIX (CBOE Volatility Index), implied volatility from S&P 500 options. Right axis. Higher = more volatility priced into options.",
                };
                return (
                  <span
                    title={tips[value] ?? ""}
                    style={{ color: c.textDim, fontSize: 11, fontFamily: "JetBrains Mono, monospace", cursor: "help" }}
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
                yAxisId="left"
                stroke="transparent"
                label={<EventLabel label={e.label} row={e.row} color={c.textBright} lineColor={c.refLine} />}
              />
            ))}

            <Bar yAxisId="left" dataKey="min_var" name="Min daily risk" fill="#4ade80" opacity={0.85} maxBarSize={10} isAnimationActive={false} />
            <Bar yAxisId="left" dataKey="max_var" name="Max daily risk" fill="#f59e0b" opacity={0.75} maxBarSize={10} isAnimationActive={false} />
            <Bar yAxisId="left" dataKey="loss"    name="Loss for year"  fill="#e53e3e" opacity={0.9}  maxBarSize={10} isAnimationActive={false} />
            <Line yAxisId="vix" type="monotone" dataKey="vix_avg" name="Avg VIX" stroke="#a78bfa" strokeWidth={1.5} dot={false} opacity={0.9} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
