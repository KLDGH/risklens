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
import CalendarHeatmap from "./CalendarHeatmap.jsx";
import "./HistoricalChart.css"; // reuse shared chart styles
import { useThemeColors } from "./useThemeColors";

// Color scale for correlation cells/bars. Sign drives hue (red = rates regime,
// green = growth regime). Magnitude drives opacity — strong correlations
// look more saturated, weak ones look pale.
function corrColor(c) {
  if (c == null) return "rgba(255, 255, 255, 0.04)";  // empty cell
  const intensity = Math.min(1, Math.abs(c));
  const opacity = 0.18 + intensity * 0.78;  // baseline 0.18 → 0.96
  return c >= 0
    ? `rgba(229, 62, 62, ${opacity})`     // red, rates regime
    : `rgba(0, 201, 122, ${opacity})`;    // green, growth regime
}

function barFill(c) {
  if (c == null) return "#444";
  return c >= 0 ? "#e53e3e" : "#00c97a";
}

const INTERVAL_LABELS = {
  "5m":  { label: "5 min",  obsPerDay: 78 },
  "15m": { label: "15 min", obsPerDay: 26 },
};


const BarTooltip = ({ active, payload, label, intervalLabel }) => {
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
        <span style={{ color: "var(--text-dim)" }}>{intervalLabel} bars</span>
        <span>{d?.n_obs}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
        {strength} {sign}
      </div>
    </div>
  );
};


export default function IntradayCorrelationChart({ data }) {
  // data is now an object: { interval_5m: [...], interval_15m: [...] }
  const [samplingInterval, setSamplingInterval] = useState("15m");
  const [view, setView] = useState("calendar");  // "calendar" or "bar"
  const [estimator, setEstimator] = useState("naive");  // "naive" or "qmle"
  const [insightOpen, setInsightOpen] = useState(false);
  const c = useThemeColors();

  // Backward-compat: if data is still a flat array (old format), wrap it
  const rawSeries =
    Array.isArray(data) ? data
    : data?.[`interval_${samplingInterval}`] ?? [];

  if (!rawSeries.length) return null;

  // QMLE fields are only present in newer JSON output. If absent, hide the
  // estimator toggle and behave as before.
  const hasQmle = rawSeries.some((r) => r.corr_qmle != null);
  const useQmle = hasQmle && estimator === "qmle";

  // Project the active estimator onto a `corr` field so downstream rendering
  // (calendar heatmap, bar chart, streak detection) doesn't have to branch.
  const series = useQmle
    ? rawSeries.map((r) => ({ ...r, corr: r.corr_qmle ?? r.corr }))
    : rawSeries.map((r) => ({ ...r, corr: r.corr_naive ?? r.corr }));

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
  // independence at the observed same-sign rate.
  const sameSignRate = lastSign > 0 ? (nPositive / nTotal) : ((nTotal - nPositive) / nTotal);
  const streakProbability = Math.pow(sameSignRate, streak);
  const oddsAgainst = streakProbability > 0
    ? Math.max(1, Math.round(1 / streakProbability))
    : null;
  const probText = (oddsAgainst != null && oddsAgainst >= 10)
    ? ` · 1 in ${oddsAgainst.toLocaleString()} by chance`
    : "";

  const streakLabel =
    streak === 0 ? null
  : streak === 1 ? null
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
          {useQmle && <> · <em>QMLE-cleaned (Aït-Sahalia–Fan–Xiu 2010)</em></>}
        </span>

        <button
          className={`insight-toggle${insightOpen ? " open" : ""}`}
          onClick={() => setInsightOpen((o) => !o)}
          aria-expanded={insightOpen}
        >
          {insightOpen ? "▾ Hide insight" : "▸ Key insight"}
        </button>
      </div>

      <div className="intraday-controls">
        <div className="control-group">
          <span className="control-label">View</span>
          <div className="interval-toggle interval-toggle--inline">
            <button
              className={`interval-btn${view === "calendar" ? " active" : ""}`}
              onClick={() => setView("calendar")}
            >
              Calendar
            </button>
            <button
              className={`interval-btn${view === "bar" ? " active" : ""}`}
              onClick={() => setView("bar")}
            >
              Bar
            </button>
          </div>
        </div>

        {availableIntervals && availableIntervals.length > 1 && (
          <div className="control-group">
            <span className="control-label">Bars</span>
            <div className="interval-toggle interval-toggle--inline">
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
          </div>
        )}

        {hasQmle && (
          <div
            className="control-group"
            title="Naive: realized correlation from log returns. QMLE: noise-robust integrated correlation via AFX 2010 polarization on Xiu 2010 univariate IV."
          >
            <span className="control-label">Estimator</span>
            <div className="interval-toggle interval-toggle--inline">
              <button
                className={`interval-btn${estimator === "naive" ? " active" : ""}`}
                onClick={() => setEstimator("naive")}
              >
                Naive
              </button>
              <button
                className={`interval-btn${estimator === "qmle" ? " active" : ""}`}
                onClick={() => setEstimator("qmle")}
              >
                QMLE
              </button>
            </div>
          </div>
        )}
      </div>

      {streakLabel && (
        <div className={`intraday-streak-callout ${lastSign > 0 ? "rates" : "growth"}`}>
          <span className="streak-bullet">●</span>
          <span className="streak-text">{streakLabel}</span>
        </div>
      )}

      {insightOpen && (
        <div className="insight-panel insight-panel--stacked">
          <span className="insight-label">💡</span>
          <div className="insight-content">
          <p>
            Each cell or bar is one trading day's correlation between SPY and TLT
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
          <p style={{ marginTop: 8 }}>
            <strong>Calendar vs bar view.</strong> Calendar makes streak
            patterns visually obvious — solid blocks of one color tell the
            regime story at a glance. Bar makes individual-day magnitudes more
            comparable. Same data, two views.
          </p>

          {hasQmle && (
            <p style={{ marginTop: 8 }}>
              <strong>Naive vs QMLE estimator.</strong> Naive realized
              correlation can be biased by microstructure noise (bid-ask
              bounce, tick discreteness): observed log prices behave as
              <em> latent log price + iid noise</em>, which inflates each
              series' realized variance and attenuates correlation. The QMLE
              option applies <em>Xiu (2010)</em> univariate quasi-MLE on the
              MA(1) representation of noisy log returns to recover integrated
              variance, then combines those via the <em>Aït-Sahalia–Fan–Xiu
              (2010)</em> polarization identity{" "}
              <code>Cov(X,Y) = [IV(X+Y) − IV(X−Y)] / 4</code> for the
              covariance numerator. The classical underlying observation is{" "}
              <em>Epps (1979)</em>: correlations between contemporaneously
              sampled returns shrink toward zero as the sampling frequency
              rises, driven by non-synchronous trading and microstructure
              noise.
            </p>
          )}
          {hasQmle && (
            <p style={{ marginTop: 8, paddingLeft: 12, borderLeft: "2px solid #3a4554" }}>
              <strong>Caveat at this granularity.</strong> QMLE earns its keep
              when noise variance is non-trivial relative to per-observation
              signal variance — typically 1-minute or tick data, or pairs with
              wide bid-ask spreads. SPY and TLT are extremely liquid (penny
              spreads, near-continuous prints), so at 5-minute and 15-minute
              bars the signal-to-noise ratio is high (~5–15× for SPY, ~2–4×
              for TLT). Expected impact on correlation: |Δρ| typically ≤ 0.05
              on most days. The polarization identity also has known
              small-sample variance issues at our N (26 obs at 15m, 78 at 5m),
              so per-day QMLE values are noisier than naive even though the
              <em>average</em> bias is small. The streak/regime structure on
              high-conviction days is preserved across estimators — that
              robustness check is the main reason this toggle exists.
            </p>
          )}
          {hasQmle && (
            <p style={{ marginTop: 8, fontSize: 11, color: c.textDim }}>
              References:{" "}
              <a href="https://www.jstor.org/stable/2286348" target="_blank" rel="noopener noreferrer" style={{ color: c.textDim }}>
                Epps (1979)
              </a>
              {" · "}
              <a href="https://www.sciencedirect.com/science/article/abs/pii/S0304407610000242" target="_blank" rel="noopener noreferrer" style={{ color: c.textDim }}>
                Xiu (2010)
              </a>
              {" · "}
              <a href="https://www.tandfonline.com/doi/abs/10.1198/jasa.2010.tm10163" target="_blank" rel="noopener noreferrer" style={{ color: c.textDim }}>
                Aït-Sahalia, Fan & Xiu (2010)
              </a>
            </p>
          )}
          </div>
        </div>
      )}

      {view === "calendar" ? (
        <CalendarHeatmap
          data={series}
          valueKey="corr"
          colorFn={(c) => corrColor(c)}
          cellSize={44}
          formatHover={(c) => (
            <>
              <strong>{c.date}</strong>
              {" · "}SPY-TLT correlation:{" "}
              <strong style={{ color: c.corr >= 0 ? "#fca5a5" : "#86efac" }}>
                {c.corr >= 0 ? "+" : ""}{c.corr.toFixed(3)}
              </strong>
              {" · "}{c.n_obs} {intervalMeta.label} bars
              {" · "}{Math.abs(c.corr) >= 0.6 ? "strong" : Math.abs(c.corr) >= 0.3 ? "moderate" : "weak"}{" "}
              {c.corr >= 0 ? "rates regime" : "growth regime"}
            </>
          )}
          legendStops={[
            [-0.9, "−0.9"],
            [-0.5, "−0.5"],
            [-0.2, ""],
            [+0.2, ""],
            [+0.5, "+0.5"],
            [+0.9, "+0.9"],
          ]}
        />
      ) : (
        <div style={{ width: "100%", height: 380 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={series}
              margin={{ top: 16, right: 40, left: 4, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke={c.grid} />

              <XAxis
                dataKey="date"
                tickFormatter={(v) => {
                  const parts = v.split("-");
                  return `${parts[1]}-${parts[2]}`;
                }}
                interval={tickInterval}
                tick={{ fill: c.axisTick, fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}
                tickLine={false}
                axisLine={{ stroke: c.axisLine }}
              />

              <YAxis
                domain={[-1, 1]}
                tickFormatter={(v) => v.toFixed(1)}
                tick={{ fill: c.axisTick, fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}
                tickLine={false}
                axisLine={false}
                width={36}
              />

              <Tooltip
                content={<BarTooltip intervalLabel={intervalMeta.label} />}
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
              />

              <ReferenceLine y={0} stroke="#3a4554" strokeWidth={1.5} />

              <Bar dataKey="corr" maxBarSize={18} isAnimationActive={false}>
                {series.map((d, i) => (
                  <Cell key={i} fill={barFill(d.corr)} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

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
