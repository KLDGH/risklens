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
import InfoTip from "./InfoTip.jsx";

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
   Compact stat row applied to the single selected ETF. Mirrors the
   default Portfolio Risk tab table: shows the main risk metrics
   (tGARCH for daily, EVT for tail, YearVaR for long-horizon) plus the
   asset-specific descriptors (vol, beta, tail-α). The HS and EWMA
   numbers are computed and shipped in the JSON but hidden behind
   hover-over to avoid the model-clutter problem on the snapshot
   surface. Each card has an InfoTip explaining what it means. */
export function RiskProfileCard({ profile, ticker }) {
  if (!profile) return null;

  const stat = (label, value, unit, tip) => (
    <div className="rp-stat" key={label}>
      <div className="rp-stat-label">
        {label}
        {tip && <InfoTip text={tip} />}
      </div>
      <div className="rp-stat-value">{value}</div>
      {unit && <div className="rp-stat-unit">{unit}</div>}
    </div>
  );

  const fmtPct = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);

  // Hidden-model summary: HS and EWMA. Surfaced as a single tooltip
  // hover on the daily VaR header so users can sanity-check against
  // the alternative model estimates without seeing them in the row.
  const hiddenModelsTip = (
    `Other daily VaR models for ${ticker}:\n` +
    `• HS (Historical Simulation): ${profile.var_hs != null ? profile.var_hs.toFixed(2) + "%" : "—"} ` +
    `(empirical 1st percentile, no distribution assumption)\n` +
    `• EWMA (RiskMetrics, λ=0.94): ${profile.var_ewma != null ? profile.var_ewma.toFixed(2) + "%" : "—"} ` +
    `(Gaussian — known to underestimate fat tails)`
  );

  // Curated sanity-check reference bands for this ticker (from
  // backend/reference_values.py). Built as a multi-line tooltip and
  // surfaced on the panel header so the reader can compare today's live
  // numbers against the literature without leaving the page.
  const refLabels = [
    ["var_1d_99",      "1-day 99% VaR"],
    ["year_var_10",    "YearVaR (10%)"],
    ["hill_alpha",     "Hill tail α"],
    ["ff_market_beta", "FF Market β"],
    ["ff_smb",         "FF SMB"],
    ["ff_hml",         "FF HML"],
    ["ff_rmw",         "FF RMW"],
    ["ff_cma",         "FF CMA"],
    ["ff_mom",         "FF MOM"],
  ];
  const refs = profile.references || {};
  const refLines = refLabels
    .filter(([k]) => refs[k])
    .map(([k, label]) => `• ${label}: ${refs[k]}`);
  const referenceTip = refLines.length > 0
    ? `Expected ranges for ${ticker} (curated from the literature — sanity-check the live numbers against these bands):\n\n${refLines.join("\n\n")}`
    : null;

  return (
    <div className="risk-profile-card">
      <div className="rp-header">
        <span className="rp-title">
          Risk profile — {ticker}
        </span>
        <span className="rp-subtitle">
          Standalone risk metrics for this ETF's NAV. Main models shown;
          HS and EWMA on hover (the Daily VaR GJR-t stat).
          {referenceTip && <InfoTip text={referenceTip} />}
        </span>
      </div>
      <div className="rp-row">
        {stat(
          "60d Vol",
          fmtPct(profile.vol_60d_annualized_pct),
          "annualized",
          "Sample standard deviation of the last 60 daily log returns, annualized via √252. Tells you how much the asset has been moving day-to-day in recent weeks.",
        )}
        {stat(
          "β vs SPY",
          profile.beta_spy_252d?.toFixed(2) ?? "—",
          "252-day OLS",
          "Market beta. OLS slope of this ETF's daily returns regressed on SPY over the last 252 trading days. β > 1 = amplifies market moves; β < 1 = muted; β < 0 = inversely correlated (rare for equity).",
        )}
        {stat(
          "Daily VaR (GJR-t)",
          fmtPct(profile.var_tgarch),
          "1% / 1-day",
          "GJR-GARCH(1,1,1) with Student-t innovations — the main daily VaR model. Captures volatility clustering, the leverage effect (negative shocks raise vol more than positive), AND heavy-tailed innovations. " + hiddenModelsTip,
        )}
        {stat(
          "Daily VaR (EVT)",
          fmtPct(profile.var_evt),
          "1% / GPD tail",
          "Extreme Value Theory. Generalized Pareto distribution fit to the worst losses directly. Best for fat-tailed assets — usually larger than GJR-t and that gap is the tail premium.",
        )}
        {stat(
          "YearVaR (10%)",
          fmtPct(profile.var_yr_10pct),
          "1-year horizon",
          "1-year VaR at 10% confidence. The 10th-percentile worst loss expected over the next year, % of position. Computed via Student-t parametric scaling. Long-horizon framing: '10% chance of losing more than X% over the next year.'",
        )}
        {stat(
          "Tail α",
          profile.tail_index?.toFixed(2) ?? "—",
          "Hill estimator",
          "Hill tail index. Lower = fatter tails. Broad equity indices typically 3-4; individual stocks 2-4; crypto often below 3. Below 3 indicates meaningfully heavier tails than a normal-distribution model assumes — weight the EVT VaR more heavily.",
        )}
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

// Plain-English explainer for each Fama-French / Carhart factor. These
// appear as hover-overs on each row in the loadings table so users who
// haven't read the FF literature can read the panel without external
// reference. Keys match the `factor` field in each loading record.
const FF_FACTOR_DESCRIPTIONS = {
  "Mkt-RF":
    "Market excess return. The broad US stock market's return MINUS the risk-free rate (T-bill yield). Captures the classic 'market beta' — how much the asset moves with the overall market. A β of 1.2 means a 1% market gain typically corresponds to a 1.2% gain in this asset.",
  "SMB":
    "Small Minus Big — the size factor. Daily return of a portfolio that's long small-cap stocks and short large-cap stocks (sorted by market cap each June). Positive loading = your asset behaves like small-caps (after controlling for market beta); negative = large-cap tilt. Historically small-caps earn higher returns than large-caps, which is the 'size premium' this factor isolates.",
  "HML":
    "High Minus Low — the value factor. Daily return of a portfolio that's long high book-to-market (value) stocks and short low book-to-market (growth) stocks. Positive loading = value tilt (cheap stocks); negative = growth tilt (expensive / fast-growing stocks). Famously the single most studied risk factor in finance; Eugene Fama shared the 2013 Nobel partly for this line of work.",
  "RMW":
    "Robust Minus Weak — the profitability factor (added by Fama-French 2015). Daily return of a portfolio that's long high-profitability ('robust') firms and short low-profitability ('weak') ones. Profitability measured by operating-profit-to-equity. Positive loading = quality tilt; negative = junk tilt. Captures the idea that profitable firms earn higher returns than unprofitable ones after controlling for market, size, and value.",
  "CMA":
    "Conservative Minus Aggressive — the investment factor (also Fama-French 2015). Daily return of a portfolio that's long firms with conservative investment policies (slow capex / asset growth) and short firms with aggressive investment (fast-growing assets). Positive loading = exposure to capital-disciplined firms; negative = exposure to growth-by-acquisition / heavy-capex firms.",
  "MOM":
    "Momentum — Carhart (1997) extension. Daily return of a portfolio that's long recent winners and short recent losers, ranked on trailing 12-month return excluding the most recent month. Positive loading = chases winners (momentum-following); negative = mean-reversion (buys losers, sells winners). Momentum has been a robust factor across markets and decades.",
};

export function FactorRegressionPanel({ model, cascade }) {
  if (!model) return null;
  const sig = (p) =>
      p < 0.001 ? "***"
    : p < 0.01  ? "**"
    : p < 0.05  ? "*"
    : "";

  // Shared tooltip text — mirrors the Thematic panel so users see the
  // same explanations of β, t-stat, p-value, etc. across both panels.
  const TIPS = {
    title: "Fama-French + Carhart factor regression. Decomposes the asset's daily returns into exposures to six widely-published risk factors (Market, Size, Value, Profitability, Investment, Momentum), each constructed as a long-short portfolio by Ken French. Output mirrors what a Barra-style commercial factor model produces: per-factor loadings, R², alpha, and vol decomposition.",
    rsquared: "Fraction of this asset's daily-return variance explained by the six factors. Higher = the asset's behavior is heavily driven by these well-known systematic factors. Lower = more asset-specific (idiosyncratic) variance.",
    varianceShare: "Same idea as R² expressed as % of variance (R² × 100). 'Variance from factors' = how much of the total daily-return variance the factor model explains.",
    factor: "The risk factor being measured. Each is a published long-short portfolio constructed by Ken French (Dartmouth). Hover the row label below for a plain-English description of what each factor actually measures.",
    loading: "OLS regression coefficient β. Interpretation: a 1% return in this factor's portfolio corresponds to a β·1% return in the asset, holding the other factors constant. Positive = moves with the factor; negative = moves opposite.",
    ci: "95% confidence interval for the loading, computed via paired bootstrap (500 case-resampled OLS refits, percentile method). Tells you how precisely the β is pinned down: a narrow interval means the data strongly constrain the loading; a wide interval — especially one that straddles zero — means the apparent β could plausibly be much larger, much smaller, or even the opposite sign. The bootstrap is robust to heteroskedasticity (daily returns are obviously not homoskedastic), so these CIs are usually wider than analytical OLS standard errors during volatile sub-windows.",
    tstat: "t-statistic = β / standard-error(β). Measures how confident we are that the true loading isn't zero. Rule of thumb: |t| > 2 means the coefficient is statistically meaningful (about 95% confidence). |t| > 3 is strongly meaningful.",
    pvalue: "Probability of seeing this t-statistic by chance if the true loading were actually zero. Lower = stronger evidence the asset has real exposure to this factor. Convention: p < 0.05 is 'significant', p < 0.001 is 'very significant'.",
    sig: "Significance stars: *** = p<0.001 (very strong), ** = p<0.01 (strong), * = p<0.05 (significant). No star = the loading is statistically indistinguishable from zero — don't read too much into the β value. Non-significant rows are dimmed.",
    alpha: "Intercept of the regression. The average daily excess return (after subtracting risk-free rate) left over once all six factor exposures are accounted for. A statistically significant alpha (with stars) means the asset is earning a return that no combination of these factors can explain.",
    totalVol: "Sample standard deviation of this asset's daily returns over the 252-day window, annualized via √252, expressed in percent.",
    factorVol: "Volatility explained by the six factors. Computed as σ_total × √R². Tells you how much of the asset's day-to-day risk comes from systematic factor exposures.",
    idioVol: "Idiosyncratic / asset-specific volatility — the part of risk that's NOT explained by the factor model. Computed as σ_total × √(1 − R²). For an individual stock this captures company-specific news, earnings surprises, etc.",
    cascade: "Sequential (Gram-Schmidt) orthogonalization of the same six factors, in a fixed order (market first). Each factor is stripped of any overlap with the factors above it before being measured, so the regressors are uncorrelated and each one's contribution is unambiguous. The OLS table left of this gives symmetric exposures with overlapping CIs; the cascade gives a clean additive variance split. Both are correct — they answer different questions.",
    cascadeLoading: "Loading on the orthogonalized factor — its effect after removing whatever it shares with the factors above it. Reads as 'marginal beyond the prior factors,' not a standalone β. The last factor's value equals its plain-OLS coefficient by construction.",
    cascadeIncr: "NEW share of the asset's return variance this factor explains, beyond the factors above it. Because the orthogonalized factors don't overlap, these add up across the rows to the model R² — no double-counting.",
    cascadeCum: "Running total of variance explained as each factor is added in sequence. The final row equals the model R² (same value as the OLS R²).",
    cascadeOrder: "Order matters: the first factor (market) absorbs all the variance it shares with the others, so it tends to dominate. Reorder the sequence and the split shifts — this is a sequential / Type-I decomposition, by design.",
  };

  return (
    <div className="factor-regression-panel">
      <div className="fr-header">
        <div>
          <div className="fr-title">
            Factor risk model <InfoTip text={TIPS.title} />
          </div>
          <div className="fr-subtitle">
            {model.model} · OLS regression on excess returns, last {model.lookback_days} trading days
            ({model.first_date} → {model.last_date}).
            Open-data substitute for Barra-style multi-factor attribution.
          </div>
        </div>
        <div className="fr-headline-stats">
          <div className="fr-headline">
            <span className="fr-headline-value">{(model.r_squared * 100).toFixed(1)}%</span>
            <span className="fr-headline-label">
              R² <InfoTip text={TIPS.rsquared} />
            </span>
          </div>
          <div className="fr-headline">
            <span className="fr-headline-value">{model.factor_variance_share_pct.toFixed(0)}%</span>
            <span className="fr-headline-label">
              variance from factors <InfoTip text={TIPS.varianceShare} />
            </span>
          </div>
        </div>
      </div>

      <table className="fr-table">
        <thead>
          <tr>
            <th>Factor <InfoTip text={TIPS.factor} /></th>
            <th className="num">Loading (β) <InfoTip text={TIPS.loading} /></th>
            <th className="num">95% CI <InfoTip text={TIPS.ci} /></th>
            <th className="num">t-stat <InfoTip text={TIPS.tstat} /></th>
            <th className="num">p-value <InfoTip text={TIPS.pvalue} /></th>
            <th>Sig. <InfoTip text={TIPS.sig} /></th>
          </tr>
        </thead>
        <tbody>
          {model.loadings.map((l) => {
            // CI straddles zero ⇒ sign of β is statistically unresolved.
            // We render that case in a muted tone to discourage over-
            // reading the point estimate.
            const ciStraddlesZero = l.ci_low != null && l.ci_high != null
              && l.ci_low <= 0 && l.ci_high >= 0;
            return (
              <tr key={l.factor} className={l.significant ? "" : "fr-row-dim"}>
                <td>
                  {l.label}
                  {(FF_FACTOR_DESCRIPTIONS[l.factor] || l.reference_band) && (
                    <InfoTip
                      text={[
                        FF_FACTOR_DESCRIPTIONS[l.factor],
                        l.reference_band ? `\n\nExpected band for this asset: ${l.reference_band}` : null,
                      ].filter(Boolean).join("")}
                    />
                  )}
                </td>
                <td className="num">
                  <span style={{ color: l.beta >= 0 ? "var(--green)" : "var(--red)" }}>
                    {l.beta >= 0 ? "+" : ""}{l.beta.toFixed(3)}
                  </span>
                </td>
                <td className="num fr-ci-cell" style={ciStraddlesZero ? { opacity: 0.6 } : undefined}>
                  {l.ci_low != null && l.ci_high != null
                    ? `[${l.ci_low >= 0 ? "+" : ""}${l.ci_low.toFixed(3)}, ${l.ci_high >= 0 ? "+" : ""}${l.ci_high.toFixed(3)}]`
                    : "—"}
                </td>
                <td className="num" style={{ color: Math.abs(l.tstat) >= 2 ? "var(--green)" : "var(--text-dim)", fontWeight: Math.abs(l.tstat) >= 2 ? 600 : 400 }}>{l.tstat.toFixed(2)}</td>
                <td className="num">{l.p_value.toFixed(3)}</td>
                <td className="fr-sig">{sig(l.p_value)}</td>
              </tr>
            );
          })}
          <tr className="fr-alpha-row">
            <td>
              α (intercept) <InfoTip text={TIPS.alpha} />
            </td>
            <td className="num">
              {model.alpha_daily_pct >= 0 ? "+" : ""}{model.alpha_daily_pct.toFixed(3)}%/day
            </td>
            <td className="num fr-ci-cell">—</td>
            <td className="num" style={{ color: Math.abs(model.alpha_tstat) >= 2 ? "var(--green)" : "var(--text-dim)", fontWeight: Math.abs(model.alpha_tstat) >= 2 ? 600 : 400 }}>{model.alpha_tstat.toFixed(2)}</td>
            <td className="num">{model.alpha_pvalue.toFixed(3)}</td>
            <td className="fr-sig">{sig(model.alpha_pvalue)}</td>
          </tr>
        </tbody>
      </table>

      <div className="fr-vol-decomp">
        <span className="fr-vol-label">Annualized vol decomposition:</span>
        <span className="fr-vol-pair">
          total <strong>{model.total_vol_annualized_pct.toFixed(1)}%</strong>
          <InfoTip text={TIPS.totalVol} />
        </span>
        <span className="fr-vol-pair fr-vol-factor">
          factor <strong>{model.factor_vol_annualized_pct.toFixed(1)}%</strong>
          <InfoTip text={TIPS.factorVol} />
        </span>
        <span className="fr-vol-pair fr-vol-idio">
          idiosyncratic <strong>{model.idio_vol_annualized_pct.toFixed(1)}%</strong>
          <InfoTip text={TIPS.idioVol} />
        </span>
        <span className="fr-vol-formula">
          σ²<sub>idio</sub> = σ²<sub>total</sub> × (1 − R²)
        </span>
      </div>

      {cascade && cascade.cascade?.length > 0 && (
        <div className="fr-cascade">
          <div className="fr-cascade-head">
            <span className="fr-cascade-title">
              Sequential contribution — orthogonal cascade
              <InfoTip text={TIPS.cascade} />
            </span>
            <span className="fr-cascade-sub">
              market-first order; each factor measured after removing its overlap
              with the ones above
              <InfoTip text={TIPS.cascadeOrder} />
            </span>
          </div>
          <table className="fr-table fr-cascade-table">
            <thead>
              <tr>
                <th>Factor (in order)</th>
                <th className="num">Seq. β <InfoTip text={TIPS.cascadeLoading} /></th>
                <th className="num">New variance <InfoTip text={TIPS.cascadeIncr} /></th>
                <th className="fr-cascade-bar-col">Share of explained</th>
                <th className="num">Cumulative R² <InfoTip text={TIPS.cascadeCum} /></th>
              </tr>
            </thead>
            <tbody>
              {cascade.cascade.map((c) => (
                <tr key={c.factor}>
                  <td>
                    <span className="fr-cascade-step">{c.step}</span>
                    {c.label}
                  </td>
                  <td className="num">
                    {c.ortho_loading >= 0 ? "+" : ""}
                    {c.ortho_loading.toFixed(3)}
                  </td>
                  <td className="num">{c.incr_var_pct.toFixed(2)}%</td>
                  <td className="fr-cascade-bar-col">
                    <span className="fr-cascade-track">
                      <span
                        className="fr-cascade-fill"
                        style={{
                          width: `${Math.max(0, Math.min(100, c.share_of_explained_pct ?? 0))}%`,
                        }}
                      />
                    </span>
                    <span className="fr-cascade-pct">
                      {c.share_of_explained_pct != null
                        ? `${c.share_of_explained_pct.toFixed(0)}%`
                        : "—"}
                    </span>
                  </td>
                  <td className="num">{c.cumulative_r2_pct.toFixed(1)}%</td>
                </tr>
              ))}
              <tr className="fr-cascade-total">
                <td>Model total</td>
                <td className="num">—</td>
                <td className="num">{cascade.model_r2_pct.toFixed(1)}%</td>
                <td className="fr-cascade-bar-col"></td>
                <td className="num">{cascade.model_r2_pct.toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
          <div className="fr-cascade-foot">
            Reads as "of the {cascade.model_r2_pct.toFixed(0)}% the factors explain,
            how it splits." The orthogonalized factors don't overlap, so New
            variance sums to the model R². Order-dependent — the OLS table above
            holds the symmetric, standalone exposures.
          </div>
        </div>
      )}

      <div className="fr-footnote">
        Significance: <code>***</code> p&lt;0.001 &middot; <code>**</code> p&lt;0.01 &middot; <code>*</code> p&lt;0.05.
        Refs: Fama &amp; French (1993, 2015); Carhart (1997). Daily factor data from the
        Ken French Data Library, public.
      </div>
    </div>
  );
}


/* ---------- Thematic Exposure Panel ----------
   Regresses the asset's returns against a panel of orthogonalized
   thematic ETF baskets (energy, regional banks, semis, duration,
   defensives, EM, credit) to surface narrative-style risk drivers.
   FF/Carhart factors are academically rigorous but interpretively
   weak; "your stock has +0.6 oil-shock exposure" reads more actionably
   than "your stock has +0.4 HML loading." Thematic baskets close that
   gap by mapping loadings to narrative risk drivers.

   Output mirrors the FF regression panel shape (loadings table +
   significance + R² + vol decomp) so the two panels read as siblings. */
export function ThematicExposurePanel({ thematic }) {
  if (!thematic) return null;
  const sig = (p) =>
      p < 0.001 ? "***"
    : p < 0.01  ? "**"
    : p < 0.05  ? "*"
    : "";

  // Reusable tooltip text fragments — each one explains a single
  // concept in plain language and keeps the table readable without
  // requiring you to remember stats vocab.
  const TIPS = {
    title: "What this panel does: regresses the selected ETF's daily returns on a panel of sector / thematic ETFs that each represent a real-world risk driver (oil shocks, regional banking stress, duration, China sensitivity, etc.). The output tells you which themes are actually moving the asset.",
    rsquared: "Fraction of this asset's daily-return variance explained by the panel of thematic baskets. R² = 90% means themes explain 90% of the day-to-day moves; the remaining 10% is asset-specific (residual). Higher R² = the asset is heavily driven by the themes; lower R² = more idiosyncratic.",
    basket: "The ETF ticker used as a proxy for the theme. We picked liquid US-listed ETFs that each capture one risk driver cleanly (e.g., XLE for oil-shock exposure, KRE for regional-banking stress, TLT for duration / safe-haven).",
    theme: "Plain-English description of what the basket captures. Read each loading as 'how much does this asset move when THIS theme moves' — beyond what the broad market alone explains.",
    loading: "OLS regression coefficient β. Interpretation: a 1% move in the theme corresponds to a β·1% move in the asset, holding the other themes constant. Positive = moves together; negative = moves opposite. The first row is the raw market β vs SPY; all other rows are computed against MARKET-ORTHOGONALIZED basket residuals — they isolate exposure beyond plain market beta.",
    tstat: "t-statistic = β / standard-error(β). Measures how confident we are that the true loading isn't zero. Rule of thumb: |t| > 2 means the coefficient is statistically meaningful (about 95% confidence). |t| > 3 is strongly meaningful.",
    pvalue: "Probability of seeing this t-statistic by chance if the true loading were actually zero. Lower = stronger evidence the asset has real exposure to this theme. Convention: p < 0.05 is 'significant', p < 0.001 is 'very significant'.",
    sig: "Significance stars: *** = p<0.001 (very strong), ** = p<0.01 (strong), * = p<0.05 (significant). No star = the loading is statistically indistinguishable from zero — don't read too much into the β value. Non-significant rows are dimmed.",
    orthogonalized: "Market-orthogonalized: each non-market basket's returns are first regressed against SPY, and the RESIDUAL (the part of the basket's move not explained by the broad market) is used as the regressor. This way the non-market loadings read as 'exposure to this theme BEYOND general market exposure.' Without this step, every sector ETF looks the same because they're all ~90% correlated with SPY.",
    totalVol: "Sample standard deviation of this asset's daily returns over the lookback window, annualized by √252 (252 trading days per year), expressed in percent.",
    factorVol: "The fraction of total volatility explained by the themes, computed as σ_total × √R². The square root matters: even a middling R² maps to a large share of volatility. When this is high, most of the asset's risk comes from the themes rather than asset-specific moves.",
    residualVol: "Idiosyncratic / asset-specific volatility. The part of the asset's risk NOT explained by any theme — corporate-action news, company-specific announcements, microstructure noise. Computed as σ_total × √(1 − R²).",
  };

  return (
    <div className="factor-regression-panel thematic-panel">
      <div className="fr-header">
        <div>
          <div className="fr-title">
            Thematic risk exposures <InfoTip text={TIPS.title} />
          </div>
          <div className="fr-subtitle">
            {thematic.model} · last {thematic.lookback_days} trading days
            ({thematic.first_date} → {thematic.last_date}).
            Each basket is a sector/thematic ETF that approximates a
            narrative risk driver (oil shock, regional-banking stress,
            duration, China exposure, etc.). Non-market loadings are
            computed against <em>market-orthogonalized</em>{" "}
            <InfoTip text={TIPS.orthogonalized} /> basket residuals —
            they read as exposure <strong>beyond</strong> market beta.
          </div>
        </div>
        <div className="fr-headline-stats">
          <div className="fr-headline">
            <span className="fr-headline-value">{(thematic.r_squared * 100).toFixed(0)}%</span>
            <span className="fr-headline-label">
              R² <InfoTip text={TIPS.rsquared} />
            </span>
          </div>
        </div>
      </div>

      <table className="fr-table">
        <thead>
          <tr>
            <th>Basket <InfoTip text={TIPS.basket} /></th>
            <th>Theme <InfoTip text={TIPS.theme} /></th>
            <th className="num">Loading (β) <InfoTip text={TIPS.loading} /></th>
            <th className="num">t-stat <InfoTip text={TIPS.tstat} /></th>
            <th className="num">p-value <InfoTip text={TIPS.pvalue} /></th>
            <th>Sig. <InfoTip text={TIPS.sig} /></th>
          </tr>
        </thead>
        <tbody>
          {thematic.loadings.map((l) => (
            <tr key={l.basket} className={l.significant ? "" : "fr-row-dim"}>
              <td><strong>{l.basket}</strong>{l.is_market && <span className="thematic-mkt-tag"> · market</span>}</td>
              <td className="thematic-label-cell">{l.label}</td>
              <td className="num">
                <span style={{ color: l.beta >= 0 ? "var(--green)" : "var(--red)" }}>
                  {l.beta >= 0 ? "+" : ""}{l.beta.toFixed(3)}
                </span>
              </td>
              <td className="num" style={{ color: Math.abs(l.tstat) >= 2 ? "var(--green)" : "var(--text-dim)", fontWeight: Math.abs(l.tstat) >= 2 ? 600 : 400 }}>{l.tstat.toFixed(2)}</td>
              <td className="num">{l.p_value.toFixed(3)}</td>
              <td className="fr-sig">{sig(l.p_value)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="fr-vol-decomp">
        <span className="fr-vol-label">Annualized vol decomposition:</span>
        <span className="fr-vol-pair">
          total <strong>{thematic.total_vol_annualized_pct.toFixed(1)}%</strong>
          <InfoTip text={TIPS.totalVol} />
        </span>
        <span className="fr-vol-pair fr-vol-factor">
          explained by themes <strong>{thematic.factor_vol_annualized_pct.toFixed(1)}%</strong>
          <InfoTip text={TIPS.factorVol} />
        </span>
        <span className="fr-vol-pair fr-vol-idio">
          residual <strong>{thematic.idio_vol_annualized_pct.toFixed(1)}%</strong>
          <InfoTip text={TIPS.residualVol} />
        </span>
      </div>

      <div className="fr-footnote">
        Thematic baskets map to risk drivers (oil shock,
        regional-banking stress, duration, China exposure) rather than to
        academic factor returns. The FF panel above and this thematic
        panel are complementary — FF for the standard factor set,
        thematic for sector/narrative exposures.
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


export function RollingFactorLoadingsPanel({ rolling }) {
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
        to investigate, e.g., a fund bought as quality-growth drifting toward
        value or losing its profitability tilt.
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


/* ---------- Sector ETF selector ----------
   The control that drives every Sector Spotlight section. Rendered as a
   standalone control bar above the sections (analogous to the Switch
   Portfolio bar), so changing the ETF updates all sections at once. */
export function SectorSelector({ views, ticker, setTicker, view }) {
  const fmtTickerLabel = (t) => `${t} — ${views.names[t] ?? t}`;
  return (
    <div className="sector-selector">
      <div className="anomaly-control-group">
        <span className="anomaly-control-label">Sector ETF</span>
        <select
          className="anomaly-ticker-select"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
        >
          {views.tickers.map((t) => (
            <option key={t} value={t}>{fmtTickerLabel(t)}</option>
          ))}
        </select>
      </div>
      {view && (
        <div className="anomaly-stats">
          <span><strong>{view.series.length}</strong> trading days</span>
          <span className="anomaly-stat-sep">·</span>
          <span><strong>{view.anomalies.length}</strong> anomaly day(s) flagged</span>
          <span className="anomaly-stat-sep">·</span>
          <span>z-score window <strong>{view.params.zscore_window}d</strong></span>
          <span className="anomaly-stat-sep">·</span>
          <span>lookback <strong>{view.params.lookback_days}d</strong></span>
        </div>
      )}
    </div>
  );
}


/* ---------- Anomaly signals ----------
   The price chart with anomaly markers + the three stacked detector
   subpanels on a shared timeline + the recent-flagged-dates list. */
export function AnomalySignalsPanel({ view, ticker }) {
  if (!view) return null;
  return (
    <div className="anomaly-signals">
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
          label="GARCH-residual outlier (after conditional-vol adjustment)"
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
        detector firing alone — same principle as the multi-model VaR table
        on the Portfolio Risk tab.
      </div>
    </div>
  );
}


/* Standalone composition (kept for non-section use). App.jsx renders the
   selector + each panel in its own collapsible Section instead. */
export default function AnomalyDetectorPanel({ views, selectedTicker, onTickerChange }) {
  const tickers = views?.tickers ?? [];
  const [localTicker, setLocalTicker] = useState(tickers[0] ?? null);
  const ticker  = selectedTicker ?? localTicker;
  const setTicker = onTickerChange ?? setLocalTicker;

  if (!tickers.length || !ticker) {
    return (
      <div className="anomaly-empty">
        No anomaly views available. Run the backend to populate.
      </div>
    );
  }

  const view = views.data[ticker];
  if (!view) return null;

  return (
    <div className="anomaly-panel">
      <SectorSelector views={views} ticker={ticker} setTicker={setTicker} view={view} />
      <RiskProfileCard profile={view.risk_profile} ticker={ticker} />
      <FactorRegressionPanel model={view.factor_model} cascade={view.factor_model_cascade} />
      <ThematicExposurePanel thematic={view.thematic_exposures} />
      <RollingFactorLoadingsPanel rolling={view.factor_model_rolling} />
      <AnomalySignalsPanel view={view} ticker={ticker} />
    </div>
  );
}
