import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import "./HistoricalChart.css"; // reuse shared chart styles
import { useThemeColors } from "./useThemeColors";

// Crisis events — we render the ones that land inside the data window.
// Matches the set used on the Correlation chart so the timelines read in sync.
const CRISES = [
  { target: "2008-10", label: "GFC" },
  { target: "2020-03", label: "COVID" },
  { target: "2022-06", label: "Rate hike cycle" },
  { target: "2025-04", label: "Tariff shock" },
];

function findNearest(data, targetDate) {
  if (!data?.length) return null;
  const t = new Date(targetDate).getTime();
  // Only return a hit if the data window actually contains the target month —
  // otherwise the annotation would land at one end of the chart and mislead
  const first = new Date(data[0].date).getTime();
  const last  = new Date(data[data.length - 1].date).getTime();
  if (t < first || t > last) return null;
  return data.reduce((best, d) => {
    const diff = Math.abs(new Date(d.date).getTime() - t);
    const bestDiff = Math.abs(new Date(best.date).getTime() - t);
    return diff < bestDiff ? d : best;
  }).date;
}

const CrisisLabel = ({ viewBox, label, color = "#3a2f24" }) => {
  if (!viewBox) return null;
  const { x, y } = viewBox;
  return (
    <g>
      <text
        x={x + 4}
        y={y + 14}
        fill={color}
        fontSize={10}
        fontFamily="JetBrains Mono, monospace"
        fontWeight="600"
      >
        {label}
      </text>
    </g>
  );
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const v = d?.var;
  const level =
    v >= 5    ? "High — significant tail risk"
  : v >= 2.5  ? "Elevated — above normal volatility"
  : v >= 1.5  ? "Normal — typical equity-tilted regime"
              : "Low — calm regime";
  return (
    <div className="chart-tooltip">
      <div className="tt-year">{d?.date}</div>
      <div className="tt-row">
        <span style={{ color: "#f59e0b" }}>Daily VaR (1%)</span>
        <span>{v?.toFixed(2)}%</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: "#8896aa", lineHeight: 1.4 }}>
        {level}
      </div>
    </div>
  );
};

export default function PortfolioRiskChart({ data, portfolioLabel }) {
  const [insightOpen, setInsightOpen] = useState(false);
  const c = useThemeColors();
  const crisisLabelColor = c.textBright;  // dark on light / light on dark — readable annotation text
  if (!data?.length) return null;

  const tickInterval = Math.max(1, Math.floor(data.length / 12));

  const crisisLines = CRISES
    .map((c) => ({ ...c, date: findNearest(data, c.target) }))
    .filter((c) => c.date);

  // Events that fall BEFORE the data window starts — surfaced in the caption
  // so users understand why some named crises don't appear as vertical lines.
  const firstDate = new Date(data[0].date).getTime();
  const eventsBeforeWindow = CRISES
    .filter((c) => new Date(c.target).getTime() < firstDate)
    .map((c) => c.label);

  const maxVar = Math.max(...data.map((d) => d.var));
  const yDomain = [0, Math.ceil(maxVar / 2) * 2 + 2];

  return (
    <div className="historical-chart-wrapper" style={{ marginTop: 0 }}>
      <div className="chart-header">
        <span className="chart-subtitle">
          Daily 1% EWMA VaR over time · {portfolioLabel}
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
            This is the same daily EWMA VaR shown in the portfolio summary row
            of the table above, computed on every trading day rather than just
            today. The tooltip shows the loss as a percent of the portfolio.
            Risk regimes shift faster than they normalize:
            spikes appear within days of a crisis starting and decay over weeks
            or months. The current level is the rightmost value; reading left
            tells you whether risk has been climbing, falling, or holding
            steady.
          </p>
        </div>
      )}

      <div style={{ width: "100%", height: 380 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 16, right: 40, left: 4, bottom: 0 }}
          >
            <defs>
              <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.45} />
                <stop offset="50%"  stopColor="#d97706" stopOpacity={0.22} />
                <stop offset="100%" stopColor={c.bg}    stopOpacity={0.04} />
              </linearGradient>
            </defs>

            <CartesianGrid vertical={false} stroke={c.grid} />

            <XAxis
              dataKey="date"
              tickFormatter={(v) => v.slice(0, 4)}
              interval={tickInterval}
              tick={{ fill: c.axisTick, fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={{ stroke: c.axisLine }}
            />

            <YAxis
              domain={yDomain}
              tickFormatter={(v) => `${v}%`}
              tick={{ fill: c.axisTick, fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              width={36}
            />

            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }} />

            {/* Reference threshold lines */}
            <ReferenceLine
              y={2.5}
              stroke="#f0b429"
              strokeDasharray="4 3"
              strokeOpacity={0.4}
              label={{ value: "elevated", position: "insideRight", fill: "#f0b429", fontSize: 10, fontFamily: "JetBrains Mono, monospace", opacity: 0.7 }}
            />
            <ReferenceLine
              y={5}
              stroke="#e53e3e"
              strokeDasharray="4 3"
              strokeOpacity={0.4}
              label={{ value: "high", position: "insideRight", fill: "#e53e3e", fontSize: 10, fontFamily: "JetBrains Mono, monospace", opacity: 0.7 }}
            />

            {/* Crisis annotations */}
            {crisisLines.map((c) => (
              <ReferenceLine
                key={c.label}
                x={c.date}
                stroke="#f59e0b"
                strokeOpacity={0.45}
                strokeWidth={1}
                strokeDasharray="3 3"
                label={<CrisisLabel label={c.label} color={crisisLabelColor} />}
              />
            ))}

            <Area
              type="monotone"
              dataKey="var"
              stroke="#f59e0b"
              strokeWidth={1.5}
              fill="url(#riskFill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 8, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        {eventsBeforeWindow.length > 0 ? (
          <span>
            Earlier events not shown (data starts {data[0].date}): {eventsBeforeWindow.join(", ")}
          </span>
        ) : <span />}
        <span>Y-axis: daily VaR (% loss). Sampled every 5 trading days.</span>
      </div>
    </div>
  );
}
