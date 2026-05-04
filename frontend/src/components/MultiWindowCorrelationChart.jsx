import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";
import "./HistoricalChart.css"; // reuse shared chart styles

const BOND_LABELS = {
  AGG: "AGG · iShares Core US Aggregate Bond",
  TLT: "TLT · iShares 20+ Year Treasury",
  IEF: "IEF · iShares 7-10 Year Treasury",
  LQD: "LQD · iShares Investment Grade Corp",
};

const BOND_SHORT_LABELS = {
  AGG: "AGG (broad agg)",
  TLT: "TLT (long treas.)",
  IEF: "IEF (mid treas.)",
  LQD: "LQD (IG corp.)",
};

// Window-specific styling — 20d sharpest/lightest; 252d thickest/darkest
const WINDOW_STYLES = {
  "20d":  { stroke: "#93c5fd", width: 1.0,  label: "20-day" },
  "60d":  { stroke: "#3b82f6", width: 1.5,  label: "60-day" },
  "252d": { stroke: "#1e3a8a", width: 2.25, label: "252-day" },
};

/** Merge per-window series into a single date-indexed array for recharts. */
function mergeByDate(byWindow) {
  const dateMap = {};
  for (const [w, series] of Object.entries(byWindow)) {
    if (!Array.isArray(series)) continue;
    for (const row of series) {
      if (!dateMap[row.date]) dateMap[row.date] = { date: row.date };
      dateMap[row.date][w] = row.corr;
    }
  }
  return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
}


const CustomTooltip = ({ active, payload, label, bondName }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-year">{label}</div>
      <div className="tt-event">{bondName}</div>
      {["20d", "60d", "252d"].map((w) => {
        const entry = payload.find((p) => p.dataKey === w);
        if (!entry || entry.value == null) return null;
        const c = entry.value;
        return (
          <div key={w} className="tt-row">
            <span style={{ color: WINDOW_STYLES[w].stroke }}>{WINDOW_STYLES[w].label}</span>
            <span>{c >= 0 ? "+" : ""}{c.toFixed(3)}</span>
          </div>
        );
      })}
    </div>
  );
};


export default function MultiWindowCorrelationChart({ data }) {
  const bonds = Object.keys(data || {});
  const [bond, setBond] = useState(bonds.includes("AGG") ? "AGG" : bonds[0]);
  const [insightOpen, setInsightOpen] = useState(false);

  if (!bonds.length) return null;

  const byWindow = data[bond] ?? {};
  const merged = mergeByDate(byWindow);
  if (!merged.length) return null;

  // Latest values for each window — used in the regime callout
  const latest = merged[merged.length - 1];
  const latest_20  = latest["20d"];
  const latest_60  = latest["60d"];
  const latest_252 = latest["252d"];

  // Regime intensification signal:
  // 20d significantly above 252d → recent regime change not yet reflected
  // in the longer-history average
  const intensification = (latest_20 != null && latest_252 != null)
    ? latest_20 - latest_252
    : null;

  const tickInterval = Math.max(1, Math.floor(merged.length / 12));

  return (
    <div className="historical-chart-wrapper" style={{ marginTop: 0 }}>
      <div className="chart-header">
        <span className="chart-title">Stock-Bond Correlation Across Time Scales</span>
        <span className="chart-subtitle">
          SPY × {BOND_SHORT_LABELS[bond] ?? bond} · rolling 20-day / 60-day / 252-day · weekly samples
        </span>

        {bonds.length > 1 && (
          <div className="interval-toggle">
            {bonds.map((b) => (
              <button
                key={b}
                className={`interval-btn${bond === b ? " active" : ""}`}
                onClick={() => setBond(b)}
              >
                {b}
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

      {intensification != null && intensification > 0.15 && (
        <div className="intraday-streak-callout rates">
          <span className="streak-bullet">●</span>
          <span className="streak-text">
            Recent intensification — 20-day correlation ({latest_20.toFixed(2)}) is{" "}
            <strong>{intensification.toFixed(2)} above</strong> the 252-day average
            ({latest_252.toFixed(2)}). The longer window hasn't caught up to the recent regime.
          </span>
        </div>
      )}

      {intensification != null && intensification < -0.15 && (
        <div className="intraday-streak-callout growth">
          <span className="streak-bullet">●</span>
          <span className="streak-text">
            Recent normalization — 20-day correlation ({latest_20.toFixed(2)}) is{" "}
            <strong>{Math.abs(intensification).toFixed(2)} below</strong> the 252-day average.
            The regime appears to be cooling.
          </span>
        </div>
      )}

      {insightOpen && (
        <div className="insight-panel">
          <span className="insight-label">💡</span>
          <p>
            Three rolling windows on the same stock-bond correlation, plotted
            together: <span style={{ color: WINDOW_STYLES["20d"].stroke }}><strong>20-day</strong></span> (fast,
            picks up regime changes within weeks),{" "}
            <span style={{ color: WINDOW_STYLES["60d"].stroke }}><strong>60-day</strong></span> (medium),{" "}
            <span style={{ color: WINDOW_STYLES["252d"].stroke }}><strong>252-day</strong></span> (slow,
            roughly a one-year average). The 20-day line moves first; the
            252-day line is dominated by the prior year's history and only
            shifts decisively after a regime has been live for a long time.
            When the 20-day diverges sharply above the 252-day, you're seeing
            a recent regime change <strong>before</strong> longer-horizon
            measures register it.
          </p>
          <p style={{ marginTop: 8 }}>
            Toggle the bond proxy to compare across the bond-market spectrum.
            <strong> AGG</strong> is the broad investment-grade aggregate (what most
            retail portfolios actually hold).
            <strong> TLT</strong> is long-duration Treasury (most rate-sensitive).
            <strong> IEF</strong> is 7-10 year Treasury (typical "duration risk").
            <strong> LQD</strong> is investment-grade corporate (carries equity-like
            credit-spread behavior, so usually shows higher equity correlation than Treasuries).
          </p>
        </div>
      )}

      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={merged}
            margin={{ top: 16, right: 40, left: 4, bottom: 16 }}
          >
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
              domain={[-0.6, 1]}
              tickFormatter={(v) => v.toFixed(1)}
              tick={{ fill: "#8896aa", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              width={36}
            />

            <Tooltip
              content={<CustomTooltip bondName={BOND_LABELS[bond] ?? bond} />}
              cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }}
            />

            <ReferenceLine y={0} stroke="#2e4460" strokeWidth={1.5} />

            <Legend
              verticalAlign="bottom"
              iconType="line"
              wrapperStyle={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#8896aa" }}
            />

            {Object.entries(WINDOW_STYLES).map(([w, style]) => (
              <Line
                key={w}
                type="monotone"
                dataKey={w}
                name={style.label}
                stroke={style.stroke}
                strokeWidth={style.width}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 8, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span>
          When the 20-day line diverges above the 252-day line, you're seeing a regime change
          before slower measures register it.
        </span>
        <span>{BOND_LABELS[bond] ?? bond} · daily rolling correlation, weekly samples</span>
      </div>
    </div>
  );
}
