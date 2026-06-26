import InfoTip from "./InfoTip.jsx";
import "./Performance.css";

/**
 * Regime-conditional alpha: the basket's active return + Information Ratio
 * split by the benchmark's volatility regime (Calm / Normal / Stressed,
 * trailing-vol terciles). Answers what a single IR can't — does the edge
 * survive when risk is expensive?
 *
 * Data shape: backend performance.compute_regime_conditional_alpha().
 */

const TIPS = {
  regime: "Days split by the benchmark's trailing 21-day volatility into low / mid / high thirds (terciles).",
  active: "Active return (portfolio − benchmark), annualized, on the days in this regime.",
  ir: "IR within the regime = active return ÷ active risk on those days.",
  benchvol: "Average annualized benchmark volatility in this regime.",
  hit: "% of days in this regime with positive active return.",
};

function pct(v, d = 1) {
  return v == null ? "—" : `${v.toFixed(d)}%`;
}
function signed(v, d = 2) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
}

// Build a plain-language read of the pattern from the actual regime values,
// rather than asserting a fixed "edge evaporates in stress" story.
function narrative(regimes, spread) {
  const by = Object.fromEntries(regimes.map((r) => [r.key, r]));
  const calm = by.calm, stress = by.stressed;
  if (!calm || !stress) return null;
  const ca = calm.ann_active_pct, sa = stress.ann_active_pct;
  if (sa < 0 && ca > 0)
    return `The edge is a calm-market phenomenon: ${signed(ca)}% active when volatility is low, but ${signed(sa)}% when it spikes. It does not survive stress.`;
  if (ca < 0 && sa > 0)
    return `The edge only appears under stress: ${signed(sa)}% active in high-volatility regimes versus ${signed(ca)}% when calm — a crisis-alpha profile.`;
  if (spread != null && spread > 5)
    return `Alpha is strongest when calm (${signed(ca)}%) and fades as volatility rises (${signed(sa)}% stressed), a ${signed(spread)}-point calm-minus-stressed gap.`;
  if (spread != null && spread < -5)
    return `Alpha builds with volatility: ${signed(sa)}% stressed versus ${signed(ca)}% calm, a ${signed(-spread)}-point stress premium.`;
  return `The edge holds across regimes — ${signed(ca)}% active when calm, ${signed(sa)}% under stress — without a strong dependence on the volatility environment.`;
}

export default function RegimeAlphaPanel({ data }) {
  if (!data || !data.regimes?.length) return null;
  const regimes = data.regimes;
  const maxAbs = Math.max(...regimes.map((r) => Math.abs(r.ann_active_pct ?? 0)), 1);

  return (
    <div className="pf-panel">
      <div className="pf-regime-grid">
        {regimes.map((r) => {
          const a = r.ann_active_pct ?? 0;
          const w = Math.min(50, (Math.abs(a) / maxAbs) * 50);
          const pos = a >= 0;
          return (
            <div key={r.key} className={`pf-regime pf-regime-${r.key}`}>
              <div className="pf-regime-head">
                <span className="pf-regime-name">{r.label}</span>
                <span className="pf-regime-meta">
                  {pct(r.avg_bench_vol_pct, 0)} vol · {pct(r.share_pct, 0)} of days
                </span>
              </div>
              <div className={"pf-regime-active " + (pos ? "pf-pos" : "pf-neg")}>
                {signed(a)}%
              </div>
              <div className="pf-regime-sub">annualized active return</div>
              <div className="pf-regime-bar">
                <span className="pf-regime-center" />
                <span
                  className={"pf-regime-fill " + (pos ? "pf-fill-pos" : "pf-fill-neg")}
                  style={pos ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                />
              </div>
              <div className="pf-regime-stats">
                <span>
                  IR <strong>{signed(r.info_ratio)}</strong>
                  <InfoTip text={TIPS.ir} />
                </span>
                <span>
                  hit <strong>{pct(r.hit_rate_pct, 0)}</strong>
                  <InfoTip text={TIPS.hit} />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pf-regime-narrative">
        {narrative(regimes, data.calm_minus_stressed_alpha)}
      </div>

      <div className="pf-foot">
        Days bucketed by the benchmark's trailing {data.vol_window}-day
        volatility into terciles (Calm / Normal / Stressed; thresholds{" "}
        {data.vol_thresholds_pct?.[0]}% / {data.vol_thresholds_pct?.[1]}%
        annualized).
        <InfoTip text={TIPS.regime} /> Regimes are relative to this sample; the
        stressed bucket is dominated by the largest drawdowns in the window. A
        descriptive split of realized active return, not a forecast.
      </div>
    </div>
  );
}
