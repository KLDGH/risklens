import { useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import "./HistoricalChart.css"; // reuse shared chart styles

// Crisis events — we'll find the nearest data point for each
const CRISES = [
  { target: "2008-10", label: "GFC" },
  { target: "2020-03", label: "COVID" },
  { target: "2022-06", label: "Rate hike cycle" },
  { target: "2025-04", label: "Tariff shock" },
];

function findNearest(data, targetDate) {
  if (!data?.length) return null;
  const t = new Date(targetDate).getTime();
  return data.reduce((best, d) => {
    const diff = Math.abs(new Date(d.date).getTime() - t);
    const bestDiff = Math.abs(new Date(best.date).getTime() - t);
    return diff < bestDiff ? d : best;
  }).date;
}

const CrisisLabel = ({ viewBox, label }) => {
  if (!viewBox) return null;
  const { x, y } = viewBox;
  return (
    <g>
      <text
        x={x + 4}
        y={y + 14}
        fill="#f59e0b"
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
  const corr = d?.avg_corr;
  const vix = d?.vix;
  const corrVal = corr?.toFixed(2);
  const level =
    corr >= 0.65 ? "High — diversification strained"
    : corr >= 0.5 ? "Elevated — assets moving together"
    : corr >= 0.35 ? "Normal — typical market correlation"
    : "Low — strong diversification benefit";
  return (
    <div className="chart-tooltip">
      <div className="tt-year">{d?.date}</div>
      <div className="tt-row">
        <span style={{ color: "#60a5fa" }}>Avg corr</span>
        <span>{corrVal}</span>
      </div>
      {vix != null && (
        <div className="tt-row">
          <span style={{ color: "#f59e0b" }}>VIX (60d avg)</span>
          <span>{vix.toFixed(1)}</span>
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 11, color: "#8896aa", lineHeight: 1.4 }}>
        {level}
      </div>
    </div>
  );
};

export default function CorrelationChart({ data }) {
  const [insightOpen, setInsightOpen] = useState(false);
  if (!data?.length) return null;

  const tickInterval = Math.max(1, Math.floor(data.length / 14));

  // Find nearest dates for crisis annotations
  const crisisLines = CRISES.map((c) => ({
    ...c,
    date: findNearest(data, c.target),
  })).filter((c) => c.date);

  return (
    <div className="historical-chart-wrapper" style={{ marginTop: 24 }}>
      <div className="chart-header">
        <span className="chart-subtitle">
          60-day rolling avg pairwise correlation · SPY QQQ GLD TLT EEM IWM HYG LQD XLF VNQ · VIX (right axis)
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
            <strong>The GFC was a volatility crisis. 2022 was a correlation
            crisis.</strong> In <strong>2008</strong> and <strong>2020</strong>{" "}
            (COVID), the amber VIX line and the blue correlation area moved
            together — equity vol exploded and assets piled into the same
            direction. Classic risk-off. But <strong>2022</strong> broke the
            pattern: cross-asset correlation hit <strong>0.70</strong> — the
            highest in the dataset — while VIX peaked only around{" "}
            <strong>35</strong>. The Fed's hiking cycle pushed stocks <em>and</em>{" "}
            bonds down together without the equity vol spike normally
            associated with crisis. A portfolio looking only at VIX would have
            seen "moderate" stress; the same portfolio looking at correlation
            would have seen the worst diversification breakdown in modern
            history. Vol-driven crises hammer single-asset risk; correlation-driven
            crises hammer the diversification benefit between assets. They
            require different defenses.
          </p>
        </div>
      )}

      <div style={{ width: "100%", height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 16, right: 40, left: 4, bottom: 0 }}
          >
            <defs>
              <linearGradient id="corrFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.55} />
                <stop offset="45%"  stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#0d1526" stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <CartesianGrid vertical={false} stroke="#162038" />

            <XAxis
              dataKey="date"
              tickFormatter={(v) => v.slice(0, 4)}
              interval={tickInterval}
              tick={{ fill: "#8896aa", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={{ stroke: "#1e2530" }}
            />

            <YAxis
              yAxisId="corr"
              domain={[0, 1]}
              tickFormatter={(v) => v.toFixed(1)}
              tick={{ fill: "#8896aa", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              width={38}
            />
            <YAxis
              yAxisId="vix"
              orientation="right"
              domain={[0, 90]}
              tickFormatter={(v) => v === 0 ? "" : `${v}`}
              tick={{ fill: "#f59e0b", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              width={28}
              label={{ value: "VIX", angle: 90, position: "insideRight", fill: "#f59e0b", fontSize: 10, fontFamily: "JetBrains Mono, monospace", dx: 12 }}
            />

            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }} />

            {/* Warning threshold for correlation */}
            <ReferenceLine
              y={0.6}
              yAxisId="corr"
              stroke="#f59e0b"
              strokeDasharray="4 3"
              strokeOpacity={0.6}
              label={{
                value: "diversification under stress",
                position: "insideTopRight",
                fill: "#f59e0b",
                fontSize: 10,
                fontFamily: "JetBrains Mono, monospace",
                opacity: 0.8,
              }}
            />

            {/* Crisis event lines */}
            {crisisLines.map((c) => (
              <ReferenceLine
                key={c.label}
                x={c.date}
                yAxisId="corr"
                stroke="#f59e0b"
                strokeOpacity={0.45}
                strokeWidth={1}
                strokeDasharray="3 3"
                label={<CrisisLabel label={c.label} />}
              />
            ))}

            <Area
              yAxisId="corr"
              type="monotone"
              dataKey="avg_corr"
              stroke="#60a5fa"
              strokeWidth={1.5}
              fill="url(#corrFill)"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="vix"
              type="monotone"
              dataKey="vix"
              stroke="#f59e0b"
              strokeWidth={1.25}
              dot={false}
              opacity={0.85}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 8, textAlign: "right" }}>
        Blue area = correlation (left axis, 0–1) · Amber line = VIX 60-day average (right axis, 0–90) · Crisis labels = 60-day window centered near peak stress
      </div>
    </div>
  );
}
