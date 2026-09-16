import InfoTip from "./InfoTip.jsx";
import "./PositioningPanel.css";

/**
 * Ex-ante positioning strip — the three numbers a quant PM reads first,
 * plus the active factor exposures behind them. All from one model
 * (Sigma = B Sigma_f Bᵀ + D, 8 factors), so the headline and the
 * attribution below it are the same object.
 *
 * Data shape: backend exante.compute_exante().
 */

const TIPS = {
  te: "Ex-ante = predicted tracking error, √(aᵀΣ_f a + residual), using an EWMA factor covariance (~6-month half-life) so it leans toward the current regime. Realized = the plain standard deviation of the active return over the same window. Predicted running above realized means risk has been rising recently. Index-like books run ~1–2%; concentrated active books 6%+.",
  beta: "Predicted beta VS THE BENCHMARK from the model covariance — Cov(p,b)/Var(b) — which is what a risk system and a fund fact sheet both mean by beta. Realized is the trailing regression beta over the same window.",
  fund: "A look-through basket is the fund's top-N holdings re-normalized to 100%, so it is materially more concentrated than the fund itself and its active risk runs far higher. The headline uses the fund's own NAV; the basket figure is shown for contrast, not as the fund's risk.",
  style: "Active loading on a growth-minus-value spread (Russell 1000 Growth − Value, market stripped out), from regressing the active return on it. +0.10 ≈ a 10% net growth-over-value position vs the benchmark. A tilt is only called when |t| ≥ 2 and the loading is at least ±0.05; smaller or noisier reads as neutral. For reference, QQQ vs SPY reads about +0.30.",
  eqbeta: "The benchmark here is a stock/bond blend, so beta vs the benchmark and beta to equities answer different questions. Equity beta is the same model beta, measured against ACWI.",
  capture:
    "How much of the portfolio's realized variance the model reproduces. Near 100% means the factor set spans this book; below ~70% means concentrated bets the 8 factors don't capture — read the numbers as directional.",
  effn: "Effective number of independent risk bets = 1 / Σ(risk share²) across holdings. Far below the holding count means risk is concentrated in a few names.",
  exposure:
    "Portfolio and benchmark loadings, and the active difference (from a direct regression of the active return series). Share is each factor's Euler contribution to predicted active risk. t is the active loading's t-stat — |t| ≥ 2 is a real position; dimmed rows are not statistically distinguishable from zero and should not be read as bets.",
  contrib: "Each holding's Euler share of total predicted variance (factor + specific). Sums to 100%.",
};

const fmt = (v, d = 2) => (v == null ? "—" : v.toFixed(d));
const signed = (v, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);

// Growth <-> value track position, 0-100 with growth on the left
// (clamped at ±0.30, about QQQ vs SPY).
function stylePos(gmv) {
  const clamped = Math.max(-0.3, Math.min(0.3, gmv ?? 0));
  return 50 - (clamped / 0.3) * 50;
}

function captureTier(pct) {
  if (pct == null) return "";
  if (pct >= 85 && pct <= 115) return "pos-good";
  if (pct >= 70) return "pos-mid";
  return "pos-weak";
}

export default function PositioningPanel({ data }) {
  if (!data) return null;
  // For look-through modes the fund's own NAV is the honest headline; the
  // modeled basket is a more concentrated subset and is shown for contrast.
  const F = data.fund;
  const head = F ? F.exante : data;
  const real = F ? F.realized : data.realized;
  const subject = F ? `${F.ticker} fund NAV` : "portfolio";
  const activeFactors = [...(data.factors ?? [])]
    .filter((f) => Math.abs(f.active) >= 0.005)
    .sort((a, b) => Math.abs(b.active) - Math.abs(a.active));

  return (
    <div className="pos-panel">
      {/* ---- the three headline numbers ---- */}
      <div className="pos-strip">
        <div className="pos-stat pos-stat-hero">
          <span className="pos-label">
            Ex-ante active risk <InfoTip text={TIPS.te} />
          </span>
          <span className="pos-value">{fmt(head.active_risk_pct)}%</span>
          <span className="pos-sub">
            realized <strong>{fmt(real?.active_risk_pct)}%</strong> · {subject} vs{" "}
            {data.benchmark_label?.replace(/^.*·\s*/, "") ?? "benchmark"}
          </span>
        </div>

        <div className="pos-stat">
          <span className="pos-label">
            Ex-ante beta <InfoTip text={TIPS.beta} />
          </span>
          <span className="pos-value">{fmt(head.beta)}</span>
          <span className="pos-sub">
            realized <strong>{fmt(real?.beta)}</strong> · vs benchmark
          </span>
          {head.equity_beta != null && (
            <span className="pos-sub">
              equity beta <strong>{fmt(head.equity_beta)}</strong> (realized{" "}
              {fmt(real?.equity_beta)}) · vs {data.equity_ref}{" "}
              <InfoTip text={TIPS.eqbeta} />
            </span>
          )}
        </div>

        <div className="pos-stat pos-stat-style">
          <span className="pos-label">
            Growth ↔ value <InfoTip text={TIPS.style} />
          </span>
          <span className="pos-value">{head.style_label}</span>
          <div className="pos-style-track">
            <span className="pos-style-mid" />
            <span
              className="pos-style-dot"
              style={{ left: `${stylePos(head.style_gmv)}%` }}
            />
          </div>
          <span className="pos-sub pos-style-ends">
            <span>growth</span>
            <span className="pos-style-val">
              G−V {signed(head.style_gmv)} · t {fmt(head.style_gmv_tstat, 1)}
            </span>
            <span>value</span>
          </span>
        </div>

        <div className="pos-stat pos-stat-meta">
          <span className="pos-label">
            Model capture <InfoTip text={TIPS.capture} />
          </span>
          <span className={`pos-value pos-value-sm ${captureTier(data.model_capture_pct)}`}>
            {fmt(data.model_capture_pct, 0)}%
          </span>
          <span className="pos-sub">
            eff. bets <strong>{fmt(data.effective_n, 1)}</strong>
            <InfoTip text={TIPS.effn} /> of {data.n_holdings}
          </span>
        </div>
      </div>

      {F && (
        <div className="pos-basket-note">
          <InfoTip text={TIPS.fund} />{" "}
          Headline is <strong>{F.ticker}</strong>'s own NAV. The modeled top-{data.n_holdings}{" "}
          basket ({data.n_holdings} names re-normalized to 100%, so materially
          more concentrated than the fund) predicts{" "}
          <strong>{fmt(data.active_risk_pct)}%</strong> active risk (realized{" "}
          {fmt(data.realized?.active_risk_pct)}%) and reads{" "}
          <strong>{data.style_label?.toLowerCase()}</strong> (G−V {signed(data.style_gmv)}, t{" "}
          {fmt(data.style_gmv_tstat, 1)}). The factor exposures below are the basket's.
        </div>
      )}

      {/* ---- active factor exposures ---- */}
      <div className="pos-block-label">
        Active factor exposure <InfoTip text={TIPS.exposure} />
        <span className="pos-block-sub">where the tracking error comes from</span>
      </div>
      <div className="pos-table-wrap">
        <table className="pos-table">
          <thead>
            <tr>
              <th className="left">Factor</th>
              <th className="num">Portfolio</th>
              <th className="num">Benchmark</th>
              <th className="num">Active</th>
              <th className="num">t</th>
              <th className="bar-col">Share of active risk</th>
            </tr>
          </thead>
          <tbody>
            {activeFactors.map((f) => {
              const share = f.active_var_share_pct ?? 0;
              const w = Math.min(100, Math.abs(share));
              return (
                <tr key={f.factor} className={f.significant ? "" : "pos-row-dim"}>
                  <td className="left pos-factor">{f.label}</td>
                  <td className="num">{signed(f.portfolio, 2)}</td>
                  <td className="num pos-dim">{signed(f.benchmark, 2)}</td>
                  <td className={`num pos-strong ${f.active >= 0 ? "pos-up" : "pos-down"}`}>
                    {signed(f.active, 2)}
                  </td>
                  <td className={`num ${f.significant ? "pos-sig" : "pos-dim"}`}>
                    {fmt(f.active_tstat, 1)}
                  </td>
                  <td className="bar-col">
                    <span className="pos-track">
                      <span
                        className={`pos-fill ${share < 0 ? "neg" : ""}`}
                        style={{ width: `${w}%` }}
                      />
                    </span>
                    <span className="pos-share">{share == null ? "—" : `${share.toFixed(0)}%`}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pos-foot">
        Ex-ante = predicted from an EWMA factor covariance (~{data.ewma_halflife_days}-day
        half-life, λ={data.ewma_lambda}) over {data.n_obs} days ({data.first_date} →{" "}
        {data.last_date}); realized = plain standard deviation over the same window.
        Fund pages publish trailing 3-/5-year monthly figures instead, so those
        will differ on window and frequency.
        Eight factors (FF5 + momentum + orthogonalized duration and credit) —
        no industry, country, or currency factors, so concentrated bets of
        that kind land in residual risk and predicted active risk runs low.
        Growth ↔ value comes from a separate regression of the active return on
        the {data.style_proxy} spread (orthogonal to market), not the HML row
        below: HML alone misses growth that shows up as momentum and
        profitability.
        Predicted total vol {fmt(data.total_risk_pct)}% vs benchmark{" "}
        {fmt(data.benchmark_risk_pct)}%; {fmt(data.systematic_share_pct, 0)}% of
        predicted variance is systematic. Active risk comes from regressing the
        active return series directly, so the residual term is measured rather
        than assumed independent. Dimmed factor rows are insignificant (|t| &lt; 2)
        — the credit factor in particular carries only ~4% annualized volatility
        against the market's ~17%, so its loading is weakly identified. Sample
        covariance, no shrinkage — point-in-time estimates, not forecasts with
        confidence bands.
      </div>
    </div>
  );
}
