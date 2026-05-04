import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
  ResponsiveContainer,
} from "recharts";
import "./HistoricalChart.css"; // reuse shared chart styles

// Per-day bar color: red if positive corr (rates regime), green if negative
function barColor(c) {
  if (c == null) return "#444";
  return c >= 0 ? "#e53e3e" : "#00c97a";
}

const INTERVAL_LABELS = {
  "5m":  { label: "5 min",  obsPerDay: 78 },
  "15m": { label: "15 min", obsPerDay: 26 },
};

const CustomTooltip = ({ active, payload, label, intervalLabel }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const c = d?.corr;
  const sign = c >= 0 ? "rates regime" : "growth regime";
  const strength =
      Math.abs(c) >= 0.6 ? "strong"
    : Math.abs(c) >= 0.3 ? "moderate"
                          : "weak";
  return (
    <div className="chart-tooltip">
      <div className="tt-year">{label}</div>
      <div className="tt-row">
        <span style={{ color: c >= 0 ? "#e53e3e" : "#4ade80" }}>SPY-TLT corr</span>
        <span>{c >= 0 ? "+" : ""}{c?.toFixed(3)}</span>
      </div>
      <div className="tt-row">
        <span style={{ color: "#8896aa" }}>{intervalLabel} bars</span>
        <span>{d?.n_obs}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: "#8896aa", lineHeight: 1.4 }}>
        {strength} {sign}
      </div>
    </div>
  );
};


export default function IntradayCorrelationChart({ data }) {
  // data is now an object: { interval_5m: [...], interval_15m: [...] }
  // Default to 15m (less microstructure noise, academic-literature standard).
  const [samplingInterval, setSamplingInterval] = useState("15m");
  const [insightOpen, setInsightOpen] = useState(false);

  // Backward-compat: if data is still a flat array (old format), wrap it
  const series =
    Array.isArray(data) ? data
    : data?.[`interval_${samplingInterval}`] ?? [];

  if (!series.length) return null;

  const intervalMeta = INTERVAL_LABELS[samplingInterval] ?? { label: samplingInterval, obsPerDay: "?" };

  // Identify trailing same-sign streak (the regime-shift signal)
  const last = series[series.length - 1];
  const lastSign = last.corr > 0 ? 1 : last.corr < 0 ? -1 : 0;
  let streak = 0;
  if (lastSign !== 0) {
    for (let i = series.length - 1; i >= 0; i--) {
      const s = series[i].corr > 0 ? 1 : series[i].corr < 0 ? -1 : 0;
      if (s === lastSign) streak++;
      else break;
    }
  }

  const nPositive = series.filter((d) => d.corr > 0).length;
  const nTotal = series.length;
  const pctPositive = ((nPositive / nTotal) * 100).toFixed(0);

  // Probability of the trailing streak occurring by chance under daily
  // independence at the observed same-sign rate. If 78% of days are positive
  // and the streak is positive, baseline p = 0.78 and P(streak ≥ k) = p^k.
  // This is more informative than the "p = 0.5" null because it tests "is the
  // regime DEEPER than the average daily rate would predict" rather than
  // "is correlation different from zero".
  const sameSignRate = lastSign > 0 ? (nPositive / nTotal) : ((nTotal - nPositive) / nTotal);
  const streakProbability = Math.pow(sameSignRate, streak);
  const oddsAgainst = streakProbability > 0
    ? Math.max(1, Math.round(1 / streakProbability))
    : null;
  // Only show the probability if the streak is meaningfully unusual
  const probText = (oddsAgainst != null && oddsAgainst >= 10)
    ? ` · 1 in ${oddsAgainst.toLocaleString()} by chance`
    : "";

  // Streak callout (regime + magnitude qualifier)
  const streakLabel =
    streak === 0 ? null
  : streak === 1 ? null  // single-day streak isn't a regime signal
  : lastSign > 0 ? `${streak} consecutive positive days — rates-regime signal${probText}`
                 : `${streak} consecutive negative days — growth-regime / diversification working${probText}`;

  const availableIntervals = Array.isArray(data)
    ? null
    : Object.keys(data ?? {}).map((k) => k.replace("interval_", ""));

  const tickInterval = Math.max(1, Math.floor(series.length / 8));

  return (
    <div className="historical-chart-wrapper" style={{ marginTop: 0 }}>
      <div className="chart-header">
        <span className="chart-subtitle">
          SPY × TLT correlation from {intervalMeta.label} bars · daily values · {nTotal} trading days · {pctPositive}% positive
        </span>

        {availableIntervals && availableIntervals.length > 1 && (
          <div className="interval-toggle">
            {availableIntervals.map((iv) => (
              <button
                key={iv}
                className={`interval-btn${samplingInterval === iv ? " active" : ""}`}
                onClick={() => setSamplingInterval(iv)}
              >
                {INTERVAL_LABELS[iv]?.label ?? iv}
              </button>
            ))}
          </div>
        )}

        <button
          className={`insight-toggle${insightOpen ? " open" : ""}`}
          onClick={() => setInsightOpen((o) => !o)}
          aria-expanded={insightOpen}
        >
          {insightOpen ? "▾ Hide insight" : "▸ Key insight"}
        </button>
      </div>

      {streakLabel && (
        <div className={`intraday-streak-callout ${lastSign > 0 ? "rates" : "growth"}`}>
          <span className="streak-bullet">●</span>
          <span className="streak-text">{streakLabel}</span>
        </div>
      )}

      {insightOpen && (
        <div className="insight-panel">
          <span className="insight-label">💡</span>
          <p>
            Each bar is one trading day's correlation between SPY and TLT
            <em> within</em> that day, computed from intraday log returns at the
            selected sampling frequency.{" "}
            <strong>Red = positive correlation (rates regime)</strong>: stocks
            and bonds moved the same direction, meaning the day's news driver
            was rates-related rather than growth-related.{" "}
            <strong>Green = negative correlation (growth regime)</strong>: the
            textbook flight-to-safety pattern where bad equity news rallies
            bonds. The strongest signal is the <strong>streak</strong> — a run
            of consecutive same-sign days is statistically a much sharper
            regime-shift indicator than the smoothed 60-day daily-data
            correlation chart above.
          </p>
          <p style={{ marginTop: 8 }}>
            <strong>Why two sampling intervals?</strong> 5-minute bars give 78
            observations per session — tighter per-day estimates that catch
            consistent weak signals (longer streaks). 15-minute bars give 26
            observations per session — cleaner magnitudes (less microstructure
            noise, less Epps-effect attenuation) but more day-to-day noise
            (shorter streaks). The same regime should look directionally
            similar at both frequencies; if it does, the signal is robust.
          </p>
        </div>
      )}

      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={series}
            margin={{ top: 16, right: 40, left: 4, bottom: 0 }}
          >
            <CartesianGrid vertical={false} stroke="#162038" />

            <XAxis
              dataKey="date"
              tickFormatter={(v) => {
                const parts = v.split("-");
                return `${parts[1]}-${parts[2]}`;
              }}
              interval={tickInterval}
              tick={{ fill: "#8896aa", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={{ stroke: "#1e2530" }}
            />

            <YAxis
              domain={[-1, 1]}
              tickFormatter={(v) => v.toFixed(1)}
              tick={{ fill: "#8896aa", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              width={36}
            />

            <Tooltip
              content={<CustomTooltip intervalLabel={intervalMeta.label} />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />

            <ReferenceLine y={0} stroke="#2e4460" strokeWidth={1.5} />

            <Bar dataKey="corr" maxBarSize={12} isAnimationActive={false}>
              {series.map((d, i) => (
                <Cell key={i} fill={barColor(d.corr)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 8, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span>
          Red = positive correlation (rates regime, diversification fails) ·
          Green = negative correlation (growth regime, diversification works)
        </span>
        <span>{intervalMeta.label} bars · last 60 trading days (yfinance limit)</span>
      </div>
    </div>
  );
}
