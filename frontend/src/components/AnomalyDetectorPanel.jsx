import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Scatter,
  ScatterChart,
  ComposedChart,
  Cell,
} from "recharts";
import "./AnomalyDetectorPanel.css";
import { useThemeColors } from "./useThemeColors";

// Color palette per detector — chosen so none collide with the amber
// accent (which is reserved for primary UI). Each detector keeps a
// distinct hue across the price-chart markers, the subpanel lines,
// and the recent-anomaly chips.
const DETECTOR_COLORS = {
  zscore:      "#06b6d4",   // cyan
  cusum_pos:   "#ef4444",   // red (positive drift = up)
  cusum_neg:   "#facc15",   // yellow (negative drift = down)
  garch_resid: "#a78bfa",   // violet
};

const DETECTOR_LABELS = {
  zscore:      "Z-score (|z| ≥ 3)",
  cusum_pos:   "CUSUM up-shift",
  cusum_neg:   "CUSUM down-shift",
  garch_resid: "GARCH residual",
};

// Common tick formatting on the shared date axis
function fmtDate(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y.slice(2)}`;
}


/* ---------- Risk Profile Card ----------
   Compact row of stat cards showing the SAME risk metrics that the
   Portfolio Risk tab uses, but applied to the single selected ETF.
   Surfaces what the asset's standalone risk looks like before / next
   to the detector signals. */
function RiskProfileCard({ profile, ticker }) {
  if (!profile) return null;
  const stat = (label, value, unit) => (
    <div className="rp-stat" key={label}>
      <div className="rp-stat-label">{label}</div>
      <div className="rp-stat-value">{value}</div>
      {unit && <div className="rp-stat-unit">{unit}</div>}
    </div>
  );
  return (
    <div className="risk-profile-card">
      <div className="rp-header">
        <span className="rp-title">Risk profile — {ticker}</span>
        <span className="rp-subtitle">
          Same models as the Portfolio Risk tab, on this ETF's own NAV.
          Daily 1% VaR/ES on a $100 position.
        </span>
      </div>
      <div className="rp-row">
        {stat(
          "60d Vol",
          `${profile.vol_60d_annualized_pct.toFixed(1)}%`,
          "annualized"
        )}
        {stat("β vs SPY",  profile.beta_spy_252d?.toFixed(2) ?? "—", "252-day OLS")}
        {stat("VaR (HS)",      `$${profile.var_hs.toFixed(2)}`,      "non-parametric")}
        {stat("VaR (EWMA)",    `$${profile.var_ewma.toFixed(2)}`,    "Gaussian, λ=0.94")}
        {stat("VaR (GARCH-t)", `$${profile.var_garch.toFixed(2)}`,   "Student-t innov.")}
        {stat("VaR (EVT)",     `$${profile.var_evt.toFixed(2)}`,     "GPD-tail")}
        {stat("Tail α",  profile.tail_index?.toFixed(2) ?? "—", "Hill estimator")}
      </div>
    </div>
  );
}


/* ---------- Factor Regression Panel ----------
   Fama-French 5 + Momentum loadings table — open-data substitute for a
   Barra-style multi-factor risk decomposition. Shows per-factor β with
   t-stat / significance stars, plus the R² and the vol decomposition
   (total = factor + idiosyncratic, in annualized-percent units).

   Lit refs cited in the section description elsewhere. The choice of
   factor set follows Carhart (1997) plus the Fama-French (2015) RMW
   and CMA additions — the de-facto institutional baseline. */
function FactorRegressionPanel({ model }) {
  if (!model) return null;
  const sig = (p) =>
      p < 0.001 ? "***"
    : p < 0.01  ? "**"
    : p < 0.05  ? "*"
    : "";
  return (
    <div className="factor-regression-panel">
      <div className="fr-header">
        <div>
          <div className="fr-title">Factor risk model</div>
          <div className="fr-subtitle">
            {model.model} · OLS regression on excess returns, last {model.lookback_days} trading days
            ({model.first_date} → {model.last_date}).
            Open-data substitute for Barra-style multi-factor attribution.
          </div>
        </div>
        <div className="fr-headline-stats">
          <div className="fr-headline">
            <span className="fr-headline-value">{(model.r_squared * 100).toFixed(1)}%</span>
            <span className="fr-headline-label">R²</span>
          </div>
          <div className="fr-headline">
            <span className="fr-headline-value">{model.factor_variance_share_pct.toFixed(0)}%</span>
            <span className="fr-headline-label">variance from factors</span>
          </div>
        </div>
      </div>

      <table className="fr-table">
        <thead>
          <tr>
            <th>Factor</th>
            <th className="num">Loading (β)</th>
            <th className="num">t-stat</th>
            <th className="num">p-value</th>
            <th>Sig.</th>
          </tr>
        </thead>
        <tbody>
          {model.loadings.map((l) => (
            <tr key={l.factor} className={l.significant ? "" : "fr-row-dim"}>
              <td>{l.label}</td>
              <td className="num">
                <span style={{ color: l.beta >= 0 ? "#86efac" : "#fca5a5" }}>
                  {l.beta >= 0 ? "+" : ""}{l.beta.toFixed(3)}
                </span>
              </td>
              <td className="num">{l.tstat.toFixed(2)}</td>
              <td className="num">{l.p_value.toFixed(3)}</td>
              <td className="fr-sig">{sig(l.p_value)}</td>
            </tr>
          ))}
          <tr className="fr-alpha-row">
            <td>α (intercept)</td>
            <td className="num">
              {model.alpha_daily_pct >= 0 ? "+" : ""}{model.alpha_daily_pct.toFixed(3)}%/day
            </td>
            <td className="num">{model.alpha_tstat.toFixed(2)}</td>
            <td className="num">{model.alpha_pvalue.toFixed(3)}</td>
            <td className="fr-sig">{sig(model.alpha_pvalue)}</td>
          </tr>
        </tbody>
      </table>

      <div className="fr-vol-decomp">
        <span className="fr-vol-label">Annualized vol decomposition:</span>
        <span className="fr-vol-pair">
          total <strong>{model.total_vol_annualized_pct.toFixed(1)}%</strong>
        </span>
        <span className="fr-vol-pair fr-vol-factor">
          factor <strong>{model.factor_vol_annualized_pct.toFixed(1)}%</strong>
        </span>
        <span className="fr-vol-pair fr-vol-idio">
          idiosyncratic <strong>{model.idio_vol_annualized_pct.toFixed(1)}%</strong>
        </span>
        <span className="fr-vol-formula">
          σ²<sub>idio</sub> = σ²<sub>total</sub> × (1 − R²)
        </span>
      </div>

      <div className="fr-footnote">
        Significance: <code>***</code> p&lt;0.001 &middot; <code>**</code> p&lt;0.01 &middot; <code>*</code> p&lt;0.05.
        Refs: Fama &amp; French (1993, 2015); Carhart (1997). Daily factor data from the
        Ken French Data Library, public.
      </div>
    </div>
  );
}


/* ---------- Rolling Factor Loadings Panel ----------
   Medium-horizon companion to the single-snapshot FF regression above.
   For each of the six factors, shows how the asset's loading on that
   factor has drifted over the last 5 years (monthly rolling 252-day
   regressions).

   The "is this asset still doing what I bought it to do?" view. Style
   drift alerts at the top: a factor moves more than 1 std-dev from
   its long-run rolling mean.

   Each mini-chart shows: rolling loading line + dashed reference line
   at the long-run mean. Latest value rendered as the rightmost data
   point and highlighted in the chip below.

   Time horizon — 1-2 year cycles for sector rotations, style regime
   shifts, thesis drift in held names. The horizon a long-horizon PM
   actually decides on, vs the daily detectors below which fire at
   single-event frequency. */

const FACTOR_AXIS_COLOR = "#7e8794";

function MiniFactorChart({ factor, snapshots, longRunMean, longRunStd, color, label, latest }) {
  const c = useThemeColors();
  // Latest snapshot value
  const cur = latest[factor];

  // Compute y-axis domain to comfortably fit data + reference lines
  const values = snapshots.map((s) => s[factor]);
  const minV = Math.min(...values, longRunMean - longRunStd);
  const maxV = Math.max(...values, longRunMean + longRunStd);
  const pad = (maxV - minV) * 0.15 || 0.1;
  const domain = [minV - pad, maxV + pad];

  // Drift magnitude in std-dev units
  const sdOff = longRunStd > 1e-6 ? (cur - longRunMean) / longRunStd : 0;
  const isDrifting = Math.abs(sdOff) >= 1.0;

  return (
    <div className="mini-factor-chart">
      <div className="mini-factor-header">
        <span className="mini-factor-label" style={{ color }}>{label}</span>
        <span className="mini-factor-current">
          {cur >= 0 ? "+" : ""}{cur.toFixed(2)}
          <span className="mini-factor-mu">
            {" / μ="}
            {longRunMean >= 0 ? "+" : ""}{longRunMean.toFixed(2)}
          </span>
        </span>
      </div>
      <div className="mini-factor-chart-area">
        <ResponsiveContainer width="100%" height={100}>
          <LineChart
            data={snapshots}
            margin={{ top: 4, right: 8, left: 4, bottom: 0 }}
          >
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis
              dataKey="date"
              tick={false}
              tickLine={false}
              axisLine={{ stroke: c.axisLine }}
            />
            <YAxis
              domain={domain}
              tick={{ fill: c.axisTick, fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              width={32}
              tickFormatter={(v) => (v >= 0 ? "+" : "") + v.toFixed(1)}
            />
            <Tooltip
              labelFormatter={(d) => d}
              formatter={(v) => [Number(v).toFixed(3), label]}
              contentStyle={{
                background: c.bg2, border: `1px solid ${c.border}`,
                fontFamily: "JetBrains Mono, monospace", fontSize: 11,
                color: c.text,
              }}
            />
            <ReferenceLine y={longRunMean} stroke={color} strokeDasharray="3 3" strokeOpacity={0.55} />
            <ReferenceLine y={0} stroke={c.refLine} strokeWidth={0.7} />
            <Line
              type="monotone"
              dataKey={factor}
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {isDrifting && (
        <div className="mini-factor-drift">
          {sdOff > 0 ? "▲" : "▼"} {Math.abs(sdOff).toFixed(1)}σ from long-run
        </div>
      )}
    </div>
  );
}


// Per-factor color palette — distinct from the accent and from the
// detector colors used below. These line colors don't carry semantic
// meaning beyond "tell the six factors apart visually."
const FACTOR_COLORS = {
  "Mkt-RF": "#f59e0b",   // amber (the market — most prominent)
  "SMB":    "#06b6d4",   // cyan
  "HML":    "#a78bfa",   // violet
  "RMW":    "#84cc16",   // lime
  "CMA":    "#fb7185",   // rose
  "MOM":    "#22d3ee",   // light cyan
};


function RollingFactorLoadingsPanel({ rolling }) {
  if (!rolling || !rolling.snapshots?.length) return null;
  const latest = rolling.snapshots[rolling.snapshots.length - 1];
  const drift = rolling.drift_alerts ?? [];
  const factors = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "MOM"];

  return (
    <div className="rolling-factor-panel">
      <div className="rolling-factor-header">
        <div>
          <div className="rfp-title">Factor loadings over time</div>
          <div className="rfp-subtitle">
            How each factor exposure has drifted across rolling 252-day
            windows over the last {rolling.lookback_years} years (stepped
            monthly). The dashed line in each chart is the long-run mean.
            A loading moving &gt; 1σ from its own long-run mean is flagged
            as style drift — the medium-cycle (months-to-years) horizon at
            which sector rotations, style regimes, and thesis drift play out.
          </div>
        </div>
        <div className="rfp-window-stat">
          <span className="rfp-window-value">{rolling.n_snapshots}</span>
          <span className="rfp-window-label">rolling windows</span>
        </div>
      </div>

      {drift.length > 0 && (
        <div className="rfp-drift-banner">
          <span className="rfp-drift-title">⚠ Style drift detected:</span>
          <div className="rfp-drift-list">
            {drift.map((a) => (
              <span key={a.factor} className="rfp-drift-chip">
                <strong>{a.factor}</strong> {a.direction} to{" "}
                {a.current >= 0 ? "+" : ""}{a.current.toFixed(2)}{" "}
                <em>(μ = {a.long_run_mean >= 0 ? "+" : ""}{a.long_run_mean.toFixed(2)}, {a.std_devs_off >= 0 ? "+" : ""}{a.std_devs_off.toFixed(1)}σ)</em>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rfp-chart-grid">
        {factors.map((f) => (
          <MiniFactorChart
            key={f}
            factor={f}
            snapshots={rolling.snapshots}
            longRunMean={rolling.long_run_means[f]}
            longRunStd={rolling.long_run_stds[f]}
            color={FACTOR_COLORS[f]}
            label={rolling.factor_labels[f]}
            latest={latest}
          />
        ))}
      </div>

      <div className="rfp-footnote">
        Window: 252 trading days, stepped every 21 days (~monthly).
        Lookback: {rolling.lookback_years} years.
        Time range: {rolling.first_date} → {rolling.last_date}.
        A drift flag does not imply something is wrong — it identifies factors
        worth investigating, e.g., a fund that bought as quality-growth might
        be drifting toward value or losing its profitability tilt.
      </div>
    </div>
  );
}


/* ---------- Stacked detector subpanel ----------
   One chart per detector, sharing a common X-axis with the price chart
   above. The line is the detector value over time, with ±threshold
   reference lines so users can see at a glance when the line crosses
   into "this is anomalous" territory. */
function DetectorSubpanel({
  data, field, label, color, threshold, twoSided = true, secondField = null, secondColor = null,
}) {
  const c = useThemeColors();
  return (
    <div className="detector-subpanel">
      <div className="detector-label">
        <span className="detector-dot" style={{ background: color }} />
        {label}
        <span className="detector-threshold">threshold ±{threshold}</span>
      </div>
      <div className="detector-chart">
        <ResponsiveContainer width="100%" height={120}>
          <LineChart
            data={data}
            margin={{ top: 6, right: 18, left: 4, bottom: 0 }}
          >
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis
              dataKey="date"
              tick={false}      // shared x-axis label rendered only on the last chart
              tickLine={false}
              axisLine={{ stroke: c.axisLine }}
            />
            <YAxis
              tick={{ fill: c.axisTick, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              labelFormatter={(d) => fmtDate(d)}
              contentStyle={{
                background: c.bg2, border: `1px solid ${c.border}`,
                fontFamily: "JetBrains Mono, monospace", fontSize: 11,
                color: c.text,
              }}
              formatter={(v, key) =>
                v == null ? "—" : [Number(v).toFixed(3), DETECTOR_LABELS[key] ?? key]
              }
            />

            <ReferenceLine y={threshold}  stroke={color} strokeDasharray="4 3" strokeOpacity={0.45} />
            {twoSided && (
              <ReferenceLine y={-threshold} stroke={color} strokeDasharray="4 3" strokeOpacity={0.45} />
            )}
            <ReferenceLine y={0} stroke={c.refLine} strokeWidth={1} />

            <Line
              type="monotone"
              dataKey={field}
              stroke={color}
              strokeWidth={1.4}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            {secondField && (
              <Line
                type="monotone"
                dataKey={secondField}
                stroke={secondColor}
                strokeWidth={1.4}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}


/* ---------- Price chart with anomaly markers ----------
   Top panel showing the closing price line with colored dots overlaid
   on dates where one or more detectors fired. Each marker's color
   matches the first-firing detector for that date (multi-detector
   days appear as a richer-colored / outlined dot). */
function PriceChartWithAnomalies({ series, anomalies, ticker }) {
  const c = useThemeColors();
  // Build a quick lookup so the ScatterChart layer can render markers
  // at the right (date, price) coordinates.
  const anomalyByDate = useMemo(() => {
    const map = {};
    for (const a of anomalies) map[a.date] = a;
    return map;
  }, [anomalies]);

  // Each row in the data has a synthetic `anomaly_price` set on flagged
  // dates only — recharts will render the Scatter only where defined.
  const data = useMemo(
    () =>
      series.map((r) => {
        const a = anomalyByDate[r.date];
        return {
          ...r,
          anomaly_price: a ? r.price : null,
          anomaly_color: a ? DETECTOR_COLORS[a.detectors[0]] : null,
          anomaly_n:     a ? a.detectors.length : 0,
        };
      }),
    [series, anomalyByDate]
  );

  return (
    <div className="anomaly-price-chart">
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 8, right: 18, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis
            dataKey="date"
            tick={false}
            tickLine={false}
            axisLine={{ stroke: c.axisLine }}
          />
          <YAxis
            tick={{ fill: c.axisTick, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v) => `$${v.toFixed(0)}`}
          />
          <Tooltip
            labelFormatter={(d) => fmtDate(d)}
            contentStyle={{
              background: c.bg2, border: `1px solid ${c.border}`,
              fontFamily: "JetBrains Mono, monospace", fontSize: 11,
              color: c.text,
            }}
            formatter={(v, key, p) => {
              if (v == null) return "—";
              if (key === "price")  return [`$${Number(v).toFixed(2)}`, ticker];
              if (key === "anomaly_price") {
                const a = anomalyByDate[p.payload.date];
                if (!a) return ["—", ""];
                return [`${a.detectors.length} detector(s)`, "Anomaly"];
              }
              return [v, key];
            }}
          />

          <Line
            type="monotone"
            dataKey="price"
            stroke="#d97706"
            strokeWidth={1.6}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Scatter
            dataKey="anomaly_price"
            isAnimationActive={false}
            shape={(props) => {
              const { cx, cy, payload } = props;
              if (payload.anomaly_price == null) return null;
              const r = 4 + Math.min(3, payload.anomaly_n - 1);
              return (
                <circle
                  cx={cx} cy={cy} r={r}
                  fill={payload.anomaly_color}
                  fillOpacity={0.85}
                  stroke="#0d1526"
                  strokeWidth={1}
                />
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}


/* ---------- Shared bottom date axis ----------
   A free-floating x-axis that spans the same width as the stacked
   panels above. Recharts doesn't make a cross-chart shared axis easy,
   so we just render the last chart's axis below and hide it everywhere
   else. */
function SharedDateAxis({ data }) {
  const c = useThemeColors();
  return (
    <div className="shared-date-axis">
      <ResponsiveContainer width="100%" height={28}>
        <LineChart data={data} margin={{ top: 0, right: 18, left: 4, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fill: c.axisTick, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
            tickFormatter={(v) => fmtDate(v)}
            tickLine={false}
            axisLine={{ stroke: c.axisLine }}
            interval={Math.max(0, Math.floor(data.length / 10))}
          />
          <YAxis hide width={36} />
          <Line dataKey="zscore" stroke="transparent" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}


/* ---------- Recent-anomaly chips ----------
   Bottom panel listing the most recent ~15 dates flagged, with the
   detectors that fired and the magnitude of the move. Lets a reader
   tie the flag back to a real date and reason about whether it
   matches a known event. */
function RecentAnomaliesList({ anomalies }) {
  if (!anomalies.length) {
    return (
      <div className="anomaly-list-empty">
        No anomalies flagged in this window.
      </div>
    );
  }
  // Most recent first
  const recent = anomalies.slice(-15).reverse();
  return (
    <div className="anomaly-list">
      <div className="anomaly-list-header">
        Recent flagged dates ({anomalies.length} total · showing newest {recent.length})
      </div>
      <div className="anomaly-rows">
        {recent.map((a) => (
          <div key={a.date} className="anomaly-row">
            <div className="anomaly-date">{fmtDate(a.date)}</div>
            <div className="anomaly-ret" style={{ color: a.ret_pct >= 0 ? "#86efac" : "#fca5a5" }}>
              {a.ret_pct >= 0 ? "+" : ""}{a.ret_pct.toFixed(2)}%
            </div>
            <div className="anomaly-detectors">
              {a.detectors.map((d) => (
                <span
                  key={d}
                  className="anomaly-detector-chip"
                  style={{
                    color: DETECTOR_COLORS[d],
                    borderColor: DETECTOR_COLORS[d],
                  }}
                  title={DETECTOR_LABELS[d]}
                >
                  {DETECTOR_LABELS[d]}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


export default function AnomalyDetectorPanel({ views }) {
  const tickers = views?.tickers ?? [];
  const [ticker, setTicker] = useState(tickers[0] ?? null);

  if (!tickers.length || !ticker) {
    return (
      <div className="anomaly-empty">
        No anomaly views available. Run the backend to populate.
      </div>
    );
  }

  const view = views.data[ticker];
  if (!view) return null;

  const fmtTickerLabel = (t) => `${t} — ${views.names[t] ?? t}`;

  return (
    <div className="anomaly-panel">
      <div className="anomaly-controls">
        <div className="anomaly-control-group">
          <span className="anomaly-control-label">Sector ETF</span>
          <select
            className="anomaly-ticker-select"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
          >
            {tickers.map((t) => (
              <option key={t} value={t}>{fmtTickerLabel(t)}</option>
            ))}
          </select>
        </div>
        <div className="anomaly-stats">
          <span><strong>{view.series.length}</strong> trading days</span>
          <span className="anomaly-stat-sep">·</span>
          <span><strong>{view.anomalies.length}</strong> anomaly day(s) flagged</span>
          <span className="anomaly-stat-sep">·</span>
          <span>z-score window <strong>{view.params.zscore_window}d</strong></span>
          <span className="anomaly-stat-sep">·</span>
          <span>lookback <strong>{view.params.lookback_days}d</strong></span>
        </div>
      </div>

      <RiskProfileCard profile={view.risk_profile} ticker={ticker} />

      <FactorRegressionPanel model={view.factor_model} />

      <RollingFactorLoadingsPanel rolling={view.factor_model_rolling} />

      <div className="anomaly-chart-stack">
        <div className="anomaly-chart-title">
          {ticker} closing price · anomaly markers colored by first-firing detector
        </div>
        <PriceChartWithAnomalies
          series={view.series}
          anomalies={view.anomalies}
          ticker={ticker}
        />

        <DetectorSubpanel
          data={view.series}
          field="zscore"
          label="Standardized return z-score"
          color={DETECTOR_COLORS.zscore}
          threshold={view.thresholds.zscore}
          twoSided
        />
        <DetectorSubpanel
          data={view.series}
          field="cusum_pos"
          secondField="cusum_neg"
          secondColor={DETECTOR_COLORS.cusum_neg}
          label="Page CUSUM (two-sided mean shift)"
          color={DETECTOR_COLORS.cusum_pos}
          threshold={view.thresholds.cusum}
          twoSided
        />
        <DetectorSubpanel
          data={view.series}
          field="garch_resid"
          label="GARCH-residual outlier (residual after conditional-vol adjustment)"
          color={DETECTOR_COLORS.garch_resid}
          threshold={view.thresholds.garch_resid}
          twoSided
        />

        <SharedDateAxis data={view.series} />
      </div>

      <RecentAnomaliesList anomalies={view.anomalies} />

      <div className="anomaly-footnote">
        Each detector answers a different question:{" "}
        <strong style={{ color: DETECTOR_COLORS.zscore }}>z-score</strong>{" "}
        flags single-day shocks vs the trailing 60-day mean/std;{" "}
        <strong style={{ color: DETECTOR_COLORS.cusum_pos }}>CUSUM</strong>{" "}
        catches sustained drifts that individual days don't reveal (Page 1954);{" "}
        <strong style={{ color: DETECTOR_COLORS.garch_resid }}>GARCH residual</strong>{" "}
        flags days the conditional volatility model didn't anticipate. A
        date hitting multiple detectors is a stronger signal than any one
        detector firing alone — disagreement among detectors is the signal,
        same principle as the VaR table on the Portfolio Risk tab.
      </div>
    </div>
  );
}
